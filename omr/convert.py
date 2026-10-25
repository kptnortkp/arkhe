"""MusicXML from Audiveris -> one multi-track MIDI plus a summary (Phase 11 pipeline contract).

Usage: convert.py SCORE.mxl [MORE.mxl ...] --layout satb|kadin_erkek|sa_tb|auto --piano true|false
                  [--tempo 40-220] --out result.mid --summary summary.json --failure failure.json

Several files are the movements of one book (Audiveris writes `input.mvt1.mxl`, `input.mvt2.mxl`
when a score has more than one movement); they are joined in movement order into one MIDI.

Exit 0: result.mid and summary.json written. Exit 3: failure.json holds {"kind", ...} from the
portal's fixed list (no_music, layout_mismatch, output_invalid). Anything else is a crash, which
the workflow reports as output_invalid.
"""

import argparse
import json
import re
import sys
import unicodedata

import mido
from music21 import converter, stream, tempo

TPQ = 480
VOICE_PROGRAM, VOICE_VELOCITY = 52, 96  # GM 53 Choir Aahs
PIANO_PROGRAM, PIANO_VELOCITY = 0, 64
MAX_TRACKS = 16
MAX_BYTES = 1024 * 1024
DEFAULT_TEMPO = 100
NEEDED = {"satb": 4, "kadin_erkek": 2, "sa_tb": 2}
PARTS = {
    "Soprano": ["soprano"],
    "Alto": ["alto"],
    "Tenor": ["tenor"],
    "Bas": ["bass"],
    "Kadın": ["soprano", "alto"],
    "Erkek": ["tenor", "bass"],
}


class Failure(Exception):
    def __init__(self, kind, **extra):
        super().__init__(kind)
        self.payload = {"kind": kind, **extra}


def fold(name):
    s = unicodedata.normalize("NFD", (name or "").replace("I", "ı").lower().replace("ı", "i"))
    return "".join(c for c in s if not unicodedata.combining(c))


def voice_name(part_name):
    """`auto`: a voice name when the MusicXML part name is one, else None."""
    n = fold(part_name)
    for keys, name in (
        (("kadin", "women", "female"), "Kadın"),
        (("erkek", "men", "male"), "Erkek"),
        (("sop",), "Soprano"),
        (("alt",), "Alto"),
        (("ten",), "Tenor"),
        (("bas",), "Bas"),
    ):
        if any(n.startswith(k) or f" {k}" in n for k in keys):
            return name
    return None


def staff_groups(score):
    """Staves in score order, grouped by their MusicXML part (a piano's two staves share one)."""
    groups = []
    for part in score.parts:
        base = str(part.id).split("-Staff")[0] if isinstance(part, stream.PartStaff) else None
        if base is not None and groups and groups[-1]["base"] == base:
            groups[-1]["staves"].append(part)
        else:
            groups.append({"base": base, "staves": [part]})
    return groups


def split_staves(score, piano):
    """(vocal staves, piano staves): with a piano, the bottom brace-joined pair, else the bottom two."""
    staves = list(score.parts)
    if not piano:
        return staves, []
    groups = staff_groups(score)
    if groups and len(groups[-1]["staves"]) >= 2:
        pn = groups[-1]["staves"]
        return staves[: len(staves) - len(pn)], pn
    return staves[:-2], staves[-2:]


def notes_of(part, pick=None):
    """[(on_tick, off_tick, midi)] of a staff with ties merged; `pick` = "upper"/"lower" splits voices."""
    merged = part.stripTies()
    events = []
    for m in merged.getElementsByClass(stream.Measure):
        if pick is None:
            elements = list(m.recurse().notes)
        else:
            voices = sorted(m.voices, key=lambda v: (str(v.id).isdigit() and int(v.id)) or str(v.id))
            if len(voices) >= 2:
                chosen = voices[0] if pick == "upper" else voices[1]
                elements = list(chosen.recurse().notes)
            elif voices:
                elements = list(voices[0].recurse().notes)
            else:
                elements = list(m.recurse().notes)
        for n in elements:
            pitches = sorted(p.midi for p in n.pitches)
            if not pitches:
                continue
            if pick == "upper":
                pitches = [pitches[-1]]
            elif pick == "lower":
                pitches = [pitches[0]]
            start = float(n.getOffsetInHierarchy(merged))
            end = start + float(n.quarterLength)
            if end <= start:
                continue
            for p in pitches:
                events.append((round(start * TPQ), round(end * TPQ), p))
    return events


def first_tempo(score):
    for mark in score.recurse().getElementsByClass(tempo.MetronomeMark):
        try:
            qpm = mark.getQuarterBPM()
        except Exception:
            qpm = None
        if qpm and 20 <= qpm <= 400:
            return qpm
    return None


