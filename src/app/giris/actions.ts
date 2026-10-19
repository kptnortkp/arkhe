"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { isRefusedDemoEmail } from "@/lib/auth/cookie-names";
import { forgetLoginAttempts, registerLoginAttempt } from "@/lib/auth/rate-limit";
import { createSession } from "@/lib/auth/session";
import type { FormState } from "@/lib/validation";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(128),
  next: z.string().optional(),
});

const INVALID = "E-posta ya da şifre hatalı.";

function safeNext(next: string | undefined) {
  if (!next) return "/";
  // Let the URL parser normalise tricks like "/\t/evil.com", then insist on our own origin.
  const base = "http://arkhe.invalid";
  try {
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !parsed.data.email || !parsed.data.password) {
    return { error: INVALID, values: { email: String(formData.get("email") ?? "") } };
  }
  const { email, password, next } = parsed.data;

  const attempt = await registerLoginAttempt(email);
  if (attempt.blocked) {
    return {
      error: "Çok fazla hatalı deneme yapıldı. 15 dakika sonra tekrar dene.",
      values: { email },
    };
  }

  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  // Folded into the generic failure so timing and attempt counting stay the same.
  if (!user || !user.passwordHash || !user.isActive || !ok || isRefusedDemoEmail(email)) {
    return { error: INVALID, values: { email } };
  }

  await forgetLoginAttempts(attempt.attemptIds, attempt.pairKey);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await createSession(user.id);
  redirect(safeNext(next));
}
