import { ChevronDown, ChevronLeft, Download, FileText, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { ColumnTable } from "@/components/import/column-table";
import { ImportFlow } from "@/components/import/import-flow";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import { fileBase, headerLine } from "@/lib/import/def";
import { DEFS, defOf } from "@/lib/import/defs";
import { columnDocs } from "@/lib/import/docs";
import { isSlug, type Slug } from "@/lib/import/limits";
import { importIndex, livePrompt } from "@/lib/import/queries";
import { dayInstant, formatAuditDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { checkImport, commitImport } from "../actions";

// checkImport / commitImport run as actions of this page and inherit its limit.
export const maxDuration = 60;

export async function generateMetadata({ params }: PageProps<"/ice-aktar/[tur]">) {
  const { tur } = await params;
  return { title: isSlug(tur) ? defOf(tur).title : "Veri içe aktar" };
}

const CARD = "space-y-3 rounded-2xl border bg-card p-4 md:p-6";

/** The steps each type builds on (ux §3.2); 0 is the opening balance. */
const PREREQUISITES: Record<Slug, { step: number; optional?: string }[]> = {
  uyeler: [],
  donemler: [],
  yoklama: [{ step: 1 }, { step: 2, optional: "isteğe bağlı, raporlar için" }],
  hareketler: [{ step: 0 }],
  "aidat-donemleri": [{ step: 1 }],
  "aidat-odemeleri": [{ step: 0 }, { step: 1 }, { step: 5 }],
};

/** Types whose AI prompt needs the member list (ux review P2-1). */
const NEEDS_MEMBER_LIST: Slug[] = ["uyeler", "yoklama", "aidat-odemeleri"];

/** Types that compare each row with join dates, which are invite days until step 1 runs (review P1-1). */
const NEEDS_MEMBER_HISTORY: Slug[] = ["yoklama", "aidat-odemeleri"];

const OUTLINE = "h-11 flex-1 rounded-xl px-3 md:flex-none md:px-4";

const HOW_TO = [
  "Üye listesini indir (bu sayfada ya da Veri içe aktar sayfasında).",
  "Yapay zekâ talimatını kopyala; yeni bir sohbete yapıştır.",
  "Kayıtlarını ekle (Excel dosyası, Sheets'ten kopyalanmış tablo ya da kâğıdın fotoğrafı) ve üye listesini ekle. Gönder.",
  "Gelen CSV'yi kopyala ve Metni yapıştır'a yapıştır (ya da dosya olarak kaydedip Dosya seç ile yükle). Sonra Kontrol et.",
  'Hata varsa Hataları kopyala, aynı sohbete yapıştır, yeni CSV ile 4. adımı tekrarla. Sonunda yapay zekânın "Atladıklarım" ve "Tarih çelişkisi" listelerini oku: o kayıtları elle gir ya da kaynağı düzelt.',
];

export default async function ImportTypePage({ params }: PageProps<"/ice-aktar/[tur]">) {
  const user = await requireManager();
  const { tur } = await params;
  if (!isSlug(tur)) notFound();
  const def = defOf(tur);
  const [index, prompt] = await Promise.all([importIndex(), livePrompt(def)]);
  const header = headerLine(def);
  const historyMissing =
    NEEDS_MEMBER_HISTORY.includes(def.slug) && !index.memberHistoryImported;
  const memberList = NEEDS_MEMBER_LIST.includes(def.slug);
  const following = DEFS.find((d) => d.step === def.step + 1);
  const next = following
    ? { href: `/ice-aktar/${following.slug}`, label: `Sıradaki: ${following.step} · ${following.title}` }
    : { href: "/ice-aktar", label: "Adımlara dön" };
  const prerequisites = PREREQUISITES[def.slug].map(({ step, optional }) => {
    if (step === 0) {
      return (
        <span key={0} className="block">
          <strong className="font-medium">0 · Açılış bakiyesi</strong>{" "}
          {index.opening
            ? `${formatAuditDate(dayInstant(index.opening.date))}. Kayıtların bundan önce başlıyorsa önce tarihi geri çek.`
            : "girilmemiş."}{" "}
          <Link
            href="/finans/ayarlar"
            className="-my-3 inline py-3 font-medium underline underline-offset-4"
          >
            Ayarlar
          </Link>
        </span>
      );
    }
    const card = index.steps.find((s) => s.step === step)!;
    if (step === 1 && historyMissing) {
      return (
        <span key={step} className="block" data-testid="history-warning">
          <Link
            href="/ice-aktar/uyeler"
            className="-my-3 inline py-3 font-medium underline underline-offset-4"
          >
            1 · Üye geçmişi
          </Link>{" "}
          henüz aktarılmadı. Portaldaki katılım tarihleri davet günü; daha eski kayıtlar reddedilir.
        </span>
      );
    }
    return (
      <span key={step} className="block">
        <strong className="font-medium">
          {card.step} · {card.title}
        </strong>{" "}
        {card.last ? `✓ ${formatAuditDate(card.last.at)}` : "henüz yok"}
        {optional && ` (${optional})`}
      </span>
    );
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/ice-aktar"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Veri içe aktar
        </Link>
        <p className="text-[13px] font-medium tracking-wide text-muted-foreground">
          ADIM {def.step} / 6
        </p>
        <h1 className="text-4xl font-medium">{def.title}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{def.explanation}</p>
        {prerequisites.length > 0 && (
          <p
            className={cn(
              "rounded-xl px-3 py-2 text-[13px]",
              historyMissing ? "border border-late/45 bg-late/10" : "bg-muted",
            )}
            data-testid="prerequisites"
            data-warning={historyMissing || undefined}
          >
            {historyMissing ? (
              <span className="flex items-center gap-1.5 font-medium">
                <TriangleAlert className="size-4 shrink-0 text-late-ink" aria-hidden />
                Dikkat · Önce:
              </span>
            ) : (
              <span className="block">Önce:</span>
            )}
            {prerequisites}
          </p>
        )}
        {def.slug === "uyeler" && user.role === "board" && (
          <p className="text-[13px] text-muted-foreground" data-testid="board-note">
            Yönetim kurulu olarak yalnızca korist satırlarını değiştirebilirsin; şef ve yönetim
            üyelerinin satırlarını koro şefi aktarır. Talimat şef ve yönetim satırlarını ikinci bir
            kod bloğuna ayırır; o bloğu koro şefine ver.
          </p>
        )}
      </div>

      <section aria-labelledby="hazirla" className={CARD}>
        <h2 id="hazirla" className="text-xl font-medium">
          1 · Dosyanı hazırla
        </h2>
        <p className="text-sm text-muted-foreground">
          Talimatı kopyala, yapay zekâ sohbetine (ChatGPT, Claude, Gemini) yapıştır, kayıtlarını
          {memberList ? " ve üye listesini" : ""} ekle. Gelen CSV&apos;yi buraya yükle.
        </p>
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
          <CopyButton
            text={prompt}
            label="Yapay zekâ talimatını kopyala"
            toastText="Talimat kopyalandı."
            fallbackTitle="Talimat"
            variant="default"
            className="w-full md:w-auto"
          />
          <div className="flex gap-2">
            <a
              href={`/ice-aktar/${def.slug}/ornek`}
              download={`${fileBase(def)}.csv`}
              className={cn(buttonVariants({ variant: "outline" }), OUTLINE)}
            >
              <Download aria-hidden />
              Örnek dosyayı indir
            </a>
            <a
              href={`/ice-aktar/${def.slug}/talimat`}
              download={`${fileBase(def)}.md`}
              className={cn(buttonVariants({ variant: "outline" }), OUTLINE)}
            >
              <FileText aria-hidden />
              Talimatı indir
            </a>
          </div>
          {memberList && (
            <a
              href="/ice-aktar/uye-listesi"
              download
              className={cn(buttonVariants({ variant: "outline" }), "h-11 shrink-0 rounded-xl px-3 md:px-4")}
              data-testid="member-list-link"
            >
              <Users aria-hidden />
              Üye listesini indir
            </a>
          )}
        </div>
        {memberList && (
          <p className="text-xs text-muted-foreground">
            Listede adlar ve e-postalar var. Yapay zekâya yalnızca işin için gerekeni ver.
          </p>
        )}
        <details className="group text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Nasıl yapılır?
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <ol className="list-decimal space-y-1.5 pb-1 pl-5 text-muted-foreground">
            {HOW_TO.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
      </section>

      <ImportFlow
        check={checkImport.bind(null, def.slug)}
        commit={commitImport.bind(null, def.slug)}
        typeTitle={def.title}
        header={header}
        next={next}
      />

      <section aria-labelledby="sutunlar" className={CARD}>
        <h2 id="sutunlar" className="text-xl font-medium">
          Sütunlar
        </h2>
        <p className="text-sm text-muted-foreground">Başlık satırı:</p>
        <p
          className="rounded-xl bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap"
          data-testid="header-line"
        >
          {header}
        </p>
        <CopyButton text={header} label="Başlığı kopyala" toastText="Başlık kopyalandı." />
        <ColumnTable columns={columnDocs(def)} title={def.title} />
      </section>
    </div>
  );
}
