# 6 · Aidat ödemeleri ve muafiyetler

Kimin hangi dönemi ne zaman ödediğini ve eski borçlardan kimin muaf tutulduğunu ekler.

Başlık satırı:

```
kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama
```

## Sütunlar

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `kayit_no` | Evet | 1–40, harf, rakam, `- _ . /` | — | `O-20240905-202409-1` | Ödeme: `O-` + tarih + dönemin ayı + sıra. Muafiyet: `M-` + dönemin ayı + sıra. |
| `islem` | Hayır | kod, varsayılan `odeme` | `odeme`, `muaf` | `odeme` |   |
| `eposta` | Evet | e-posta | üye listesindeki adresler | `ayse.demir@ornek.com` | Eski üyeler `@eski.invalid` adresleriyle. |
| `donem` | Evet | portaldaki aidat döneminin adı | — | `Eylül 2024` | Adı Finans › Aidat sayfasındaki gibi yaz. |
| `tutar` | Ödemede | tutar | — | `300` | Dönemin kalan borcundan fazla olamaz. Muafiyette boş. |
| `tarih` | Ödemede | tarih | — | `2024-09-05` | Açılış tarihinden önce olamaz. Muafiyette boş. |
| `hesap` | Ödemede | kod | `kasa`, `banka` | `banka` | Muafiyette boş. |
| `aciklama` | Muafiyette | ≤ 200; muafiyette 3–200 | — | `Geçmiş dönem borcu silindi` | Muafiyette nedeni. |

Ödeme, Aidat sayfasındaki Ödeme al ile aynı kaydı oluşturur. Muafiyet, Muaf tut ile aynıdır. Elle verilmiş bir muafiyet zaten varsa satır değişmeyecek sayılır.

Kontrol sonrası Kasa ve Banka bakiyelerinin aktarımdan önceki ve sonraki hâlini görürsün; şimdi banka ekstrenle tutmalı.

Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir, portaldaki aidat dönemlerini tarihleri ve tutarlarıyla talimata kendisi yazar. Bu dosyadaki talimatta onların yerinde, ne yazacağını anlatan bir satır durur.

Portaldaki katılım tarihi, kişinin portala davet edildiği gündür. Daha eski ödemeleri aktarmadan önce 1. adımı (Üye geçmişi) yap; yoksa o ödemeler reddedilir.

## Yapay zekâ talimatı

Aşağıdaki metni olduğu gibi yeni bir yapay zekâ sohbetine yapıştır (portalda: Yapay zekâ talimatını kopyala), sonra kayıtlarını ve Üye listesini indir dosyasını ekle.

