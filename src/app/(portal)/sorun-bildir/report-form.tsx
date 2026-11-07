"use client";

import { ImagePlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field, FormMessage } from "@/components/forms/field";
import { reloadIfStale, STALE_MESSAGE } from "@/components/stale-deploy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ISSUE_IMAGE_MAX_BYTES, ISSUE_IMAGES_PER_REPORT } from "@/db/schema";
import { formatBytes } from "@/lib/format";
import {
  REPORT_BODY_MAX,
  REPORT_IMAGE_MAX_SIDE,
  REPORT_MSG,
  REPORT_TITLE_MAX,
} from "@/lib/reports/labels";
import { MSG } from "@/lib/storage/messages";
import { createReport } from "./actions";

type Shot = { key: string; blob: Blob; url: string };

class PickError extends Error {}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PickError(REPORT_MSG.notImage));
    };
    img.src = url;
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Long side ≤ 1600 px, re-encoded as JPEG ≈0.8; PNG only when the JPEG encode fails. */
async function downscale(file: File): Promise<Blob> {
  if (file.type && !file.type.startsWith("image/")) throw new PickError(REPORT_MSG.notImage);
  const img = await loadImage(file);
  const scale = Math.min(1, REPORT_IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PickError(REPORT_MSG.imageFailed);
  // JPEG has no transparency: a transparent PNG would turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob =
    (await toBlob(canvas, "image/jpeg", 0.8).catch(() => null)) ??
    (await toBlob(canvas, "image/png").catch(() => null));
  if (!blob || blob.size === 0) throw new PickError(REPORT_MSG.imageFailed);
  if (blob.size > ISSUE_IMAGE_MAX_BYTES) throw new PickError(REPORT_MSG.imageTooBig);
  return blob;
}

function deviceSummary(build: string) {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? `iOS ${ua.match(/OS (\d+)[_.](\d+)/)?.slice(1, 3).join(".") ?? ""}`.trim()
    : /Android/.test(ua)
      ? `Android ${ua.match(/Android (\d+(\.\d+)?)/)?.[1] ?? ""}`.trim()
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Bilinmeyen";
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /CriOS\/|Chrome\//.test(ua)
        ? `Chrome ${ua.match(/(?:CriOS|Chrome)\/(\d+)/)?.[1] ?? ""}`.trim()
        : /FxiOS\/|Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? `Safari ${ua.match(/Version\/(\d+(\.\d+)?)/)?.[1] ?? ""}`.trim()
            : "Bilinmeyen";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return `${os} · ${browser} · ana ekran: ${standalone ? "evet" : "hayır"} · sürüm ${build}`;
}

function originPage(from: string | null) {
  if (from) return from;
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.origin === location.origin && ref.pathname !== location.pathname) {
      return ref.pathname;
    }
  } catch {}
  return null;
}

