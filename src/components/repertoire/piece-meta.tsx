import { Archive, Check, Music } from "lucide-react";
import type { PieceStatus } from "@/db/schema";
import { formatDuration } from "@/lib/format";
import { PIECE_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<PieceStatus, { className: string; icon: typeof Music }> = {
  learning: { className: "bg-accent text-accent-foreground", icon: Music },
  concert: { className: "bg-primary/10 text-primary", icon: Check },
  archive: { className: "bg-muted text-muted-foreground", icon: Archive },
};

export function PieceStatusChip({ status }: { status: PieceStatus }) {
  const { className, icon: Icon } = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {PIECE_STATUS_LABELS[status]}
    </span>
  );
}

export function MetaChips({
  language,
  voicing,
  durationSec,
  className,
}: {
  language: string | null;
  voicing: string | null;
  durationSec: number | null;
  className?: string;
}) {
  const chips = [language, voicing, durationSec ? formatDuration(durationSec) : null].filter(
    Boolean,
  );
  if (chips.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)} data-testid="meta-chips">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums"
        >
          {chip}
        </span>
      ))}
    </span>
  );
}

export function composerLine(composer: string | null, arranger: string | null) {
  return [composer, arranger ? `düz. ${arranger}` : null].filter(Boolean).join(" · ");
}
