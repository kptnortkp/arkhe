"use client";

import { Download, MoreHorizontal, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteAudio, setAudioSection } from "@/app/(portal)/repertuvar/audio-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { downloadInApp } from "@/components/download-link";
import { AudioItem } from "@/components/audio/audio-list";
import { uploadBlob } from "@/components/recording/upload";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunAction } from "@/components/use-run-action";
import { VOICE_PARTS, type VoicePart } from "@/db/schema";
import { formatBytes, searchKey } from "@/lib/format";
import { VOICE_PART_LABELS } from "@/lib/labels";
import type { AudioRow } from "@/lib/repertoire-audio";
import {
  AUDIO_MAX_PER_PIECE,
  MIDI_LABEL_MAX,
  RECORDING_MAX_BYTES,
  UPLOAD_ID_HEADER,
} from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";

type Part = VoicePart | "tutti";
/** "" = the whole part. */
type Section = "" | "1" | "2";
type QueueState = "ready" | "uploading" | "done" | "failed";
type Queued = {
  key: string;
  file: File;
  part: Part;
  section: Section;
  label: string;
  state: QueueState;
  error: string | null;
  uploadId: string;
};

// A single letter only with a digit (S1, B2): "A cappella" must not read as Alto.
const PART_WORDS: [Part, RegExp][] = [
  ["soprano", /^(s[12]|(sop|sopran|soprano)[12]?)$/],
  ["alto", /^(a[12]|(alt|alto)[12]?)$/],
  ["tenor", /^(t[12]|(ten|tenor)[12]?)$/],
  ["bass", /^(b[12]|(bas|bass|basso)[12]?)$/],
  ["tutti", /^(toplu|tutti|hepsi|tumu)$/],
];

/** The part (and B2-style sub-part) from the file name's words; the piece title can't match. */
export function guessAudio(
  fileName: string,
  pieceTitle: string,
): { part: Part; section: Section; label: string } {
  const base = fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
  const title = searchKey(pieceTitle).trim();
  const words = base.split(/[\s_\-–.,()+]+/).filter(Boolean);
  const kept = words.filter((w) => !title.split(/\s+/).includes(searchKey(w)));
  const found = new Set<Part>();
  const sections = new Set<Section>();
  kept.forEach((w, i) => {
    const k = searchKey(w);
    for (const [part, re] of PART_WORDS) {
      if (!re.test(k)) continue;
      found.add(part);
      // "Bas2", "B2" or "Bas 2"
      const next = kept[i + 1];
      const digit = k.match(/[12]$/)?.[0] ?? (next === "1" || next === "2" ? next : "");
      if (part !== "tutti") sections.add(digit as Section);
    }
  });
  const part = found.size === 1 ? [...found][0] : "tutti";
  const section = part !== "tutti" && sections.size === 1 ? [...sections][0] : "";
  // Drop the piece title from the label: the page already shows it.
  let label = base;
  if (title) {
    const at = searchKey(label).indexOf(title);
    if (at >= 0) label = label.slice(0, at) + label.slice(at + title.length);
  }
  label = label.replace(/^[\s_\-–.,|]+|[\s_\-–.,|]+$/g, "").replace(/\s{2,}/g, " ");
  // Just the part word: no label, the row is named by its part.
  const bare = searchKey(label).replace(/\s+([12])$/, "$1");
  if (PART_WORDS.some(([, re]) => re.test(bare))) label = "";
  return { part, section, label: label.slice(0, MIDI_LABEL_MAX) };
}

function FileMenu({ a, onDelete }: { a: AudioRow; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="size-11 shrink-0 rounded-full"
            aria-label={`Diğer işlemler: ${a.title}`}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          className="min-h-11"
          render={<a href={`/api/dosya/ses/${a.id}?indir=1`} onClick={downloadInApp} />}
        >
          <Download />
          İndir
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" variant="destructive" onClick={onDelete}>
          <Trash2 />
          Sil
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: Section;
  disabled?: boolean;
  onChange: (section: Section) => void;
}) {
  return (
    <select
      aria-label={label}
      className="h-11 w-28 shrink-0 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Section)}
    >
      <option value="">Tümü</option>
      <option value="1">1</option>
      <option value="2">2</option>
    </select>
  );
}

