"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteDraft, publishDraft } from "@/app/(portal)/repertuvar/omr-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/use-run-action";
import { MidiButton } from "./midi-button";

export type EditorDraft = {
  id: string;
  tracks: { name: string }[];
  measures: number | null;
  durationSec: number | null;
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** `3 ses: Kadın, Erkek, Piyano · 93 ölçü · 2:41` */
export function draftSummary(d: Omit<EditorDraft, "id">) {
  return [
    `${d.tracks.length} ses: ${d.tracks.map((t) => t.name).join(", ")}`,
    d.measures !== null ? `${d.measures} ölçü` : null,
    d.durationSec !== null ? clock(d.durationSec) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Managers only (the page and the actions check): listen, then publish or delete (D103). */
export function DraftCard({
  draft,
  scoreId,
  replacesPublished,
}: {
  draft: EditorDraft;
  scoreId: string | null;
  replacesPublished: boolean;
}) {
  const [pending, run] = useRunAction();
  const [confirm, setConfirm] = useState<"publish" | "delete" | null>(null);
  const publish = () => run(() => publishDraft(draft.id), () => setConfirm(null));
  return (
    <div className="space-y-3 rounded-2xl border border-gold/60 bg-card p-4" data-midi-draft={draft.id}>
      <div className="space-y-1">
        <h3 className="font-sans text-base font-medium">Taslak · otomatik çeviri</h3>
        <p className="text-sm text-muted-foreground" data-testid="draft-summary">
          {draftSummary(draft)}
        </p>
      </div>
      <p className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-xl bg-muted p-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          Otomatik çeviride yanlış nota olabilir. Notayla karşılaştırarak dinle.
        </span>
        {scoreId && (
          <a
            href={`/api/dosya/nota/${scoreId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline"
            aria-label="Aç: Nota (PDF)"
          >
            <ExternalLink className="size-4" aria-hidden />
            Aç
          </a>
        )}
      </p>
      <MidiButton midiId={draft.id} title="Dinle" myPart={null} variant="step" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11 rounded-full px-5"
          disabled={pending}
          onClick={() => setConfirm("publish")}
        >
          <CheckCircle2 />
          Yayınla
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full px-5 text-absent-ink"
          disabled={pending}
          onClick={() => setConfirm("delete")}
        >
          <Trash2 />
          Sil
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "publish" ? "Yayınlansın mı?" : "Taslak silinsin mi?"}
        description={
          confirm === "publish"
            ? `Koristler hemen görür ve bildirim alır.${replacesPublished ? " Önceki otomatik MIDI silinip yerine bu gelecek." : ""}`
            : "Otomatik çeviri sonucu silinir; notadan yeniden çevirebilirsin."
        }
        pending={pending}
        actions={[
          confirm === "publish"
            ? { label: "Yayınla", variant: "default", run: publish }
            : {
                label: "Sil",
                variant: "destructive",
                run: () => run(() => deleteDraft(draft.id), () => setConfirm(null)),
              },
        ]}
      />
    </div>
  );
}
