# 3 · Çalışmalar ve yoklama

Geçmiş çalışmaları kapanmış hâlde, yoklamalarıyla oluşturur. Listede olmayan beklenen kişiler Gelmedi sayılır.

Başlık satırı:

```
tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not
```

## Sütunlar

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `tarih` | Evet | tarih | — | `2024-10-08` | Çalışmanın günü. |
| `baslangic` | Hayır | saat, varsayılan `19:00` | — | `19:00` | Aynı gün iki çalışma varsa farklı olmalı. Boşsa aynı gün içinde kendinden önceki çalışmaya sayılır. |
| `bitis` | Hayır | saat, varsayılan `22:00` | — | `22:00` | Başlangıçtan sonra. |
| `tur` | Hayır | kod, varsayılan `tutti` | `tutti`, `partisyon`, `genel_prova`, `konser` | `tutti` |   |
| `partiler` | Partisyonda | `+` ile birleşik | `soprano`, `alto`, `tenor`, `bas` | `soprano+alto` | Yalnızca `partisyon` türünde, orada zorunlu. |
| `baslik` | Hayır | ≤ 80 karakter | — | `Bahar konseri provası` |   |
| `yer` | Hayır | ≤ 120 karakter | — | `Mülkiye Salonu` |   |
| `eposta` | Evet | e-posta | üye listesindeki adresler | `ayse.demir@ornek.com` | Eski üyeler `@eski.invalid` adresleriyle. |
| `durum` | Evet | kod | `geldi`, `gec_geldi` (ya da `gec`), `mazeretli`, `gelmedi` | `geldi` | Listede olmayan beklenen kişiler `gelmedi` sayılır. |
| `not` | Hayır | ≤ 200 karakter | — | `Sınav haftası` | Yalnızca `mazeretli` satırda. |

Aynı günün sonraki satırlarında saati boş bırakabilirsin; satır, aynı gün içinde kendinden önceki çalışmaya sayılır. Aynı gün iki çalışma varsa ikincisinin ilk satırına saati mutlaka yaz.

Çalışmalar kapanmış olarak oluşturulur. Dosyada olmayan ama o gün koroda olan herkes (katılım ve ayrılış tarihine, partisyonda partisine göre) Gelmedi sayılır. Bu yüzden önce Üye geçmişi'ni aktar.

Portaldaki katılım tarihi, kişinin portala davet edildiği gündür. Daha eski yoklamaları aktarmadan önce 1. adımı (Üye geçmişi) yap; yoksa o satırlar reddedilir.

Portalda elle girilmiş bir çalışmanın yoklaması bu dosyayla değiştirilmez; onu çalışmanın sayfasından düzeltirsin.

## Yapay zekâ talimatı

Aşağıdaki metni olduğu gibi yeni bir yapay zekâ sohbetine yapıştır (portalda: Yapay zekâ talimatını kopyala), sonra kayıtlarını ve Üye listesini indir dosyasını ekle.

