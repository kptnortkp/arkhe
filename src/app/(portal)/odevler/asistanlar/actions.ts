"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listeningAssistants, VOICE_PARTS, type VoicePart } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { assertUser } from "@/lib/auth/dal";
import { canManageAssistants } from "@/lib/review/access";
import { MSG } from "@/lib/storage/messages";
import { now } from "@/lib/time";
import type { FormState } from "@/lib/validation";

const idSchema = z.uuid();

/** `scope=all` means every part; otherwise at least one of the `parts` checkboxes. */
function scopeOf(formData: FormData): VoicePart[] | null {
  if (formData.get("scope") === "all") return [...VOICE_PARTS];
  const picked = new Set(formData.getAll("parts").map(String));
  const parts = VOICE_PARTS.filter((p) => picked.has(p));
  return parts.length ? parts : null;
}

async function conductor() {
  const actor = await assertUser();
  return actor && canManageAssistants(actor.role) ? actor : null;
}

function refresh() {
  revalidatePath("/", "layout");
}

/** D9: the conductor appoints an active member or board user, optionally per part. */
export async function addAssistant(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await conductor();
  if (!actor) return { error: MSG.forbidden };
  const userId = idSchema.safeParse(formData.get("userId"));
  if (!userId.success) return { error: MSG.assistantNotAllowed };
  const parts = scopeOf(formData);
  if (!parts) return { fieldErrors: { parts: [MSG.pickPart] } };
  const outcome = await writeTx(async (tx) => {
    const [target] = await tx.all<{ ok: number; appointed: number }>(sql`
      select is_active = 1 and role in ('member', 'board') as ok,
        exists (select 1 from listening_assistants where user_id = users.id) as appointed
      from users where id = ${userId.data}`);
    if (!target?.ok || userId.data === actor.id) return MSG.assistantNotAllowed;
    if (target.appointed) return MSG.assistantExists;
    const at = now();
    await tx
      .insert(listeningAssistants)
      .values(
        parts.map((voicePart) => ({
          userId: userId.data,
          voicePart,
          createdBy: actor.id,
          createdAt: at,
        })),
      );
    return null;
  });
  if (outcome) return { error: outcome };
  refresh();
  return { success: MSG.assistantAdded };
}

export async function updateAssistant(
  userId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await conductor();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(userId).success) return { error: MSG.assistantNotFound };
  const parts = scopeOf(formData);
  if (!parts) return { fieldErrors: { parts: [MSG.pickPart] } };
  const outcome = await writeTx(async (tx) => {
    const existing = await tx
      .select({ part: listeningAssistants.voicePart, at: listeningAssistants.createdAt })
      .from(listeningAssistants)
      .where(eq(listeningAssistants.userId, userId));
    if (existing.length === 0) return MSG.assistantNotFound;
    // Keep the original appointment time on parts that stay.
    const since = new Map(existing.map((r) => [r.part, r.at]));
    await tx.delete(listeningAssistants).where(eq(listeningAssistants.userId, userId));
    const at = now();
    await tx.insert(listeningAssistants).values(
      parts.map((voicePart) => ({
        userId,
        voicePart,
        createdBy: actor.id,
        createdAt: since.get(voicePart) ?? at,
      })),
    );
    return null;
  });
  if (outcome) return { error: outcome };
  refresh();
  return { success: MSG.assistantUpdated };
}

/** Access ends at once (every request re-reads the scope); the notes stay with the conductor. */
export async function removeAssistant(userId: string): Promise<FormState> {
  const actor = await conductor();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(userId).success) return { error: MSG.assistantNotFound };
  const removed = await writeTx((tx) =>
    tx
      .delete(listeningAssistants)
      .where(eq(listeningAssistants.userId, userId))
      .returning({ u: listeningAssistants.userId }),
  );
  if (removed.length === 0) return { error: MSG.assistantNotFound };
  refresh();
  return { success: MSG.assistantRemoved };
}
