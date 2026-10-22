# Eski kayıtları portala aktarmak

Excel'deki, Sheets'teki ya da kâğıttaki eski kayıtları (yoklamalar, defter, aidatlar, kim ne zaman katıldı) portala toplu olarak aktarırsın. Portalda Profil › Veri içe aktar sayfasından girilir. Her dosya önce **Kontrol et** ile denetlenir; kontrol hiçbir şey yazmaz. Sonra **İçe aktar** dosyanın tamamını tek seferde yazar: ya hepsi girer ya hiçbiri.

## Sıra

**Portaldaki katılım tarihi, kişinin portala davet edildiği gündür. Bundan eski bir kayıt (yoklama, aidat) aktaracaksan 1. adım (Üye geçmişi) zorunludur; yoksa yoklamalar ve ödemeler reddedilir.**

Adımları bu sırayla yap:

| Adım | Tür | Dosyalar | Ne aktarılır |
|---|---|---|---|
| 0 | Açılış bakiyesi | elle, Finans › Ayarlar | Kayıtların başladığı günün kasa ve banka bakiyesi. |
| 1 | Üye geçmişi | `1-uyeler.csv`, `1-uyeler.md` | Katılım ve ayrılış tarihleri, eski üyeler. |
| 2 | Çalışma dönemleri | `2-donemler.csv`, `2-donemler.md` | Güz ve bahar dönemleri. |
| 3 | Çalışmalar ve yoklama | `3-yoklama.csv`, `3-yoklama.md` | Geçmiş çalışmalar ve kimin geldiği. |
| 4 | Finans hareketleri | `4-hareketler.csv`, `4-hareketler.md` | Gelir, gider ve virmanlar (aidat hariç). |
| 5 | Aidat dönemleri | `5-aidat-donemleri.csv`, `5-aidat-donemleri.md` | Aidat dönemleri ve tutarları. |
| 6 | Aidat ödemeleri ve muafiyetler | `6-aidat-odemeleri.csv`, `6-aidat-odemeleri.md` | Kim hangi dönemi ödedi, kim muaf. |

Neden bu sıra: üye tarihleri kimin hangi çalışmada beklendiğini ve hangi aidat döneminden sorumlu olduğunu belirler; aidat dönemleri ödemelerden önce var olmalıdır. Sıra yanlışsa bir şey bozulmaz: kontrol hata verir, önceki adımı yapıp aynı dosyayı yeniden yüklersin.

**Üye geçmişini aktardıktan sonra Üye listesini indir'i yeniden kullan; eski üyelerin adresleri artık listede.**

Yönetim kurulu üyesiysen 1. adımda yalnızca koristlerin satırlarını değiştirebilirsin. Değişiklik getirmeyen bir şef ya da yönetim satırı sorun çıkarmaz, ama geçmiş bir katılım tarihi her zaman değişikliktir. Talimat bu satırları ikinci bir kod bloğuna ayırır; o bloğu koro şefine ver, o aktarsın.

## Açılış bakiyesi (0. adım)

Geçmişi aktarıyorsan açılış bakiyesi, kayıtlarının başladığı günün kasa ve banka bakiyesidir, bugünkü bakiye değil. Yoksa para iki kez sayılır.

Kayıtların 1 Eylül 2024'te başlıyorsa, Finans › Ayarlar'da tarihi 2024-09-01 yap ve o sabahki kasa ve banka bakiyesini yaz. Defterdeki "devreden" satırı budur; onu hareket olarak aktarma.

Portalda zaten elle girilmiş hareketleri dosyaya koyma: yalnızca portalda elle girilen ilk hareketin tarihinden önceki kayıtları aktar. Portaldaki talimat bu tarihi kendisi yazar. Kontrol, portalda aynı gün, kategori ve tutarda elle girilmiş bir hareket bulursa Dikkat altında söyler; tekrar olanları dosyadan çıkar.

## Yapay zekâyla çalışmak

