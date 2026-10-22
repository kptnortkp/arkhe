"use client";

import { useEffect, useRef, useState } from "react";

// D34 order. Headless Chrome claims AAC-in-MP4 yet records 0 bytes, so the countdown probes.
const TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const broken = new Set<string>();
let chosen: string | null | undefined;

const COUNT_IN = 3;
const BARS = 32;

export type MicProblem = "denied" | "nomic" | "busy";
export type StopReason = "user" | "limit" | "hidden" | "interrupted";
export type RecordedTake = { blob: Blob; durationMs: number; reason: StopReason };
export type RecorderPhase = "off" | "requesting" | "countdown" | "recording";

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
type WakeLockSentinelLike = { release: () => Promise<void> };

export function recorderSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function candidates() {
  return TYPES.filter((t) => !broken.has(t) && MediaRecorder.isTypeSupported?.(t));
}

/** Records 700 ms with each candidate until one yields bytes; remembered for the page's life. */
async function probe(stream: MediaStream): Promise<string | null> {
  if (chosen !== undefined) return chosen;
  for (const type of candidates()) {
    const size = await new Promise<number>((resolve) => {
      let total = 0;
      try {
        const rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 48_000 });
        rec.ondataavailable = (e) => (total += e.data.size);
        rec.onstop = () => resolve(total);
        rec.onerror = () => resolve(0);
        rec.start();
        setTimeout(() => rec.state !== "inactive" && rec.stop(), 700);
      } catch {
        resolve(0);
      }
    });
    if (size > 0) return (chosen = type);
    broken.add(type);
  }
  return (chosen = null);
}

const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -100);

/**
 * getUserMedia → a silent 3 s count-in (the meter already runs) → MediaRecorder at 48 kbps mono,
 * with the hard stop, wake lock, interruption handling and the two level hints.
 */
