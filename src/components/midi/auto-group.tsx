"use client";

import { FileMusic } from "lucide-react";
import { useState } from "react";
import { deleteMidi } from "@/app/(portal)/repertuvar/midi-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRunAction } from "@/components/use-run-action";
import { formatAuditDate } from "@/lib/time";
import { DraftCard, type EditorDraft } from "./draft-card";
import { MidiButton } from "./midi-button";
import { FileMenu } from "./midi-editor";
import { OmrStatus, type StatusJob } from "./omr-status";

export type EditorAuto = {
  id: string;
  title: string;
  sizeBytes: number;
  publisherName: string | null;
  publishedAt: Date | null;
};

/**
 * The editor's `Otomatik oluşturulan` group (D116): job status, draft and the published file,
 * right under the convert form so the result appears where it was started.
 */
export function AutoGroup({
  pieceId,
  auto,
  draft,
  job,
  scoreId,
}: {
  pieceId: string;
  auto: EditorAuto | null;
  draft: EditorDraft | null;
  job: StatusJob | null;
  scoreId: string | null;
}) {
  const [pending, run] = useRunAction();
  const [confirm, setConfirm] = useState(false);
  // `Taslak hazır` only while there is a draft to look at.
  const status = job && (job.state !== "succeeded" || draft) ? job : null;
  if (!auto && !draft && !status) return null;
  return (
    <section aria-labelledby="midi-auto-heading" className="space-y-3" data-testid="midi-auto">
      <h3 id="midi-auto-heading" className="font-sans text-base font-medium">
        Otomatik oluşturulan
      </h3>
      {status && <OmrStatus pieceId={pieceId} job={status} />}
      {draft && <DraftCard draft={draft} scoreId={scoreId} replacesPublished={auto !== null} />}
      {auto && (
        <div className="rounded-2xl border bg-card px-4 py-2.5" data-testid="midi-auto-row" data-midi-id={auto.id}>
          <MidiButton
            midiId={auto.id}
            title={auto.title}
            myPart={null}
            head={
              <>
                <FileMusic className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{auto.title}</span>
                  <span className="block text-xs text-muted-foreground" data-testid="auto-published">
                    Otomatik · {auto.publisherName ?? "Bir yönetici"} yayınladı
                    {auto.publishedAt ? ` · ${formatAuditDate(auto.publishedAt)}` : ""}
                  </span>
                </span>
              </>
            }
            after={<FileMenu m={auto} onDelete={() => setConfirm(true)} />}
          />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Otomatik MIDI silinsin mi?"
        description="Koristler artık göremez. Notadan yeniden çevirebilirsin."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () => auto && run(() => deleteMidi(auto.id), () => setConfirm(false)),
          },
        ]}
      />
    </section>
  );
}
