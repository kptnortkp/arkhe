import Link from "next/link";
import { EventToolbar } from "@/components/finance/event-forms";
import { FinanceNav } from "@/components/finance/finance-nav";
import { NetLabel } from "@/components/finance/net-label";
import { requireManager } from "@/lib/auth/dal";
import { concertsWithoutEvent, listEvents, todayIstanbul } from "@/lib/finance/queries";
import { dayInstant, formatShortDate, formatWeekdayShort, istanbulDateOf } from "@/lib/time";

export const metadata = { title: "Etkinlikler" };

export default async function EventsPage() {
  await requireManager();
  const [rows, concerts] = await Promise.all([listEvents(), concertsWithoutEvent()]);
  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-medium">Etkinlikler</h1>
      <FinanceNav active="etkinlikler" />
      <EventToolbar
        today={todayIstanbul()}
        concerts={concerts.map((c) => {
          const name = c.title ?? "Konser";
          return {
            id: c.id,
            name,
            startsOn: istanbulDateOf(c.startsAt),
            label: `${name} · ${formatShortDate.format(c.startsAt)} ${formatWeekdayShort.format(c.startsAt)}`,
          };
        })}
      />
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Henüz etkinlik yok.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((e) => (
            <li key={e.id} data-testid="event-row" data-name={e.name}>
              <Link
                href={`/finans/etkinlikler/${e.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatShortDate.format(dayInstant(e.startsOn))}
                  </span>
                </span>
                <NetLabel net={e.net} empty={e.count === 0} className="text-sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
