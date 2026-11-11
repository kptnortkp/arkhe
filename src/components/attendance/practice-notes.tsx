"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { addPracticeNote, deletePracticeNote } from "@/app/(portal)/calismalar/note-actions";
import { LinkifiedText } from "@/components/announcements/linkified-text";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VoicePartBadge } from "@/components/voice-part-badge";
import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { formatDayMonth } from "@/lib/time";

export type NoteItem = {
  id: string;
  body: string;
  voicePart: VoicePart | null;
  pieceId: string | null;
  pieceTitle: string | null;
  rehearsalId: string;
  rehearsalStartsAt: Date;
  authorName: string;
  canDelete: boolean;
};

/** One note: what to work on, for whom, by whom. `withRehearsal` names the rehearsal's day. */
export function NoteCard({
  note,
  withRehearsal = false,
}: {
  note: NoteItem;
  withRehearsal?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <li className="space-y-2 px-4 py-3" data-testid="practice-note">
      <div className="flex flex-wrap items-center gap-1.5">
        {note.voicePart ? (
          <VoicePartBadge part={note.voicePart} />
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">Herkes</span>
        )}
        {note.pieceId && note.pieceTitle && (
          <Link
            href={`/repertuvar/${note.pieceId}`}
            className="relative rounded-full border px-2.5 py-0.5 text-xs font-medium after:absolute after:-inset-2 hover:bg-muted"
          >
            {note.pieceTitle}
          </Link>
        )}
      </div>
      <p className="text-sm whitespace-pre-line">
        <LinkifiedText text={note.body} />
      </p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {note.authorName}
          {withRehearsal && (
            <>
              {" · "}
              <Link
                href={`/calismalar/${note.rehearsalId}`}
                className="relative after:absolute after:-inset-2 hover:underline"
              >
                {formatDayMonth.format(note.rehearsalStartsAt)} çalışması
              </Link>
            </>
          )}
        </span>
        {note.canDelete && (
          <Button
            variant="ghost"
            className="-my-2 size-11 rounded-full"
            aria-label="Notu sil"
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Not silinsin mi?"
        description="Not herkesten kalkar. Gönderilmiş bildirimler geri alınmaz."
        pending={pending}
        actions={[
          {
            label: "Sil",
            variant: "destructive",
            run: () =>
              startTransition(async () => {
                const result = await deletePracticeNote(note.id);
                if (result.error) toast.error(result.error);
                else toast.success(result.success);
                setConfirming(false);
                router.refresh();
              }),
          },
        ]}
      />
    </li>
  );
}

const selectClass =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** Managers and listening assistants: add a note to this rehearsal, optionally notifying singers. */
export function NoteForm({
  rehearsalId,
  targets,
  pieces,
}: {
  rehearsalId: string;
  targets: (VoicePart | null)[];
  pieces: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await addPracticeNote(rehearsalId, {}, data);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success(result.success);
      setError(null);
      form.reset();
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => setOpen(true)}>
        Not ekle
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="note-piece">Eser</Label>
          <select id="note-piece" name="pieceId" className={selectClass} defaultValue="">
            <option value="">Genel</option>
            {pieces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="note-part">Kime</Label>
          <select
            id="note-part"
            name="voicePart"
            className={selectClass}
            defaultValue={targets[0] ?? ""}
          >
            {targets.map((t) => (
              <option key={t ?? "all"} value={t ?? ""}>
                {t ? VOICE_PART_LABELS[t] : "Herkes"}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="note-body">Not</Label>
        <Textarea
          id="note-body"
          name="body"
          required
          maxLength={1000}
          rows={4}
          placeholder="Örnek: 12–28. ölçüler; tenorlar girişe dikkat."
          className="rounded-xl text-base md:text-sm"
        />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="notify"
          defaultChecked
          className="size-5 accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        İlgili koristlere bildirim gönder
      </label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 rounded-full px-5" disabled={pending}>
          Kaydet
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 rounded-full px-4"
          onClick={() => setOpen(false)}
        >
          Vazgeç
        </Button>
      </div>
    </form>
  );
}
