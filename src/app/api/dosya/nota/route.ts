import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { storageDeletions } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { sameOrigin } from "@/lib/api";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { OMR_MSG } from "@/lib/omr/constants";
import { activeJob } from "@/lib/omr/jobs";
import { isManager } from "@/lib/permissions";
import { storage, storageErrorKind } from "@/lib/storage/driver";
import { fail, ok } from "@/lib/storage/http";
import { drainKeys, holdKey, newKey, releaseKey, releasePutFailure } from "@/lib/storage/ledger";
import { SCORE_MAX_BYTES } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { uploadsPaused, uploadsPausedAfterHold } from "@/lib/storage/quota";
import { isPdf } from "@/lib/storage/sniff";
import { now } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 30;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly text: string,
    readonly code: "not_found" | "locked",
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
    if (total > SCORE_MAX_BYTES) {
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

/**
 * POST /api/dosya/nota?eser=<pieceId>: a manager's score PDF as the raw body (D94). A route handler
 * because server actions stop at 1100 kb. Replaces the piece's PDF (the trigger queues the old key);
 * refused while a conversion is queued or running (D111).
 */
export async function POST(request: Request) {
  await connection();
  if (!sameOrigin(request)) return fail(403, MSG.forbidden, "origin");
  const user = await getSessionUser();
  if (!user) return fail(401, MSG.auth, "auth");
  if (!isManager(user.role)) return fail(403, MSG.forbidden, "forbidden");
  const pieceId = new URL(request.url).searchParams.get("eser") ?? "";
  if (!z.uuid().safeParse(pieceId).success) return fail(404, MSG.pieceNotFound, "not_found");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > SCORE_MAX_BYTES) {
    return fail(413, OMR_MSG.pdfTooBig, "size");
  }
  const { blocked } = await consumeAttempt(`score-upload:${user.id}`, 30, 3_600_000);
  if (blocked) return fail(429, MSG.uploadRate, "rate");
  const [piece] = await db.all<{ id: string }>(
    sql`select id from pieces where id = ${pieceId}`,
  );
  if (!piece) return fail(404, MSG.pieceNotFound, "not_found");
  if (await activeJob(pieceId)) return fail(409, OMR_MSG.scoreLocked, "locked");
  const driver = await storage();
  if (!driver) return fail(503, MSG.disabled, "disabled");
  if (await uploadsPaused(declared > 0 ? declared : SCORE_MAX_BYTES)) {
    return fail(503, MSG.midiFull, "quota");
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(request);
  } catch {
    return fail(400, MSG.generic, "storage");
  }
  if (bytes === null) return fail(413, OMR_MSG.pdfTooBig, "size");
  if (bytes.byteLength === 0 || !isPdf(bytes)) return fail(415, OMR_MSG.notPdf, "type");

  const key = newKey("score", "pdf");
  try {
    await holdKey(key, "score", bytes.byteLength);
  } catch {
    return fail(503, MSG.generic, "storage");
  }
  if (await uploadsPausedAfterHold().catch(() => false)) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    return fail(503, MSG.midiFull, "quota");
  }
  try {
    await driver.put(key, bytes, "application/pdf", AbortSignal.timeout(20_000));
  } catch (error) {
    const kind = storageErrorKind(error);
    console.error("storage put failed", { driver: driver.name, kind });
    await releasePutFailure(key, kind);
    return fail(503, MSG.generic, "storage");
  }

  const at = now();
  const id = crypto.randomUUID();
  let old: string[] = [];
  try {
    old = await writeTx(async (tx) => {
      const [p] = await tx.all<{ ok: number; active: number }>(sql`
        select exists (select 1 from pieces where id = ${pieceId}) as ok,
          exists (select 1 from omr_jobs where piece_id = ${pieceId} and state in ('queued', 'running')) as active`);
      if (!Number(p?.ok)) throw new Refusal(404, MSG.pieceNotFound, "not_found");
      if (Number(p.active)) throw new Refusal(409, OMR_MSG.scoreLocked, "locked");
      const gone = await tx.all<{ storage_key: string }>(
        sql`delete from piece_scores where piece_id = ${pieceId} returning storage_key`,
      );
      const released = await tx
        .delete(storageDeletions)
        .where(and(eq(storageDeletions.storageKey, key), eq(storageDeletions.state, "pending")))
        .returning({ key: storageDeletions.storageKey });
      if (released.length !== 1) throw new Error("upload hold missing");
      await tx.run(sql`
        insert into piece_scores (id, piece_id, storage_key, size_bytes, uploaded_by, uploaded_at)
        values (${id}, ${pieceId}, ${key}, ${bytes.byteLength}, ${user.id}, ${Math.floor(at.getTime() / 1000)})`);
      return gone.map((g) => g.storage_key);
    });
  } catch (error) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    if (error instanceof Refusal) return fail(error.status, error.text, error.code);
    console.error("score upload failed", { name: (error as Error)?.name });
    return fail(500, MSG.generic, "storage");
  }
  await drainKeys(old);
  revalidatePath(`/repertuvar/${pieceId}`);
  revalidatePath(`/repertuvar/${pieceId}/duzenle`);
  console.log("score upload", { driver: driver.name, bytes: bytes.byteLength, replaced: old.length > 0 });
  return ok({ id, sizeBytes: bytes.byteLength, replaced: old.length > 0, message: OMR_MSG.scoreUploaded }, 201);
}
