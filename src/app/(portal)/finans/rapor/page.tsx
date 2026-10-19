import { Download } from "lucide-react";
import { CsvRangeForm } from "@/components/finance/csv-range-form";
import { eyebrow, FinanceNav } from "@/components/finance/finance-nav";
import { MoneyAmount } from "@/components/finance/money-amount";
import { FilterChip } from "@/components/filter-chip";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import {
  categoryTotals,
  monthlyReport,
  reportYears,
  todayIstanbul,
  type ReportView,
} from "@/lib/finance/queries";
import { CATEGORY_LABELS } from "@/lib/labels";
import { formatKurus } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata = { title: "Finans raporu" };

const VIEWS: Record<string, ReportView> = { toplam: "total", kasa: "cash", banka: "bank" };
const monthOnly = new Intl.DateTimeFormat("tr-TR", { month: "long", timeZone: "UTC" });
const monthLabel = (m: string) => monthOnly.format(new Date(`${m}-01T00:00:00Z`));

function signedTransfer(kurus: number) {
  if (kurus === 0) return <span className="text-muted-foreground tabular-nums">—</span>;
  return (
    <span className="whitespace-nowrap text-muted-foreground tabular-nums">
      <span className="sr-only">Virman </span>
      {kurus > 0 ? "+" : "−"}
      {formatKurus(kurus)}
    </span>
  );
}

