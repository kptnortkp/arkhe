import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { UndoButton } from "@/components/import/undo-button";
import { Pager, pageParam } from "@/components/pager";
import { listBatches } from "@/lib/import/queries";
import { formatAuditDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "İçe aktarma geçmişi" };
// undoImport runs as an action of this page.
export const maxDuration = 60;

const FINANCE = new Set(["hareketler", "aidat-odemeleri"]);

export default async function ImportLogPage({ searchParams }: PageProps<"/ice-aktar/gecmis">) {
  const page = pageParam((await searchParams).sayfa);
  const { batches, hasMore } = await listBatches(page);
  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/ice-aktar"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Veri içe aktar
        </Link>
        <h1 className="text-4xl font-medium">İçe aktarma geçmişi</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          En son aktarımı geri alabilirsin. Daha eskisine dönmek için önce sonrakileri geri al.
        </p>
      </div>
      {batches.length === 0 ? (
        <div className="space-y-2 rounded-2xl border bg-card p-4 md:p-6">
          <p className="text-sm">Henüz içe aktarma yapılmadı.</p>
          <Link
            href="/ice-aktar"
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
          >
            Adımlara dön
          </Link>
        </div>
      ) : (
        <ol className="space-y-2">
          {batches.map((b) => (
            <li
              key={b.id}
              className="space-y-1 rounded-2xl border bg-card p-4"
              data-testid="batch-row"
              data-batch={b.id}
            >
              <p className="flex items-start justify-between gap-3">
                <span className="font-medium">{b.title}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                    b.undone ? "bg-muted text-muted-foreground" : "bg-present/14 text-present-ink",
                  )}
                  data-testid="batch-status"
                >
                  {b.undone ? "Geri alındı" : "Aktarıldı"}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {formatAuditDateTime(b.createdAt)} · {b.by}
              </p>
              <p className="truncate text-sm" title={b.fileName}>
                {b.fileName}
              </p>
              <p className="text-sm tabular-nums">
                {b.counts.added} eklendi · {b.counts.updated} güncellendi · {b.counts.unchanged}{" "}
                değişmedi
              </p>
              <p className="font-mono text-xs text-muted-foreground">SHA-256 {b.sha12}</p>
              {b.undone && (
                <p className="text-sm text-muted-foreground">
                  Geri alındı · {b.undone.by} · {formatAuditDateTime(b.undone.at)}
                </p>
              )}
              {b.canUndo ? (
                <div className="pt-2">
                  <UndoButton
                    batchId={b.id}
                    added={b.counts.added}
                    updated={b.counts.updated}
                    finance={FINANCE.has(b.slug)}
                  />
                </div>
              ) : (
                b.latest && (
                  <p className="pt-1 text-sm text-muted-foreground">
                    Bunu yalnızca yapan kişi ya da koro şefi geri alabilir.
                  </p>
                )
              )}
            </li>
          ))}
        </ol>
      )}
      <Pager
        page={page}
        hasMore={hasMore}
        label="İçe aktarma geçmişi sayfaları"
        href={(n) => (n === 1 ? "/ice-aktar/gecmis" : `/ice-aktar/gecmis?sayfa=${n}`)}
      />
    </div>
  );
}
