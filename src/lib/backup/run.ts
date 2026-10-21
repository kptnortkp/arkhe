import "server-only";
import { db } from "@/db";
import { appUrl } from "@/lib/auth/set-password-links";
import { istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import { backupPassphrase, redactionSecrets, smtpConfig } from "./config";
import { COOLDOWN_SECONDS, MAX_ATTACHMENT_BYTES, STALE_SECONDS } from "./constants";
import { encryptBackup } from "./crypto";
import { dumpDatabase } from "./dump";
import { attachmentNames, monthlyEmail } from "./email";
import { SEND_BUDGET_MS, sendMail } from "./mail";
import { BackupError, describeError, errorKey, RUN_ERRORS } from "./messages";
import { loadRecipients } from "./recipients";
import { buildReports } from "./reports";
import { reportMonthOf } from "./schedule";

export type RunResult = "sent" | "skipped" | "failed";
export type RunOutcome =
  | { result: "sent"; recipients: number }
  | { result: "failed" }
  | { result: "skipped"; refusal?: "running" | "cooldown" | "no-recipients"; minutesLeft?: number };

type RunOptions =
  | { trigger: "cron"; today: string }
  | { trigger: "manual"; today: string; actor: { id: string; name: string } };

const client = () => db.$client;

export async function isCovered(month: string) {
  const r = await client().execute({
    sql: "select 1 from backup_runs where report_month = ? and status = 'sent' limit 1",
    args: [month],
  });
  return r.rows.length > 0;
}

const REAP = {
  sql: `update backup_runs set status = 'failed', finished_at = unixepoch(), error = ?
        where status = 'running' and started_at <= unixepoch() - ${STALE_SECONDS}`,
  args: [RUN_ERRORS.stale],
};

/** Reap + conditional insert in one write batch; true when this call owns the run. */
async function claim(id: string, month: string, count: number, opts: RunOptions) {
  const insert =
    opts.trigger === "cron"
      ? {
          sql: `insert into backup_runs (id, report_month, trigger, actor_id, status, recipient_count)
                select ?, ?, 'cron', null, 'running', ?
                where not exists (select 1 from backup_runs
                                  where report_month = ? and status in ('sent', 'running'))`,
          args: [id, month, count, month],
        }
      : {
          sql: `insert into backup_runs (id, report_month, trigger, actor_id, status, recipient_count)
                select ?, ?, 'manual', ?, 'running', ?
                where not exists (select 1 from backup_runs where report_month = ? and status = 'running')
                  and not exists (select 1 from backup_runs where status = 'sent'
                                  and started_at >= unixepoch() - ${COOLDOWN_SECONDS * 2}
                                  and finished_at > unixepoch() - ${COOLDOWN_SECONDS})`,
          args: [id, month, opts.actor.id, count, month],
        };
  try {
    // The reap goes first: it takes the write lock and frees a dead run's unique slot.
    const [, inserted] = await client().batch([REAP, insert], "write");
    return inserted.rowsAffected === 1;
  } catch (e) {
    const code = String((e as { code?: unknown }).code ?? "");
    if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_CONSTRAINT")) return false;
    throw e;
  }
}

/** Seconds until the manual cooldown ends, or 0. */
export async function cooldownLeft() {
  const r = await client().execute(
    `select max(finished_at) as f from backup_runs where status = 'sent'
     and started_at >= unixepoch() - ${COOLDOWN_SECONDS * 2}`,
  );
  const f = Number(r.rows[0]?.f ?? 0);
  return f ? Math.max(0, f + COOLDOWN_SECONDS - Math.floor(Date.now() / 1000)) : 0;
}

export async function isRunningFresh(month: string) {
  const r = await client().execute({
    sql: `select 1 from backup_runs where report_month = ? and status = 'running'
          and started_at > unixepoch() - ${STALE_SECONDS} limit 1`,
    args: [month],
  });
  return r.rows.length > 0;
}

async function finish(
  id: string,
  status: "sent" | "failed",
  size: number | null,
  error: string | null,
  recipientCount?: number,
) {
  const r = await client().execute({
    // The status guard: a row some later claim already reaped is never flipped back.
    sql: `update backup_runs set status = ?, finished_at = unixepoch(), size_bytes = ?, error = ?,
            recipient_count = coalesce(?, recipient_count)
          where id = ? and status = 'running'`,
    args: [status, size, error, recipientCount ?? null, id],
  });
  if (r.rowsAffected === 0) {
    console.warn(`backup run finish (${status}) matched no running row; it was already reaped`);
  }
  try {
    await client().execute(
      "delete from backup_runs where started_at < unixepoch('now', '-24 months')",
    );
  } catch (e) {
    console.error("backup run retention delete failed", describeError(e, []));
  }
}

/** After a delivered email: record `sent`, retry once, and never fall back to `failed` (D7). */
async function recordSent(id: string, size: number, accepted: number) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // recipient_count becomes the accepted count; the CHECK needs it above 0.
      await finish(id, "sent", size, null, accepted > 0 ? accepted : undefined);
      return;
    } catch (e) {
      console.error(`backup sent but not recorded (attempt ${attempt})`, describeError(e, []));
    }
  }
  // The row stays `running`, is reaped as stale after STALE_SECONDS, and the next day resends.
}

