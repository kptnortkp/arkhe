# 4 · Finans hareketleri

Gelir, gider ve virmanları ekler. Aidat ödemeleri 6. adımda, kişi ve dönemle birlikte aktarılır.

Başlık satırı:

```
kayit_no;tarih;tur;kategori;tutar;hesap;hedef_hesap;aciklama;karsi_taraf;sponsor;etkinlik;belge_linki
```

## Sütunlar

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `kayit_no` | Evet | 1–40, harf, rakam, `- _ . /` | — | `20240905-1` | Her satırda farklı. Tarih + o günün sırası. |
| `tarih` | Evet | tarih | — | `2024-09-05` | Açılış tarihinden önce olamaz. |
| `tur` | Evet | kod | `gelir`, `gider`, `virman` | `gider` | Virman: kasa ile banka arası para aktarma. |
| `kategori` | Gelir ve giderde | kod | Gelir: `sponsorluk`, `bilet_satisi`, `bagis`, `hibe_destek`, `diger_gelir`. Gider: `kostum`, `salon_mekan`, `sef_korrepetitor_ucreti`, `nota_ve_telif`, `ulasim_ve_konaklama`, `festival_katilim_ucreti`, `organizasyon_tanitim`, `ikram`, `iade`, `banka_masrafi`, `diger_gider` | `salon_mekan` | Virmanda boş. `aidat` burada kullanılmaz (6. adım). |
| `tutar` | Evet | tutar | — | `1500` | `1250,50` biçiminde; binlik ayırıcı, ₺ ve eksi yok. |
| `hesap` | Evet | kod | `kasa`, `banka` | `banka` | Virmanda paranın çıktığı hesap. |
| `hedef_hesap` | Virmanda | kod | `kasa`, `banka` | `kasa` | Yalnızca virmanda; `hesap`'tan farklı. |
| `aciklama` | Hayır | ≤ 200 karakter | — | `Salon kirası Eylül` |   |
| `karsi_taraf` | Hayır | ≤ 120 karakter | — | `Mülkiye Vakfı` | Parayı ödeyen ya da alan. |
| `sponsor` | Sponsorlukta | ≤ 120 karakter | — | `Kaya Matbaa` | Portalda yoksa oluşturulur. Başka kategoride boş. |
| `etkinlik` | Hayır | portaldaki etkinliğin adı | — | `Bahar Konseri 2025` | Yalnızca portalda olan bir etkinlik. |
| `belge_linki` | Hayır | `https://…` | — | `https://drive.google.com/…` | Fiş ya da fatura bağlantısı. |

Geçmişi aktarıyorsan açılış bakiyesi, kayıtlarının başladığı günün kasa ve banka bakiyesidir, bugünkü bakiye değil. Yoksa para iki kez sayılır. Açılış tarihinden önceki satırlar reddedilir.

`kayit_no` aynı içerikle yeniden yüklenirse değişmeyecek sayılır; farklı içerikle yüklenirse hata verir.

Kontrol sonrası Kasa ve Banka bakiyelerinin aktarımdan önceki ve sonraki hâlini görürsün. Aidat ödemeleri 6. adımda eklenince bakiye artar.

Portalda zaten elle girilmiş hareketleri dosyaya koyma; yoksa para iki kez sayılır. Kontrol, portalda aynı gün, kategori ve tutarda elle girilmiş bir hareket bulursa Dikkat altında söyler.

Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir, portaldaki etkinlik adlarını ve elle girilmiş ilk hareketin tarihini talimata kendisi yazar. Bu dosyadaki talimatta onların yerinde, ne yazacağını anlatan bir satır durur.

## Yapay zekâ talimatı

Aşağıdaki metni olduğu gibi yeni bir yapay zekâ sohbetine yapıştır (portalda: Yapay zekâ talimatını kopyala), sonra kayıtlarını ekle.

