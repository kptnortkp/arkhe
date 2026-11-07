import { and, eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ISSUE_IMAGE_MAX_BYTES, ISSUE_IMAGES_PER_REPORT, reportImageDeletions } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { sameOrigin } from "@/lib/api";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { REPORT_IMAGE_WINDOW_MS, REPORT_MSG } from "@/lib/reports/labels";
import { storage, storageErrorKind } from "@/lib/storage/driver";
import { fail, ok } from "@/lib/storage/http";
import { drainKeys, holdKey, newReportKey, releaseKey, releasePutFailure } from "@/lib/storage/ledger";
import { MSG } from "@/lib/storage/messages";
import { uploadsPaused, uploadsPausedAfterHold } from "@/lib/storage/quota";
import { sniffImage } from "@/lib/storage/sniff";

export const runtime = "nodejs";
export const maxDuration = 30;

const IMAGES_PER_DAY = 3 * 10;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly text: string,
    readonly code: "not_found" | "limit" | "locked",
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
    if (total > ISSUE_IMAGE_MAX_BYTES) {
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

/** Why this report can't take another image now, or null. Own reports only, shortly after sending. */
async function refusalFor(q: Pick<typeof db, "all">, reportId: string, userId: string) {
  const [r] = await q.all<{ created_at: number; images: number }>(sql`
    select r.created_at, (select count(*) from issue_report_images i where i.report_id = r.id) as images
    from issue_reports r where r.id = ${reportId} and r.reporter_id = ${userId}`);
  if (!r) return new Refusal(404, REPORT_MSG.notFound, "not_found");
  if (Number(r.created_at) * 1000 < Date.now() - REPORT_IMAGE_WINDOW_MS) {
    return new Refusal(409, REPORT_MSG.imageClosed, "locked");
  }
  if (Number(r.images) >= ISSUE_IMAGES_PER_REPORT) {
    return new Refusal(409, REPORT_MSG.tooManyImages, "limit");
  }
  return null;
}

/**
 * POST /api/dosya/sorun?bildirim=<reportId>: one screenshot of the caller's own report as the raw
 * body. A route handler because server actions stop at 1100 kb; the type comes from the bytes.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameOrigin(request)) return fail(403, MSG.forbidden, "origin");
  const user = await getSessionUser();
  if (!user) return fail(401, MSG.auth, "auth");
  const reportId = new URL(request.url).searchParams.get("bildirim") ?? "";
  if (!z.uuid().safeParse(reportId).success) return fail(404, REPORT_MSG.notFound, "not_found");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ISSUE_IMAGE_MAX_BYTES) {
    return fail(413, REPORT_MSG.imageTooBig, "size");
  }
  const { blocked } = await consumeAttempt(`report-image:${user.id}`, IMAGES_PER_DAY, 86_400_000);
  if (blocked) return fail(429, MSG.uploadRate, "rate");
  const early = await refusalFor(db, reportId, user.id);
  if (early) return fail(early.status, early.text, early.code);
  const driver = await storage();
  if (!driver) return fail(503, MSG.disabled, "disabled");
  if (await uploadsPaused(declared > 0 ? declared : ISSUE_IMAGE_MAX_BYTES)) {
    return fail(503, MSG.midiFull, "quota");
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(request);
  } catch {
    return fail(400, MSG.generic, "storage");
  }
  if (bytes === null) return fail(413, REPORT_MSG.imageTooBig, "size");
  const type = bytes.byteLength > 0 ? sniffImage(bytes) : null;
  if (!type) return fail(415, REPORT_MSG.notImage, "type");

  const key = newReportKey(type);
  try {
    await holdKey(key, null, bytes.byteLength);
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
    return fail(503, REPORT_MSG.imageFailed, "storage");
  }

  const id = crypto.randomUUID();
  try {
    await writeTx(async (tx) => {
      const refusal = await refusalFor(tx, reportId, user.id);
      if (refusal) throw refusal;
      const released = await tx
        .delete(reportImageDeletions)
        .where(and(eq(reportImageDeletions.storageKey, key), eq(reportImageDeletions.state, "pending")))
        .returning({ key: reportImageDeletions.storageKey });
      if (released.length !== 1) throw new Error("upload hold missing");
      await tx.run(sql`
        insert into issue_report_images (id, report_id, storage_key, content_type, size_bytes, created_at)
        values (${id}, ${reportId}, ${key}, ${type}, ${bytes.byteLength}, unixepoch())`);
    });
  } catch (error) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    if (error instanceof Refusal) return fail(error.status, error.text, error.code);
    if ((error as Error)?.message?.includes("issue_report_images_max")) {
      return fail(409, REPORT_MSG.tooManyImages, "limit");
    }
    console.error("report image upload failed", { name: (error as Error)?.name });
    return fail(500, REPORT_MSG.imageFailed, "storage");
  }
  console.log("report image upload", { driver: driver.name, bytes: bytes.byteLength });
  return ok({ id, sizeBytes: bytes.byteLength }, 201);
}
