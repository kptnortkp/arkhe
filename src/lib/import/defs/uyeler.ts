import { DUES_RATE_CODES, VOICE_PART_CODES } from "../codes";
import type { ImportDef } from "../def";

export const uyeler: ImportDef = {
  slug: "uyeler",
  step: 1,
  kind: "members",
  title: "Üye geçmişi",
  summary: "Katılım ve ayrılış tarihleri, eski üyeler.",
  explanation:
    'Üyelerin katılım ve ayrılış tarihlerini düzeltir, ayrılmış eski üyeleri ekler. Boş hücre "değiştirme" demektir. Eski üyeler portala giriş yapamaz.',
  columns: [
    {
      name: "eposta",
      required: true,
      format: { kind: "email" },
      formatText: "e-posta",
      example: "ayse.demir@ornek.com",
      help: "Portaldaki kişiyle eşleştirir. Eski üyenin adresi bilinmiyorsa `ad.soyad@eski.invalid`.",
      prompt: "eposta (zorunlu): kişinin e-postası.",
    },
    {
      name: "ad",
      required: "Eski üyede",
      format: { kind: "name" },
      formatText: "2–80 karakter",
      example: "Ayşe Demir",
      help: "Portaldaki kişide yalnızca kontrol edilir; farklıysa uyarı çıkar, ad değişmez.",
      prompt:
        "ad (eski üyede zorunlu): kayıtlarımdaki adı, olduğu gibi. Üye listesindeki adı kopyalama; portal ikisini karşılaştırıp farkları bana gösterecek.",
    },
    {
      name: "katilim_tarihi",
      required: "Eski üyede",
      format: { kind: "date" },
      formatText: "tarih",
      example: "2019-09-01",
      help: "Koroya ilk geldiği gün.",
      prompt: "katilim_tarihi (eski üyede zorunlu): koroya ilk geldiği gün.",
    },
    {
      name: "ayrilis_tarihi",
      required: "Eski üyede",
      format: { kind: "date" },
      formatText: "tarih",
      example: "2024-01-15",
      help: "Koroda son günü. **Aktif bir üyeye yazılırsa o kişi pasifleşir.** Boş bırakmak kimseyi geri getirmez.",
      prompt: "ayrilis_tarihi (eski üyede zorunlu): koroda son günü.",
    },
    {
      name: "partisyon",
      required: "Eski üyede",
      format: { kind: "code", table: VOICE_PART_CODES },
      formatText: "kod",
      example: "alto",
      help: "Bugünkü partisyon. Portalda olan kişide değiştirmek istemiyorsan boş bırak.",
      prompt:
        "partisyon (eski üyede zorunlu): İzin verilen: soprano, alto, tenor, bas. (Sop → soprano, Bass → bas.)",
    },
    {
      name: "aidat_orani",
      required: false,
      format: { kind: "code", table: DUES_RATE_CODES },
      formatText: "kod",
      example: "indirimli",
      help: "Bugünkü aidat oranı; tüm dönemlere uygulanır. Değiştirmeyeceksen boş bırak.",
      prompt: "aidat_orani (isteğe bağlı): İzin verilen: tam, indirimli, muaf.",
    },
  ],
  sample: [
    ["ayse.demir@ornek.com", "Ayşe Demir", "2019-09-01", "", "", ""],
    ["mehmet.kaya@ornek.com", "Mehmet Kaya", "2021-02-12", "", "", "indirimli"],
    ["can.yildiz@ornek.com", "Can Yıldız", "2022-09-15", "", "", ""],
    ["zeynep.ak@eski.invalid", "Zeynep Ak", "2018-09-01", "2025-01-31", "soprano", ""],
    ["burak.ozturk@eski.invalid", "Burak Öztürk", "2022-10-03", "2024-01-15", "bas", ""],
  ],
  rules: [
    'Ekteki üye listesindeki her kişi için kayıtlarımda bir katılım tarihi varsa bir satır yaz. Yalnızca bildiğin sütunları doldur; boş hücre "değiştirme" demektir.',
    'Üye listesinde olan kişilerde partisyon ve aidat_orani sütunlarını BOŞ bırak. Eski kayıttaki partisyon bugünkünü bozar. Yalnızca ben açıkça "bugünkü partisyonu/oranı değiştir" dersem doldur.',
    'ayrilis_tarihi\'ni yalnızca koroyu gerçekten bırakmış biri için yaz. Üye listesinde durumu "aktif" olan birine ayrılış tarihi yazarsan o kişi portaldan çıkarılır. Böyle her kişiyi sonda ayrıca "Pasifleşecekler" başlığıyla listele.',
    "Kayıtlarımda olup üye listesinde olmayan, ayrılmış kişiler eski üyedir. Onlar için ad, katilim_tarihi, ayrilis_tarihi ve partisyon dördü de gerekli; biri bilinmiyorsa satırı koyma.",
    "Eski üyenin e-postasını bilmiyorsan ad.soyad@eski.invalid yaz: küçük harf, Türkçe harfler sadeleşir (ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u), ad ile soyad arasına nokta. Aynı adlı ikinci kişiye 2 ekle (ayse.kaya2@eski.invalid). Bu adres ileride yoklama ve aidat dosyalarında da kullanılacak.",
    'Yalnızca ay ve yıl biliniyorsa: katılımda ayın 1\'ini, ayrılışta ayın son gününü yaz. Yalnızca sezon biliniyorsa ("2018 güzü"): katılımda 1 Eylül, ayrılışta 30 Haziran. Hepsini "Tahmin ettiklerim"e yaz.',
    "Ayrılıp sonra geri dönen biri için ilk katılım tarihini yaz; şu an korodaysa ayrılış tarihini boş bırak.",
    'Listede rolü "sef" ya da "yonetim" olan kişilerin satırlarını bu CSV\'ye koyma: onları ikinci, ayrı bir kod bloğunda ver ve başına "Koro şefinin aktaracağı satırlar" yaz. Yönetim kurulu bu satırları değiştiremez; değişiklik getirmeyen satırlar sorun çıkarmaz ama geçmiş katılım tarihi her zaman bir değişikliktir. Ben "koro şefiyim" dersem hepsini tek CSV\'de ver.',
  ],
  people: false,
  ambiguity: true,
  unit: "bir kişi",
  example: {
    intro:
      'Kaynak: eski Excel\'in "Korist listesi" sayfasından yapıştırılmış tablo ve Üye listesini indir dosyası. Talimatı koro şefi kullanıyor ve "koro şefiyim" dedi.',
    source: `Ad Soyad       | Ses  | Giriş        | Ayrılış      | Aidat
Ayşe Demir     | Alto | Eylül 2019   |              |
Mehmet Kaya    | Ten  | 12.02.2021   |              | öğrenci (yarım)
Zeynep Ak      | Sop  | 2018 güz     | Ocak 2025    |
Burak Öztürk   | Bas  | 03.10.2022   | 15.01.2024   |
Selin          | Alto | 2020         |              |
Can Yıldız     | Bas  | 15.09.2022   |              |`,
    csv: `eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon;aidat_orani
ayse.demir@ornek.com;Ayşe Demir;2019-09-01;;;
mehmet.kaya@ornek.com;Mehmet Kaya;2021-02-12;;;
zeynep.ak@eski.invalid;Zeynep Ak;2018-09-01;2025-01-31;soprano;
burak.ozturk@eski.invalid;Burak Öztürk;2022-10-03;2024-01-15;bas;
can.yildiz@ornek.com;Can Yıldız;2022-09-15;;;`,
    report: [
      '**Atladıklarım:** "Selin, Alto, 2020": üye listesinde iki Selin var (Selin Çakır, Selin Aydın); hangisi olduğunu bilmiyorum.',
      '**Tahmin ettiklerim:** Ayşe Demir katılım: yalnızca "Eylül 2019", 2019-09-01 yazdım. Zeynep Ak katılım: "2018 güz", 2018-09-01; ayrılış: "Ocak 2025", 2025-01-31. Mehmet Kaya: kayıtta "öğrenci (yarım)" yazıyor; bugünkü oranı bilmediğim için aidat_orani\'nı boş bıraktım. İndirimliyse söyle, ekleyeyim.',
      "**Pasifleşecekler:** yok.",
      '**Koro şefinin aktaracağı satırlar:** Can Yıldız (yonetim). "Koro şefiyim" dediğin için ayrı blok yerine bu CSV\'ye koydum; yönetim kurulundan biri aktarsaydı bu satır ikinci bir kod bloğuna giderdi.',
    ],
    teaches:
      "Bu örnek şunları gösterir: yalnızca ayı bilinen tarihler, sezon tahmini, uydurulmuş `@eski.invalid` adresli eski üye, portaldaki kişilerde boş partisyon ve oran, belirsiz bir adın atlanması ve yönetim satırı uyarısı.",
  },
  links: [
    { label: "Üyeler", href: "/uyeler" },
    { label: "Aidat", href: "/finans/aidat" },
  ],
  notes: [
    "Boş hücre hiçbir şeyi değiştirmez. Boş `ayrilis_tarihi` kimseyi yeniden aktif yapmaz; bunu Üyeler sayfasından elle yaparsın.",
    "Yönetim kurulu yalnızca korist satırlarını değiştirebilir; şef ve yönetim üyelerinin satırlarını koro şefi aktarır. Değişiklik getirmeyen bir yönetim satırı sorun çıkarmaz, ama geçmiş bir katılım tarihi her zaman değişikliktir. Talimat bu yüzden o satırları ikinci bir kod bloğuna ayırır: onu koro şefine ver.",
  ],
};
