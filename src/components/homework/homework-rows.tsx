import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { VOICE_PART_SHORT } from "@/lib/labels";
import { deadlineBadge, managerBadge } from "@/lib/homework/deadline";
import { barsLabel } from "@/lib/homework/mail";
import type { MemberRow, PartCount } from "@/lib/homework/queries";
import type { VoicePart } from "@/db/schema";
import { DeadlineChip, DueLine, PartList } from "./deadline-chip";
import { SubmitRowButton } from "./submit-button";

export function NewNote() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-primary"
      data-testid="new-note"
    >
      <span className="size-2 rounded-full bg-gold" aria-hidden />
      Yeni not
    </span>
  );
}

export function SingerRow({ row, at, calm = false }: { row: MemberRow; at: Date; calm?: boolean }) {
  const badge = deadlineBadge({
    dueAt: row.dueAt,
    now: at,
    submittedAt: row.submittedAt,
    expected: row.expected,
  });
  const title = `${row.pieceTitle} · ${barsLabel(row.barFrom, row.barTo)}`;
  return (
    <li
      className="flex min-h-[88px] items-center gap-3 pr-3"
      data-testid="homework-row"
      data-id={row.id}
    >
      <Link
        href={`/odevler/${row.id}`}
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 self-stretch py-3 pl-4 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="line-clamp-2 leading-snug font-medium" data-testid="homework-title">
          {row.pieceTitle}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span data-testid="homework-bars">{barsLabel(row.barFrom, row.barTo)}</span> ·{" "}
          <PartList parts={row.parts} />
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {row.hasNewNote && <NewNote />}
          <DeadlineChip badge={badge} calm={calm} />
          <DueLine dueAt={row.dueAt} />
        </span>
        {!row.expected && !row.submittedAt && (
          <span className="mt-1 text-xs text-muted-foreground">
            Sen katılmadan önce verildi; istersen teslim edebilirsin.
          </span>
        )}
      </Link>
      {row.eligible && !row.submittedAt && <SubmitRowButton id={row.id} title={title} />}
    </li>
  );
}

export function PartCounts({ counts }: { counts: PartCount[] }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums" data-testid="part-counts">
      {counts.map((c) => `${VOICE_PART_SHORT[c.part]} ${c.done}/${c.total}`).join(" · ")}
    </span>
  );
}

export type ManagerRowData = {
  id: string;
  pieceTitle: string;
  barFrom: number | null;
  barTo: number | null;
  dueAt: Date;
  parts: VoicePart[];
  counts: { perPart: PartCount[]; done: number; total: number };
};

export function ManagerRow({
  row,
  at,
  ownPending,
}: {
  row: ManagerRowData;
  at: Date;
  ownPending: boolean;
}) {
  const badge = managerBadge(row.dueAt, at);
  const missing = row.counts.total - row.counts.done;
  const percent = row.counts.total ? (row.counts.done / row.counts.total) * 100 : 0;
  return (
    <li data-testid="homework-row" data-id={row.id}>
      <Link
        href={`/odevler/${row.id}`}
        className="flex min-h-[96px] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 leading-snug font-medium" data-testid="homework-title">
            {row.pieceTitle}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span data-testid="homework-bars">{barsLabel(row.barFrom, row.barTo)}</span> ·{" "}
            <PartList parts={row.parts} />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <DeadlineChip badge={badge} />
            <DueLine dueAt={row.dueAt} />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-sm tabular-nums">
            <span data-testid="homework-count">
              {row.counts.done}/{row.counts.total} teslim
            </span>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className="block h-full rounded-full bg-present"
                style={{ width: `${percent}%` }}
              />
            </span>
            {row.dueAt <= at && missing > 0 && (
              <span className="font-medium text-absent-ink">· {missing} eksik</span>
            )}
          </span>
          <PartCounts counts={row.counts.perPart} />
          {ownPending && (
            <span className="text-xs font-medium text-primary">Teslimin bekleniyor</span>
          )}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