```text
Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "Aidat ödemeleri ve muafiyetler" içe aktarma dosyasına çevir.

ÇIKTI
- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "6-aidat-odemeleri.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.
- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.
- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:
kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama
- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.
- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; bir dönemin satırları iki parçaya bölünmesin).

BİÇİMLER
- Tarih: YYYY-AA-GG (örnek 2024-10-08). 08/10/2024, 8 Ekim 2024 ya da 24-10-08 yazma.
- Saat: SS:DD, 24 saat (örnek 19:00).
- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.
- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.

SÜTUNLAR
- kayit_no (zorunlu): her satıra farklı numara. Ödemede O- + ödeme tarihinin rakamları + - + dönemin başladığı yıl ve ay + - + o gün o döneme yazılan kaçıncı ödeme olduğu (2024-10-02'de Eylül 2024'e yazılan ilk ödeme: O-20241002-202409-1). Muafiyette M- + dönemin başladığı yıl ve ay + sıra (Eylül 2024 için M-202409-1, M-202409-2…). Numara yalnızca tarihe, döneme ve kaynaktaki sıraya bağlıdır; dosya dönemlere bölünse de aynı kalır. Yalnızca harf, rakam ve - _ . / kullan.
- islem (isteğe bağlı): İzin verilen: odeme (varsayılan), muaf.
- eposta (zorunlu): KİŞİLER kurallarına bak.
- donem (zorunlu): AİDAT DÖNEMLERİ listesindeki adlardan biri, aynen. Listede olmayan bir döneme satır yazma; Atladıklarım'a yaz.
- tutar, tarih, hesap (ödemede zorunlu, muafiyette boş): hesap için izin verilen: kasa, banka.
- aciklama: ödemede isteğe bağlı; muafiyette zorunlu, en az 3 karakter, muafiyetin nedeni.

AİDAT DÖNEMLERİ (portalda olanlar; donem sütununa adı aynen yaz)
- <Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir bu listeyi portaldaki verilerle kendisi doldurur. Bu talimatı portalın dışından (docs/ice-aktarma klasöründen) aldıysan bu satırı sil ve yerine Finans › Aidat'taki dönemleri, her biri bir satırda, şu biçimde yaz: "Eylül 2024: 2024-09-01 – 2024-09-30, son ödeme 2024-09-10, tam 300, indirimli 150".>

BU DOSYAYA ÖZEL KURALLAR
- Bir satır = bir kişi, bir dönem, bir ödeme. Birden çok ayı kapsayan ödemeyi her ay için ayrı satıra böl (aynı tarih ve hesap; tutarı aylara dağıt). Tutar aylara tam bölünmüyorsa satırları yazma, Atladıklarım'a yaz.
- Bir kişinin bir döneme ödediği toplam, o dönemin tutarını (indirimli üyede indirimli tutarı) geçmesin.
- Ayrılış tarihi dönemin başlangıcından önce olan kişiye o dönem için satır yazma; Atladıklarım'a yaz.
- Üye listesindeki katılım tarihi dönemin bitişinden sonra olan birinin ödemesini yine de yaz ve sonda "Tarih çelişkisi" başlığıyla listele (portaldaki katılım tarihi çoğu zaman davet günüdür; portal bu satırı 1. adım yapılmadan kabul etmez). Ona muaf satırı yazma. Böyle 3'ten fazla kişi varsa CSV verme; bana "Önce 1. adımı (Üye geçmişi) yap ve üye listesini yeniden indir" de.
- Rolü "sef" olan kişi aidat ödemez; ona satır yazma. Üye listesinde aidat_orani muaf olan kişiye ödeme ya da muaf satırı yazma.
- Ödendi işareti (✓, "ödedi", "tamam", "elden", "+") dönemin tutarı demektir: üye listesinde aidat_orani indirimli ise AİDAT DÖNEMLERİ'ndeki indirimli tutar, değilse tam tutar. Hangisini yazdığını "Tahmin ettiklerim"e ekle.
- Ödeme tarihi yoksa dönemin son ödeme gününü yaz ve "Tahmin ettiklerim"e ekle.
- Ödemenin hesabı yazmıyorsa CSV vermeden önce bana bir kez sor: "Hesabı yazmayan ödemeler kasa mı, banka mı?" Cevabımı hepsine uygula. Cevap veremezsem o ödemeleri Atladıklarım'a yaz.
- Muaf satırını yalnızca kaynak açıkça söylüyorsa ("muaf", "affedildi", "silindi") ya da ben açıkça istersem yaz. Boş hücreden muafiyet çıkarma: boş hücre "ödemedi" de olabilir, "bilinmiyor" da.
- Muafiyet: ben "şu dönemler için ödemeyenleri muaf tut" dersem, o dönemlerin her biri için, o dönemde koroda olup (yukarıdaki kurallar) o döneme HİÇ ödemesi olmayan her kişiye bir muaf satırı yaz. Kısmen ödemiş birine muaf yazma; onu Atladıklarım'a yaz.
- Bu dosya, daha önce aktarılmış bir dosyaya sonradan eklenen kayıtlarsa önceki kayıtların kayit_no'sunu değiştirme; yeni kayıtların kayit_no'sunun başına benim vereceğim etiketi koy (örnek EK1-O-20241002-202409-1). Etiketi vermezsem sor.

KİŞİLER
- Kişileri ekteki üye listesindeki (arkhe-uyeler-….csv) e-postayla eşleştir; adresi listeden aynen kopyala.
- Ayrılmış eski üyeler listede @eski.invalid ile biten adresleriyle durur; onları da aynen kullan. Üye geçmişini (1. adım) aktardıysan üye listesini yeniden indir: eski üyeler ancak o zaman listede olur.
- Listede hiç olmayan biri için adres uydurma (ad.soyad@eski.invalid bile yazma): o satırı koyma, Atladıklarım'a "üye listesinde yok, önce Üye geçmişi'ne eklenmeli" diye yaz.
- Listede rolü "sef" olan kişiyi bu dosyaya koyma.

DÜRÜSTLÜK
- Bilmediğin bir değeri uydurma; boş bırak. Zorunlu bir alan bilinmiyorsa o satırı CSV'ye koyma.
- Bir kişiyi üye listesinde kesin eşleştiremiyorsan (örneğin listede iki "Selin" var) tahmin etme; satırı koyma.
- CSV'den sonra, kod bloğunun dışında şu başlıklarla yaz:
  "Atladıklarım": CSV'ye koymadığın her kayıt, kaynaktaki hâliyle ve nedeniyle.
  "Tahmin ettiklerim": yaklaşık yazdığın her değer (örneğin yalnızca ay biliniyordu, ayın 1'ini yazdım).
  "Tarih çelişkisi": katılım tarihi üye listesinde kaydın tarihinden sonra olan her kişi ve tarih.
  Hiçbiri yoksa "Atladığım kayıt yok." yaz.

Kayıtlarım:
(buraya yapıştır ya da dosyayı ekle)
```

