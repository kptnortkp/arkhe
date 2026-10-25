"use client";

import { RefreshCw, Trash2, Upload, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteScore, startOmr } from "@/app/(portal)/repertuvar/omr-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRunAction } from "@/components/use-run-action";
import { formatBytes } from "@/lib/format";
import { OMR_LAYOUT_LABELS, OMR_LAYOUTS, OMR_MSG, type OmrLayout } from "@/lib/omr/constants";
import { SCORE_MAX_BYTES } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { ScoreLine } from "./score-row";

export type EditorScore = { id: string; sizeBytes: number; uploadedAt: Date };

const chip =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-2 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

function UploadPicker({
  pieceId,
  replace,
  onDone,
}: {
  pieceId: string;
  replace: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) {
      setError(OMR_MSG.pickPdf);
      return;
    }
    if (file.size > SCORE_MAX_BYTES) {
      setError(OMR_MSG.pdfTooBig);
      return;
    }
    // A quick look at the head only; the server sniffs both ends again (D94).
    const head = new TextDecoder("latin1").decode(await file.slice(0, 1024).arrayBuffer());
    if (!head.includes("%PDF-")) {
      setError(OMR_MSG.notPdf);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dosya/nota?eser=${pieceId}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(json?.error ?? MSG.generic);
        return;
      }
      toast.success(OMR_MSG.scoreUploaded);
      setFile(null);
      if (input.current) input.current.value = "";
      onDone?.();
      router.refresh();
    } catch {
      setError(MSG.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-dashed p-4" data-testid="score-upload">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="score-file"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setError(f && f.size > SCORE_MAX_BYTES ? OMR_MSG.pdfTooBig : null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full px-4"
          onClick={() => input.current?.click()}
          aria-describedby="score-hint"
        >
          <Upload />
          PDF seç
        </Button>
        {file && (
          <span className="min-w-0 text-sm font-medium break-all">
            {file.name}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {formatBytes(file.size)}
            </span>
          </span>
        )}
      </div>
      <p id="score-hint" className="text-xs text-muted-foreground">
        En fazla 4 MB, 20 sayfa. Taranmış notada 300 dpi siyah-beyaz en iyi sonucu verir.
      </p>
      {error && (
        <p className="text-sm text-absent-ink" role="alert" data-testid="score-error">
          {error}
        </p>
      )}
      <Button
        type="button"
        className="h-11 rounded-xl px-6"
        disabled={busy}
        onClick={() => void upload()}
      >
        {busy ? "Yükleniyor…" : replace ? "Değiştir" : "Yükle"}
      </Button>
    </div>
  );
}

function ConvertForm({
  pieceId,
  defaults,
  active,
}: {
  pieceId: string;
  defaults: { layout: OmrLayout | null; piano: boolean; tempo: number | null };
  /** A job is queued or running: the form stays (so its result toast can show) but is disabled. */
  active: boolean;
}) {
  const [state, action, pending] = useActionState(startOmr.bind(null, pieceId), {});
  const [layout, setLayout] = useState<OmrLayout | null>(defaults.layout);
  const [piano, setPiano] = useState(defaults.piano);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) toast.success(state.success);
  }, [state]);
  const layoutError = state.fieldErrors?.layout?.[0];
  const tempoError = state.fieldErrors?.tempo?.[0];
  return (
    <form
      ref={formRef}
      className="space-y-4 rounded-2xl border bg-card p-4"
      onSubmit={(e) => submitWithoutReset(e, action)}
      noValidate
      data-testid="omr-form"
    >
      <h3 className="font-sans text-base font-medium">MIDI&apos;ye çevir</h3>
      <fieldset
        disabled={active}
        className="min-w-0 space-y-4 disabled:opacity-60"
        data-testid="omr-fields"
      >
        <fieldset className="space-y-2" aria-describedby={layoutError ? "layout-error" : undefined}>
          <legend className="mb-2 text-sm font-medium">Satır düzeni</legend>
          <div className="grid gap-2">
            {OMR_LAYOUTS.map((l) => (
              <label key={l} className={chip}>
                <input
                  type="radio"
                  name="layout"
                  value={l}
                  checked={layout === l}
                  onChange={() => setLayout(l)}
                  className="size-4 accent-primary"
                />
                {OMR_LAYOUT_LABELS[l]}
              </label>
            ))}
          </div>
          {layoutError && (
            <p id="layout-error" className="text-sm text-absent-ink" role="alert">
              {layoutError}
            </p>
          )}
        </fieldset>
        <label className={chip}>
          <input
            type="checkbox"
            name="piano"
            checked={piano}
            onChange={(e) => setPiano(e.target.checked)}
            className="size-4 accent-primary"
          />
          Altta piyano eşliği var
        </label>
        <div className="space-y-2">
          <Label htmlFor="omr-tempo">Tempo (♩ =)</Label>
          <Input
            id="omr-tempo"
            name="tempo"
            type="number"
            inputMode="numeric"
            min={40}
            max={220}
            defaultValue={state.values?.tempo ?? (defaults.tempo ? String(defaults.tempo) : "")}
            aria-invalid={tempoError ? true : undefined}
            aria-describedby={tempoError ? "omr-tempo-error" : "omr-tempo-hint"}
            className="h-11 w-32 rounded-xl"
          />
          {tempoError ? (
            <p id="omr-tempo-error" className="text-sm text-absent-ink">
              {tempoError}
            </p>
          ) : (
            <p id="omr-tempo-hint" className="text-xs text-muted-foreground">
              Boş bırakırsan notadaki tempo, o da yoksa 100.
            </p>
          )}
        </div>
        <FormMessage error={state.error} />
        <Button
          type="submit"
          className="h-12 w-full rounded-xl md:w-auto md:px-6"
          disabled={pending}
        >
          <Wand2 />
          {pending ? "Başlatılıyor…" : active ? "Çeviri sürüyor…" : "MIDI'ye çevir"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Genelde 3–8 dakika sürer. Sayfadan çıkabilirsin. Sonuç burada taslak olarak görünür; sen
          yayınlayana kadar koristler görmez.
        </p>
      </fieldset>
    </form>
  );
}

