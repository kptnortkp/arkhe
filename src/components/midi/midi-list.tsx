import { Download, FileMusic, Sparkles } from "lucide-react";
import { DownloadLink } from "@/components/download-link";
import { buttonVariants } from "@/components/ui/button";
import type { VoicePart } from "@/db/schema";
import type { MidiRow } from "@/lib/repertoire-midi";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { isPianoName } from "@/lib/omr/parts";
import { formatAuditDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { MidiButton } from "./midi-button";

const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

/** The automatic file's short name: `4 ses + piyano`, `2 ses` (the player lists the tracks). */
export function autoTitle(m: Pick<MidiRow, "tracks">) {
  const piano = m.tracks.some((t) => isPianoName(t.name));
  const voices = m.tracks.filter((t) => !isPianoName(t.name)).length;
  if (voices === 0) return piano ? "Piyano" : "Otomatik MIDI";
  return `${voices} ses${piano ? " + piyano" : ""}`;
}

/** Text, not colour only (AC 33). */
export function AutoBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-xs font-medium text-foreground">
      <Sparkles className="size-3" aria-hidden />
      Otomatik
    </span>
  );
}

function DownloadButton({ id, title }: { id: string; title: string }) {
  return (
    <DownloadLink
      href={`/api/dosya/midi/${id}?indir=1`}
      aria-label={`İndir: ${title}`}
      className={cn(buttonVariants({ variant: "ghost" }), "size-11 shrink-0 rounded-full")}
    >
      <Download />
    </DownloadLink>
  );
}

/**
 * The piece detail's MIDI groups (D116): manual files under `MIDI` (Tutti plus the filtered part,
 * or all), the published automatic file under `Otomatik oluşturulan`. Never mixed.
 */
export function MidiList({ rows, myPart }: { rows: MidiRow[]; myPart: VoicePart | null }) {
  const manual = rows.filter((m) => !m.auto);
  const auto = rows.find((m) => m.auto) ?? null;
  return (
    <>
      {manual.length > 0 && (
        <section aria-labelledby="group-midi" className="space-y-2" data-testid="midi-list">
          <h2 id="group-midi" className={eyebrow}>
            MIDI
          </h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {manual.map((m) => (
              <li
                key={m.id}
                className="px-4 py-2.5"
                data-testid="midi-row"
                data-part={m.voicePart ?? "tutti"}
              >
                <MidiButton
                  midiId={m.id}
                  title={m.title}
                  myPart={myPart}
                  head={
                    <>
                      <FileMusic className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 font-medium break-words">{m.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {m.voicePart ? VOICE_PART_LABELS[m.voicePart] : "Tutti"}
                        </span>
                      </span>
                    </>
                  }
                  after={<DownloadButton id={m.id} title={m.title} />}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {auto && (
        <section aria-labelledby="group-midi-auto" className="space-y-2" data-testid="midi-auto">
          <h2 id="group-midi-auto" className={eyebrow}>
            Otomatik oluşturulan
          </h2>
          <ul className="overflow-hidden rounded-2xl border bg-card">
            <li className="px-4 py-2.5" data-testid="midi-auto-row" data-midi-id={auto.id}>
              <MidiButton
                midiId={auto.id}
                title={autoTitle(auto)}
                myPart={myPart}
                head={
                  <>
                    <FileMusic className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words">{autoTitle(auto)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <AutoBadge />
                        <span>
                          Nota PDF&apos;inden otomatik oluşturuldu ·{" "}
                          {formatAuditDate(auto.publishedAt ?? auto.createdAt)}
                        </span>
                      </span>
                    </span>
                  </>
                }
                after={<DownloadButton id={auto.id} title={autoTitle(auto)} />}
              />
            </li>
          </ul>
        </section>
      )}
    </>
  );
}
