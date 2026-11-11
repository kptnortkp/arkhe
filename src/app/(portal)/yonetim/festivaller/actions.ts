"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { festivals } from "@/db/schema";
import { assertManager } from "@/lib/auth/dal";
import { FESTIVAL_NOT_FOUND, festivalSchema } from "@/lib/festivals/schemas";
import { FORBIDDEN } from "@/lib/finance/schemas";
import { setFlash } from "@/lib/flash";
import { fieldErrorsOf, type FormState } from "@/lib/validation";

const f = festivals;

function revalidate() {
  revalidatePath("/yonetim/festivaller");
  revalidatePath("/yonetim/takvim");
  revalidatePath("/");
}

/** The form's per-mount uuid is the festival id, so a double submit lands on the same row. */
export async function createFestival(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: FESTIVAL_NOT_FOUND };
  const parsed = festivalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  await db
    .insert(f)
    .values({ id: id.data, ...parsed.data, createdBy: actor.id })
    .onConflictDoNothing({ target: f.id });
  revalidate();
  await setFlash("festival-eklendi");
  redirect("/yonetim/festivaller");
}

export async function updateFestival(
  rawId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: FESTIVAL_NOT_FOUND };
  const parsed = festivalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const hit = await db
    .update(f)
    .set({ ...parsed.data, updatedAt: sql`(unixepoch())` })
    .where(eq(f.id, id.data))
    .returning({ id: f.id });
  if (!hit.length) return { error: FESTIVAL_NOT_FOUND };
  revalidate();
  await setFlash("kaydedildi");
  redirect("/yonetim/festivaller");
}

export async function deleteFestival(rawId: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: FESTIVAL_NOT_FOUND };
  const gone = await db.delete(f).where(eq(f.id, id.data)).returning({ id: f.id });
  if (!gone.length) return { error: FESTIVAL_NOT_FOUND };
  revalidate();
  await setFlash("festival-silindi");
  redirect("/yonetim/festivaller");
}
