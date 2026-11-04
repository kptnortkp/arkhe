import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { DownloadLink } from "@/components/download-link";
import { AudioPlayer } from "@/components/recording/audio-player";
import { buttonVariants } from "@/components/ui/button";
import { VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import type { AudioRow } from "@/lib/repertoire-audio";
import { cn } from "@/lib/utils";

const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

/** Title plus the part (dot and name); the part line is left out when the title already is it. */
function AudioHead({ a, extra }: { a: AudioRow; extra?: string }) {
  const part = a.voicePart ? VOICE_PART_LABELS[a.voicePart] : "Tutti";
  const sub = [a.label ? part : null, extra].filter(Boolean).join(" · ");
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        {a.voicePart ? (
          <span
            className={cn("size-2 shrink-0 rounded-full", VOICE_PART_STYLES[a.voicePart].dot)}
          />
        ) : (
          <span className="size-2 shrink-0 rounded-full ring-1 ring-foreground/40" />
        )}
        <span className="line-clamp-2 font-medium break-words">{a.title}</span>
      </span>
      {sub && <span className="block pl-4 text-xs text-muted-foreground">{sub}</span>}
    </span>
  );
}

/** One compact row: play, title and part, then `after` (İndir or a menu). */
export function AudioItem({ a, extra, after }: { a: AudioRow; extra?: string; after: ReactNode }) {
  return (
    <AudioPlayer
      src={`/api/dosya/ses/${a.id}`}
      durationMs={null}
      label={`Dinle: ${a.title}`}
      head={<AudioHead a={a} extra={extra} />}
      after={after}
    />
  );
}

/** The piece detail's rehearsal audio: Tutti plus the filtered part, or all. */
export function AudioList({ rows }: { rows: AudioRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="group-audio"
      id="ses-kayitlari"
      className="scroll-mt-20 space-y-2 md:scroll-mt-6"
      data-testid="audio-list"
    >
      <h2 id="group-audio" className={eyebrow}>
        Ses kayıtları <span className="tabular-nums">{rows.length}</span>
      </h2>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {rows.map((a) => (
          <li
            key={a.id}
            className="px-4 py-2.5"
            data-testid="audio-row"
            data-part={a.voicePart ?? "tutti"}
          >
            <AudioItem
              a={a}
              after={
                <DownloadLink
                  href={`/api/dosya/ses/${a.id}?indir=1`}
                  aria-label={`İndir: ${a.title}`}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "size-11 shrink-0 rounded-full",
                  )}
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
