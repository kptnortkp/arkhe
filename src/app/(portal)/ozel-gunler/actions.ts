"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { specialDays } from "@/db/schema";
import { assertManager } from "@/lib/auth/dal";
import { SPECIAL_DAY_NOT_FOUND, specialDaySchema } from "@/lib/festivals/schemas";
import { FORBIDDEN } from "@/lib/finance/schemas";
import { setFlash } from "@/lib/flash";
import { fieldErrorsOf, type FormState } from "@/lib/validation";

const s = specialDays;
const back = (day: string) => `/ozel-gunler?yil=${day.slice(0, 4)}`;

function revalidate() {
  revalidatePath("/ozel-gunler");
  revalidatePath("/yonetim/takvim");
}

export async function createSpecialDay(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: SPECIAL_DAY_NOT_FOUND };
  const parsed = specialDaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  await db
    .insert(s)
    .values({ id: id.data, ...parsed.data, createdBy: actor.id })
    .onConflictDoNothing({ target: s.id });
  revalidate();
  await setFlash("ozel-gun-eklendi");
  redirect(back(parsed.data.day));
}

export async function updateSpecialDay(
  rawId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: SPECIAL_DAY_NOT_FOUND };
  const parsed = specialDaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const hit = await db
    .update(s)
    .set({ ...parsed.data, updatedAt: sql`(unixepoch())` })
    .where(eq(s.id, id.data))
    .returning({ id: s.id });
  if (!hit.length) return { error: SPECIAL_DAY_NOT_FOUND };
  revalidate();
  await setFlash("kaydedildi");
  redirect(back(parsed.data.day));
}

export async function deleteSpecialDay(rawId: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: SPECIAL_DAY_NOT_FOUND };
  const gone = await db.delete(s).where(eq(s.id, id.data)).returning({ day: s.day });
  if (!gone.length) return { error: SPECIAL_DAY_NOT_FOUND };
  revalidate();
  await setFlash("ozel-gun-silindi");
  redirect(back(gone[0].day));
}
