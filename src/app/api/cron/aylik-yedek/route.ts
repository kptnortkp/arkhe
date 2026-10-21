import { createHash, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { cronSecret } from "@/lib/backup/config";
import { runMonthlyBackup, type RunResult } from "@/lib/backup/run";
import { isRealDay } from "@/lib/finance/schemas";
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

/** Vercel Cron, daily 05:00 UTC. Sends the previous Istanbul month once it isn't covered. */
export async function GET(request: Request) {
  await connection();
  const secret = cronSecret(process.env);
  if (!secret) return reply(503);
  if (!bearerMatches(request.headers.get("authorization"), secret)) return reply(401);
  const today = testToday(new URL(request.url)) ?? istanbulDateOf(new Date());
  try {
    const { result } = await runMonthlyBackup({ trigger: "cron", today });
    return reply(result === "failed" ? 500 : 200, result);
  } catch (e) {
    console.error("backup cron failed before the run was claimed", {
      name: (e as Error)?.name,
      code: (e as { code?: unknown })?.code,
    });
    return reply(500, "failed");
  }
}
