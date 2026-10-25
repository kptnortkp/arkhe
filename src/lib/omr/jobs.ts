import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeTx } from "@/db/write-tx";
import { istanbulDateOf, istanbulDayRange, now } from "@/lib/time";
import {
  OMR_MSG,
  OMR_PER_CHOIR_30_DAYS,
  OMR_PER_MANAGER_DAY,
  OMR_QUEUED_MAX_MS,
  OMR_TOTAL_MAX_MS,
  type OmrErrorKind,
  type OmrJobState,
  type OmrLayout,
} from "./constants";
import { dispatchJob } from "./dispatch";

const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const toDate = (s: number | null) => (s === null ? null : new Date(Number(s) * 1000));

/**
 * D100, no cron: queued > 20 min → not_started; not final 45 min after the start → timeout. Run
 * before every read and every write that depends on a job's state. Scoped to a piece or a job.
 */
export async function expireStale(scope: { pieceId?: string; jobId?: string } = {}) {
  const t = secs(now());
  const queuedCut = t - OMR_QUEUED_MAX_MS / 1000;
  const totalCut = t - OMR_TOTAL_MAX_MS / 1000;
  const where = scope.jobId
    ? sql`and id = ${scope.jobId}`
    : scope.pieceId
      ? sql`and piece_id = ${scope.pieceId}`
      : sql``;
  const res = await writeTx((tx) =>
    tx.run(sql`
      update omr_jobs set
        error_kind = case when state = 'queued' and created_at < ${queuedCut} then 'not_started' else 'timeout' end,
        state = 'failed', finished_at = ${t}
      where state in ('queued', 'running')
        and ((state = 'queued' and created_at < ${queuedCut}) or created_at < ${totalCut}) ${where}`),
  );
  if (res.rowsAffected > 0) console.log("omr jobs expired", { count: res.rowsAffected });
}

export type JobView = {
  id: string;
  state: OmrJobState;
  errorKind: OmrErrorKind | null;
  expected: number | null;
  found: number | null;
  layout: OmrLayout;
  piano: boolean;
  tempo: number | null;
  runId: string | null;
  creatorName: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

type JobRow = {
  id: string;
  piece_id: string;
  state: OmrJobState;
  error_kind: OmrErrorKind | null;
  expected: number | null;
  found: number | null;
  layout: OmrLayout;
  piano: number;
  tempo: number | null;
  run_id: string | null;
  name: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

const toView = (r: JobRow): JobView => ({
  id: r.id,
  state: r.state,
  errorKind: r.error_kind,
  expected: r.expected === null ? null : Number(r.expected),
  found: r.found === null ? null : Number(r.found),
  layout: r.layout,
  piano: Boolean(Number(r.piano)),
  tempo: r.tempo === null ? null : Number(r.tempo),
  runId: r.run_id,
  creatorName: r.name,
  createdAt: toDate(r.created_at)!,
  startedAt: toDate(r.started_at),
  finishedAt: toDate(r.finished_at),
});

const SELECT = sql`select j.*, u.name from omr_jobs j left join users u on u.id = j.created_by`;

/** The editor shows only the latest job of a piece (managers only; the caller checks). */
export async function latestJob(pieceId: string) {
  await expireStale({ pieceId });
  const [r] = await db.all<JobRow>(
    sql`${SELECT} where j.piece_id = ${pieceId} order by j.created_at desc, j.rowid desc limit 1`,
  );
  return r ? toView(r) : null;
}

export async function jobById(id: string) {
  const [r] = await db.all<JobRow>(sql`${SELECT} where j.id = ${id}`);
  return r ? { ...toView(r), pieceId: r.piece_id } : null;
}

export async function activeJob(pieceId: string) {
  await expireStale({ pieceId });
  const [r] = await db.all<{ id: string }>(
    sql`select id from omr_jobs where piece_id = ${pieceId} and state in ('queued', 'running')`,
  );
  return r?.id ?? null;
}

export type StartInput = { layout: OmrLayout; piano: boolean; tempo: number | null };

const isUnique = (e: unknown) => {
  for (let x = e; x; x = (x as { cause?: unknown }).cause) {
    if (x instanceof Error && x.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
};

/**
 * Writes the job row first (a crash leaves a queued job that times out, D100), then dispatches.
 * Limits are counted in the same write transaction as the insert, so parallel starts serialize.
 */
export async function startJob(
  actorId: string,
  pieceId: string,
  input: StartInput,
): Promise<{ error: string } | { id: string; dispatchError: string | null }> {
  await expireStale({ pieceId });
  const id = crypto.randomUUID();
  const at = now();
  const [dayStart] = istanbulDayRange(istanbulDateOf(at));
  const monthStart = secs(at) - 30 * 86_400;
  let refusal: string | null;
  try {
    refusal = await writeTx(async (tx) => {
      const [c] = await tx.all<{ score: number; active: number; mine: number; choir: number }>(sql`
        select exists (select 1 from piece_scores where piece_id = ${pieceId}) as score,
          exists (select 1 from omr_jobs where piece_id = ${pieceId} and state in ('queued', 'running')) as active,
          (select count(*) from omr_jobs where created_by = ${actorId} and created_at >= ${secs(dayStart)}
             and error_kind is not 'dispatch_auth' and error_kind is not 'dispatch_failed') as mine,
          (select count(*) from omr_jobs where created_at > ${monthStart}
             and error_kind is not 'dispatch_auth' and error_kind is not 'dispatch_failed') as choir`);
      if (!Number(c.score)) return OMR_MSG.scoreMissing;
      if (Number(c.active)) return OMR_MSG.active;
      if (Number(c.mine) >= OMR_PER_MANAGER_DAY) return OMR_MSG.managerDay;
      if (Number(c.choir) >= OMR_PER_CHOIR_30_DAYS) return OMR_MSG.choirMonth;
      await tx.run(sql`
        insert into omr_jobs (id, piece_id, state, layout, piano, tempo, created_by, created_at)
        values (${id}, ${pieceId}, 'queued', ${input.layout}, ${input.piano ? 1 : 0}, ${input.tempo},
          ${actorId}, ${secs(at)})`);
      return null;
    });
  } catch (error) {
    if (isUnique(error)) return { error: OMR_MSG.active };
    throw error;
  }
  if (refusal) return { error: refusal };
  const failed = await dispatchJob({ id, ...input });
  if (failed) {
    await writeTx((tx) =>
      tx.run(sql`
        update omr_jobs set state = 'failed', error_kind = ${failed}, finished_at = ${secs(now())}
        where id = ${id} and state = 'queued'`),
    );
  }
  console.log("omr job started", { job: id, state: failed ? "failed" : "queued", kind: failed });
  return { id, dispatchError: failed };
}
