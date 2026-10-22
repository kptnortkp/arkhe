import type { ImportDef } from "../def";

export const donemler: ImportDef = {
  slug: "donemler",
  step: 2,
  kind: "terms",
  title: "Çalışma dönemleri",
  summary: "Güz ve bahar dönemleri.",
  explanation: "Raporlarda seçtiğin çalışma dönemlerini oluşturur (örneğin 2024–25 Güz).",
  columns: [
    {
      name: "ad",
      required: true,
      format: { kind: "text", max: 40 },
      formatText: "1–40 karakter",
      example: "2024–25 Güz",
      help: "Raporlardaki dönem seçicide görünen ad. Aynı ad iki kez olmaz.",
      prompt:
        'ad (zorunlu): dönemin adı, en fazla 40 karakter. Portaldaki gibi yaz: "2024–25 Güz", "2024–25 Bahar" (yıllar arasında uzun tire –). Koro sezonu bölmüyorsa "2024–25 sezonu".',
    },
    {
      name: "baslangic",
      required: true,
      format: { kind: "date" },
      formatText: "tarih",
      example: "2024-09-16",
      help: "Dönemin ilk günü.",
      prompt: "baslangic (zorunlu): ilk gün.",
    },
    {
      name: "bitis",
      required: true,
      format: { kind: "date", future: true },
      formatText: "tarih, gelecekte olabilir",
      example: "2025-01-31",
      help: "Son günü. Başlangıçtan en fazla 366 gün sonra.",
      prompt: "bitis (zorunlu): son gün.",
    },
  ],
  sample: [
    ["2023–24 Güz", "2023-09-18", "2024-01-26"],
    ["2023–24 Bahar", "2024-02-12", "2024-06-21"],
    ["2024–25 Güz", "2024-09-16", "2025-01-31"],
    ["2024–25 Bahar", "2025-02-10", "2025-06-27"],
  ],
  rules: [
    "Dönemler birbiriyle çakışmasın: bir dönemin bitişi, sonrakinin başlangıcından önce olsun. Aradaki tatiller boşta kalabilir.",
    "Bir dönem en fazla bir yıl (366 gün) sürebilir.",
    "Kesin başlangıç ya da bitiş günü yoksa o dönemi yazma; Atladıklarım'a yaz ve bana tarihleri sor.",
  ],
  people: false,
  ambiguity: false,
  unit: "bir dönem",
  example: {
    intro: "Kaynak: eski şefin WhatsApp mesajı.",
    source:
      "23-24'te güzde 18 eylülde başladık, son prova 26 ocak. bahar 12 şubat - 21 haziran. 24-25 aynı düzen, eylülün üçüncü haftası başladık sanırım",
    csv: `ad;baslangic;bitis
2023–24 Güz;2023-09-18;2024-01-26
2023–24 Bahar;2024-02-12;2024-06-21`,
    report: [
      '**Atladıklarım:** "24-25 aynı düzen, eylülün üçüncü haftası": kesin tarih yok. Başlangıç ve bitiş günlerini verirsen 2024–25 Güz ve Bahar satırlarını eklerim.',
    ],
    teaches:
      'Bu örnek uzun tireli adlandırmayı ve "sanırım"ın tarihe çevrilmediğini gösterir. Dönem sınırları tahmin edilmez: yanlış bir sınır rapordaki sayıları kaydırır.',
  },
  links: [{ label: "Raporlar", href: "/raporlar" }],
  notes: [
    "Dönemlerin portalda düzenleme sayfası yok. Yanlış aktarılan bir dönemi İçe aktarma geçmişi'nden geri alıp düzeltilmiş dosyayı yeniden yüklersin.",
  ],
};