/**
 * The monthly send. Exactly two callers: the cron route after its bearer check and the
 * sendBackupNow action after its role check. Nothing here reads the session.
 */
export async function runMonthlyBackup(opts: RunOptions): Promise<RunOutcome> {
  const month = reportMonthOf(opts.today);
  if (opts.trigger === "cron" && (await isCovered(month))) return { result: "skipped" };
  const saved = await loadRecipients();
  if (!saved) {
    return opts.trigger === "cron"
      ? { result: "skipped" }
      : { result: "skipped", refusal: "no-recipients" };
  }
  const to = saved.list;
  const id = crypto.randomUUID();
  if (!(await claim(id, month, to.length, opts))) {
    if (opts.trigger === "cron") return { result: "skipped" };
    if (await isRunningFresh(month)) return { result: "skipped", refusal: "running" };
    const left = await cooldownLeft();
    // No fresh run and no cooldown: the claim lost a lock race, so another send is in flight.
    if (left === 0) return { result: "skipped", refusal: "running" };
    return {
      result: "skipped",
      refusal: "cooldown",
      minutesLeft: Math.max(1, Math.ceil(left / 60)),
    };
  }

  const started = Date.now();
  const env = process.env;
  let size: number | null = null;
  let delivered: { accepted: number; rejected: number };
  try {
    // Order matters: no email ever leaves without an encrypted backup, and nothing opens SMTP
    // until every attachment is built.
    const passphrase = backupPassphrase(env);
    if (!passphrase) throw new BackupError("passphrase");
    const mail = smtpConfig(env);
    if (mail.mode === "missing") throw new BackupError("smtp");

    const at = new Date();
    const reports = await buildReports(month, opts.today, at);
    const dump = await dumpDatabase(client());
    const encrypted = encryptBackup(Buffer.from(dump.sql, "utf8"), passphrase);
    const files = attachmentNames(month, { date: istanbulDateOf(at), time: istanbulTimeOf(at) });
    const csv = (filename: string, body: string) => ({
      filename,
      content: Buffer.from(body, "utf8"),
      contentType: "text/csv; charset=utf-8",
    });
    const attachments = [
      csv(files.attendance, reports.csv.attendance),
      csv(files.homework, reports.csv.homework),
      csv(files.ledger, reports.csv.ledger),
      csv(files.dues, reports.csv.dues),
      { filename: files.backup, content: encrypted, contentType: "application/octet-stream" },
    ];
    size = attachments.reduce((s, a) => s + a.content.byteLength, 0);
    if (size > MAX_ATTACHMENT_BYTES) throw new BackupError("size");

    const { subject, text } = monthlyEmail({
      month,
      manual: opts.trigger === "manual" ? { name: opts.actor.name, at } : null,
      summary: reports.summary,
      files,
      pageUrl: appUrl("/yedek"),
    });
    delivered = await sendMail(
      mail,
      { to, subject, text, attachments },
      "aylik-yedek",
      started + SEND_BUDGET_MS,
    );
  } catch (e) {
    console.error("backup run failed", describeError(e, [...redactionSecrets(env), ...to]));
    try {
      await finish(id, "failed", size, RUN_ERRORS[errorKey(e)]);
    } catch (finishError) {
      // The row stays `running` and is reaped after STALE_SECONDS; the next day retries.
      console.error("backup run could not be marked failed", describeError(finishError, []));
    }
    console.info(`backup run failed in ${Date.now() - started} ms, ${size ?? 0} bytes`);
    return { result: "failed" };
  }

  // Past this point the email has left: nothing below may report the run as failed.
  if (delivered.rejected > 0) {
    console.warn(`backup mail rejected for ${delivered.rejected} recipients`);
  }
  await recordSent(id, size, delivered.accepted);
  console.info(`backup run sent in ${Date.now() - started} ms, ${size} bytes`);
  return { result: "sent", recipients: delivered.accepted || to.length };
}
