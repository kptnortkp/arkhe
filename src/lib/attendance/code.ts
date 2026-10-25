import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rehearsalSecrets } from "@/db/schema";

function codeFor(secret: string, rehearsalId: string) {
  const mac = createHmac("sha256", secret).update(rehearsalId).digest();
  return String(mac.readUInt32BE(0) % 10_000).padStart(4, "0");
}

async function secretOf(rehearsalId: string) {
  const [row] = await db
    .select({ secret: rehearsalSecrets.secret })
    .from(rehearsalSecrets)
    .where(eq(rehearsalSecrets.rehearsalId, rehearsalId))
    .limit(1);
  return row?.secret ?? null;
}

/** A fresh secret on every open: the code stays the same while attendance is open, never across opens. */
export function newSecretRow(rehearsalId: string) {
  return { rehearsalId, secret: randomBytes(32).toString("hex"), rotatedAt: new Date() };
}

export async function verifyCode(rehearsalId: string, code: string) {
  const secret = await secretOf(rehearsalId);
  if (!secret) return false;
  return timingSafeEqual(Buffer.from(codeFor(secret, rehearsalId)), Buffer.from(code.padEnd(4)));
}

/** For the manager's live screen; the secret itself never leaves the server. */
export async function sessionCode(rehearsalId: string) {
  const secret = await secretOf(rehearsalId);
  return secret ? codeFor(secret, rehearsalId) : null;
}
