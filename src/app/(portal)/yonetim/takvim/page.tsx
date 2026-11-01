import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List, Plus } from "lucide-react";
import Link from "next/link";
import { BackLink } from "@/components/board/back-link";
import { CalendarRow, TONE } from "@/components/board/calendar-row";
import { formatLongDay } from "@/components/board/urgency-chip";
import { FilterChip } from "@/components/filter-chip";
import { buttonVariants } from "@/components/ui/button";
import {
  CALENDAR_FILTERS,
  parseFilter,
  parseMonth,
  shiftMonth,
  type CalendarFilter,
} from "@/lib/board/calendar";
import { getCalendar } from "@/lib/board/queries";
import { dayInstant, formatMonthYear, istanbulDateOf, now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Takvim · Yönetim Kurulu" };

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type View = { month: string; day?: string; filter: CalendarFilter; list: boolean };

function href(v: View) {
  const q = new URLSearchParams({ ay: v.month });
  if (v.day) q.set("gun", v.day);
  if (v.filter !== "hepsi") q.set("tur", v.filter);
  if (v.list) q.set("gorunum", "liste");
  return `/yonetim/takvim?${q}`;
}

function AddButtons({ day, className }: { day: string; className?: string }) {
  return (
    <div className={cn("flex gap-2", className)}>
      <Link
        href={`/yonetim/takvim/yeni?tarih=${day}`}
        className={cn(buttonVariants(), "h-11 rounded-full px-4")}
      >
        <Plus />
        Etkinlik
      </Link>
      <Link
        href={`/yonetim/yeni?tarih=${day}&takvim=1`}
        className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
      >
        <Plus />
        İş
      </Link>
    </div>
  );
}

export default async function CalendarPage({ searchParams }: PageProps<"/yonetim/takvim">) {
  const sp = await searchParams;
  const month = parseMonth(sp.ay, istanbulDateOf(now()));
  const filter = parseFilter(sp.tur);
  const list = sp.gorunum === "liste";
  const { weeks, byDay, today } = await getCalendar(month, filter);
  const inMonth = (day: string) => day.startsWith(month);
  const selected =
    typeof sp.gun === "string" && DAY.test(sp.gun) && inMonth(sp.gun)
      ? sp.gun
      : inMonth(today)
        ? today
        : `${month}-01`;
  const view: View = { month, filter, list };
  const pager = cn(buttonVariants({ variant: "outline" }), "size-11 rounded-full p-0");
  const monthDays = [...byDay.keys()].filter(inMonth);
  const segment = (active: boolean) =>
    cn(
      "flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
      active
        ? "bg-card font-semibold text-foreground shadow-sm dark:bg-background"
        : "text-muted-foreground",
    );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href="/yonetim">Panoya dön</BackLink>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-4xl font-medium">Takvim</h1>
          {list && <AddButtons day={selected} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Koronun çalışmaları, konserleri, toplantıları ve takvime eklenen işler.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Görünüm" className="flex gap-1 rounded-2xl bg-muted p-1">
          <Link
            href={href({ ...view, list: false, day: selected })}
            aria-current={!list ? "page" : undefined}
            className={segment(!list)}
            scroll={false}
          >
            <LayoutGrid aria-hidden className="size-4" />
            Ay
          </Link>
          <Link
            href={href({ ...view, list: true })}
            aria-current={list ? "page" : undefined}
            className={segment(list)}
            scroll={false}
          >
            <List aria-hidden className="size-4" />
            Liste
          </Link>
        </nav>
        <nav
          aria-label="Tür"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
        >
          {(Object.keys(CALENDAR_FILTERS) as CalendarFilter[]).map((f) => (
            <FilterChip
              key={f}
              href={href({ ...view, filter: f, day: list ? undefined : selected })}
              active={filter === f}
              label={CALENDAR_FILTERS[f]}
            />
          ))}
        </nav>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-3 md:p-4">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={href({ ...view, month: shiftMonth(month, -1) })}
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
                href={href({ ...view, month: today.slice(0, 7) })}
                scroll={false}
                className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary hover:underline"
              >
                Bugüne dön
              </Link>
            )}
          </div>
          <Link
            href={href({ ...view, month: shiftMonth(month, 1) })}
            aria-label="Sonraki ay"
            className={pager}
            scroll={false}
          >
            <ChevronRight />
          </Link>
        </div>

        {list ? (
          monthDays.length === 0 ? (
            <div className="space-y-2 px-6 py-10 text-center" data-testid="calendar-list">
              <CalendarDays aria-hidden className="mx-auto size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Bu ay takvimde bir şey yok.</p>
            </div>
          ) : (
            <ol className="space-y-4" data-testid="calendar-list">
              {monthDays.map((day) => (
                <li key={day} data-day={day} className="space-y-1.5">
                  <h3
                    className={cn(
                      "flex items-baseline gap-2 font-sans text-sm font-semibold",
                      day < today && "text-muted-foreground",
                    )}
                  >
                    {formatLongDay(day)}
                    {day === today && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                        Bugün
                      </span>
                    )}
                  </h3>
                  <ul className="divide-y overflow-hidden rounded-2xl border">
                    {byDay.get(day)!.map((item) => (
                      <CalendarRow key={item.key} item={item} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )
        ) : (
          <table className="w-full table-fixed border-collapse" data-testid="calendar-grid">
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className="pb-1 text-xs font-medium text-muted-foreground"
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((day) => {
                    const items = byDay.get(day) ?? [];
                    const label = `${formatLongDay(day)}${items.length ? `, ${items.length} kayıt` : ""}`;
                    return (
                      <td key={day} className="p-0.5 align-top">
                        <Link
                          href={href({ ...view, day })}
                          scroll={false}
                          aria-label={label}
                          aria-current={day === selected ? "date" : undefined}
                          data-day={day}
                          data-count={items.length}
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
                          {items.length > 0 && (
                            <>
                              <span aria-hidden className="flex gap-0.5 md:hidden">
                                {items.slice(0, 3).map((item) => (
                                  <span
                                    key={item.key}
                                    className={cn(
                                      "size-1.5 rounded-full",
                                      item.struck ? "bg-border" : TONE[item.tone].dot,
                                    )}
                                  />
                                ))}
                              </span>
                              <span aria-hidden className="hidden space-y-0.5 md:block">
                                {items.slice(0, 2).map((item) => (
                                  <span
                                    key={item.key}
                                    className={cn(
                                      "block truncate rounded-md px-1.5 py-0.5 text-xs",
                                      item.struck
                                        ? "bg-muted text-muted-foreground line-through"
                                        : TONE[item.tone].chip,
                                    )}
                                  >
                                    {item.start && (
                                      <span className="tabular-nums">{item.start} </span>
                                    )}
                                    {item.title}
                                  </span>
                                ))}
                                {items.length > 2 && (
                                  <span className="block px-1.5 text-xs text-muted-foreground">
                                    +{items.length - 2}
                                  </span>
                                )}
                              </span>
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
        )}
      </div>

      {!list && (
        <section aria-labelledby="gun" className="space-y-3" data-testid="calendar-day">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="gun" className="text-xl font-medium">
              {selected === today ? "Bugün · " : ""}
              {formatLongDay(selected)}
            </h2>
            <AddButtons day={selected} />
          </div>
          {(byDay.get(selected) ?? []).length === 0 ? (
            <div className="space-y-2 rounded-2xl border border-dashed bg-card px-6 py-8 text-center">
              <CalendarDays aria-hidden className="mx-auto size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Bu günde takvimde bir şey yok.</p>
            </div>
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {byDay.get(selected)!.map((item) => (
                <CalendarRow key={item.key} item={item} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
