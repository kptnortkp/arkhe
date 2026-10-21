import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { OUTBOX_FROM } from "./constants";
import { BackupError } from "./messages";
import type { SmtpConfig } from "./config";

export type Outgoing = {
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

// Buffers only: nodemailer must never read a server file or fetch a URL for us.
const SAFE = { disableFileAccess: true, disableUrlAccess: true } as const;

// Overall SMTP budget, well under the 60 s maxDuration of the cron route and /yedek.
export const SEND_BUDGET_MS = 45_000;

/**
 * Production: SMTP. Anywhere else: an .eml in data/outbox/, never sent.
 * Returns how many recipients the server accepted; `deadline` is an epoch-ms cut-off.
 */
export async function sendMail(
  config: SmtpConfig,
  msg: Outgoing,
  slug: string,
  deadline = Date.now() + SEND_BUDGET_MS,
): Promise<{ accepted: number; rejected: number }> {
  if (config.mode === "missing") throw new BackupError("smtp");
  if (config.mode === "outbox") {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows",
    });
    const info = await transport.sendMail({ ...SAFE, ...msg, from: OUTBOX_FROM });
    const dir = path.join(process.cwd(), "data", "outbox");
    await mkdir(dir, { recursive: true });
    const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}`;
    // The .eml carries the plain CSVs: owner-only.
    await writeFile(path.join(dir, `${stamp}-${slug}.eml`), info.message as Buffer, {
      flag: "wx",
      mode: 0o600,
    });
    return { accepted: msg.to.length, rejected: 0 };
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass },
    // nodemailer's defaults (minutes) would outlive the function's 60 s maxDuration.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    dnsTimeout: 5_000,
    logger: false,
    debug: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Per-stage timeouts reset on every reply; a server that trickles needs this overall cut-off.
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("SMTP send deadline exceeded"), { code: "ETIMEDOUT" })),
      Math.max(1_000, deadline - Date.now()),
    );
  });
  try {
    const info = await Promise.race([
      transport.sendMail({ ...SAFE, ...msg, from: config.from }),
      expired,
    ]);
    return {
      accepted: Array.isArray(info.accepted) ? info.accepted.length : msg.to.length,
      rejected: Array.isArray(info.rejected) ? info.rejected.length : 0,
    };
  } finally {
    clearTimeout(timer);
    transport.close();
  }
}
