import { FileSpreadsheet, Music, Plus } from "lucide-react";
import Link from "next/link";
import { BackLink } from "@/components/board/back-link";
import { DownloadLink } from "@/components/download-link";
import { FestivalCard } from "@/components/festivals/festival-card";
import { FilterChip } from "@/components/filter-chip";
import { buttonVariants } from "@/components/ui/button";
import { ATTENDING_FILL, isPast, NEW_FILL, REGION_FILL } from "@/lib/festivals/labels";
import { listFestivals, type Festival } from "@/lib/festivals/queries";
import { istanbulDateOf, now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Festivaller · Yönetim Kurulu" };

const FILTERS = {
  hepsi: "Hepsi",
  turkiye: "Türkiye",
  yurtdisi: "Yurt dışı",
  katiliyoruz: "Katılıyoruz",
  gecmis: "Geçmiş",
} as const;
type Filter = keyof typeof FILTERS;

function Section({ title, rows, today }: { title: string; rows: Festival[]; today: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-xl font-medium">
        {title} <span className="text-base text-muted-foreground tabular-nums">{rows.length}</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((f) => (
          <FestivalCard key={f.id} festival={f} today={today} />
        ))}
      </ul>
    </section>
  );
}

function Legend() {
  const item = (fill: string, label: string) => (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-3.5 rounded border border-foreground/15", fill)} />
      {label}
    </li>
  );
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Renkler"
    >
      {item(REGION_FILL.tr, "Türkiye")}
      {item(REGION_FILL.abroad, "Yurt dışı")}
      {item(ATTENDING_FILL, "Katılıyoruz")}
      {item(NEW_FILL, "Yeni eklendi")}
    </ul>
  );
}

export default async function FestivalsPage({ searchParams }: PageProps<"/yonetim/festivaller">) {
  const { tur } = await searchParams;
  const filter: Filter =
    typeof tur === "string" && Object.hasOwn(FILTERS, tur) ? (tur as Filter) : "hepsi";
  const rows = await listFestivals();
  const today = istanbulDateOf(now());
  const current = rows.filter((f) => !isPast(f, today));
  const past = rows.filter((f) => isPast(f, today)).reverse();
  const attending = current.filter((f) => f.status === "attending");
  const rest = current.filter((f) => f.status !== "attending");
  const tr = rest.filter((f) => f.region === "tr");
  const abroad = rest.filter((f) => f.region === "abroad");
  const counts: Record<Filter, number> = {
    hepsi: current.length,
    turkiye: current.filter((f) => f.region === "tr").length,
    yurtdisi: current.filter((f) => f.region === "abroad").length,
    katiliyoruz: attending.length,
    gecmis: past.length,
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href="/yonetim">Panoya dön</BackLink>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-4xl font-medium">Festivaller</h1>
          <div className="flex gap-2">
            <DownloadLink
              href="/yonetim/festivaller/xlsx"
              data-testid="festival-export"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
            >
              <FileSpreadsheet />
              Excel
            </DownloadLink>
            <Link
              href="/yonetim/festivaller/yeni"
              className={cn(buttonVariants(), "h-11 rounded-full px-4")}
            >
              <Plus />
              Festival
            </Link>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Takip ettiğimiz festival ve yarışmalar. Yalnızca şef ve YK görür. Festival günleri ve son
          başvuru günleri Yönetim takviminde de görünür.
        </p>
        <Legend />
      </div>

      <nav
        aria-label="Filtre"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
      >
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <FilterChip
            key={f}
            href={f === "hepsi" ? "/yonetim/festivaller" : `/yonetim/festivaller?tur=${f}`}
            active={filter === f}
            label={FILTERS[f]}
            count={counts[f]}
          />
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <Music aria-hidden className="mx-auto size-8 text-muted-foreground" />
          <p className="font-medium">Henüz festival eklenmedi.</p>
        </div>
      ) : filter === "hepsi" ? (
        <div className="space-y-6">
          <Section title="Katılıyoruz" rows={attending} today={today} />
          <Section title="Türkiye" rows={tr} today={today} />
          <Section title="Yurt dışı" rows={abroad} today={today} />
          {current.length === 0 && (
            <p className="text-sm text-muted-foreground">Yaklaşan festival yok.</p>
          )}
        </div>
      ) : (
        <Section
          title={FILTERS[filter]}
          today={today}
          rows={
            filter === "turkiye"
              ? current.filter((f) => f.region === "tr")
              : filter === "yurtdisi"
                ? current.filter((f) => f.region === "abroad")
                : filter === "katiliyoruz"
                  ? attending
                  : past
          }
        />
      )}
      {filter !== "hepsi" && counts[filter] === 0 && (
        <p className="text-sm text-muted-foreground">Bu filtrede festival yok.</p>
      )}
    </div>
  );
}
