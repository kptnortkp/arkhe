import { Check, Clock, MessageSquareText, Minus, X, type LucideIcon } from "lucide-react";
import type { AttendanceStatus, RehearsalType, VoicePart } from "@/db/schema";
import {
  REHEARSAL_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  VOICE_PART_SHORT,
  VOICE_PART_STYLES,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

export const STATUS_ICONS: Record<AttendanceStatus, LucideIcon> = {
  present: Check,
  late: Clock,
  excused: MessageSquareText,
  absent: X,
};

export function StatusChip({
  status,
  className,
}: {
  status: AttendanceStatus | null;
  className?: string;
}) {
  if (!status) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <Minus className="size-3.5" />
        İşaretlenmedi
      </span>
    );
  }
  const Icon = STATUS_ICONS[status];
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        style.soft,
        style.text,
        className,
      )}
    >
      <Icon className="size-3.5" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function TypeChip({ type, parts }: { type: RehearsalType; parts: VoicePart[] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        type === "tutti" && "bg-muted text-foreground",
        type === "sectional" && "bg-muted text-foreground",
        type === "dress" && "bg-accent text-accent-foreground",
        type === "concert" && "bg-plum text-stage-foreground",
      )}
    >
      {type === "sectional" &&
        parts.map((p) => (
          <span key={p} className="inline-flex items-center gap-0.5">
            <span className={cn("size-1.5 rounded-full", VOICE_PART_STYLES[p].dot)} />
            {VOICE_PART_SHORT[p]}
          </span>
        ))}
      {REHEARSAL_TYPE_LABELS[type]}
    </span>
  );
}

export function AttendanceStrip({
  statuses,
  className,
}: {
  statuses: AttendanceStatus[];
  className?: string;
}) {
  const counts = statuses.reduce<Record<string, number>>((acc, s) => {
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const label = `Son ${statuses.length} çalışma: ${Object.entries(counts)
    .map(([s, n]) => `${n} ${STATUS_LABELS[s as AttendanceStatus].toLocaleLowerCase("tr")}`)
    .join(", ")}`;
  return (
    <span role="img" aria-label={label} className={cn("inline-flex gap-1", className)}>
      {statuses.map((s, i) => (
        <span key={i} className={cn("size-2.5 rounded-full", STATUS_STYLES[s].dot)} />
      ))}
    </span>
  );
}
