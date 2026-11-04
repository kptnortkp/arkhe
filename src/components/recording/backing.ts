import type { VoicePart } from "@/db/schema";

/** What plays from the speaker while recording, so it lands in the take with the voice. */
export type Backing =
  | { kind: "audio"; id: string; label: string }
  | { kind: "midi"; id: string; label: string; emphasize: boolean };

/** What the homework page can play: the singer's part and every part together. */
export type Backings = { part: Backing | null; tutti: Backing | null };

/** Starts playback now and returns the stop function. */
export type StartBacking = () => () => void;

/** Fetches and decodes during the count-in, on the recorder's own context (started in the tap). */
export async function prepareBacking(
  backing: Backing,
  myPart: VoicePart | null,
  ctx: AudioContext,
): Promise<StartBacking> {
  if (backing.kind === "audio") {
    const res = await fetch(`/api/dosya/ses/${backing.id}`);
    if (!res.ok) throw new Error(`backing ${res.status}`);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    return () => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      return () => {
        try {
          source.stop();
        } catch {}
        source.disconnect();
      };
    };
  }
  // The MIDI player's chunk loads only when a take actually plays along.
  const [{ backingMidi }, { Synth }] = await Promise.all([
    import("@/components/midi/midi-player"),
    import("@/components/midi/synth"),
  ]);
  const midi = await backingMidi(backing.id, myPart, backing.emphasize);
  return () => {
    const synth = new Synth(ctx, midi.notes, midi.gains, midi.duration);
    synth.play(() => {});
    return () => synth.dispose();
  };
}
