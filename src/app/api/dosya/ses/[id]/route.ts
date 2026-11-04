import { connection } from "next/server";
import { z } from "zod";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { storage } from "@/lib/storage/driver";
import { audioForDelivery } from "@/lib/storage/files";
import { downloadName } from "@/lib/storage/filename";
import { empty, fail, fileHeaders, startTimeout } from "@/lib/storage/http";
import { AUDIO_PER_DAY, AUDIO_PER_HOUR, RECORDING_EXTENSIONS } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { logDelivery, playbackPausedFor, usage } from "@/lib/storage/quota";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * A piece's rehearsal audio for any signed-in active user. Counted as a recording delivery, so the
 * monthly playback stop covers it (the files are as large as takes).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/dosya/ses/[id]">) {
  await connection();
  const viewer = await getSessionUser();
  if (!viewer) return empty(401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return empty(404);
  const audio = await audioForDelivery(id);
  if (!audio) return empty(404);

  if (playbackPausedFor(await usage())) return fail(503, MSG.playbackQuota, "quota");
  if ((await consumeAttempt(`audio:${viewer.id}`, AUDIO_PER_HOUR, 3_600_000)).blocked) {
    return fail(429, MSG.listenRate, "rate");
  }
  if ((await consumeAttempt(`audio:day:${viewer.id}`, AUDIO_PER_DAY, 86_400_000)).blocked) {
    return fail(429, MSG.listenDaily, "rate");
  }
  const driver = await storage();
  if (!driver) return fail(503, MSG.playbackFailed, "disabled");
  const timeout = startTimeout(15_000);
  let object;
  try {
    object = await driver.get(audio.storageKey, timeout.signal);
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
  const size = object.size ?? audio.sizeBytes;
  await logDelivery("recording", size);
  const download = new URL(request.url).searchParams.get("indir") === "1";
  const label = audio.label ?? (audio.voicePart ? VOICE_PART_LABELS[audio.voicePart] : "Tutti");
  return new Response(object.body, {
    status: 200,
    headers: fileHeaders({
      type: audio.contentType,
      size,
      // A file never changes under its id: a week in the browser saves the monthly transfer.
      cache: "private, max-age=604800, immutable",
      attachment: download
        ? downloadName([audio.pieceTitle, label], RECORDING_EXTENSIONS[audio.contentType], "ses")
        : null,
    }),
  });
}