## Örnek

Kaynak: saymanın notları; üye listesi 1. adımdan sonra yeniden indirildi. Dönemler: Eylül, Ekim, Kasım 2024 (300 / indirimli 150).

```
Eylül 2024: Ayşe 300 (5 Eyl, banka), Mehmet 150 öğrenci (8 Eyl, kasa). Can 2 Ekim'de 900 yatırdı, Eylül-Ekim-Kasım için, banka. Selin Ç. Ekim için 100 verdi (kasa, 15 Eki).
Eylül–Kasım 2024 için ödemeyenler muaf tutulsun (yönetim kararı, Ocak 2025).
```

Beklenen çıktı:

```csv
kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama
O-20240905-202409-1;odeme;ayse.demir@ornek.com;Eylül 2024;300;2024-09-05;banka;
O-20240908-202409-1;odeme;mehmet.kaya@ornek.com;Eylül 2024;150;2024-09-08;kasa;
O-20241002-202409-1;odeme;can.yildiz@ornek.com;Eylül 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241002-202410-1;odeme;can.yildiz@ornek.com;Ekim 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241002-202411-1;odeme;can.yildiz@ornek.com;Kasım 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241015-202410-1;odeme;selin.cakir@ornek.com;Ekim 2024;100;2024-10-15;kasa;
M-202409-1;muaf;zeynep.ak@eski.invalid;Eylül 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202409-2;muaf;selin.cakir@ornek.com;Eylül 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202409-3;muaf;selin.aydin@ornek.com;Eylül 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202410-1;muaf;ayse.demir@ornek.com;Ekim 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202410-2;muaf;mehmet.kaya@ornek.com;Ekim 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202410-3;muaf;elif.sahin@ornek.com;Ekim 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202410-4;muaf;zeynep.ak@eski.invalid;Ekim 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202410-5;muaf;selin.aydin@ornek.com;Ekim 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202411-1;muaf;ayse.demir@ornek.com;Kasım 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202411-2;muaf;mehmet.kaya@ornek.com;Kasım 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202411-3;muaf;elif.sahin@ornek.com;Kasım 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202411-4;muaf;zeynep.ak@eski.invalid;Kasım 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202411-5;muaf;selin.cakir@ornek.com;Kasım 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
M-202411-6;muaf;selin.aydin@ornek.com;Kasım 2024;;;;Geçmiş dönem borcu, yönetim kararıyla silindi
```

