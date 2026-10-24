"use client";

import { ChevronUp, Loader2, Play } from "lucide-react";
import { useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import type { VoicePart } from "@/db/schema";
import type { MidiPlayerState } from "./midi-player";
import { newAudioContext } from "./synth";

type PlayerModule = typeof import("./midi-player");
type PlayerProps = Parameters<PlayerModule["MidiPlayer"]>[0];

let ctx: AudioContext | null = null;
let loaded: Promise<PlayerModule> | null = null;

/** Created inside the tap: iOS only starts an AudioContext made during a user gesture. */
function audioContext() {
  if (!ctx || ctx.state === "closed") ctx = newAudioContext();
  void ctx.resume().catch(() => {});
  return ctx;
}

/**
 * `Çal`: the player chunk (parser + synth) is imported only on the first tap, never before
 * (AC 51/52); the page bundle only carries this button.
 */
export function MidiButton({
  midiId,
  title,
  myPart,
  variant = "row",
  compact = false,
  ready = false,
  head,
  after,
}: {
  midiId: string;
  title: string;
  myPart: VoicePart | null;
  /** row: `Çal` pill; step: homework `MIDI'yi çal`; hero: `Partisyonumu çal (Alto)`. */
  variant?: "row" | "step" | "hero";
  compact?: boolean;
  /** `?cal=1`: the player panel is already open, waiting for the tap (autoplay is blocked). */
  ready?: boolean;
  /** Row only: the label block before `Çal` and the controls after it. */
  head?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const [Player, setPlayer] = useState<ComponentType<PlayerProps> | null>(null);
  const [context, setContext] = useState<AudioContext | null>(null);
  const [state, setState] = useState<MidiPlayerState | "idle">("idle");
  const [busy, setBusy] = useState(false);

  async function tap() {
    // Play/pause lives in the panel; once open, the trigger only collapses it (unmount stops sound).
    if (Player) {
      setPlayer(null);
      setState("idle");
      return;
    }
    const c = audioContext();
    setBusy(true);
    loaded ??= import("./midi-player");
    try {
      const mod = await loaded;
      setContext(c);
      setPlayer(() => mod.MidiPlayer);
    } catch {
      loaded = null;
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  const open = Boolean(Player);
  const label = open ? "Kapat" : variant === "row" ? "Çal" : title;
  const icon = busy ? (
    <Loader2 className="animate-spin" aria-hidden />
  ) : open ? (
    <ChevronUp aria-hidden />
  ) : (
    <Play aria-hidden />
  );
  const classes = {
    row: "h-11 rounded-full px-3.5",
    step: "h-12 w-full rounded-2xl text-base md:w-auto md:px-6",
    hero: "h-14 w-full rounded-full px-6 text-base md:w-auto",
  }[variant];

  const player =
    Player && context ? (
      <Player
        ctx={context}
        midiId={midiId}
        myPart={myPart}
        compact={compact}
        onState={setState}
      />
    ) : null;
  const failed = state === "error" && !Player && (
    <p className="text-sm text-absent-ink">Bu MIDI dosyası çalınamıyor.</p>
  );

  if (variant === "row") {
    return (
      <div className="space-y-2.5" data-midi-button={midiId}>
        <div className="flex items-center gap-3">
          {head}
          <Button
            type="button"
            variant="outline"
            className={classes}
            onClick={() => void tap()}
            disabled={busy}
            aria-label={`${label}: ${title}`}
            aria-expanded={open}
          >
            {icon}
            {label}
          </Button>
          {after}
        </div>
        {failed}
        {player}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-midi-button={midiId}>
      <Button
        type="button"
        variant={variant === "hero" && !open ? "default" : "outline"}
        className={classes}
        onClick={() => void tap()}
        disabled={busy}
        aria-expanded={open || ready}
      >
        {icon}
        {label}
      </Button>
      {failed}
      {player ??
        (ready && (
          <p
            className="rounded-2xl bg-muted p-3 text-sm text-muted-foreground"
            data-testid="midi-ready"
          >
            Çalmak için yukarıdaki düğmeye dokun.
          </p>
        ))}
    </div>
  );
}