def build_tracks(score, layout, piano):
    vocal, piano_staves = split_staves(score, piano)
    found = len(vocal)
    if layout in NEEDED and found != NEEDED[layout]:
        raise Failure("layout_mismatch", expected=NEEDED[layout], found=max(0, min(found, 40)))
    if found == 0 and not piano_staves:
        raise Failure("no_music")
    tracks = []
    if layout == "satb":
        for staff, name in zip(vocal, ("Soprano", "Alto", "Tenor", "Bas")):
            tracks.append((name, notes_of(staff)))
    elif layout == "kadin_erkek":
        for staff, name in zip(vocal, ("Kadın", "Erkek")):
            tracks.append((name, notes_of(staff)))
    elif layout == "sa_tb":
        for staff, (upper, lower) in zip(vocal, (("Soprano", "Alto"), ("Tenor", "Bas"))):
            tracks.append((upper, notes_of(staff, "upper")))
            tracks.append((lower, notes_of(staff, "lower")))
    else:
        for i, staff in enumerate(vocal, 1):
            tracks.append((voice_name(staff.partName) or f"Ses {i}", notes_of(staff)))
    voices = [(name, ev, VOICE_PROGRAM, VOICE_VELOCITY) for name, ev in tracks]
    if piano_staves:
        ev = [e for staff in piano_staves for e in notes_of(staff)]
        voices.append(("Piyano", ev, PIANO_PROGRAM, PIANO_VELOCITY))
    return [t for t in voices if t[1]]


def channels():
    for ch in range(16):
        if ch != 9:
            yield ch


def write_midi(tracks, bpm, score):
    mf = mido.MidiFile(type=1, ticks_per_beat=TPQ, charset="utf-8")
    head = mido.MidiTrack()
    mf.tracks.append(head)
    ts = next(iter(score.recurse().getElementsByClass("TimeSignature")), None)
    if ts is not None:
        head.append(mido.MetaMessage("time_signature", numerator=ts.numerator, denominator=ts.denominator, time=0))
    head.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    head.append(mido.MetaMessage("end_of_track", time=0))
    for (name, events, program, velocity), ch in zip(tracks, channels()):
        tr = mido.MidiTrack()
        mf.tracks.append(tr)
        tr.append(mido.MetaMessage("track_name", name=name, time=0))
        tr.append(mido.Message("program_change", channel=ch, program=program, time=0))
        timeline = sorted([(off, 0, p) for on, off, p in events] + [(on, 1, p) for on, off, p in events])
        last, active = 0, {}
        for tick, kind, p in timeline:
            dt = tick - last
            if kind == 1:
                if active.get(p, 0) > 0:  # the same pitch is still sounding: end it first
                    tr.append(mido.Message("note_off", channel=ch, note=p, velocity=0, time=dt))
                    dt = 0
                    active[p] -= 1
                tr.append(mido.Message("note_on", channel=ch, note=p, velocity=velocity, time=dt))
                active[p] = active.get(p, 0) + 1
                last = tick
            elif active.get(p, 0) > 0:
                tr.append(mido.Message("note_off", channel=ch, note=p, velocity=0, time=dt))
                active[p] -= 1
                last = tick
        tr.append(mido.MetaMessage("end_of_track", time=0))
    return mf


def movement_order(path):
    m = re.search(r"\.mvt(\d+)\.", path)
    return (int(m.group(1)) if m else 0, path)


def join_movements(parts):
    """[(score, tracks)] -> one track list, later movements shifted after the earlier ones."""
    merged, order, offset = {}, [], 0
    for score, tracks in parts:
        for name, events, program, velocity in tracks:
            if name not in merged:
                merged[name] = (name, [], program, velocity)
                order.append(name)
            merged[name][1].extend((on + offset, off + offset, p) for on, off, p in events)
        offset += round(float(score.highestTime) * TPQ)
    return [merged[n] for n in order]


def convert(srcs, layout, piano, tempo_in, out, summary_path):
    if isinstance(srcs, str):
        srcs = [srcs]
    scores = []
    for src in sorted(srcs, key=movement_order):
        try:
            score = converter.parse(src)
        except Exception:
            raise Failure("no_music")
        if not score.parts:
            raise Failure("no_music")
        scores.append(score)
    parts = [(score, build_tracks(score, layout, piano)) for score in scores]
    tracks = join_movements(parts)
    score = scores[0]
    if not tracks:
        raise Failure("no_music")
    if len(tracks) > 15:
        raise Failure("output_invalid")
    bpm = tempo_in or first_tempo(score) or DEFAULT_TEMPO
    mf = write_midi(tracks, bpm, score)
    mf.save(out)
    with open(out, "rb") as f:
        size = len(f.read())
    if size > MAX_BYTES or len(mf.tracks) > MAX_TRACKS + 1:
        raise Failure("output_invalid")
    measures = sum(max(len(p.getElementsByClass(stream.Measure)) for p in sc.parts) for sc in scores)
    if not 1 <= measures <= 2000:
        raise Failure("output_invalid")
    summary = {
        "tracks": [{"name": name, "parts": PARTS.get(name, [])} for name, *_ in tracks],
        "measures": measures,
        "durationSec": round(mf.length),
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False)
    return summary


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("score", nargs="+")
    ap.add_argument("--layout", required=True, choices=["satb", "kadin_erkek", "sa_tb", "auto"])
    ap.add_argument("--piano", required=True, choices=["true", "false"])
    ap.add_argument("--tempo", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--failure", required=True)
    args = ap.parse_args(argv)
    tempo_in = None
    if args.tempo.strip():
        if not args.tempo.strip().isdigit() or not 40 <= int(args.tempo) <= 220:
            print("tempo out of range", file=sys.stderr)
            return 2
        tempo_in = int(args.tempo)
    try:
        summary = convert(args.score, args.layout, args.piano == "true", tempo_in, args.out, args.summary)
    except Failure as f:
        with open(args.failure, "w", encoding="utf-8") as fh:
            json.dump(f.payload, fh)
        print(f"failure: {json.dumps(f.payload)}")
        return 3
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
