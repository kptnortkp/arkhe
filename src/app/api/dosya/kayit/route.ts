import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { recordings, storageDeletions, submissions } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { sameOrigin } from "@/lib/api";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { loadSlot, type Slot } from "@/lib/homework/recordings";
import { storage, storageErrorKind } from "@/lib/storage/driver";
import { fail, ok } from "@/lib/storage/http";
import { drainKeys, holdKey, newKey, releaseKey, releasePutFailure } from "@/lib/storage/ledger";
import {
  DURATION_HEADER,
  MAX_DURATION_MS,
  MAX_UPLOADS_PER_SLOT,
  RECORDING_EXTENSIONS,
  RECORDING_MAX_BYTES,
  UNCOMMENTED_KEEP_DAYS,
  UPLOAD_ID_HEADER,
  type RecordingType,
  type UploadCode,
  type UploadResult,
} from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { uploadsPaused, uploadsPausedAfterHold } from "@/lib/storage/quota";
import { sniffAudio } from "@/lib/storage/sniff";
import { addDays, istanbulDateOf, now } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 30;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly text: string,
    readonly code: UploadCode,
  ) {
    super(code);
  }
}

/** The rules every upload must pass, read-only; run again inside the write transaction. */
function refusal(slot: Slot | null): Refusal | null {
  if (!slot) return new Refusal(404, MSG.homeworkNotFound, "not_found");
  if (!slot.eligible) return new Refusal(403, MSG.forbidden, "forbidden");
  // D46: any feedback locks the slot, a legacy board note included.
  if (slot.hasFeedback) return new Refusal(409, MSG.locked, "locked");
  if (slot.uploads >= MAX_UPLOADS_PER_SLOT) return new Refusal(409, MSG.uploadLimit, "limit");
  return null;
}

function durationOf(header: string | null) {
  if (header === null || header.trim() === "") return null;
  const ms = Number(header);
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(Math.round(ms), 0), MAX_DURATION_MS);
}

/** Reads the raw body, stopping as soon as it passes the cap. null = too big. */
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

type Row = {
  id: string;
  user_id: string;
  assignment_id: string;
  uploaded_at: number;
  duration_ms: number | null;
  size_bytes: number;
  content_type: RecordingType;
  replaces_id: string | null;
};

async function resultOf(row: Row): Promise<UploadResult> {
  const [extra] = await db.all<{ late: number; n: number }>(sql`
    select coalesce((select s.submitted_at > a.due_at from submissions s join assignments a on a.id = s.assignment_id
      where s.assignment_id = ${row.assignment_id} and s.user_id = ${row.user_id}), 0) as late,
      (select count(*) from recordings where assignment_id = ${row.assignment_id} and user_id = ${row.user_id}) as n`);
  return {
    id: row.id,
    uploadedAt: new Date(Number(row.uploaded_at) * 1000).toISOString(),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    sizeBytes: Number(row.size_bytes),
    contentType: row.content_type,
    replaced: row.replaces_id !== null,
    late: Boolean(extra?.late),
    uploadsUsed: Number(extra?.n ?? 0),
  };
}

async function existing(uploadId: string) {
  const [row] = await db.all<Row>(sql`
    select id, user_id, assignment_id, uploaded_at, duration_ms, size_bytes, content_type, replaces_id
    from recordings where id = ${uploadId}`);
  return row ?? null;
}

/**
 * POST /api/dosya/kayit?odev=<id>: the singer's take as the raw body (D33). X-Upload-Id makes a
 * retry idempotent; X-Recording-Duration-Ms is display data only (D35). Storage first, the DB row
 * second, and every key is live or queued at every moment (db.md §4.1).
 */
