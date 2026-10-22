"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { pushSubscriptions, sessions, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, currentSessionId } from "@/lib/auth/session";
import {
  fieldErrorsOf,
  nameSchema,
  newPasswordSchema,
  phoneSchema,
  type FormState,
} from "@/lib/validation";

const profileSchema = z.object({ name: nameSchema, phone: phoneSchema });

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);

  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { success: "Bilgilerin güncellendi." };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);

  const [row] = await db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.hash || !(await verifyPassword(current, row.hash))) {
    return { fieldErrors: { current: ["Mevcut şifre hatalı."] } };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password) })
    .where(eq(users.id, user.id));
  // Sign out every other device, keep this one, and keep this browser's push subscription with it.
  const oldId = await currentSessionId();
  const newId = await createSession(user.id);
  if (oldId) {
    await db
      .update(pushSubscriptions)
      .set({ sessionId: newId })
      .where(eq(pushSubscriptions.sessionId, oldId));
  }
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, newId)));
  return {
    success: "Şifren değişti. Diğer cihazlardaki oturumların kapatıldı.",
  };
}
