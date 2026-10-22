import "server-only";
import { sql } from "drizzle-orm";
import { storageSweeps } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { addDays, istanbulToUtc, now } from "@/lib/time";
import { drainQueue } from "./ledger";
import { EARLY_CLEAN_DAYS } from "./limits";

export type SweepReason = "cron" | "early";
export type SweepResult = {
  status: "ok" | "partial" | "failed";
  expired: number;
  deleted: number;
  failed: number;
};

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/** Comment day + 30 <= today, in Istanbul days (backend §8.2). */
export function earlyCleanCutoff(today: string) {
  return istanbulToUtc(addDays(today, -(EARLY_CLEAN_DAYS - 1)));
}

async function expire(reason: SweepReason, today: string) {
  const at = seconds(now());
  // The 0010 triggers queue every key whose audio goes here.
  const result = await writeTx((tx) =>
    reason === "cron"
      ? tx.run(sql`
          update recordings set audio_deleted_at = ${at}, deleted_reason = 'retention'
          where audio_deleted_at is null and delete_on <= ${today}`)
      : tx.run(sql`
          update recordings set audio_deleted_at = ${at}, deleted_reason = 'early'
          where audio_deleted_at is null and commented_at is not null
            and commented_at < ${seconds(earlyCleanCutoff(today))}`),
  );
  return result.rowsAffected;
}

async function prune() {
  const at = seconds(now());
  await writeTx(async (tx) => {
    await tx.run(sql`delete from storage_events where at < ${at - 40 * 86_400}`);
    await tx.run(
      sql`delete from storage_deletions where state = 'done' and done_at < ${at - 30 * 86_400}`,
    );
    await tx.run(
      sql`delete from storage_sweeps where id <= (select max(id) from storage_sweeps) - 60`,
    );
    // Media and other throttles insert a row per request; no window here is longer than a day.
    await tx.run(sql`delete from login_attempts where attempted_at < ${at - 2 * 86_400}`);
  });
}

/**
 * Retention and the deletion queue (D17, D18). Never throws: each step is isolated, the result goes
 * to a storage_sweeps row and the log, never to the caller's response.
 */
export async function runStorageSweep(opts: {
  today: string;
  reason: SweepReason;
  deadline: number;
}): Promise<SweepResult> {
  const startedAt = now();
  const started = Date.now();
  let expired = 0;
  let deleted = 0;
  let failed = 0;
  let stepsFailed = 0;
  try {
    // A late start leaves the time to the queue; tomorrow's run expires what's due.
    if (Date.now() < opts.deadline - 5_000) expired = await expire(opts.reason, opts.today);
  } catch (error) {
    stepsFailed++;
    console.error("storage sweep expire failed", { name: (error as Error)?.name });
  }
  try {
    ({ deleted, failed } = await drainQueue(opts.deadline));
  } catch (error) {
    stepsFailed++;
    console.error("storage sweep drain failed", { name: (error as Error)?.name });
  }
  if (opts.reason === "cron") {
    try {
      await prune();
    } catch (error) {
      console.error("storage sweep prune failed", { name: (error as Error)?.name });
    }
  }
  const status: SweepResult["status"] =
    stepsFailed === 2 ? "failed" : stepsFailed > 0 || failed > 0 ? "partial" : "ok";
  try {
    await writeTx((tx) =>
      tx.insert(storageSweeps).values({
        reason: opts.reason,
        status,
        startedAt,
        finishedAt: now(),
        expired,
        deleted,
        failed,
      }),
    );
  } catch (error) {
    console.error("storage sweep not recorded", { name: (error as Error)?.name });
  }
  console.log("storage sweep", {
    reason: opts.reason,
    status,
    expired,
    deleted,
    failed,
    ms: Date.now() - started,
  });
  return { status, expired, deleted, failed };
}
