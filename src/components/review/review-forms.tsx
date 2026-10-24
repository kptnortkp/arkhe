"use client";

import { Check, Download, Plus } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteAssistantNote, saveAssistantNote } from "@/app/(portal)/odevler/dinle/actions";
import { deleteRecordingAsConductor } from "@/app/(portal)/odevler/kayit-actions";
import { saveFeedback } from "@/app/(portal)/odevler/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DownloadLink } from "@/components/download-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/use-run-action";
import { NOTE_MAX } from "@/lib/storage/limits";
import { formatShortDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useReviewDirty } from "./review-guard";

const soft = "rounded-2xl border p-3 text-sm";
const stale = "rounded-full bg-late/18 px-2.5 py-0.5 text-xs font-medium text-late-ink";

function Counter({ length, fallback, id }: { length: number; fallback: string; id: string }) {
  return (
    <p id={id} className="text-xs text-muted-foreground tabular-nums">
      {length >= 800 ? `${length}/${NOTE_MAX}` : fallback}
    </p>
  );
}

/** The conductor's `İndir` and `Kaydı sil` (D44, D48). */
export function RecordingAdmin({ recordingId, singer }: { recordingId: string; singer: string }) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useRunAction();
  return (
    <div className="flex items-center justify-between gap-2">
      <DownloadLink
        href={`/api/dosya/kayit/${recordingId}?indir=1`}
        className={cn(buttonVariants({ variant: "ghost" }), "h-11 px-3")}
      >
        <Download />
        İndir
      </DownloadLink>
      <Button variant="ghost" className="h-11 px-3 text-absent-ink" onClick={() => setOpen(true)}>
        Kaydı sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`"${singer}" kaydı silinsin mi?`}
        description="Ses dosyası hemen silinir. Teslim, notlar ve yorum kalır."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () => run(() => deleteRecordingAsConductor(recordingId), () => setOpen(false)),
          },
        ]}
      />
    </div>
  );
}

export type ReviewNote = {
  assistantId: string;
  author: string;
  text: string;
  at: string;
  previousTake: boolean;
};

