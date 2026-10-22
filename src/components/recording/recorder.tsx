"use client";

import {
  AudioLines,
  CircleCheck,
  Download,
  Mic,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { deleteMyRecording } from "@/app/(portal)/odevler/kayit-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useRunAction } from "@/components/use-run-action";
import {
  DURATION_HEADER,
  MAX_UPLOADS_PER_SLOT,
  RECORDING_MAX_BYTES,
  UPLOAD_ID_HEADER,
} from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { dayInstant, formatAuditDate, formatShortDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AudioPlayer, clock } from "./audio-player";
import { clearTake, getTake, setTake, takeKey, type Take } from "./take-store";
import { uploadBlob } from "./upload";
import { recorderSupported, useMediaRecorder, type MicProblem } from "./use-media-recorder";

export type RecorderTake = {
  id: string;
  durationMs: number | null;
  uploadedAt: string;
  replacedEarlier: boolean;
  audioDeletedAt: string | null;
  deleteOn: string;
};

type View = "base" | "new" | "preview" | "uploading" | "failed" | "mic";
type Failure = { message: string; retry: boolean };

const OFFLINE =
  "İnternet bağlantın yok gibi görünüyor. Kaydın kaybolmadı: bağlanınca tekrar dene ya da Kaydı indir ile telefonuna kaydet.";
const MIC_TEXT: Record<MicProblem, { title: string; body: string | null }> = {
  denied: { title: "Mikrofon izni verilmedi.", body: null },
  nomic: {
    title: "Mikrofon bulunamadı.",
    body: "Bu cihazda mikrofon görünmüyor. Kulaklık taktıysan çıkarıp tekrar dene ya da Dosya yükle'yi kullan.",
  },
  busy: {
    title: "Mikrofon şu an kullanılıyor.",
    body: "Başka bir uygulama (ör. telefon görüşmesi) mikrofonu kullanıyor. Onu kapatıp Tekrar dene'ye dokun.",
  },
};
const DENIED_A11Y =
  "Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver ya da telefonundaki ses kaydediciyle kaydedip Dosya yükle'yi kullan.";
const NOTICES = {
  limit: "Kayıt 10 dakikada durdu.",
  hidden:
    "Ekran kilitlendiği ya da başka uygulamaya geçtiğin için kayıt durdu. Kaydın burada: dinle, gönder ya da yeniden kaydet.",
  interrupted: "Kayıt yarıda kesildi; kaydedilen kısım duruyor.",
  restored: "Gönderilmemiş bir kaydın var.",
} as const;

const EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
};
const noop = () => () => {};

function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  return /Android/.test(ua) ? "android" : "other";
}

/** Reads a picked file's duration; Infinity (WebM) is resolved by seeking to the end. */
function fileDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let done = false;
    const end = (sec: number | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(sec !== null && Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null);
    };
    setTimeout(() => end(null), 3000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) end(audio.duration);
      else {
        audio.ondurationchange = () => Number.isFinite(audio.duration) && end(audio.duration);
        audio.currentTime = 1e9;
      }
    };
    audio.onerror = () => end(null);
    audio.src = url;
  });
}

const box = "space-y-2 rounded-2xl border p-3 text-sm";

