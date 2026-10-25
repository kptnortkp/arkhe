import { Midi } from "@tonejs/midi";
import { BellOff, Check, Circle, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { claimPlayback, releasePlayback } from "@/components/recording/media-bus";
import { PartDot } from "@/components/part-dot";
import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { MSG } from "@/lib/storage/messages";
import { cn } from "@/lib/utils";
import { newAudioContext, Synth, type SynthNote } from "./synth";

// The AC 52 bundle check finds this chunk by the marker below.
export const MIDI_PLAYER_MARKER = "arkhe-midi-player";

export type MidiControl = { toggle: () => void };
export type MidiPlayerState = "loading" | "playing" | "paused" | "error";

type Track = { name: string; parts: VoicePart[]; piano: boolean };
type Parsed = { notes: SynthNote[]; tracks: Track[]; duration: number };
type Mix = { on: boolean; level: number }[];
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

function partsOf(name: string): VoicePart[] {
  const n = fold(name);
  if (/\b(kadin|women|female)/.test(n)) return ["soprano", "alto"];
  if (/\b(erkek|men\b|male\b)/.test(n)) return ["tenor", "bass"];
  const parts: VoicePart[] = [];
  if (/sop/.test(n)) parts.push("soprano");
  if (/alt/.test(n)) parts.push("alto");
  if (/ten/.test(n)) parts.push("tenor");
  if (/\bbas/.test(n)) parts.push("bass");
  return parts;
}

const isPiano = (name: string) => /\b(piyano|piano|pf|klavye)/.test(fold(name));

/** @tonejs/midi reads meta text as Latin-1; names written as UTF-8 are re-decoded. */
function utf8(name: string) {
  if (/[^\x00-\xff]/.test(name)) return name;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(name, (c) => c.charCodeAt(0)));
  } catch {
    return name;
  }
}

/** Tracks that carry my part: an exact track wins over a combined one (Kadın, Erkek). */
function mineOf(tracks: Track[], part: VoicePart | null) {
  if (!part) return [];
  const exact = tracks.flatMap((t, i) => (t.parts.length === 1 && t.parts[0] === part ? [i] : []));
  if (exact.length) return exact;
  return tracks.flatMap((t, i) => (t.parts.includes(part) ? [i] : []));
}

