import { ChevronRight, ImageIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterChip } from "@/components/filter-chip";
import { IssueStatusChip } from "@/components/reports/issue-status-chip";
import { requireUser } from "@/lib/auth/dal";
import {
  isReportHandler,
  listReports,
  REPORT_FILTERS,
  reportCounts,
  type ReportFilter,
} from "@/lib/reports/queries";
import { formatAuditDate } from "@/lib/time";

export const metadata = { title: "Sorunlar" };

const FILTER_LABELS: Record<ReportFilter, string> = { acik: "Açık", kapali: "Kapalı", tumu: "Tümü" };

export default async function ReportsPage({ searchParams }: PageProps<"/sorunlar">) {
  const user = await requireUser();
  // Everyone but the handler sees the same 404 as an unknown page.
  if (!(await isReportHandler(user.id))) notFound();
  const { durum } = await searchParams;
  const filter = (REPORT_FILTERS as readonly unknown[]).includes(durum)
    ? (durum as ReportFilter)
    : "acik";
  const [rows, counts] = await Promise.all([listReports(filter), reportCounts()]);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-medium">Sorunlar</h1>
        <p className="text-sm text-muted-foreground">Koristlerin gönderdiği sorun bildirimleri.</p>
      </header>
      <nav aria-label="Durum" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {REPORT_FILTERS.map((f) => (
          <FilterChip
            key={f}
            href={f === "acik" ? "/sorunlar" : `/sorunlar?durum=${f}`}
            active={filter === f}
            label={FILTER_LABELS[f]}
            count={counts[f]}
          />
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {filter === "acik" ? "Açık bildirim yok." : "Bildirim yok."}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card" data-testid="report-list">
          {rows.map((r) => (
            <li key={r.id} data-number={r.number}>
              <Link
                href={`/sorunlar/${r.number}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    <span className="text-muted-foreground tabular-nums">#{r.number}</span> {r.title}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                    {r.reporterName} · {formatAuditDate(r.createdAt)}
                    {r.images > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        · <ImageIcon aria-hidden className="size-3" />
                        {r.images}
                      </span>
                    )}
                  </p>
                </div>
                <IssueStatusChip status={r.status} />
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
