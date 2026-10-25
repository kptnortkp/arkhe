// Pure: reads what the portal stores about a converter MIDI (AC 4). Every length is bounds-checked;
// anything unexpected returns null and the job fails as output_invalid.
import { OMR_MAX_TRACKS, OMR_TRACK_NAME_MAX } from "./constants";
import { partsOfTrackName, type AutoTrack } from "./parts";

const u32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

function decodeName(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

type TrackScan = { name: string | null; notes: number; endTick: number; tempos: [number, number][] };

function scanTrack(b: Uint8Array, start: number, end: number): TrackScan | null {
  let at = start;
  let tick = 0;
  let status = 0;
  let name: string | null = null;
  let notes = 0;
  const tempos: [number, number][] = [];
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      if (at >= end) return -1;
      const c = b[at++];
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    return -1;
  };
  while (at < end) {
    const delta = vlq();
    if (delta < 0) return null;
    tick += delta;
    if (at >= end) return null;
    let s = b[at];
    if (s & 0x80) at++;
    else if (status) s = status;
    else return null;
    if (s === 0xff) {
      if (at >= end) return null;
      const type = b[at++];
      const len = vlq();
      if (len < 0 || at + len > end) return null;
      const data = b.subarray(at, at + len);
      at += len;
      // A name longer than this can't pass the 40-character check; don't decode it.
      if (type === 0x03 && name === null) name = len > OMR_TRACK_NAME_MAX * 4 ? "\u0000" : decodeName(data).trim();
      if (type === 0x51 && len === 3) tempos.push([tick, (data[0] << 16) | (data[1] << 8) | data[2]]);
      if (type === 0x2f) break;
      status = 0;
    } else if (s === 0xf0 || s === 0xf7) {
      const len = vlq();
      if (len < 0 || at + len > end) return null;
      at += len;
      status = 0;
    } else if (s >= 0x80 && s < 0xf0) {
      status = s;
      const kind = s & 0xf0;
      const size = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      if (at + size > end) return null;
      if (kind === 0x90 && b[at + 1] > 0) notes++;
      at += size;
    } else {
      return null;
    }
  }
  return { name, notes, endTick: tick, tempos };
}

export type MidiSummary = { tracks: AutoTrack[]; durationSec: number };

/** Tracks with notes (1–16, each named 1–40 chars) and the length in seconds; null when refused. */
export function summarizeMidi(b: Uint8Array): MidiSummary | null {
  if (b.length < 14) return null;
  const division = (b[12] << 8) | b[13];
  if (!division || division & 0x8000) return null;
  let at = 14;
  const scans: TrackScan[] = [];
  while (at + 8 <= b.length) {
    const len = u32(b, at + 4);
    const isTrack = b[at] === 0x4d && b[at + 1] === 0x54 && b[at + 2] === 0x72 && b[at + 3] === 0x6b;
    if (at + 8 + len > b.length) return null;
    if (isTrack) {
      const scan = scanTrack(b, at + 8, at + 8 + len);
      if (!scan) return null;
      scans.push(scan);
    }
    at += 8 + len;
  }
  const voiced = scans.filter((s) => s.notes > 0);
  if (voiced.length < 1 || voiced.length > OMR_MAX_TRACKS) return null;
  const tracks: AutoTrack[] = [];
  for (const s of voiced) {
    const name = s.name ?? "";
    if ([...name].length < 1 || [...name].length > OMR_TRACK_NAME_MAX) return null;
    if (/[\u0000-\u001f\u007f]/.test(name)) return null;
    tracks.push({ name, parts: partsOfTrackName(name) });
  }
  const tempos = scans.flatMap((s) => s.tempos).sort((x, y) => x[0] - y[0]);
  let endTick = 0;
  for (const s of scans) if (s.endTick > endTick) endTick = s.endTick;
  let seconds = 0;
  let lastTick = 0;
  let usPerBeat = 500_000;
  for (const [tick, tempo] of tempos) {
    if (tick > endTick) break;
    seconds += ((tick - lastTick) / division) * (usPerBeat / 1e6);
    lastTick = tick;
    usPerBeat = tempo || usPerBeat;
  }
  seconds += ((endTick - lastTick) / division) * (usPerBeat / 1e6);
  if (!Number.isFinite(seconds) || seconds > 86_400) return null;
  return { tracks, durationSec: Math.round(seconds) };
}
