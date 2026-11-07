import { ImageIcon } from "lucide-react";
import { IssueStatusChip } from "@/components/reports/issue-status-chip";
import { requireUser } from "@/lib/auth/dal";
import { myReports } from "@/lib/reports/queries";
import { formatAuditDate } from "@/lib/time";
import { ReportForm } from "./report-form";

export const metadata = { title: "Sorun bildir" };

/** `?from=/odevler/abc`: a same-site path only. */
function fromParam(v: string | string[] | undefined) {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.startsWith("/") && !s.startsWith("//") && s.length <= 300 ? s : null;
}

export default async function ReportPage({ searchParams }: PageProps<"/sorun-bildir">) {
  const user = await requireUser();
  const [{ from }, reports] = await Promise.all([searchParams, myReports(user.id)]);
  const build = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
  return (
    <div className="max-w-xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-medium">Sorun bildir</h1>
        <p className="text-sm text-muted-foreground">
          Portalda bir şey ters gittiyse buradan yaz. Bildirimini yalnızca sen ve portalın bakımını
          yapan kişi görür.
        </p>
      </header>

      <ReportForm from={fromParam(from)} build={build} />

      <section aria-labelledby="bildirimlerim" className="space-y-3">
        <h2 id="bildirimlerim" className="text-xl font-medium">
          Bildirimlerim
        </h2>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="my-reports-empty">
            Henüz bildirim göndermedin.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="my-reports">
            {reports.map((r) => (
              <li
                key={r.id}
                data-number={r.number}
                className="space-y-2 rounded-2xl border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Sorun #{r.number} · {formatAuditDate(r.createdAt)}
                      {r.images > 0 && (
                        <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
                          · <ImageIcon aria-hidden className="size-3" />
                          <span>{r.images} görüntü</span>
                        </span>
                      )}
                    </p>
                    <p className="font-medium [overflow-wrap:anywhere]">{r.title}</p>
                  </div>
                  <IssueStatusChip status={r.status} />
                </div>
                {r.reply && (
                  <div className="rounded-xl bg-muted/60 px-3 py-2 text-sm" data-testid="report-reply">
                    <p className="text-xs font-medium text-muted-foreground">Yanıt</p>
                    <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">{r.reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
