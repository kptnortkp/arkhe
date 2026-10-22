import { connection } from "next/server";
import { z } from "zod";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import {
  canDownload,
  canListen,
  effectiveScope,
  isConductor,
  type Viewer,
} from "@/lib/review/access";
import { loadScope } from "@/lib/review/scope";
import { storage, type StorageDriver } from "@/lib/storage/driver";
import { markRecordingMissing, recordingForDelivery } from "@/lib/storage/files";
import { downloadName } from "@/lib/storage/filename";
import { empty, fail, fileHeaders, startTimeout } from "@/lib/storage/http";
import {
  LISTEN_PER_DAY,
  LISTEN_PER_FILE_PER_HOUR,
  LISTEN_PER_HOUR,
  MISSING_GRACE_MS,
  RECORDING_EXTENSIONS,
} from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { logDelivery, playbackPausedFor, usage } from "@/lib/storage/quota";

export const runtime = "nodejs";
export const maxDuration = 30;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A recording's audio. Authorization comes before existence: anyone without access gets the same
 * empty 404 as for an unknown id, and only an allowed viewer can learn that the audio is gone (410).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/dosya/kayit/[id]">) {
  await connection();
  const viewer = await getSessionUser();
  if (!viewer) return empty(401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return empty(404);

  const rec = await recordingForDelivery(id);
  if (!rec) return empty(404);
  const singer = { id: rec.userId, voicePart: rec.singerPart };
  // Assistants only ever reach the current take (older ones have no audio anyway).
  const scope = rec.current && viewer.id !== rec.userId ? await loadScope(viewer.id) : [];
  if (!canListen(viewer, scope, singer, rec.commented)) return empty(404);
  const download = new URL(request.url).searchParams.get("indir") === "1";
  if (download && !canDownload(viewer, singer)) return empty(404);
  if (rec.audioDeletedAt) return empty(410);

  if (playbackPausedFor(await usage())) return fail(503, MSG.playbackQuota, "quota");
  const limited = await listenLimited(viewer, rec.id);
  if (limited) return fail(429, limited, "rate");
  const driver = await storage();
  if (!driver) return fail(503, MSG.playbackFailed, "disabled");

  let object = await fetchObject(driver, rec.storageKey);
  if (object === "error") return fail(503, MSG.playbackFailed, "storage");
  if (!object) {
    // D56: right after an upload a read may lag; later the file is gone for good (e.g. a restore).
    if (Date.now() - rec.uploadedAt.getTime() < MISSING_GRACE_MS) {
      return fail(503, MSG.playbackFailed, "storage");
    }
    // One more look before an irreversible mark: a single bad 404 must not cost the take.
    object = await fetchObject(driver, rec.storageKey);
    if (object === "error") return fail(503, MSG.playbackFailed, "storage");
  }
  if (!object) {
    console.error("storage object missing", { driver: driver.name });
    await markRecordingMissing(rec.id, rec.storageKey);
    return empty(410);
  }
  const size = object.size ?? rec.sizeBytes;
  await logDelivery("recording", size);
  const ext = RECORDING_EXTENSIONS[rec.contentType];
  return new Response(object.body, {
    status: 200,
    headers: fileHeaders({
      type: rec.contentType,
      size,
      cache: "private, no-store",
      attachment: download ? downloadName([rec.pieceTitle, rec.singerName], ext, "kayit") : null,
    }),
  });
}

/** null = missing, "error" = the store failed (already logged). */
async function fetchObject(driver: StorageDriver, key: string) {
  const timeout = startTimeout(15_000);
  try {
    return await driver.get(key, timeout.signal);
  } catch (error) {
    console.error("storage get failed", {
      driver: driver.name,
      kind: (error as { kind?: string }).kind,
    });
    return "error" as const;
  } finally {
    timeout.clear();
  }
}

/** The Turkish refusal when this viewer has listened too much, else null. */
async function listenLimited(viewer: Viewer, recordingId: string) {
  const hour = await consumeAttempt(`listen:${viewer.id}`, LISTEN_PER_HOUR, HOUR_MS);
  if (hour.blocked) return MSG.listenRate;
  const file = await consumeAttempt(
    `listen:file:${viewer.id}:${recordingId}`,
    LISTEN_PER_FILE_PER_HOUR,
    HOUR_MS,
  );
  if (file.blocked) return MSG.listenFileRate;
  const perDay = isConductor(viewer.role)
    ? LISTEN_PER_DAY.conductor
    : effectiveScope(viewer, await loadScope(viewer.id)).length > 0
      ? LISTEN_PER_DAY.assistant
      : LISTEN_PER_DAY.member;
  const day = await consumeAttempt(`listen:day:${viewer.id}`, perDay, DAY_MS);
  return day.blocked ? MSG.listenDaily : null;
}
