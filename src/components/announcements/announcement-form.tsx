"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import {
  createAnnouncement,
  updateAnnouncement,
  type AnnouncementFieldErrors,
  type AnnouncementResult,
} from "@/app/(portal)/duyurular/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormMessage } from "@/components/forms/field";
import { reloadIfStale, STALE_MESSAGE } from "@/components/stale-deploy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VOICE_PARTS, type AnnouncementAudience, type VoicePart } from "@/db/schema";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  AUDIENCE_LABELS,
  pushPreview,
} from "@/lib/announcements/labels";
import { VOICE_PART_LABELS, VOICE_PART_SHORT, VOICE_PART_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type AudienceCountsProp = {
  all: number;
  managers: number;
  byPart: Record<VoicePart, number>;
};

type Common = {
  minDay: string;
  maxDay: string;
  initial: { title: string; body: string; important: boolean; showUntil: string };
};
type Props =
  | (Common & { mode: "create"; counts: AudienceCountsProp })
  | (Common & {
      mode: "edit";
      id: string;
      audience: AnnouncementAudience;
      parts: VoicePart[];
      /** People a resend reaches (the editor excluded). */
      resendCount: number;
    });

const AUDIENCES: AnnouncementAudience[] = ["all", "parts", "board"];
const chipClass =
  "group flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

function recipients(counts: AudienceCountsProp, audience: AnnouncementAudience, parts: VoicePart[]) {
  // The sender is a manager and always part of the audience; they get no notification.
  const n =
    audience === "all"
      ? counts.all
      : audience === "board"
        ? counts.managers
        : counts.managers + parts.reduce((sum, p) => sum + counts.byPart[p], 0);
  return Math.max(0, n - 1);
}

export function AnnouncementForm(props: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(props.initial.title);
  const [body, setBody] = useState(props.initial.body);
  const [audience, setAudience] = useState<AnnouncementAudience>(
    props.mode === "edit" ? props.audience : "all",
  );
  const [parts, setParts] = useState<VoicePart[]>(props.mode === "edit" ? props.parts : []);
  const [important, setImportant] = useState(props.initial.important);
  const [showUntil, setShowUntil] = useState(props.initial.showUntil);
  const [resend, setResend] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<AnnouncementFieldErrors>({});

  const create = props.mode === "create";
  const count = create ? recipients(props.counts, audience, parts) : props.resendCount;
  const sends = create || resend;
  const preview = create
    ? pushPreview(title || "Başlık", body || "Duyuru metni")
    : pushPreview("Duyuru güncellendi", `${title}: ${body}`);

  function togglePart(p: VoicePart, on: boolean) {
    setParts((s) => (on ? VOICE_PARTS.filter((x) => x === p || s.includes(x)) : s.filter((x) => x !== p)));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (sends) setConfirming(true);
    else send();
  }

  function send() {
    startTransition(async () => {
      let result: AnnouncementResult;
      try {
        result =
          props.mode === "create"
            ? await createAnnouncement({ title, body, audience, parts, important, showUntil })
            : await updateAnnouncement({ id: props.id, title, body, important, showUntil, resend });
      } catch (e) {
        result = { ok: false, error: reloadIfStale(e) ? STALE_MESSAGE : "Bir şeyler ters gitti, tekrar dene." };
      }
      setConfirming(false);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        if (result.error) setError(result.error);
        else if (!result.fieldErrors) setError("Bir şeyler ters gitti, tekrar dene.");
        return;
      }
      setErrors({});
      toast.success(result.message);
      router.push(`/duyurular#${result.id}`);
      router.refresh();
    });
  }

  const bodyChars = [...body].length;
  return (
    <form onSubmit={submit} className="space-y-6" noValidate data-testid="announcement-form">
      <div aria-live="polite">
        <FormMessage error={error ?? undefined} />
      </div>
      <Field
        label="Başlık"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={ANNOUNCEMENT_TITLE_MAX}
        placeholder="Örn. Yarın fotoğraf çekimi"
        errors={errors.title}
        required
      />
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="body">Duyuru metni</Label>
          <span
            id="body-count"
            className={cn(
              "text-xs tabular-nums text-muted-foreground",
              bodyChars > ANNOUNCEMENT_BODY_MAX && "text-destructive",
            )}
            data-testid="announcement-body-count"
          >
            {bodyChars}/{ANNOUNCEMENT_BODY_MAX}
          </span>
        </div>
        <Textarea
          id="body"
          name="body"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          placeholder="Örn. Lütfen Arkhe tişörtlerinizle çalışmaya gelin."
          aria-invalid={errors.body?.length ? true : undefined}
          aria-describedby={errors.body?.length ? "body-error body-count" : "body-count"}
          className="min-h-36 rounded-xl"
          required
        />
        {errors.body?.length ? (
          <p id="body-error" className="text-sm text-destructive">
            {errors.body[0]}
          </p>
        ) : null}
      </div>

      {create ? (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Kime</legend>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <label key={a} className={chipClass}>
                <input
                  type="radio"
                  name="audience"
                  value={a}
                  checked={audience === a}
                  onChange={() => setAudience(a)}
                  className="sr-only"
                />
                <Check aria-hidden className="hidden size-4 group-has-checked:inline" />
                {AUDIENCE_LABELS[a]}
              </label>
            ))}
          </div>
          {audience === "parts" && (
            <fieldset
              className="space-y-2"
              aria-invalid={errors.parts ? true : undefined}
              aria-describedby={errors.parts ? "parts-error" : "parts-hint"}
            >
              <legend className="sr-only">Partisyonlar</legend>
              <div className="flex flex-wrap gap-2">
                {VOICE_PARTS.map((p) => (
                  <label key={p} className={chipClass} title={VOICE_PART_LABELS[p]}>
                    <input
                      type="checkbox"
                      name="parts"
                      value={p}
                      checked={parts.includes(p)}
                      onChange={(e) => togglePart(p, e.target.checked)}
                      className="sr-only"
                    />
                    <span className={cn("size-2 rounded-full", VOICE_PART_STYLES[p].dot)} />
                    <span aria-hidden>{VOICE_PART_SHORT[p]}</span>
                    <span className="sr-only">{VOICE_PART_LABELS[p]}</span>
                  </label>
                ))}
              </div>
              {errors.parts ? (
                <p id="parts-error" className="text-sm text-destructive">
                  {errors.parts[0]}
                </p>
              ) : (
                <p id="parts-hint" className="text-xs text-muted-foreground">
                  Şef ve yönetim kurulu her duyuruyu görür.
                </p>
              )}
            </fieldset>
          )}
        </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="announcement-audience">
          Kime:{" "}
          {props.audience === "parts"
            ? props.parts.map((p) => VOICE_PART_LABELS[p]).join(", ")
            : AUDIENCE_LABELS[props.audience]}{" "}
          (gönderildikten sonra değişmez)
        </p>
      )}

      <div className="space-y-1 rounded-2xl border bg-card p-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            name="important"
            checked={important}
            onChange={(e) => setImportant(e.target.checked)}
            aria-describedby="important-hint"
            className="size-5 accent-primary"
          />
          Önemli
        </label>
        <p id="important-hint" className="pl-8 text-xs text-muted-foreground">
          Gece sessiz saatlerinde (22:00–08:00) ve bildirimlerini kapatanlara da hemen gider; ana sayfada kırmızı görünür.
        </p>
      </div>

      <Field
        label="Ana sayfada şu tarihe kadar göster"
        name="showUntil"
        type="date"
        min={props.minDay}
        max={props.maxDay}
        value={showUntil}
        onChange={(e) => setShowUntil(e.target.value)}
        errors={errors.showUntil}
        className="w-auto min-w-44"
        required
      />

      {!create && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            name="resend"
            checked={resend}
            onChange={(e) => setResend(e.target.checked)}
            className="size-5 accent-primary"
          />
          Değişikliği tekrar bildir
        </label>
      )}

      {sends && (
        <div className="space-y-2" data-testid="announcement-preview">
          <p className="text-sm font-medium">Bildirim önizlemesi</p>
          <div className="flex gap-3 rounded-2xl border bg-muted/50 p-3 shadow-xs">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-stage font-heading text-sm text-stage-foreground"
            >
              A
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold [overflow-wrap:anywhere]">{preview.title}</p>
              <p className="text-muted-foreground [overflow-wrap:anywhere]">{preview.body}</p>
            </div>
          </div>
        </div>
      )}

      <Button type="submit" disabled={pending} className="h-11 rounded-xl px-6">
        {create ? "Duyuruyu gönder" : "Kaydet"}
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={create ? "Duyuru gönderilsin mi?" : "Değişiklik bildirilsin mi?"}
        description={`${count} kişiye bildirim gidecek.`}
        pending={pending}
        actions={[
          {
            label: pending ? "Gönderiliyor…" : create ? "Gönder" : "Kaydet ve bildir",
            run: send,
            variant: "default",
          },
        ]}
      />
    </form>
  );
}