export async function POST(request: Request) {
  await connection();
  if (!sameOrigin(request)) return fail(403, MSG.forbidden, "origin");
  const user = await getSessionUser();
  if (!user) return fail(401, MSG.auth, "auth");
  const assignmentId = new URL(request.url).searchParams.get("odev") ?? "";
  if (!z.uuid().safeParse(assignmentId).success) {
    return fail(404, MSG.homeworkNotFound, "not_found");
  }
  const uploadId = (request.headers.get(UPLOAD_ID_HEADER) ?? "").toLowerCase();
  if (!z.uuid().safeParse(uploadId).success) return fail(400, MSG.generic, "bad_request");

  const { blocked } = await consumeAttempt(`upload:${user.id}`, 20, 3_600_000);
  if (blocked) return fail(429, MSG.uploadRate, "rate");

  // A retry of a take that already landed answers with that take, without a second put.
  const replay = await existing(uploadId);
  if (replay) {
    if (replay.user_id === user.id && replay.assignment_id === assignmentId) {
      return ok(await resultOf(replay));
    }
    return fail(409, MSG.conflict, "conflict");
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RECORDING_MAX_BYTES) {
    return fail(413, MSG.tooBig, "size");
  }
  const driver = await storage();
  if (!driver) return fail(503, MSG.disabled, "disabled");
  const before = refusal(await loadSlot(db, assignmentId, user.id));
  if (before) return fail(before.status, before.text, before.code);
  const incoming = declared > 0 ? declared : RECORDING_MAX_BYTES;
  if (await uploadsPaused(incoming)) return fail(503, MSG.quota, "quota");

  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(request);
  } catch {
    return fail(400, MSG.putFailed, "storage");
  }
  if (bytes === null) return fail(413, MSG.tooBig, "size");
  if (bytes.byteLength === 0) return fail(400, MSG.emptyTake, "empty");
  const type = sniffAudio(bytes);
  if (!type) return fail(415, MSG.wrongType, "type");
  const durationMs = durationOf(request.headers.get(DURATION_HEADER));

  const key = newKey("recording", RECORDING_EXTENSIONS[type]);
  try {
    await holdKey(key, "recording", bytes.byteLength);
  } catch {
    return fail(503, MSG.putFailed, "storage");
  }
  // Again after the hold: holds count as stored, so parallel uploads see each other.
  if (await uploadsPausedAfterHold().catch(() => false)) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    return fail(503, MSG.quota, "quota");
  }
  try {
    await driver.put(key, bytes, type, AbortSignal.timeout(20_000));
  } catch (error) {
    const kind = storageErrorKind(error);
    console.error("storage put failed", { driver: driver.name, kind });
    await releasePutFailure(key, kind);
    return fail(503, MSG.putFailed, "storage");
  }

  const at = now();
  const old: { key: string | null } = { key: null };
  try {
    await writeTx(async (tx) => {
      const slot = await loadSlot(tx, assignmentId, user.id);
      const refused = refusal(slot);
      if (refused) throw refused;
      const current = slot!.current;
      if (current) {
        await tx.run(sql`
          update recordings set replaced_at = ${Math.floor(at.getTime() / 1000)},
            audio_deleted_at = coalesce(audio_deleted_at, ${Math.floor(at.getTime() / 1000)}),
            deleted_reason = coalesce(deleted_reason, 'replaced')
          where id = ${current.id}`);
        if (!current.audioDeleted) old.key = current.storageKey;
      }
      const released = await tx
        .delete(storageDeletions)
        .where(and(eq(storageDeletions.storageKey, key), eq(storageDeletions.state, "pending")))
        .returning({ key: storageDeletions.storageKey });
      if (released.length !== 1) throw new Error("upload hold missing");
      await tx.insert(recordings).values({
        id: uploadId,
        assignmentId,
        userId: user.id,
        replacesId: current?.id ?? null,
        storageKey: key,
        contentType: type,
        sizeBytes: bytes.byteLength,
        durationMs,
        uploadedAt: at,
        deleteOn: addDays(istanbulDateOf(at), UNCOMMENTED_KEEP_DAYS),
      });
      // Exactly submitAssignment's upsert: the first submission time and a manual mark stay (D1).
      await tx
        .insert(submissions)
        .values({ assignmentId, userId: user.id, submittedAt: at, method: "self" })
        .onConflictDoUpdate({
          target: [submissions.assignmentId, submissions.userId],
          set: { submittedAt: at, method: "self", markedBy: null },
          setWhere: isNull(submissions.submittedAt),
        });
    });
  } catch (error) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    if (error instanceof Refusal) return fail(error.status, error.text, error.code);
    // A parallel retry with the same upload id won the race: answer with its take.
    const winner = await existing(uploadId);
    if (winner && winner.user_id === user.id && winner.assignment_id === assignmentId) {
      return ok(await resultOf(winner));
    }
    console.error("recording upload failed", { name: (error as Error)?.name });
    return fail(500, MSG.putFailed, "storage");
  }

  if (old.key) await drainKeys([old.key]);
  revalidatePath("/", "layout");
  console.log("recording upload", {
    driver: driver.name,
    bytes: bytes.byteLength,
    type,
    durationMs,
  });
  const row = await existing(uploadId);
  return ok(await resultOf(row!), 201);
}
