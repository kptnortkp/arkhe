import { Download, ExternalLink, FileText } from "lucide-react";
import { DownloadLink } from "@/components/download-link";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { ScoreRow as Score } from "@/lib/repertoire-midi";
import { formatAuditDate } from "@/lib/time";
import { cn } from "@/lib/utils";

const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

/** `Nota (PDF)` with `Aç` (the browser's own viewer, new tab) and `İndir` (D94). */
export function ScoreLine({ score, title }: { score: Score; title?: string }) {
  return (
    <div className="flex items-center gap-3" data-testid="score-row">
      <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title ?? "Nota (PDF)"}</span>
        <span className="block text-xs text-muted-foreground">
          {formatBytes(score.sizeBytes)} · {formatAuditDate(score.uploadedAt)}
        </span>
      </span>
      <a
        href={`/api/dosya/nota/${score.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant: "outline" }), "h-11 shrink-0 rounded-full px-3.5")}
        aria-label="Aç: Nota (PDF)"
      >
        <ExternalLink aria-hidden />
        Aç
      </a>
      <DownloadLink
        href={`/api/dosya/nota/${score.id}?indir=1`}
        aria-label="İndir: Nota (PDF)"
        className={cn(buttonVariants({ variant: "ghost" }), "size-11 shrink-0 rounded-full")}
      >
        <Download />
      </DownloadLink>
    </div>
  );
}

export function ScoreSection({ score }: { score: Score | null }) {
  if (!score) return null;
  return (
    <section aria-labelledby="group-score" className="space-y-2">
      <h2 id="group-score" className={eyebrow}>
        Nota
      </h2>
      <div className="rounded-2xl border bg-card px-4 py-2.5">
        <ScoreLine score={score} />
      </div>
    </section>
  );
}
