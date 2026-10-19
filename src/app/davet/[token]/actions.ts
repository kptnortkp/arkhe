"use server";

import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession, deleteUserSessions } from "@/lib/auth/session";
import { findValidLink } from "@/lib/auth/set-password-links";
import { hashToken } from "@/lib/auth/tokens";

const INVALID_LINK = "Bu link geçersiz ya da süresi dolmuş. Yönetimden yeni link iste.";
import { fieldErrorsOf, newPasswordSchema, type FormState } from "@/lib/validation";

export async function setPassword(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);

  // Cheap token check first so the expensive hash can't be triggered anonymously.
  if (!(await findValidLink(token))) return { error: INVALID_LINK };
  const passwordHash = await hashPassword(parsed.data.password);

  // Claim the token atomically so a link can't be used twice in parallel.
  const userId = await db
    .transaction(async (tx) => {
      const [claimed] = await tx
        .update(invites)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(invites.tokenHash, hashToken(token)),
            isNull(invites.usedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .returning({ userId: invites.userId });
      if (!claimed) return null;

      const [user] = await tx
        .update(users)
        .set({ passwordHash })
        .where(and(eq(users.id, claimed.userId), eq(users.isActive, true)))
        .returning({ id: users.id });
      if (!user) tx.rollback();
      return user.id;
    })
    .catch(() => null);

  if (!userId) {
    return { error: INVALID_LINK };
  }

  await deleteUserSessions(userId);
  await createSession(userId);
  redirect("/");
}
