"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assistantNotes } from "@/db/schema";
import { writeTx, type Tx } from "@/db/write-tx";
import { errorTag } from "@/lib/review/log";
import { assertUser } from "@/lib/auth/dal";
import { noteSlot } from "@/lib/review/notes";
import { NOTE_MAX } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { cleanText } from "@/lib/text";
import { now } from "@/lib/time";
import { formValues, type FormState } from "@/lib/validation";

const idSchema = z.uuid();

/**
 * writeTx whose failure is logged by name and code only: drizzle's error carries the query
 * params, which hold the note text (backend §14). A failure answers MSG.generic.
 */
async function safeTx(op: string, fn: (tx: Tx) => Promise<string | null>) {
  try {
    return await writeTx(fn);
  } catch (error) {
    console.error(`${op} failed`, errorTag(error));
    return MSG.generic;
  }
}
const noteField = z
  .string()
  .overwrite((v) => cleanText(v).replace(/\r\n?/g, "\n"))
  .trim()
  .min(1, MSG.noteEmpty)
  .max(NOTE_MAX, MSG.noteTooLong);

/**
 * An assistant's private note (D10), one per (homework, singer, assistant). The form carries the
 * take that was on screen; a replaced take refuses the save (D49). Locked once the conductor has
 * commented. Anyone not assisting this singer gets FORBIDDEN, the same for every reason (AC 30).
 */
export async function saveAssistantNote(
  assignmentId: string,
  singerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(assignmentId).success || !idSchema.safeParse(singerId).success) {
    return { error: MSG.forbidden };
  }
  if (!(await noteSlot(db, actor, assignmentId, singerId)).allowed) return { error: MSG.forbidden };
  const parsed = z
    .object({ note: noteField, recordingId: z.uuid() })
    .safeParse({ note: formData.get("note") ?? "", recordingId: formData.get("recordingId") });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      values: formValues(formData),
      ...(issue?.path[0] === "note"
        ? { fieldErrors: { note: [issue.message] } }
        : { error: MSG.staleForNote }),
    };
  }
  const { note, recordingId } = parsed.data;

  const outcome = await safeTx("note save", async (tx) => {
    const slot = await noteSlot(tx, actor, assignmentId, singerId);
    if (!slot.allowed) return MSG.forbidden;
    if (slot.commented) return MSG.noteLocked;
    if (slot.currentId !== recordingId || slot.audioGone) return MSG.staleForNote;
    const [mine] = await tx
      .select({ body: assistantNotes.body, recordingId: assistantNotes.recordingId })
      .from(assistantNotes)
      .where(
        and(
          eq(assistantNotes.assignmentId, assignmentId),
          eq(assistantNotes.singerId, singerId),
          eq(assistantNotes.assistantId, actor.id),
        ),
      );
    if (mine?.body === note && mine.recordingId === recordingId) return null;
    const at = now();
    await tx
      .insert(assistantNotes)
      .values({
        assignmentId,
        singerId,
        assistantId: actor.id,
        recordingId,
        body: note,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [assistantNotes.assignmentId, assistantNotes.singerId, assistantNotes.assistantId],
        set: { body: note, recordingId, updatedAt: at },
      });
    return null;
  });
  if (outcome) return { error: outcome, values: formValues(formData) };
  revalidatePath("/", "layout");
  return { success: MSG.noteSaved };
}

/** Deletes the assistant's own note only; locked after the conductor's comment. */
export async function deleteAssistantNote(
  assignmentId: string,
  singerId: string,
): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(assignmentId).success || !idSchema.safeParse(singerId).success) {
    return { error: MSG.forbidden };
  }
  const outcome = await safeTx("note delete", async (tx) => {
    const slot = await noteSlot(tx, actor, assignmentId, singerId);
    if (!slot.allowed) return MSG.forbidden;
    if (slot.commented) return MSG.noteLocked;
    await tx
      .delete(assistantNotes)
      .where(
        and(
          eq(assistantNotes.assignmentId, assignmentId),
          eq(assistantNotes.singerId, singerId),
          eq(assistantNotes.assistantId, actor.id),
        ),
      );
    return null;
  });
  if (outcome) return { error: outcome };
  revalidatePath("/", "layout");
  return { success: MSG.noteDeleted };
}
