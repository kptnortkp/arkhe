// Pure checks of the production environment; no server-only import so scripts can reuse it.
import { missingBackupVars } from "./backup/config";
type Env = Record<string, string | undefined>;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const REMOTE_DB = ["libsql:", "https:", "wss:"];

function appUrlProblems(raw: string | undefined): string[] {
  if (!raw) return ["APP_URL is required (e.g. https://arkhe.example.org)."];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return ["APP_URL must be an https:// URL."];
  }
  const problems: string[] = [];
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    problems.push(`APP_URL must be an https:// URL (got "${url.protocol}//${url.host}").`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    problems.push("APP_URL must be an origin only, without path, query or credentials.");
  }
  return problems;
}

function databaseProblems(env: Env): string[] {
  const raw = env.DATABASE_URL;
  if (!raw) return ["DATABASE_URL is required in production."];
  const scheme = /^[a-z]+:/i.exec(raw)?.[0].toLowerCase() ?? "";
  if (scheme === "file:") {
    if (env.VERCEL)
      return ["DATABASE_URL cannot be a file: database on Vercel (read-only filesystem)."];
    if (env.RENDER) return ["DATABASE_URL cannot be a file: database on Render (ephemeral disk)."];
    return [];
  }
  if (!REMOTE_DB.includes(scheme)) {
    return ["DATABASE_URL must start with file:, libsql:, https: or wss:."];
  }
  return env.DATABASE_AUTH_TOKEN
    ? []
    : ["DATABASE_AUTH_TOKEN is required for a remote DATABASE_URL."];
}

/** Every problem with a production environment, so a deployer can fix them in one round. */
export function envProblems(env: Env): string[] {
  const problems = [...appUrlProblems(env.APP_URL), ...databaseProblems(env)];
  const trust = env.TRUST_PROXY_HEADERS;
  if (trust !== undefined && trust !== "" && trust !== "1") {
    problems.push('TRUST_PROXY_HEADERS must be "1" or unset.');
  }
  return problems;
}

export function bootWarnings(env: Env): string[] {
  const warnings =
    env.TRUST_PROXY_HEADERS === "1"
      ? []
      : ["TRUST_PROXY_HEADERS is not set; per-IP login limits are off."];
  // Names only, never values; a missing backup setting never stops the server.
  const backup = missingBackupVars(env);
  if (backup.length) {
    warnings.push(`Monthly backup email is not fully configured: ${backup.join(", ")}`);
  }
  return warnings;
}
