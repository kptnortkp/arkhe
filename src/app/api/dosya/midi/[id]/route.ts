import { connection } from "next/server";
import { z } from "zod";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { storage } from "@/lib/storage/driver";
import { midiForDelivery } from "@/lib/storage/files";
import { downloadName } from "@/lib/storage/filename";
import { empty, fail, fileHeaders, startTimeout } from "@/lib/storage/http";
import { MIDI_PER_DAY, MIDI_PER_HOUR } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { logDelivery } from "@/lib/storage/quota";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * A MIDI file for any signed-in active user. No transfer guard: MIDI keeps playing (D20, AC 46), and
 * its deliveries count toward the transfer meter only, never the recording stop.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/dosya/midi/[id]">) {
  await connection();
  const viewer = await getSessionUser();
  if (!viewer) return empty(401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return empty(404);
  const midi = await midiForDelivery(id);
  if (!midi) return empty(404);

  if ((await consumeAttempt(`midi:${viewer.id}`, MIDI_PER_HOUR, 3_600_000)).blocked) {
    return fail(429, MSG.listenRate, "rate");
  }
  if ((await consumeAttempt(`midi:day:${viewer.id}`, MIDI_PER_DAY, 86_400_000)).blocked) {
    return fail(429, MSG.midiDaily, "rate");
  }
  const driver = await storage();
  if (!driver) return fail(503, MSG.playbackFailed, "disabled");
  const timeout = startTimeout(15_000);
  let object;
  try {
    object = await driver.get(midi.storageKey, timeout.signal);
  } catch (error) {
    timeout.clear();
    console.error("storage get failed", {
      driver: driver.name,
      kind: (error as { kind?: string }).kind,
    });
    return fail(503, MSG.playbackFailed, "storage");
  }
  timeout.clear();
  if (!object) {
    console.error("storage object missing", { driver: driver.name });
    return empty(410);
  }
  const size = object.size ?? midi.sizeBytes;
  await logDelivery("midi", size);
  const download = new URL(request.url).searchParams.get("indir") === "1";
  const label = midi.label ?? (midi.voicePart ? VOICE_PART_LABELS[midi.voicePart] : "Tutti");
  return new Response(object.body, {
    status: 200,
    headers: fileHeaders({
      type: "audio/midi",
      size,
      // A file never changes under its id.
      cache: "private, max-age=604800, immutable",
      attachment: download ? downloadName([midi.pieceTitle, label], "mid", "midi") : null,
    }),
  });
}
