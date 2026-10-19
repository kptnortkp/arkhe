import { ChevronRight, CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { getPaymentInfo, kasaSummary, myDues } from "@/lib/finance/queries";
import { DuesChip } from "./dues-chip";
import { MoneyAmount } from "./money-amount";
import { formatKurus } from "@/lib/money";

function CardHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="text-2xl font-medium">{title}</h2>
      <Link
        href={href}
        className="-my-2 inline-flex min-h-11 items-center gap-0.5 px-1 text-sm font-medium text-primary hover:underline"
      >
        {linkLabel}
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}

/** Managers: total balance, this month and who hasn't paid the current period. */
export async function KasaCard() {
  const k = await kasaSummary();
  return (
    <section className="space-y-4" data-testid="home-kasa">
      <CardHeader title="Kasa" href="/finans" linkLabel="Finans" />
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <Link href="/finans" className="block space-y-1 hover:opacity-90">
          <span className="block text-xs text-muted-foreground">Toplam bakiye</span>
          <span
            className="block text-3xl font-semibold"
            data-testid="home-kasa-total"
            data-kurus={k.total}
          >
            <MoneyAmount kurus={k.total} kind="balance" />
          </span>
          <span className="block text-sm tabular-nums">
            Bu ay: <MoneyAmount kurus={k.month.income} kind="income" /> gelir ·{" "}
            <MoneyAmount kurus={k.month.expense} kind="expense" /> gider
          </span>
        </Link>
        {k.current && (
          <Link
            href={`/finans/aidat?donem=${k.current.id}&filtre=borclu`}
            className="flex min-h-11 items-center gap-2 text-sm hover:underline"
            data-testid="home-kasa-debtors"
          >
            {k.debtors > 0 ? (
              <>
                <CircleAlert className="size-4 text-late-ink" aria-hidden />
                {k.debtors} kişi {k.current.name} aidatını ödemedi
              </>
            ) : (
              <>
                <CircleCheck className="size-4 text-present-ink" aria-hidden />
                {k.current.name} aidatı tamam.
              </>
            )}
          </Link>
        )}
      </div>
    </section>
  );
}

/** Singers with something left to pay; hidden otherwise. */
export async function MyDuesCard() {
  const mine = await myDues();
  if (!mine || mine.remaining === 0) return null;
  const info = await getPaymentInfo();
  const open = mine.rows
    .filter((r) => r.status.remaining > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const urgent = open.find((r) => r.status.state === "overdue") ?? open[0];
  return (
    <section className="space-y-4" data-testid="home-dues">
      <CardHeader title="Aidatım" href="/profil#aidat" linkLabel="Ayrıntı" />
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <p className="text-2xl font-semibold tabular-nums" data-testid="home-dues-remaining">
          Kalan borcun {formatKurus(mine.remaining)}
        </p>
        {urgent && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {urgent.name}
            <DuesChip status={urgent.status} solid />
          </p>
        )}
        {open.length > 1 && (
          <p className="text-sm text-muted-foreground">+{open.length - 1} dönem daha</p>
        )}
        {info && <CopyButton text={info} label="IBAN'ı kopyala" />}
      </div>
    </section>
  );
}
