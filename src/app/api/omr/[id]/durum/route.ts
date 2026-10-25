import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { writeTx } from "@/db/write-tx";
import { OMR_WORKFLOW_KINDS } from "@/lib/omr/constants";
import { expireStale, jobById } from "@/lib/omr/jobs";
import { authenticate, machine, parseJson } from "@/lib/omr/machine";
import { now } from "@/lib/time";

export const runtime = "nodejs";

const smallInt = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 40 ? (v as number) : null);

/**
 * The workflow's state: `{ state: "running", runId }` once, or `{ state: "failed", kind }` while
 * not final. Free text is never stored (D102); an unknown kind is stored as `unknown`.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/omr/[id]/durum">) {
  await connection();
  const { id } = await params;
  const auth = await authenticate(request, id, 4096);
  if (auth instanceof Response) return auth;
  const body = parseJson(auth.body) as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) return machine(400, "body");
  await expireStale({ jobId: id });
  const job = await jobById(id);
  if (!job) return machine(404);
  const t = Math.floor(now().getTime() / 1000);

  if (body.state === "running") {
    const runId = typeof body.runId === "string" && /^\d{1,20}$/.test(body.runId) ? body.runId : null;
    const res = await writeTx((tx) =>
      tx.run(sql`update omr_jobs set state = 'running', started_at = ${t}, run_id = ${runId}
                 where id = ${id} and state = 'queued'`),
    );
    if (res.rowsAffected === 0) return machine(409, "state");
    console.log("omr job state", { job: id, state: "running" });
  } else if (body.state === "failed") {
    const kind = (OMR_WORKFLOW_KINDS as readonly unknown[]).includes(body.kind)
      ? (body.kind as string)
      : "unknown";
    const expected = kind === "layout_mismatch" ? smallInt(body.expected) : null;
    const found = kind === "layout_mismatch" ? smallInt(body.found) : null;
    const pair = expected !== null && found !== null;
    const res = await writeTx((tx) =>
      tx.run(sql`update omr_jobs set state = 'failed', error_kind = ${kind},
                   expected = ${pair ? expected : null}, found = ${pair ? found : null}, finished_at = ${t}
                 where id = ${id} and state in ('queued', 'running')`),
    );
    if (res.rowsAffected === 0) return machine(409, "state");
    console.log("omr job state", { job: id, state: "failed", kind });
  } else {
    return machine(400, "body");
  }
  revalidatePath(`/repertuvar/${job.pieceId}/duzenle`);
  return machine(200, "ok");
}
