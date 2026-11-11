import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { calendarFeeds, users } from "@/db/schema";

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function feedTokenOf(userId: string) {
  const [row] = await db
    .select({ token: calendarFeeds.token })
    .from(calendarFeeds)
    .where(eq(calendarFeeds.userId, userId))
    .limit(1);
  return row?.token ?? null;
}

/** Creates the user's feed secret, or replaces it so the old link stops working. */
export async function rotateFeedToken(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db
    .insert(calendarFeeds)
    .values({ userId, token })
    .onConflictDoUpdate({ target: calendarFeeds.userId, set: { token, createdAt: new Date() } });
  return token;
}

/** The active member a feed link belongs to; left members' links stop answering. */
export async function feedOwner(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      voicePart: users.voicePart,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
      name: users.name,
    })
    .from(calendarFeeds)
    .innerJoin(users, eq(users.id, calendarFeeds.userId))
    .where(and(eq(calendarFeeds.token, token), eq(users.isActive, true), isNull(users.leftAt)))
    .limit(1);
  return row ?? null;
}

export function feedUrl(token: string) {
  const origin = process.env.APP_URL ?? "http://127.0.0.1:3100";
  return new URL(`/api/takvim/${token}.ics`, origin).toString();
}
