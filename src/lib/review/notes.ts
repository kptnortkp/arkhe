import "server-only";
import { sql } from "drizzle-orm";
import { VOICE_PARTS, type VoicePart } from "@/db/schema";
import type { Q } from "@/db/write-tx";
import { assistsFor, type Viewer } from "./access";

/**
 * Whether `viewer` may write a note on (homework, singer) right now, read through `q` so callers
 * can repeat it inside their transaction. The scope is re-read every time: a removed assistant
 * loses access on the next request (D9).
 */
export async function noteSlot(q: Q, viewer: Viewer, assignmentId: string, singerId: string) {
  const scopeRows = await q.all<{ p: VoicePart }>(sql`
    select la.voice_part as p from listening_assistants la join users a on a.id = la.user_id
    where la.user_id = ${viewer.id} and a.is_active = 1 and a.role in ('member', 'board')`);
  const scope = VOICE_PARTS.filter((p) => scopeRows.some((r) => r.p === p));
  const [singer] = await q.all<{ part: VoicePart | null }>(sql`
    select voice_part as part from users where id = ${singerId}`);
  if (!singer || !assistsFor(viewer, scope, { id: singerId, voicePart: singer.part })) {
    return { allowed: false as const };
  }
  const [take] = await q.all<{ id: string; gone: number }>(sql`
    select id, audio_deleted_at is not null as gone from recordings
    where assignment_id = ${assignmentId} and user_id = ${singerId} and replaced_at is null`);
  const [sub] = await q.all<{ submitted: number; commented: number }>(sql`
    select submitted_at is not null as submitted, feedback is not null as commented from submissions
    where assignment_id = ${assignmentId} and user_id = ${singerId}`);
  // Assistants only ever review a live take that is a submission (never "Portalda kayıt yok").
  if (!take || !sub?.submitted) return { allowed: false as const };
  return {
    allowed: true as const,
    currentId: take.id,
    audioGone: Boolean(take.gone),
    commented: Boolean(sub.commented),
  };
}