export default async function ReportPage({ searchParams }: PageProps<"/finans/rapor">) {
  await requireManager();
  const sp = await searchParams;
  const years = await reportYears();
  const year =
    typeof sp.yil === "string" && years.includes(sp.yil) ? sp.yil : todayIstanbul().slice(0, 4);
  const viewKey = typeof sp.hesap === "string" && sp.hesap in VIEWS ? sp.hesap : "toplam";
  const view = VIEWS[viewKey];
  const [report, categories] = await Promise.all([monthlyReport(year, view), categoryTotals(year)]);
  const perAccount = view !== "total";
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ yil: year, hesap: viewKey, ...patch });
    return `/finans/rapor?${q}`;
  };
  const shareList = (items: { category: string; total: number }[], kind: "income" | "expense") => {
    const sum = items.reduce((s, i) => s + i.total, 0);
    return items.length === 0 ? (
      <p className="text-sm text-muted-foreground">Kayıt yok.</p>
    ) : (
      <ul className="space-y-3">
        {items.map((i) => {
          const pct = sum ? Math.round((i.total / sum) * 100) : 0;
          return (
            <li key={i.category} className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <span>{CATEGORY_LABELS[i.category as keyof typeof CATEGORY_LABELS]}</span>
                <span className="tabular-nums">
                  {formatKurus(i.total)} <span className="text-muted-foreground">%{pct}</span>
                </span>
              </div>
              <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    kind === "income" ? "bg-present" : "bg-foreground/40",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-medium">Rapor</h1>
        <a
          href="#csv"
          className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
        >
          <Download />
          Muhasebe CSV
        </a>
      </div>
      <FinanceNav active="rapor" />
      <nav aria-label="Yıl" className="flex flex-wrap gap-2">
        {years.map((y) => (
          <FilterChip key={y} href={href({ yil: y })} active={y === year} label={y} />
        ))}
      </nav>
      <nav aria-label="Hesap" className="flex flex-wrap gap-2">
        <FilterChip href={href({ hesap: "toplam" })} active={viewKey === "toplam"} label="Toplam" />
        <FilterChip href={href({ hesap: "kasa" })} active={viewKey === "kasa"} label="Kasa" />
        <FilterChip href={href({ hesap: "banka" })} active={viewKey === "banka"} label="Banka" />
      </nav>

      {report.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Bu yıl kayıt yok.
        </p>
      ) : (
        <section aria-labelledby="aylik" className="space-y-3">
          <h2 id="aylik" className="text-2xl font-medium">
            Aylık bakiye
          </h2>
          <ol className="space-y-3 lg:hidden">
            {report.rows.map((r) => (
              <li
                key={r.month}
                data-testid="report-row"
                data-month={r.month}
                className="rounded-2xl border bg-card p-4"
              >
                <p className="mb-2 font-medium capitalize">{monthLabel(r.month)}</p>
                <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Devir</dt>
                  <dd className="text-right" data-cell="carry" data-kurus={r.carry}>
                    <MoneyAmount kurus={r.carry} kind="balance" />
                  </dd>
                  <dt className="text-muted-foreground">Gelir</dt>
                  <dd className="text-right" data-cell="income" data-kurus={r.income}>
                    <MoneyAmount kurus={r.income} kind="income" />
                  </dd>
                  <dt className="text-muted-foreground">Gider</dt>
                  <dd className="text-right" data-cell="expense" data-kurus={r.expense}>
                    <MoneyAmount kurus={r.expense} kind="expense" />
                  </dd>
                  {perAccount && (
                    <>
                      <dt className="text-muted-foreground">Virman</dt>
                      <dd className="text-right" data-cell="transfer" data-kurus={r.transfer}>
                        {signedTransfer(r.transfer)}
                      </dd>
                    </>
                  )}
                  <dt className="font-medium">Kapanış</dt>
                  <dd className="text-right font-medium" data-cell="closing" data-kurus={r.closing}>
                    <MoneyAmount kurus={r.closing} kind="balance" />
                  </dd>
                </dl>
              </li>
            ))}
          </ol>
          <div className="hidden overflow-hidden rounded-2xl border bg-card lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {year} aylık bakiye ({viewKey})
              </caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Ay
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Devir
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Gelir
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Gider
                  </th>
                  {perAccount && (
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Virman
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Net
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Kapanış
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.map((r) => (
                  <tr key={r.month} data-testid="report-row" data-month={r.month}>
                    <th scope="row" className="px-4 py-3 text-left font-medium capitalize">
                      {monthLabel(r.month)}
                    </th>
                    <td className="px-4 py-3 text-right" data-cell="carry" data-kurus={r.carry}>
                      <MoneyAmount kurus={r.carry} kind="balance" />
                    </td>
                    <td className="px-4 py-3 text-right" data-cell="income" data-kurus={r.income}>
                      <MoneyAmount kurus={r.income} kind="income" />
                    </td>
                    <td className="px-4 py-3 text-right" data-cell="expense" data-kurus={r.expense}>
                      <MoneyAmount kurus={r.expense} kind="expense" />
                    </td>
                    {perAccount && (
                      <td
                        className="px-4 py-3 text-right"
                        data-cell="transfer"
                        data-kurus={r.transfer}
                      >
                        {signedTransfer(r.transfer)}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <MoneyAmount kurus={r.net} kind="balance" />
                    </td>
                    <td
                      className="px-4 py-3 text-right font-medium"
                      data-cell="closing"
                      data-kurus={r.closing}
                    >
                      <MoneyAmount kurus={r.closing} kind="balance" />
                    </td>
                  </tr>
                ))}
              </tbody>
              {report.totals && (
                <tfoot className="border-t bg-muted/30 font-medium">
                  <tr>
                    <th scope="row" className="px-4 py-3 text-left">
                      Yıl
                    </th>
                    <td />
                    <td
                      className="px-4 py-3 text-right"
                      data-testid="year-income"
                      data-kurus={report.totals.income}
                    >
                      <MoneyAmount kurus={report.totals.income} kind="income" />
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      data-testid="year-expense"
                      data-kurus={report.totals.expense}
                    >
                      <MoneyAmount kurus={report.totals.expense} kind="expense" />
                    </td>
                    {perAccount && (
                      <td className="px-4 py-3 text-right">
                        {signedTransfer(report.totals.transfer)}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <MoneyAmount
                        kurus={report.totals.income - report.totals.expense}
                        kind="balance"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyAmount kurus={report.totals.closing} kind="balance" />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="kalemler" className="space-y-3">
        <h2 id="kalemler" className="text-2xl font-medium">
          {year} kalemleri
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border bg-card p-4">
            <h3 className={eyebrow}>Gelir kalemleri</h3>
            {shareList(categories.income, "income")}
          </div>
          <div className="space-y-3 rounded-2xl border bg-card p-4">
            <h3 className={eyebrow}>Gider kalemleri</h3>
            {shareList(categories.expense, "expense")}
          </div>
        </div>
      </section>

      <section
        id="csv"
        aria-labelledby="csv-baslik"
        className="scroll-mt-20 space-y-3 rounded-2xl border bg-card p-4"
      >
        <h2 id="csv-baslik" className="text-xl font-medium">
          Muhasebe CSV
        </h2>
        <CsvRangeForm from={`${year}-01-01`} to={`${year}-12-31`} />
      </section>
    </div>
  );
}
