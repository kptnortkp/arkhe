# 2 · Çalışma dönemleri

Raporlarda seçtiğin çalışma dönemlerini oluşturur (örneğin 2024–25 Güz).

Başlık satırı:

```
ad;baslangic;bitis
```

## Sütunlar

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `ad` | Evet | 1–40 karakter | — | `2024–25 Güz` | Raporlardaki dönem seçicide görünen ad. Aynı ad iki kez olmaz. |
| `baslangic` | Evet | tarih | — | `2024-09-16` | Dönemin ilk günü. |
| `bitis` | Evet | tarih, gelecekte olabilir | — | `2025-01-31` | Son günü. Başlangıçtan en fazla 366 gün sonra. |

Dönemlerin portalda düzenleme sayfası yok. Yanlış aktarılan bir dönemi İçe aktarma geçmişi'nden geri alıp düzeltilmiş dosyayı yeniden yüklersin.

## Yapay zekâ talimatı

Aşağıdaki metni olduğu gibi yeni bir yapay zekâ sohbetine yapıştır (portalda: Yapay zekâ talimatını kopyala), sonra kayıtlarını ekle.

```text
Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "Çalışma dönemleri" içe aktarma dosyasına çevir.

ÇIKTI
- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "2-donemler.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.
- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.
- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:
ad;baslangic;bitis
- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.
- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; bir dönem iki parçaya bölünmesin).

BİÇİMLER
- Tarih: YYYY-AA-GG (örnek 2024-10-08). 08/10/2024, 8 Ekim 2024 ya da 24-10-08 yazma.
- Saat: SS:DD, 24 saat (örnek 19:00).
- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.
- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.

SÜTUNLAR
- ad (zorunlu): dönemin adı, en fazla 40 karakter. Portaldaki gibi yaz: "2024–25 Güz", "2024–25 Bahar" (yıllar arasında uzun tire –). Koro sezonu bölmüyorsa "2024–25 sezonu".
- baslangic (zorunlu): ilk gün.
- bitis (zorunlu): son gün.

BU DOSYAYA ÖZEL KURALLAR
- Dönemler birbiriyle çakışmasın: bir dönemin bitişi, sonrakinin başlangıcından önce olsun. Aradaki tatiller boşta kalabilir.
- Bir dönem en fazla bir yıl (366 gün) sürebilir.
- Kesin başlangıç ya da bitiş günü yoksa o dönemi yazma; Atladıklarım'a yaz ve bana tarihleri sor.

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

Kaynak: eski şefin WhatsApp mesajı.

```
23-24'te güzde 18 eylülde başladık, son prova 26 ocak. bahar 12 şubat - 21 haziran. 24-25 aynı düzen, eylülün üçüncü haftası başladık sanırım
```

Beklenen çıktı:

```csv
ad;baslangic;bitis
2023–24 Güz;2023-09-18;2024-01-26
2023–24 Bahar;2024-02-12;2024-06-21
```

> **Atladıklarım:** "24-25 aynı düzen, eylülün üçüncü haftası": kesin tarih yok. Başlangıç ve bitiş günlerini verirsen 2024–25 Güz ve Bahar satırlarını eklerim.

Bu örnek uzun tireli adlandırmayı ve "sanırım"ın tarihe çevrilmediğini gösterir. Dönem sınırları tahmin edilmez: yanlış bir sınır rapordaki sayıları kaydırır.

## Örnek dosya

`2-donemler.csv` her sütunu gösteren kısa bir örnektir. Adlar ve adresler uydurmadır (`ornek.com`, `eski.invalid`).
