import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { SpecialDay } from "@/lib/festivals/queries";
import { SPECIAL_DAY_FILL, SPECIAL_DAY_LABELS } from "@/lib/festivals/labels";
import { dayInstant, formatLongDate } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Special days as rows; managers get a link to edit each one. */
export function SpecialDayList({ days, editable }: { days: SpecialDay[]; editable: boolean }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card" data-testid="special-days">
      {days.map((d) => {
        const body = (
          <>
            <span
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 rounded border border-foreground/15",
                SPECIAL_DAY_FILL[d.kind] || "bg-card",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium [overflow-wrap:anywhere]">{d.title}</span>
              <span className="block text-sm text-muted-foreground">
                {formatLongDate.format(dayInstant(d.day))} {d.day.slice(0, 4)} ·{" "}
                {SPECIAL_DAY_LABELS[d.kind]}
              </span>
            </span>
          </>
        );
        return (
          <li key={d.id} data-testid="special-day" data-day={d.day} data-kind={d.kind}>
            {editable ? (
              <Link
                href={`/ozel-gunler/${d.id}`}
                aria-label={`Düzenle: ${d.title}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                {body}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ) : (
              <div className="flex min-h-14 items-center gap-3 px-4 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
