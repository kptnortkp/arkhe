# 1 · Üye geçmişi

Üyelerin katılım ve ayrılış tarihlerini düzeltir, ayrılmış eski üyeleri ekler. Boş hücre "değiştirme" demektir. Eski üyeler portala giriş yapamaz.

Başlık satırı:

```
eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon;aidat_orani
```

## Sütunlar

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `eposta` | Evet | e-posta | — | `ayse.demir@ornek.com` | Portaldaki kişiyle eşleştirir. Eski üyenin adresi bilinmiyorsa `ad.soyad@eski.invalid`. |
| `ad` | Eski üyede | 2–80 karakter | — | `Ayşe Demir` | Portaldaki kişide yalnızca kontrol edilir; farklıysa uyarı çıkar, ad değişmez. |
| `katilim_tarihi` | Eski üyede | tarih | — | `2019-09-01` | Koroya ilk geldiği gün. |
| `ayrilis_tarihi` | Eski üyede | tarih | — | `2024-01-15` | Koroda son günü. **Aktif bir üyeye yazılırsa o kişi pasifleşir.** Boş bırakmak kimseyi geri getirmez. |
| `partisyon` | Eski üyede | kod | `soprano`, `alto`, `tenor`, `bas` | `alto` | Bugünkü partisyon. Portalda olan kişide değiştirmek istemiyorsan boş bırak. |
| `aidat_orani` | Hayır | kod | `tam`, `indirimli`, `muaf` | `indirimli` | Bugünkü aidat oranı; tüm dönemlere uygulanır. Değiştirmeyeceksen boş bırak. |

Boş hücre hiçbir şeyi değiştirmez. Boş `ayrilis_tarihi` kimseyi yeniden aktif yapmaz; bunu Üyeler sayfasından elle yaparsın.

Yönetim kurulu yalnızca korist satırlarını değiştirebilir; şef ve yönetim üyelerinin satırlarını koro şefi aktarır. Değişiklik getirmeyen bir yönetim satırı sorun çıkarmaz, ama geçmiş bir katılım tarihi her zaman değişikliktir. Talimat bu yüzden o satırları ikinci bir kod bloğuna ayırır: onu koro şefine ver.

## Yapay zekâ talimatı

Aşağıdaki metni olduğu gibi yeni bir yapay zekâ sohbetine yapıştır (portalda: Yapay zekâ talimatını kopyala), sonra kayıtlarını ve Üye listesini indir dosyasını ekle.

```text
Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "Üye geçmişi" içe aktarma dosyasına çevir.

ÇIKTI
- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "1-uyeler.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.
- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.
- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:
eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon;aidat_orani
- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.
- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; bir kişi iki parçaya bölünmesin).

BİÇİMLER
- Tarih: YYYY-AA-GG (örnek 2024-10-08). 08/10/2024, 8 Ekim 2024 ya da 24-10-08 yazma.
- Saat: SS:DD, 24 saat (örnek 19:00).
- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.
- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.

SÜTUNLAR
- eposta (zorunlu): kişinin e-postası.
- ad (eski üyede zorunlu): kayıtlarımdaki adı, olduğu gibi. Üye listesindeki adı kopyalama; portal ikisini karşılaştırıp farkları bana gösterecek.
- katilim_tarihi (eski üyede zorunlu): koroya ilk geldiği gün.
- ayrilis_tarihi (eski üyede zorunlu): koroda son günü.
- partisyon (eski üyede zorunlu): İzin verilen: soprano, alto, tenor, bas. (Sop → soprano, Bass → bas.)
- aidat_orani (isteğe bağlı): İzin verilen: tam, indirimli, muaf.

BU DOSYAYA ÖZEL KURALLAR
- Ekteki üye listesindeki her kişi için kayıtlarımda bir katılım tarihi varsa bir satır yaz. Yalnızca bildiğin sütunları doldur; boş hücre "değiştirme" demektir.
- Üye listesinde olan kişilerde partisyon ve aidat_orani sütunlarını BOŞ bırak. Eski kayıttaki partisyon bugünkünü bozar. Yalnızca ben açıkça "bugünkü partisyonu/oranı değiştir" dersem doldur.
- ayrilis_tarihi'ni yalnızca koroyu gerçekten bırakmış biri için yaz. Üye listesinde durumu "aktif" olan birine ayrılış tarihi yazarsan o kişi portaldan çıkarılır. Böyle her kişiyi sonda ayrıca "Pasifleşecekler" başlığıyla listele.
- Kayıtlarımda olup üye listesinde olmayan, ayrılmış kişiler eski üyedir. Onlar için ad, katilim_tarihi, ayrilis_tarihi ve partisyon dördü de gerekli; biri bilinmiyorsa satırı koyma.
- Eski üyenin e-postasını bilmiyorsan ad.soyad@eski.invalid yaz: küçük harf, Türkçe harfler sadeleşir (ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u), ad ile soyad arasına nokta. Aynı adlı ikinci kişiye 2 ekle (ayse.kaya2@eski.invalid). Bu adres ileride yoklama ve aidat dosyalarında da kullanılacak.
- Yalnızca ay ve yıl biliniyorsa: katılımda ayın 1'ini, ayrılışta ayın son gününü yaz. Yalnızca sezon biliniyorsa ("2018 güzü"): katılımda 1 Eylül, ayrılışta 30 Haziran. Hepsini "Tahmin ettiklerim"e yaz.
- Ayrılıp sonra geri dönen biri için ilk katılım tarihini yaz; şu an korodaysa ayrılış tarihini boş bırak.
- Listede rolü "sef" ya da "yonetim" olan kişilerin satırlarını bu CSV'ye koyma: onları ikinci, ayrı bir kod bloğunda ver ve başına "Koro şefinin aktaracağı satırlar" yaz. Yönetim kurulu bu satırları değiştiremez; değişiklik getirmeyen satırlar sorun çıkarmaz ama geçmiş katılım tarihi her zaman bir değişikliktir. Ben "koro şefiyim" dersem hepsini tek CSV'de ver.

DÜRÜSTLÜK
- Bilmediğin bir değeri uydurma; boş bırak. Zorunlu bir alan bilinmiyorsa o satırı CSV'ye koyma.
- Bir kişiyi üye listesinde kesin eşleştiremiyorsan (örneğin listede iki "Selin" var) tahmin etme; satırı koyma.
- CSV'den sonra, kod bloğunun dışında şu başlıklarla yaz:
  "Atladıklarım": CSV'ye koymadığın her kayıt, kaynaktaki hâliyle ve nedeniyle.
  "Tahmin ettiklerim": yaklaşık yazdığın her değer (örneğin yalnızca ay biliniyordu, ayın 1'ini yazdım).
  Hiçbiri yoksa "Atladığım kayıt yok." yaz.

Kayıtlarım:
(buraya yapıştır ya da dosyayı ekle)
```

