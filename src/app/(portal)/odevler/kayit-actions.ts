"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeTx } from "@/db/write-tx";
import { assertUser } from "@/lib/auth/dal";
import { withdrawTake } from "@/lib/homework/withdraw";
import { isConductor } from "@/lib/review/access";
import { drainKeys } from "@/lib/storage/ledger";
import { MSG, SINGER_NOTE_MAX } from "@/lib/storage/messages";
import { now } from "@/lib/time";
import { optionalText, type FormState } from "@/lib/validation";

const idSchema = z.uuid();
const singerNote = optionalText(SINGER_NOTE_MAX);

/** The singer's optional note to the conductor, on their own submission until it is commented. */
export async function saveMyHomeworkNote(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: MSG.forbidden };
  const id = idSchema.safeParse(formData.get("assignmentId"));
  if (!id.success) return { error: MSG.homeworkNotFound };
  const note = singerNote.safeParse(formData.get("note") ?? undefined);
  if (!note.success) return { error: MSG.singerNoteTooLong };
  const rows = await writeTx((tx) =>
    tx.all(sql`
      update submissions set singer_note = ${note.data}
      where assignment_id = ${id.data} and user_id = ${actor.id}
        and submitted_at is not null and feedback is null
      returning 1 as ok`),
  );
  if (rows.length === 0) return { error: MSG.singerNoteRefused };
  revalidatePath(`/odevler/${id.data}`);
  return { success: note.data ? MSG.singerNoteSaved : MSG.singerNoteDeleted };
}

/** The singer's `Sil` on their own current take; the singer always comes from the session. */
export async function deleteMyRecording(assignmentId: string): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(assignmentId).success) return { error: MSG.recordingNotFound };
  const { error } = await withdrawTake(assignmentId, actor.id, { requireTake: true });
  if (error === "not_found") return { error: MSG.recordingNotFound };
  if (error) return { error: MSG.locked };
  revalidatePath("/", "layout");
  return { success: MSG.withdrawn };
}

/**
 * The conductor's `Kaydı sil` (D48): the audio goes now; the submission, the notes and the comment
 * stay, so the singer doesn't turn "Gecikti".
 */
export async function deleteRecordingAsConductor(recordingId: string): Promise<FormState> {
  const actor = await assertUser();
  if (!actor || !isConductor(actor.role)) return { error: MSG.forbidden };
  if (!idSchema.safeParse(recordingId).success) return { error: MSG.recordingNotFound };
  const rows = await writeTx((tx) =>
    tx.all<{ k: string }>(sql`
      update recordings set audio_deleted_at = ${Math.floor(now().getTime() / 1000)}, deleted_reason = 'conductor'
      where id = ${recordingId} and audio_deleted_at is null
      returning storage_key as k`),
  );
  if (rows.length === 0) return { error: MSG.recordingNotFound };
  await drainKeys(rows.map((r) => r.k));
  revalidatePath("/", "layout");
  return { success: MSG.audioDeletedByConductor };
}
