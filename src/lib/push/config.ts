// Pure env checks (no server-only) so src/lib/env.ts can reuse them for boot warnings.
import { isLocalDb } from "../storage/root.mjs";

type Env = Record<string, string | undefined>;

// Dev and e2e only; production never falls back to these (D90).
const DEV_KEYS = {
  publicKey:
    "BMaBUcc5jpsjkuko7rkPBlwzeyQAqvYwU7iIIRuXvl0ZpN53ECN9e3iBqtMscVeD8YsLxSXHgWf-Rd7UPc4eSPs",
  privateKey: "kD3wl2P5oLXJi6qdXUk9VkqK1gTjNPRoOnG7Kz_3FBM",
  subject: "mailto:dev@arkhe.local",
};

export const VAPID_VARS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

export type Vapid = { publicKey: string; privateKey: string; subject: string };
/**
 * real: production with keys; off: production without keys (rows are dropped); outbox: dev/e2e on a
 * local DB; inert: dev against a remote DB, which must never claim or "send" production rows.
 */
export type PushMode =
  | { mode: "real"; vapid: Vapid }
  | { mode: "outbox"; vapid: Vapid }
  | { mode: "off" }
  | { mode: "inert" };

function isProduction(env: Env) {
  return env.NODE_ENV === "production";
}

export function missingVapidVars(env: Env) {
  return VAPID_VARS.filter((k) => !env[k]?.trim());
}

function vapidProblem(env: Env) {
  if (!/^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY ?? "")) return "VAPID_PUBLIC_KEY";
  if (!/^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY ?? "")) return "VAPID_PRIVATE_KEY";
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(env.VAPID_SUBJECT ?? "")) return "VAPID_SUBJECT";
  return null;
}

/** For bootWarnings: names only, never values. */
export function pushWarning(env: Env) {
  const missing = missingVapidVars(env);
  if (missing.length) return `Web Push is off: set ${missing.join(", ")}.`;
  const bad = vapidProblem(env);
  return bad ? `Web Push is off: ${bad} is malformed.` : null;
}

export function pushMode(env: Env = process.env): PushMode {
  if (!isProduction(env)) return isLocalDb(env) ? { mode: "outbox", vapid: DEV_KEYS } : { mode: "inert" };
  if (missingVapidVars(env).length || vapidProblem(env)) return { mode: "off" };
  return {
    mode: "real",
    vapid: {
      publicKey: env.VAPID_PUBLIC_KEY!.trim(),
      privateKey: env.VAPID_PRIVATE_KEY!.trim(),
      subject: env.VAPID_SUBJECT!.trim(),
    },
  };
}

/** Test hooks run only outside production and against a local file database (the 8b rule). */
export function pushHooksEnabled(env: Env = process.env) {
  return !isProduction(env) && isLocalDb(env);
}
