import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { FinanceNav } from "@/components/finance/finance-nav";
import { PeriodRowActions, PeriodToolbar } from "@/components/finance/period-forms";
import { requireManager } from "@/lib/auth/dal";
import { duesMatrix, periodSummary, todayIstanbul } from "@/lib/finance/queries";
import { amountInput, formatKurus } from "@/lib/money";
import { dayInstant, formatShortDate } from "@/lib/time";

export const metadata = { title: "Aidat dönemleri" };

export default async function PeriodsPage() {
  await requireManager();
  const today = todayIstanbul();
  const { periods, members } = await duesMatrix(today);
  const rows = [...periods].reverse();
  return (
    <div className="space-y-5">
      <Link
        href="/finans/aidat"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Aidat
      </Link>
      <h1 className="text-4xl font-medium">Dönemler</h1>
      <FinanceNav active="aidat" />
      <PeriodToolbar existing={periods.map((p) => p.name)} />
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Henüz aidat dönemi yok.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((p) => {
            const s = periodSummary(members, p.id);
            const locked = members.some((m) => (m.cells.get(p.id)?.status.paid ?? 0) > 0);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
                data-testid="period-row"
                data-name={p.name}
              >
                <Link
                  href={`/finans/aidat?donem=${p.id}`}
                  className="min-w-0 flex-1 space-y-0.5 hover:underline"
                >
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatShortDate.format(dayInstant(p.startsOn))}–
                    {formatShortDate.format(dayInstant(p.endsOn))} · son ödeme{" "}
                    {formatShortDate.format(dayInstant(p.dueOn))}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatKurus(p.amountKurus)}
                    {p.reducedAmountKurus !== null &&
                      ` / ${formatKurus(p.reducedAmountKurus)}`} · {s.paidCount}/{s.owingCount}{" "}
                    ödendi
                  </span>
                </Link>
                <PeriodRowActions
                  period={{
                    id: p.id,
                    name: p.name,
                    startsOn: p.startsOn,
                    endsOn: p.endsOn,
                    dueOn: p.dueOn,
                    amount: amountInput(p.amountKurus),
                    reducedAmount:
                      p.reducedAmountKurus === null ? "" : amountInput(p.reducedAmountKurus),
                    locked,
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
