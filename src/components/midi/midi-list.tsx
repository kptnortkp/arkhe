import { Download, FileMusic } from "lucide-react";
import { DownloadLink } from "@/components/download-link";
import { buttonVariants } from "@/components/ui/button";
import type { VoicePart } from "@/db/schema";
import type { MidiRow } from "@/lib/repertoire-midi";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { MidiButton } from "./midi-button";

const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

/** The piece detail's `MIDI` group: Tutti plus the filtered part (or all), each with Çal and İndir. */
export function MidiList({ rows, myPart }: { rows: MidiRow[]; myPart: VoicePart | null }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="group-midi" className="space-y-2" data-testid="midi-list">
      <h2 id="group-midi" className={eyebrow}>
        MIDI
      </h2>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {rows.map((m) => (
          <li key={m.id} className="px-4 py-2.5" data-testid="midi-row" data-part={m.voicePart ?? "tutti"}>
            <MidiButton
              midiId={m.id}
              title={m.title}
              myPart={myPart}
              head={
                <>
                  <FileMusic className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m.voicePart ? VOICE_PART_LABELS[m.voicePart] : "Tutti"}
                    </span>
                  </span>
                </>
              }
              after={
                <DownloadLink
                  href={`/api/dosya/midi/${m.id}?indir=1`}
                  aria-label={`İndir: ${m.title}`}
                  className={cn(buttonVariants({ variant: "ghost" }), "size-11 shrink-0 rounded-full")}
                >
                  <Download />
                </DownloadLink>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
