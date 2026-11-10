import { ArrowLeft, ChevronDown, MapPin } from "lucide-react";
import Link from "next/link";
import { DateBlock } from "@/components/attendance/date-block";
import { TypeChip } from "@/components/attendance/status-chip";
import { VoicePartBadge } from "@/components/voice-part-badge";
import { rehearsalTitle } from "@/lib/attendance/rehearsals";
import { upcomingAbsences } from "@/lib/attendance/upcoming";
import { requireManager } from "@/lib/auth/dal";
import { VOICE_PART_SHORT, VOICE_PART_STYLES } from "@/lib/labels";
import { formatTime, istanbulDateOf, istanbulToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Gelecek çalışmalar" };

export default async function UpcomingReportPage({
  searchParams,
}: PageProps<"/raporlar/gelecek">) {
  await requireManager();
  const { hepsi } = await searchParams;
  const showAll = hepsi === "1";
  const list = await upcomingAbsences(istanbulToUtc(istanbulDateOf(new Date())));
  const withAbsences = list.filter((x) => x.absences.length > 0);
  const shown = showAll ? list : withAbsences;
  const total = withAbsences.reduce((s, x) => s + x.absences.length, 0);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-3">
        <Link
          href="/raporlar"
          className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Raporlar
        </Link>
        <h1 className="text-4xl font-medium">Gelecek çalışmalar</h1>
        <p className="text-sm text-muted-foreground" data-testid="upcoming-summary">
          {list.length} çalışma planlı ·{" "}
          {total === 0
            ? "henüz kimse gelemeyeceğini bildirmedi"
            : `${withAbsences.length} çalışmaya toplam ${total} kişi gelemeyeceğini bildirdi`}
        </p>
      </div>

      <nav aria-label="Gösterilen çalışmalar" className="flex gap-2">
        {[
          { href: "/raporlar/gelecek", label: "Gelemeyeni olanlar", active: !showAll },
          { href: "/raporlar/gelecek?hepsi=1", label: "Tümü", active: showAll },
        ].map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center rounded-full border px-4 text-sm transition-colors",
              tab.active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          {list.length === 0
            ? "Planlanmış çalışma yok."
            : "Gelecek çalışmalar için bildirilen mazeret yok."}
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card" data-testid="upcoming-list">
          {shown.map(({ rehearsal: r, expected, parts, absences }) => (
            <li key={r.id} data-testid="upcoming-row" data-rehearsal={r.id}>
              <details className="group" open={absences.length > 0 && absences.length <= 3}>
                <summary
                  className={cn(
                    "flex min-h-20 cursor-pointer list-none items-center gap-4 px-4 py-3 hover:bg-muted/60 [&::-webkit-details-marker]:hidden",
                    absences.length === 0 && "cursor-default",
                  )}
                >
                  <DateBlock date={r.startsAt} concert={r.type === "concert"} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium">{rehearsalTitle(r)}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="tabular-nums">
                        {formatTime.format(r.startsAt)}–{formatTime.format(r.endsAt)}
                      </span>
                      {r.location && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">{r.location}</span>
                        </span>
                      )}
                      <TypeChip type={r.type} parts={r.parts} />
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span
                        className={cn(
                          "font-medium",
                          absences.length > 0 ? "text-absent-ink" : "text-muted-foreground",
                        )}
                        data-testid="upcoming-count"
                      >
                        {absences.length > 0
                          ? `${absences.length} kişi gelemeyecek`
                          : "Herkes gelecek görünüyor"}
                      </span>
                      <span className="text-muted-foreground">({expected} kişi bekleniyor)</span>
                    </p>
                    {absences.length > 0 && (
                      <p className="flex flex-wrap gap-1.5" data-testid="upcoming-parts">
                        {parts
                          .filter((p) => p.missing > 0)
                          .map((p) => (
                            <span
                              key={p.part}
                              className="inline-flex items-center gap-1 rounded-full bg-absent/12 px-2 py-0.5 text-xs font-medium text-absent-ink tabular-nums"
                            >
                              <span
                                className={cn("size-1.5 rounded-full", VOICE_PART_STYLES[p.part].dot)}
                              />
                              {VOICE_PART_SHORT[p.part]} −{p.missing}
                              <span className="font-normal opacity-80">
                                ({p.expected - p.missing}/{p.expected})
                              </span>
                            </span>
                          ))}
                      </p>
                    )}
                  </div>
                  {absences.length > 0 && (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  )}
                </summary>
                {absences.length > 0 && (
                  <ul className="space-y-2 px-4 pb-4 pl-[5.5rem]" data-testid="upcoming-absences">
                    {absences.map((a) => (
                      <li key={a.userId} className="flex items-start gap-2">
                        {a.voicePart && <VoicePartBadge part={a.voicePart} />}
                        <div className="min-w-0">
                          <p className="font-medium">{a.name}</p>
                          {a.note && (
                            <p className="text-sm text-muted-foreground">“{a.note}”</p>
                          )}
                        </div>
                      </li>
                    ))}
                    <li>
                      <Link
                        href={`/calismalar/${r.id}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Çalışmaya git
                      </Link>
                    </li>
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
