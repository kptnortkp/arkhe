import { ArrowLeftRight, ChevronRight, Minus, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { BalanceTiles } from "@/components/finance/balance-tiles";
import { EntryRow } from "@/components/finance/entry-row";
import { eyebrow, FinanceNav } from "@/components/finance/finance-nav";
import { MoneyAmount } from "@/components/finance/money-amount";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import { periodNameOf } from "@/lib/finance/dues";
import {
  balances,
  currentPeriodOf,
  duesMatrix,
  monthSummary,
  periodSummary,
  recentEntries,
  todayIstanbul,
} from "@/lib/finance/queries";
import { formatKurus } from "@/lib/money";
import { dayInstant, formatShortDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Finans" };

const link =
  "-my-2 inline-flex min-h-11 items-center gap-0.5 px-1 text-sm font-medium text-primary hover:underline";

export default async function FinancePage() {
  await requireManager();
  const today = todayIstanbul();
  const month = today.slice(0, 7);
  const [b, summary, recent, matrix] = await Promise.all([
    balances(),
    monthSummary(month),
    recentEntries(10),
    duesMatrix(today),
  ]);
  const current = currentPeriodOf(matrix.periods, today);
  const dues = current ? periodSummary(matrix.members, current.id) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-4xl font-medium">Finans</h1>
          <div className="hidden gap-2 md:flex">
            <Link
              href="/finans/yeni?tur=gelir&geri=/finans"
              className={cn(buttonVariants(), "h-11 rounded-full px-4")}
            >
              <Plus />
              Gelir ekle
            </Link>
            <Link
              href="/finans/yeni?tur=gider&geri=/finans"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
            >
              <Minus />
              Gider ekle
            </Link>
            <Link
              href="/finans/yeni?tur=virman&geri=/finans"
              className={cn(buttonVariants({ variant: "ghost" }), "h-11 rounded-full px-4")}
            >
              <ArrowLeftRight />
              Virman
            </Link>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {periodNameOf(month)}
          {b.lastEntryOn && ` · son kayıt ${formatShortDate.format(dayInstant(b.lastEntryOn))}`}
        </p>
      </div>
      <FinanceNav active="ozet" />

      {!b.lastEntryOn ? (
        <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 pt-10 pb-12 text-center">
          <Wallet className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Henüz kayıt yok.</p>
          <p className="text-sm text-muted-foreground">
            Önce Ayarlar&apos;dan açılış bakiyesini gir, sonra gelir ve giderleri ekle.
          </p>
          <Link href="/finans/ayarlar" className={cn(buttonVariants(), "h-11 rounded-full px-5")}>
            Açılış bakiyesi gir
          </Link>
        </div>
      ) : (
        <BalanceTiles cash={b.cash} bank={b.bank} total={b.total} />
      )}

      <div className="grid grid-cols-2 gap-3 md:hidden">
        <Link
          href="/finans/yeni?tur=gelir&geri=/finans"
          className={cn(buttonVariants(), "h-12 rounded-2xl")}
        >
          <Plus />
          Gelir ekle
        </Link>
        <Link
          href="/finans/yeni?tur=gider&geri=/finans"
          className={cn(buttonVariants({ variant: "outline" }), "h-12 rounded-2xl")}
        >
          <Minus />
          Gider ekle
        </Link>
        <Link
          href="/finans/yeni?tur=virman&geri=/finans"
          className={cn(buttonVariants({ variant: "ghost" }), "col-span-2 h-11 rounded-2xl")}
        >
          <ArrowLeftRight />
          Virman (Kasa ↔ Banka)
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          className="space-y-3 rounded-2xl border bg-card p-4"
          aria-labelledby="bu-ay"
          data-testid="month-summary"
        >
          <h2 id="bu-ay" className="text-lg font-medium">
            Bu ay
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt>Gelir</dt>
              <dd data-testid="month-income">
                <MoneyAmount kurus={summary.income} kind="income" />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Gider</dt>
              <dd data-testid="month-expense">
                <MoneyAmount kurus={summary.expense} kind="expense" />
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
              <dt>Net</dt>
              <dd data-testid="month-net">
                <MoneyAmount kurus={summary.net} kind="balance" />
              </dd>
            </div>
          </dl>
          <Link href="/finans/rapor" className={link}>
            Aylık rapor
            <ChevronRight className="size-4" />
          </Link>
        </section>

        <section className="space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="aidat-ozet">
          {current && dues ? (
            <>
              <h2 id="aidat-ozet" className="text-lg font-medium">
                {current.name} aidatı
              </h2>
              <p className="text-sm tabular-nums" data-testid="dues-summary">
                {dues.paidCount}/{dues.owingCount} ödendi ·{" "}
                {formatKurus(dues.expected - Math.min(dues.collected, dues.expected))} kalan
              </p>
              <div
                role="img"
                aria-label={`${dues.paidCount}/${dues.owingCount} ödendi`}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-present"
                  style={{
                    width: `${dues.expected ? (Math.min(dues.collected, dues.expected) / dues.expected) * 100 : 0}%`,
                  }}
                />
              </div>
              {dues.overdue > 0 && (
                <p className="text-sm text-absent-ink">{dues.overdue} kişi gecikti</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/finans/aidat?donem=${current.id}&filtre=borclu`}
                  className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
                >
                  Ödeme al
                </Link>
                <Link href={`/finans/aidat?donem=${current.id}`} className={link}>
                  Aidat listesi
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2 id="aidat-ozet" className="text-lg font-medium">
                Aidat
              </h2>
              <p className="text-sm text-muted-foreground">Henüz aidat dönemi yok.</p>
              <Link href="/finans/aidat/donemler" className={link}>
                Dönem oluştur
                <ChevronRight className="size-4" />
              </Link>
            </>
          )}
        </section>
      </div>

      {recent.length > 0 && (
        <section className="space-y-2" aria-labelledby="son">
          <h2 id="son" className={eyebrow}>
            Son hareketler
          </h2>
          <ul
            className="divide-y overflow-hidden rounded-2xl border bg-card"
            data-testid="recent-entries"
          >
            {recent.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
          <Link href="/finans/hareketler" className={link}>
            Tüm hareketler
            <ChevronRight className="size-4" />
          </Link>
        </section>
      )}
    </div>
  );
}
