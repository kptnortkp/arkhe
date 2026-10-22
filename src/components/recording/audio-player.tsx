"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MSG } from "@/lib/storage/messages";
import { claimPlayback, releasePlayback } from "./media-bus";

type PlayerState = "idle" | "loading" | "playing" | "paused" | "error";

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Plays a take: either an in-memory blob, or `/api/dosya/kayit/<id>` fetched once on the first
 * tap (no preload, no Range requests) and played from a blob: URL.
 */
export function AudioPlayer({
  recordingId,
  blob,
  durationMs,
  label = "Kaydını dinle",
  playbackPaused = false,
  downloadHint = false,
}: {
  recordingId?: string;
  blob?: Blob;
  durationMs: number | null;
  label?: string;
  playbackPaused?: boolean;
  /** The conductor can fall back to `İndir` when the browser can't play the format. */
  downloadHint?: boolean;
}) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const urlRef = useRef<string | null>(null);
  const [state, setState] = useState<PlayerState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const known = durationMs !== null ? durationMs / 1000 : null;
  const total = known ?? mediaDuration;
  const self = useRef({ pause: () => audioRef.current?.pause() });

  useEffect(() => {
    const player = self.current;
    return () => {
      releasePlayback(player);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  // A new blob (re-take) starts over.
  useEffect(() => {
    if (!blob) return;
    const audio = audioRef.current;
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      audio?.removeAttribute("src");
      setLoaded(false);
      setState("idle");
      setPosition(0);
    };
  }, [blob]);

  async function source(): Promise<string | null> {
    if (urlRef.current) return urlRef.current;
    if (blob) return (urlRef.current = URL.createObjectURL(blob));
    if (!recordingId) return null;
    let res: Response;
    try {
      res = await fetch(`/api/dosya/kayit/${recordingId}`, { cache: "no-store" });
    } catch {
      setError(MSG.playbackFailed);
      return null;
    }
    if (res.status === 410) {
      router.refresh();
      setError("Ses dosyası silindi.");
      return null;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { code?: string; error?: string });
      setError(data.code === "quota" ? MSG.playbackQuota : (data.error ?? MSG.playbackFailed));
      return null;
    }
    return (urlRef.current = URL.createObjectURL(await res.blob()));
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (state === "playing") {
      audio.pause();
      return;
    }
    setError(null);
    claimPlayback(self.current);
    if (!audio.src) {
      setState("loading");
      const src = await source();
      if (!src) {
        setState("error");
        return;
      }
      audio.src = src;
      setLoaded(true);
    }
    try {
      await audio.play();
      setNeedsTap(false);
    } catch (e) {
      // iOS: the tap's activation may expire during the fetch; the next tap plays.
      setState("paused");
      if ((e as DOMException)?.name === "NotAllowedError") {
        setNeedsTap(true);
        buttonRef.current?.focus();
      } else {
        setState("error");
        setError(MSG.playbackFailed);
      }
    }
  }

  const unplayable = "Bu kayıt bu tarayıcıda çalmıyor.";
  const playing = state === "playing";

  return (
    <div className="space-y-1.5" data-audio-player data-state={state}>
      <div className="flex items-center gap-3 rounded-2xl bg-muted p-2 pr-3">
        <button
          ref={buttonRef}
          type="button"
          onClick={toggle}
          disabled={playbackPaused || state === "loading"}
          aria-busy={state === "loading" || undefined}
          aria-label={playing ? "Duraklat" : label}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          {state === "loading" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
          {playing ? "Duraklat" : "Dinle"}
        </button>
        <input
          type="range"
          aria-label="Konum"
          min={0}
          max={total ?? 0}
          step={0.1}
          value={Math.min(position, total ?? 0)}
          disabled={!total || !loaded}
          aria-valuetext={`${clock(position)} / ${total ? clock(total) : "—"}`}
          onChange={(e) => {
            const audio = audioRef.current;
            if (!audio) return;
            audio.currentTime = Number(e.target.value);
            setPosition(Number(e.target.value));
          }}
          className="h-11 min-w-0 flex-1 accent-primary"
        />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {clock(position)} / {total ? clock(total) : "—"}
        </span>
      </div>
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={() => setState("playing")}
        onPause={() => setState((s) => (s === "playing" ? "paused" : s))}
        onEnded={() => {
          setState("paused");
          releasePlayback(self.current);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setMediaDuration(d);
        }}
        onError={() => {
          if (!loaded) return;
          setState("error");
          setError(downloadHint ? `${unplayable} İndir ile bilgisayarda dinleyebilirsin.` : unplayable);
        }}
      />
      {needsTap && (
        <p className="sr-only" role="status">
          Kayıt hazır; oynatmak için dokun.
        </p>
      )}
      {playbackPaused && <p className="text-xs text-absent-ink">{MSG.playbackQuota}</p>}
      {error && (
        <p className="text-xs text-absent-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
