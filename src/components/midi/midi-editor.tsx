"use client";

import { Download, FileMusic, MoreHorizontal, Trash2, Upload } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteMidi, uploadMidi } from "@/app/(portal)/repertuvar/midi-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunAction } from "@/components/use-run-action";
import { VOICE_PARTS, type VoicePart } from "@/db/schema";
import { formatBytes } from "@/lib/format";
import { VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import { MIDI_MAX_BYTES, MIDI_MAX_PER_PIECE } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { cn } from "@/lib/utils";
import { MidiButton } from "./midi-button";

export type EditorMidi = {
  id: string;
  title: string;
  label: string | null;
  voicePart: VoicePart | null;
  sizeBytes: number;
};

const chip =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

/** Pre-selects the part from the file name; the manager corrects it if wrong. */
function guessPart(name: string): VoicePart | "tutti" {
  const n = name.toLocaleLowerCase("tr");
  if (/sop/.test(n)) return "soprano";
  if (/alt/.test(n)) return "alto";
  if (/ten/.test(n)) return "tenor";
  if (/bas/.test(n)) return "bass";
  return "tutti";
}

function UploadForm({ pieceId, full }: { pieceId: string; full: boolean }) {
  const [state, action, pending] = useActionState(uploadMidi.bind(null, pieceId), {});
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null);
  const [part, setPart] = useState<VoicePart | "tutti">("tutti");
  const [guessed, setGuessed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (!state.success) return;
    toast.success(state.success);
    /* eslint-disable react-hooks/set-state-in-effect -- reset after a confirmed upload */
    setUploadId(crypto.randomUUID());
    setFile(null);
    setPart("tutti");
    setGuessed(false);
    formRef.current?.reset();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [state]);

  if (full) {
    return <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{MSG.midiTooMany}</p>;
  }
  const fileError = localError ?? state.fieldErrors?.file?.[0];

  return (
    <form
      ref={formRef}
      className="space-y-4 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        if (!file) {
          e.preventDefault();
          setLocalError("Bir MIDI dosyası seç.");
          return;
        }
        submitWithoutReset(e, action);
      }}
      noValidate
      data-testid="midi-upload"
    >
      <h3 className="font-sans text-base font-medium">MIDI ekle</h3>
      <input type="hidden" name="uploadId" value={uploadId} />
      <div className="space-y-2 rounded-2xl border border-dashed p-4 text-center">
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="midi-file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setLocalError(f && f.size > MIDI_MAX_BYTES ? MSG.midiTooBig : null);
            if (f) {
              setPart(guessPart(f.name));
              setGuessed(true);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full px-4"
          onClick={() => fileRef.current?.click()}
          aria-describedby="midi-file-hint"
        >
          <Upload />
          Dosya seç (.mid)
        </Button>
        {file ? (
          <p className="text-sm font-medium break-all">
            {file.name} <span className="text-xs font-normal text-muted-foreground">{formatBytes(file.size)}</span>
          </p>
        ) : (
          <p id="midi-file-hint" className="text-xs text-muted-foreground">
            Her dosya en fazla 1 MB.
          </p>
        )}
        {fileError && (
          <p className="text-sm text-absent-ink" role="alert" data-testid="midi-file-error">
            {fileError}
          </p>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Partisyon</legend>
        <div className="flex flex-wrap gap-2">
          {(["tutti", ...VOICE_PARTS] as const).map((p) => (
            <label key={p} className={chip}>
              <input
                type="radio"
                name="part"
                value={p}
                checked={part === p}
                onChange={() => setPart(p)}
                className="sr-only"
              />
              {p === "tutti" ? (
                <span className="size-2 rounded-full ring-1 ring-foreground/40" />
              ) : (
                <span className={cn("size-2 rounded-full", VOICE_PART_STYLES[p].dot)} />
              )}
              {p === "tutti" ? "Tutti" : VOICE_PART_LABELS[p]}
            </label>
          ))}
        </div>
        {guessed && (
          <p className="text-xs text-muted-foreground">
            Partisyonu dosya adından tahmin ettik; yanlışsa değiştir.
          </p>
        )}
      </fieldset>
      <Field
        label="Etiket"
        name="label"
        maxLength={80}
        placeholder="ör. Alto önde"
        defaultValue={state.values?.label ?? ""}
        errors={state.fieldErrors?.label}
        hint={`Boş bırakırsan “MIDI · ${part === "tutti" ? "Tutti" : VOICE_PART_LABELS[part]}” yazar.`}
      />
      <FormMessage error={state.error} />
      <Button type="submit" className="h-12 w-full rounded-xl md:w-auto md:px-6" disabled={pending}>
        {pending ? "Yükleniyor…" : "Yükle"}
      </Button>
    </form>
  );
}

export function MidiEditor({ pieceId, files }: { pieceId: string; files: EditorMidi[] }) {
  const [pending, run] = useRunAction();
  const [doomed, setDoomed] = useState<EditorMidi | null>(null);
  return (
    <section aria-labelledby="midi" className="space-y-4" id="midi-dosyalari">
      <h2 id="midi" className="flex items-baseline gap-2 text-2xl font-medium">
        MIDI dosyaları
        <span className="text-base text-muted-foreground tabular-nums">{files.length}</span>
      </h2>
      {files.length > 0 && (
        <ul className="divide-y rounded-2xl border bg-card" data-testid="midi-editor-list">
          {files.map((m) => (
            <li key={m.id} className="px-4 py-2.5" data-testid="midi-editor-row">
              <MidiButton
                midiId={m.id}
                title={m.title}
                myPart={null}
                head={
                  <>
                    <FileMusic className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.voicePart ? VOICE_PART_LABELS[m.voicePart] : "Tutti"} · {formatBytes(m.sizeBytes)}
                      </span>
                    </span>
                  </>
                }
                after={
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          className="size-11 shrink-0 rounded-full"
                          aria-label={`Diğer işlemler: ${m.title}`}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem
                        className="min-h-11"
                        render={<a href={`/api/dosya/midi/${m.id}?indir=1`} />}
                      >
                        <Download />
                        İndir
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-11"
                        variant="destructive"
                        onClick={() => setDoomed(m)}
                      >
                        <Trash2 />
                        Sil
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <UploadForm pieceId={pieceId} full={files.length >= MIDI_MAX_PER_PIECE} />
      <ConfirmDialog
        open={doomed !== null}
        onOpenChange={(o) => !o && setDoomed(null)}
        title={`"${doomed?.label ?? doomed?.title ?? ""}" silinsin mi?`}
        description="Dosya portaldan silinir. Drive'daki asıl dosyan etkilenmez."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () => doomed && run(() => deleteMidi(doomed.id), () => setDoomed(null)),
          },
        ]}
      />
    </section>
  );
}
