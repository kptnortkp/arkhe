import { ChevronRight, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { PartDot } from "@/components/part-dot";
import { barsLabel } from "@/lib/homework/mail";
import type {
  AssistantQueueRow,
  ConductorQueueRow,
  QueueGroup,
  QueueRowBase,
} from "@/lib/review/queries";
import { formatShortDate, formatShortDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const tag = "rounded-full px-2.5 py-0.5 text-xs font-medium";

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function reviewHref(r: QueueRowBase, chip: string) {
  return `/odevler/${r.assignmentId}/dinle/${r.userId}?filtre=${chip}`;
}

function Row({
  row,
  chip,
}: {
  row: (ConductorQueueRow | AssistantQueueRow) & Partial<ConductorQueueRow & AssistantQueueRow>;
  chip: string;
}) {
  const notes = row.noteCount ?? 0;
  return (
    <li>
      <Link
        href={reviewHref(row, chip)}
        prefetch={false}
        data-testid="queue-row"
        data-user={row.userId}
        data-assignment={row.assignmentId}
        className="flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-2">
            <PartDot part={row.part} />
            <span className="truncate font-medium">{row.name}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            {row.noRecording ? (
              <span className={cn(tag, "border border-dashed text-muted-foreground")}>
                Portalda kayıt yok
              </span>
            ) : (
              <span>
                {[
                  row.durationMs !== null && clock(row.durationMs),
                  row.uploadedAt && formatShortDateTime.format(row.uploadedAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            {row.late && <span className={cn(tag, "bg-late/18 text-late-ink")}>Geç</span>}
            {row.retake && <span className={cn(tag, "bg-primary/12 text-primary")}>Yeni kayıt</span>}
            {notes > 0 && (
              <span className={cn(tag, "inline-flex items-center gap-1 bg-primary/12 text-primary")}>
                <MessageSquareText className="size-3" aria-hidden />
                {notes} asistan notu
              </span>
            )}
            {row.audioDeleted && <span className={cn(tag, "bg-muted text-muted-foreground")}>Ses silindi</span>}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

export function QueueGroups({
  groups,
  chip,
}: {
  groups: QueueGroup<ConductorQueueRow | AssistantQueueRow>[];
  chip: string;
}) {
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const id = `g-${g.assignmentId}`;
        return (
          <section key={g.assignmentId} aria-labelledby={id} className="space-y-2" data-testid="queue-group">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={id} className="font-sans text-[17px] font-medium">
                {g.pieceTitle} · {barsLabel(g.barFrom, g.barTo)}
              </h2>
              <span className="shrink-0 text-xs text-muted-foreground">
                Son tarih {formatShortDate.format(g.dueAt)}
              </span>
            </div>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {g.rows.map((r) => (
                <Row key={`${r.assignmentId}:${r.userId}`} row={r} chip={chip} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
