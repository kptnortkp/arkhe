import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ISSUE_IMAGE_EXTENSIONS,
  reportImageDeletions,
  storageDeletions,
  storageEvents,
  type IssueImageType,
  type StorageArea,
} from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { now } from "@/lib/time";
import { storage, storageErrorKind, type StorageErrorKind } from "./driver";

const HOLD_SECONDS = 3600;
const CHUNK = 50;

export function newKey(area: StorageArea, ext: string) {
  if (area === "midi") return `midi/${crypto.randomUUID()}.mid`;
  if (area === "score") return `scores/${crypto.randomUUID()}.pdf`;
  return `recordings/${crypto.randomUUID()}.${ext}`;
}

export function newReportKey(type: IssueImageType) {
  return `reports/${crypto.randomUUID()}.${ISSUE_IMAGE_EXTENSIONS[type]}`;
}

// reports/ keys have their own queue: storage_deletions' CHECKs only admit the other prefixes.
type Queue = "storage_deletions" | "report_image_deletions";
const queueOf = (key: string): Queue =>
  key.startsWith("reports/") ? "report_image_deletions" : "storage_deletions";
const QUEUES: Queue[] = ["storage_deletions", "report_image_deletions"];
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);
const keyList = (keys: readonly string[]) => sql.join(keys.map((k) => sql`${k}`), sql`, `);

/**
 * Before a put: count the operation (a failed put still costs one) and queue the fresh key with a
 * one-hour hold. The upload's transaction deletes the hold when the key goes live, so a crash at
 * any point leaves a queued key the sweep removes later (db.md §4.1).
 */
export async function holdKey(key: string, area: StorageArea | null, size: number) {
  const at = now();
  const notBefore = new Date(at.getTime() + HOLD_SECONDS * 1000);
  await writeTx(async (tx) => {
    // A report image's put has no area of its own; area is ignored for puts.
    await tx.insert(storageEvents).values({ kind: "put", area, bytes: size, at });
    if (queueOf(key) === "report_image_deletions") {
      await tx.insert(reportImageDeletions).values({
        storageKey: key,
        sizeBytes: size,
        requestedAt: at,
        notBefore,
      });
      return;
    }
    if (!area) throw new Error("storage area missing");
    await tx.insert(storageDeletions).values({
      storageKey: key,
      area,
      sizeBytes: size,
      requestedAt: at,
      notBefore,
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
  const notBefore = delaySeconds > 0 ? Math.floor(Date.now() / 1000) + delaySeconds : null;
  await writeTx((tx) =>
    tx.run(sql`
      update ${sql.raw(queueOf(key))} set not_before = ${notBefore}
      where storage_key = ${key} and state = 'pending'`),
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

async function deleteChunk(queue: Queue, keys: string[], timeoutMs: number) {
  const driver = await storage();
  if (!driver || keys.length === 0) return { deleted: 0, failed: 0 };
  const at = seconds(now());
  const table = sql.raw(queue);
  try {
    await driver.delete(keys, AbortSignal.timeout(timeoutMs));
  } catch (error) {
    await writeTx((tx) =>
      tx.run(sql`
        update ${table} set attempts = attempts + 1, last_attempt_at = ${at},
          last_error = ${storageErrorKind(error)}
        where storage_key in (${keyList(keys)}) and state = 'pending'`),
    );
    return { deleted: 0, failed: keys.length };
  }
  const done = await writeTx((tx) =>
    tx.all<{ storage_key: string }>(sql`
      update ${table} set state = 'done', done_at = ${at}, attempts = attempts + 1,
        last_attempt_at = ${at}, last_error = null
      where storage_key in (${keyList(keys)}) and state = 'pending'
      returning storage_key`),
  );
  return { deleted: done.length, failed: 0 };
}

const due = (at: Date) =>
  sql`state = 'pending' and (not_before is null or not_before <= ${seconds(at)})`;

/**
 * After an action: delete these queued keys right away, best effort. Never throws; a failure stays
 * queued for the daily sweep (D18).
 */
export async function drainKeys(keys: readonly string[], timeoutMs = 3_000) {
  if (keys.length === 0) return;
  try {
    for (const queue of QUEUES) {
      const mine = keys.filter((k) => queueOf(k) === queue);
      if (mine.length === 0) continue;
      const rows = await db.all<{ storage_key: string }>(sql`
        select storage_key from ${sql.raw(queue)}
        where storage_key in (${keyList(mine)}) and ${due(now())}`);
      await deleteChunk(queue, rows.map((r) => r.storage_key), timeoutMs);
    }
  } catch (error) {
    console.error("storage drain failed", { kind: storageErrorKind(error) });
  }
}

/** The sweep's drain: oldest first, in chunks, until the queues or the deadline run out. */
export async function drainQueue(deadline: number) {
  let deleted = 0;
  let failed = 0;
  for (const queue of QUEUES) {
    const rows = await db.all<{ storage_key: string }>(sql`
      select storage_key from ${sql.raw(queue)} where ${due(now())}
      order by requested_at limit 500`);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const left = deadline - Date.now() - 1_000;
      if (left < 1_000) break;
      // Never past the deadline: the cron's sweeps row must still be written.
      const r = await deleteChunk(
        queue,
        rows.slice(i, i + CHUNK).map((row) => row.storage_key),
        Math.min(10_000, left),
      );
      deleted += r.deleted;
      failed += r.failed;
    }
  }
  return { deleted, failed };
}
