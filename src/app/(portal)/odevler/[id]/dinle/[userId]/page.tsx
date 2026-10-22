import { AudioLines, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AudioPlayer } from "@/components/recording/audio-player";
import {
  AssistantNoteForm,
  ConductorReviewForm,
  RecordingAdmin,
} from "@/components/review/review-forms";
import { GuardedLink, ReviewGuard } from "@/components/review/review-guard";
import { buttonVariants } from "@/components/ui/button";
import { VoicePartBadge } from "@/components/voice-part-badge";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { barsLabel } from "@/lib/homework/mail";
import { effectiveScope } from "@/lib/review/access";
import {
  assistantChip,
  assistantQueue,
  compareWalk,
  conductorChip,
  conductorQueue,
  nextAfter,
  reviewFor,
  reviewKey,
  type QueueRowBase,
} from "@/lib/review/queries";
import { loadScope } from "@/lib/review/scope";
import { playbackPausedFor } from "@/lib/storage/quota";
import { cachedUsage } from "@/lib/storage/quota";
import { dayInstant, formatAuditDate, formatShortDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dinleme" };

const CHIP_LABELS: Record<string, string> = {
  bekleyen: "Yorum bekleyen",
  "asistan-notlu": "Asistan notlu",
  yorumlanan: "Yorumlananlar",
  dinlenecek: "Dinlenecek",
  notlarim: "Not yazdıklarım",
};
const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<"/odevler/[id]/dinle/[userId]">) {
  const user = await requireUser();
  const { id, userId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(userId).success) notFound();
  const viewer = { id: user.id, role: user.role };
  const scope = effectiveScope(viewer, await loadScope(user.id));
  const review = await reviewFor(viewer, scope, id, userId);
  if (!review) notFound();
  const sp = await searchParams;

  const conductor = review.kind === "conductor";
  const chip = conductor ? conductorChip(sp.filtre) : assistantChip(sp.filtre);
  const rows: QueueRowBase[] = conductor
    ? (await conductorQueue(chip as Parameters<typeof conductorQueue>[0])).rows
    : await assistantQueue(viewer, scope, chip as Parameters<typeof assistantQueue>[2]);
  const key = reviewKey(review);
  const next = nextAfter(rows, key);
  const nextHref = next ? `/odevler/${next.assignmentId}/dinle/${next.userId}?filtre=${chip}` : null;
  // The position follows the walk order (audio first), the same order Sonraki uses.
  const index = [...rows]
    .sort(compareWalk)
    .findIndex((r) => r.assignmentId === key.assignmentId && r.userId === key.userId);
  const listHref = `/odevler/dinle?filtre=${chip}`;
  const rec = review.recording;
  const playbackPaused = playbackPausedFor(await cachedUsage());
  const title = `${review.assignment.pieceTitle} · ${barsLabel(review.assignment.barFrom, review.assignment.barTo)}`;

  const player = rec ? (
    rec.audioDeletedAt ? (
      <div className="flex gap-3 rounded-2xl border border-dashed p-4" data-testid="audio-gone">
        <AudioLines className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Ses dosyası silindi ({formatAuditDate(rec.audioDeletedAt)}). Yorumlar duruyor.
        </p>
      </div>
    ) : (
      <div className="sticky top-16 z-10 space-y-1 bg-background py-1 md:top-0">
        <AudioPlayer
          recordingId={rec.id}
          durationMs={rec.durationMs}
          label="Kaydı dinle"
          playbackPaused={playbackPaused}
          downloadHint={conductor}
        />
        {conductor && <RecordingAdmin recordingId={rec.id} singer={review.singer.name} />}
      </div>
    )
  ) : conductor ? (
    <p className="rounded-2xl border border-dashed p-4 text-sm" data-testid="no-take">
      Bu teslimde portala yüklenmiş kayıt yok (e-posta ya da elden). Yorumunu yine de yazabilirsin.
    </p>
  ) : null;

  return (
    <ReviewGuard
      title={
        conductor
          ? "Yorumun gönderilmedi. Yine de sonrakine geçilsin mi?"
          : "Notun kaydedilmedi. Kaydetmeden geçilsin mi?"
      }
    >
      <div className="mx-auto max-w-2xl space-y-5">
        <GuardedLink
          href={listHref}
          className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Dinleme
        </GuardedLink>
        <header className="space-y-2">
          {conductor ? (
            <GuardedLink href={`/odevler/${review.assignment.id}`} className={cn(eyebrow, "hover:underline")}>
              {title}
            </GuardedLink>
          ) : (
            <p className={eyebrow}>{title}</p>
          )}
          <h1 className="text-3xl leading-tight font-medium">{review.singer.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {review.singer.part && <VoicePartBadge part={review.singer.part} />}
            {review.submittedAt && (
              <span data-testid="review-submitted">Teslim: {formatShortDateTime.format(review.submittedAt)}</span>
            )}
            {review.late && (
              <span className="rounded-full bg-late/18 px-2.5 py-0.5 text-xs font-medium text-late-ink">
                Geç teslim
              </span>
            )}
            {rec?.replacedEarlier && (
              <span className="text-muted-foreground">
                Değiştirildi · {formatShortDateTime.format(rec.uploadedAt)}
              </span>
            )}
          </div>
        </header>

        {player}

        {review.kind === "conductor" ? (
          <ConductorReviewForm
            assignmentId={review.assignment.id}
            singerId={review.singer.id}
            singerName={review.singer.name}
            recordingId={rec?.id ?? ""}
            notes={review.notes.map((n) => ({ ...n, at: n.at.toISOString() }))}
            comment={
              review.comment
                ? {
                    text: review.comment.text,
                    byName: review.comment.byName,
                    byConductor: review.comment.byRole === "conductor",
                  }
                : null
            }
            deleteLine={
              review.comment && rec && !rec.audioDeletedAt
                ? `Bu kayıt ${formatAuditDate(dayInstant(rec.deleteOn))} tarihinde silinecek.`
                : null
            }
          />
        ) : (
          <AssistantNoteForm
            assignmentId={review.assignment.id}
            singerId={review.singer.id}
            recordingId={rec?.id ?? null}
            note={
              review.myNote
                ? { ...review.myNote, at: review.myNote.at.toISOString() }
                : null
            }
            commented={review.commented}
          />
        )}

        <footer className="flex items-center gap-3 border-t pt-3" data-testid="review-footer">
          <span className="flex-1 text-xs text-muted-foreground tabular-nums">
            {index >= 0 ? `${index + 1} / ${rows.length}` : `${rows.length} kayıt kaldı`} · {CHIP_LABELS[chip]}
          </span>
          {nextHref ? (
            <GuardedLink
              href={nextHref}
              className={cn(buttonVariants({ variant: "outline" }), "h-12 rounded-2xl px-5")}
              data-testid="review-next"
            >
              Sonraki
              <ChevronRight />
            </GuardedLink>
          ) : (
            <span className="flex items-center gap-3 text-sm" data-testid="review-end">
              Bu listede başka kayıt yok.
              <Link href={listHref} className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
                Listeye dön
              </Link>
            </span>
          )}
        </footer>
      </div>
    </ReviewGuard>
  );
}
