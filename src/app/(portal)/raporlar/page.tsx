import { Download, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AttendanceStrip } from "@/components/attendance/status-chip";
import { TermsDialog } from "@/components/attendance/terms-dialog";
import { buttonVariants } from "@/components/ui/button";
import { VoicePartBadge } from "@/components/voice-part-badge";
import { VOICE_PARTS } from "@/db/schema";
import { autoCloseStale } from "@/lib/attendance/close";
import { LAST_90, resolvePeriod } from "@/lib/attendance/period";
import { attendanceStats } from "@/lib/attendance/stats";
import { requireManager } from "@/lib/auth/dal";
import { collator } from "@/lib/format";
import { VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata = { title: "Raporlar" };

export default async function ReportsPage({ searchParams }: PageProps<"/raporlar">) {
  await requireManager();
  await autoCloseStale();
  const { donem, uyari } = await searchParams;
  const period = await resolvePeriod(typeof donem === "string" ? donem : undefined);
  const onlyFlagged = uyari === "1";
  const stats = await attendanceStats({ from: period.from, to: period.to });
  const members = stats.members.sort((a, b) => collator.compare(a.name, b.name));
  const flagged = members.filter((m) => m.warning);
  const shown = onlyFlagged ? flagged : members;

  const parts = VOICE_PARTS.map((part) => {
    const list = members.filter((m) => m.voicePart === part && m.percent !== null);
    const avg = list.length
      ? Math.round(list.reduce((s, m) => s + (m.percent ?? 0), 0) / list.length)
      : null;
    return { part, avg, count: list.length };
  });
  const query = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { donem: period.key, uyari: onlyFlagged ? "1" : undefined, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return sp.toString();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-4xl font-medium">Raporlar</h1>
          <p className="text-sm text-muted-foreground">
            {period.label} · {stats.rehearsalCount} sayılan çalışma
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TermsDialog terms={period.terms} />
          <a
            href={`/raporlar/csv?${query({})}`}
            className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-full px-4")}
            data-testid="csv-link"
          >
            <Download />
            CSV indir
          </a>
        </div>
      </div>

      <nav
        aria-label="Dönem"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        {[
          ...period.terms.map((t) => ({ key: t.id, label: t.name })),
          { key: LAST_90, label: "Son 90 gün" },
        ].map((option) => (
          <Link
            key={option.key}
            href={`/raporlar?${query({ donem: option.key })}`}
            aria-current={option.key === period.key ? "page" : undefined}
            className={cn(
              "flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm transition-colors",
              option.key === period.key
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {parts.map(({ part, avg, count }) => (
          <div key={part} className="rounded-2xl border bg-card p-4" data-testid={`part-${part}`}>
            <p className="inline-flex items-center gap-2 text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
              <span className={cn("size-2 rounded-full", VOICE_PART_STYLES[part].dot)} />
              {VOICE_PART_LABELS[part]}
            </p>
            <p className="font-heading text-3xl font-medium">{avg === null ? "—" : `%${avg}`}</p>
            <p className="text-xs text-muted-foreground">{count} kişi ortalaması</p>
          </div>
        ))}
      </div>

      {flagged.length > 0 && (
        <section
          className="space-y-2 rounded-2xl border border-gold/40 bg-accent/50 p-4"
          aria-label="Uyarılar"
        >
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4" />
            {flagged.length} kişi devamsızlık eşiğinde: son 4 çalışmanın 2&apos;sine gelmedi ya da
            dönemde %70&apos;in altında.
          </p>
          <p className="text-sm text-muted-foreground">{flagged.map((m) => m.name).join(", ")}</p>
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-medium">Kişi bazında</h2>
        <Link
          href={`/raporlar?${query({ uyari: onlyFlagged ? undefined : "1" })}`}
          aria-pressed={onlyFlagged}
          className={cn(
            "flex min-h-10 items-center rounded-full border px-4 text-sm",
            onlyFlagged
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card hover:bg-muted",
          )}
        >
          Sadece uyarılılar
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          {onlyFlagged ? "Uyarı eşiğinde kimse yok." : "Bu dönemde sayılan çalışma yok."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <table className="w-full text-sm" data-testid="report-table">
            <thead className="hidden bg-muted/50 text-left text-xs text-muted-foreground md:table-header-group">
              <tr>
                <th className="px-4 py-3 font-medium">Ad soyad</th>
                <th className="px-4 py-3 font-medium">Partisyon</th>
                <th className="px-4 py-3 text-right font-medium">Geldi / Beklenen</th>
                <th className="px-4 py-3 text-right font-medium">Yüzde</th>
                <th className="px-4 py-3 text-right font-medium">Geç</th>
                <th className="px-4 py-3 text-right font-medium">Mazeretli</th>
                <th className="px-4 py-3 text-right font-medium">Gelmedi</th>
                <th className="px-4 py-3 font-medium">Son çalışmalar</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((m) => (
                <tr
                  key={m.userId}
                  className="grid grid-cols-[1fr_auto] gap-x-3 px-4 py-3 md:table-row md:p-0"
                  data-testid="report-row"
                >
                  <td className="font-medium md:px-4 md:py-3">
                    <Link href={`/uyeler/${m.userId}`} className="hover:underline">
                      {m.name}
                    </Link>
                    {m.warning && (
                      <span className="ml-2 rounded-full bg-gold/25 px-2 py-0.5 text-xs font-medium text-accent-foreground">
                        Uyarı
                      </span>
                    )}
                  </td>
                  <td className="row-start-2 md:px-4 md:py-3">
                    {m.voicePart && <VoicePartBadge part={m.voicePart} />}
                  </td>
                  <td className="text-right tabular-nums md:px-4 md:py-3">
                    {m.attended}/{m.expected}
                  </td>
                  <td
                    className="text-right font-heading text-lg tabular-nums md:px-4 md:py-3"
                    data-testid="report-percent"
                  >
                    {m.percent === null ? "—" : `%${m.percent}`}
                  </td>
                  <td className="hidden text-right tabular-nums md:table-cell md:px-4 md:py-3">
                    {m.late}
                  </td>
                  <td className="hidden text-right tabular-nums md:table-cell md:px-4 md:py-3">
                    {m.excused}
                  </td>
                  <td className="hidden text-right tabular-nums md:table-cell md:px-4 md:py-3">
                    {m.absent}
                  </td>
                  <td className="col-span-2 pt-1 md:px-4 md:py-3">
                    <AttendanceStrip statuses={m.history.slice(0, 8).map((h) => h.status)} />
                    <span className="ml-2 text-xs text-muted-foreground md:hidden">
                      {m.late} geç · {m.excused} mazeretli · {m.absent} gelmedi
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