async function uploadShot(reportId: string, blob: Blob) {
  try {
    const res = await fetch(`/api/dosya/sorun?bildirim=${reportId}`, {
      method: "POST",
      body: blob,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return json?.error ?? REPORT_MSG.imageFailed;
  } catch {
    return REPORT_MSG.imageFailed;
  }
}

export function ReportForm({ from, build }: { from: string | null; build: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string[]; body?: string[] }>({});
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPickError(null);
    const room = ISSUE_IMAGES_PER_REPORT - shots.length;
    const list = [...files];
    if (list.length > room) setPickError(REPORT_MSG.tooManyImages);
    setPicking(true);
    const added: Shot[] = [];
    for (const file of list.slice(0, Math.max(0, room))) {
      try {
        const blob = await downscale(file);
        added.push({ key: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
      } catch (e) {
        setPickError(e instanceof PickError ? e.message : REPORT_MSG.notImage);
      }
    }
    setShots((s) => [...s, ...added].slice(0, ISSUE_IMAGES_PER_REPORT));
    setPicking(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function remove(key: string) {
    setShots((s) => {
      const gone = s.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return s.filter((x) => x.key !== key);
    });
    setPickError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || picking) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setSuccess(null);
    setFieldErrors({});
    try {
      const result = await createReport({
        title: String(data.get("title") ?? ""),
        body: String(data.get("body") ?? ""),
        page: originPage(from),
        device: deviceSummary(build),
      });
      if (!result.ok) {
        if (result.error) setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        const first = form.querySelector<HTMLElement>("[aria-invalid=true]");
        first?.focus();
        return;
      }
      const failures: string[] = [];
      for (const shot of shots) {
        const failure = await uploadShot(result.id, shot.blob);
        if (failure) failures.push(failure);
      }
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]);
      form.reset();
      setSuccess(result.message);
      if (failures.length > 0) {
        setError(`${failures.length} ekran görüntüsü eklenemedi: ${failures[0]}`);
      }
      router.refresh();
    } catch (e) {
      setError(reloadIfStale(e) ? STALE_MESSAGE : MSG.generic);
    } finally {
      setBusy(false);
    }
  }

  const full = shots.length >= ISSUE_IMAGES_PER_REPORT;
  return (
    <form
      ref={formRef}
      onSubmit={(e) => void submit(e)}
      className="space-y-5"
      noValidate
      data-testid="report-form"
    >
      <div aria-live="polite" className="space-y-2">
        <FormMessage success={success ?? undefined} />
        <FormMessage error={error ?? undefined} />
      </div>
      <Field
        label="Başlık"
        name="title"
        maxLength={REPORT_TITLE_MAX}
        placeholder="Örn. Kayıt yüklenmiyor"
        errors={fieldErrors.title}
        required
      />
      <div className="space-y-2">
        <Label htmlFor="body">Ne oldu?</Label>
        <Textarea
          id="body"
          name="body"
          rows={5}
          maxLength={REPORT_BODY_MAX}
          placeholder="Ne yapmaya çalışıyordun, ne oldu?"
          aria-invalid={fieldErrors.body?.length ? true : undefined}
          aria-describedby={fieldErrors.body?.length ? "body-error" : undefined}
          className="min-h-32 rounded-xl"
          required
        />
        {fieldErrors.body?.length ? (
          <p id="body-error" className="text-sm text-destructive">
            {fieldErrors.body[0]}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-3" aria-describedby="shots-hint">
        <legend className="mb-2 text-sm font-medium">
          Ekran görüntüsü <span className="font-normal text-muted-foreground">(isteğe bağlı, en fazla 3)</span>
        </legend>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="report-files"
          onChange={(e) => void pick(e.target.files)}
        />
        {shots.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:max-w-sm" data-testid="report-shots">
            {shots.map((s, i) => (
              <li key={s.key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview */}
                <img
                  src={s.url}
                  alt={`Ekran görüntüsü ${i + 1}`}
                  className="aspect-[3/4] w-full rounded-xl border bg-muted object-cover"
                />
                <button
                  type="button"
                  onClick={() => remove(s.key)}
                  aria-label={`Ekran görüntüsü ${i + 1}'i kaldır`}
                  className="absolute -top-2 -right-2 grid size-8 place-items-center rounded-full border bg-background text-foreground shadow-sm"
                >
                  <X className="size-4" />
                </button>
                <span className="mt-1 block text-center text-xs text-muted-foreground tabular-nums">
                  {formatBytes(s.blob.size)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full px-4"
          disabled={full || picking || busy}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus />
          {picking ? "Hazırlanıyor…" : "Ekran görüntüsü ekle"}
        </Button>
        <p id="shots-hint" className="text-xs text-muted-foreground">
          Görüntüler gönderilmeden önce küçültülür.
        </p>
        {pickError && (
          <p className="text-sm text-destructive" role="alert" data-testid="report-pick-error">
            {pickError}
          </p>
        )}
      </fieldset>

      <Button type="submit" disabled={busy || picking} className="h-11 rounded-xl px-6">
        {busy ? "Gönderiliyor…" : "Gönder"}
      </Button>
    </form>
  );
}
