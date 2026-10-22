import type { ImportDef } from "../def";

const months = [
  ["Eylül 2024", "2024-09-01", "2024-09-30", "2024-09-10"],
  ["Ekim 2024", "2024-10-01", "2024-10-31", "2024-10-10"],
  ["Kasım 2024", "2024-11-01", "2024-11-30", "2024-11-10"],
  ["Aralık 2024", "2024-12-01", "2024-12-31", "2024-12-10"],
  ["Ocak 2025", "2025-01-01", "2025-01-31", "2025-01-10"],
  ["Şubat 2025", "2025-02-01", "2025-02-28", "2025-02-10"],
  ["Mart 2025", "2025-03-01", "2025-03-31", "2025-03-10"],
  ["Nisan 2025", "2025-04-01", "2025-04-30", "2025-04-10"],
  ["Mayıs 2025", "2025-05-01", "2025-05-31", "2025-05-10"],
  ["Haziran 2025", "2025-06-01", "2025-06-30", "2025-06-10"],
];

export const aidatDonemleri: ImportDef = {
  slug: "aidat-donemleri",
  step: 5,
  kind: "dues_periods",
  title: "Aidat dönemleri",
  summary: "Aidat dönemleri ve tutarları.",
  explanation:
    "Aidat dönemlerini ve tutarlarını oluşturur. Aynı tutarlı ardışık aylar için Aidat › Aylık toplu oluştur daha hızlı.",
  columns: [
    {
      name: "ad",
      required: true,
      format: { kind: "text", max: 40 },
      formatText: "1–40 karakter",
      example: "Eylül 2024",
      help: "Aylık dönemlerde portalın adı: ay ve yıl. 6. adımda bu adla eşleşir.",
      prompt:
        'ad (zorunlu): aylık dönemde ayın Türkçe adı ve yıl, portaldaki gibi: "Eylül 2024", "Ekim 2024", "Şubat 2025". Dönem bir sezonsa: "2024–25 sezonu".',
    },
    {
      name: "baslangic",
      required: true,
      format: { kind: "date" },
      formatText: "tarih",
      example: "2024-09-01",
      help: "",
      prompt: "baslangic, bitis (zorunlu): dönemin ilk ve son günü.",
    },
    {
      name: "bitis",
      required: true,
      format: { kind: "date", future: true },
      formatText: "tarih, gelecekte olabilir",
      example: "2024-09-30",
      help: "",
      prompt: "",
    },
    {
      name: "son_odeme",
      required: true,
      format: { kind: "date", future: true },
      formatText: "tarih, gelecekte olabilir",
      example: "2024-09-10",
      help: "Başlangıçtan önce olamaz.",
      prompt: "son_odeme (zorunlu): son ödeme günü; baslangic'tan önce olamaz.",
    },
    {
      name: "tutar",
      required: true,
      format: { kind: "amount" },
      formatText: "tutar",
      example: "300",
      help: "Tam aidat.",
      prompt: "tutar (zorunlu): tam aidat.",
    },
    {
      name: "indirimli_tutar",
      required: false,
      format: { kind: "amount" },
      formatText: "tutar",
      example: "150",
      help: "Tam aidattan az.",
      prompt: "indirimli_tutar (isteğe bağlı): öğrenci vb. indirimli aidat; tutar'dan az olmalı.",
    },
  ],
  sample: months.slice(0, 3).map(([name, start, end, due]) => [name, start, end, due, "300", "150"]),
  rules: [
    "Her dönem bir satır. Dönemler çakışmasın.",
    "Aidat alınmayan aylar (örneğin yaz) için satır yazma.",
    'Son ödeme günü bilinmiyorsa ayın 10\'unu yaz ve "Tahmin ettiklerim"e ekle.',
  ],
  people: false,
  ambiguity: false,
  unit: "bir dönem",
  example: {
    intro: "Kaynak: saymanın notu.",
    source:
      "2024-25'te aylık aidat 300 TL, öğrenciler 150. Eylülden hazirana, her ayın 10'una kadar. Temmuz ağustos aidat yok.",
    csv: [
      "ad;baslangic;bitis;son_odeme;tutar;indirimli_tutar",
      ...months.map(([name, start, end, due]) => `${name};${start};${end};${due};300;150`),
    ].join("\n"),
    report: ["**Atladığım kayıt yok.**"],
    teaches:
      "Bu örnek portalın ay adlarını, yaz aylarının atlanmasını ve indirimli tutarı gösterir.",
  },
  links: [{ label: "Aidat", href: "/finans/aidat" }],
  notes: [
    "Dönemleri aktardıktan sonra eski dönemlerde ödemesi olmayan herkes Gecikti görünür. 6. adımdaki muafiyet satırlarıyla bunu kapatırsın.",
  ],
};
