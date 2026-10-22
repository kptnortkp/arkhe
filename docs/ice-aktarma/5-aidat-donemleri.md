# 5 · Aidat dönemleri

Aidat dönemlerini ve tutarlarını oluşturur. Aynı tutarlı ardışık aylar için Aidat › Aylık toplu oluştur daha hızlı.

Başlık satırı:

```
ad;baslangic;bitis;son_odeme;tutar;indirimli_tutar
```

## Sütunlar

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `ad` | Evet | 1–40 karakter | — | `Eylül 2024` | Aylık dönemlerde portalın adı: ay ve yıl. 6. adımda bu adla eşleşir. |
| `baslangic` | Evet | tarih | — | `2024-09-01` |   |
| `bitis` | Evet | tarih, gelecekte olabilir | — | `2024-09-30` |   |
| `son_odeme` | Evet | tarih, gelecekte olabilir | — | `2024-09-10` | Başlangıçtan önce olamaz. |
| `tutar` | Evet | tutar | — | `300` | Tam aidat. |
| `indirimli_tutar` | Hayır | tutar | — | `150` | Tam aidattan az. |

Dönemleri aktardıktan sonra eski dönemlerde ödemesi olmayan herkes Gecikti görünür. 6. adımdaki muafiyet satırlarıyla bunu kapatırsın.

## Yapay zekâ talimatı

Aşağıdaki metni olduğu gibi yeni bir yapay zekâ sohbetine yapıştır (portalda: Yapay zekâ talimatını kopyala), sonra kayıtlarını ekle.

```text
Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "Aidat dönemleri" içe aktarma dosyasına çevir.

ÇIKTI
- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "5-aidat-donemleri.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.
- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.
- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:
ad;baslangic;bitis;son_odeme;tutar;indirimli_tutar
- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.
- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; bir dönem iki parçaya bölünmesin).

BİÇİMLER
- Tarih: YYYY-AA-GG (örnek 2024-10-08). 08/10/2024, 8 Ekim 2024 ya da 24-10-08 yazma.
- Saat: SS:DD, 24 saat (örnek 19:00).
- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.
- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.

SÜTUNLAR
- ad (zorunlu): aylık dönemde ayın Türkçe adı ve yıl, portaldaki gibi: "Eylül 2024", "Ekim 2024", "Şubat 2025". Dönem bir sezonsa: "2024–25 sezonu".
- baslangic, bitis (zorunlu): dönemin ilk ve son günü.
- son_odeme (zorunlu): son ödeme günü; baslangic'tan önce olamaz.
- tutar (zorunlu): tam aidat.
- indirimli_tutar (isteğe bağlı): öğrenci vb. indirimli aidat; tutar'dan az olmalı.

BU DOSYAYA ÖZEL KURALLAR
- Her dönem bir satır. Dönemler çakışmasın.
- Aidat alınmayan aylar (örneğin yaz) için satır yazma.
- Son ödeme günü bilinmiyorsa ayın 10'unu yaz ve "Tahmin ettiklerim"e ekle.

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

Kaynak: saymanın notu.

```
2024-25'te aylık aidat 300 TL, öğrenciler 150. Eylülden hazirana, her ayın 10'una kadar. Temmuz ağustos aidat yok.
```

Beklenen çıktı:

```csv
ad;baslangic;bitis;son_odeme;tutar;indirimli_tutar
Eylül 2024;2024-09-01;2024-09-30;2024-09-10;300;150
Ekim 2024;2024-10-01;2024-10-31;2024-10-10;300;150
Kasım 2024;2024-11-01;2024-11-30;2024-11-10;300;150
Aralık 2024;2024-12-01;2024-12-31;2024-12-10;300;150
Ocak 2025;2025-01-01;2025-01-31;2025-01-10;300;150
Şubat 2025;2025-02-01;2025-02-28;2025-02-10;300;150
Mart 2025;2025-03-01;2025-03-31;2025-03-10;300;150
Nisan 2025;2025-04-01;2025-04-30;2025-04-10;300;150
Mayıs 2025;2025-05-01;2025-05-31;2025-05-10;300;150
Haziran 2025;2025-06-01;2025-06-30;2025-06-10;300;150
```

> **Atladığım kayıt yok.**

Bu örnek portalın ay adlarını, yaz aylarının atlanmasını ve indirimli tutarı gösterir.

## Örnek dosya

`5-aidat-donemleri.csv` her sütunu gösteren kısa bir örnektir. Adlar ve adresler uydurmadır (`ornek.com`, `eski.invalid`).
