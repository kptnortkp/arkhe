import { Check, CircleSlash, Clock, X, type LucideIcon } from "lucide-react";
import type { BackupRun, RunStatus } from "@/lib/backup/queries";
import { formatBytes } from "@/lib/format";
import { formatAuditDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const CHIPS: Record<RunStatus, { label: string; className: string; Icon: LucideIcon }> = {
  sent: { label: "Gönderildi", className: "bg-present/14 text-present-ink", Icon: Check },
  failed: { label: "Gönderilemedi", className: "bg-absent/12 text-absent-ink", Icon: X },
  stale: { label: "Yarıda kaldı", className: "bg-absent/12 text-absent-ink", Icon: CircleSlash },
  running: { label: "Gönderiliyor", className: "bg-muted text-muted-foreground", Icon: Clock },
};

export const STALE_RUN_TEXT = "Gönderim yarıda kaldı. Her sabah kendiliğinden yeniden deneniyor.";

export function RunStatusChip({ status }: { status: RunStatus }) {
  const { label, className, Icon } = CHIPS[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

function RunRow({ run }: { run: BackupRun }) {
  const at = run.startedAt;
  const trigger =
    run.trigger === "cron" ? "Otomatik" : `Elle${run.actorName ? ` · ${run.actorName}` : ""}`;
  const size = run.sizeBytes === null ? null : formatBytes(run.sizeBytes);
  const error = run.status === "stale" ? (run.error ?? STALE_RUN_TEXT) : run.error;
  return (
    <li className="space-y-1 py-3" data-testid="backup-run" data-status={run.status}>
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium">{run.monthLabel}</span>
        <RunStatusChip status={run.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        <time dateTime={at.toISOString()}>{formatAuditDateTime(at)}</time> · {trigger}
      </p>
      {run.status !== "running" && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {size ? `${size} · ` : ""}
          {run.recipientCount} adres
        </p>
      )}
      {(run.status === "failed" || run.status === "stale") && error && (
        <p className="text-sm break-words text-absent-ink">{error}</p>
      )}
    </li>
  );
}

export function RunLog({
  runs,
  moreRuns,
  emptyText,
}: {
  runs: BackupRun[];
  moreRuns: boolean;
  emptyText: string;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="backup-log-empty">
        {emptyText}
      </p>
    );
  }
  return (
    <>
      <ol className="divide-y" aria-label="Gönderim geçmişi" data-testid="backup-log">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </ol>
      {moreRuns && <p className="text-xs text-muted-foreground">Son 12 gönderim gösteriliyor.</p>}
    </>
  );
}
