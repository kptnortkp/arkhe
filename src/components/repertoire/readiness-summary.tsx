import { ChevronDown } from "lucide-react";
import type { ReadinessLevel } from "@/db/schema";
import { READINESS_LABELS, READINESS_STYLES, VOICE_PART_LABELS } from "@/lib/labels";
import type { PartReadiness } from "@/lib/repertoire-readiness";
import { cn } from "@/lib/utils";

const ORDER: ReadinessLevel[] = ["ready", "partial", "not_ready"];
const COUNT_LABELS: Record<ReadinessLevel, string> = {
  ready: "hazır",
  partial: "kısmen",
  not_ready: "hazır değil",
};

/** One stacked bar for a part: ready, partial, not ready, then the unanswered rest. */
export function ReadinessBar({ row, className }: { row: PartReadiness; className?: string }) {
  return (
    <div className={cn("flex h-2.5 overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      {ORDER.map((l) =>
        row.counts[l] > 0 ? (
          <div
            key={l}
            className={READINESS_STYLES[l].bar}
            style={{ width: `${(row.counts[l] / row.singers) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

export function readinessText(row: PartReadiness) {
  const answered = row.counts.ready + row.counts.partial + row.counts.not_ready;
  const parts = ORDER.filter((l) => row.counts[l] > 0).map(
    (l) => `${row.counts[l]} ${COUNT_LABELS[l]}`,
  );
  if (answered < row.singers) parts.push(`${row.singers - answered} cevap yok`);
  return parts.join(" · ");
}

/** Managers on a piece page: each part's readiness, names behind a disclosure. */
export function ReadinessSummary({ rows }: { rows: PartReadiness[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="hazirlik-ozet" className="space-y-2" data-testid="readiness-summary">
      <h2
        id="hazirlik-ozet"
        className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
      >
        Partisyonların hazırlığı
      </h2>
      <ul className="divide-y rounded-2xl border bg-card">
        {rows.map((row) => (
          <li key={row.part} data-part={row.part}>
            <details className="group">
              <summary className="flex min-h-14 cursor-pointer list-none flex-col justify-center gap-1.5 px-4 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="inline-flex items-center gap-1 font-medium">
                    {VOICE_PART_LABELS[row.part]}
                    <ChevronDown
                      className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </span>
                  <span
                    className="text-right text-xs text-muted-foreground"
                    data-testid="readiness-text"
                  >
                    {readinessText(row)}
                  </span>
                </span>
                <ReadinessBar row={row} />
              </summary>
              <ul className="flex flex-wrap gap-1.5 px-4 pb-3">
                {row.people.map((p) => (
                  <li
                    key={p.name}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs",
                      p.level ? READINESS_STYLES[p.level].chip : "bg-muted text-muted-foreground",
                    )}
                  >
                    {p.name}
                    <span className="sr-only">
                      : {p.level ? READINESS_LABELS[p.level] : "cevap yok"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
