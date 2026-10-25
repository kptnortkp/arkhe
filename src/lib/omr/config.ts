// Pure env checks (no server-only) so src/lib/env.ts can reuse them for boot warnings.
import { isLocalDb } from "../storage/root.mjs";

type Env = Record<string, string | undefined>;

export const OMR_VARS = [
  "GITHUB_OMR_TOKEN",
  "GITHUB_OMR_REPO",
  "GITHUB_OMR_WORKFLOW",
  "GITHUB_OMR_REF",
  "OMR_CALLBACK_SECRET",
] as const;

/** Dev and e2e only (also in .env.development); production refuses it. */
export const DEV_OMR_SECRET = "dev-only-omr-callback-secret";

/**
 * github: production with every variable; outbox: dev/e2e on a local DB (a file per dispatch, no
 * network); off: "kurulmadı" (production without setup, or dev against a remote DB).
 */
export type OmrMode =
  | { mode: "github"; token: string; repo: string; workflow: string; ref: string; secret: string }
  | { mode: "outbox"; ref: string; secret: string }
  | { mode: "off" };

function problem(env: Env): string | null {
  const missing = OMR_VARS.filter((k) => !env[k]?.trim());
  if (missing.length) return `set ${missing.join(", ")}`;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(env.GITHUB_OMR_REPO!.trim())) return "GITHUB_OMR_REPO is malformed";
  if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(env.GITHUB_OMR_WORKFLOW!.trim())) return "GITHUB_OMR_WORKFLOW is malformed";
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(env.GITHUB_OMR_REF!.trim())) return "GITHUB_OMR_REF is malformed";
  const secret = env.OMR_CALLBACK_SECRET!.trim();
  if (secret.length < 32 || secret === DEV_OMR_SECRET) return "OMR_CALLBACK_SECRET is too short";
  return null;
}

/** For bootWarnings: names only, never values. */
export function omrWarning(env: Env) {
  if (env.NODE_ENV !== "production") return null;
  const p = problem(env);
  return p ? `Automatic MIDI (OMR) is not configured: ${p}.` : null;
}

export function omrMode(env: Env = process.env): OmrMode {
  if (env.NODE_ENV !== "production") {
    if (!isLocalDb(env)) return { mode: "off" };
    return {
      mode: "outbox",
      ref: env.GITHUB_OMR_REF?.trim() || "main",
      secret: env.OMR_CALLBACK_SECRET?.trim() || DEV_OMR_SECRET,
    };
  }
  if (problem(env)) return { mode: "off" };
  return {
    mode: "github",
    token: env.GITHUB_OMR_TOKEN!.trim(),
    repo: env.GITHUB_OMR_REPO!.trim(),
    workflow: env.GITHUB_OMR_WORKFLOW!.trim(),
    ref: env.GITHUB_OMR_REF!.trim(),
    secret: env.OMR_CALLBACK_SECRET!.trim(),
  };
}

export function omrConfigured(env: Env = process.env) {
  return omrMode(env).mode !== "off";
}

/** The run link is built here, never taken from a request (AC 12). */
export function runUrl(runId: string, env: Env = process.env) {
  const repo = env.GITHUB_OMR_REPO?.trim() || "kptnortkp/arkhe";
  return `https://github.com/${repo}/actions/runs/${runId}`;
}