export function ConductorReviewForm({
  assignmentId,
  singerId,
  singerName,
  recordingId,
  notes,
  comment,
  deleteLine,
}: {
  assignmentId: string;
  singerId: string;
  singerName: string;
  /** The take on screen, "" for `Portalda kayıt yok` (D49). */
  recordingId: string;
  notes: ReviewNote[];
  comment: { text: string; byName: string | null; byConductor: boolean } | null;
  /** `Bu kayıt <tarih> tarihinde silinecek.` once a comment exists on a live take. */
  deleteLine: string | null;
}) {
  const [state, action, pending] = useActionState(
    saveFeedback.bind(null, assignmentId, singerId),
    {},
  );
  const saved = comment?.text ?? "";
  const [text, setText] = useState(saved);
  const [added, setAdded] = useState<string[]>([]);
  const [announce, setAnnounce] = useState("");
  const [confirm, setConfirm] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useReviewDirty(text.trim() !== saved.trim());

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) toast.success(state.success);
  }, [state]);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the server's text is the truth after a save */
    setText(saved);
    if (!saved) setAdded([]);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [saved]);

  function append(n: ReviewNote) {
    const next = text.trim() ? `${text.trimEnd()}\n\n${n.text}` : n.text;
    setText(next);
    setAdded((a) => [...a, n.assistantId]);
    setAnnounce("Not yoruma eklendi.");
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
      el.scrollIntoView({ block: "center" });
    });
  }

  const fieldError = state.fieldErrors?.feedback?.[0];
  return (
    <div className="space-y-6">
      <section aria-labelledby="notlar" className="space-y-3">
        <div>
          <h2 id="notlar" className="flex items-baseline gap-2 text-xl font-medium">
            Asistan notları
            <span className="text-base text-muted-foreground tabular-nums">{notes.length}</span>
          </h2>
          <p className="text-xs text-muted-foreground">Koriste gitmez; yalnızca sen görürsün.</p>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu kayda asistan notu yok.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => {
              const isAdded = added.includes(n.assistantId);
              const tooLong = (text.trim() ? text.trimEnd().length + 2 : 0) + n.text.length > NOTE_MAX;
              return (
                <li
                  key={n.assistantId}
                  className="space-y-1.5 rounded-2xl border bg-muted/60 p-3"
                  data-testid="assistant-note"
                >
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">{n.author}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatShortDateTime.format(new Date(n.at))}
                    </span>
                    {n.previousTake && <span className={stale}>Önceki kayda yazıldı</span>}
                  </p>
                  <p className="text-sm whitespace-pre-line">{n.text}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-2 text-primary"
                    disabled={isAdded || tooLong}
                    aria-describedby={tooLong && !isAdded ? `long-${n.assistantId}` : undefined}
                    onClick={() => append(n)}
                  >
                    {isAdded ? <Check /> : <Plus />}
                    {isAdded ? "Eklendi" : "Yoruma ekle"}
                  </Button>
                  {tooLong && !isAdded && (
                    <p id={`long-${n.assistantId}`} className="text-xs text-muted-foreground">
                      Yorum 1000 karakteri geçer.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </section>

      <form
        className="space-y-3 rounded-2xl border bg-card p-4"
        action={action}
        noValidate
        data-testid="comment-form"
      >
        {comment?.byConductor && deleteLine && (
          <div className={cn(soft, "border-present/40 bg-present/10 text-present-ink")} data-testid="comment-sent">
            <p>Yorum gönderildi.</p>
            <p>{deleteLine}</p>
          </div>
        )}
        <input type="hidden" name="recordingId" value={recordingId} />
        <div className="space-y-2">
          <Label htmlFor="comment">Yorumun</Label>
          {comment && !comment.byConductor && (
            <p className="text-xs text-muted-foreground">
              Bu not {comment.byName ?? "Yönetim"} tarafından yazıldı.
            </p>
          )}
          <Textarea
            ref={areaRef}
            id="comment"
            name="feedback"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby="comment-help"
            className="min-h-28 rounded-xl"
          />
          {fieldError ? (
            <p id="comment-help" className="text-sm text-destructive">
              {fieldError}
            </p>
          ) : (
            <Counter
              id="comment-help"
              length={text.length}
              fallback={`Gönderdiğin an ${singerName} görür. Asistan notları ona gitmez.`}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant={comment ? "outline" : "default"}
            className="h-12 flex-1 rounded-xl md:flex-none md:px-6"
            disabled={pending}
          >
            {comment ? "Güncelle" : "Yorumu gönder"}
          </Button>
          {comment && (
            <Button
              type="button"
              variant="ghost"
              className="h-12 px-4 text-destructive"
              disabled={pending}
              onClick={() => setConfirm(true)}
            >
              Yorumu sil
            </Button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Yorum silinsin mi?"
        description={`${singerName} artık bu yorumu görmez ve kaydını yeniden değiştirebilir.`}
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () => {
              setConfirm(false);
              const fd = new FormData();
              fd.set("feedback", "");
              fd.set("recordingId", recordingId);
              setText("");
              startTransition(() => action(fd));
            },
          },
        ]}
      />
    </div>
  );
}

export function AssistantNoteForm({
  assignmentId,
  singerId,
  recordingId,
  note,
  commented,
}: {
  assignmentId: string;
  singerId: string;
  recordingId: string | null;
  note: { text: string; at: string; previousTake: boolean } | null;
  commented: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveAssistantNote.bind(null, assignmentId, singerId),
    {},
  );
  const saved = note?.text ?? "";
  const [text, setText] = useState(saved);
  const [confirm, setConfirm] = useState(false);
  const [deleting, run] = useRunAction();
  useReviewDirty(!commented && text.trim() !== saved.trim());

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) toast.success(state.success);
  }, [state]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server's text is the truth after a save
    setText(saved);
  }, [saved]);

  if (commented) {
    return (
      <section className="space-y-3 rounded-2xl border bg-card p-4" data-testid="note-locked">
        <p className={cn(soft, "border-present/40 bg-present/10 text-present-ink")}>
          Şef yorumunu gönderdi.
        </p>
        {note && (
          <>
            <p className="text-sm font-medium">Notun</p>
            <p className="rounded-xl bg-muted p-3 text-sm whitespace-pre-line">{note.text}</p>
            <p className="text-xs text-muted-foreground">Notun artık değişmez.</p>
          </>
        )}
      </section>
    );
  }

  const fieldError = state.fieldErrors?.note?.[0];
  return (
    <form
      className="space-y-3 rounded-2xl border bg-card p-4"
      action={action}
      noValidate
      data-testid="note-form"
    >
      <input type="hidden" name="recordingId" value={recordingId ?? ""} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="note">Notun</Label>
          {note?.previousTake && <span className={stale}>Önceki kayda yazıldı</span>}
        </div>
        {note?.previousTake && (
          <p className="text-xs text-muted-foreground">
            Kayıt değişti. Yeni kaydı dinleyip notunu güncelle.
          </p>
        )}
        <Textarea
          id="note"
          name="note"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ör. Girişte tempo kaçıyor, 12. ölçüde nefes erken."
          aria-invalid={fieldError ? true : undefined}
          aria-describedby="note-help"
          className="min-h-24 rounded-xl"
        />
        {fieldError ? (
          <p id="note-help" className="text-sm text-destructive" role="alert">
            {fieldError}
          </p>
        ) : (
          <Counter id="note-help" length={text.length} fallback="Bu notu yalnızca şef görür. Korist görmez." />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-12 flex-1 rounded-xl md:flex-none md:px-6" disabled={pending}>
          {note ? "Güncelle" : "Kaydet"}
        </Button>
        {note && (
          <Button
            type="button"
            variant="ghost"
            className="h-12 px-4 text-destructive"
            disabled={pending || deleting}
            onClick={() => setConfirm(true)}
          >
            Notu sil
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Notun silinsin mi?"
        description="Şef bu notu artık görmez."
        pending={deleting}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteAssistantNote(assignmentId, singerId),
                () => setConfirm(false),
              ),
          },
        ]}
      />
    </form>
  );
}
