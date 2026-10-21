import { CircleCheck, KeyRound, TriangleAlert } from "lucide-react";
import type { BackupPage } from "@/lib/backup/queries";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  label: string;
  ok: boolean;
  badge?: string;
  explain: string;
  note?: string;
  vars?: string;
};

export function SetupList({ setup }: { setup: BackupPage["setup"] }) {
  const rows: Row[] = [
    {
      id: "smtp",
      label: "E-posta hesabı",
      ok: setup.mail !== "missing",
      explain: "E-postaları gönderen koro Gmail hesabı ve uygulama şifresi.",
      note:
        setup.mail === "dev"
          ? "Şu an deneme ortamı, e-posta gönderilmez, dosyaya yazılır."
          : undefined,
      vars: "SMTP_USER · SMTP_PASS",
    },
    {
      id: "passphrase",
      label: "Yedek şifresi",
      ok: setup.passphrase === "ok",
      explain: "Yedek dosyasını kilitleyen şifre. En az 16 karakter.",
      note:
        setup.passphrase === "invalid" ? "Çok kısa ya da deneme şifresi; yenisini gir." : undefined,
      vars: "BACKUP_PASSPHRASE",
    },
    {
      id: "cron",
      label: "Zamanlayıcı anahtarı",
      ok: setup.cronSecret,
      explain: "Her sabah gönderimi kendiliğinden başlatan zamanlayıcının gizli anahtarı.",
      vars: "CRON_SECRET",
    },
    {
      id: "recipients",
      label: "Alıcılar",
      ok: setup.recipients > 0,
      badge: setup.recipients > 0 ? `${setup.recipients} adres` : undefined,
      explain: "Raporun gideceği adresler.",
    },
  ];
  return (
    <section
      aria-labelledby="kurulum"
      data-testid="backup-setup"
      className="space-y-3 rounded-2xl border bg-card p-4 md:p-6"
    >
      <h2 id="kurulum" className="text-xl font-medium">
        Kurulum
      </h2>
      <ul className="divide-y">
        {rows.map((row) => {
          const Icon = row.ok ? CircleCheck : TriangleAlert;
          return (
            <li
              key={row.id}
              className="flex min-h-14 items-start gap-3 py-3"
              data-testid={`backup-setup-${row.id}`}
              data-ok={row.ok}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  row.ok ? "text-present-ink" : "text-late-ink",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">{row.label}</p>
                <p className="text-sm text-muted-foreground">{row.explain}</p>
                {row.note && (
                  <p className={cn("text-sm", row.ok ? "text-muted-foreground" : "text-late-ink")}>
                    {row.note}
                  </p>
                )}
                {row.vars && (
                  <p className="font-mono text-xs break-words text-muted-foreground">{row.vars}</p>
                )}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  row.ok ? "bg-present/14 text-present-ink" : "bg-late/18 text-late-ink",
                )}
              >
                {row.ok ? (row.badge ?? "Tamam") : "Eksik"}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Eksik ayarları portalı kuran kişi Vercel&apos;de girer. Adımlar README&apos;de:
          &quot;Aylık yedek e-postası&quot;.
        </p>
        <p className="flex gap-2">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Yedek şifresini Vercel dışında iki yerde sakla (ör. şefin şifre yöneticisi ve kapalı
            zarfta bir kâğıt). Şifre kaybolursa hiçbir yedek açılamaz.
          </span>
        </p>
      </div>
    </section>
  );
}