```text
Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "Finans hareketleri" içe aktarma dosyasına çevir.

ÇIKTI
- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "4-hareketler.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.
- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.
- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:
kayit_no;tarih;tur;kategori;tutar;hesap;hedef_hesap;aciklama;karsi_taraf;sponsor;etkinlik;belge_linki
- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.
- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; aynı günün kayıtları iki parçaya bölünmesin).

BİÇİMLER
- Tarih: YYYY-AA-GG (örnek 2024-10-08). 08/10/2024, 8 Ekim 2024 ya da 24-10-08 yazma.
- Saat: SS:DD, 24 saat (örnek 19:00).
- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.
- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.

SÜTUNLAR
- kayit_no (zorunlu): her satıra farklı bir numara. Biçim: tarihin rakamları + tire + o günün kaçıncı kaydı olduğu (2024-09-05'in ikinci kaydı: 20240905-2). Yalnızca harf, rakam ve - _ . / kullan.
- tarih (zorunlu).
- tur (zorunlu): İzin verilen: gelir, gider, virman (kasa ile banka arasında para aktarma: bankadan nakit çekme, kasadaki parayı bankaya yatırma).
- kategori (gelir ve giderde zorunlu, virmanda boş):
  Gelir için: sponsorluk, bilet_satisi, bagis (bağış), hibe_destek (hibe, belediye/vakıf desteği), diger_gelir.
  Gider için: kostum, salon_mekan (salon, prova yeri kirası), sef_korrepetitor_ucreti (şef, piyanist, korrepetitör ücreti), nota_ve_telif, ulasim_ve_konaklama (otobüs, uçak, otel), festival_katilim_ucreti, organizasyon_tanitim (afiş, basım, reklam), ikram (çay, simit, pasta), iade, banka_masrafi (havale/EFT ücreti, hesap ücreti), diger_gider.
  Emin değilsen diger_gelir ya da diger_gider yaz ve "Tahmin ettiklerim"e ekle.
- tutar (zorunlu): her zaman artı. Gider olduğunu tur söyler; kaynakta eksi işaretli ya da parantezli tutarı gider say, işareti kaldır.
- hesap (zorunlu): İzin verilen: kasa (nakit), banka. Virmanda paranın ÇIKTIĞI hesap.
- hedef_hesap (yalnızca virmanda zorunlu): İzin verilen: kasa, banka; paranın GİRDİĞİ hesap, hesap'tan farklı.
- aciklama, karsi_taraf (isteğe bağlı): kaynaktaki açıklama ve kimden/kime.
- sponsor (yalnızca kategori sponsorluk ise zorunlu): sponsor firmanın adı.
- etkinlik (isteğe bağlı): yalnızca ETKİNLİKLER listesindeki bir ad, aynen. Listede yoksa boş bırak.
- belge_linki (isteğe bağlı): https:// ile başlayan bağlantı.

ETKİNLİKLER (portalda olanlar; etkinlik sütununa adı aynen yaz)
- <Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir bu listeyi portaldaki verilerle kendisi doldurur. Bu talimatı portalın dışından (docs/ice-aktarma klasöründen) aldıysan bu satırı sil ve yerine Finans › Etkinlikler'deki etkinlik adlarını, her biri bir satırda yaz. Etkinlik yoksa "Portalda etkinlik yok; etkinlik sütununu boş bırak." yaz.>

PORTALDA ELLE GİRİLMİŞ HAREKETLER
- <Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir bu listeyi portaldaki verilerle kendisi doldurur. Bu talimatı portalın dışından (docs/ice-aktarma klasöründen) aldıysan bu satırı sil ve yerine Finans › Hareketler'deki elle girilmiş en eski hareketin (açılış bakiyesi ve aidat hariç) tarihini şu kurala koy: Portalda YYYY-AA-GG tarihinden beri elle girilmiş hareketler var. Yalnızca bu tarihten ÖNCEKİ kayıtları yaz. Bu tarih ve sonrasındaki kayıtları CSV'ye koyma; Atladıklarım'a "portalda zaten girilmiş olabilir" diye yaz. Yoksa para iki kez sayılır. Elle girilmiş hareket yoksa "Portalda elle girilmiş hareket yok." yaz.>

BU DOSYAYA ÖZEL KURALLAR
- Aidat ödemelerini bu dosyaya KOYMA. Onları Atladıklarım'da "Aidat (6. adımda aktarılacak)" başlığıyla, tarih, kişi ve tutarla listele.
- "Devreden", "devir", "açılış" ya da "önceki yıldan kalan" satırlarını hareket olarak yazma. Onları sonda "Açılış bakiyesi" başlığıyla tarih, kasa ve banka tutarı olarak yaz.
- Bir satırda hem gelir hem gider varsa iki ayrı satır yaz.
- Ara toplamları, bakiye sütununu ve "toplam" satırlarını yazma.
- Kaynakta hesap bilgisi yoksa (tek bir tutar sütunu var, kasa ya da banka yazmıyor) CSV vermeden önce bana bir kez sor: "Hesabı yazmayan kayıtlar banka mı, kasa mı, yoksa hangi sütundan anlaşılıyor?" Cevabımı hepsine uygula. Uydurma.
- Bir günün kayıtlarını kaynaktaki sırayla numaralandır; aynı kaynak her seferinde aynı numaraları vermeli. Bu dosya, daha önce aktarılmış bir dosyaya sonradan eklenen kayıtlarsa önceki kayıtların kayit_no'sunu değiştirme; yeni kayıtların kayit_no'sunun başına benim vereceğim etiketi koy (örnek EK1-20240905-1). Etiketi vermezsem sor.

DÜRÜSTLÜK
- Bilmediğin bir değeri uydurma; boş bırak. Zorunlu bir alan bilinmiyorsa o satırı CSV'ye koyma.
- CSV'den sonra, kod bloğunun dışında şu başlıklarla yaz:
  "Atladıklarım": CSV'ye koymadığın her kayıt, kaynaktaki hâliyle ve nedeniyle.
  "Tahmin ettiklerim": yaklaşık yazdığın her değer (örneğin yalnızca ay biliniyordu, ayın 1'ini yazdım).
  Hiçbiri yoksa "Atladığım kayıt yok." yaz.

Kayıtlarım:
(buraya yapıştır ya da dosyayı ekle)
```

