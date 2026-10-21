import "server-only";
import { db } from "@/db";
import type { BackupTrigger, Role } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { canManageBackup, isManager } from "@/lib/permissions";
import { istanbulDateOf, istanbulToUtc, now } from "@/lib/time";
import { backupSetup, type BackupSetup } from "./config";
import { RUN_LOG_LIMIT, STALE_SECONDS } from "./constants";
import { loadRecipients } from "./recipients";
import { cooldownLeft, isRunningFresh } from "./run";
import { monthLabel, nextSendAt, reportMonthOf, type NextSend } from "./schedule";

const client = () => db.$client;

/** `stale` = still `running` after STALE_SECONDS: derived at read time, never stored. */
export type RunStatus = "running" | "sent" | "failed" | "stale";

export type BackupRun = {
  id: string;
  month: string;
  monthLabel: string;
  trigger: BackupTrigger;
  actorName: string | null;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  sizeBytes: number | null;
  recipientCount: number;
  error: string | null;
};

export type PreviousMonthState =
  | { state: "sent"; at: Date; recipientCount: number }
  | { state: "pending" }
  | { state: "running" }
  | { state: "failed"; error: string | null; stale: boolean };

export type SendState =
  | { kind: "ready" }
  | { kind: "no-recipients" }
  | { kind: "running" }
  | { kind: "cooldown"; minutesLeft: number };

export type BackupPage = {
  /** Conductor only; the actions re-check on the server. */
  canEdit: boolean;
  recipients: string[];
  /** "Son değişiklik" from updated_at/updated_by. */
  audit: { name: string | null; at: Date } | null;
  setup: BackupSetup & { recipients: number };
  previous: { month: string; monthLabel: string } & PreviousMonthState;
  nextSend: NextSend;
  send: SendState;
  runs: BackupRun[];
  /** More than RUN_LOG_LIMIT runs exist: show "Son 12 gönderim gösteriliyor." */
  moreRuns: boolean;
};

const STATUS_SQL = `case when status = 'running' and started_at <= unixepoch() - ${STALE_SECONDS}
  then 'stale' else status end`;

const date = (v: unknown) => (v === null || v === undefined ? null : new Date(Number(v) * 1000));

async function recentRuns(limit: number) {
  const r = await client().execute({
    sql: `select r.id, r.report_month, r.trigger, u.name as actor_name, ${STATUS_SQL} as status,
            r.started_at, r.finished_at, r.size_bytes, r.recipient_count, r.error
          from backup_runs r left join users u on u.id = r.actor_id
          order by r.started_at desc, r.rowid desc limit ?`,
    args: [limit],
  });
  return r.rows.map((row): BackupRun => ({
    id: String(row.id),
    month: String(row.report_month),
    monthLabel: monthLabel(String(row.report_month)),
    trigger: row.trigger as BackupTrigger,
    actorName: row.actor_name === null ? null : String(row.actor_name),
    status: row.status as RunStatus,
    startedAt: date(row.started_at)!,
    finishedAt: date(row.finished_at),
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    recipientCount: Number(row.recipient_count),
    error: row.error === null ? null : String(row.error),
  }));
}

async function previousState(month: string): Promise<PreviousMonthState> {
  const sent = await client().execute({
    sql: `select finished_at, recipient_count from backup_runs
          where report_month = ? and status = 'sent' order by finished_at desc limit 1`,
    args: [month],
  });
  if (sent.rows.length) {
    return {
      state: "sent",
      at: date(sent.rows[0].finished_at)!,
      recipientCount: Number(sent.rows[0].recipient_count),
    };
  }
  const latest = await client().execute({
    sql: `select ${STATUS_SQL} as status, error from backup_runs where report_month = ?
          order by started_at desc, rowid desc limit 1`,
    args: [month],
  });
  const row = latest.rows[0];
  if (!row) return { state: "pending" };
  if (row.status === "running") return { state: "running" };
  return {
    state: "failed",
    error: row.error === null ? null : String(row.error),
    stale: row.status === "stale",
  };
}

/** Everything /yedek renders, in one call. Managers only. */
export async function loadBackupPage(): Promise<BackupPage> {
  const user = await requireManager();
  const at = now();
  const month = reportMonthOf(istanbulDateOf(at));
  const [saved, previous, runs, cooldown, running] = await Promise.all([
    loadRecipients(),
    previousState(month),
    recentRuns(RUN_LOG_LIMIT + 1),
    cooldownLeft(),
    isRunningFresh(month),
  ]);
  const recipients = saved?.list ?? [];
  const send: SendState = !recipients.length
    ? { kind: "no-recipients" }
    : running
      ? { kind: "running" }
      : cooldown > 0
        ? { kind: "cooldown", minutesLeft: Math.max(1, Math.ceil(cooldown / 60)) }
        : { kind: "ready" };
  return {
    canEdit: canManageBackup(user.role),
    recipients,
    audit: saved ? { name: saved.editorName, at: saved.updatedAt } : null,
    setup: { ...backupSetup(process.env), recipients: recipients.length },
    previous: { month, monthLabel: monthLabel(month), ...previous },
    nextSend: nextSendAt(previous.state === "sent", at),
    send,
    runs: runs.slice(0, RUN_LOG_LIMIT),
    moreRuns: runs.length > RUN_LOG_LIMIT,
  };
}

export type BackupBanner =
  | { kind: "setup" }
  | { kind: "failed"; month: string; monthLabel: string }
  | { kind: "overdue"; month: string; monthLabel: string };

/** Home banner (AC 20, 21). Members get null before any query. */
export async function backupBannerState(user: { role: Role }): Promise<BackupBanner | null> {
  if (!isManager(user.role)) return null;
  const saved = await loadRecipients();
  if (!saved) return canManageBackup(user.role) ? { kind: "setup" } : null;
  const today = istanbulDateOf(now());
  const month = reportMonthOf(today);
  // One round trip: coverage and the latest cron run, both index searches.
  const r = await client().execute({
    sql: `select
            exists (select 1 from backup_runs where report_month = ? and status = 'sent') as covered,
            (select report_month from backup_runs where trigger = 'cron'
             order by started_at desc, rowid desc limit 1) as cron_month,
            (select ${STATUS_SQL} from backup_runs where trigger = 'cron'
             order by started_at desc, rowid desc limit 1) as cron_status`,
    args: [month],
  });
  const row = r.rows[0];
  if (Number(row.covered) === 1) return null;
  const label = monthLabel(month);
  // Only the current target month: an abandoned older failure must not pin the banner forever.
  if (
    row.cron_month === month &&
    (row.cron_status === "failed" || row.cron_status === "stale")
  ) {
    return { kind: "failed", month, monthLabel: label };
  }
  const firstOfThisMonth = istanbulToUtc(`${today.slice(0, 7)}-01`);
  if (saved.createdAt < firstOfThisMonth && today.slice(8) >= "03") {
    return { kind: "overdue", month, monthLabel: label };
  }
  return null;
}
