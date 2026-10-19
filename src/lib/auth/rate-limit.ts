import "server-only";
import { and, count, eq, gt, inArray, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

const WINDOW_MS = 15 * 60 * 1000;
// Per email+IP: stops guessing one account from one place.
const MAX_PER_EMAIL_IP = 5;
// Per email from anywhere: high enough that a stranger can't easily lock the conductor out.
const MAX_PER_EMAIL = 30;
const MAX_PER_IP = 30;

/** Client IP, trusting proxy headers only when the deployment sets TRUST_PROXY_HEADERS=1. */
export async function clientIp() {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return null;
  const h = await headers();
  const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  // A malformed value falls back to the per-email buckets and keeps the key length bounded.
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/**
 * Records the attempt first and then counts, so parallel requests can't all slip under the limit.
 * Returns the ids to delete if the attempt turns out to be a successful login.
 */
export async function registerLoginAttempt(email: string) {
  const ip = await clientIp();
  // Without a trustworthy IP there are no per-IP or email+IP buckets: a bucket shared by the whole
  // internet would let anyone lock an account's logins after a handful of guesses. Per-email applies.
  const keys: { pair?: string; email: string; ip?: string } = ip
    ? { pair: `${email}|${ip}`, email: `email:${email}`, ip: `ip:${ip}` }
    : { email: `email:${email}` };
  const since = new Date(Date.now() - WINDOW_MS);

  const inserted = await db
    .insert(loginAttempts)
    .values(Object.values(keys).map((key) => ({ key: key as string })))
    .returning({ id: loginAttempts.id });

  const counts = await db
    .select({ key: loginAttempts.key, n: count() })
    .from(loginAttempts)
    .where(
      and(
        inArray(loginAttempts.key, Object.values(keys) as string[]),
        gt(loginAttempts.attemptedAt, since),
      ),
    )
    .groupBy(loginAttempts.key);
  const n = Object.fromEntries(counts.map((c) => [c.key, c.n]));

  const blocked =
    (keys.pair !== undefined && (n[keys.pair] ?? 0) > MAX_PER_EMAIL_IP) ||
    (n[keys.email] ?? 0) > MAX_PER_EMAIL ||
    (keys.ip !== undefined && (n[keys.ip] ?? 0) > MAX_PER_IP);
  return { blocked, attemptIds: inserted.map((r) => r.id), pairKey: keys.pair ?? null };
}

/** A successful login forgets this attempt and earlier failures from the same email+IP. */
export async function forgetLoginAttempts(attemptIds: number[], pairKey: string | null) {
  await db.delete(loginAttempts).where(inArray(loginAttempts.id, attemptIds));
  if (pairKey) await db.delete(loginAttempts).where(eq(loginAttempts.key, pairKey));
  // 24 h, not the login window: the daily check-in cap shares this table.
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, new Date(Date.now() - 24 * 3600_000)));
}

/** Generic insert-then-count throttle. Returns the attempt id so a success can be forgotten. */
export async function consumeAttempt(key: string, max: number, windowMs: number) {
  const [row] = await db.insert(loginAttempts).values({ key }).returning({ id: loginAttempts.id });
  const [{ n }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.key, key),
        gt(loginAttempts.attemptedAt, new Date(Date.now() - windowMs)),
      ),
    );
  return { blocked: n > max, attemptId: row.id };
}

export async function forgetAttempt(attemptId: number) {
  await db.delete(loginAttempts).where(eq(loginAttempts.id, attemptId));
}
