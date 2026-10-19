import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { generateToken, hashToken } from "./tokens";

type Purpose = (typeof invites.$inferSelect)["purpose"];

const LIFETIME_HOURS: Record<Purpose, number> = { invite: 24 * 7, reset: 24 };

export function appUrl(path: string) {
  return new URL(path, process.env.APP_URL ?? "http://127.0.0.1:3100").toString();
}

/** Creates a fresh single-use link and revokes any earlier unused one for the user. */
export async function createSetPasswordLink(userId: string, purpose: Purpose) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + LIFETIME_HOURS[purpose] * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usedAt)));
    await tx.insert(invites).values({ tokenHash: hashToken(token), userId, purpose, expiresAt });
  });
  return { url: appUrl(`/davet/${token}`), expiresAt };
}

export async function findValidLink(token: string) {
  const [row] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.usedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}