export function useMediaRecorder({
  maxMs,
  onDone,
  onProblem,
  onEmpty,
}: {
  maxMs: number;
  onDone: (take: RecordedTake) => void;
  onProblem: (p: MicProblem) => void;
  onEmpty: () => void;
}) {
  const [phase, setPhase] = useState<RecorderPhase>("off");
  const [count, setCount] = useState(COUNT_IN);
  const [elapsed, setElapsed] = useState(0);
  const [loud, setLoud] = useState(false);
  const [silent, setSilent] = useState(false);
  const [level, setLevel] = useState<"ok" | "silent" | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const live = useRef<{
    stream?: MediaStream;
    ctx?: AudioContext;
    rec?: MediaRecorder;
    chunks: Blob[];
    startAt: number;
    raf: number;
    timers: ReturnType<typeof setTimeout>[];
    wake?: WakeLockSentinelLike | null;
    reason: StopReason;
    cancelled: boolean;
  }>({ chunks: [], startAt: 0, raf: 0, timers: [], reason: "user", cancelled: false });
  const handlers = useRef({ onDone, onProblem, onEmpty, maxMs });
  useEffect(() => {
    handlers.current = { onDone, onProblem, onEmpty, maxMs };
  });

  function teardown() {
    const l = live.current;
    cancelAnimationFrame(l.raf);
    l.timers.forEach(clearTimeout);
    l.timers = [];
    l.stream?.getTracks().forEach((t) => t.stop());
    l.ctx?.close().catch(() => {});
    l.wake?.release().catch(() => {});
    l.stream = undefined;
    l.ctx = undefined;
    l.wake = null;
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = "auto";
  }

  async function wakeLock() {
    try {
      const wl = (navigator as Navigator & {
        wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> };
      }).wakeLock;
      live.current.wake = (await wl?.request("screen")) ?? null;
    } catch {
      live.current.wake = null;
    }
  }

  function meter(analyser: AnalyserNode) {
    const data = new Float32Array(analyser.fftSize);
    const history: number[] = Array(BARS).fill(0);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const began = performance.now();
    let lastBar = 0;
    let loudSince = 0;
    let quietSince = began;
    let loudOff = 0;
    let heardOnset = 0;
    let heard = false;
    let reported = false;
    let loudNow = false;
    let silentNow = false;
    const loop = (t: number) => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      for (const v of data) {
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      const rms = Math.sqrt(sum / data.length);
      const rmsDb = db(rms);
      if (rmsDb > -55) {
        heard = true;
        quietSince = t;
      }
      if (!reported && t - began > 1000) {
        reported = true;
        setLevel(heard ? "ok" : "silent");
      }
      if (db(peak) >= -1) {
        loudSince ||= t;
        if (!loudNow && t - loudSince >= 500) setLoud((loudNow = true));
        loudOff = 0;
      } else {
        loudSince = 0;
        loudOff ||= t;
        if (loudNow && t - loudOff >= 3000) setLoud((loudNow = false));
      }
      if (t - quietSince >= 5000) {
        heardOnset = 0;
        if (!silentNow) setSilent((silentNow = true));
      } else if (silentNow) {
        heardOnset ||= t;
        if (t - heardOnset >= 3000) setSilent((silentNow = false));
      }
      if (t - lastBar >= (reduced ? 250 : 66)) {
        lastBar = t;
        const v = Math.min(1, Math.max(0, (rmsDb + 60) / 60));
        history.shift();
        history.push(v);
        const el = barsRef.current;
        if (el) {
          if (reduced) {
            const fill = el.firstElementChild as HTMLElement | null;
            if (fill) fill.style.width = `${Math.round(v * 100)}%`;
          } else {
            Array.from(el.children).forEach((bar, i) => {
              (bar as HTMLElement).style.height = `${Math.max(6, history[i] * 100)}%`;
            });
          }
        }
      }
      live.current.raf = requestAnimationFrame(loop);
    };
    live.current.raf = requestAnimationFrame(loop);
  }

  function finish() {
    const l = live.current;
    const rec = l.rec;
    const durationMs = Math.min(performance.now() - l.startAt, handlers.current.maxMs);
    const type = rec?.mimeType || chosen || "audio/webm";
    const blob = new Blob(l.chunks, { type: type.split(";")[0] });
    l.chunks = [];
    l.rec = undefined;
    teardown();
    setPhase("off");
    if (blob.size === 0) {
      // That type is useless here; the next take tries the next one (D34 order).
      if (chosen) broken.add(chosen);
      chosen = undefined;
      handlers.current.onEmpty();
      return;
    }
    handlers.current.onDone({ blob, durationMs, reason: l.reason });
  }

  function stop(reason: StopReason = "user") {
    const l = live.current;
    if (!l.rec || l.rec.state === "inactive") return;
    l.reason = reason;
    l.rec.stop();
  }

  function cancel() {
    live.current.cancelled = true;
    if (live.current.rec?.state === "recording") live.current.rec.stop();
    live.current.rec = undefined;
    live.current.chunks = [];
    teardown();
    setPhase("off");
  }

  async function begin(stream: MediaStream) {
    const l = live.current;
    const type = await probe(stream);
    if (l.cancelled) return;
    const rec = new MediaRecorder(stream, {
      ...(type ? { mimeType: type } : {}),
      audioBitsPerSecond: 48_000,
    });
    l.rec = rec;
    l.chunks = [];
    l.reason = "user";
    rec.ondataavailable = (e) => e.data.size > 0 && l.chunks.push(e.data);
    let retrying = false;
    rec.onstop = () => {
      if (!l.cancelled && !retrying) finish();
    };
    rec.onerror = () => {
      // An encoder that fails before its first chunk (headless AAC): next type, same take.
      if (l.chunks.length === 0 && type) {
        retrying = true;
        broken.add(type);
        chosen = undefined;
        l.timers.forEach(clearTimeout);
        l.timers = [];
        if (rec.state !== "inactive") rec.stop();
        void begin(stream);
        return;
      }
      stop("interrupted");
    };
    stream.getAudioTracks().forEach((t) => (t.onended = () => stop("interrupted")));
    rec.onstart = () => {
      l.startAt = performance.now();
      setElapsed(0);
      setPhase("recording");
      const tick = () => {
        const ms = performance.now() - l.startAt;
        setElapsed(ms);
        if (ms >= handlers.current.maxMs) {
          stop("limit");
          return;
        }
        l.timers.push(setTimeout(tick, 250));
      };
      l.timers.push(setTimeout(tick, 250));
    };
    rec.start(1000);
  }

  /** Must run inside the tap: iOS only starts an AudioContext created in a gesture. */
  function start() {
    if (phase !== "off") return;
    const l = live.current;
    l.cancelled = false;
    const Ctx =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    l.ctx = ctx;
    void wakeLock();
    setPhase("requesting");
    setLoud(false);
    setSilent(false);
    setLevel(null);
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      .then((stream) => {
        if (l.cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        l.stream = stream;
        const nav = navigator as AudioSessionNavigator;
        if (nav.audioSession) nav.audioSession.type = "play-and-record";
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        void ctx.resume().catch(() => {});
        meter(analyser);
        setCount(COUNT_IN);
        setPhase("countdown");
        const probing = probe(stream);
        for (let i = 1; i < COUNT_IN; i++) {
          l.timers.push(setTimeout(() => setCount(COUNT_IN - i), i * 1000));
        }
        l.timers.push(
          setTimeout(() => {
            void probing.then(() => {
              if (!l.cancelled) void begin(stream);
            });
          }, COUNT_IN * 1000),
        );
      })
      .catch((e: DOMException) => {
        teardown();
        setPhase("off");
        const name = e?.name;
        handlers.current.onProblem(
          name === "NotFoundError" || name === "OverconstrainedError"
            ? "nomic"
            : name === "NotReadableError" || name === "AbortError"
              ? "busy"
              : "denied",
        );
      });
  }

  // Screen lock or a call: keep what was recorded (D40); re-take the wake lock on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (phase === "recording") stop("hidden");
        else if (phase === "countdown" || phase === "requesting") cancel();
      } else if (phase === "recording") {
        void wakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop/cancel only read refs
  }, [phase]);

  // Leaving mid-take still keeps it: finish() hands it to onDone, which stores it (D40).
  useEffect(
    () => () => {
      const l = live.current;
      if (l.rec?.state === "recording") {
        l.reason = "interrupted";
        l.rec.stop();
      } else {
        l.cancelled = true;
        teardown();
      }
    },
    [],
  );

  return { phase, count, elapsed, loud, silent, level, barsRef, start, stop, cancel, bars: BARS };
}
