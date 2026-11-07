import type { VoicePart } from "@/db/schema";
import { AudioFetchError, fetchAudio } from "./audio-cache";

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
    // Every take has its own context, so the bytes are cached and decoded per context.
    const src = `/api/dosya/ses/${backing.id}`;
    const decode = async (fresh: boolean) =>
      ctx.decodeAudioData(await (await fetchAudio(src, { fresh })).arrayBuffer());
    // A stored copy that won't decode is fetched once more from the server.
    const buffer = await decode(false).catch((error) => {
      if (error instanceof AudioFetchError) throw error;
      return decode(true);
    });
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
