import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { isRefusedDemoEmail, SESSION_COOKIE, secureCookies } from "./cookie-names";
import { generateToken, hashToken } from "./tokens";

const SESSION_DAYS = 90;

export async function createSession(userId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  try {
    if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  } finally {
    // Same attributes as when set: browsers ignore a "__Host-" deletion without Secure.
    store.delete({
      name: SESSION_COOKIE,
      path: "/",
      secure: secureCookies,
      httpOnly: true,
      sameSite: "lax",
    });
  }
}

export async function deleteUserSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export const getSessionUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      voicePart: users.voicePart,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  if (!row || isRefusedDemoEmail(row.email)) return null;
  return row;
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
