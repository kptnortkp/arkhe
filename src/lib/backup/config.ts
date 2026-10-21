// Pure: reads only the env object it is given, so scripts and tests can reuse it.
import { DEV_CRON_SECRET, DEV_PASSPHRASE, MIN_CRON_SECRET_PROD, MIN_PASSPHRASE } from "./constants";

type Env = Record<string, string | undefined>;

const isProd = (env: Env) => env.NODE_ENV === "production";

/** Null when unset, or in production when shorter than 32 characters or the dev value. */
export function cronSecret(env: Env): string | null {
  const v = env.CRON_SECRET ?? "";
  if (!v) return null;
  if (isProd(env) && (v.length < MIN_CRON_SECRET_PROD || v === DEV_CRON_SECRET)) return null;
  return v;
}

export function normalizePassphrase(raw: string) {
  return raw.trim().normalize("NFC");
}

export type PassphraseState = "ok" | "missing" | "invalid";

export function passphraseState(env: Env): PassphraseState {
  const raw = env.BACKUP_PASSPHRASE ?? "";
  if (!raw.trim()) return "missing";
  const v = normalizePassphrase(raw);
  if (v.length < MIN_PASSPHRASE || (isProd(env) && v === DEV_PASSPHRASE)) return "invalid";
  return "ok";
}

/** Trimmed, NFC-normalised passphrase, or null when unusable. */
export function backupPassphrase(env: Env): string | null {
  return passphraseState(env) === "ok" ? normalizePassphrase(env.BACKUP_PASSPHRASE!) : null;
}

export type SmtpConfig =
  | { mode: "outbox" }
  | { mode: "missing" }
  | { mode: "smtp"; host: string; port: number; user: string; pass: string; from: string };

const FROM_WITH_NAME = /^(?:"[^"<>\r\n]{1,64}"|[^"<>\r\n]{1,64}) <[^\s@<>"]+@[^\s@<>"]+>$/;
const BARE_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+$/;
let warnedFrom = false;

/** Outside production mail always goes to the file outbox, whatever SMTP_* say. */
export function smtpConfig(env: Env): SmtpConfig {
  if (!isProd(env)) return { mode: "outbox" };
  const user = (env.SMTP_USER ?? "").trim();
  // Google shows App Passwords in groups of four; a pasted copy keeps the spaces.
  const pass = (env.SMTP_PASS ?? "").replace(/\s+/g, "");
  if (!user || !pass) return { mode: "missing" };
  const host = (env.SMTP_HOST ?? "").trim() || "smtp.gmail.com";
  const portRaw = (env.SMTP_PORT ?? "").trim();
  const port = /^\d{1,5}$/.test(portRaw) ? Number(portRaw) : 465;
  const rawFrom = (env.SMTP_FROM ?? "").trim();
  let from = `"Arkhe Portal" <${user}>`;
  if (rawFrom) {
    if (FROM_WITH_NAME.test(rawFrom) || BARE_ADDRESS.test(rawFrom)) from = rawFrom;
    else if (!warnedFrom) {
      warnedFrom = true;
      console.warn("SMTP_FROM is malformed; using SMTP_USER");
    }
  }
  return { mode: "smtp", host, port, user, pass, from };
}

export type BackupSetup = {
  mail: "ok" | "dev" | "missing";
  passphrase: PassphraseState;
  cronSecret: boolean;
};

/** Booleans and states only: no value, length or prefix of a secret ever leaves this module. */
export function backupSetup(env: Env): BackupSetup {
  const mail = smtpConfig(env).mode;
  return {
    mail: mail === "outbox" ? "dev" : mail === "smtp" ? "ok" : "missing",
    passphrase: passphraseState(env),
    cronSecret: cronSecret(env) !== null,
  };
}

/** Names of the backup variables that are missing or unusable in this environment. */
export function missingBackupVars(env: Env): string[] {
  const s = backupSetup(env);
  const missing: string[] = [];
  if (s.mail === "missing") missing.push("SMTP_USER", "SMTP_PASS");
  if (s.passphrase !== "ok") missing.push("BACKUP_PASSPHRASE");
  if (!s.cronSecret) missing.push("CRON_SECRET");
  return missing;
}

/** Every secret in every form it may appear in an error message; used by each backup error log. */
export function redactionSecrets(env: Env): string[] {
  const rawPass = env.SMTP_PASS ?? "";
  const rawPhrase = env.BACKUP_PASSPHRASE ?? "";
  return [
    rawPass,
    rawPass.replace(/\s+/g, ""),
    (env.SMTP_USER ?? "").trim(),
    rawPhrase,
    normalizePassphrase(rawPhrase),
    cronSecret(env) ?? "",
  ].filter((s) => s.length > 0);
}
