"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeTx } from "@/db/write-tx";
import { assertUser } from "@/lib/auth/dal";
import { withdrawTake } from "@/lib/homework/withdraw";
import { isConductor } from "@/lib/review/access";
import { drainKeys } from "@/lib/storage/ledger";
import { MSG } from "@/lib/storage/messages";
import { now } from "@/lib/time";
import type { FormState } from "@/lib/validation";

const idSchema = z.uuid();

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
