"use client";

import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { useRef, useState } from "react";
import { sendBackupNow } from "@/app/(portal)/yedek/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RECIPIENTS_FORM_ID } from "@/components/backup/recipients-form";
import { useRunAction } from "@/components/use-run-action";
import { Button } from "@/components/ui/button";
import type { SendState } from "@/lib/backup/queries";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

function disabledHint(send: SendState) {
  switch (send.kind) {
    case "no-recipients":
      return "Önce en az bir alıcı kaydet.";
    case "running":
      return "Şu an bir gönderim sürüyor.";
    case "cooldown":
      return `Az önce gönderildi. ${send.minutesLeft} dakika sonra yeniden gönderebilirsin.`;
    default:
      return null;
  }
}

/** The editor's current inputs, normalised like the server does, differ from the saved list. */
function editorIsDirty(saved: string[]) {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    `form#${RECIPIENTS_FORM_ID} input[name=recipients]`,
  );
  const draft = [...new Set([...inputs].map((i) => i.value.trim().toLowerCase()).filter(Boolean))];
  return draft.join(",") !== saved.join(",");
}

export function SendNow({
  send,
  monthLabel,
  recipients,
}: {
  send: SendState;
  monthLabel: string;
  recipients: string[];
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<FormState | null>(null);
  const [pending, run] = useRunAction();
  const resultRef = useRef<HTMLParagraphElement>(null);
  const answered = useRef(false);
  const hint = disabledHint(send);
  // Right after a send the result line already says so; the cooldown joins it instead of repeating.
  const merged = result?.success && send.kind === "cooldown" ? send.minutesLeft : null;
  const message =
    merged !== null
      ? `${result?.success} ${merged} dakika sonra yeniden gönderebilirsin.`
      : (result?.error ?? result?.success);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Button
          className="h-11 rounded-full px-5 aria-disabled:opacity-50"
          disabled={hint !== null || pending}
          focusableWhenDisabled
          aria-describedby={merged !== null ? "gonder-sonuc" : hint ? "gonder-durum" : undefined}
          onClick={() => {
            answered.current = false;
            setDirty(editorIsDirty(recipients));
            setOpen(true);
          }}
        >
          <Send aria-hidden />
          {pending ? "Gönderiliyor…" : "Şimdi gönder"}
        </Button>
        {hint && merged === null && (
          <p id="gonder-durum" className="text-sm text-muted-foreground">
            {hint}
          </p>
        )}
        <p
          ref={resultRef}
          id="gonder-sonuc"
          tabIndex={-1}
          role="status"
          aria-live="polite"
          data-testid="backup-send-result"
          className={cn(
            "flex gap-2 text-sm outline-none",
            result?.error ? "text-absent-ink" : "text-present-ink",
          )}
        >
          {message ? (
            <>
              {result?.error ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span>{message}</span>
            </>
          ) : null}
        </p>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        finalFocus={() => (answered.current ? resultRef.current : true)}
        title="Rapor ve yedek gönderilsin mi?"
        description={`${recipients.length} adrese ${monthLabel} raporları ve şifreli yedek gönderilecek.`}
        pending={pending}
        actions={[
          {
            label: pending ? "Gönderiliyor…" : "Gönder",
            variant: "default",
            run: () =>
              run(sendBackupNow, (r) => {
                answered.current = true;
                setResult(r);
                setOpen(false);
              }),
          },
        ]}
      >
        <div className="space-y-2 text-center text-sm sm:text-left">
          {dirty && (
            <p className="text-late-ink">Kaydedilmemiş değişiklikler gönderime dahil değil.</p>
          )}
          <ul className="space-y-0.5 break-all text-muted-foreground" data-testid="send-recipients">
            {recipients.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>
    </div>
  );
}
