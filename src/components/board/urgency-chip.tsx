import { AlarmClock, ArrowUp, CalendarDays, Flame } from "lucide-react";
import { URGENCY_LABELS, type TicketUrgency } from "@/lib/board/labels";
import { dayInstant, formatShortDate } from "@/lib/time";
import { cn } from "@/lib/utils";

const LOOK: Record<TicketUrgency, string> = {
  // Solid fill: readable without hue, like the overdue deadline chip.
  urgent: "bg-absent text-absent-foreground",
  high: "bg-late/18 text-late-ink",
  medium: "bg-muted text-muted-foreground",
  low: "border text-muted-foreground",
};

export function UrgencyChip({ urgency }: { urgency: TicketUrgency }) {
  const Icon = urgency === "urgent" ? Flame : urgency === "high" ? ArrowUp : null;
  return (
    <span
      data-testid="urgency-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        LOOK[urgency],
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {URGENCY_LABELS[urgency]}
    </span>
  );
}

/** "15 Kas", "Bugün" or "Gecikti · 15 Kas"; `today` is the Istanbul day the server rendered for. */
export function DueLabel({
  dueOn,
  overdue,
  today,
  long = false,
}: {
  dueOn: string;
  overdue: boolean;
  today: string;
  long?: boolean;
}) {
  const day = formatShortDate.format(dayInstant(dueOn));
  if (overdue) {
    return (
      <span
        data-testid="due"
        data-overdue="true"
        className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-absent-ink"
      >
        <AlarmClock aria-hidden className="size-3.5" />
        Gecikti · {day}
      </span>
    );
  }
  const isToday = dueOn === today;
  return (
    <span
      data-testid="due"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        isToday && "font-medium text-late-ink",
      )}
    >
      <CalendarDays aria-hidden className="size-3.5" />
      {isToday ? "Bugün" : long ? formatLongDay(dueOn) : day}
    </span>
  );
}

const longDay = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  weekday: "long",
  timeZone: "Europe/Istanbul",
});
/** "15 Kasım 2026 Pazar". */
export const formatLongDay = (day: string) => longDay.format(dayInstant(day));
