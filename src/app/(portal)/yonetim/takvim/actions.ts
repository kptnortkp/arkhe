"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { calendarEvents } from "@/db/schema";
import { assertManager } from "@/lib/auth/dal";
import { calendarEventSchema, EVENT_NOT_FOUND } from "@/lib/board/calendar";
import { FORBIDDEN } from "@/lib/finance/schemas";
import { setFlash } from "@/lib/flash";
import { fieldErrorsOf, type FormState } from "@/lib/validation";

const e = calendarEvents;
const back = (day: string) => `/yonetim/takvim?ay=${day.slice(0, 7)}&gun=${day}`;

/** The form's per-mount uuid is the event id, so a double submit lands on the same row. */
export async function createCalendarEvent(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: EVENT_NOT_FOUND };
  const parsed = calendarEventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  await db
    .insert(e)
    .values({ id: id.data, ...d, createdBy: actor.id })
    .onConflictDoNothing({ target: e.id });
  revalidatePath("/yonetim/takvim");
  await setFlash("etkinlik-eklendi");
  redirect(back(d.day));
}

export async function updateCalendarEvent(
  rawId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: EVENT_NOT_FOUND };
  const parsed = calendarEventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const hit = await db
    .update(e)
    .set({ ...d, updatedAt: sql`(unixepoch())` })
    .where(eq(e.id, id.data))
    .returning({ id: e.id });
  if (!hit.length) return { error: EVENT_NOT_FOUND };
  revalidatePath("/yonetim/takvim");
  await setFlash("kaydedildi");
  redirect(back(d.day));
}

export async function deleteCalendarEvent(rawId: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: EVENT_NOT_FOUND };
  const gone = await db.delete(e).where(eq(e.id, id.data)).returning({ day: e.day });
  if (!gone.length) return { error: EVENT_NOT_FOUND };
  revalidatePath("/yonetim/takvim");
  await setFlash("etkinlik-silindi");
  redirect(back(gone[0].day));
}
