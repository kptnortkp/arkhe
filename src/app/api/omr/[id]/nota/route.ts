import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { expireStale, jobById } from "@/lib/omr/jobs";
import { authenticate, machine } from "@/lib/omr/machine";
import { storage } from "@/lib/storage/driver";
import { startTimeout } from "@/lib/storage/http";
import { logDelivery } from "@/lib/storage/quota";

export const runtime = "nodejs";
export const maxDuration = 30;

/** The workflow fetches the piece's PDF: only for a queued or running job (D98 replay rule). */
export async function GET(request: Request, { params }: RouteContext<"/api/omr/[id]/nota">) {
  await connection();
  const { id } = await params;
  const auth = await authenticate(request, id, 1024);
  if (auth instanceof Response) return auth;
  await expireStale({ jobId: id });
  const job = await jobById(id);
  if (!job) return machine(404);
  if (job.state !== "queued" && job.state !== "running") return machine(409, "state");
  const [score] = await db.all<{ storage_key: string; size_bytes: number }>(
    sql`select storage_key, size_bytes from piece_scores where piece_id = ${job.pieceId}`,
  );
  if (!score) return machine(409, "no_score");
  const driver = await storage();
  if (!driver) return machine(503, "storage");
  const timeout = startTimeout(15_000);
  let object;
  try {
    object = await driver.get(score.storage_key, timeout.signal);
  } catch (error) {
    timeout.clear();
    console.error("omr pdf get failed", { job: id, kind: (error as { kind?: string }).kind });
    return machine(503, "storage");
  }
  timeout.clear();
  if (!object) return machine(410);
  const size = object.size ?? Number(score.size_bytes);
  await logDelivery("score", size);
  console.log("omr pdf served", { job: id, state: job.state });
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
