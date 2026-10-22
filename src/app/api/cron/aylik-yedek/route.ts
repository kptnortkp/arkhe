import { createHash, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { cronSecret } from "@/lib/backup/config";
import { runMonthlyBackup, type RunResult } from "@/lib/backup/run";
import { runPushStep } from "@/lib/push/cron";
import { isRealDay } from "@/lib/finance/schemas";
import { runStorageSweep } from "@/lib/storage/sweep";
import { istanbulDateOf } from "@/lib/time";

export const runtime = "nodejs";
// Keep well below STALE_SECONDS in src/lib/backup/constants.ts.
export const maxDuration = 60;

function reply(code: number, status?: RunResult) {
  return Response.json(status ? { status } : {}, {
    status: code,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Digests first: equal lengths for timingSafeEqual, and the secret's length never leaks. */
function bearerMatches(header: string | null, secret: string) {
  const a = createHash("sha256")
    .update(header ?? "")
    .digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/** e2e hook: pretend "today" is this Istanbul day. Dead code in a production build. */
function testToday(url: URL) {
  if (process.env.NODE_ENV === "production") return null;
  const v = url.searchParams.get("bugun");
  return v && isRealDay(v) ? v : null;
}

/**
 * Vercel Cron, daily 05:00 UTC. Sends the previous Istanbul month once it isn't covered, then runs
 * the push dispatcher and the storage sweep as independent steps: neither changes the reply or the
 * backup (D18, D53, D69).
 */
export async function GET(request: Request) {
  await connection();
  const started = Date.now();
  const secret = cronSecret(process.env);
  if (!secret) return reply(503);
  if (!bearerMatches(request.headers.get("authorization"), secret)) return reply(401);
  const today = testToday(new URL(request.url)) ?? istanbulDateOf(new Date());
  let code = 500;
  let status: RunResult = "failed";
  try {
    const { result } = await runMonthlyBackup({ trigger: "cron", today });
    code = result === "failed" ? 500 : 200;
    status = result;
  } catch (e) {
    console.error("backup cron failed before the run was claimed", {
      name: (e as Error)?.name,
      code: (e as { code?: unknown })?.code,
    });
  }
  // Notifications before the sweep: the time-sensitive step first (D69).
  await runPushStep(new URL(request.url), started + 40_000, {
    backupFailed: status === "failed",
    today,
  });
  // Sequential, after the backup: a parallel sweep write could make the backup's claim skip.
  await runStorageSweep({ today, reason: "cron", deadline: started + 55_000 });
  return reply(code, status);
}