const defaults = (tracks: Track[]): Mix => tracks.map((t) => ({ on: true, level: t.piano ? 50 : 100 }));
const PRESETS = {
  solo: (tracks: Track[], mine: number[]) => defaults(tracks).map((m, i) => ({ ...m, on: mine.includes(i) })),
  front: (tracks: Track[], mine: number[]) => tracks.map((_, i) => ({ on: true, level: mine.includes(i) ? 100 : 30 })),
  minus: (tracks: Track[], mine: number[]) => defaults(tracks).map((m, i) => ({ ...m, on: !mine.includes(i) })),
};
const gainOf = (m: Mix[number]) => (m.on ? m.level / 100 : 0);
const same = (a: Mix, b: Mix) => a.length === b.length && a.every((m, i) => m.on === b[i].on && m.level === b[i].level);

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
      const name = utf8(t.name).trim() || `Kanal ${t.channel + 1 || i + 1}`;
      return { name, parts: partsOf(name), piano: isPiano(name) };
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
  emphasize = false,
  compact = false,
  controlRef,
  onState,
}: {
  ctx: AudioContext;
  midiId: string;
  myPart: VoicePart | null;
  /** Opens with `{ses} önde` applied when the file has a track for my part. */
  emphasize?: boolean;
  compact?: boolean;
  controlRef?: Ref<MidiControl>;
  onState?: (s: MidiPlayerState) => void;
}) {
  const [state, setState] = useState<MidiPlayerState>("loading");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState(1);
  const [mix, setMix] = useState<Mix>([]);
  const [status, setStatus] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const synth = useRef<Synth | null>(null);
  const self = useRef({ pause: () => pause() });
  const audio = useRef(ctx);
  const data = useRef<Parsed | null>(null);
  // Set when the page was hidden: iOS can leave the context interrupted after a screen lock.
  const stale = useRef(false);

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

  /** Runs inside the tap, so iOS lets the new context start. */
  function rebuild(old: Synth) {
    const p = data.current;
    if (!p) return old;
    const state = audio.current.state as AudioContextState | "interrupted";
    if (!stale.current && state === "running") return old;
    stale.current = false;
    const position = old.position();
    old.dispose();
    void audio.current.close().catch(() => {});
    audio.current = newAudioContext();
    const next = new Synth(audio.current, p.notes, mix.map(gainOf), p.duration);
    next.setRate(old.rate, ended);
    next.seek(position, ended);
    synth.current = next;
    return next;
  }

  /** `tap`: called from a tap, where a dead context can be replaced (iOS needs the gesture). */
  function play(tap = false) {
    if (!synth.current) return;
    const s = tap ? rebuild(synth.current) : synth.current;
    setStuck(false);
    claimPlayback(self.current);
    void audio.current.resume().catch(() => {});
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
    else play(true);
  }
  useImperativeHandle(controlRef, () => ({ toggle }));

  useEffect(() => {
    let alive = true;
    if (!files.has(midiId)) files.set(midiId, load(midiId));
    files
      .get(midiId)!
      .then((p) => {
        if (!alive) return;
        const mine = mineOf(p.tracks, myPart);
        const start =
          emphasize && mine.length > 0 && mine.length < p.tracks.length
            ? PRESETS.front(p.tracks, mine)
            : defaults(p.tracks);
        synth.current = new Synth(audio.current, p.notes, start.map(gainOf), p.duration);
        data.current = p;
        setParsed(p);
        setMix(start);
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
    // A context iOS won't resume keeps its clock still: say so instead of "playing" in silence.
    const clockAt = audio.current;
    const startedAt = clockAt.currentTime;
    const watch = setTimeout(() => {
      if (clockAt.currentTime !== startedAt) return;
      pause();
      stale.current = true;
      setStuck(true);
    }, 1500);
    return () => {
      clearTimeout(watch);
      clearInterval(t);
      document.removeEventListener("visibilitychange", hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pause reads refs only
  }, [state]);

  // Audio stops when the phone locks, so the screen stays on while the player is open.
  useEffect(() => {
    let wake: WakeLockSentinel | null = null;
    let asking = false;
    let alive = true;
    const hold = () => {
      if (wake || asking || document.visibilityState !== "visible" || !navigator.wakeLock) return;
      asking = true;
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (!alive) return void lock.release();
          wake = lock;
          lock.addEventListener("release", () => {
            if (wake === lock) wake = null;
          });
        })
        .catch(() => {})
        .finally(() => {
          asking = false;
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stale.current = true;
      else hold();
    };
    hold();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      void wake?.release().catch(() => {});
    };
  }, []);

  function apply(next: Mix) {
    next.forEach((m, i) => synth.current?.level(i, gainOf(m)));
    setMix(next);
  }

  function toggleTrack(i: number) {
    apply(mix.map((m, j) => (j === i ? { ...m, on: !m.on } : m)));
  }

  const duration = parsed?.duration ?? 0;
  const timeText = state === "loading" ? "Yükleniyor…" : `${clock(position)} / ${clock(duration)}`;
  const playing = state === "playing";
  const tracks = parsed?.tracks ?? [];
  const mine = mineOf(tracks, myPart);
  const presets = mine.length > 0 && mine.length < tracks.length;
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

  const voices = parsed && tracks.length > 1 && (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Sesler</p>
      <div className="flex flex-wrap gap-2">
        {tracks.map((t, i) => {
          const m = mix[i] ?? { on: true, level: 100 };
          return (
            <button
              key={i}
              type="button"
              role="checkbox"
              aria-checked={m.on}
              data-track={t.name}
              data-muted={m.on ? "false" : "true"}
              data-level={m.level}
              onClick={() => toggleTrack(i)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                m.on ? "bg-secondary" : "text-muted-foreground",
              )}
            >
              {m.on ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
              {t.parts.map((part) => (
                <PartDot key={part} part={part} />
              ))}
              <span className={cn(!m.on && "line-through")}>{t.name}</span>
              {m.level < 100 && (
                <span className="text-xs text-muted-foreground tabular-nums">%{m.level}</span>
              )}
            </button>
          );
        })}
      </div>
      {presets && myPart && (
        <div className="-mx-3 flex flex-wrap gap-x-1">
          {(
            [
              ["solo", `Yalnız ${VOICE_PART_LABELS[myPart]}`],
              ["front", `${VOICE_PART_LABELS[myPart]} önde`],
              ["minus", `${WITHOUT_PART[myPart]} (sen söyle)`],
            ] as const
          ).map(([key, label]) => {
            const next = PRESETS[key](tracks, mine);
            const on = same(mix, next);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                data-preset={key}
                className={preset(on)}
                onClick={() => apply(next)}
              >
                {label}
              </button>
            );
          })}
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
      {stuck && (
        <p className="text-sm text-absent-ink" role="alert">
          Ses başlatılamadı. Tekrar Çal&apos;a dokun.
        </p>
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