1. Veri içe aktar sayfasında Üye listesini indir.
2. Adımın sayfasında Yapay zekâ talimatını kopyala; yeni bir sohbete yapıştır.
3. Kayıtlarını ekle (Excel dosyası, Sheets'ten kopyalanmış tablo ya da kâğıdın fotoğrafı) ve üye listesini ekle. Gönder.
4. Gelen CSV'yi kopyala ve Metni yapıştır'a yapıştır (ya da dosya olarak kaydedip Dosya seç ile yükle). Sonra Kontrol et.
5. Hata varsa Hataları kopyala, aynı sohbete yapıştır, yeni CSV ile 4. adımı tekrarla. Sonunda yapay zekânın "Atladıklarım" ve "Tarih çelişkisi" listelerini oku: o kayıtları elle gir ya da kaynağı düzelt.

Her adımın `.md` dosyasında o türün sütunları, talimatın tamamı ve çözülmüş bir örnek vardır. 4. ve 6. adımın talimatı portaldaki verilere (aidat dönemleri, etkinlikler, elle girilmiş ilk hareket) dayanır: portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir bunları talimata kendisi yazar; buradaki `.md` dosyalarında onların yerinde ne yazacağını anlatan bir satır durur.

Örnek dosyalar uydurma kişilerle yazıldı (`ornek.com`, `eski.invalid`); portalında yüklersen "Bu e-postayla üye yok" hatası verir. Yalnızca biçimi gösterir.

Kayıt numaraları (`kayit_no`) tarihe ve sıraya bağlıdır; aynı kaynak her seferinde aynı numaraları verir. Aynı numara farklı içerikle yeniden gelirse kontrol hata verir: o aktarım doğruysa yeni satıra yeni bir numara ver (talimat sonradan eklenen kayıtlara `EK1-` gibi bir etiket koyar).

## Dosyayı kaydetmek

En kolayı metni Metni yapıştır'a yapıştırmaktır. Dosya olarak kaydedeceksen:

- ChatGPT, Claude: dosya verdiyse İndir.
- Excel: Dosya › Farklı Kaydet › CSV UTF-8 (Virgülle ayrılmış). Düz `CSV` seçme; o Windows-1254'tür ve ş ğ ı bozulur.
- Google Sheets: Dosya › İndir › Virgülle ayrılmış değerler (.csv).
- Windows Not Defteri: Farklı kaydet, Kayıt türü: Tüm dosyalar, ad `yoklama.csv`, Kodlama: UTF-8.
- Mac Metin Düzenleyici: Biçim › Düz Metin Yap, sonra Kaydet, ad `yoklama.csv`, Düz metin kodlaması: Unicode (UTF-8).

## Dosya kuralları

- Kodlama UTF-8 (BOM'lu ya da BOM'suz). Ayırıcı noktalı virgül (`;`) ya da virgül (`,`); başlık satırına bakılır.
- İlk satır başlıktır. Sütun adları türün `.md` dosyasındaki gibidir; büyük-küçük harf ve Türkçe harf fark etmez (`KATILIM_TARIHI`, `Katılım tarihi`). Bilinmeyen sütun hatadır. İsteğe bağlı sütunlar hiç yazılmayabilir.
- Hücrede ayırıcı (noktalı virgül ya da virgül) varsa hücre çift tırnak içine alınır (`"Salon; kira"`). Bir hücrede satır sonu olamaz.
- Boş satırlar atlanır; hata satır numaraları dosyanın satırlarıdır (1. satır başlık).
- Tarih `2025-10-07` ya da `07.10.2025`; asla `07/10/2025`. Tarihler 2000'den sonra ve bugünden önce olur (dönem ve aidat bitişleri gelecekte olabilir).
- Saat `19:00` biçiminde, 24 saat.
- Tutar `1250,50` ya da `1250`; asla `1.250,50`, `₺` ya da `TL`. En fazla ₺10.000.000,00.
- Kod sütunları (partisyon, durum, kategori…) Türkçe kodu, portaldaki adı ya da İngilizce kodu kabul eder: `ulasim_ve_konaklama`, `Ulaşım ve konaklama` ve `travel` aynıdır.
- En fazla 1 MB ve 5000 satır.

## Eski aidatlar borç görünmesin

Geçmiş aidat dönemlerini aktardıktan sonra o dönemlerde ödemesi olmayan herkes Gecikti görünür. Koro bu borçları çoktan sildiyse 6. adımda muafiyet satırları yaz. Yapay zekâya şunu söyle: "Şu dönemler için ödemeyenleri muaf tut"; talimattaki kural her dönem için, o dönemde koroda olup hiç ödemesi olmayan herkese bir `muaf` satırı yazdırır.

## Büyük dosyalar

Bir dosya en fazla 5000 satır ve 1 MB olabilir. Büyük geçmişi sezonlara böl. Bir çalışmanın ya da defterin bir gününün satırlarını iki dosyaya bölme. Yoklama dosyasına yalnızca gelenleri, geç gelenleri ve mazeretlileri yazarsan satır sayısı yarıya iner; listede olmayan beklenen herkes Gelmedi sayılır.

## Kişisel veriler

Yapay zekâ kullanırsan üyelerin adları ve e-postaları başka bir şirketin sohbetine gider. Yalnızca iş için gerekeni ver; istersen adların yerine baş harfleri kullan. Portal hiçbir şeyi bir yere göndermez ve yüklenen dosyayı saklamaz; yalnızca adını, boyutunu ve SHA-256 özetini kaydeder.

## Geri almak

İçe aktarma geçmişi'nde en son aktarımı geri alabilirsin; daha eskisi için önce sonrakileri geri alırsın. Aktarımdan sonra portalda üzerine bir şey kurulduysa (bir yoklama düzeltildi, bir ödeme iptal edildi, bir üye elle değişti) geri alma reddedilir. Aktarımı yapan kişi ya da koro şefi geri alabilir.
