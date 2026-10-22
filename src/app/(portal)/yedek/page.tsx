import { ChevronLeft, FileUp } from "lucide-react";
import Link from "next/link";
import { RecipientsForm } from "@/components/backup/recipients-form";
import { RecipientsList } from "@/components/backup/recipients-list";
import { RunLog } from "@/components/backup/run-log";
import { SendNow } from "@/components/backup/send-now";
import { SetupList } from "@/components/backup/setup-list";
import { nextSendText, StatusCard } from "@/components/backup/status-card";
import { buttonVariants } from "@/components/ui/button";
import { loadBackupPage } from "@/lib/backup/queries";
import { formatAuditDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Yedekleme" };
// Şimdi gönder runs as a server action of this page and inherits this limit (< STALE_SECONDS).
export const maxDuration = 60;

const CARD = "space-y-3 rounded-2xl border bg-card p-4 md:p-6";

export default async function BackupPage() {
  const data = await loadBackupPage();
  const audit = data.audit
    ? `Son değişiklik: ${data.audit.name ?? "silinmiş üye"} · ${formatAuditDateTime(data.audit.at)}`
    : null;
  const emptyLog = data.recipients.length
    ? `Henüz gönderim yok. İlk otomatik gönderim: ${nextSendText(data.nextSend)}.`
    : "Henüz gönderim yok. Alıcılar kaydedilince her ay kendiliğinden gönderilir.";

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/profil"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Profil
        </Link>
        <h1 className="text-4xl font-medium">Yedekleme</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Her ayın 1&apos;inde, geçen ayın raporları ve koronun tüm kayıtlarının şifreli yedeği
          aşağıdaki adreslere e-postayla gider.
        </p>
      </div>

      <StatusCard data={data} />
      <SetupList setup={data.setup} />

      <section aria-labelledby="alicilar" className={CARD}>
        <h2 id="alicilar" className="scroll-mt-20 text-xl font-medium">
          Alıcılar
        </h2>
        <p id="alicilar-hint" className="text-sm text-muted-foreground">
          {data.canEdit
            ? "Raporlarda isimler, devam, ödev ve aidat bilgisi şifresiz gider; yalnızca yönetimdeki kişilerin adreslerini ekle."
            : "Raporlarda isimler, devam, ödev ve aidat bilgisi şifresiz gider; bu yüzden listede yalnızca yönetimdeki kişiler olmalı."}
        </p>
        {data.canEdit ? (
          <RecipientsForm saved={data.recipients} audit={audit} />
        ) : (
          <RecipientsList recipients={data.recipients} audit={audit} />
        )}
      </section>

      {data.canEdit && (
        <section aria-labelledby="simdi-gonder" className={CARD} data-testid="backup-send">
          <h2 id="simdi-gonder" className="text-xl font-medium">
            Şimdi gönder
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.previous.monthLabel} raporlarını ve bugünkü yedeği hemen gönderir. Kurulumdan
            sonra bir kez dene ve e-postanın geldiğini kontrol et.
          </p>
          <SendNow
            send={data.send}
            monthLabel={data.previous.monthLabel}
            recipients={data.recipients}
          />
        </section>
      )}

      <section aria-labelledby="gecmis" className={CARD}>
        <h2 id="gecmis" className="text-xl font-medium">
          Geçmiş
        </h2>
        <RunLog runs={data.runs} moreRuns={data.moreRuns} emptyText={emptyLog} />
      </section>

      <section aria-label="Veri içe aktar" className={CARD}>
        <p className="text-sm">Eski kayıtları portala aktarmadan önce buradan yedek al.</p>
        <Link
          href="/ice-aktar"
          className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-4")}
        >
          <FileUp aria-hidden />
          Veri içe aktar
        </Link>
      </section>
    </div>
  );
}