## Örnek

Kaynak: saymanın Excel defteri, yapıştırılmış hâliyle.

```
Tarih      | Açıklama                              | Gelir    | Gider    | Hesap  | Bakiye
01.09.2024 | Devreden                              |          |          |        | Kasa 1.200 / Banka 15.300
05.09.2024 | Salon kirası Eylül – Mülkiye Vakfı    |          | 1.500,00 | Banka  |
05.09.2024 | Prova çay-simit                       |          | 185,50   | Kasa   |
12.09.2024 | Kaya Matbaa sponsorluk                | 5.000,00 |          | Banka  |
14.09.2024 | Bankadan nakit çekildi                |          | 2.000    | Banka  |
20.09.2024 | Eylül aidatları (Ayşe, Mehmet)        | 450,00   |          | Banka  |
30.09.2024 | EFT masrafı                           |          | (8,50)   | Banka  |
```

Beklenen çıktı:

```csv
kayit_no;tarih;tur;kategori;tutar;hesap;hedef_hesap;aciklama;karsi_taraf;sponsor;etkinlik;belge_linki
20240905-1;2024-09-05;gider;salon_mekan;1500;banka;;Salon kirası Eylül;Mülkiye Vakfı;;;
20240905-2;2024-09-05;gider;ikram;185,50;kasa;;Prova çay-simit;;;;
20240912-1;2024-09-12;gelir;sponsorluk;5000;banka;;Sponsorluk;;Kaya Matbaa;;
20240914-1;2024-09-14;virman;;2000;banka;kasa;Bankadan nakit çekildi;;;;
20240930-1;2024-09-30;gider;banka_masrafi;8,50;banka;;EFT masrafı;;;;
```

> **Atladıklarım:** Aidat (6. adımda aktarılacak): 2024-09-20, "Eylül aidatları (Ayşe, Mehmet)", 450,00, banka. Kişi başı tutarlar aidat dosyasında ayrı satır olmalı.
>
> **Açılış bakiyesi:** 2024-09-01, kasa 1200, banka 15300. Finans › Ayarlar'a gir.
>
> **Tahmin ettiklerim:** 14.09 "Bankadan nakit çekildi" gider sütununda ama bir harcama değil, bankadan kasaya virman olarak yazdım.

Bu örnek şunları gösterir: kaldırılan binlik ayırıcı (`1.500,00` → `1500`), parantezli eksi tutar, gider sütunundan tanınan virman, yeni sponsor, ayrılan aidatlar, ayrılan devreden satırı ve tarihten kurulan `kayit_no`.

## Örnek dosya

`4-hareketler.csv` her sütunu gösteren kısa bir örnektir. Adlar ve adresler uydurmadır (`ornek.com`, `eski.invalid`).
