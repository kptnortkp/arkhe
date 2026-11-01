import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { BackLink } from "@/components/board/back-link";
import { TicketCard } from "@/components/board/ticket-card";
import { formatLongDay } from "@/components/board/urgency-chip";
import { buttonVariants } from "@/components/ui/button";
import { parseMonth, shiftMonth } from "@/lib/board/calendar";
import { getCalendar } from "@/lib/board/queries";
import { dayInstant, formatMonthYear, istanbulDateOf, now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Takvim · Yönetim Kurulu" };

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const href = (month: string, day?: string) =>
  `/yonetim/takvim?ay=${month}${day ? `&gun=${day}` : ""}`;

export default async function CalendarPage({ searchParams }: PageProps<"/yonetim/takvim">) {
  const sp = await searchParams;
  const month = parseMonth(sp.ay, istanbulDateOf(now()));
  const { weeks, byDay, today } = await getCalendar(month);
  const inMonth = (day: string) => day.startsWith(month);
  const selected =
    typeof sp.gun === "string" && DAY.test(sp.gun) && inMonth(sp.gun)
      ? sp.gun
      : inMonth(today)
        ? today
        : `${month}-01`;
  const dayTickets = byDay.get(selected) ?? [];
  const pager = cn(buttonVariants({ variant: "outline" }), "size-11 rounded-full p-0");

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href="/yonetim">Panoya dön</BackLink>
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-4xl font-medium">Takvim</h1>
          <Link
            href={`/yonetim/yeni?tarih=${selected}&takvim=1`}
            className={cn(buttonVariants(), "h-11 shrink-0 rounded-full px-4")}
          >
            <Plus />
            Yeni iş
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Takvime eklenen işler son tarihlerinde görünür. Bir güne dokun, o günün işlerini gör ya da
          o güne iş ekle.
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-3 md:p-4">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={href(shiftMonth(month, -1))}
            aria-label="Önceki ay"
            className={pager}
            scroll={false}
          >
            <ChevronLeft />
          </Link>
          <div className="flex flex-col items-center">
            <h2 data-testid="calendar-month" className="text-xl font-medium capitalize">
              {formatMonthYear(dayInstant(`${month}-01`))}
            </h2>
            {!inMonth(today) && (
              <Link
                href={href(today.slice(0, 7))}
                scroll={false}
                className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary hover:underline"
              >
                Bugüne dön
              </Link>
            )}
          </div>
          <Link
            href={href(shiftMonth(month, 1))}
            aria-label="Sonraki ay"
            className={pager}
            scroll={false}
          >
            <ChevronRight />
          </Link>
        </div>

        <table className="w-full table-fixed border-collapse" data-testid="calendar-grid">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th key={d} scope="col" className="pb-1 text-xs font-medium text-muted-foreground">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => {
                  const tickets = byDay.get(day) ?? [];
                  const open = tickets.filter((t) => t.status !== "done").length;
                  const label = `${formatLongDay(day)}${tickets.length ? `, ${tickets.length} iş` : ""}`;
                  return (
                    <td key={day} className="p-0.5 align-top">
                      <Link
                        href={href(month, day)}
                        scroll={false}
                        aria-label={label}
                        aria-current={day === selected ? "date" : undefined}
                        data-day={day}
                        data-count={tickets.length}
                        className={cn(
                          "flex min-h-13 flex-col items-center gap-1 rounded-xl px-0.5 py-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-24 md:items-stretch md:px-1.5",
                          !inMonth(day) && "text-muted-foreground/60",
                          day === selected && "bg-muted ring-2 ring-primary",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-7 place-items-center rounded-full text-sm tabular-nums md:self-start",
                            day === today && "bg-primary font-semibold text-primary-foreground",
                          )}
                        >
                          {Number(day.slice(8))}
                        </span>
                        {tickets.length > 0 && (
                          <>
                            <span aria-hidden className="flex gap-0.5 md:hidden">
                              {tickets.slice(0, 3).map((t) => (
                                <span
                                  key={t.number}
                                  className={cn(
                                    "size-1.5 rounded-full",
                                    t.status === "done" ? "bg-border" : "bg-gold",
                                  )}
                                />
                              ))}
                            </span>
                            <span aria-hidden className="hidden space-y-0.5 md:block">
                              {tickets.slice(0, 2).map((t) => (
                                <span
                                  key={t.number}
                                  className={cn(
                                    "block truncate rounded-md bg-gold/15 px-1.5 py-0.5 text-xs",
                                    t.status === "done" &&
                                      "bg-muted text-muted-foreground line-through",
                                  )}
                                >
                                  {t.title}
                                </span>
                              ))}
                              {tickets.length > 2 && (
                                <span className="block px-1.5 text-xs text-muted-foreground">
                                  +{tickets.length - 2}
                                </span>
                              )}
                            </span>
                            {open === 0 && <span className="sr-only">hepsi bitti</span>}
                          </>
                        )}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="gun" className="space-y-3" data-testid="calendar-day">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="gun" className="text-xl font-medium">
            {selected === today ? "Bugün · " : ""}
            {formatLongDay(selected)}
          </h2>
          <Link
            href={`/yonetim/yeni?tarih=${selected}&takvim=1`}
            className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
          >
            <Plus />
            Bu güne iş ekle
          </Link>
        </div>
        {dayTickets.length === 0 ? (
          <div className="space-y-2 rounded-2xl border border-dashed bg-card px-6 py-8 text-center">
            <CalendarDays aria-hidden className="mx-auto size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Bu günde takvimde iş yok.</p>
          </div>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {dayTickets.map((t) => (
              <TicketCard key={t.number} ticket={t} today={today} query="" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
