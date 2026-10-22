import { ACCOUNT_CODES, CATEGORY_CODES, CATEGORY_DOC_CODES, ENTRY_KIND_CODES, EXPENSE_CODES, INCOME_CODES } from "../codes";
import type { ImportDef } from "../def";

const list = (codes: readonly string[]) => codes.map((c) => `\`${c}\``).join(", ");

export const hareketler: ImportDef = {
  slug: "hareketler",
  step: 4,
  kind: "entries",
  title: "Finans hareketleri",
  summary: "Gelir, gider ve virmanlar (aidat hariç).",
  explanation:
    "Gelir, gider ve virmanları ekler. Aidat ödemeleri 6. adımda, kişi ve dönemle birlikte aktarılır.",
  columns: [
    {
      name: "kayit_no",
      required: true,
      format: { kind: "recordNo" },
      formatText: "1–40, harf, rakam, `- _ . /`",
      example: "20240905-1",
      help: "Her satırda farklı. Tarih + o günün sırası.",
      prompt:
        "kayit_no (zorunlu): her satıra farklı bir numara. Biçim: tarihin rakamları + tire + o günün kaçıncı kaydı olduğu (2024-09-05'in ikinci kaydı: 20240905-2). Yalnızca harf, rakam ve - _ . / kullan.",
    },
    {
      name: "tarih",
      required: true,
      format: { kind: "date" },
      formatText: "tarih",
      example: "2024-09-05",
      help: "Açılış tarihinden önce olamaz.",
      prompt: "tarih (zorunlu).",
    },
    {
      name: "tur",
      required: true,
      format: { kind: "code", table: ENTRY_KIND_CODES },
      formatText: "kod",
      example: "gider",
      help: "Virman: kasa ile banka arası para aktarma.",
      prompt:
        "tur (zorunlu): İzin verilen: gelir, gider, virman (kasa ile banka arasında para aktarma: bankadan nakit çekme, kasadaki parayı bankaya yatırma).",
    },
    {
      name: "kategori",
      required: "Gelir ve giderde",
      format: { kind: "code", table: CATEGORY_CODES, codes: CATEGORY_DOC_CODES },
      formatText: "kod",
      allowedText: `Gelir: ${list(INCOME_CODES)}. Gider: ${list(EXPENSE_CODES)}`,
      example: "salon_mekan",
      help: "Virmanda boş. `aidat` burada kullanılmaz (6. adım).",
      prompt: `kategori (gelir ve giderde zorunlu, virmanda boş):
  Gelir için: sponsorluk, bilet_satisi, bagis (bağış), hibe_destek (hibe, belediye/vakıf desteği), diger_gelir.
  Gider için: kostum, salon_mekan (salon, prova yeri kirası), sef_korrepetitor_ucreti (şef, piyanist, korrepetitör ücreti), nota_ve_telif, ulasim_ve_konaklama (otobüs, uçak, otel), festival_katilim_ucreti, organizasyon_tanitim (afiş, basım, reklam), ikram (çay, simit, pasta), iade, banka_masrafi (havale/EFT ücreti, hesap ücreti), diger_gider.
  Emin değilsen diger_gelir ya da diger_gider yaz ve "Tahmin ettiklerim"e ekle.`,
    },
    {
      name: "tutar",
      required: true,
      format: { kind: "amount" },
      formatText: "tutar",
      example: "1500",
      help: "`1250,50` biçiminde; binlik ayırıcı, ₺ ve eksi yok.",
      prompt:
        "tutar (zorunlu): her zaman artı. Gider olduğunu tur söyler; kaynakta eksi işaretli ya da parantezli tutarı gider say, işareti kaldır.",
    },
    {
      name: "hesap",
      required: true,
      format: { kind: "code", table: ACCOUNT_CODES },
      formatText: "kod",
      example: "banka",
      help: "Virmanda paranın çıktığı hesap.",
      prompt: "hesap (zorunlu): İzin verilen: kasa (nakit), banka. Virmanda paranın ÇIKTIĞI hesap.",
    },
    {
      name: "hedef_hesap",
      required: "Virmanda",
      format: { kind: "code", table: ACCOUNT_CODES },
      formatText: "kod",
      example: "kasa",
      help: "Yalnızca virmanda; `hesap`'tan farklı.",
      prompt:
        "hedef_hesap (yalnızca virmanda zorunlu): İzin verilen: kasa, banka; paranın GİRDİĞİ hesap, hesap'tan farklı.",
    },
    {
      name: "aciklama",
      required: false,
      format: { kind: "text", max: 200 },
      formatText: "≤ 200 karakter",
      example: "Salon kirası Eylül",
      help: "",
      prompt: "aciklama, karsi_taraf (isteğe bağlı): kaynaktaki açıklama ve kimden/kime.",
    },
    {
      name: "karsi_taraf",
      required: false,
      format: { kind: "text", max: 120 },
      formatText: "≤ 120 karakter",
      example: "Mülkiye Vakfı",
      help: "Parayı ödeyen ya da alan.",
      prompt: "",
    },
    {
      name: "sponsor",
      required: "Sponsorlukta",
      format: { kind: "text", max: 120 },
      formatText: "≤ 120 karakter",
      example: "Kaya Matbaa",
      help: "Portalda yoksa oluşturulur. Başka kategoride boş.",
      prompt: "sponsor (yalnızca kategori sponsorluk ise zorunlu): sponsor firmanın adı.",
    },
    {
      name: "etkinlik",
      required: false,
      format: { kind: "text", max: 80 },
      formatText: "portaldaki etkinliğin adı",
      example: "Bahar Konseri 2025",
      help: "Yalnızca portalda olan bir etkinlik.",
      prompt:
        "etkinlik (isteğe bağlı): yalnızca ETKİNLİKLER listesindeki bir ad, aynen. Listede yoksa boş bırak.",
    },
    {
      name: "belge_linki",
      required: false,
      format: { kind: "url" },
      formatText: "`https://…`",
      example: "https://drive.google.com/…",
      help: "Fiş ya da fatura bağlantısı.",
      prompt: "belge_linki (isteğe bağlı): https:// ile başlayan bağlantı.",
    },
  ],
  sample: [
    ["20240905-1", "2024-09-05", "gider", "salon_mekan", "1500", "banka", "", "Salon kirası Eylül", "Mülkiye Vakfı", "", "", "https://drive.google.com/file/d/ornekbelge1/view"],
    ["20240905-2", "2024-09-05", "gider", "ikram", "185,50", "kasa", "", "Prova çay-simit", "", "", "", ""],
    ["20240912-1", "2024-09-12", "gelir", "sponsorluk", "5000", "banka", "", "Sponsorluk", "", "Kaya Matbaa", "", ""],
    ["20240914-1", "2024-09-14", "virman", "", "2000", "banka", "kasa", "Bankadan nakit çekildi", "", "", "", ""],
  ],
  rules: [
    'Aidat ödemelerini bu dosyaya KOYMA. Onları Atladıklarım\'da "Aidat (6. adımda aktarılacak)" başlığıyla, tarih, kişi ve tutarla listele.',
    '"Devreden", "devir", "açılış" ya da "önceki yıldan kalan" satırlarını hareket olarak yazma. Onları sonda "Açılış bakiyesi" başlığıyla tarih, kasa ve banka tutarı olarak yaz.',
    "Bir satırda hem gelir hem gider varsa iki ayrı satır yaz.",
    'Ara toplamları, bakiye sütununu ve "toplam" satırlarını yazma.',
    'Kaynakta hesap bilgisi yoksa (tek bir tutar sütunu var, kasa ya da banka yazmıyor) CSV vermeden önce bana bir kez sor: "Hesabı yazmayan kayıtlar banka mı, kasa mı, yoksa hangi sütundan anlaşılıyor?" Cevabımı hepsine uygula. Uydurma.',
    "Bir günün kayıtlarını kaynaktaki sırayla numaralandır; aynı kaynak her seferinde aynı numaraları vermeli. Bu dosya, daha önce aktarılmış bir dosyaya sonradan eklenen kayıtlarsa önceki kayıtların kayit_no'sunu değiştirme; yeni kayıtların kayit_no'sunun başına benim vereceğim etiketi koy (örnek EK1-20240905-1). Etiketi vermezsem sor.",
  ],
  live: ["events", "firstHandEntry"],
  people: false,
  ambiguity: false,
  unit: "aynı günün kayıtları",
  example: {
    intro: "Kaynak: saymanın Excel defteri, yapıştırılmış hâliyle.",
    source: `Tarih      | Açıklama                              | Gelir    | Gider    | Hesap  | Bakiye
01.09.2024 | Devreden                              |          |          |        | Kasa 1.200 / Banka 15.300
05.09.2024 | Salon kirası Eylül – Mülkiye Vakfı    |          | 1.500,00 | Banka  |
05.09.2024 | Prova çay-simit                       |          | 185,50   | Kasa   |
12.09.2024 | Kaya Matbaa sponsorluk                | 5.000,00 |          | Banka  |
14.09.2024 | Bankadan nakit çekildi                |          | 2.000    | Banka  |
20.09.2024 | Eylül aidatları (Ayşe, Mehmet)        | 450,00   |          | Banka  |
30.09.2024 | EFT masrafı                           |          | (8,50)   | Banka  |`,
    csv: `kayit_no;tarih;tur;kategori;tutar;hesap;hedef_hesap;aciklama;karsi_taraf;sponsor;etkinlik;belge_linki
20240905-1;2024-09-05;gider;salon_mekan;1500;banka;;Salon kirası Eylül;Mülkiye Vakfı;;;
20240905-2;2024-09-05;gider;ikram;185,50;kasa;;Prova çay-simit;;;;
20240912-1;2024-09-12;gelir;sponsorluk;5000;banka;;Sponsorluk;;Kaya Matbaa;;
20240914-1;2024-09-14;virman;;2000;banka;kasa;Bankadan nakit çekildi;;;;
20240930-1;2024-09-30;gider;banka_masrafi;8,50;banka;;EFT masrafı;;;;`,
    report: [
      '**Atladıklarım:** Aidat (6. adımda aktarılacak): 2024-09-20, "Eylül aidatları (Ayşe, Mehmet)", 450,00, banka. Kişi başı tutarlar aidat dosyasında ayrı satır olmalı.',
      "**Açılış bakiyesi:** 2024-09-01, kasa 1200, banka 15300. Finans › Ayarlar'a gir.",
      '**Tahmin ettiklerim:** 14.09 "Bankadan nakit çekildi" gider sütununda ama bir harcama değil, bankadan kasaya virman olarak yazdım.',
    ],
    teaches:
      "Bu örnek şunları gösterir: kaldırılan binlik ayırıcı (`1.500,00` → `1500`), parantezli eksi tutar, gider sütunundan tanınan virman, yeni sponsor, ayrılan aidatlar, ayrılan devreden satırı ve tarihten kurulan `kayit_no`.",
  },
  links: [
    { label: "Hareketler", href: "/finans/hareketler" },
    { label: "Finans raporu", href: "/finans/rapor" },
  ],
  notes: [
    "Geçmişi aktarıyorsan açılış bakiyesi, kayıtlarının başladığı günün kasa ve banka bakiyesidir, bugünkü bakiye değil. Yoksa para iki kez sayılır. Açılış tarihinden önceki satırlar reddedilir.",
    "`kayit_no` aynı içerikle yeniden yüklenirse değişmeyecek sayılır; farklı içerikle yüklenirse hata verir.",
    "Kontrol sonrası Kasa ve Banka bakiyelerinin aktarımdan önceki ve sonraki hâlini görürsün. Aidat ödemeleri 6. adımda eklenince bakiye artar.",
    "Portalda zaten elle girilmiş hareketleri dosyaya koyma; yoksa para iki kez sayılır. Kontrol, portalda aynı gün, kategori ve tutarda elle girilmiş bir hareket bulursa Dikkat altında söyler.",
    "Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir, portaldaki etkinlik adlarını ve elle girilmiş ilk hareketin tarihini talimata kendisi yazar. Bu dosyadaki talimatta onların yerinde, ne yazacağını anlatan bir satır durur.",
  ],
};
