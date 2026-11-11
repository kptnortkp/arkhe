import Link from "next/link";
import type { CalendarTone } from "@/lib/board/calendar";
import type { CalendarItem } from "@/lib/board/queries";
import { cn } from "@/lib/utils";

/** Dot and chip colours per entry type; tokens only. */
export const TONE: Record<CalendarTone, { dot: string; chip: string }> = {
  rehearsal: { dot: "bg-bass", chip: "bg-bass/15 text-bass-ink" },
  concert: { dot: "bg-gold", chip: "bg-gold/25 text-foreground" },
  meeting: { dot: "bg-tenor", chip: "bg-tenor/15 text-tenor-ink" },
  trip: { dot: "bg-present", chip: "bg-present/15 text-present-ink" },
  other: { dot: "bg-muted-foreground", chip: "bg-muted text-muted-foreground" },
  ticket: { dot: "bg-alto", chip: "bg-alto/15 text-alto-ink" },
  festival: { dot: "bg-soprano", chip: "bg-soprano/15 text-soprano-ink" },
  deadline: { dot: "bg-absent", chip: "bg-absent/15 text-absent-ink" },
  special: { dot: "bg-day-holiday", chip: "bg-day-holiday text-foreground" },
};

export function CalendarRow({ item }: { item: CalendarItem }) {
  const time = item.start ? (item.end ? `${item.start}–${item.end}` : item.start) : "Tüm gün";
  return (
    <li data-testid="calendar-item" data-key={item.key} data-tone={item.tone}>
      <Link
        href={item.href}
        prefetch={false}
        className="flex min-h-14 items-start gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="w-20 shrink-0 pt-0.5 text-sm text-muted-foreground tabular-nums">
          {time}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span
            className={cn(
              "block font-medium [overflow-wrap:anywhere]",
              item.struck && "text-muted-foreground line-through",
            )}
          >
            {item.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className={cn("rounded-full px-2 py-0.5 font-medium", TONE[item.tone].chip)}>
              {item.label}
            </span>
            {item.location && <span className="[overflow-wrap:anywhere]">{item.location}</span>}
            {item.struck && <span>{item.tone === "ticket" ? "Bitti" : "İptal edildi"}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}