/** `Nota ve otomatik MIDI` on /duzenle (managers; the page and every action check the role). */
export function ScoreEditor({
  pieceId,
  score,
  configured,
  active,
  defaults,
  children,
}: {
  pieceId: string;
  score: EditorScore | null;
  configured: boolean;
  active: boolean;
  defaults: { layout: OmrLayout | null; piano: boolean; tempo: number | null };
  /** The `Otomatik oluşturulan` group, shown right under the score and above the form. */
  children?: React.ReactNode;
}) {
  const [pending, run] = useRunAction();
  const [confirm, setConfirm] = useState(false);
  const [replacing, setReplacing] = useState(false);
  return (
    <section
      aria-labelledby="nota"
      className="scroll-mt-20 space-y-4 md:scroll-mt-6"
      id="nota-ve-midi"
    >
      <h2 id="nota" className="text-2xl font-medium">
        Nota ve otomatik MIDI
      </h2>
      {score ? (
        <div className="space-y-3 rounded-2xl border bg-card px-4 py-3">
          <ScoreLine score={score} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full px-4"
              disabled={active}
              aria-describedby={active ? "score-locked" : undefined}
              onClick={() => setReplacing((v) => !v)}
              aria-expanded={replacing}
            >
              <RefreshCw />
              Değiştir
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full px-4 text-absent-ink"
              disabled={active}
              aria-describedby={active ? "score-locked" : undefined}
              onClick={() => setConfirm(true)}
            >
              <Trash2 />
              Sil
            </Button>
          </div>
          {active && (
            <p
              id="score-locked"
              className="text-sm text-muted-foreground"
              data-testid="score-locked"
            >
              {OMR_MSG.scoreLocked}
            </p>
          )}
          {replacing && !active && (
            <UploadPicker pieceId={pieceId} replace onDone={() => setReplacing(false)} />
          )}
        </div>
      ) : (
        <UploadPicker pieceId={pieceId} replace={false} />
      )}
      {children}
      {!configured ? (
        <p
          className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground"
          data-testid="omr-off"
        >
          {OMR_MSG.notConfigured}
        </p>
      ) : (
        score && <ConvertForm pieceId={pieceId} defaults={defaults} active={active} />
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Nota silinsin mi? Otomatik MIDI'ler kalır."
        description="PDF portaldan silinir. Drive'daki asıl dosyan etkilenmez."
        pending={pending}
        actions={[
          {
            label: "Sil",
            variant: "destructive",
            run: () =>
              run(
                () => deleteScore(pieceId),
                () => setConfirm(false),
              ),
          },
        ]}
      />
    </section>
  );
}
