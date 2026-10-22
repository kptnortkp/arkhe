import "server-only";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { storageDeletions, storageEvents, type StorageArea } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { now } from "@/lib/time";
import { storage, storageErrorKind, type StorageErrorKind } from "./driver";

const HOLD_SECONDS = 3600;
const CHUNK = 50;

export function newKey(area: StorageArea, ext: string) {
  return area === "midi"
    ? `midi/${crypto.randomUUID()}.mid`
    : `recordings/${crypto.randomUUID()}.${ext}`;
}

/**
 * Before a put: count the operation (a failed put still costs one) and queue the fresh key with a
 * one-hour hold. The upload's transaction deletes the hold when the key goes live, so a crash at
 * any point leaves a queued key the sweep removes later (db.md §4.1).
 */
export async function holdKey(key: string, area: StorageArea, size: number) {
  const at = now();
  await writeTx(async (tx) => {
    await tx.insert(storageEvents).values({ kind: "put", area, bytes: size, at });
    await tx.insert(storageDeletions).values({
      storageKey: key,
      area,
      sizeBytes: size,
      requestedAt: at,
      notBefore: new Date(at.getTime() + HOLD_SECONDS * 1000),
    });
  });
}

/** After a put timeout: Blob may still commit the object, so delete it only well after that. */
export const LATE_COMMIT_SECONDS = 15 * 60;

/**
 * The put failed or its transaction didn't commit: the key may be deleted now, or only after
 * `delaySeconds` when the put may still land (the daily sweep then removes it).
 */
export async function releaseKey(key: string, delaySeconds = 0) {
  await writeTx((tx) =>
    tx
      .update(storageDeletions)
      .set({ notBefore: delaySeconds > 0 ? new Date(Date.now() + delaySeconds * 1000) : null })
      .where(and(eq(storageDeletions.storageKey, key), eq(storageDeletions.state, "pending"))),
  );
}

/**
 * A failed put. Only a fault or an auth refusal surely left nothing behind; after a timeout or an
 * outage Blob may still commit the object, so the key waits for the daily sweep instead of an
 * inline delete that could run before the late commit and leave an orphan.
 */
export async function releasePutFailure(key: string, kind: StorageErrorKind) {
  const surelyAbsent = kind === "fault" || kind === "auth";
  await releaseKey(key, surelyAbsent ? 0 : LATE_COMMIT_SECONDS).catch(() => {});
  if (surelyAbsent) await drainKeys([key]);
}

type Pending = { storageKey: string };

async function deleteChunk(rows: Pending[], timeoutMs: number) {
  const driver = await storage();
  if (!driver || rows.length === 0) return { deleted: 0, failed: 0 };
  const keys = rows.map((r) => r.storageKey);
  const at = now();
  try {
    await driver.delete(keys, AbortSignal.timeout(timeoutMs));
  } catch (error) {
    await writeTx((tx) =>
      tx
        .update(storageDeletions)
        .set({
          attempts: sql`${storageDeletions.attempts} + 1`,
          lastAttemptAt: at,
          lastError: storageErrorKind(error),
        })
        .where(
          and(inArray(storageDeletions.storageKey, keys), eq(storageDeletions.state, "pending")),
        ),
    );
    return { deleted: 0, failed: keys.length };
  }
  const done = await writeTx((tx) =>
    tx
      .update(storageDeletions)
      .set({
        state: "done",
        doneAt: at,
        attempts: sql`${storageDeletions.attempts} + 1`,
        lastAttemptAt: at,
        lastError: null,
      })
      .where(and(inArray(storageDeletions.storageKey, keys), eq(storageDeletions.state, "pending")))
      .returning({ key: storageDeletions.storageKey }),
  );
  return { deleted: done.length, failed: 0 };
}

const due = (at: Date) =>
  and(
    eq(storageDeletions.state, "pending"),
    or(isNull(storageDeletions.notBefore), lte(storageDeletions.notBefore, at)),
  );

/**
 * After an action: delete these queued keys right away, best effort. Never throws; a failure stays
 * queued for the daily sweep (D18).
 */
export async function drainKeys(keys: readonly string[], timeoutMs = 3_000) {
  if (keys.length === 0) return;
  try {
    const rows = await db
      .select({ storageKey: storageDeletions.storageKey })
      .from(storageDeletions)
      .where(and(inArray(storageDeletions.storageKey, [...keys]), due(now())));
    await deleteChunk(rows, timeoutMs);
  } catch (error) {
    console.error("storage drain failed", { kind: storageErrorKind(error) });
  }
}

/** The sweep's drain: oldest first, in chunks, until the queue or the deadline runs out. */
export async function drainQueue(deadline: number) {
  let deleted = 0;
  let failed = 0;
  const rows = await db
    .select({ storageKey: storageDeletions.storageKey })
    .from(storageDeletions)
    .where(due(now()))
    .orderBy(storageDeletions.requestedAt)
    .limit(500);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const left = deadline - Date.now() - 1_000;
    if (left < 1_000) break;
    // Never past the deadline: the cron's sweeps row must still be written.
    const r = await deleteChunk(rows.slice(i, i + CHUNK), Math.min(10_000, left));
    deleted += r.deleted;
    failed += r.failed;
  }
  return { deleted, failed };
}
