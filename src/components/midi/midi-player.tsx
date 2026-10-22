import { Midi } from "@tonejs/midi";
import { BellOff, Check, Circle, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { claimPlayback, releasePlayback } from "@/components/recording/media-bus";
import { PartDot } from "@/components/part-dot";
import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { MSG } from "@/lib/storage/messages";
import { cn } from "@/lib/utils";
import { Synth, type SynthNote } from "./synth";

// The AC 52 bundle check finds this chunk by the marker below.
export const MIDI_PLAYER_MARKER = "arkhe-midi-player";

export type MidiControl = { toggle: () => void };
export type MidiPlayerState = "loading" | "playing" | "paused" | "error";

type Parsed = { notes: SynthNote[]; tracks: { name: string; part: VoicePart | null }[]; duration: number };
const files = new Map<string, Promise<Parsed>>();

/** A refusal the server explained (e.g. a 429 rate cap); shown as is instead of "unplayable". */
class ServerRefusal extends Error {}
const TEMPOS = [0.5, 0.75, 1] as const;
// Vowel harmony, no apostrophe: voice-part names are common nouns.
const WITHOUT_PART: Record<VoicePart, string> = {
  soprano: "Sopranosuz",
  alto: "Altosuz",
  tenor: "Tenorsuz",
  bass: "Bassız",
};

const fold = (s: string) =>
  s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

function partOf(name: string): VoicePart | null {
  const n = fold(name);
  if (/sop/.test(n)) return "soprano";
  if (/alt/.test(n)) return "alto";
  if (/ten/.test(n)) return "tenor";
  if (/\bbas/.test(n)) return "bass";
  return null;
}

async function load(id: string): Promise<Parsed> {
  const res = await fetch(`/api/dosya/midi/${id}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (data.error) throw new ServerRefusal(data.error);
    throw new Error(`midi ${res.status}`);
  }
  const midi = new Midi(await res.arrayBuffer());
  const used = midi.tracks.filter((t) => t.notes.length > 0 && t.channel !== 9);
  const notes: SynthNote[] = [];
  used.forEach((t, track) =>
    t.notes.forEach((n) =>
      notes.push({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity, track }),
    ),
  );
  notes.sort((a, b) => a.time - b.time);
  if (notes.length === 0) throw new Error("midi empty");
  return {
    notes,
    tracks: used.map((t, i) => {
      const name = t.name.trim() || `Kanal ${t.channel + 1 || i + 1}`;
      return { name, part: partOf(name) };
    }),
    duration: Math.max(...notes.map((n) => n.time + n.duration)),
  };
}

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

export function MidiPlayer({
  ctx,
  midiId,
  myPart,
  compact = false,
  controlRef,
  onState,
}: {
  ctx: AudioContext;
  midiId: string;
  myPart: VoicePart | null;
  compact?: boolean;
  controlRef?: Ref<MidiControl>;
  onState?: (s: MidiPlayerState) => void;
}) {
  const [state, setState] = useState<MidiPlayerState>("loading");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState<boolean[]>([]);
  const [status, setStatus] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const synth = useRef<Synth | null>(null);
  const self = useRef({ pause: () => pause() });

  function report(s: MidiPlayerState) {
    setState(s);
    onState?.(s);
  }

  const ended = () => {
    report("paused");
    setPosition(synth.current?.duration ?? 0);
    setStatus("Bitti");
    releasePlayback(self.current);
  };

  function play() {
    const s = synth.current;
    if (!s) return;
    claimPlayback(self.current);
    void ctx.resume().catch(() => {});
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = "playback";
    s.play(ended);
    report("playing");
    setStatus("Çalıyor");
  }

  function pause() {
    const s = synth.current;
    if (!s) return;
    s.pause();
    setPosition(s.position());
    report("paused");
    setStatus("Duraklatıldı");
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = "auto";
  }

  function toggle() {
    if (!synth.current) return;
    if (synth.current.playing) pause();
    else play();
  }
  useImperativeHandle(controlRef, () => ({ toggle }));

  useEffect(() => {
    let alive = true;
    if (!files.has(midiId)) files.set(midiId, load(midiId));
    files
      .get(midiId)!
      .then((p) => {
        if (!alive) return;
        synth.current = new Synth(ctx, p.notes, p.tracks.length, p.duration);
        setParsed(p);
        setMuted(p.tracks.map(() => false));
        play();
      })
      .catch((e: unknown) => {
        files.delete(midiId);
        if (!alive) return;
        setRefusal(e instanceof ServerRefusal ? e.message : null);
        report("error");
      });
    const player = self.current;
    return () => {
      alive = false;
      synth.current?.dispose();
      synth.current = null;
      releasePlayback(player);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per mounted file
  }, [midiId, ctx]);

  useEffect(() => {
    if (state !== "playing") return;
    const t = setInterval(() => setPosition(synth.current?.position() ?? 0), 250);
    const hide = () => document.visibilityState === "hidden" && pause();
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pause reads refs only
  }, [state]);

  function setTrackMuted(i: number, m: boolean) {
    synth.current?.mute(i, m);
    setMuted((prev) => prev.map((v, j) => (j === i ? m : v)));
  }

  function solo(mine: number, invert: boolean) {
    parsed?.tracks.forEach((_, i) => setTrackMuted(i, invert ? i === mine : i !== mine));
  }

  const duration = parsed?.duration ?? 0;
  const timeText = state === "loading" ? "Yükleniyor…" : `${clock(position)} / ${clock(duration)}`;
  const playing = state === "playing";
  const mineIndex =
    myPart && parsed ? parsed.tracks.findIndex((t) => t.part === myPart) : -1;
  const uniqueMine =
    mineIndex >= 0 && parsed!.tracks.filter((t) => t.part === myPart).length === 1;
  const soloOn = uniqueMine && muted.every((m, i) => m === (i !== mineIndex));
  const minusOn = uniqueMine && muted.every((m, i) => m === (i === mineIndex));
  const preset = (on: boolean) =>
    cn(
      "min-h-11 rounded-full px-3 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
      on && "bg-primary/12",
    );

  if (state === "error") {
    return (
      <p className="rounded-2xl bg-muted p-3 text-sm text-absent-ink" data-midi-player data-state="error">
        {refusal ?? `${MSG.midiUnplayable} İndir ile telefonuna kaydedebilirsin.`}
      </p>
    );
  }

  const voices = parsed && parsed.tracks.length > 1 && (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Sesler</p>
      <div className="flex flex-wrap gap-2">
        {parsed.tracks.map((t, i) => (
          <button
            key={i}
            type="button"
            role="checkbox"
            aria-checked={!muted[i]}
            data-track={t.name}
            data-muted={muted[i] ? "true" : "false"}
            onClick={() => setTrackMuted(i, !muted[i])}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              muted[i] ? "text-muted-foreground line-through" : "bg-secondary",
            )}
          >
            {muted[i] ? <Circle className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
            {t.part && <PartDot part={t.part} />}
            {t.name}
          </button>
        ))}
      </div>
      {uniqueMine && myPart && (
        <div className="-mx-3 flex flex-wrap gap-x-1">
          <button
            type="button"
            aria-pressed={soloOn}
            className={preset(soloOn)}
            onClick={() => solo(mineIndex, false)}
          >
            Yalnız {VOICE_PART_LABELS[myPart]}
          </button>
          <button
            type="button"
            aria-pressed={minusOn}
            className={preset(minusOn)}
            onClick={() => solo(mineIndex, true)}
          >
            {WITHOUT_PART[myPart]} (sen söyle)
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="space-y-3 rounded-2xl bg-muted p-3"
      data-midi-player={MIDI_PLAYER_MARKER}
      data-state={state}
      data-audio-state={ctx.state}
      data-position-ms={Math.round(position * 1000)}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={state === "loading"}
          aria-label={playing ? "Duraklat" : "Çal"}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        >
          {state === "loading" ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="size-5" aria-hidden />
          ) : (
            <Play className="size-5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          aria-label="Başa dön"
          disabled={!parsed}
          onClick={() => {
            synth.current?.seek(0, ended);
            setPosition(0);
          }}
          className="grid size-11 shrink-0 place-items-center rounded-full outline-none hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
        <span className="ml-auto text-sm tabular-nums" data-testid="midi-position">
          {timeText}
        </span>
      </div>
      <input
        type="range"
        aria-label="Konum"
        aria-valuetext={timeText}
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(position, duration)}
        disabled={!parsed}
        onChange={(e) => {
          const v = Number(e.target.value);
          synth.current?.seek(v, ended);
          setPosition(v);
        }}
        className="h-11 w-full accent-primary"
      />
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Hız">
        <span className="text-xs text-muted-foreground">Hız</span>
        {TEMPOS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={rate === t}
            onClick={() => {
              synth.current?.setRate(t, ended);
              setRate(t);
            }}
            className={cn(
              "min-h-11 min-w-14 rounded-full border px-3 text-sm tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              rate === t ? "border-primary bg-primary text-primary-foreground" : "bg-card",
            )}
          >
            %{t * 100}
          </button>
        ))}
      </div>
      {compact && voices ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
            Sesler
          </summary>
          {voices}
        </details>
      ) : (
        voices
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellOff className="size-3.5 shrink-0" aria-hidden />
        Ses gelmiyorsa telefonun sessiz modunu kapat.
      </p>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