## Örnek

Kaynak: eski Excel'in "Korist listesi" sayfasından yapıştırılmış tablo ve Üye listesini indir dosyası. Talimatı koro şefi kullanıyor ve "koro şefiyim" dedi.

```
Ad Soyad       | Ses  | Giriş        | Ayrılış      | Aidat
Ayşe Demir     | Alto | Eylül 2019   |              |
Mehmet Kaya    | Ten  | 12.02.2021   |              | öğrenci (yarım)
Zeynep Ak      | Sop  | 2018 güz     | Ocak 2025    |
Burak Öztürk   | Bas  | 03.10.2022   | 15.01.2024   |
Selin          | Alto | 2020         |              |
Can Yıldız     | Bas  | 15.09.2022   |              |
```

Beklenen çıktı:

```csv
eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon;aidat_orani
ayse.demir@ornek.com;Ayşe Demir;2019-09-01;;;
mehmet.kaya@ornek.com;Mehmet Kaya;2021-02-12;;;
zeynep.ak@eski.invalid;Zeynep Ak;2018-09-01;2025-01-31;soprano;
burak.ozturk@eski.invalid;Burak Öztürk;2022-10-03;2024-01-15;bas;
can.yildiz@ornek.com;Can Yıldız;2022-09-15;;;
```

> **Atladıklarım:** "Selin, Alto, 2020": üye listesinde iki Selin var (Selin Çakır, Selin Aydın); hangisi olduğunu bilmiyorum.
>
> **Tahmin ettiklerim:** Ayşe Demir katılım: yalnızca "Eylül 2019", 2019-09-01 yazdım. Zeynep Ak katılım: "2018 güz", 2018-09-01; ayrılış: "Ocak 2025", 2025-01-31. Mehmet Kaya: kayıtta "öğrenci (yarım)" yazıyor; bugünkü oranı bilmediğim için aidat_orani'nı boş bıraktım. İndirimliyse söyle, ekleyeyim.
>
> **Pasifleşecekler:** yok.
>
> **Koro şefinin aktaracağı satırlar:** Can Yıldız (yonetim). "Koro şefiyim" dediğin için ayrı blok yerine bu CSV'ye koydum; yönetim kurulundan biri aktarsaydı bu satır ikinci bir kod bloğuna giderdi.

Bu örnek şunları gösterir: yalnızca ayı bilinen tarihler, sezon tahmini, uydurulmuş `@eski.invalid` adresli eski üye, portaldaki kişilerde boş partisyon ve oran, belirsiz bir adın atlanması ve yönetim satırı uyarısı.

## Örnek dosya

`1-uyeler.csv` her sütunu gösteren kısa bir örnektir. Adlar ve adresler uydurmadır (`ornek.com`, `eski.invalid`).