export function Recorder({
  assignmentId,
  userId,
  maxMs,
  fileBase,
  uploadsPaused,
  storageReady,
  playbackPaused,
  take,
  submittedAt,
  manual,
  locked,
  uploadsUsed,
  canUpload,
  canDelete,
}: {
  assignmentId: string;
  userId: string;
  maxMs: number;
  /** ASCII-safe `<Eser>-<Ad-Soyad>` for `Kaydı indir`. */
  fileBase: string;
  uploadsPaused: boolean;
  storageReady: boolean;
  playbackPaused: boolean;
  take: RecorderTake | null;
  submittedAt: string | null;
  manual: boolean;
  locked: boolean;
  uploadsUsed: number;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const key = takeKey(userId, assignmentId);
  const [view, setView] = useState<View>("base");
  const [local, setLocal] = useState<Take | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<MicProblem | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  // The server refused this very file (type/size/empty); sending it again can only fail.
  const [refused, setRefused] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [progress, setProgress] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [confirm, setConfirm] = useState<"retake" | "delete" | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [askPermission, setAskPermission] = useState(false);
  const [retried, setRetried] = useState(false);
  const [pending, run] = useRunAction();
  const supported = useSyncExternalStore(noop, recorderSupported, () => true);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const altRef = useRef<HTMLButtonElement>(null);
  const sentRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastAnnounced = useRef(-1);
  const justSent = useRef(false);
  const blocked = uploadsPaused || !storageReady;

  const rec = useMediaRecorder({
    maxMs,
    onDone: ({ blob, durationMs, reason }) => {
      const t: Take = { blob, durationMs, uploadId: crypto.randomUUID(), source: "record" };
      setTake(key, t);
      setLocal(t);
      setInlineError(null);
      setRefused(false);
      setNotice(reason === "user" ? null : NOTICES[reason]);
      setView("preview");
      setAnnounce(
        reason === "limit" ? NOTICES.limit : `Kayıt durdu, ${clock(durationMs / 1000)}.`,
      );
    },
    onProblem: (p) => {
      setProblem(p);
      setView("mic");
      setAnnounce(MIC_TEXT[p].title);
    },
    onEmpty: () => {
      setInlineError(MSG.emptyTake);
      setView("new");
    },
  });
  const recording = rec.phase === "recording";
  const counting = rec.phase === "countdown" || rec.phase === "requesting";

  // An unsent take from before an in-app navigation comes back (D40).
  useEffect(() => {
    const kept = getTake(key);
    if (!kept) return;
    /* eslint-disable react-hooks/set-state-in-effect -- the take store only exists in the browser */
    setLocal(kept);
    setNotice(NOTICES.restored);
    setView("preview");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);

  useEffect(() => {
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((s) => setAskPermission(s.state !== "granted"))
      .catch(() => setAskPermission(true));
  }, []);

  useEffect(() => {
    if (!local) return;
    const url = URL.createObjectURL(local.blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL lives with the take
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [local]);

  // beforeunload covers reload, closing the tab and leaving the site while a take is unsent.
  const unsent = recording || counting || (local !== null && view !== "base");
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [unsent]);

  useEffect(() => {
    if (recording && rec.elapsed >= maxMs - 60_000 && maxMs > 60_000 && lastAnnounced.current < 1) {
      lastAnnounced.current = 1;
      setAnnounce("1 dakika kaldı.");
    }
  }, [recording, rec.elapsed, maxMs]);

  // Focus the sent row once the refreshed take arrives.
  useEffect(() => {
    if (!justSent.current || !take) return;
    justSent.current = false;
    sentRef.current?.focus();
  }, [take]);

  useEffect(() => {
    if (view === "preview") (sendRef.current ?? altRef.current)?.focus();
    if (view === "failed") errorRef.current?.focus();
  }, [view]);

  function openFallback() {
    const d = document.getElementById("baska-yolla");
    if (d instanceof HTMLDetailsElement) d.open = true;
  }

  function startRecording() {
    setProblem(null);
    setInlineError(null);
    setNotice(null);
    lastAnnounced.current = -1;
    rec.start();
  }

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- announce the phase change once */
    if (rec.phase === "countdown") setAnnounce("Kayıt 3 saniye sonra başlıyor.");
    if (rec.phase === "recording") setAnnounce("Kayıt başladı.");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [rec.phase]);

  async function pickFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setInlineError(null);
    setRefused(false);
    if (file.size === 0) return setInlineError(MSG.emptyFile);
    if (file.size > RECORDING_MAX_BYTES) return setInlineError(MSG.tooBig);
    const durationMs = await fileDuration(file);
    const t: Take = { blob: file, durationMs, uploadId: crypto.randomUUID(), source: "file" };
    setTake(key, t);
    setLocal(t);
    setNotice(null);
    setView("preview");
  }

  async function send() {
    const t = local;
    if (!t) return;
    setInlineError(null);
    if (navigator.onLine === false) {
      setFailure({ message: OFFLINE, retry: true });
      setView("failed");
      openFallback();
      return;
    }
    setProgress(0);
    setView("uploading");
    setAnnounce("Gönderiliyor.");
    const controller = new AbortController();
    abortRef.current = controller;
    const out = await uploadBlob(`/api/dosya/kayit?odev=${assignmentId}`, t.blob, {
      headers: {
        [UPLOAD_ID_HEADER]: t.uploadId,
        ...(t.durationMs !== null && { [DURATION_HEADER]: String(Math.round(t.durationMs)) }),
      },
      onProgress: setProgress,
      signal: controller.signal,
    });
    abortRef.current = null;
    if (out.ok) {
      clearTake(key);
      setLocal(null);
      setNotice(null);
      setView("base");
      const text = out.result.replaced ? MSG.replaced : MSG.sent;
      toast.success(text);
      setAnnounce(text);
      justSent.current = true;
      router.refresh();
      return;
    }
    switch (out.code) {
      case "aborted":
        setView("preview");
        return;
      case "type":
      case "size":
      case "empty":
        setInlineError(out.code === "size" ? MSG.tooBig : (out.error ?? MSG.wrongType));
        setRefused(true);
        setView("preview");
        return;
      case "network":
        setFailure({ message: OFFLINE, retry: true });
        break;
      case "storage":
      case "rate":
      case "bad_request":
        setFailure({ message: out.error ?? MSG.putFailed, retry: true });
        break;
      default:
        setFailure({ message: out.error ?? MSG.generic, retry: false });
        router.refresh();
    }
    setView("failed");
    openFallback();
    setAnnounce(out.error ?? MSG.putFailed);
  }

  function discard() {
    clearTake(key);
    setLocal(null);
    setNotice(null);
    setInlineError(null);
    setRefused(false);
  }

  const ext = local ? (EXT[local.blob.type.split(";")[0]] ?? "m4a") : "m4a";
  const downloadName = `${fileBase}.${ext}`;
  const downloadLink = (primary: boolean) =>
    downloadUrl && (
      <a
        href={downloadUrl}
        download={downloadName}
        className={cn(
          buttonVariants({ variant: primary ? "default" : "outline" }),
          "h-12 w-full rounded-2xl text-base md:max-w-sm",
        )}
        data-testid="take-download"
      >
        <Download />
        Kaydı indir
      </a>
    );
  const liveTake = Boolean(take && !take.audioDeletedAt);
  const countLine =
    uploadsUsed >= 3 ? (
      <p className="text-xs text-muted-foreground tabular-nums" data-testid="upload-count">
        {MAX_UPLOADS_PER_SLOT} yükleme hakkından {uploadsUsed} tanesini kullandın.
        {!liveTake && " Silinen kayıtlar da sayılır."}
      </p>
    ) : null;

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="audio/*,.m4a,.mp3,.aac,.wav,.ogg,.opus,.webm"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid="recording-file"
      onChange={(e) => void pickFile(e.target.files?.[0])}
    />
  );
  const fileButton = (label = "Dosya yükle") => (
    <Button
      type="button"
      variant="outline"
      className="h-12 w-full rounded-2xl text-base md:max-w-sm"
      onClick={() => fileRef.current?.click()}
    >
      <Upload />
      {label}
    </Button>
  );

  const errorLine = inlineError && (
    <div className={cn(box, "border-late/40 bg-late/10 text-late-ink")} role="alert">
      {inlineError}
    </div>
  );

  function idleControls(replacing: boolean) {
    return (
      <div className="space-y-3">
        {blocked && (
          <div className={cn(box, "flex gap-2 border-late/40 bg-late/10")} data-testid="uploads-paused">
            <TriangleAlert className="size-4 shrink-0 text-late-ink" aria-hidden />
            <p>
              {storageReady
                ? "Kayıt alanı şu an dolu; yükleme geçici olarak kapalı. Kaydedip telefonuna indirebilirsin, sonra şefe başka yolla gönderebilirsin."
                : MSG.disabled}
            </p>
          </div>
        )}
        {replacing && (
          <p className="text-xs text-muted-foreground">Yeni kaydı gönderince eskisi silinir.</p>
        )}
        {errorLine}
        {supported && (
          <p className="text-xs text-muted-foreground">
            Kulaklık takarsan MIDI&apos;yi dinlerken kayıt yapabilirsin.
          </p>
        )}
        {supported ? (
          <Button
            type="button"
            className="h-14 w-full rounded-2xl text-[17px] md:max-w-sm"
            onClick={startRecording}
          >
            <Mic className="size-5" />
            Kayda başla
          </Button>
        ) : (
          <div className="space-y-1" data-testid="no-recorder">
            <p className="text-sm">Bu tarayıcı kayıt yapamıyor; Dosya yükle&apos;yi kullan.</p>
            <p className="text-xs text-muted-foreground">
              Bağlantıyı WhatsApp ya da Instagram içinden açtıysan Safari&apos;de ya da Chrome&apos;da
              aç.
            </p>
          </div>
        )}
        {!blocked && fileButton()}
        {supported && askPermission && (
          <p className="text-xs text-muted-foreground">
            Telefon mikrofon izni isteyecek; İzin Ver&apos;e dokun.
          </p>
        )}
        {!blocked && (
          <details className="group text-xs">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">
              Telefonumdaki bir kaydı nasıl yüklerim?
            </summary>
            <ol className="list-decimal space-y-1 pb-1 pl-4 text-muted-foreground">
              <li>
                iPhone: Ses Kayıtları&apos;nda kaydı aç → Paylaş → Dosyalar&apos;a Kaydet. Sonra
                burada Dosya yükle → Göz At.
              </li>
              <li>
                Android: Ses kaydedicide kaydı seç → Paylaş yerine burada Dosya yükle&apos;ye dokun
                ve kaydı seç.
              </li>
            </ol>
          </details>
        )}
        {countLine}
        {replacing && (
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full md:max-w-sm"
            onClick={() => setView("base")}
          >
            Vazgeç
          </Button>
        )}
      </div>
    );
  }

  function micBox() {
    const p = problem ?? "denied";
    const os = typeof navigator !== "undefined" ? platform() : "other";
    const steps = {
      ios: (
        <>
          <p>İzin vermek için iPhone&apos;da:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>Adres çubuğundaki aA simgesine dokun.</li>
            <li>Web Sitesi Ayarları → Mikrofon → İzin Ver.</li>
            <li>Aşağıdaki Tekrar dene&apos;ye dokun.</li>
          </ol>
          <p className="text-xs">
            Ana ekrana eklediğin uygulamadan açtıysan: Ayarlar → Uygulamalar → Safari → Mikrofon →
            Sor. Sonra uygulamayı kapatıp yeniden aç.
          </p>
        </>
      ),
      android: (
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>Adres çubuğunun solundaki simgeye dokun.</li>
          <li>İzinler → Mikrofon → İzin ver.</li>
          <li>Tekrar dene&apos;ye dokun.</li>
        </ol>
      ),
      other: (
        <p>
          Adres çubuğundaki kilit simgesine tıkla, Mikrofon&apos;u İzin ver yap ve Tekrar dene&apos;ye
          tıkla.
        </p>
      ),
    };
    return (
      <div className="space-y-3">
        <div
          className={cn(box, "border-late/40 bg-late/10")}
          role="alert"
          data-testid="mic-problem"
        >
          <p className="font-medium text-late-ink">{MIC_TEXT[p].title}</p>
          {p === "denied" ? (
            <>
              <p id="mic-denied-desc" className="sr-only">
                {DENIED_A11Y}
              </p>
              <div className="space-y-1.5">
                {steps[os]}
              </div>
              <details className="text-xs">
                <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">
                  Başka bir telefon mu?
                </summary>
                <div className="space-y-2">
                  {(["ios", "android", "other"] as const)
                    .filter((k) => k !== os)
                    .map((k) => (
                      <div key={k}>{steps[k]}</div>
                    ))}
                </div>
              </details>
              {retried && os === "ios" && (
                <div className="space-y-1">
                  <p className="text-xs">Değişiklik görünmüyorsa sayfayı yenile.</p>
                  <Button variant="ghost" className="h-11" onClick={() => location.reload()}>
                    Sayfayı yenile
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p>{MIC_TEXT[p].body}</p>
          )}
        </div>
        <Button
          type="button"
          className="h-12 w-full rounded-2xl text-base md:max-w-sm"
          onClick={() => {
            setRetried(true);
            startRecording();
          }}
        >
          <RefreshCw />
          Tekrar dene
        </Button>
        {!blocked && fileButton()}
        <p className="text-xs text-muted-foreground">
          {blocked
            ? "Ya da telefonundaki ses kaydediciyle kaydet ve şefe başka yolla gönder."
            : "Ya da telefonundaki ses kaydediciyle kaydet, sonra Dosya yükle'yi kullan."}
        </p>
      </div>
    );
  }

  function recordingView() {
    const lastMinute = recording && maxMs > 60_000 && rec.elapsed >= maxMs - 60_000;
    return (
      <div className="space-y-4" data-last-minute={lastMinute || undefined}>
        {counting ? (
          <div className="space-y-1 text-center">
            <p className="text-sm text-muted-foreground">Hazırlan…</p>
            <p className="font-heading text-6xl tabular-nums" aria-hidden data-testid="count-in">
              {rec.phase === "requesting" ? "…" : rec.count}
            </p>
            {rec.phase === "requesting" && (
              <p className="text-xs text-muted-foreground">Mikrofon açılıyor…</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-absent-ink">
                <span className="size-2.5 rounded-full bg-absent motion-safe:animate-pulse" aria-hidden />
                Kaydediliyor
              </span>
              <span className="text-xs text-muted-foreground">
                {clock(maxMs / 1000)}&apos;da durur
              </span>
            </div>
            <p
              role="timer"
              className={cn(
                "text-center font-heading text-5xl tabular-nums",
                lastMinute && "text-late-ink",
              )}
              data-testid="rec-timer"
            >
              {clock(rec.elapsed / 1000)}{" "}
              <span className="text-lg text-muted-foreground">/ {clock(maxMs / 1000)}</span>
            </p>
            {lastMinute && <p className="text-center text-sm text-late-ink">1 dakikadan az kaldı.</p>}
          </>
        )}
        <div
          ref={rec.barsRef}
          aria-hidden
          className={cn(
            "flex h-12 items-end gap-[3px] motion-reduce:hidden",
            counting && "opacity-50 grayscale",
          )}
        >
          {Array.from({ length: rec.bars }, (_, i) => (
            <span
              key={i}
              className="flex-1 rounded-sm bg-primary"
              style={{ height: "6%", opacity: 0.35 + (0.65 * i) / rec.bars }}
            />
          ))}
        </div>
        {(rec.loud || rec.silent) && (
          <div className={cn(box, "border-late/40 bg-late/10 text-late-ink")} role="status">
            {rec.loud
              ? "Ses çok yüksek; telefonu biraz uzaklaştır."
              : "Ses gelmiyor. Mikrofonun kapalı ya da kapalı bir kılıfın içinde olabilir."}
          </div>
        )}
        {counting ? (
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full md:max-w-sm"
            onClick={() => {
              rec.cancel();
              setView(view === "mic" ? "new" : view);
            }}
          >
            Vazgeç
          </Button>
        ) : (
          <Button
            type="button"
            aria-label="Kaydı durdur"
            className="h-14 w-full rounded-2xl bg-absent text-[17px] text-absent-foreground hover:bg-absent hover:brightness-95 md:max-w-sm"
            onClick={() => rec.stop("user")}
          >
            <Square className="size-5 fill-current" />
            Durdur
          </Button>
        )}
      </div>
    );
  }

  function previewView() {
    if (!local) return null;
    const last = uploadsUsed === MAX_UPLOADS_PER_SLOT - 1;
    return (
      <div className="space-y-3">
        {notice && (
          <p className="text-sm" data-testid="recorder-notice">
            {notice}
          </p>
        )}
        <div>
          <p className="font-medium tabular-nums">
            Kaydın hazır{local.durationMs !== null ? ` · ${clock(local.durationMs / 1000)}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Henüz gönderilmedi. Dinleyip beğendiysen gönder.
          </p>
        </div>
        <AudioPlayer blob={local.blob} durationMs={local.durationMs} />
        {errorLine}
        {last && <p className="text-xs font-medium text-late-ink">Bu son yükleme hakkın.</p>}
        {countLine}
        {blocked ? (
          downloadLink(true)
        ) : (
          !refused && (
            <Button
              ref={sendRef}
              type="button"
              className="h-14 w-full rounded-2xl text-[17px] md:max-w-sm"
              onClick={() => void send()}
              aria-label="Kaydı gönder"
            >
              <Send className="size-5" />
              Gönder
            </Button>
          )
        )}
        <Button
          ref={altRef}
          type="button"
          variant={refused && !blocked ? "default" : "outline"}
          className={cn(
            "w-full rounded-2xl md:max-w-sm",
            refused && !blocked ? "h-14 text-[17px]" : "h-12 text-base",
          )}
          onClick={() =>
            local.source === "file" ? fileRef.current?.click() : setConfirm("retake")
          }
        >
          {local.source === "file" ? <Upload /> : <RotateCcw />}
          {local.source === "file" ? "Başka dosya seç" : "Yeniden kaydet"}
        </Button>
      </div>
    );
  }

  function uploadingView() {
    return (
      <div className="space-y-3">
        <p className="font-medium tabular-nums">
          {progress >= 100 ? "Kaydediliyor…" : `Gönderiliyor… %${progress}`}
        </p>
        <div
          role="progressbar"
          aria-label="Gönderiliyor"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          Sayfadan çıkma. Bağlantın yavaşsa bir dakika sürebilir.
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-12 w-full md:max-w-sm"
          onClick={() => abortRef.current?.abort()}
        >
          Vazgeç
        </Button>
      </div>
    );
  }

  function failedView() {
    if (!local) return null;
    return (
      <div className="space-y-3">
        <div
          ref={errorRef}
          tabIndex={-1}
          className={cn(box, "border-absent/40 bg-absent/10 text-absent-ink outline-none")}
          role="alert"
          data-testid="upload-error"
        >
          {failure?.message}
        </div>
        <AudioPlayer blob={local.blob} durationMs={local.durationMs} />
        {failure?.retry && (
          <Button
            type="button"
            className="h-12 w-full rounded-2xl text-base md:max-w-sm"
            onClick={() => void send()}
          >
            <RefreshCw />
            Tekrar dene
          </Button>
        )}
        {downloadLink(!failure?.retry)}
        <p className="text-xs text-muted-foreground">
          iPhone&apos;da açılan ekranda Paylaş → Dosyalar&apos;a Kaydet&apos;i seç. Sonra şefe başka yolla
          gönder.
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full text-muted-foreground md:max-w-sm"
          onClick={() =>
            local.source === "file" ? fileRef.current?.click() : setConfirm("retake")
          }
        >
          {local.source === "file" ? "Başka dosya seç" : "Yeniden kaydet"}
        </Button>
      </div>
    );
  }

  function baseView() {
    const live = take && !take.audioDeletedAt ? take : null;
    const gone = take && take.audioDeletedAt ? take : null;
    const sentAt = submittedAt ?? take?.uploadedAt ?? null;
    const sentLine =
      take && sentAt ? (
        <div>
          <p
            ref={sentRef}
            tabIndex={-1}
            className="flex items-center gap-2 font-medium tabular-nums outline-none"
            data-testid="recording-sent"
          >
            <CircleCheck className="size-5 shrink-0 text-present-ink" aria-hidden />
            <span>
              {`Kaydın gönderildi · ${formatShortDateTime.format(new Date(sentAt))}${
                take.durationMs !== null ? ` · ${clock(take.durationMs / 1000)}` : ""
              }`}
            </span>
          </p>
          {take.replacedEarlier && (
            <p className="pl-7 text-xs text-muted-foreground">
              Değiştirildi · {formatShortDateTime.format(new Date(take.uploadedAt))}
            </p>
          )}
        </div>
      ) : null;

    if (live || gone) {
      return (
        <div className="space-y-3">
          {sentLine}
          {live ? (
            <AudioPlayer
              recordingId={live.id}
              durationMs={live.durationMs}
              playbackPaused={playbackPaused}
            />
          ) : (
            <div
              className="flex gap-3 rounded-2xl border border-dashed p-4"
              data-testid="audio-gone"
            >
              <AudioLines className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Ses dosyası silindi ({formatAuditDate(new Date(gone!.audioDeletedAt!))}). Yorumlar
                duruyor.
              </p>
            </div>
          )}
          {locked ? (
            live && (
              <p className="text-xs text-muted-foreground">
                Şef yorum yazdı; kaydın artık değişmez. Ses dosyası{" "}
                {formatAuditDate(dayInstant(live.deleteOn))} tarihinde silinir; şefin yorumu kalır.
              </p>
            )
          ) : (
            <>
              {live && (
                <p className="text-xs text-muted-foreground">
                  Şefin yorumu gelince burada görünür; Ödevler&apos;de “Yeni yorum” işareti çıkar.
                </p>
              )}
              {(canUpload || canDelete) && (
                <div className="grid grid-cols-2 gap-2 md:max-w-sm">
                  {canUpload ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 rounded-2xl"
                      onClick={() => {
                        setInlineError(null);
                        setView("new");
                      }}
                    >
                      Değiştir
                    </Button>
                  ) : (
                    <span />
                  )}
                  {canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-12 text-absent-ink"
                      onClick={() => setConfirm("delete")}
                    >
                      Sil
                    </Button>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Şef yorum yazana kadar kaydını değiştirebilirsin.
              </p>
              {!canUpload ? (
                <p className="text-xs text-muted-foreground">
                  Bu ödeve {MAX_UPLOADS_PER_SLOT} kez kayıt yükledin; artık değiştiremezsin.
                </p>
              ) : MAX_UPLOADS_PER_SLOT - uploadsUsed <= 2 ? (
                <p className="text-xs text-muted-foreground">
                  Bu ödeve {MAX_UPLOADS_PER_SLOT - uploadsUsed} kez daha kayıt yükleyebilirsin.
                </p>
              ) : null}
            </>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {submittedAt && (
          <div>
            <p
              ref={sentRef}
              tabIndex={-1}
              className="flex items-center gap-2 font-medium outline-none"
            >
              <CircleCheck className="size-5 shrink-0 text-present-ink" aria-hidden />
              Teslim ettin · {formatShortDateTime.format(new Date(submittedAt))}
            </p>
            <p className="pl-7 text-xs text-muted-foreground">
              Portala kayıt yüklemedin. İstersen şimdi yükleyebilirsin.
            </p>
          </div>
        )}
        {locked ? null : canUpload ? (
          idleControls(false)
        ) : (
          <p className="text-sm text-muted-foreground">{MSG.uploadLimit}</p>
        )}
      </div>
    );
  }

  const busy = recording || counting;
  const dataState = busy
    ? rec.phase === "recording"
      ? "recording"
      : "countdown"
    : view === "mic"
      ? (problem ?? "denied")
      : view === "preview"
        ? "recorded"
        : view === "uploading"
          ? "uploading"
          : view === "failed"
            ? "failed"
            : view === "new"
              ? supported
                ? "idle"
                : "unsupported"
              : take
                ? take.audioDeletedAt
                  ? "gone"
                  : locked
                    ? "locked"
                    : "sent"
                : supported
                  ? "idle"
                  : "unsupported";

  return (
    <div
      className={cn(
        "rounded-2xl transition-shadow",
        recording && "p-3 ring-2 ring-absent",
      )}
      role="group"
      aria-labelledby="kayit-baslik"
      data-recorder
      data-state={dataState}
      data-max-ms={maxMs}
      data-level={rec.level ?? undefined}
      data-take-bytes={local?.blob.size}
    >
      {fileInput}
      {busy
        ? recordingView()
        : view === "mic"
          ? micBox()
          : view === "preview"
            ? previewView()
            : view === "uploading"
              ? uploadingView()
              : view === "failed"
                ? failedView()
                : view === "new"
                  ? idleControls(Boolean(take))
                  : baseView()}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <ConfirmDialog
        open={confirm === "retake"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Baştan kaydedilsin mi?"
        description="Şu anki kayıt silinir."
        actions={[
          {
            label: "Baştan kaydet",
            variant: "default",
            run: () => {
              setConfirm(null);
              discard();
              setView("new");
              startRecording();
            },
          },
        ]}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Kaydın silinsin mi?"
        description={manual ? "Şefin işaretlediği teslim kalır." : "Teslimin de geri alınır."}
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteMyRecording(assignmentId),
                () => {
                  setConfirm(null);
                  setView("base");
                },
              ),
          },
        ]}
      />
    </div>
  );
}
