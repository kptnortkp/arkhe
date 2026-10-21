import { CircleAlert, CircleCheck, Clock, Settings2 } from "lucide-react";
import type { BackupPage } from "@/lib/backup/queries";
import { SEND_WINDOW_TEXT } from "@/lib/backup/schedule";
import { formatAuditDate, formatAuditDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function nextSendText(next: BackupPage["nextSend"]) {
  return `${formatAuditDate(next.at)}, ${SEND_WINDOW_TEXT}`;
}

export function StatusCard({ data }: { data: BackupPage }) {
  const { previous, nextSend } = data;
  const next = `Sonraki ${nextSend.kind}: ${nextSendText(nextSend)}`;
  const failed = data.setup.recipients > 0 && previous.state === "failed";

  let Icon = Clock;
  let iconClass = "text-muted-foreground";
  let headline: string;
  let lines: { text: string; strong?: boolean }[] = [];
  let addLink = false;
  if (data.setup.recipients === 0) {
    Icon = Settings2;
    headline = "Henüz ayarlanmadı.";
    lines = [
      {
        text: data.canEdit
          ? "Aşağıdan en az bir alıcı ekleyip kaydet."
          : "Alıcıları koro şefi ekler.",
      },
    ];
    addLink = data.canEdit;
  } else if (previous.state === "sent") {
    Icon = CircleCheck;
    iconClass = "text-present-ink";
    headline = `${previous.monthLabel} raporu gönderildi.`;
    lines = [
      { text: `${formatAuditDateTime(previous.at)} · ${previous.recipientCount} adres` },
      { text: next },
    ];
  } else if (previous.state === "running") {
    headline = `${previous.monthLabel} raporu şu an gönderiliyor.`;
    lines = [{ text: "Birkaç dakika sonra sayfayı yenile." }];
  } else if (previous.state === "failed") {
    Icon = CircleAlert;
    iconClass = "text-absent-ink";
    headline = `${previous.monthLabel} raporu gönderilemedi.`;
    lines = [
      { text: previous.error ?? "Gönderim yarıda kaldı.", strong: true },
      { text: `Her sabah kendiliğinden yeniden deneniyor. ${next}` },
    ];
  } else {
    headline = `${previous.monthLabel} raporu henüz gönderilmedi.`;
    lines = [{ text: next }];
  }

  return (
    <section
      aria-labelledby="durum"
      data-testid="backup-status"
      data-state={data.setup.recipients === 0 ? "unconfigured" : previous.state}
      className={cn(
        "space-y-3 rounded-2xl border bg-card p-4 md:p-6",
        failed && "border-absent/40 bg-absent/8",
      )}
    >
      <h2 id="durum" className="text-xl font-medium">
        Durum
      </h2>
      <div className="flex gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass)} aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{headline}</p>
          {lines.map((line) => (
            <p
              key={line.text}
              className={cn(
                "text-sm break-words",
                line.strong ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {line.text}
            </p>
          ))}
          {addLink && (
            <a
              href="#alicilar"
              className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4"
            >
              Alıcı ekle
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
