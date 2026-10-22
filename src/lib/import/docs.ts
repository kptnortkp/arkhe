// Renders every text a human or an AI reads from the definitions: sample CSV, prompt, .md, README.
// The download routes and scripts/import-docs.ts both call these, so the repo files match byte for byte.
import { fileBase, headerLine, type ColumnDef, type ImportDef, type LiveBlock, type LiveData, type WorkedExample } from "./def";
import { DEFS } from "./defs";

const BOM = "﻿";

function sampleCell(value: string) {
  return /[;"\r\n]/.test(value) || /^[=+\-@]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 with BOM, ";" and CRLF: what Excel TR opens without mangling ş. */
export function sampleCsv(def: ImportDef) {
  const lines = [def.columns.map((c) => c.name), ...def.sample].map((r) => r.map(sampleCell).join(";"));
  return BOM + lines.join("\r\n") + "\r\n";
}

const PEOPLE = [
  "KİŞİLER",
  "- Kişileri ekteki üye listesindeki (arkhe-uyeler-….csv) e-postayla eşleştir; adresi listeden aynen kopyala.",
  "- Ayrılmış eski üyeler listede @eski.invalid ile biten adresleriyle durur; onları da aynen kullan. Üye geçmişini (1. adım) aktardıysan üye listesini yeniden indir: eski üyeler ancak o zaman listede olur.",
  '- Listede hiç olmayan biri için adres uydurma (ad.soyad@eski.invalid bile yazma): o satırı koyma, Atladıklarım\'a "üye listesinde yok, önce Üye geçmişi\'ne eklenmeli" diye yaz.',
  '- Listede rolü "sef" olan kişiyi bu dosyaya koyma.',
];

/** Import format: "300" or "300,50". */
function amountText(kurus: number) {
  const lira = Math.floor(kurus / 100);
  const rest = kurus % 100;
  return rest ? `${lira},${String(rest).padStart(2, "0")}` : String(lira);
}

/** Longest list a live block prints; older periods drop off first. */
const LIVE_MAX = 240;

const PLACEHOLDER =
  "Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir bu listeyi portaldaki verilerle kendisi doldurur. Bu talimatı portalın dışından (docs/ice-aktarma klasöründen) aldıysan bu satırı sil ve yerine";

/** A block of portal data; `live` null renders the explained placeholder of the repo copy. */
function liveBlock(block: LiveBlock, live: LiveData | null): string[] {
  if (block === "periods") {
    const head = "AİDAT DÖNEMLERİ (portalda olanlar; donem sütununa adı aynen yaz)";
    if (!live) {
      return [
        head,
        `- <${PLACEHOLDER} Finans › Aidat'taki dönemleri, her biri bir satırda, şu biçimde yaz: "Eylül 2024: 2024-09-01 – 2024-09-30, son ödeme 2024-09-10, tam 300, indirimli 150".>`,
      ];
    }
    if (!live.periods.length) {
      return [head, '- Portalda henüz aidat dönemi yok. CSV verme; bana "Önce 5. adımı (Aidat dönemleri) yap" de.'];
    }
    const shown = [...live.periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn)).slice(-LIVE_MAX);
    return [
      head,
      ...shown.map(
        (p) =>
          `- ${p.name}: ${p.startsOn} – ${p.endsOn}, son ödeme ${p.dueOn}, tam ${amountText(p.amountKurus)}, ${p.reducedAmountKurus ? `indirimli ${amountText(p.reducedAmountKurus)}` : "indirimli tutar yok (indirimli üye de tam öder)"}`,
      ),
      ...(live.periods.length > shown.length
        ? [`- (Daha eski ${live.periods.length - shown.length} dönem listede yok; onlar için adı Finans › Aidat'tan sor.)`]
        : []),
    ];
  }
  if (block === "events") {
    const head = "ETKİNLİKLER (portalda olanlar; etkinlik sütununa adı aynen yaz)";
    if (!live) {
      return [
        head,
        `- <${PLACEHOLDER} Finans › Etkinlikler'deki etkinlik adlarını, her biri bir satırda yaz. Etkinlik yoksa "Portalda etkinlik yok; etkinlik sütununu boş bırak." yaz.>`,
      ];
    }
    if (!live.events.length) return [head, "- Portalda etkinlik yok; etkinlik sütununu boş bırak."];
    const shown = [...live.events].sort((a, b) => a.localeCompare(b, "tr")).slice(0, LIVE_MAX);
    return [head, ...shown.map((e) => `- ${e}`)];
  }
  const head = "PORTALDA ELLE GİRİLMİŞ HAREKETLER";
  const rule = (date: string) =>
    `- Portalda ${date} tarihinden beri elle girilmiş hareketler var. Yalnızca bu tarihten ÖNCEKİ kayıtları yaz. Bu tarih ve sonrasındaki kayıtları CSV'ye koyma; Atladıklarım'a "portalda zaten girilmiş olabilir" diye yaz. Yoksa para iki kez sayılır.`;
  if (!live) {
    return [
      head,
      `- <${PLACEHOLDER} Finans › Hareketler'deki elle girilmiş en eski hareketin (açılış bakiyesi ve aidat hariç) tarihini şu kurala koy: ${rule("YYYY-AA-GG").slice(2)} Elle girilmiş hareket yoksa "Portalda elle girilmiş hareket yok." yaz.>`,
    ];
  }
  return [head, live.firstHandEntry ? rule(live.firstHandEntry) : "- Portalda elle girilmiş hareket yok."];
}

/** The AI prompt: self-contained, one copy holds every rule of the type. `live` fills the portal lists. */
export function promptText(def: ImportDef, live: LiveData | null = null) {
  const lines = [
    `Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "${def.title}" içe aktarma dosyasına çevir.`,
    "",
    "ÇIKTI",
    `- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "${fileBase(def)}.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.`,
    "- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.",
    "- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:",
    headerLine(def),
    "- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.",
    `- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; ${def.unit} iki parçaya bölünmesin).`,
    "",
    "BİÇİMLER",
    "- Tarih: YYYY-AA-GG (örnek 2024-10-08). 08/10/2024, 8 Ekim 2024 ya da 24-10-08 yazma.",
    "- Saat: SS:DD, 24 saat (örnek 19:00).",
    "- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.",
    "- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.",
    "",
    "SÜTUNLAR",
    ...def.columns.filter((c) => c.prompt).map((c) => `- ${c.prompt}`),
    "",
    ...(def.live ?? []).flatMap((b) => [...liveBlock(b, live), ""]),
    "BU DOSYAYA ÖZEL KURALLAR",
    ...def.rules.map((r) => `- ${r}`),
    ...(def.people ? ["", ...PEOPLE] : []),
    "",
    "DÜRÜSTLÜK",
    "- Bilmediğin bir değeri uydurma; boş bırak. Zorunlu bir alan bilinmiyorsa o satırı CSV'ye koyma.",
    ...(def.ambiguity
      ? [
          '- Bir kişiyi üye listesinde kesin eşleştiremiyorsan (örneğin listede iki "Selin" var) tahmin etme; satırı koyma.',
        ]
      : []),
    "- CSV'den sonra, kod bloğunun dışında şu başlıklarla yaz:",
    '  "Atladıklarım": CSV\'ye koymadığın her kayıt, kaynaktaki hâliyle ve nedeniyle.',
    '  "Tahmin ettiklerim": yaklaşık yazdığın her değer (örneğin yalnızca ay biliniyordu, ayın 1\'ini yazdım).',
    ...(def.people
      ? ['  "Tarih çelişkisi": katılım tarihi üye listesinde kaydın tarihinden sonra olan her kişi ve tarih.']
      : []),
    '  Hiçbiri yoksa "Atladığım kayıt yok." yaz.',
    "",
    "Kayıtlarım:",
    "(buraya yapıştır ya da dosyayı ekle)",
  ];
  return lines.join("\n") + "\n";
}

/** "Zorunlu" cell: Evet, Hayır or the condition. */
export function requiredText(c: ColumnDef) {
  return c.required === true ? "Evet" : c.required === false ? "Hayır" : c.required;
}

/** "İzin verilen değerler" cell, in Markdown. */
export function allowedText(c: ColumnDef) {
  if (c.allowedText) return c.allowedText;
  if (c.format.kind === "code") {
    return (c.format.codes ?? c.format.table.canonical).map((v) => `\`${v}\``).join(", ");
  }
  if (c.format.kind === "codes") return c.format.table.canonical.map((v) => `\`${v}\``).join(", ");
  return "—";
}

/** The column table rows, as the page renders them (Markdown inline code kept). */
export function columnDocs(def: ImportDef) {
  return def.columns.map((c) => ({
    name: c.name,
    required: requiredText(c),
    format: c.formatText,
    allowed: allowedText(c),
    example: c.example,
    help: c.help,
  }));
}

const cell = (s: string) => (s || "").replace(/\|/g, "\\|").replace(/\n/g, " ") || " ";

function exampleParts(ex: WorkedExample, heading: string) {
  return [
    heading,
    "",
    ex.intro,
    "",
    "```",
    ex.source,
    "```",
    "",
    "Beklenen çıktı:",
    "",
    "```csv",
    ex.csv,
    "```",
    "",
    ...ex.report.flatMap((r) => [`> ${r}`, ">"]).slice(0, -1),
    "",
    ex.teaches,
    "",
  ];
}

/** The type's .md; `live` is passed by the download route only (the repo copy keeps placeholders). */
export function markdown(def: ImportDef, live: LiveData | null = null) {
  const table = [
    "| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |",
    "|---|---|---|---|---|---|",
    ...columnDocs(def).map(
      (c) =>
        `| \`${c.name}\` | ${cell(c.required)} | ${cell(c.format)} | ${cell(c.allowed)} | \`${c.example}\` | ${cell(c.help)} |`,
    ),
  ];
  const ex = def.example;
  const parts = [
    `# ${def.step} · ${def.title}`,
    "",
    def.explanation,
    "",
    "Başlık satırı:",
    "",
    "```",
    headerLine(def),
    "```",
    "",
    "## Sütunlar",
    "",
    ...table,
    "",
    ...(def.notes?.length ? [...def.notes.flatMap((n) => [n, ""])] : []),
    "## Yapay zekâ talimatı",
    "",
    "Aşağıdaki metni olduğu gibi yeni bir yapay zekâ sohbetine yapıştır (portalda: Yapay zekâ talimatını kopyala), sonra kayıtlarını" +
      (def.people || def.step === 1 ? " ve Üye listesini indir dosyasını" : "") +
      " ekle.",
    "",
    "```text",
    promptText(def, live).trimEnd(),
    "```",
    "",
    ...exampleParts(ex, "## Örnek"),
    ...(def.moreExamples ?? []).flatMap((m) => exampleParts(m, `## ${m.title ?? "Bir örnek daha"}`)),
    "## Örnek dosya",
    "",
    `\`${fileBase(def)}.csv\` her sütunu gösteren kısa bir örnektir. Adlar ve adresler uydurmadır (\`ornek.com\`, \`eski.invalid\`).`,
    "",
  ];
  return parts.join("\n");
}

export function readme() {
  const steps = DEFS.map(
    (d) => `| ${d.step} | ${d.title} | \`${fileBase(d)}.csv\`, \`${fileBase(d)}.md\` | ${d.summary} |`,
  );
  return [
    "# Eski kayıtları portala aktarmak",
    "",
    "Excel'deki, Sheets'teki ya da kâğıttaki eski kayıtları (yoklamalar, defter, aidatlar, kim ne zaman katıldı) portala toplu olarak aktarırsın. Portalda Profil › Veri içe aktar sayfasından girilir. Her dosya önce **Kontrol et** ile denetlenir; kontrol hiçbir şey yazmaz. Sonra **İçe aktar** dosyanın tamamını tek seferde yazar: ya hepsi girer ya hiçbiri.",
    "",
    "## Sıra",
    "",
    "**Portaldaki katılım tarihi, kişinin portala davet edildiği gündür. Bundan eski bir kayıt (yoklama, aidat) aktaracaksan 1. adım (Üye geçmişi) zorunludur; yoksa yoklamalar ve ödemeler reddedilir.**",
    "",
    "Adımları bu sırayla yap:",
    "",
    "| Adım | Tür | Dosyalar | Ne aktarılır |",
    "|---|---|---|---|",
    "| 0 | Açılış bakiyesi | elle, Finans › Ayarlar | Kayıtların başladığı günün kasa ve banka bakiyesi. |",
    ...steps,
    "",
    "Neden bu sıra: üye tarihleri kimin hangi çalışmada beklendiğini ve hangi aidat döneminden sorumlu olduğunu belirler; aidat dönemleri ödemelerden önce var olmalıdır. Sıra yanlışsa bir şey bozulmaz: kontrol hata verir, önceki adımı yapıp aynı dosyayı yeniden yüklersin.",
    "",
    "**Üye geçmişini aktardıktan sonra Üye listesini indir'i yeniden kullan; eski üyelerin adresleri artık listede.**",
    "",
    "Yönetim kurulu üyesiysen 1. adımda yalnızca koristlerin satırlarını değiştirebilirsin. Değişiklik getirmeyen bir şef ya da yönetim satırı sorun çıkarmaz, ama geçmiş bir katılım tarihi her zaman değişikliktir. Talimat bu satırları ikinci bir kod bloğuna ayırır; o bloğu koro şefine ver, o aktarsın.",
    "",
    "## Açılış bakiyesi (0. adım)",
    "",
    "Geçmişi aktarıyorsan açılış bakiyesi, kayıtlarının başladığı günün kasa ve banka bakiyesidir, bugünkü bakiye değil. Yoksa para iki kez sayılır.",
    "",
    'Kayıtların 1 Eylül 2024\'te başlıyorsa, Finans › Ayarlar\'da tarihi 2024-09-01 yap ve o sabahki kasa ve banka bakiyesini yaz. Defterdeki "devreden" satırı budur; onu hareket olarak aktarma.',
    "",
    "Portalda zaten elle girilmiş hareketleri dosyaya koyma: yalnızca portalda elle girilen ilk hareketin tarihinden önceki kayıtları aktar. Portaldaki talimat bu tarihi kendisi yazar. Kontrol, portalda aynı gün, kategori ve tutarda elle girilmiş bir hareket bulursa Dikkat altında söyler; tekrar olanları dosyadan çıkar.",
    "",
    "## Yapay zekâyla çalışmak",
    "",
    "1. Veri içe aktar sayfasında Üye listesini indir.",
    "2. Adımın sayfasında Yapay zekâ talimatını kopyala; yeni bir sohbete yapıştır.",
    "3. Kayıtlarını ekle (Excel dosyası, Sheets'ten kopyalanmış tablo ya da kâğıdın fotoğrafı) ve üye listesini ekle. Gönder.",
    "4. Gelen CSV'yi kopyala ve Metni yapıştır'a yapıştır (ya da dosya olarak kaydedip Dosya seç ile yükle). Sonra Kontrol et.",
    '5. Hata varsa Hataları kopyala, aynı sohbete yapıştır, yeni CSV ile 4. adımı tekrarla. Sonunda yapay zekânın "Atladıklarım" ve "Tarih çelişkisi" listelerini oku: o kayıtları elle gir ya da kaynağı düzelt.',
    "",
    "Her adımın `.md` dosyasında o türün sütunları, talimatın tamamı ve çözülmüş bir örnek vardır. 4. ve 6. adımın talimatı portaldaki verilere (aidat dönemleri, etkinlikler, elle girilmiş ilk hareket) dayanır: portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir bunları talimata kendisi yazar; buradaki `.md` dosyalarında onların yerinde ne yazacağını anlatan bir satır durur.",
    "",
    "Örnek dosyalar uydurma kişilerle yazıldı (`ornek.com`, `eski.invalid`); portalında yüklersen \"Bu e-postayla üye yok\" hatası verir. Yalnızca biçimi gösterir.",
    "",
    "Kayıt numaraları (`kayit_no`) tarihe ve sıraya bağlıdır; aynı kaynak her seferinde aynı numaraları verir. Aynı numara farklı içerikle yeniden gelirse kontrol hata verir: o aktarım doğruysa yeni satıra yeni bir numara ver (talimat sonradan eklenen kayıtlara `EK1-` gibi bir etiket koyar).",
    "",
    "## Dosyayı kaydetmek",
    "",
    "En kolayı metni Metni yapıştır'a yapıştırmaktır. Dosya olarak kaydedeceksen:",
    "",
    "- ChatGPT, Claude: dosya verdiyse İndir.",
    "- Excel: Dosya › Farklı Kaydet › CSV UTF-8 (Virgülle ayrılmış). Düz `CSV` seçme; o Windows-1254'tür ve ş ğ ı bozulur.",
    "- Google Sheets: Dosya › İndir › Virgülle ayrılmış değerler (.csv).",
    "- Windows Not Defteri: Farklı kaydet, Kayıt türü: Tüm dosyalar, ad `yoklama.csv`, Kodlama: UTF-8.",
    "- Mac Metin Düzenleyici: Biçim › Düz Metin Yap, sonra Kaydet, ad `yoklama.csv`, Düz metin kodlaması: Unicode (UTF-8).",
    "",
    "## Dosya kuralları",
    "",
    "- Kodlama UTF-8 (BOM'lu ya da BOM'suz). Ayırıcı noktalı virgül (`;`) ya da virgül (`,`); başlık satırına bakılır.",
    '- İlk satır başlıktır. Sütun adları türün `.md` dosyasındaki gibidir; büyük-küçük harf ve Türkçe harf fark etmez (`KATILIM_TARIHI`, `Katılım tarihi`). Bilinmeyen sütun hatadır. İsteğe bağlı sütunlar hiç yazılmayabilir.',
    '- Hücrede ayırıcı (noktalı virgül ya da virgül) varsa hücre çift tırnak içine alınır (`"Salon; kira"`). Bir hücrede satır sonu olamaz.',
    "- Boş satırlar atlanır; hata satır numaraları dosyanın satırlarıdır (1. satır başlık).",
    "- Tarih `2025-10-07` ya da `07.10.2025`; asla `07/10/2025`. Tarihler 2000'den sonra ve bugünden önce olur (dönem ve aidat bitişleri gelecekte olabilir).",
    "- Saat `19:00` biçiminde, 24 saat.",
    "- Tutar `1250,50` ya da `1250`; asla `1.250,50`, `₺` ya da `TL`. En fazla ₺10.000.000,00.",
    "- Kod sütunları (partisyon, durum, kategori…) Türkçe kodu, portaldaki adı ya da İngilizce kodu kabul eder: `ulasim_ve_konaklama`, `Ulaşım ve konaklama` ve `travel` aynıdır.",
    "- En fazla 1 MB ve 5000 satır.",
    "",
    "## Eski aidatlar borç görünmesin",
    "",
    "Geçmiş aidat dönemlerini aktardıktan sonra o dönemlerde ödemesi olmayan herkes Gecikti görünür. Koro bu borçları çoktan sildiyse 6. adımda muafiyet satırları yaz. Yapay zekâya şunu söyle: \"Şu dönemler için ödemeyenleri muaf tut\"; talimattaki kural her dönem için, o dönemde koroda olup hiç ödemesi olmayan herkese bir `muaf` satırı yazdırır.",
    "",
    "## Büyük dosyalar",
    "",
    "Bir dosya en fazla 5000 satır ve 1 MB olabilir. Büyük geçmişi sezonlara böl. Bir çalışmanın ya da defterin bir gününün satırlarını iki dosyaya bölme. Yoklama dosyasına yalnızca gelenleri, geç gelenleri ve mazeretlileri yazarsan satır sayısı yarıya iner; listede olmayan beklenen herkes Gelmedi sayılır.",
    "",
    "## Kişisel veriler",
    "",
    "Yapay zekâ kullanırsan üyelerin adları ve e-postaları başka bir şirketin sohbetine gider. Yalnızca iş için gerekeni ver; istersen adların yerine baş harfleri kullan. Portal hiçbir şeyi bir yere göndermez ve yüklenen dosyayı saklamaz; yalnızca adını, boyutunu ve SHA-256 özetini kaydeder.",
    "",
    "## Geri almak",
    "",
    "İçe aktarma geçmişi'nde en son aktarımı geri alabilirsin; daha eskisi için önce sonrakileri geri alırsın. Aktarımdan sonra portalda üzerine bir şey kurulduysa (bir yoklama düzeltildi, bir ödeme iptal edildi, bir üye elle değişti) geri alma reddedilir. Aktarımı yapan kişi ya da koro şefi geri alabilir.",
    "",
  ].join("\n");
}
