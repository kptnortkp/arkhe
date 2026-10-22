import { Archive, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { BackLink } from "@/components/board/back-link";
import { buttonVariants } from "@/components/ui/button";
import { getArchive } from "@/lib/board/queries";
import { UNASSIGNED } from "@/lib/board/rules";
import { formatAuditDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Arşiv · Yönetim Kurulu" };

export default async function ArchivePage({ searchParams }: PageProps<"/yonetim/arsiv">) {
  const { sayfa } = await searchParams;
  const archive = await getArchive(sayfa);
  const pager = cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4");
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href="/yonetim?sutun=bitti">Panoya dön</BackLink>
        <h1 className="text-3xl font-medium">Arşiv</h1>
        <p className="text-sm text-muted-foreground">
          30 günden uzun süredir Bitti&apos;de duran işler. Hiçbiri silinmez.
        </p>
      </div>
      {archive.rows.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <Archive aria-hidden className="mx-auto size-8 text-muted-foreground" />
          <p className="font-medium">Arşivde iş yok.</p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {archive.rows.map((t) => (
            <li key={t.number} data-testid="archive-row" data-number={t.number}>
              <Link
                href={`/yonetim/${t.number}`}
                prefetch={false}
                className="block min-h-16 space-y-1 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">
                  <span className="text-muted-foreground tabular-nums">#{t.number}</span> {t.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Bitti{t.doneAt && ` · ${formatAuditDate(t.doneAt)}`} ·{" "}
                  {t.assignee?.name ?? UNASSIGNED}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(archive.hasNewer || archive.hasOlder) && (
        <nav aria-label="Sayfalar" className="flex justify-between gap-3">
          {archive.hasNewer ? (
            <Link
              href={
                archive.page === 2 ? "/yonetim/arsiv" : `/yonetim/arsiv?sayfa=${archive.page - 1}`
              }
              className={pager}
            >
              <ChevronLeft />
              Daha yeni
            </Link>
          ) : (
            <span />
          )}
          {archive.hasOlder && (
            <Link href={`/yonetim/arsiv?sayfa=${archive.page + 1}`} className={pager}>
              Daha eski
              <ChevronRight />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
