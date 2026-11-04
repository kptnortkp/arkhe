import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pieceAudio, storageDeletions, VOICE_PARTS } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { sameOrigin } from "@/lib/api";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { isManager } from "@/lib/permissions";
import { storage, storageErrorKind } from "@/lib/storage/driver";
import { fail, ok } from "@/lib/storage/http";
import { drainKeys, holdKey, newKey, releaseKey, releasePutFailure } from "@/lib/storage/ledger";
import {
  AUDIO_MAX_PER_PIECE,
  AUDIO_TOTAL_MAX_BYTES,
  MIDI_LABEL_MAX,
  RECORDING_EXTENSIONS,
  RECORDING_MAX_BYTES,
  UPLOAD_ID_HEADER,
} from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { uploadsPaused, uploadsPausedAfterHold } from "@/lib/storage/quota";
import { sniffAudio } from "@/lib/storage/sniff";
import { cleanLine } from "@/lib/text";
import { now } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 30;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly text: string,
    readonly code: "not_found" | "limit" | "quota",
  ) {
    super(code);
  }
}

async function readCapped(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RECORDING_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

const totals = (pieceId: string) => sql`
  select exists (select 1 from pieces where id = ${pieceId}) as ok,
    (select count(*) from piece_audio where piece_id = ${pieceId}) as n,
    (select coalesce(sum(size_bytes), 0) from piece_audio) as bytes`;

type Totals = { ok: number; n: number; bytes: number };

/** The per-piece and the choir-wide caps; null when the upload fits. */
function overCap(t: Totals | undefined, incoming: number) {
  if (!Number(t?.ok)) return new Refusal(404, MSG.pieceNotFound, "not_found");
  if (Number(t!.n) >= AUDIO_MAX_PER_PIECE) return new Refusal(409, MSG.audioTooMany, "limit");
  if (Number(t!.bytes) + incoming > AUDIO_TOTAL_MAX_BYTES) {
    return new Refusal(409, MSG.audioStoreFull, "quota");
  }
  return null;
}

/**
 * POST /api/dosya/ses?eser=<pieceId>&ses=<tutti|part>&etiket=<label>: a manager's rehearsal audio
 * as the raw body. A route handler because server actions stop at 1100 kb. `X-Upload-Id` makes a
 * retried upload a no-op.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameOrigin(request)) return fail(403, MSG.forbidden, "origin");
  const user = await getSessionUser();
  if (!user) return fail(401, MSG.auth, "auth");
  if (!isManager(user.role)) return fail(403, MSG.forbidden, "forbidden");
  const params = new URL(request.url).searchParams;
  const pieceId = params.get("eser") ?? "";
  if (!z.uuid().safeParse(pieceId).success) return fail(404, MSG.pieceNotFound, "not_found");
  const uploadId = z.uuid().safeParse((request.headers.get(UPLOAD_ID_HEADER) ?? "").toLowerCase());
  if (!uploadId.success) return fail(400, MSG.generic, "bad_request");
  const partValue = params.get("ses") ?? "tutti";
  const voicePart = VOICE_PARTS.find((p) => p === partValue) ?? null;
  if (partValue !== "tutti" && !voicePart) return fail(400, MSG.generic, "bad_request");
  const label = cleanLine(params.get("etiket") ?? "").trim() || null;
  if (label && label.length > MIDI_LABEL_MAX) return fail(400, MSG.midiLabelTooLong, "bad_request");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RECORDING_MAX_BYTES) {
    return fail(413, MSG.audioTooBig, "size");
  }
  const [replay] = await db
    .select({ pieceId: pieceAudio.pieceId })
    .from(pieceAudio)
    .where(eq(pieceAudio.id, uploadId.data));
  if (replay) {
    return replay.pieceId === pieceId
      ? ok({ id: uploadId.data, message: MSG.audioUploaded })
      : fail(409, MSG.generic, "conflict");
  }
  const [before] = await db.all<Totals>(totals(pieceId));
  const early = overCap(before, Number.isFinite(declared) && declared > 0 ? declared : 1);
  if (early) return fail(early.status, early.text, early.code);
  const { blocked } = await consumeAttempt(`audio-upload:${user.id}`, 60, 3_600_000);
  if (blocked) return fail(429, MSG.uploadRate, "rate");
  const driver = await storage();
  if (!driver) return fail(503, MSG.disabled, "disabled");
  if (await uploadsPaused(declared > 0 ? declared : RECORDING_MAX_BYTES)) {
    return fail(503, MSG.midiFull, "quota");
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(request);
  } catch {
    return fail(400, MSG.generic, "storage");
  }
  if (bytes === null) return fail(413, MSG.audioTooBig, "size");
  const type = bytes.byteLength > 0 ? sniffAudio(bytes) : null;
  if (!type) return fail(415, MSG.audioWrongType, "type");

  const key = newKey("recording", RECORDING_EXTENSIONS[type]);
  try {
    await holdKey(key, "recording", bytes.byteLength);
  } catch {
    return fail(503, MSG.generic, "storage");
  }
  if (await uploadsPausedAfterHold().catch(() => false)) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    return fail(503, MSG.midiFull, "quota");
  }
  try {
    await driver.put(key, bytes, type, AbortSignal.timeout(20_000));
  } catch (error) {
    const kind = storageErrorKind(error);
    console.error("storage put failed", { driver: driver.name, kind });
    await releasePutFailure(key, kind);
    return fail(503, MSG.generic, "storage");
  }

  try {
    await writeTx(async (tx) => {
      const [t] = await tx.all<Totals>(totals(pieceId));
      const refused = overCap(t, bytes.byteLength);
      if (refused) throw refused;
      const released = await tx
        .delete(storageDeletions)
        .where(and(eq(storageDeletions.storageKey, key), eq(storageDeletions.state, "pending")))
        .returning({ key: storageDeletions.storageKey });
      if (released.length !== 1) throw new Error("upload hold missing");
      await tx.insert(pieceAudio).values({
        id: uploadId.data,
        pieceId,
        voicePart,
        label,
        storageKey: key,
        contentType: type,
        sizeBytes: bytes.byteLength,
        createdBy: user.id,
        createdAt: now(),
      });
    });
  } catch (error) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    if (error instanceof Refusal) return fail(error.status, error.text, error.code);
    const [winner] = await db
      .select({ pieceId: pieceAudio.pieceId })
      .from(pieceAudio)
      .where(eq(pieceAudio.id, uploadId.data));
    if (winner?.pieceId === pieceId) return ok({ id: uploadId.data, message: MSG.audioUploaded });
    console.error("audio upload failed", { name: (error as Error)?.name });
    return fail(500, MSG.generic, "storage");
  }
  revalidatePath(`/repertuvar/${pieceId}`);
  revalidatePath(`/repertuvar/${pieceId}/duzenle`);
  return ok({ id: uploadId.data, message: MSG.audioUploaded }, 201);
}
