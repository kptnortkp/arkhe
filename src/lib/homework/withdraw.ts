import "server-only";
import { sql } from "drizzle-orm";
import { writeTx } from "@/db/write-tx";
import { drainKeys } from "@/lib/storage/ledger";
import { now } from "@/lib/time";

export type WithdrawError = "locked" | "locked_take" | "not_found";

/**
 * The singer's `Sil`, and the fallback `Geri al` (D47): the current take leaves the slot and its
 * audio goes; a self submission goes with it, a manager's manual mark stays. Without a take,
 * `Geri al` is Phase 4's undo. Any feedback locks both (D8, D46).
 */
export async function withdrawTake(
  assignmentId: string,
  userId: string,
  opts: { requireTake: boolean },
): Promise<{ error?: WithdrawError }> {
  const result = await writeTx(async (tx) => {
    const [take] = await tx.all<{ id: string; k: string; gone: number }>(sql`
      select id, storage_key as k, audio_deleted_at is not null as gone from recordings
      where assignment_id = ${assignmentId} and user_id = ${userId} and replaced_at is null`);
    const [sub] = await tx.all<{ submitted: number; feedback: number }>(sql`
      select submitted_at is not null as submitted, feedback is not null as feedback from submissions
      where assignment_id = ${assignmentId} and user_id = ${userId}`);
    if (opts.requireTake && (!take || take.gone)) return { error: "not_found" as const };
    if (sub?.feedback && take) return { error: "locked_take" as const };
    if (sub?.feedback && sub.submitted) return { error: "locked" as const };
    const at = Math.floor(now().getTime() / 1000);
    if (take) {
      await tx.run(sql`
        update recordings set replaced_at = ${at},
          audio_deleted_at = coalesce(audio_deleted_at, ${at}),
          deleted_reason = coalesce(deleted_reason, 'withdrawn')
        where id = ${take.id}`);
    }
    await tx.run(sql`
      delete from submissions
      where assignment_id = ${assignmentId} and user_id = ${userId}
        and feedback is null and submitted_at is not null
        and (${take ? 1 : 0} = 0 or method = 'self')`);
    return { key: take && !take.gone ? take.k : null };
  });
  if ("error" in result) return { error: result.error };
  if (result.key) await drainKeys([result.key]);
  return {};
}