const select =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

function UploadQueue({
  pieceId,
  pieceTitle,
  room,
}: {
  pieceId: string;
  pieceTitle: string;
  room: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Leaving the page stops the queue; a reload or a closed tab asks first.
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const update = (key: string, patch: Partial<Queued>) =>
    setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function add(files: FileList | null) {
    if (!files) return;
    const next = [...files].map((file): Queued => {
      const guess = guessAudio(file.name, pieceTitle);
      const tooBig = file.size > RECORDING_MAX_BYTES;
      return {
        key: crypto.randomUUID(),
        file,
        ...guess,
        state: tooBig ? "failed" : "ready",
        error: tooBig ? MSG.audioTooBig : null,
        uploadId: crypto.randomUUID(),
      };
    });
    setQueue((q) => [...q.filter((x) => x.state !== "done"), ...next]);
  }

  async function uploadAll() {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    let left = room;
    let sent = 0;
    for (const item of queue) {
      if (controller.signal.aborted) break;
      if (item.state !== "ready") continue;
      if (left <= 0) {
        update(item.key, { state: "failed", error: MSG.audioTooMany });
        continue;
      }
      update(item.key, { state: "uploading", error: null });
      setProgress(0);
      const q = new URLSearchParams({ eser: pieceId, ses: item.part });
      if (item.part !== "tutti" && item.section) q.set("alt", item.section);
      if (item.label.trim()) q.set("etiket", item.label.trim());
      const res = await uploadBlob(`/api/dosya/ses?${q}`, item.file, {
        headers: { [UPLOAD_ID_HEADER]: item.uploadId },
        onProgress: setProgress,
        signal: controller.signal,
        timeoutMs: 120_000,
      });
      if (res.ok) {
        update(item.key, { state: "done" });
        left -= 1;
        sent += 1;
      } else {
        // Too big, wrong type or a full piece can't succeed; anything else can be retried as is.
        const final = res.code === "size" || res.code === "type" || res.code === "limit";
        const error =
          res.code === "size"
            ? MSG.audioTooBig
            : res.code === "network" || res.code === "aborted"
              ? "Bağlantı koptu; tekrar dene."
              : (res.error ?? MSG.generic);
        update(item.key, { state: final ? "failed" : "ready", error });
      }
    }
    setProgress(null);
    setBusy(false);
    if (sent > 0) {
      toast.success(sent === 1 ? MSG.audioUploaded : `${sent} ses kaydı yüklendi.`);
      router.refresh();
    }
  }

  const ready = queue.filter((x) => x.state === "ready").length;

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4" data-testid="audio-upload">
      <h3 className="font-sans text-base font-medium">Ses kaydı ekle</h3>
      <div
        className="space-y-2 rounded-2xl border border-dashed p-4 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) add(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="audio-file"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full px-4"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          aria-describedby="audio-file-hint"
        >
          <Upload />
          Dosya seç (birden fazla olabilir)
        </Button>
        <p id="audio-file-hint" className="text-xs text-muted-foreground">
          mp3, m4a, wav… Her dosya en fazla 4 MB. Partisyon ve etiket dosya adından tahmin edilir.
        </p>
      </div>
      {queue.length > 0 && (
        <ul className="space-y-3" data-testid="audio-queue">
          {queue.map((item) => (
            <li
              key={item.key}
              className="space-y-2 rounded-xl border p-3"
              data-testid="audio-queue-row"
              data-state={item.state}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-medium break-all">
                  {item.file.name}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {formatBytes(item.file.size)}
                  </span>
                </p>
                {item.state !== "uploading" && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 shrink-0 rounded-full"
                    aria-label={`Listeden çıkar: ${item.file.name}`}
                    disabled={busy}
                    onClick={() => setQueue((q) => q.filter((x) => x.key !== item.key))}
                  >
                    <X />
                  </Button>
                )}
              </div>
              {item.state === "ready" && (
                <div className="grid gap-2 sm:grid-cols-[10rem_auto_1fr]">
                  <div className="flex gap-2 sm:contents">
                    <select
                      aria-label={`Partisyon: ${item.file.name}`}
                      className={select}
                      value={item.part}
                      disabled={busy}
                      onChange={(e) =>
                        update(item.key, {
                          part: e.target.value as Part,
                          ...(e.target.value === "tutti" ? { section: "" as const } : {}),
                        })
                      }
                    >
                      <option value="tutti">Tutti</option>
                      {VOICE_PARTS.map((p) => (
                        <option key={p} value={p}>
                          {VOICE_PART_LABELS[p]}
                        </option>
                      ))}
                    </select>
                    {item.part !== "tutti" && (
                      <SectionSelect
                        label={`${item.file.name} için alt partisyon`}
                        value={item.section}
                        disabled={busy}
                        onChange={(section) => update(item.key, { section })}
                      />
                    )}
                  </div>
                  <input
                    aria-label={`Etiket: ${item.file.name}`}
                    className={select}
                    value={item.label}
                    maxLength={MIDI_LABEL_MAX}
                    placeholder="ör. Hızlı, Eşlikli"
                    disabled={busy}
                    onChange={(e) => update(item.key, { label: e.target.value })}
                  />
                </div>
              )}
              {item.state === "uploading" && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground" role="status">
                    Yükleniyor…
                  </p>
                  <progress
                    className="h-2 w-full accent-primary"
                    max={100}
                    value={progress ?? 0}
                    aria-label={`Yükleniyor: ${item.file.name}`}
                  />
                </div>
              )}
              {item.state === "done" && <p className="text-sm text-present-ink">Yüklendi.</p>}
              {item.error && (
                <p className="text-sm text-absent-ink" role="alert">
                  {item.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {ready > 0 && (
        <Button
          type="button"
          className="h-12 w-full rounded-xl md:w-auto md:px-6"
          disabled={busy}
          onClick={uploadAll}
        >
          {busy ? "Yükleniyor…" : ready === 1 ? "Yükle" : `${ready} dosyayı yükle`}
        </Button>
      )}
    </div>
  );
}

export function AudioEditor({
  pieceId,
  pieceTitle,
  files,
}: {
  pieceId: string;
  pieceTitle: string;
  files: AudioRow[];
}) {
  const [pending, run] = useRunAction();
  const [doomed, setDoomed] = useState<AudioRow | null>(null);
  const room = AUDIO_MAX_PER_PIECE - files.length;
  return (
    <section
      aria-labelledby="ses"
      className="scroll-mt-20 space-y-4 md:scroll-mt-6"
      id="ses-kayitlari"
    >
      <h2 id="ses" className="flex items-baseline gap-2 text-2xl font-medium">
        Ses kayıtları
        <span className="text-base text-muted-foreground tabular-nums">{files.length}</span>
      </h2>
      {files.length > 0 && (
        <ul className="divide-y rounded-2xl border bg-card" data-testid="audio-editor-list">
          {files.map((a) => (
            <li key={a.id} className="px-4 py-2.5" data-testid="audio-editor-row">
              <AudioItem
                a={a}
                extra={formatBytes(a.sizeBytes)}
                after={<FileMenu a={a} onDelete={() => setDoomed(a)} />}
              />
              {a.voicePart && (
                <label className="mt-1 flex items-center gap-2 pl-4 text-xs text-muted-foreground">
                  Alt partisyon
                  <SectionSelect
                    label={`${a.title} için alt partisyon`}
                    value={a.section ? (String(a.section) as Section) : ""}
                    disabled={pending}
                    onChange={(v) => run(() => setAudioSection(a.id, v ? Number(v) : null))}
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      {room > 0 ? (
        <UploadQueue pieceId={pieceId} pieceTitle={pieceTitle} room={room} />
      ) : (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          {MSG.audioTooMany}
        </p>
      )}
      <ConfirmDialog
        open={doomed !== null}
        onOpenChange={(o) => !o && setDoomed(null)}
        title={`"${doomed?.title ?? ""}" silinsin mi?`}
        description="Ses kaydı portaldan silinir. Drive'daki asıl dosyan etkilenmez."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              doomed &&
              run(
                () => deleteAudio(doomed.id),
                () => setDoomed(null),
              ),
          },
        ]}
      />
    </section>
  );
}
