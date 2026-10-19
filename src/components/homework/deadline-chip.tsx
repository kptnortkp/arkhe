import {
  AlarmClock,
  CalendarX,
  CircleAlert,
  CircleCheck,
  Clock,
  Hourglass,
  type LucideIcon,
} from "lucide-react";
import type { VoicePart } from "@/db/schema";
import type { DeadlineBadge } from "@/lib/homework/deadline";
import { VOICE_PARTS } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { formatDue } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PartDot } from "@/components/part-dot";

function look(badge: DeadlineBadge, calm: boolean): { className: string; icon: LucideIcon } {
  switch (badge.tone) {
    case "green":
      return { className: "bg-present/14 text-present-ink", icon: Clock };
    case "amber":
      return { className: "bg-late/18 text-late-ink", icon: Hourglass };
    case "red":
      if (!badge.overdue) return { className: "bg-absent/12 text-absent-ink", icon: AlarmClock };
      // Solid fill tells "late" from "soon" without relying on hue; calm in the archive.
      return calm
        ? { className: "bg-absent/12 text-absent-ink", icon: CircleAlert }
        : { className: "bg-absent text-absent-foreground", icon: CircleAlert };
    case "done":
      return { className: "bg-muted text-foreground", icon: CircleCheck };
    default:
      return {
        className: "bg-muted text-muted-foreground",
        icon: badge.label === "İsteğe bağlı" ? Clock : CalendarX,
      };
  }
}

export function DeadlineChip({ badge, calm = false }: { badge: DeadlineBadge; calm?: boolean }) {
  const { className, icon: Icon } = look(badge, calm);
  return (
    <span
      data-tone={badge.tone}
      data-testid="deadline-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <Icon
        className={cn(
          "size-3.5",
          badge.tone === "done" && (badge.late ? "text-late-ink" : "text-present-ink"),
        )}
        aria-hidden
      />
      {badge.label}
    </span>
  );
}

export function DueLine({ dueAt, className }: { dueAt: Date; className?: string }) {
  return (
    <span className={cn("text-xs text-muted-foreground tabular-nums", className)}>
      Son tarih: {formatDue.format(dueAt)}
    </span>
  );
}

/** Part chips; all four parts read as Tutti. */
export function PartList({ parts }: { parts: VoicePart[] }) {
  if (parts.length === VOICE_PARTS.length) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <PartDot part={null} />
        Tutti
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      {parts.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          <PartDot part={p} />
          {VOICE_PART_LABELS[p]}
        </span>
      ))}
    </span>
  );
}
