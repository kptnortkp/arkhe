import { REHEARSAL_TYPE_CODES, STATUS_CODES, VOICE_PART_CODES } from "../codes";
import type { ImportDef } from "../def";

export const yoklama: ImportDef = {
  slug: "yoklama",
  step: 3,
  kind: "attendance",
  title: "Çalışmalar ve yoklama",
  summary: "Geçmiş çalışmalar ve kimin geldiği.",
  explanation:
    "Geçmiş çalışmaları kapanmış hâlde, yoklamalarıyla oluşturur. Listede olmayan beklenen kişiler Gelmedi sayılır.",
  columns: [
    {
      name: "tarih",
      required: true,
      format: { kind: "date" },
      formatText: "tarih",
      example: "2024-10-08",
      help: "Çalışmanın günü.",
      prompt: "tarih (zorunlu): çalışmanın günü.",
    },
    {
      name: "baslangic",
      required: false,
      format: { kind: "time" },
      formatText: "saat, varsayılan `19:00`",
      example: "19:00",
      help: "Aynı gün iki çalışma varsa farklı olmalı. Boşsa aynı gün içinde kendinden önceki çalışmaya sayılır.",
      prompt:
        "baslangic, bitis (isteğe bağlı): saat. Bilinmiyorsa boş bırak; portal 19:00–22:00 kabul eder. Aynı gün iki çalışma varsa ikisinin baslangic'ı farklı ve dolu olsun.",
    },
    {
      name: "bitis",
      required: false,
      format: { kind: "time" },
      formatText: "saat, varsayılan `22:00`",
      example: "22:00",
      help: "Başlangıçtan sonra.",
      prompt: "",
    },
    {
      name: "tur",
      required: false,
      format: { kind: "code", table: REHEARSAL_TYPE_CODES },
      formatText: "kod, varsayılan `tutti`",
      example: "tutti",
      help: "",
      prompt:
        "tur (isteğe bağlı): İzin verilen: tutti (bütün koro, varsayılan), partisyon (yalnız bazı partiler), genel_prova, konser.",
    },
    {
      name: "partiler",
      required: "Partisyonda",
      format: { kind: "codes", table: VOICE_PART_CODES },
      formatText: "`+` ile birleşik",
      example: "soprano+alto",
      help: "Yalnızca `partisyon` türünde, orada zorunlu.",
      prompt:
        "partiler: yalnızca tur partisyon ise ve orada zorunlu; partileri + ile birleştir. İzin verilen: soprano, alto, tenor, bas (örnek soprano+alto).",
    },
    {
      name: "baslik",
      required: false,
      format: { kind: "text", max: 80 },
      formatText: "≤ 80 karakter",
      example: "Bahar konseri provası",
      help: "",
      prompt: "baslik, yer (isteğe bağlı): kaynakta varsa.",
    },
    {
      name: "yer",
      required: false,
      format: { kind: "text", max: 120 },
      formatText: "≤ 120 karakter",
      example: "Mülkiye Salonu",
      help: "",
      prompt: "",
    },
    {
      name: "eposta",
      required: true,
      format: { kind: "email" },
      formatText: "e-posta",
      allowedText: "üye listesindeki adresler",
      example: "ayse.demir@ornek.com",
      help: "Eski üyeler `@eski.invalid` adresleriyle.",
      prompt: "eposta (zorunlu): kişinin e-postası (KİŞİLER kurallarına bak).",
    },
    {
      name: "durum",
      required: true,
      format: { kind: "code", table: STATUS_CODES },
      formatText: "kod",
      allowedText: "`geldi`, `gec_geldi` (ya da `gec`), `mazeretli`, `gelmedi`",
      example: "geldi",
      help: "Listede olmayan beklenen kişiler `gelmedi` sayılır.",
      prompt:
        "durum (zorunlu): İzin verilen: geldi, gec_geldi (geç geldi), mazeretli (izinli, raporlu, haber verdi), gelmedi.",
    },
    {
      name: "not",
      required: false,
      format: { kind: "text", max: 200 },
      formatText: "≤ 200 karakter",
      example: "Sınav haftası",
      help: "Yalnızca `mazeretli` satırda.",
      prompt: "not (isteğe bağlı): yalnızca mazeretli satırda, mazeretin kısa nedeni.",
    },
  ],
  sample: [
    ["2024-10-08", "19:00", "22:00", "tutti", "", "", "Mülkiye Salonu", "ayse.demir@ornek.com", "geldi", ""],
    ["2024-10-08", "", "", "", "", "", "", "mehmet.kaya@ornek.com", "gec_geldi", ""],
    ["2024-10-08", "", "", "", "", "", "", "zeynep.ak@eski.invalid", "mazeretli", "Sınav haftası"],
    ["10.10.2024", "20:00", "21:30", "partisyon", "soprano+alto", "", "", "ayse.demir@ornek.com", "geldi", ""],
  ],
  rules: [
    "Bir kişi bir çalışmada bir satır. Aynı çalışmanın satırlarını alt alta yaz.",
    "Çalışmanın bilgilerini (baslangic, bitis, tur, partiler, baslik, yer) yalnızca o çalışmanın İLK satırına yaz; sonraki satırlarda boş bırak.",
    '"gelmedi" satırı yazman gerekmez: listede olmayan, o gün koroda olan herkes Gelmedi sayılır. Kaynak yalnızca gelmeyenleri işaretliyorsa, o tarihte üye olan herkesi (üye listesindeki katılım ve ayrılış tarihine göre; partisyonda yalnızca o partilerdekileri) geldi yaz, işaretlileri gelmedi.',
    "O tarihten önce ayrılmış birini (üye listesindeki ayrilis_tarihi kaydın tarihinden önce) ya da partisyonda başka partideki birini yazma; portal reddeder. Kaynakta böyle biri varsa Atladıklarım'a yaz.",
    'Üye listesindeki katilim_tarihi kaydın tarihinden sonra olan birinin satırını yine de yaz ve sonda "Tarih çelişkisi" başlığıyla listele (portaldaki katılım tarihi çoğu zaman davet günüdür; portal bu satırı 1. adım yapılmadan kabul etmez). Böyle 3\'ten fazla kişi varsa CSV verme; bana "Önce 1. adımı (Üye geçmişi) yap ve üye listesini yeniden indir" de.',
    "Gelecekteki ya da bugün bitmemiş çalışmayı yazma.",
  ],
  people: true,
  ambiguity: true,
  unit: "bir çalışmanın satırları",
  example: {
    intro: "Kaynak: yoklama defterinin fotoğrafı, yapay zekânın okuduğu hâliyle.",
    source: `8 Ekim Salı — Mülkiye Salonu — tutti
  Ayşe ✓   Mehmet geç   Zeynep izinli (sınav)   Can ✓   Elif ✓   Deniz hoca
10 Ekim Perş. 20.00–21.30 — sop+alto partisyon
  Ayşe ✓   Elif ✓   Zeynep yok   Selin Ç. ✓`,
    csv: `tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not
2024-10-08;;;tutti;;;Mülkiye Salonu;ayse.demir@ornek.com;geldi;
2024-10-08;;;;;;;mehmet.kaya@ornek.com;gec_geldi;
2024-10-08;;;;;;;zeynep.ak@eski.invalid;mazeretli;Sınav
2024-10-08;;;;;;;can.yildiz@ornek.com;geldi;
2024-10-08;;;;;;;elif.sahin@ornek.com;geldi;
2024-10-10;20:00;21:30;partisyon;soprano+alto;;;ayse.demir@ornek.com;geldi;
2024-10-10;;;;;;;elif.sahin@ornek.com;geldi;
2024-10-10;;;;;;;zeynep.ak@eski.invalid;gelmedi;
2024-10-10;;;;;;;selin.cakir@ornek.com;geldi;`,
    report: [
      '**Atladıklarım:** 8 Ekim "Deniz hoca": koro şefi (Deniz Arslan), yoklamaya yazılmaz.',
      '**Tahmin ettiklerim:** yıl 2024 (defter kapağından). 8 Ekim\'in saati yok; boş bıraktım (19:00–22:00 sayılır). "Selin Ç." → Selin Çakır (listede soyadı Ç ile başlayan tek Selin).',
    ],
    teaches:
      "Bu örnek şunları gösterir: boş bırakılıp ilk satırdan alınan hücreler, varsayılan saatler, `izinli` → `mazeretli` ve not, koro şefinin yazılmaması, `yok` → `gelmedi`, `+` ile partisyon ve yeniden indirilen üye listesinden alınan Zeynep adresi.",
  },
  links: [
    { label: "Çalışmalar", href: "/calismalar?sekme=gecmis" },
    { label: "Raporlar", href: "/raporlar" },
  ],
  notes: [
    "Aynı günün sonraki satırlarında saati boş bırakabilirsin; satır, aynı gün içinde kendinden önceki çalışmaya sayılır. Aynı gün iki çalışma varsa ikincisinin ilk satırına saati mutlaka yaz.",
    "Çalışmalar kapanmış olarak oluşturulur. Dosyada olmayan ama o gün koroda olan herkes (katılım ve ayrılış tarihine, partisyonda partisine göre) Gelmedi sayılır. Bu yüzden önce Üye geçmişi'ni aktar.",
    "Portaldaki katılım tarihi, kişinin portala davet edildiği gündür. Daha eski yoklamaları aktarmadan önce 1. adımı (Üye geçmişi) yap; yoksa o satırlar reddedilir.",
    "Portalda elle girilmiş bir çalışmanın yoklaması bu dosyayla değiştirilmez; onu çalışmanın sayfasından düzeltirsin.",
  ],
};