```text
Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "Çalışmalar ve yoklama" içe aktarma dosyasına çevir.

ÇIKTI
- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "3-yoklama.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.
- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.
- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:
tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not
- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.
- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; bir çalışmanın satırları iki parçaya bölünmesin).

BİÇİMLER
- Tarih: YYYY-AA-GG (örnek 2024-10-08). 08/10/2024, 8 Ekim 2024 ya da 24-10-08 yazma.
- Saat: SS:DD, 24 saat (örnek 19:00).
- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.
- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.

SÜTUNLAR
- tarih (zorunlu): çalışmanın günü.
- baslangic, bitis (isteğe bağlı): saat. Bilinmiyorsa boş bırak; portal 19:00–22:00 kabul eder. Aynı gün iki çalışma varsa ikisinin baslangic'ı farklı ve dolu olsun.
- tur (isteğe bağlı): İzin verilen: tutti (bütün koro, varsayılan), partisyon (yalnız bazı partiler), genel_prova, konser.
- partiler: yalnızca tur partisyon ise ve orada zorunlu; partileri + ile birleştir. İzin verilen: soprano, alto, tenor, bas (örnek soprano+alto).
- baslik, yer (isteğe bağlı): kaynakta varsa.
- eposta (zorunlu): kişinin e-postası (KİŞİLER kurallarına bak).
- durum (zorunlu): İzin verilen: geldi, gec_geldi (geç geldi), mazeretli (izinli, raporlu, haber verdi), gelmedi.
- not (isteğe bağlı): yalnızca mazeretli satırda, mazeretin kısa nedeni.

BU DOSYAYA ÖZEL KURALLAR
- Bir kişi bir çalışmada bir satır. Aynı çalışmanın satırlarını alt alta yaz.
- Çalışmanın bilgilerini (baslangic, bitis, tur, partiler, baslik, yer) yalnızca o çalışmanın İLK satırına yaz; sonraki satırlarda boş bırak.
- "gelmedi" satırı yazman gerekmez: listede olmayan, o gün koroda olan herkes Gelmedi sayılır. Kaynak yalnızca gelmeyenleri işaretliyorsa, o tarihte üye olan herkesi (üye listesindeki katılım ve ayrılış tarihine göre; partisyonda yalnızca o partilerdekileri) geldi yaz, işaretlileri gelmedi.
- O tarihten önce ayrılmış birini (üye listesindeki ayrilis_tarihi kaydın tarihinden önce) ya da partisyonda başka partideki birini yazma; portal reddeder. Kaynakta böyle biri varsa Atladıklarım'a yaz.
- Üye listesindeki katilim_tarihi kaydın tarihinden sonra olan birinin satırını yine de yaz ve sonda "Tarih çelişkisi" başlığıyla listele (portaldaki katılım tarihi çoğu zaman davet günüdür; portal bu satırı 1. adım yapılmadan kabul etmez). Böyle 3'ten fazla kişi varsa CSV verme; bana "Önce 1. adımı (Üye geçmişi) yap ve üye listesini yeniden indir" de.
- Gelecekteki ya da bugün bitmemiş çalışmayı yazma.

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

Kaynak: yoklama defterinin fotoğrafı, yapay zekânın okuduğu hâliyle.

```
8 Ekim Salı — Mülkiye Salonu — tutti
  Ayşe ✓   Mehmet geç   Zeynep izinli (sınav)   Can ✓   Elif ✓   Deniz hoca
10 Ekim Perş. 20.00–21.30 — sop+alto partisyon
  Ayşe ✓   Elif ✓   Zeynep yok   Selin Ç. ✓
```

Beklenen çıktı:

```csv
tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not
2024-10-08;;;tutti;;;Mülkiye Salonu;ayse.demir@ornek.com;geldi;
2024-10-08;;;;;;;mehmet.kaya@ornek.com;gec_geldi;
2024-10-08;;;;;;;zeynep.ak@eski.invalid;mazeretli;Sınav
2024-10-08;;;;;;;can.yildiz@ornek.com;geldi;
2024-10-08;;;;;;;elif.sahin@ornek.com;geldi;
2024-10-10;20:00;21:30;partisyon;soprano+alto;;;ayse.demir@ornek.com;geldi;
2024-10-10;;;;;;;elif.sahin@ornek.com;geldi;
2024-10-10;;;;;;;zeynep.ak@eski.invalid;gelmedi;
2024-10-10;;;;;;;selin.cakir@ornek.com;geldi;
```

> **Atladıklarım:** 8 Ekim "Deniz hoca": koro şefi (Deniz Arslan), yoklamaya yazılmaz.
>
> **Tahmin ettiklerim:** yıl 2024 (defter kapağından). 8 Ekim'in saati yok; boş bıraktım (19:00–22:00 sayılır). "Selin Ç." → Selin Çakır (listede soyadı Ç ile başlayan tek Selin).

Bu örnek şunları gösterir: boş bırakılıp ilk satırdan alınan hücreler, varsayılan saatler, `izinli` → `mazeretli` ve not, koro şefinin yazılmaması, `yok` → `gelmedi`, `+` ile partisyon ve yeniden indirilen üye listesinden alınan Zeynep adresi.

## Örnek dosya

`3-yoklama.csv` her sütunu gösteren kısa bir örnektir. Adlar ve adresler uydurmadır (`ornek.com`, `eski.invalid`).
