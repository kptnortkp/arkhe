import { Check, ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { importIndex } from "@/lib/import/queries";
import { formatKurus } from "@/lib/money";
import { dayInstant, formatAuditDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Veri içe aktar" };
export const maxDuration = 60;

const CARD = "space-y-3 rounded-2xl border bg-card p-4 md:p-6";
const INLINE_LINK = "inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4";

export default async function ImportIndexPage() {
  const data = await importIndex();
  const opening = data.opening;
  // Step 1 skipped while later steps ran: older attendance and dues will be refused (review P1-1).
  const historyGap = !data.steps[0].last && data.steps.some((s) => s.last);

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
        <h1 className="text-4xl font-medium">Veri içe aktar</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Eski kayıtlarını (Excel, Sheets, kâğıt) toplu olarak portala aktar. Önce dosyanı kontrol
          ederiz, hiçbir şey yazılmaz; sonra tek seferde aktarırsın.
        </p>
      </div>

      <section aria-labelledby="baslamadan" className={CARD}>
        <h2 id="baslamadan" className="text-xl font-medium">
          Başlamadan önce
        </h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li data-testid="backup-line">
            <span className="font-medium">Yedek al.</span>{" "}
            <span className="text-muted-foreground">
              {data.lastBackupAt
                ? `Son yedek: ${formatAuditDate(data.lastBackupAt)} · `
                : "Henüz yedek yok. "}
            </span>
            <Link href="/yedek" className={INLINE_LINK}>
              Yedekleme
            </Link>
            <span className="block text-muted-foreground">
              Büyük bir aktarımdan önce Yedekleme › Şimdi gönder ile yedek al.
            </span>
          </li>
          <li>
            <span className="font-medium">Adımları sırayla yap.</span>{" "}
            <span className="text-muted-foreground">
              Üye tarihleri, kimin hangi çalışmada beklendiğini ve hangi aidatı borçlandığını
              belirler. Sıra yanlışsa bir şey bozulmaz; kontrol hata verir, önceki adımı yapıp aynı
              dosyayı yeniden yüklersin.
            </span>
          </li>
          <li>
            <span className="font-medium">Üye listesini yapay zekâya ver.</span>{" "}
            <span className="text-muted-foreground">
              Kâğıtta ad var, portal e-postayla eşleştirir. Üye geçmişini aktardıktan sonra listeyi
              yeniden indir.
            </span>
          </li>
        </ol>
        <a
          href="/ice-aktar/uye-listesi"
          download
          className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-4")}
        >
          <Download aria-hidden />
          Üye listesini indir
        </a>
        <p className="text-xs text-muted-foreground">
          Listede adlar ve e-postalar var. Yapay zekâya yalnızca işin için gerekeni ver.
        </p>
      </section>

      <section aria-labelledby="adimlar" className="space-y-3">
        <h2 id="adimlar" className="text-xl font-medium">
          Adımlar
        </h2>
        <ol className="space-y-2">
          <li
            className="flex gap-3 rounded-2xl border border-dashed bg-card px-4 py-3.5"
            data-testid="step-card"
            data-step="0"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold tabular-nums">
              0
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">Açılış bakiyesi</p>
              <p className="text-sm text-muted-foreground">
                Kayıtların başladığı günün kasa ve banka bakiyesi. Bugünkü bakiye değil.
              </p>
              <p className="text-[13px] text-late-ink" data-testid="opening-line">
                {opening
                  ? `Açılış: ${formatAuditDate(dayInstant(opening.date))} · Kasa ${formatKurus(opening.cash)} · Banka ${formatKurus(opening.bank)}`
                  : "Açılış bakiyesi girilmemiş."}
              </p>
              <Link
                href="/finans/ayarlar"
                className={cn(buttonVariants({ variant: "outline" }), "mt-1 h-11 rounded-xl px-4")}
              >
                Ayarlar&apos;a git
              </Link>
            </div>
          </li>
          {data.steps.map((s) => {
            const done = Boolean(s.last);
            const gap = s.step === 1 && historyGap;
            return (
              <li key={s.slug} data-testid="step-card" data-step={s.step}>
                <Link
                  href={`/ice-aktar/${s.slug}`}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 transition-colors hover:bg-muted/50",
                    s.next && "border-primary/45",
                    gap && "border-late/45 bg-late/10 hover:bg-late/15",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums",
                      done ? "bg-present text-present-foreground" : "bg-muted",
                    )}
                  >
                    {done ? <Check className="size-4" aria-hidden /> : s.step}
                    <span className="sr-only">
                      {done ? `${s.step}. adım, aktarıldı` : `${s.step}. adım`}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.title}</span>
                      {s.next && (
                        <span
                          className="inline-flex h-6 items-center rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground"
                          data-testid="next-chip"
                        >
                          Sıradaki
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-muted-foreground">{s.summary}</span>
                    <span
                      className={cn(
                        "block text-[13px]",
                        done ? "text-present-ink" : gap ? "font-medium text-late-ink" : "text-muted-foreground",
                      )}
                      data-testid="step-state"
                    >
                      {s.last
                        ? `Son aktarım: ${formatAuditDate(s.last.at)} · ${s.last.by} · ${s.last.rows} satır`
                        : gap
                          ? "Henüz aktarılmadı · eski yoklama ve aidat için gerekli"
                          : "Henüz aktarılmadı"}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <Link
        href="/ice-aktar/gecmis"
        className="inline-flex min-h-11 items-center gap-1 font-medium underline-offset-4 hover:underline"
      >
        İçe aktarma geçmişi
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
