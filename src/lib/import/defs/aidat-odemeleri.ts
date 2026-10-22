import { ACCOUNT_CODES, DUES_ROW_CODES } from "../codes";
import type { ImportDef } from "../def";

const reason = "Geçmiş dönem borcu, yönetim kararıyla silindi";
const waivers: [string, string, string][] = [
  ["M-202409-1", "zeynep.ak@eski.invalid", "Eylül 2024"],
  ["M-202409-2", "selin.cakir@ornek.com", "Eylül 2024"],
  ["M-202409-3", "selin.aydin@ornek.com", "Eylül 2024"],
  ["M-202410-1", "ayse.demir@ornek.com", "Ekim 2024"],
  ["M-202410-2", "mehmet.kaya@ornek.com", "Ekim 2024"],
  ["M-202410-3", "elif.sahin@ornek.com", "Ekim 2024"],
  ["M-202410-4", "zeynep.ak@eski.invalid", "Ekim 2024"],
  ["M-202410-5", "selin.aydin@ornek.com", "Ekim 2024"],
  ["M-202411-1", "ayse.demir@ornek.com", "Kasım 2024"],
  ["M-202411-2", "mehmet.kaya@ornek.com", "Kasım 2024"],
  ["M-202411-3", "elif.sahin@ornek.com", "Kasım 2024"],
  ["M-202411-4", "zeynep.ak@eski.invalid", "Kasım 2024"],
  ["M-202411-5", "selin.cakir@ornek.com", "Kasım 2024"],
  ["M-202411-6", "selin.aydin@ornek.com", "Kasım 2024"],
];

