import { monthWeeks } from "@/lib/board/calendar";
import type { SpecialDay } from "@/lib/festivals/queries";
import { SPECIAL_DAY_FILL, SPECIAL_DAY_LABELS } from "@/lib/festivals/labels";
import { dayInstant, formatMonthYear } from "@/lib/time";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export function SpecialDayLegend() {
  const item = (fill: string, label: string) => (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-3.5 rounded border border-foreground/15", fill)} />
      {label}
    </li>
  );
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Renkler"
    >
      {item(SPECIAL_DAY_FILL.holiday, SPECIAL_DAY_LABELS.holiday)}
      {item(SPECIAL_DAY_FILL.eve, SPECIAL_DAY_LABELS.eve)}
      {item("bg-day-weekend", "Hafta sonu")}
      {item(SPECIAL_DAY_FILL.observance, SPECIAL_DAY_LABELS.observance)}
    </ul>
  );
}

/** Twelve month grids in the spreadsheet's colours; the list below carries the names. */
export function YearCalendar({
  year,
  days,
  today,
}: {
  year: number;
  days: SpecialDay[];
  today: string;
}) {
  const byDay = Map.groupBy(days, (d) => d.day);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="year-calendar">
      {months.map((m) => (
        <section
          key={m}
          className="overflow-hidden rounded-2xl border bg-card"
          aria-label={formatMonthYear(dayInstant(`${m}-01`))}
        >
          <h3 className="bg-sheet-month px-3 py-1.5 text-center font-sans text-sm font-semibold text-white capitalize">
            {formatMonthYear(dayInstant(`${m}-01`))}
          </h3>
          <table className="w-full table-fixed border-collapse text-center text-xs">
            <thead>
              <tr>
                {WEEKDAYS.map((w) => (
                  <th key={w} scope="col" className="py-1 font-medium text-muted-foreground">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(m).map((week) => (
                <tr key={week[0]}>
                  {week.map((day, i) => {
                    if (!day.startsWith(m)) return <td key={day} />;
                    const special = byDay.get(day) ?? [];
                    const kind = special.find((s) => SPECIAL_DAY_FILL[s.kind])?.kind;
                    const title = special.map((s) => s.title).join(" · ");
                    return (
                      <td key={day} className="p-0.5">
                        <span
                          title={title || undefined}
                          data-day={day}
                          data-kind={kind}
                          className={cn(
                            "grid h-8 place-items-center rounded-md tabular-nums",
                            kind ? SPECIAL_DAY_FILL[kind] : i >= 5 && "bg-day-weekend",
                            special.length > 0 && "font-semibold",
                            day === today && "ring-2 ring-primary",
                          )}
                        >
                          {Number(day.slice(8))}
                          {title && <span className="sr-only">, {title}</span>}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