> **Atladıklarım:** Selin Çakır, Ekim 2024: 100 TL kısmi ödeme var; muaf yazmadım (kısmi ödemeli döneme muafiyet verilemez). Kalanı nasıl kapatacağına sen karar ver. Burak Öztürk: 15.01.2024'te ayrılmış; bu dönemlerden sorumlu değil. Deniz Arslan: koro şefi; aidat yok.
>
> **Tahmin ettiklerim:** Can'ın 900 TL'sini üç aya 300'er böldüm.

Bu örnek şunları gösterir: birkaç aylık ödemenin bölünmesi, indirimli üye, muafiyet kuralı (Elif 1 Ekim'de katıldığı için Eylül'de yok; Burak ve koro şefi hiç yok) ve kısmi ödemenin muafiyeti engellemesi.

## İkinci örnek: işaretli aidat tablosu

Kaynak: saymanın işaretli tablosu; tarih ve hesap çoğu hücrede yok. Talimat AİDAT DÖNEMLERİ'nde Eylül, Ekim, Kasım 2024'ü (tam 300, indirimli 150) listeliyor; üye listesinde Mehmet'in aidat_orani indirimli. Yapay zekâ önce hesabı sordu, cevap: "Elden olanlar kasa, gerisi banka."

```
Ad Soyad      | Eyl                     | Eki   | Kas
Ayşe Demir    | ✓                       | ✓     |
Mehmet Kaya   | 150                     | elden |
Can Yıldız    | 900 (3 ay, havale 2.10) |       |
```

Beklenen çıktı:

```csv
kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama
O-20240910-202409-1;odeme;ayse.demir@ornek.com;Eylül 2024;300;2024-09-10;banka;
O-20240910-202409-2;odeme;mehmet.kaya@ornek.com;Eylül 2024;150;2024-09-10;banka;
O-20241002-202409-1;odeme;can.yildiz@ornek.com;Eylül 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241010-202410-1;odeme;ayse.demir@ornek.com;Ekim 2024;300;2024-10-10;banka;
O-20241010-202410-2;odeme;mehmet.kaya@ornek.com;Ekim 2024;150;2024-10-10;kasa;
O-20241002-202410-1;odeme;can.yildiz@ornek.com;Ekim 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241002-202411-1;odeme;can.yildiz@ornek.com;Kasım 2024;300;2024-10-02;banka;3 aylık ödeme
```

> **Atladıklarım:** Kasım 2024'te Ayşe ve Mehmet'in hücresi boş; ödemedi mi, bilinmiyor mu belli değil, muaf yazmadım.
>
> **Tahmin ettiklerim:** ✓ ve "elden" dönemin tutarı: Ayşe tam (300), Mehmet indirimli (150). Tarihi olmayan ödemelere dönemin son ödeme gününü yazdım (10 Eylül, 10 Ekim). Hesap: senin cevabınla elden olan kasa, gerisi banka. Can'ın 900 TL'sini üç aya 300'er böldüm; havale 2 Ekim.

Bu örnek şunları gösterir: ✓ ve "elden" işaretinin üyenin oranına göre tutara çevrilmesi, eksik tarihe son ödeme günü, eksik hesap için bir kez sorulması, boş hücreden muafiyet çıkarılmaması ve dönemlere bölünse de değişmeyen kayit_no.

## Örnek dosya

`6-aidat-odemeleri.csv` her sütunu gösteren kısa bir örnektir. Adlar ve adresler uydurmadır (`ornek.com`, `eski.invalid`).
