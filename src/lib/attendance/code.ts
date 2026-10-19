import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rehearsalSecrets } from "@/db/schema";
import { CODE_SCHEDULE_STEPS, CODE_STEP_SECONDS } from "./rules";

export function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / CODE_STEP_SECONDS);
}

function codeFor(secret: string, rehearsalId: string, step: number) {
  const mac = createHmac("sha256", secret).update(`${rehearsalId}:${step}`).digest();
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

/** A fresh secret on every open, so codes seen at an earlier session are worthless. */
export function newSecretRow(rehearsalId: string) {
  return { rehearsalId, secret: randomBytes(32).toString("hex"), rotatedAt: new Date() };
}

/** Accepts the current and the previous step's code. */
export async function verifyCode(rehearsalId: string, code: string) {
  const secret = await secretOf(rehearsalId);
  if (!secret) return false;
  const step = currentStep();
  return [step, step - 1].some((s) =>
    timingSafeEqual(Buffer.from(codeFor(secret, rehearsalId, s)), Buffer.from(code.padEnd(4))),
  );
}

export type CodeSchedule = { serverNow: number; firstStep: number; codes: string[] };

/** Upcoming codes for the manager's screen; the secret itself never leaves the server. */
export async function codeSchedule(rehearsalId: string): Promise<CodeSchedule | null> {
  const secret = await secretOf(rehearsalId);
  if (!secret) return null;
  const firstStep = currentStep() - 1;
  const codes = Array.from({ length: CODE_SCHEDULE_STEPS + 1 }, (_, i) =>
    codeFor(secret, rehearsalId, firstStep + i),
  );
  return { serverNow: Date.now(), firstStep, codes };
}
