import { Calculator, Plus } from "lucide-react";
import Link from "next/link";
import { CurrentChip, StatusChip } from "@/components/budget/report";
import { FinanceNav } from "@/components/finance/finance-nav";
import { buttonVariants } from "@/components/ui/button";
import { elapsedPercent } from "@/lib/finance/budget";
import { listBudgets, todayIstanbul } from "@/lib/finance/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Bütçe" };

const side = (label: string, pct: number | null) => `${label} ${pct === null ? "—" : `%${pct}`}`;

export default async function BudgetsPage() {
  const budgets = await listBudgets();
  const today = todayIstanbul();
  const newButton = (
    <Link href="/finans/butce/yeni" className={cn(buttonVariants(), "h-11 rounded-full px-4")}>
      <Plus />
      Yeni bütçe
    </Link>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-medium">Bütçe</h1>
        {newButton}
      </div>
      <FinanceNav active="butce" />
      {budgets.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <Calculator aria-hidden className="mx-auto size-8 text-muted-foreground" />
          <p className="font-medium">Henüz bütçe yok.</p>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Sezon başında planı yaz; portal yıl boyunca gerçekleşenle karşılaştırır.
          </p>
          {newButton}
        </div>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => (
            <li
              key={b.id}
              data-testid="budget-row"
              data-id={b.id}
              data-status={b.status}
              data-current={b.current || undefined}
            >
              <Link
                href={`/finans/butce/${b.id}`}
                className="block space-y-1.5 rounded-2xl border bg-card p-4 outline-none hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-medium [overflow-wrap:anywhere]">{b.name}</span>
                  <StatusChip status={b.status} />
                  {b.current && <CurrentChip />}
                </span>
                <span className="block text-sm text-muted-foreground">{b.rangeLabel}</span>
                {b.phase !== "future" && (
                  <span data-testid="budget-row-pct" className="block text-sm tabular-nums">
                    {side("Gelir", b.incomePct)} · {side("Gider", b.expensePct)} (plana göre)
                  </span>
                )}
                {b.current && (
                  <span aria-hidden className="block h-1.5 rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-foreground/60"
                      style={{ width: `${elapsedPercent(b.startMonth, today)}%` }}
                    />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
