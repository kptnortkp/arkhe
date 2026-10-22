import { Download, NotebookPen, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/board/back-link";
import { ApproveButton, DeleteBudgetButton } from "@/components/budget/budget-actions";
import { CurrentChip, History, LineCard, StatusChip, Summary } from "@/components/budget/report";
import { buttonVariants } from "@/components/ui/button";
import { CASH_NOTE } from "@/lib/finance/budget";
import { budgetReport } from "@/lib/finance/queries";
import { formatAuditDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/finans/butce/[id]">) {
  const r = await budgetReport((await params).id);
  return { title: r ? `${r.name} · Bütçe` : "Bütçe" };
}

export default async function BudgetReportPage({ params }: PageProps<"/finans/butce/[id]">) {
  const { id } = await params;
  const r = await budgetReport(id);
  if (!r) notFound();
  const draft = r.status === "draft";
  const outline = cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4");
  const csv = `/finans/butce/${r.id}/csv`;
  const groups = [
    { kind: "income" as const, title: "Gelir" },
    { kind: "expense" as const, title: "Gider" },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href="/finans/butce">Bütçeler</BackLink>
        <h1 className="text-3xl font-medium [overflow-wrap:anywhere] md:text-4xl">{r.name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span data-testid="budget-range">{r.rangeLabel}</span>
          <StatusChip status={r.status} />
          {r.phase === "running" && <CurrentChip />}
        </p>
        {r.approved && (
          <p data-testid="budget-approved" className="text-xs text-muted-foreground">
            Onaylayan: {r.approved.name} · {formatAuditDate(r.approved.at)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {draft ? (
          <ApproveButton id={r.id} revision={r.revision} />
        ) : (
          <Link href={`/finans/butce/${r.id}/duzenle`} className={outline}>
            <Pencil />
            Planı değiştir
          </Link>
        )}
        <a href={csv} download className={cn(outline, "max-lg:hidden")}>
          <Download />
          CSV indir
        </a>
      </div>

      {draft && (
        <p className="rounded-2xl border border-dashed p-4 text-sm">
          Bu bütçe taslak. Kurulda ya da genel kurulda kabul edilince Onayla&apos;ya bas.
        </p>
      )}
      {r.note && (
        <p
          data-testid="budget-note"
          className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground"
        >
          {r.note}
        </p>
      )}

      <Summary report={r} />
      <p data-testid="cash-note" className="-mt-3 text-xs text-muted-foreground">
        {CASH_NOTE}
      </p>

      {r.lines.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Planda tutar yok ve bu dönemde kayıt yok. Planı yazmak için Planı düzenle&apos;ye bas.
        </p>
      ) : (
        <>
          {r.phase === "running" && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span aria-hidden className="h-3 w-0.5 rounded-full bg-foreground/60" />
              Dönemin geçen kısmı
            </p>
          )}
          {groups.map(({ kind, title }) => {
            const lines = r.lines.filter((l) => l.kind === kind);
            if (!lines.length) return null;
            return (
              <section key={kind} aria-labelledby={`grup-${kind}`} className="space-y-3">
                <h2
                  id={`grup-${kind}`}
                  className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
                >
                  {title}
                </h2>
                <ul className="grid gap-3 lg:grid-cols-2">
                  {lines.map((l) => (
                    <LineCard key={l.category} line={l} elapsed={r.elapsedPct} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      <History report={r} />

      <section aria-labelledby="islemler" className="space-y-3">
        <h2 id="islemler" className="text-xl font-medium">
          Bütçe işlemleri
        </h2>
        <div className="flex flex-wrap gap-2">
          {draft && (
            <Link href={`/finans/butce/${r.id}/duzenle`} className={outline}>
              <Pencil />
              Planı düzenle
            </Link>
          )}
          <Link href={`/finans/butce/${r.id}/bilgiler`} className={outline}>
            <NotebookPen />
            {draft ? "Bilgileri düzenle" : "Notu düzenle"}
          </Link>
          <a href={csv} download className={cn(outline, "lg:hidden")}>
            <Download />
            CSV indir
          </a>
          {draft && <DeleteBudgetButton id={r.id} name={r.name} />}
        </div>
        <p className="text-xs text-muted-foreground lg:hidden">CSV, Excel&apos;de Türkçe açılır.</p>
      </section>
    </div>
  );
}
