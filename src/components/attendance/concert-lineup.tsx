import { VOICE_PART_LABELS } from "@/lib/labels";
import type { LineupPart } from "@/lib/attendance/concert";

/** Managers on a concert: who will sing, who won't, who hasn't answered, by part. */
export function ConcertLineup({ parts }: { parts: LineupPart[] }) {
  const yes = parts.reduce((s, p) => s + p.yes.length, 0);
  const no = parts.reduce((s, p) => s + p.no.length, 0);
  const unknown = parts.reduce((s, p) => s + p.unknown.length, 0);
  return (
    <section aria-labelledby="kadro" className="space-y-2" data-testid="concert-lineup">
      <h2
        id="kadro"
        className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
      >
        Konser kadrosu
      </h2>
      <p className="text-sm text-muted-foreground" data-testid="lineup-total">
        {yes} söyleyecek · {no} söyleyemeyecek · {unknown} cevap yok
      </p>
      <ul className="divide-y rounded-2xl border bg-card">
        {parts.map((p) => (
          <li key={p.part} className="space-y-1.5 px-4 py-3" data-part={p.part}>
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{VOICE_PART_LABELS[p.part]}</span>
              <span
                className="text-sm text-muted-foreground tabular-nums"
                data-testid="lineup-count"
              >
                {p.yes.length} evet · {p.no.length} hayır · {p.unknown.length} cevap yok
              </span>
            </p>
            {p.yes.length > 0 && (
              <p className="text-sm">
                <span className="text-present-ink">Söyleyecek:</span> {p.yes.join(", ")}
              </p>
            )}
            {p.no.length > 0 && (
              <p className="text-sm">
                <span className="text-absent-ink">Söyleyemeyecek:</span>{" "}
                {p.no.map((x) => (x.note ? `${x.name} (“${x.note}”)` : x.name)).join(", ")}
              </p>
            )}
            {p.unknown.length > 0 && (
              <p className="text-sm text-muted-foreground">Cevap yok: {p.unknown.join(", ")}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
