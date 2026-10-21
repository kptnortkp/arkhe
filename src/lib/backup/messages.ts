// The only texts ever stored in backup_runs.error; never err.message (it can carry secrets).
import { README_SECTION } from "./constants";

export const RUN_ERRORS = {
  passphrase: `Yedek şifresi ayarlanmamış ya da geçersiz (BACKUP_PASSPHRASE). README: "${README_SECTION}".`,
  smtp: `E-posta hesabı ayarlanmamış (SMTP_USER, SMTP_PASS). README: "${README_SECTION}".`,
  size: "Ekler 18 MB sınırını aşıyor. Portalı kuran kişiye haber ver.",
  auth: "Gmail girişi reddedildi. Uygulama şifresini kontrol et.",
  connection: "E-posta sunucusuna bağlanılamadı. Yarın sabah kendiliğinden yeniden denenecek.",
  unexpected:
    "Beklenmeyen bir hata oldu. Portalı kuran kişiye haber ver; ayrıntı sunucu kayıtlarında.",
  stale: "Gönderim yarıda kaldı (10 dakika içinde tamamlanmadı).",
} as const;

export type RunErrorKey = keyof typeof RUN_ERRORS;

export class BackupError extends Error {
  constructor(readonly key: "passphrase" | "smtp" | "size") {
    super(`backup precondition failed: ${key}`);
    this.name = "BackupError";
  }
}

const AUTH_CODES = new Set(["EAUTH", "ENOAUTH"]);
const AUTH_RESPONSES = new Set([530, 534, 535]);
const CONNECTION_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ETLS",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

type MailError = { code?: unknown; responseCode?: unknown; command?: unknown };

export function errorKey(e: unknown): RunErrorKey {
  if (e instanceof BackupError) return e.key;
  const { code, responseCode } = (e ?? {}) as MailError;
  if (typeof code === "string" && AUTH_CODES.has(code)) return "auth";
  if (typeof responseCode === "number" && AUTH_RESPONSES.has(responseCode)) return "auth";
  if (typeof code === "string" && CONNECTION_CODES.has(code)) return "connection";
  return "unexpected";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Loggable summary: name, code, responseCode, command and a redacted message. Never the object. */
export function describeError(e: unknown, secrets: (string | null | undefined)[]) {
  const err = (e ?? {}) as MailError & { name?: unknown; message?: unknown };
  let message = typeof err.message === "string" ? err.message.slice(0, 500) : "";
  for (const s of secrets) {
    if (s && s.length >= 4) message = message.replace(new RegExp(escapeRe(s), "gi"), "[redacted]");
  }
  // Any address left (recipients, SMTP_USER) goes too.
  message = message.replace(/[^\s<>"',;:()]+@[^\s<>"',;:()]+/g, "[redacted]");
  return {
    name: typeof err.name === "string" ? err.name : undefined,
    code: typeof err.code === "string" ? err.code : undefined,
    responseCode: typeof err.responseCode === "number" ? err.responseCode : undefined,
    command: typeof err.command === "string" ? err.command : undefined,
    message,
  };
}
