import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { storage } from "@/lib/storage/driver";
import { downloadName } from "@/lib/storage/filename";
import { empty, fail, fileHeaders, startTimeout } from "@/lib/storage/http";
import { SCORE_PER_DAY, SCORE_PER_HOUR } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { logDelivery } from "@/lib/storage/quota";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * A piece's score PDF for any signed-in active user (D94). Opens in the browser's own viewer
 * (`inline`) or downloads with `?indir=1`; counts as transfer, never toward the recording stop.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/dosya/nota/[id]">) {
  await connection();
  const viewer = await getSessionUser();
  if (!viewer) return empty(401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return empty(404);
  const [score] = await db.all<{ storage_key: string; size_bytes: number; title: string }>(sql`
    select s.storage_key, s.size_bytes, p.title from piece_scores s join pieces p on p.id = s.piece_id
    where s.id = ${id}`);
  if (!score) return empty(404);
  if ((await consumeAttempt(`score:${viewer.id}`, SCORE_PER_HOUR, 3_600_000)).blocked) {
    return fail(429, MSG.listenRate, "rate");
  }
  if ((await consumeAttempt(`score:day:${viewer.id}`, SCORE_PER_DAY, 86_400_000)).blocked) {
    return fail(429, MSG.midiDaily, "rate");
  }
  const driver = await storage();
  if (!driver) return fail(503, MSG.playbackFailed, "disabled");
  const timeout = startTimeout(15_000);
  let object;
  try {
    object = await driver.get(score.storage_key, timeout.signal);
  } catch (error) {
    timeout.clear();
    console.error("storage get failed", { driver: driver.name, kind: (error as { kind?: string }).kind });
    return fail(503, MSG.playbackFailed, "storage");
  }
  timeout.clear();
  if (!object) {
    console.error("storage object missing", { driver: driver.name });
    return empty(410);
  }
  const size = object.size ?? Number(score.size_bytes);
  await logDelivery("score", size);
  const name = downloadName([score.title, "nota"], "pdf", "nota");
  const download = new URL(request.url).searchParams.get("indir") === "1";
  return new Response(object.body, {
    status: 200,
    headers: fileHeaders({
      type: "application/pdf",
      size,
      // The id changes with every upload, so a cached copy is never a stale score.
      cache: "private, max-age=86400",
      attachment: download ? name : null,
      inlineName: name,
    }),
  });
}
