# Phase 8b review: UX, UI, accessibility, Turkish copy and template pack

Reviewer: product/UI/UX designer. Date: 2026-10-21. Dev server 127.0.0.1:3100, signed in as `yk@` (board, the main persona), `sef@` and `korist@`.

## What was checked

| Area | 375 light | 375 dark | 1280 light | 1280 dark |
|---|---|---|---|---|
| `/ice-aktar` index (before and after imports) | ✓ | ✓ | ✓ | ✓ |
| Six type pages (header, prerequisites, prepare card, column reference) | ✓ | ✓ | ✓ | ✓ |
| Each `docs/ice-aktarma/*.csv` uploaded as-is through `Dosya seç` | ✓ | ✓ | ✓ | ✓ |
| Row errors, `Hataları kopyala` (clipboard read back) | ✓ | | | ✓ |
| Paste flow → clean preview → `Dikkat` → confirm → result (donemler, yoklama, hareketler) | ✓ | | | ✓ |
| Board user changing the conductor's row (`Bu kişiyi yalnızca koro şefi değiştirebilir.`) | ✓ | | | ✓ |
| `/ice-aktar/gecmis`, undo confirm, undone state | ✓ | | | ✓ |
| Imported rehearsal detail (`İçe aktarıldı` chip, roster) and imported entry detail (`Kayıt no` line) | ✓ | | | ✓ |
| `/calismalar?sekme=gecmis` (pager code read; only 13 past rehearsals exist, so it doesn't render), Profil entry point | ✓ | | | ✓ |
| `korist@` on `/ice-aktar` → redirected to `/`; `/ice-aktar/uye-listesi` → 403 | ✓ | | | |

No horizontal overflow on any screen. No page errors. Screenshots are in `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/p8breview/`. In the full-page shots the sticky header and the bottom tab bar sit mid-page; that comes from the screenshot tool, not the app.

**Sample files on a real portal:** `2-donemler.csv` and `5-aidat-donemleri.csv` pass the check cleanly. `1-uyeler.csv` gives 3 errors, `3-yoklama.csv` 4, `4-hareketler.csv` 4 (before opening 1 Ağu 2026) and `6-aidat-odemeleri.csv` 5. That's expected: their people are made up (`ornek.com`), and e2e AC 7 proves they import cleanly against the fictional cast. P3-9 covers how the README should say this.

**Cleanup:** every row I created was undone through the log (batches 371–380). No `UXR…` terms, rehearsals or entries remain. The ten undone batches stay in `İçe aktarma geçmişi` by design.

**Overall:** the screens are solid. Hierarchy is clear, the error loop works, the `Dikkat` block reads well in both themes, focus and live regions are right, and every target is 44 px. The weak spot is the template pack. It works for the tidy worked examples, but two prompts break on the data a real board member actually has.

---

## P1: fix before acceptance

### P1-1. If step 1 is skipped, the prompts for steps 3 and 6 quietly drop history and money

Where: `src/lib/import/defs/yoklama.ts` (rule "O tarihte henüz katılmamış … birini yazma"), `src/lib/import/defs/aidat-odemeleri.ts` (rule "Kişi o dönemde koroda olmalı … satır yazma"), and `docs/ice-aktarma/README.md` §Sıra.

A live member's `katilim_tarihi` in the member list is the day their portal account was created (`users.joinedAt` defaults to `now`; in the seed everyone shows 2025-08-31 or 2025-09-01). Picture a board member who skips step 1 because "the members are already in the portal" and then imports 2024 attendance or dues. Both prompts tell the AI to compare each row against those dates and **leave the row out**. The result:

- the CSV comes back nearly empty, or with every current member missing;
- the portal check is **clean**, because there's nothing left to object to;
- for step 6, real payments never reach the ledger. The only hint is a long `Atladıklarım` list in the chat, plus a balance that doesn't match the bank.

This contradicts the README promise "Sıra yanlışsa bir şey bozulmaz: kontrol hata verir". The portal would raise a clear error, but the AI filters the rows out before the portal ever sees them.

Fix:
1. In both prompts, replace the pre-filter rule with: `Kişinin katılım tarihi üye listesinde kaydın tarihinden sonraysa satırı yine de yaz ve sonda "Tarih çelişkisi" başlığıyla listele. Böyle 3'ten fazla kişi varsa CSV verme; bana "Önce 1. adımı (Üye geçmişi) yap ve üye listesini yeniden indir" de.` Keep the leave-date and wrong-part filters; those are real data.
2. In the README §Sıra, add this first, in bold: `Portaldaki katılım tarihi, kişinin portala davet edildiği gündür. Bundan eski bir kayıt aktaracaksan 1. adım zorunludur; yoksa yoklamalar ve ödemeler reddedilir.`
3. Type pages `yoklama` and `aidat-odemeleri`: when step 1 has never been imported, turn the `Önce:` line into the `Dikkat` style (`border-late/45 bg-late/10`) with the copy `Üye geçmişi henüz aktarılmadı. Portaldaki katılım tarihleri davet günü; daha eski kayıtlar reddedilir.` and a `1 · Üye geçmişi` link.

### P1-2. The step 6 prompt fails on a typical dues sheet and lacks the data its own rules need

Where: `src/lib/import/defs/aidat-odemeleri.ts:68` (placeholder), `src/lib/import/queries.ts:167` (`MEMBER_LIST_HEADER`), and the `talimat` route / `Yapay zekâ talimatını kopyala`.

I tested the prompt in my head against the most common source, a treasurer's grid:

```
Ad Soyad      | Eyl | Eki     | Kas | Ara
Ayşe Demir    | ✓   | ✓       |     | 300
Mehmet Kaya   | 150 | elden   |     |
Can Yıldız    | 900 (3 ay, havale 2.10) |  |
```

What the AI does when it follows the prompt literally:
- `✓`, `elden` and a bare `300` have **no date**, and most have **no account**. `tarih` and `hesap` are required "ödemede", and the honesty rule says "Zorunlu bir alan bilinmiyorsa o satırı CSV'ye koyma". So nearly every payment lands in `Atladıklarım`. Then the muafiyet rule ("o döneme HİÇ ödemesi olmayan her kişiye muaf") marks those same people **muaf**, which wipes out debts that were actually paid. The ledger also misses the cash.
- `✓` means "paid in full", but the AI can't turn it into an amount. The prompt doesn't give the period amounts, and the member list has no `aidat_orani`, so the AI can't tell 300 from 150. The rule "toplam, o dönemin tutarını (indirimli üyede indirimli tutarı) geçmesin" can't be applied with the data provided.
- `donem` says `aynen: <dönem adlarını buraya yaz, örnek: Eylül 2024, Ekim 2024 …>`, but the user is told to paste the prompt "olduğu gibi". The placeholder goes to the AI unchanged. If the AI guesses a name wrong, the error `Bu adla bir aidat dönemi yok. Dönem adları Finans › Aidat sayfasında.` can't be fixed inside the copy loop, because the AI can't see that page.

Fix:
1. The server fills the copied and downloaded prompt with live data (the routes already authorise managers). Replace the placeholder with a block like this:
   ```
   AİDAT DÖNEMLERİ (portalda olanlar; donem sütununa adı aynen yaz)
   - Eylül 2024: 2024-09-01 – 2024-09-30, son ödeme 2024-09-10, tam 300, indirimli 150
   - …
   ```
   Do the same for `etkinlik` in `hareketler.ts:121`: `ETKİNLİKLER: Bahar Konseri 2025, …` or `Portalda etkinlik yok; etkinlik sütununu boş bırak.` The static `.md` in `docs/` keeps a sentence saying the portal fills this list in itself.
2. Add an `aidat_orani` column (`tam` / `indirimli` / `muaf`) to the member list, plus one prompt line: `aidat_orani muaf olan kişiye ödeme ya da muaf satırı yazma.`
3. Add fallback rules to `BU DOSYAYA ÖZEL KURALLAR`:
   - `Ödendi işareti (✓, "ödedi", "tamam") dönemin tutarı demektir: üye listesinde aidat_orani indirimli ise indirimli tutar, değilse tam tutar.`
   - `Ödeme tarihi yoksa dönemin son ödeme gününü yaz ve "Tahmin ettiklerim"e ekle.`
   - `Hesap yazmıyorsa CSV vermeden önce bana bir kez sor: "Tarihi ya da hesabı olmayan ödemeler kasa mı banka mı?" Cevabımı hepsine uygula.`
   - `Kaynakta bir hücre boşsa ve bunun "ödemedi" mi "bilinmiyor" mu olduğu belli değilse muaf yazma; bana sor.`
4. Add a second worked example to `6-aidat-odemeleri.md` that uses the tick grid above.

---

## P2: fix in this phase if possible

### P2-1. The type page asks for the member list but has no button to download it

`[tur]/page.tsx` says `kayıtlarını ve üye listesini ekle`, but `Üye listesini indir` only exists on the index. The first `HOW_TO` step ("Veri içe aktar sayfasında Üye listesini indir.") sits inside the collapsed `Nasıl yapılır?`, and P3-1 explains why that disclosure is hard to spot. On a phone, that means going back and forth. **Fix:** on `uyeler`, `yoklama` and `aidat-odemeleri`, add a third outline button `Üye listesini indir` (`Users` icon) to the prepare card, in the same `flex-1` row. At 375 px, wrap it to its own full-width row under the two existing buttons. Next to it, keep the muted privacy line `Listede adlar ve e-postalar var. Yapay zekâya yalnızca işin için gerekeni ver.`

### P2-2. A board user's member file always fails the first time

The step 1 prompt puts management rows at the end of the CSV and lists them under `Yönetim satırları`, but they stay in the file. Historical join dates always count as a change, so every board user with a board colleague gets `Bu kişiyi yalnızca koro şefi değiştirebilir.` on the first check. The copy loop does recover. **Fix:** change the rule in `defs/uyeler.ts` to: `Rolü "sef" ya da "yonetim" olan kişilerin satırlarını bu CSV'ye koyma; onları ikinci, ayrı bir kod bloğunda ver ve başına "Koro şefinin aktaracağı satırlar" yaz. (Koro şefiysem tek dosya ver: ben "şefim" dersem.)` Update the worked example to match.

### P2-3. Record numbers collide when a file is split or corrected later, and the error gives the wrong advice

Step 6 says to split by `dönem` ("bir dönemin satırları iki parçaya bölünmesin"), but `kayit_no` is built from the **payment date**. Can's 900 paid on 2 Ekim covers Eylül, Ekim and Kasım. When those periods are split across two chats, each chat restarts numbering, so both files contain `O-20241002-1`. Step 4 has the same problem when a missed entry for an already-imported day is added later. The second file then fails with `RECORD_CONFLICT`: `Kayıt … daha önce farklı içerikle aktarıldı ya da portalda değişti; önce o aktarımı geri al.` That tells the user to undo a **correct** import. **Fix:**
- In both prompts: `Bu dosya bir bölümse kayit_no'nun başına bölümün etiketini ekle (örnek 2024B-O-20241002-1); etiketi ben veririm, vermezsem sor.`
- In `rules/common.ts:31`, when the stored item belongs to a different, still-active batch, use: `Kayıt <no> başka bir aktarımda (<tarih>) farklı içerikle var. O aktarım doğruysa bu satıra yeni bir kayit_no ver.` Keep the current message for "changed in the portal".

### P2-4. Historical ledger rows can double-count what's already in the portal

The README tells users to move the opening date back to where their records start. Hand-entered entries since the portal went live (1 Ağu 2026 here) stay in place. If the Excel ledger ran in parallel for a while, those weeks get counted twice. Unlike dues, nothing catches it, because there's no overpayment check for entries. **Fix:** in README §Açılış bakiyesi and in the step 4 prompt, add: `Portalda zaten girilmiş hareketleri dosyaya koyma: yalnızca <portalın ilk hareketinin tarihi>'nden önceki kayıtları yaz.` The server fills in the date the same way as in P1-2. Also add a `Dikkat` line in the clean preview when any imported row is dated on or after the earliest non-opening hand-made entry: `<k> satır, portalda elle girilmiş hareketlerin tarih aralığında. Aynı hareket iki kez sayılmasın.`

### P2-5. Imported attendance shows a false source and time

On an imported rehearsal, the roster shows `Elle · 19:30 · Demo` for imported present rows and `Otomatik · 21:30` for auto-absent rows (`src/components/attendance/marking-roster.tsx:334`, `METHOD_LABELS`). That claims "Demo Yönetim marked this by hand at 19:30", and that is not what happened. **Fix:** when the rehearsal is imported (the page already knows this, because it renders the chip), the row meta reads `İçe aktarıldı` with no time and no actor. A later hand correction keeps the normal `Elle · <saat> · <ad>`.

### P2-6. Result links go to today's data, not the imported data

`defs/hareketler.ts:173` links `Hareketler` to `/finans/hareketler`, which opens the current month (Ekim 2026). The imported Eylül row isn't on screen, and history from 2024 would be months away. `yoklama.ts:150` opens page 1 of the past list. **Fix:** build the links from the commit:
- `Hareketler` → `/finans/hareketler?ay=<YYYY-MM of the earliest imported entry>`;
- `Çalışmalar` → `/calismalar/<id>` when one rehearsal was imported, otherwise `/calismalar?sekme=gecmis&sayfa=<page holding the newest imported one>`;
- `Aidat` → that period.

### P2-7. The step 4 prompt has no fallback for a missing account

Many ledgers have a single amount column with no `Kasa` / `Banka`. `hesap` is required, so the honesty rule drops every row. **Fix:** add `Kaynakta hesap bilgisi yoksa CSV vermeden önce bana bir kez sor (hepsi banka mı, kasa mı, ya da hangi sütun). Uydurma.`

---

## P3: polish

1. **`Nasıl yapılır?` has no disclosure affordance.** `[tur]/page.tsx:152` sets `summary` to `inline-flex`, which removes Chrome's triangle, so it reads as a plain bold line. Add a `ChevronDown size-4` that rotates 180° on `[open]` (`group-open:rotate-180`), and `gap-1.5`.
2. **The undo confirm lists zero clauses.** `undo-button.tsx:64` renders `1 eklenen kayıt silinir, 0 güncellenen kayıt eski hâline döner.` Leave out any part that is 0: `1 eklenen kayıt silinir.`
3. **Log cards for pasted text look identical.** Every paste is logged as `yapistirilan-metin.csv`, so six cards differ only by hash. Add a muted line with the span: `2 Eyl 2026 – 2 Eyl 2026 · 1 hareket` / `10 Mar 2026 · 1 çalışma` / `2023–24 Güz`.
4. **`Sıradaki` skips step 1.** After steps 2–4 were imported, the index marks step 5 `Sıradaki` while step 1 still says `Henüz aktarılmadı`. Mark the lowest step that hasn't been imported, or after P1-1 give step 1 the `Dikkat` treatment.
5. **Prerequisite line on `aidat-odemeleri`.** The order is `1, 5, 0`; make it `0, 1, 5`. The `Ayarlar` link (its `min-h-11` in an inline run) leaves a gap in the middle of the sentence at 375. Put `Ayarlar` on its own line, or use `inline` with `py-3 -my-3` for the hit area.
6. **Column table at `md`+.** Example chips break mid-value (`2024-10-` / `08`). Add `whitespace-nowrap` to example code chips up to 16 characters. Rebalance the widths to 16/10/14/22/14/24 % so `Açıklama` isn't the tallest cell.
7. **Yoklama counts.** `3 eklenecek` counts file rows, while the commit writes 1 rehearsal and 22 marks. Change the yoklama tiles to `1 çalışma` / `3 satır` / `19 Gelmedi`, or label the tiles `satır eklenecek`.
8. **Worked examples don't agree with each other.** In `4-hareketler.md`, the Eylül dues come in as one 450 bank row on 20 Eyl. In `6-aidat-odemeleri.md`, Ayşe pays on 5 Eyl (banka) and Mehmet on 8 Eyl (kasa). Use the same dates and accounts in both, so a careful reader doesn't think one of them is wrong.
9. **README, sample files.** Add: `Örnek dosyalar uydurma kişilerle yazıldı; portalında yüklersen "Bu e-postayla üye yok" hatası verir. Yalnızca biçimi gösterir.`
10. **README, file rules.** `Hücrede noktalı virgül varsa…` should read `Hücrede ayırıcı (noktalı virgül ya da virgül) varsa…`. A comma-separated Sheets export with `Salon, kira` would otherwise break.
11. **README vs page HOW_TO.** The README says `yeni dosyayla 4. adımı tekrarla` and the page says `yeni metinle`. Use `yeni CSV ile` in both.
12. **Former members with no known part are dropped entirely** (step 1: "dördü de gerekli"). Their attendance and dues can't be imported later either. Let the AI ask once: `Partisyonu bilinmeyen eski üyeler var: <adlar>. Söylersen eklerim.`
13. **Sectionals in a tick matrix.** If a date has marks for only some parts, the prompt makes it `tutti`, and every other part becomes auto-absent. Add: `Bir tarihte yalnızca bazı partilerin işareti varsa bunun partisyon çalışması olup olmadığını bana sor.`
14. **Entry point on a phone.** `Veri içe aktar` is the last card on a long Profil page (about 4400 px). That's acceptable for a one-off tool, but also link it from the `Yönetim` tab or from the Finans › Ayarlar step 0 card, which already links back.
15. **Past list pager.** With two imported years (about 200 rehearsals), reaching 2024 means pressing `Daha eski` 3–4 times. Consider a later term filter. No change needed now.

Outside 8b, for the record: the entry detail page shows both `Düzenle` and `Düzelt` next to each other (Phase 8 work). The labels are too close for 30–60-year-old users. Raise it with the Phase 8 owner.

---

## Counts

P1: 2 · P2: 7 · P3: 15.