export const aidatOdemeleri: ImportDef = {
  slug: "aidat-odemeleri",
  step: 6,
  kind: "dues_payments",
  title: "Aidat ödemeleri ve muafiyetler",
  summary: "Kim hangi dönemi ödedi, kim muaf.",
  explanation:
    "Kimin hangi dönemi ne zaman ödediğini ve eski borçlardan kimin muaf tutulduğunu ekler.",
  columns: [
    {
      name: "kayit_no",
      required: true,
      format: { kind: "recordNo" },
      formatText: "1–40, harf, rakam, `- _ . /`",
      example: "O-20240905-202409-1",
      help: "Ödeme: `O-` + tarih + dönemin ayı + sıra. Muafiyet: `M-` + dönemin ayı + sıra.",
      prompt:
        "kayit_no (zorunlu): her satıra farklı numara. Ödemede O- + ödeme tarihinin rakamları + - + dönemin başladığı yıl ve ay + - + o gün o döneme yazılan kaçıncı ödeme olduğu (2024-10-02'de Eylül 2024'e yazılan ilk ödeme: O-20241002-202409-1). Muafiyette M- + dönemin başladığı yıl ve ay + sıra (Eylül 2024 için M-202409-1, M-202409-2…). Numara yalnızca tarihe, döneme ve kaynaktaki sıraya bağlıdır; dosya dönemlere bölünse de aynı kalır. Yalnızca harf, rakam ve - _ . / kullan.",
    },
    {
      name: "islem",
      required: false,
      format: { kind: "code", table: DUES_ROW_CODES },
      formatText: "kod, varsayılan `odeme`",
      example: "odeme",
      help: "",
      prompt: "islem (isteğe bağlı): İzin verilen: odeme (varsayılan), muaf.",
    },
    {
      name: "eposta",
      required: true,
      format: { kind: "email" },
      formatText: "e-posta",
      allowedText: "üye listesindeki adresler",
      example: "ayse.demir@ornek.com",
      help: "Eski üyeler `@eski.invalid` adresleriyle.",
      prompt: "eposta (zorunlu): KİŞİLER kurallarına bak.",
    },
    {
      name: "donem",
      required: true,
      format: { kind: "text", max: 40 },
      formatText: "portaldaki aidat döneminin adı",
      example: "Eylül 2024",
      help: "Adı Finans › Aidat sayfasındaki gibi yaz.",
      prompt:
        "donem (zorunlu): AİDAT DÖNEMLERİ listesindeki adlardan biri, aynen. Listede olmayan bir döneme satır yazma; Atladıklarım'a yaz.",
    },
    {
      name: "tutar",
      required: "Ödemede",
      format: { kind: "amount" },
      formatText: "tutar",
      example: "300",
      help: "Dönemin kalan borcundan fazla olamaz. Muafiyette boş.",
      prompt:
        "tutar, tarih, hesap (ödemede zorunlu, muafiyette boş): hesap için izin verilen: kasa, banka.",
    },
    {
      name: "tarih",
      required: "Ödemede",
      format: { kind: "date" },
      formatText: "tarih",
      example: "2024-09-05",
      help: "Açılış tarihinden önce olamaz. Muafiyette boş.",
      prompt: "",
    },
    {
      name: "hesap",
      required: "Ödemede",
      format: { kind: "code", table: ACCOUNT_CODES },
      formatText: "kod",
      example: "banka",
      help: "Muafiyette boş.",
      prompt: "",
    },
    {
      name: "aciklama",
      required: "Muafiyette",
      format: { kind: "text", max: 200 },
      formatText: "≤ 200; muafiyette 3–200",
      example: "Geçmiş dönem borcu silindi",
      help: "Muafiyette nedeni.",
      prompt:
        "aciklama: ödemede isteğe bağlı; muafiyette zorunlu, en az 3 karakter, muafiyetin nedeni.",
    },
  ],
  sample: [
    ["O-20240905-202409-1", "odeme", "ayse.demir@ornek.com", "Eylül 2024", "300", "2024-09-05", "banka", ""],
    ["O-20240908-202409-1", "odeme", "mehmet.kaya@ornek.com", "Eylül 2024", "150", "2024-09-08", "kasa", ""],
    ["O-20241002-202409-1", "odeme", "can.yildiz@ornek.com", "Eylül 2024", "300", "2024-10-02", "banka", "3 aylık ödeme"],
    ["O-20241002-202410-1", "odeme", "can.yildiz@ornek.com", "Ekim 2024", "300", "2024-10-02", "banka", "3 aylık ödeme"],
    ["M-202409-1", "muaf", "zeynep.ak@eski.invalid", "Eylül 2024", "", "", "", reason],
  ],
  rules: [
    "Bir satır = bir kişi, bir dönem, bir ödeme. Birden çok ayı kapsayan ödemeyi her ay için ayrı satıra böl (aynı tarih ve hesap; tutarı aylara dağıt). Tutar aylara tam bölünmüyorsa satırları yazma, Atladıklarım'a yaz.",
    "Bir kişinin bir döneme ödediği toplam, o dönemin tutarını (indirimli üyede indirimli tutarı) geçmesin.",
    "Ayrılış tarihi dönemin başlangıcından önce olan kişiye o dönem için satır yazma; Atladıklarım'a yaz.",
    'Üye listesindeki katılım tarihi dönemin bitişinden sonra olan birinin ödemesini yine de yaz ve sonda "Tarih çelişkisi" başlığıyla listele (portaldaki katılım tarihi çoğu zaman davet günüdür; portal bu satırı 1. adım yapılmadan kabul etmez). Ona muaf satırı yazma. Böyle 3\'ten fazla kişi varsa CSV verme; bana "Önce 1. adımı (Üye geçmişi) yap ve üye listesini yeniden indir" de.',
    'Rolü "sef" olan kişi aidat ödemez; ona satır yazma. Üye listesinde aidat_orani muaf olan kişiye ödeme ya da muaf satırı yazma.',
    'Ödendi işareti (✓, "ödedi", "tamam", "elden", "+") dönemin tutarı demektir: üye listesinde aidat_orani indirimli ise AİDAT DÖNEMLERİ\'ndeki indirimli tutar, değilse tam tutar. Hangisini yazdığını "Tahmin ettiklerim"e ekle.',
    'Ödeme tarihi yoksa dönemin son ödeme gününü yaz ve "Tahmin ettiklerim"e ekle.',
    'Ödemenin hesabı yazmıyorsa CSV vermeden önce bana bir kez sor: "Hesabı yazmayan ödemeler kasa mı, banka mı?" Cevabımı hepsine uygula. Cevap veremezsem o ödemeleri Atladıklarım\'a yaz.',
    'Muaf satırını yalnızca kaynak açıkça söylüyorsa ("muaf", "affedildi", "silindi") ya da ben açıkça istersem yaz. Boş hücreden muafiyet çıkarma: boş hücre "ödemedi" de olabilir, "bilinmiyor" da.',
    'Muafiyet: ben "şu dönemler için ödemeyenleri muaf tut" dersem, o dönemlerin her biri için, o dönemde koroda olup (yukarıdaki kurallar) o döneme HİÇ ödemesi olmayan her kişiye bir muaf satırı yaz. Kısmen ödemiş birine muaf yazma; onu Atladıklarım\'a yaz.',
    "Bu dosya, daha önce aktarılmış bir dosyaya sonradan eklenen kayıtlarsa önceki kayıtların kayit_no'sunu değiştirme; yeni kayıtların kayit_no'sunun başına benim vereceğim etiketi koy (örnek EK1-O-20241002-202409-1). Etiketi vermezsem sor.",
  ],
  live: ["periods"],
  people: true,
  ambiguity: true,
  unit: "bir dönemin satırları",
  example: {
    intro:
      "Kaynak: saymanın notları; üye listesi 1. adımdan sonra yeniden indirildi. Dönemler: Eylül, Ekim, Kasım 2024 (300 / indirimli 150).",
    source: `Eylül 2024: Ayşe 300 (5 Eyl, banka), Mehmet 150 öğrenci (8 Eyl, kasa). Can 2 Ekim'de 900 yatırdı, Eylül-Ekim-Kasım için, banka. Selin Ç. Ekim için 100 verdi (kasa, 15 Eki).
Eylül–Kasım 2024 için ödemeyenler muaf tutulsun (yönetim kararı, Ocak 2025).`,
    csv: [
      "kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama",
      "O-20240905-202409-1;odeme;ayse.demir@ornek.com;Eylül 2024;300;2024-09-05;banka;",
      "O-20240908-202409-1;odeme;mehmet.kaya@ornek.com;Eylül 2024;150;2024-09-08;kasa;",
      "O-20241002-202409-1;odeme;can.yildiz@ornek.com;Eylül 2024;300;2024-10-02;banka;3 aylık ödeme",
      "O-20241002-202410-1;odeme;can.yildiz@ornek.com;Ekim 2024;300;2024-10-02;banka;3 aylık ödeme",
      "O-20241002-202411-1;odeme;can.yildiz@ornek.com;Kasım 2024;300;2024-10-02;banka;3 aylık ödeme",
      "O-20241015-202410-1;odeme;selin.cakir@ornek.com;Ekim 2024;100;2024-10-15;kasa;",
      ...waivers.map(([no, email, period]) => `${no};muaf;${email};${period};;;;${reason}`),
    ].join("\n"),
    report: [
      "**Atladıklarım:** Selin Çakır, Ekim 2024: 100 TL kısmi ödeme var; muaf yazmadım (kısmi ödemeli döneme muafiyet verilemez). Kalanı nasıl kapatacağına sen karar ver. Burak Öztürk: 15.01.2024'te ayrılmış; bu dönemlerden sorumlu değil. Deniz Arslan: koro şefi; aidat yok.",
      "**Tahmin ettiklerim:** Can'ın 900 TL'sini üç aya 300'er böldüm.",
    ],
    teaches:
      "Bu örnek şunları gösterir: birkaç aylık ödemenin bölünmesi, indirimli üye, muafiyet kuralı (Elif 1 Ekim'de katıldığı için Eylül'de yok; Burak ve koro şefi hiç yok) ve kısmi ödemenin muafiyeti engellemesi.",
  },
  moreExamples: [
    {
      title: "İkinci örnek: işaretli aidat tablosu",
      intro:
        'Kaynak: saymanın işaretli tablosu; tarih ve hesap çoğu hücrede yok. Talimat AİDAT DÖNEMLERİ\'nde Eylül, Ekim, Kasım 2024\'ü (tam 300, indirimli 150) listeliyor; üye listesinde Mehmet\'in aidat_orani indirimli. Yapay zekâ önce hesabı sordu, cevap: "Elden olanlar kasa, gerisi banka."',
      source: `Ad Soyad      | Eyl                     | Eki   | Kas
Ayşe Demir    | ✓                       | ✓     |
Mehmet Kaya   | 150                     | elden |
Can Yıldız    | 900 (3 ay, havale 2.10) |       |`,
      csv: [
        "kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama",
        "O-20240910-202409-1;odeme;ayse.demir@ornek.com;Eylül 2024;300;2024-09-10;banka;",
        "O-20240910-202409-2;odeme;mehmet.kaya@ornek.com;Eylül 2024;150;2024-09-10;banka;",
        "O-20241002-202409-1;odeme;can.yildiz@ornek.com;Eylül 2024;300;2024-10-02;banka;3 aylık ödeme",
        "O-20241010-202410-1;odeme;ayse.demir@ornek.com;Ekim 2024;300;2024-10-10;banka;",
        "O-20241010-202410-2;odeme;mehmet.kaya@ornek.com;Ekim 2024;150;2024-10-10;kasa;",
        "O-20241002-202410-1;odeme;can.yildiz@ornek.com;Ekim 2024;300;2024-10-02;banka;3 aylık ödeme",
        "O-20241002-202411-1;odeme;can.yildiz@ornek.com;Kasım 2024;300;2024-10-02;banka;3 aylık ödeme",
      ].join("\n"),
      report: [
        "**Atladıklarım:** Kasım 2024'te Ayşe ve Mehmet'in hücresi boş; ödemedi mi, bilinmiyor mu belli değil, muaf yazmadım.",
        "**Tahmin ettiklerim:** ✓ ve \"elden\" dönemin tutarı: Ayşe tam (300), Mehmet indirimli (150). Tarihi olmayan ödemelere dönemin son ödeme gününü yazdım (10 Eylül, 10 Ekim). Hesap: senin cevabınla elden olan kasa, gerisi banka. Can'ın 900 TL'sini üç aya 300'er böldüm; havale 2 Ekim.",
      ],
      teaches:
        "Bu örnek şunları gösterir: ✓ ve \"elden\" işaretinin üyenin oranına göre tutara çevrilmesi, eksik tarihe son ödeme günü, eksik hesap için bir kez sorulması, boş hücreden muafiyet çıkarılmaması ve dönemlere bölünse de değişmeyen kayit_no.",
    },
  ],
  links: [
    { label: "Aidat", href: "/finans/aidat" },
    { label: "Finans raporu", href: "/finans/rapor" },
  ],
  notes: [
    "Ödeme, Aidat sayfasındaki Ödeme al ile aynı kaydı oluşturur. Muafiyet, Muaf tut ile aynıdır. Elle verilmiş bir muafiyet zaten varsa satır değişmeyecek sayılır.",
    "Kontrol sonrası Kasa ve Banka bakiyelerinin aktarımdan önceki ve sonraki hâlini görürsün; şimdi banka ekstrenle tutmalı.",
    "Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir, portaldaki aidat dönemlerini tarihleri ve tutarlarıyla talimata kendisi yazar. Bu dosyadaki talimatta onların yerinde, ne yazacağını anlatan bir satır durur.",
    "Portaldaki katılım tarihi, kişinin portala davet edildiği gündür. Daha eski ödemeleri aktarmadan önce 1. adımı (Üye geçmişi) yap; yoksa o ödemeler reddedilir.",
  ],
};
