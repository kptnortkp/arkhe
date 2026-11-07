import { notFound } from "next/navigation";
import { BackLink } from "@/components/board/back-link";
import { IssueStatusChip } from "@/components/reports/issue-status-chip";
import { requireUser } from "@/lib/auth/dal";
import { partLabel } from "@/lib/labels";
import { isReportHandler, reportByNumber } from "@/lib/reports/queries";
import { formatAuditDateTime } from "@/lib/time";
import { ReportStatusForm } from "./status-form";

// Generic on purpose: a non-handler's 404 must look like any unknown page's.
export const metadata = { title: "Sorun bildirimi" };

export default async function ReportDetailPage({ params }: PageProps<"/sorunlar/[numara]">) {
  const user = await requireUser();
  if (!(await isReportHandler(user.id))) notFound();
  const { numara } = await params;
  const number = /^[1-9]\d{0,8}$/.test(numara) ? Number(numara) : null;
  const r = number ? await reportByNumber(number) : null;
  if (!r) notFound();
  const part = r.reporter.voicePart
    ? partLabel(r.reporter.voicePart, r.reporter.voiceSection)
    : null;

  return (
    <div className="max-w-3xl space-y-5">
      <BackLink href="/sorunlar">Sorunlara dön</BackLink>
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
          <span data-testid="report-number">Sorun #{r.number}</span>
          <IssueStatusChip status={r.status} />
        </div>
        <h1 className="text-2xl leading-tight font-medium [overflow-wrap:anywhere] md:text-3xl">
          {r.title}
        </h1>
      </header>

      <dl
        data-testid="report-facts"
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-2xl border bg-card p-4 text-sm"
      >
        <dt className="text-muted-foreground">Bildiren</dt>
        <dd data-testid="report-reporter">
          {r.reporter.name}
          {part && <span className="text-muted-foreground"> · {part}</span>}
        </dd>
        <dt className="text-muted-foreground">Zaman</dt>
        <dd>{formatAuditDateTime(r.createdAt)}</dd>
        <dt className="text-muted-foreground">Sayfa</dt>
        <dd className="[overflow-wrap:anywhere]" data-testid="report-page">
          {r.page ?? <span className="text-muted-foreground">Bilinmiyor</span>}
        </dd>
        <dt className="text-muted-foreground">Cihaz</dt>
        <dd className="[overflow-wrap:anywhere]" data-testid="report-device">
          {r.device ?? <span className="text-muted-foreground">Bilinmiyor</span>}
        </dd>
      </dl>

      <p
        data-testid="report-body"
        className="text-[15px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap"
      >
        {r.body}
      </p>

      {r.images.length > 0 && (
        <section aria-labelledby="goruntuler" className="space-y-2">
          <h2 id="goruntuler" className="text-lg font-medium">
            Ekran görüntüleri
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="report-images">
            {r.images.map((img, i) => (
              <li key={img.id}>
                <a
                  href={`/api/dosya/sorun/${img.id}`}
                  target="_blank"
                  rel="noopener"
                  className="block overflow-hidden rounded-xl border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- an authorized, uncached file route */}
                  <img
                    src={`/api/dosya/sorun/${img.id}`}
                    alt={`Ekran görüntüsü ${i + 1}`}
                    loading="lazy"
                    className="aspect-[3/4] w-full object-cover object-top"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.images.length === 0 && r.closedAt && (
        <p className="text-xs text-muted-foreground">
          Kapalı bildirimlerin ekran görüntüleri 90 gün sonra silinir.
        </p>
      )}

      <ReportStatusForm number={r.number} status={r.status} reply={r.reply} />
    </div>
  );
}
