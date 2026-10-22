import { connection } from "next/server";
import { cronSecret } from "@/lib/backup/config";
import { bearerMatches, runPushStep } from "@/lib/push/cron";

export const runtime = "nodejs";
export const maxDuration = 60;

function reply(code: number) {
  return Response.json({}, { status: code, headers: { "Cache-Control": "no-store" } });
}

/** The dispatcher alone, for an optional external trigger (D69); not in vercel.json. */
export async function GET(request: Request) {
  await connection();
  const started = Date.now();
  const secret = cronSecret(process.env);
  if (!secret) return reply(503);
  if (!bearerMatches(request.headers.get("authorization"), secret)) return reply(401);
  // 40 s plus one 10 s in-flight send stays inside maxDuration.
  await runPushStep(new URL(request.url), started + 40_000);
  return reply(200);
}
