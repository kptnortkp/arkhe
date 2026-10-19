# Arkhe Portal — Plan

Koro Arkhe için üye portalı. Şimdilik sadece lokalde çalışır; ileride ücretsiz katmanlarla (Vercel + Turso) yayına alınır ve PWA olarak telefonlara kurulur.

## Kısıtlar
- Bütçe 0 TL. Ücretli servis yok.
- Git şimdilik yok. Kurulduğunda sadece kişisel hesap kullanılacak.
- Test yazılmayacak.
- ~30–60 korist, çoğunlukla telefondan kullanım.

## Teknoloji
| Katman | Seçim |
|---|---|
| Uygulama | Next.js 16 + TypeScript |
| Arayüz | Tailwind v4 + shadcn/ui, Fraunces + Geist fontları |
| Veritabanı | SQLite (libSQL) + Drizzle ORM → ileride Turso ücretsiz |
| Kimlik | Kendi yazdığımız e-posta + şifre, DB oturumları, davet linkleri |
| Mobil | PWA (Ana ekrana ekle), APK/App Store yok |

## Roller
| Yetki | Şef | YK | Korist |
|---|:-:|:-:|:-:|
| Yoklama başlat/kapat, düzelt | ✅ | ✅ | — |
| QR/kod ile "Geldim" | ✅ | ✅ | ✅ |
| Mazeret bildir | ✅ | ✅ | ✅ |
| Kendi devam geçmişi | ✅ | ✅ | ✅ |
| Tüm raporlar, CSV | ✅ | ✅ | — |
| Üye ekle, rol/partisyon ata, davet linki | ✅ | ✅ | — |
| Repertuvar ekle/düzenle | ✅ | ✅ | — |
| Repertuvar görüntüle | ✅ | ✅ | ✅ |

Partisyonlar: Soprano, Alto, Tenor, Bas.

## Çalışma şekli
Proje sanal bir yazılım ekibiyle yürür (bkz. `design/TEAM.md`): Product Owner, 2 senior UI/UX geliştirici, DBA, senior backend geliştirici; teknik lider ana oturum. Her faz:
1. **Planlama:** PO spec yazar → UX, UI, DBA, Backend aynı klasörde görüşlerini yazar → PO kararları kesinleştirir (`design/phase-<n>/`).
2. **Geliştirme:** teknik lider uygular.
3. **Uçtan uca test:** `npm run e2e` (Playwright, gerçek Chrome) + lint + typecheck.
4. **Review:** her rol kendi review dosyasını yazar; P1 bulgular düzeltilir, PO kabul (ACCEPTED) verince sonraki faza geçilir.

## Fazlar

### Faz 0 — İskelet ✅
### Faz 1 — Kimlik ve üyeler ✅
Giriş/çıkış, davet ve şifre yenileme linkleri, üye yönetimi, profil, güvenlik başlıkları, deneme sınırı. Ekip review'u Faz 2 planlamasıyla birlikte yapılır.

### Faz 2 — Çalışmalar ve devam takibi ✅ (review)
- Çalışma takvimi: tekil ve haftalık tekrar eden çalışmalar, tür (tutti / partisyon çalışması / konser / genel prova), yer.
- Korist: dönen 4 haneli kod ya da QR ile "Geldim"; önceden mazeret bildirme.
- Şef/YK: canlı yoklama ekranı, **elle devam girişi** (geldi / geç geldi / mazeretli / gelmedi), toplu işaretleme, geçmiş çalışmayı sonradan düzeltme.
- Raporlar: kişi ve partisyon bazlı devam yüzdesi, uyarı eşiği (ör. son 4 çalışmanın 2'si), CSV.

### Faz 3 — Repertuvar ve nota/MIDI kütüphanesi
- Eserler (besteci, düzenleyen, dil, süre, durum: çalışılıyor / konser repertuvarı / arşiv).
- Google Drive linkleri: nota (PDF), partisyon MIDI'leri, referans kayıt; partisyona göre süzme; Drive önizlemesi sayfa içinde.

### Faz 4 — Kayıt ödevleri
- Şef/YK haftalık ödev atar: eser, ölçüler, partisyonlar, son tarih, açıklama.
- Korist kaydını koro kayıt e-postasına gönderir (hazır konu satırlı mailto) ve uygulamada "Teslim ettim" der.
- Son tarih yaklaştıkça renk: yeşil → amber (≤3 gün) → kırmızı (≤24 saat / gecikmiş).
- Şef için teslim matrisi, geri bildirim notu.

### Faz 5 — Finans (gelir-gider)
- Gelir/gider kayıtları; kategori (aidat, sponsor, bilet, bağış, hibe / kostüm, salon, şef-korrepetitör ücreti, nota-telif, ulaşım-konaklama, festival katılım, organizasyon, ikram…), etkinliğe bağlama, belge linki.
- Üye aidat takibi; sponsorlar; etkinlik bazlı kâr/zarar; aylık bakiye ve CSV.
- Yetki: şef ve YK; korist sadece kendi aidat durumunu görür.

### Faz 6 — Marka, PWA ve son kabul
- Gerçek logo ve renk kimliği, PWA (ana ekrana ekle, ikonlar, çevrimdışı kabuk).
- Güvenlik gözden geçirmesi, performans, son uçtan uca test turu, PO kabulü.
- Tüm süreci anlatan sunum.
