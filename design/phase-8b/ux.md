# Phase 8b UX plan: Veri içe aktar (historical import)

Author: UX designer. Date: 2026-10-21. Reads: `po-spec.md` (D1–D16, AC 1–45), `design/phase-8/po-decisions.md` (D22: manager bottom bar becomes `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim`, `Üyeler` goes sidebar-only), `CLAUDE.md`, `design/TEAM.md`, and the code of the screens this phase copies from: `src/app/(portal)/yedek/page.tsx`, `src/app/(portal)/finans/ayarlar/page.tsx`, `src/app/(portal)/profil/page.tsx` (manager links), `src/components/backup/status-card.tsx`, `src/components/copy-button.tsx` (`copyText` already has the `execCommand` fallback), `src/components/confirm-dialog.tsx`, `src/components/repertoire/bulk-paste.tsx`, `src/lib/labels.ts`, `src/lib/finance/dues.ts` (`owesPeriod`, `periodNameOf` → `Eylül 2024`), `src/lib/attendance/roster.ts` (`isExpected`), `scripts/seed.ts` (term names `2026–27 Güz`).

Evidence (scratchpad, not the repo): `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/p8bux/`
- live pages as yk@: `_yedek-*`, `_finans_ayarlar-*`, `_profil-*` (`m` = 390 px, `d` = 1280 px; light and dark)
- mocks injected into the real shell (real sidebar, fonts, tokens) by `mock-import.js`: `m-375-index-{light,dark}.png`, `m-375-errors-{light,dark}.png`, `m-375-clean-{light,dark}.png`, `m-375-result-light.png`, `m-1280-clean-light.png`, `m-1280-errors-dark.png`, `m-1280-index-dark.png`. Every mock measured **0 px horizontal overflow** at 375.

**No token changes.** Everything maps onto existing tokens (§7). No data was changed; I only logged in as yk@ to look.

The most important part of this document is **§8, the template pack**: it is the thing the user asked for, and it decides whether a 55-year-old treasurer gets a valid file on the first try.

---

## 0. Replies

### 0.1 @po §7 Q3: one page or three? **One page, sections in place.** Where things sit at 375 px:

- `/ice-aktar/<slug>` is one page with numbered sections. The check result renders **directly below the upload card**, not at the bottom. The long column reference goes **last**, so it never pushes the preview off-screen.
- Order on the page (the mocks show it):
  1. header: back link, `ADIM 3 / 6`, title, one-line explanation, the prerequisite line (§3.2)
  2. `1 · Dosyanı hazırla`: the copy-prompt button (primary) and two download buttons
  3. `2 · Yükle ve kontrol et`: file picker and `Kontrol et`
  4. **the result area** (`#sonuc`), empty until a check
  5. `Sütunlar`: the column reference (stacked cards below `md`, a table from `md`)
- After `Kontrol et` returns, focus moves to the summary (`role="status"`, `tabIndex={-1}`, `scroll-mt-20`), and it is scrolled to the top of the viewport. At 375 the upload card ends near y≈830 (`m-375-errors-dark.png`), so without this jump the result is below the fold and the user thinks nothing happened.
- **Inside the error result:** the summary card, then the `Hatalar` card with `Hataları kopyala` **in its header row** (top, not after 100 items).
- **Inside the clean result:**
  1. the summary card (counts, then balances for finance)
  2. the `Dikkat` block
  3. `İçe aktar (<n> değişiklik)` and `Vazgeç`
  4. `Neler değişecek`, the first 50 effects

  The commit button sits **after the warnings and before the effects**. People read the warnings on their way to the button, and the button isn't 50 rows down. The effects are for whoever wants to check details.
- Why not three pages: the file lives in the browser between check and commit (D12). A route change loses the `File` object. A single page also makes "fix, re-pick, check again" a two-tap loop.

### 0.2 @po: proposals that change the spec (please settle in `po-decisions.md`)

1. **Allow pasting the CSV text as well as picking a file (strongest recommendation).** §6 lists "pasting text instead of a file" as out of scope. For this audience the hardest step isn't the AI, it's **saving the AI's code block as a UTF-8 `.csv` file**:
   - On a Mac, TextEdit saves RTF by default (`Biçim › Düz Metin Yap` first).
   - On Windows, Notepad needs `Farklı kaydet › Kodlama: UTF-8`, the name `…csv` and `Tüm dosyalar`.
   - On a phone there is no "save text as file" at all.

   That is where most volunteers will fail, and it's also where Windows-1254 files come from (AC 9).
   - **Proposal:** the upload card gets two tabs, `Dosya seç` | `Metni yapıştır`. The textarea (`Label`: `CSV metni`, 8 rows, `font-mono text-sm`) holds the pasted code block.
   - The server treats the text exactly like a UTF-8 file named `yapistirilan-metin.csv`, so the hash, limits (1 MB / 5000 rows), log and undo are identical. The text is never stored, and the browser keeps it between check and commit, like the file.
   - Copying from a chat code block is always UTF-8, so the encoding error simply disappears on this path.
   - If you keep it out: the README needs the save-as instructions in §8.1 per OS, and the page needs a `Nasıl kaydederim?` disclosure under the file picker with the same three lines.
2. **Show resulting balances on `aidat-odemeleri` too,** not only on `hareketler`. Dues payments are income, so the balance after step 4 is **lower than the bank statement** by every dues payment in the ledger. A treasurer who compares at step 4 will panic, or "fix" it. So:
   - **Step 4 line:** `İçe aktarımdan sonra` with `Kasa ₺2.500,00 → ₺3.412,50`, plus the hint `Banka ekstrenle karşılaştır. Aidat ödemeleri 6. adımda eklenince bu rakam artar.`
   - **Step 6:** the same block, with the hint `Şimdi banka ekstrenle tutmalı.`
   - Show **before → after**, not only after, so the size of the change is visible.
3. **Match `donem` (aidat-odemeleri) and `etkinlik` (hareketler) with D6 normalisation, not exactly.** Period names contain Turkish letters (`Eylül 2024`, `Şubat 2025`), and an AI or a US keyboard writes `Eylul 2024`. Sponsors are already matched this way, so this extends one rule, not a new one.
   - Ambiguity after normalisation stays an error.
   - The error for no match lists the 5 nearest names: `"Eylul 2025" adında aidat dönemi yok. Benzerleri: Eylül 2024, Ekim 2024 …`.
4. **AC 8, `@eski.invalid` wording for types 3 and 6.** The PO skeleton tells the AI to invent `ad.soyad@eski.invalid` in every file. That's right only for step 1. In steps 3 and 6, an invented address that wasn't created in step 1 gives `Bu e-postayla üye yok` on every row of that person.
   - The correct rule: **re-download `Üye listesini indir` after step 1** (it then contains the former members with their `@eski.invalid` addresses) and, in later files, **use only addresses from the list**.
   - The prompts in §8 say exactly that, and still contain the literal `@eski.invalid`, so AC 8's text check passes. Please amend AC 8's wording to "the `@eski.invalid` rule appropriate to the type".
   - The step-1 result also shows `Sıradaki adımlardan önce üye listesini yeniden indir; eski üyeler artık listede.` with the `Üye listesini indir` button (§3.6).
5. **Copied errors get a two-line preface,** so the user can paste them as-is into the same AI chat:

   > Portal bu CSV dosyasında aşağıdaki hataları buldu. Satır numaraları dosyanın satırlarıdır; 1. satır başlık satırıdır. Yalnızca bu hataları düzelt, öteki satırları ve kuralları değiştirme, dosyanın tamamını aynı başlıkla tek kod bloğunda yeniden ver. Düzeltemediğin satırı çıkar ve Atladıklarım listesine yaz.
   >
   > (blank line, then one error per line)

   AC 16's oracle becomes "the preface, a blank line, then 120 error lines". Without it, the user must explain to the AI what the line numbers mean, and they won't.
6. **Name-mismatch warnings are grouped** (`uyeler`). `Ad portaldakinden farklı` fires for every `Ayşe D.` ↔ `Ayşe Demir`. With 37 members that's 20+ lines that bury the one warning that matters (deactivations).
   - Render it as one line `<k> kişinin adı portaldakinden farklı (ad değişmez).`, with a `<details>` `Listeyi göster` that holds the lines in the D7 wording.
   - The deactivation warning is never collapsed.
7. **Confirm on `İçe aktar`,** always, with a short `AlertDialog` (§3.5). It restates type, file and count, plus deactivations when there are any. Import is rare and writes to live data, so one extra tap is the right trade. It also covers the case "I fixed the file but forgot to re-check".
8. **A `Sıradaki` hint on the index.** The lowest-numbered type that was never imported gets a `Sıradaki` chip on its card. It's a hint, not a lock. A choir with no terms just skips it, and the chip moves on after the next import of a higher type. The rule: the first card, in D1 order, with no import **and** a number above every imported type's number. If everything is imported, there's no chip.
9. **Wording polish** (the meaning is unchanged):
   - Index cards: `Henüz aktarılmadı` stays. `Son aktarım: <tarih> · <ad> · <n> satır` stays.
   - Commit pending: `Aktarılıyor…`, with the note `Büyük dosyalarda yarım dakika sürebilir. Sayfayı kapatma.`
   - Check pending: `Kontrol ediliyor…`
   - Stale file (AC 18): `Dosya kontrol edildikten sonra değişti. Yeniden kontrol et.` stays, plus the result area resets to idle.
   - The type-page explanation and prerequisite lines are in §3.2.

### 0.3 @ui §7 Q4 (clipboard fallback)

- `copyText` in `src/components/copy-button.tsx` already falls back to `execCommand`. Use it for both copy buttons.
- When it returns `false`, don't stop at the existing toast `Kopyalanamadı, metni elle seç.`: open a `Dialog` titled `Talimat` (or `Hatalar`) with a read-only `Textarea` (`rows=12`, `font-mono text-sm`). The text is pre-selected on open (`onFocus={e => e.currentTarget.select()}`, autofocus). The hint reads `Metin seçili; kopyalamak için basılı tut ya da Ctrl/⌘+C.`
- The prompt is 3–5 KB, so a hidden textarea is fine.
- Toasts on success: `Talimat kopyalandı.` / `Hatalar kopyalandı.` (AC 5, 16), not the generic `Kopyalandı.`. So `CopyButton` needs a `successText` prop, or the import page calls `copyText` itself.

### 0.4 @backend / @dba

- The page needs, per type, the last non-undone batch (`createdAt`, importer name, data row count) for the index cards. It also needs the last backup date from `backup_runs` (sent runs only).
- Each preview effect needs a **pre-formatted Turkish string** from the server (§3.4 lists the formats). The client doesn't rebuild them.
- Warnings come from the server as a typed list, `{ kind: "deactivate" | "absent" | "sponsor" | "name" | "duplicate-file", text, items? }`, so the client can apply the collapse rule of §0.2.6 without parsing text.

---

## 1. Entry points and navigation (D15)

There's no nav entry (AC 2). After Phase 8 the manager bar is `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim`, and Profil is reached from the avatar menu (top right on the phone, bottom of the sidebar on desktop). Nothing in this phase changes nav arrays.

| Where | What | Copy |
|---|---|---|
| `/profil`, manager links (`profile-manager-links`), **after** `Yedekleme` | a fourth row with the same markup (`min-h-14`, `rounded-2xl border bg-card`), icon `FileUp` | `Veri içe aktar` / hint `Eski kayıtları toplu aktar` |
| `/yedek`, after the intro paragraph's section list, as the **last** card | a small `CARD` with no heading, one line, and a link button `variant="outline" h-11 rounded-xl` | `Eski kayıtları portala aktarmadan önce buradan yedek al.` + `Veri içe aktar` |
| `/finans/ayarlar`, inside the `Açılış bakiyesi` card, under the description | one `text-sm text-muted-foreground` line with an inline link (`underline underline-offset-4`, wrapped in `inline-flex min-h-11 items-center`) | `Geçmiş kayıtları aktarıyorsan açılış tarihi, kayıtlarının başladığı gün olmalı. ` + link `Veri içe aktar` |
| `/ice-aktar` back link | as on `/yedek` (`ChevronLeft`, `-ml-2 min-h-11`) | `Profil` |
| `/ice-aktar/<slug>` and `/ice-aktar/gecmis` back link | same | `Veri içe aktar` |

From step 0 the user goes to `Finans › Ayarlar` and back. The `Ayarlar'a git` link carries `?geri=ice-aktar`. When that param is present, Ayarlar shows a second back link at the top (`‹ Veri içe aktar`), above the `FinanceNav`. Ayarlar is otherwise unchanged. If @ui finds that disproportionate, the inline link in the Ayarlar card is enough, and the param can go.

---

## 2. Index `/ice-aktar` (`Veri içe aktar`)

Mock: `m-375-index-light.png`, `m-375-index-dark.png`, `m-1280-index-dark.png`. The container is `max-w-2xl space-y-6`, like `/yedek`. It stays a single column at every width, because the order **is** the content. A two-column grid would read 1-2 / 3-4 and blur the sequence.

1. **Header** (`space-y-2`): back link `Profil`, then `h1.text-4xl.font-medium` `Veri içe aktar`, then the AC 3 intro (`max-w-prose text-sm text-muted-foreground`).
2. **`Başlamadan önce`** card (`CARD` = `space-y-3 rounded-2xl border bg-card p-4 md:p-6`), `h2.text-xl`. It holds an ordered list, `text-sm`, `space-y-1.5`, with the lead words in `font-medium`:
   1. `Yedek al.` then muted text: `Son yedek: 1 Eki 2026 · ` + link `Yedekleme`. With no backup: `Henüz yedek yok. ` + link. The date is `formatAuditDate`.
   2. `Adımları sırayla yap.` then muted text: `Üye tarihleri, kimin hangi çalışmada beklendiğini ve hangi aidatı borçlandığını belirler. Sıra yanlışsa bir şey bozulmaz; kontrol hata verir, önceki adımı yapıp aynı dosyayı yeniden yüklersin.`
   3. `Üye listesini yapay zekâya ver.` then muted text: `Kâğıtta ad var, portal e-postayla eşleştirir. Üye geçmişini aktardıktan sonra listeyi yeniden indir.`

   Then the button `Üye listesini indir` (`variant="outline" h-11 rounded-xl`, icon `Download`), and a muted `text-xs` line: `Listede adlar ve e-postalar var. Yapay zekâya yalnızca işin için gerekeni ver.` (risk 6).
3. **`Adımlar`** (`h2.text-xl`) and a `<ol>` of seven step cards, `space-y-2`. Each card:
   - Layout: `flex gap-3 rounded-2xl border bg-card px-4 py-3.5`, the whole card a `Link` (`min-h-16`, hover `bg-muted/50`), `ChevronRight` at the end.
   - Number disc: 32 px, `rounded-full bg-muted font-semibold tabular-nums`. When the type has a non-undone import, the disc is `bg-present text-present-foreground` with a `Check` icon, and the number moves into the accessible name (`1. adım, aktarıldı`).
   - Title `font-medium`. The description is `text-sm text-muted-foreground`. The state is `text-[13px]`, coloured `text-present-ink` when imported and `text-muted-foreground` otherwise.
   - `Sıradaki` chip (§0.2.8): `Badge` `bg-primary text-primary-foreground h-6`, and the card border is `border-primary/45`.

   The **step 0** card is not a link. It has a dashed border (`border-dashed`), the disc `0`, title `Açılış bakiyesi`, and description `Kayıtların başladığı günün kasa ve banka bakiyesi. Bugünkü bakiye değil.` Its state line:
   - when set: `Açılış: 1 Ağu 2026 · Kasa ₺2.500,00 · Banka ₺18.000,00`, in `text-late-ink`. It's a "check this" line, not an error, because the most likely mistake is a go-live date.
   - when not set: `Açılış bakiyesi girilmemiş.`, in `text-late-ink`.

   Then the button `Ayarlar'a git` (`outline h-10`, the card is the only target).

   The six type cards, with titles from D1 and these descriptions:

   | # | Title | Description (≤ 48 chars, one line at 375) |
   |---|---|---|
   | 1 | Üye geçmişi | `Katılım ve ayrılış tarihleri, eski üyeler.` |
   | 2 | Çalışma dönemleri | `Güz ve bahar dönemleri.` |
   | 3 | Çalışmalar ve yoklama | `Geçmiş çalışmalar ve kimin geldiği.` |
   | 4 | Finans hareketleri | `Gelir, gider ve virmanlar (aidat hariç).` |
   | 5 | Aidat dönemleri | `Aidat dönemleri ve tutarları.` |
   | 6 | Aidat ödemeleri ve muafiyetler | `Kim hangi dönemi ödedi, kim muaf.` |

4. A link `İçe aktarma geçmişi` (`inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline`, `ChevronRight`).

---

## 3. Type page `/ice-aktar/<slug>`

Mocks: `m-375-errors-*`, `m-375-clean-*`, `m-375-result-light.png`, `m-1280-clean-light.png`, `m-1280-errors-dark.png`.

### 3.1 Layout

- The container is `max-w-3xl space-y-6`.
- Below `md`, the primary buttons are `w-full`. **From `md`** they are `w-auto self-start` (`m-1280-clean-light.png` shows full-width buttons at 1280 look like banners; don't ship that).
- The cards use the `/yedek` `CARD` class.

### 3.2 Header

- Back link `Veri içe aktar`.
- Eyebrow `ADIM <n> / 6` (`text-[13px] font-medium tracking-wide text-muted-foreground`). It is not a heading.
- `h1` with the type title.
- An explanation, one `text-sm text-muted-foreground` paragraph:

  | Slug | Explanation |
  |---|---|
  | uyeler | `Üyelerin katılım ve ayrılış tarihlerini düzeltir, ayrılmış eski üyeleri ekler. Boş hücre "değiştirme" demektir. Eski üyeler portala giriş yapamaz.` |
  | donemler | `Raporlarda seçtiğin çalışma dönemlerini oluşturur (örneğin 2024–25 Güz).` |
  | yoklama | `Geçmiş çalışmaları kapanmış hâlde, yoklamalarıyla oluşturur. Listede olmayan beklenen kişiler Gelmedi sayılır.` |
  | hareketler | `Gelir, gider ve virmanları ekler. Aidat ödemeleri 6. adımda, kişi ve dönemle birlikte aktarılır.` |
  | aidat-donemleri | `Aidat dönemlerini ve tutarlarını oluşturur. Aynı tutarlı ardışık aylar için Aidat › Aylık toplu oluştur daha hızlı.` |
  | aidat-odemeleri | `Kimin hangi dönemi ne zaman ödediğini ve eski borçlardan kimin muaf tutulduğunu ekler.` |

- **Prerequisite line** (`rounded-xl bg-muted px-3 py-2 text-[13px]`): `Önce:` followed by the prerequisite steps, each with its state. A missing prerequisite isn't an error: the check will explain the row errors.
  - uyeler: no line.
  - donemler: no line.
  - yoklama: `1 · Üye geçmişi` (`✓ <tarih>` or `henüz yok`). `2 · Çalışma dönemleri` is shown but labelled `isteğe bağlı, raporlar için`.
  - hareketler: `0 · Açılış bakiyesi <tarih>. Kayıtların bundan önce başlıyorsa önce tarihi geri çek.` + link `Ayarlar`.
  - aidat-donemleri: `1 · Üye geçmişi`.
  - aidat-odemeleri: `1 · Üye geçmişi`, `5 · Aidat dönemleri`, `0 · Açılış bakiyesi <tarih>`.
- **Board-only note** on `uyeler`, for board users only, `text-[13px] text-muted-foreground`: `Yönetim kurulu olarak yalnızca korist satırlarını değiştirebilirsin; şef ve yönetim üyelerinin satırlarını koro şefi aktarır.` (AC 25, so the refusal isn't a surprise.)

### 3.3 `1 · Dosyanı hazırla`

- `h2` `1 · Dosyanı hazırla`.
- Text: `Talimatı kopyala, yapay zekâ sohbetine (ChatGPT, Claude, Gemini) yapıştır, kayıtlarını ve üye listesini ekle. Gelen CSV'yi buraya yükle.`
- Buttons:
  1. `Yapay zekâ talimatını kopyala`, the **primary** button (icon `Copy`), with the toast `Talimat kopyalandı.`
  2. A row of two `outline` buttons, `flex-1` each below `md`: `Örnek dosyayı indir` (`Download`) and `Talimatı indir` (`FileText`). At 343 px both labels fit at `text-sm` (measured `Örnek dosyayı indir` ≈ 128 px, `Talimatı indir` ≈ 92 px, plus icon and padding < 168 px each). The mock used shorter labels; keep the AC 5 labels.
- A `<details>` `Nasıl yapılır?` (`text-sm`, summary `min-h-11`) that expands to the 5 steps of §8.1 (README "Yapay zekâyla çalışmak"). It's closed by default.

### 3.4 `2 · Yükle ve kontrol et` and the result area

**Upload card.**
- `h2` `2 · Yükle ve kontrol et`. Tabs `Dosya seç` | `Metni yapıştır` only if §0.2.1 is accepted (`Tabs`, `h-11` triggers).
- **File:** a visible `Label` `Dosya seç (.csv)` (AC 43) and a native `<input type="file" accept=".csv,text/csv">`, visually hidden. A drop zone (`border border-dashed border-input rounded-xl p-3 min-h-14`) is the `label` and holds:
  - a fake button `Dosya seç`
  - the chosen name (`truncate`) with the size on a second line (`text-xs text-muted-foreground`, `48 KB`)
  - or, before a choice, `Henüz dosya seçilmedi.`

  Drag-and-drop onto it works on desktop.
- **Choosing a new file resets the result area to idle.** A stale preview must never sit under a different file name.
- `Kontrol et`: primary, disabled until a file or text is there. While pending: `Kontrol ediliyor…`, with a spinner and `aria-busy`.
- Hint `Kontrol hiçbir şey yazmaz.` (`text-xs text-muted-foreground`).

**Result area `#sonuc`.** Its states, in order of likelihood:

| State | What renders |
|---|---|
| idle | nothing |
| **file-level error** (encoding, header, size, empty: AC 9–11) | One error card, `border-absent/40 bg-absent/8` (the `StatusCard` failed style), icon `CircleAlert text-absent-ink`. It shows the bold server message (e.g. `Dosya UTF-8 değil. Excel'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan UTF-8 iste.`), then the muted `Hiçbir şey yazılmadı.` For unknown and missing columns it adds a `Geçerli sütunlar:` line with the header in `font-mono text-xs break-all`, and a `CopyButton` `Başlığı kopyala`. No row list. |
| **row errors** (AC 16) | Summary card (as above, the failed style): `212 satır okundu · 5 hata.` (bold) / `Hiçbir şey yazılmadı. Dosyayı düzeltip yeniden yükle.` Then the `Hatalar` card: the header row has `h2` and the button `Hataları kopyala` (`outline`, right-aligned; below 360 px it wraps under the heading, `flex-wrap`), the hint `Kopyala ve aynı yapay zekâ sohbetine yapıştır; düzeltilmiş dosyanın tamamını ister.`, and an `<ol>` (a real list, AC 43). Each `<li>` (`py-2.5 border-t text-sm`) shows `Satır 7` (`font-semibold tabular-nums`) · the column in a `code` chip (`bg-muted rounded px-1 text-[13px]`), and the message on the next line. Several errors on one line are separate `<li>`s, in file order. After 100: a muted `<li>` `ve 20 hata daha (hepsi kopyalanır)`. No `İçe aktar`. |
| **clean, with changes** (AC 17) | (1) **Summary card**, plain `CARD`: `184 satır okundu`, then three tiles (`grid grid-cols-3 gap-2`, each `rounded-xl bg-muted py-2 text-center`, number `text-[22px] font-semibold tabular-nums`, label `text-xs text-muted-foreground`): `eklenecek` / `güncellenecek` / `değişmeyecek`. For **hareketler and aidat-odemeleri**, below a `border-t`: `İçe aktarımdan sonra`, then rows `Kasa ₺2.500,00 → ₺3.412,50` and `Banka …` (`MoneyAmount kind="balance"`, `justify-between`), then the hint of §0.2.2. For **yoklama**: a line `12 çalışma · 9 tutti, 2 partisyon, 1 konser`. The screen-reader text is the AC 17 sentence verbatim (`sr-only`), so the oracle matches. (2) **`Dikkat`**, only if there are warnings: `rounded-2xl border border-late/45 bg-late/10 p-4`, `h2.text-lg` `Dikkat`, `ul.list-disc pl-5 text-sm space-y-1.5`. Its order: **deactivations first** (in bold, all names, never collapsed), then auto-absences, new sponsors, the already-imported-file line, and the grouped name mismatches (§0.2.6). (3) `İçe aktar (181 değişiklik)`, primary, plus `Vazgeç` (`ghost`; resets to idle and clears the file input). (4) **`Neler değişecek`** card: `h2.text-lg`, muted `İlk 50 satır.` (or `Tümü.` when ≤ 50), then a `ul` of server-formatted effects (`py-2 border-t text-sm`). |
| clean, nothing to change | A plain card with `CircleCheck text-present-ink`: `Değişecek bir şey yok; bu dosyadaki her şey zaten portalda.` No button. |
| committing | The button shows `Aktarılıyor…` and is disabled. The confirm dialog is closed. The `Vazgeç` button and the file input are disabled. The note `Büyük dosyalarda yarım dakika sürebilir. Sayfayı kapatma.` appears under the button. |
| commit refused (hash changed / DB changed) | The hash case shows the file-level error card with `Dosya kontrol edildikten sonra değişti. Yeniden kontrol et.` The DB-changed case shows the row-error state, with the summary prefixed `Kontrolden sonra portalda bir şey değişti. ` |
| **result** (AC 18) | It replaces the whole result area **and the upload card's selection is cleared**. It's a card in the success style (`border-present/40 bg-present/8`, `role="status"`, focused): `İçe aktarıldı: 181 eklendi, 0 güncellendi, 3 değişmedi.` (bold), then the muted `Yanlış görürsen İçe aktarma geçmişi'nden geri alabilirsin.` (the link goes to `/ice-aktar/gecmis`). Then the type links (`outline h-11`, `flex-wrap gap-2`), then a primary `Sıradaki: <n> · <başlık>` (→ next type page; on step 6 → `/ice-aktar`, labelled `Adımlara dön`). On **uyeler**, an extra line above the links: `Sıradaki adımlardan önce üye listesini yeniden indir; eski üyeler artık listede.` with `Üye listesini indir`. |

**Result links per type** (the AC 18 list, mapped):

| Slug | Links |
|---|---|
| uyeler | `Üyeler`, `Aidat` |
| donemler | `Raporlar` |
| yoklama | `Çalışmalar`, `Raporlar` |
| hareketler | `Hareketler`, `Finans raporu` |
| aidat-donemleri | `Aidat` |
| aidat-odemeleri | `Aidat`, `Finans raporu` |

**Effect line formats** (server-built, `Intl` short dates `7 Eki 2025`):
- uyeler:
  - update: `Ayşe Demir: katılım 19 Eki 2026 → 1 Eyl 2019`; several fields are joined by ` · `
  - former member: `Zeynep Ak (eski üye, Soprano): 1 Eyl 2018 – 31 Oca 2026`
  - deactivation: `Burak Öztürk: pasifleşir, ayrılış 15 Oca 2024`
- donemler: `2024–25 Güz: 16 Eyl 2024 – 31 Oca 2025`
- yoklama: `7 Eki 2025 19:00 Tutti · Mülkiye Salonu: 31 kişi, 4 Gelmedi (listede yok)`. This is one line per **rehearsal**, not per row, so 50 lines cover a whole season.
- hareketler: `5 Eyl 2024 · Gider · Salon / mekân · ₺1.500,00 · Banka`; transfer `14 Eyl 2024 · Virman · Banka → Kasa · ₺2.000,00`
- aidat-donemleri: `Eylül 2024: 1–30 Eyl 2024, son ödeme 10 Eyl · ₺300,00 (indirimli ₺150,00)`
- aidat-odemeleri: `Can Yıldız · Ekim 2024 · ₺300,00 · Banka · 2 Eki 2024`; waiver `Zeynep Ak · Ekim 2024 · Muaf (Geçmiş dönem borcu …)`

### 3.5 `İçe aktar` confirm

`ConfirmDialog` (Cancel first, can't close while pending):
- Title: `<n> değişiklik aktarılsın mı?`
- Description: `<Tür adı> · <dosya adı>. Hepsi birden yazılır; sonra İçe aktarma geçmişi'nden geri alabilirsin.`
- If there are deactivations, an extra paragraph in `children`, `text-sm font-medium text-absent-ink`: `<k> kişi pasifleşecek ve oturumları kapanacak.`
- Actions: `Vazgeç` / `İçe aktar` (default variant; **not** destructive red, because it's an add).
- A double tap is blocked by the dialog and the pending state; the server is idempotent per AC 18 anyway.

### 3.6 `Sütunlar` (column reference, AC 5)

- `h2` `Sütunlar`, then the muted `Başlık satırı:` and the header in a `pre`-like block (`font-mono text-xs bg-muted rounded-xl p-3 break-all whitespace-pre-wrap`), plus a `CopyButton` `Başlığı kopyala`.
- **Below `md`:** one card per column (`ul space-y-2`, `rounded-xl border p-3`):
  - line 1: `code` column name (`font-mono font-medium`) and a chip: `Zorunlu` (`bg-primary/10 text-primary`), `Koşullu` (`bg-late/18 text-late-ink`), or none for optional
  - then `dl` pairs, `text-sm`: `Biçim`, `İzin verilen değerler` (codes as `code` chips, `flex-wrap gap-1`), `Örnek`, `Açıklama`
- **From `md`:** a real `Table` with the AC 5 headers: `Sütun`, `Zorunlu`, `Biçim`, `İzin verilen değerler`, `Örnek`, plus `Açıklama` as the sixth column. The table has `table-fixed` with column widths 18/12/14/24/14/18 %. Codes wrap.
- `Zorunlu` cell values are `Evet`, `Hayır`, or the condition (`Eski üyede`, `Virmanda`, `Ödemede`…), which are then shown as `Koşullu` chips on the phone, with the condition in `Açıklama`.
- The content is the `.md` table of §8, from one definition (D16).

---

## 4. Log `/ice-aktar/gecmis` (`İçe aktarma geçmişi`)

- The container is `max-w-2xl space-y-6`, with the back link `Veri içe aktar` and `h1`.
- The intro (muted): `En son aktarımı geri alabilirsin. Daha eskisine dönmek için önce sonrakileri geri al.`
- **List** (`ol space-y-2`, newest first, 50 per page, `Daha eski` / `Daha yeni` links in the same style as AC 36). Each item is a `CARD` with `p-4`:
  - line 1: `font-medium` `<Tür adı>`, plus the status chip on the right: `Aktarıldı` (`bg-present/14 text-present-ink`) or `Geri alındı` (`bg-muted text-muted-foreground`)
  - line 2 (muted `text-sm`): `21 Eki 2026 20:14 · Demo Yönetim`
  - line 3: the file name `truncate` (`text-sm`), and on the next line `181 eklendi · 0 güncellendi · 3 değişmedi` (`tabular-nums`)
  - line 4 (`text-xs text-muted-foreground font-mono`): `SHA-256 3f9a1c0be27d…` (12 chars)
  - when undone, a muted `text-sm` line: `Geri alındı · Demo Şef · 21 Eki 2026 20:40`
  - **`Geri al`**: only on the latest non-undone batch, only for its importer or the conductor. It's an `outline h-11` button, icon `Undo2`, at the bottom of the card. For other managers on the latest batch, show the muted line `Bunu yalnızca yapan kişi ya da koro şefi geri alabilir.` instead, so nobody wonders why there is no button.
- **Confirm** (`ConfirmDialog`): title `Bu içe aktarma geri alınsın mı?`, description `<a> eklenen kayıt silinir ya da iptal edilir, <u> güncellenen kayıt eski hâline döner.` (AC 38). For finance and dues payments, an extra line: `Hareketler silinmez, "İçe aktarma geri alındı" nedeniyle iptal edilir.` Actions: `Vazgeç` / `Geri al` (`destructive`).
- **Refusal** (D13 messages): an inline `FormMessage` (`role="alert"`, `text-absent-ink`) **inside that card**, under the button. It isn't a toast, because the message names a record and the user must read it and then go fix it.
- **Success:** the toast `İçe aktarma geri alındı.`, the card's chip turns `Geri alındı`, and `Geri al` moves to the next batch down, if it qualifies.
- **Empty:** a `CARD` with `Henüz içe aktarma yapılmadı.` and the link `Adımlara dön`.

---

## 5. Markers and paging outside `/ice-aktar` (AC 35, 36)

- **Rehearsal detail:** the chip `İçe aktarıldı` sits in the meta row next to the type, managers only. Style: `Badge variant="outline"` with `text-muted-foreground`, icon `FileUp` `size-3.5`. It's neutral on purpose: imported data isn't "different" data.
- **Finance entry detail:** a muted `text-sm` line under the audit line: `İçe aktarıldı · Kayıt no 20240905-1`. Managers only (members can't open entries anyway).
- **Lists, reports and CSVs:** no marker (AC 35).
- **`/calismalar` past list:** below the list, a `nav aria-label="Geçmiş çalışmalar sayfaları"` holds two links, `‹ Daha yeni` (left) and `Daha eski ›` (right), as `outline h-11 rounded-xl`, with `justify-between`. The one that doesn't apply isn't rendered (not disabled). Between them, muted text: `61–120 / 130`.

---

## 6. Accessibility and phone checks (AC 43)

- Every button and link ≥ 44 px (`h-11` / `min-h-11`). The step cards are `min-h-16`.
- The summary is `role="status"` and focused after the check. The result card is `role="status"` and focused after the commit. Errors are an `<ol>`.
- The file input has a visible `Label` `Dosya seç (.csv)`. The hidden input is `sr-only`, not `display:none`, so it stays focusable, and the drop zone shows `focus-within:ring-3 ring-ring/50`.
- The column-reference table below `md` uses cards (no `overflow-x`). The `pre` header uses `break-all`, because a 110-character header line would otherwise overflow at 375. That's the one real overflow risk on this page.
- Colour is never the only signal: errors carry `Satır n` text and icons, the chips carry words, and the done disc carries a `Check` icon and the label `aktarıldı`.
- The `Dikkat` block uses `text-foreground` on `bg-late/10` (body contrast stays AA in both themes, as seen in `m-375-clean-dark.png`), not `text-late-ink` for the body.

---

## 7. Token map (no new tokens)

| Meaning | Classes |
|---|---|
| Error card (file error, error summary) | `border-absent/40 bg-absent/8`, icon `text-absent-ink` (the `StatusCard` failed style) |
| Warning block `Dikkat` | `border-late/45 bg-late/10`, title `text-foreground`, body `text-sm` |
| Success / done | `border-present/40 bg-present/8`; disc `bg-present text-present-foreground`; chip `bg-present/14 text-present-ink` |
| Neutral tiles, prerequisite line, code chips | `bg-muted`, `text-muted-foreground` |
| `Sıradaki` chip, `Zorunlu` chip | `bg-primary text-primary-foreground` / `bg-primary/10 text-primary` (navy in light, gold in dark) |
| `Koşullu` chip | `bg-late/18 text-late-ink` |
| Balances | `MoneyAmount kind="balance"` |

---

## 8. The template pack (content quality bar)

### 8.0 The bar

A board member who has never seen a CSV must be able to do this:
1. Copy the prompt.
2. Paste it into a free ChatGPT, Claude or Gemini chat.
3. Attach their Excel or a photo of a paper sheet, plus `Üye listesini indir`.
4. Get back something that passes `Kontrol et` with 0 errors, or with only errors that `Hataları kopyala` gets fixed in one more round.

Concretely, every prompt and `.md` must:

1. **Be self-contained.** One copy holds everything: the exact header, every code with a Turkish hint of what it means, the date, time and amount formats, and the type's special rules. The AI must never need the README.
2. **Say what to skip, not just what to write.** The worst failure is a plausible wrong row. Each type names the source rows that **don't belong** (opening balance lines, dues in the ledger, the conductor in attendance, ambiguous first names) and sends them to a closing `Atladıklarım` list.
3. **Ask for an honest closing report** with fixed headings the user can scan: `Atladıklarım`, `Tahmin ettiklerim` (approximations, such as a month-only date turned into the 1st), and, for members, `Pasifleşecekler`.
4. **Protect current data from historical records.** Old sheets carry old voice parts and old rates. Prompt 1 tells the AI to leave `partisyon` and `aidat_orani` **blank** for people already in the portal, unless the user says otherwise. Otherwise a 2019 sheet silently moves today's sopranos back to alto.
5. **Be deterministic about `kayit_no`.** It is built from the data (`<YYYYMMDD>-<sıra>`), not from a counter, so re-asking the AI after a fix produces the same numbers. Re-importing then reads as `değişmeyecek`, not as a conflict, and two files of different seasons never collide.
6. **Handle long outputs.** Chat AIs cut off around a few hundred lines. The prompt says: give a downloadable file if you can; otherwise stop and tell me how to split it, and never split one rehearsal (or one day of the ledger) across two parts.
7. **Use Turkish a volunteer understands:** `hücre`, `satır`, `sütun`, `başlık satırı`, and `kod` only where it means "one of these words". No `string`, no `enum`, no `null`.
8. **Examples are fictional** and consistent across the six types: the same cast (§8.2), the `ornek.com` / `eski.invalid` domains, and the 2024–25 / 2025–26 seasons. A reader can follow one person through all six files.

### 8.1 README (`docs/ice-aktarma/README.md`): sections and key text

1. `# Eski kayıtları portala aktarmak`. One paragraph: what it is, that `Kontrol et` writes nothing, and that one file goes in all at once or not at all.
2. `## Sıra`: the D1 table, with one "neden" line per step. Plus the bold rule: **`Üye geçmişini aktardıktan sonra Üye listesini indir'i yeniden kullan; eski üyelerin adresleri artık listede.`**
3. `## Açılış bakiyesi (0. adım)`: the D10 warning verbatim, then a worked line:
   > Kayıtların 1 Eylül 2024'te başlıyorsa, Finans › Ayarlar'da tarihi 2024-09-01 yap ve o sabahki kasa ve banka bakiyesini yaz. Defterdeki "devreden" satırı budur; onu hareket olarak aktarma.
4. `## Yapay zekâyla çalışmak`, five steps:
   1. `Veri içe aktar sayfasında Üye listesini indir.`
   2. `Adımın sayfasında Yapay zekâ talimatını kopyala; yeni bir sohbete yapıştır.`
   3. `Kayıtlarını ekle (Excel dosyası, Sheets'ten kopyalanmış tablo ya da kâğıdın fotoğrafı) ve üye listesini ekle. Gönder.`
   4. `Gelen CSV'yi kaydet` (or `kopyala ve Metni yapıştır'a yapıştır`, if §0.2.1 is accepted). Then `Kontrol et`.
   5. `Hata varsa Hataları kopyala, aynı sohbete yapıştır, yeni dosyayla 4. adımı tekrarla. Sonunda yapay zekânın "Atladıklarım" listesini oku: o kayıtları elle gir ya da kaynağı düzelt.`
5. `## Dosyayı kaydetmek`:
   - ChatGPT/Claude: `İndir` when they give a file.
   - Excel: `Dosya › Farklı Kaydet › CSV UTF-8 (Virgülle ayrılmış)`. Not plain `CSV`; that's Windows-1254 and breaks `ş ğ ı`.
   - Google Sheets: `Dosya › İndir › Virgülle ayrılmış değerler (.csv)`.
   - Windows Not Defteri: `Farklı kaydet`, `Kayıt türü: Tüm dosyalar`, name `yoklama.csv`, `Kodlama: UTF-8`.
   - Mac Metin Düzenleyici: `Biçim › Düz Metin Yap`, then `Kaydet`, name `yoklama.csv`, `Düz metin kodlaması: Unicode (UTF-8)`.
6. `## Dosya kuralları`: D3–D6 in plain words, with examples (`2025-10-07` or `07.10.2025`, never `07/10/2025`; `1250,50`, never `1.250,50`).
7. `## Eski aidatlar borç görünmesin`: risk 4. After the periods, generate `muaf` rows, using the ready sentence in §8.3.6.
8. `## Büyük dosyalar`: at most 5000 rows / 1 MB. Split per season. Don't split one rehearsal or one ledger day. In the attendance file, writing only who came, came late or was excused halves the rows.
9. `## Kişisel veriler`: risk 6, one paragraph.
10. `## Geri almak`: the D13 stack, in three sentences.

### 8.2 The fictional cast (used in every example)

Portal state assumed by the examples (this is what `Üye listesini indir` would return):

```
eposta;ad;partisyon;rol;durum;katilim_tarihi;ayrilis_tarihi
ayse.demir@ornek.com;Ayşe Demir;alto;korist;aktif;2026-10-19;
mehmet.kaya@ornek.com;Mehmet Kaya;tenor;korist;aktif;2026-10-19;
elif.sahin@ornek.com;Elif Şahin;soprano;korist;aktif;2026-10-19;
can.yildiz@ornek.com;Can Yıldız;bas;yonetim;aktif;2026-10-19;
selin.cakir@ornek.com;Selin Çakır;soprano;korist;aktif;2026-10-19;
selin.aydin@ornek.com;Selin Aydın;alto;korist;aktif;2026-10-19;
deniz.sef@ornek.com;Deniz Arslan;;sef;aktif;2026-10-19;
```

Former members, not in the portal yet: Zeynep Ak (soprano, 2018 autumn – January 2026) and Burak Öztürk (bas, 3 Oct 2022 – 15 Jan 2024).

**State after step 1**, which the examples of steps 3–6 assume. It comes from example 8.3.1 plus one follow-up round: the user answered the AI's `Atladıklarım` with the Selins' and Elif's dates and Mehmet's rate, and the conductor imported Can's row.

| Kişi | katilim | ayrilis | partisyon | oran |
|---|---|---|---|---|
| Ayşe Demir | 2019-09-01 | | alto | tam |
| Mehmet Kaya | 2021-02-12 | | tenor | indirimli |
| Elif Şahin | 2024-10-01 | | soprano | tam |
| Can Yıldız (yönetim) | 2022-09-15 | | bas | tam |
| Selin Çakır | 2020-09-01 | | soprano | tam |
| Selin Aydın | 2020-09-01 | | alto | tam |
| Zeynep Ak (eski üye) `zeynep.ak@eski.invalid` | 2018-09-01 | 2026-01-31 | soprano | tam |
| Burak Öztürk (eski üye) `burak.ozturk@eski.invalid` | 2022-10-03 | 2024-01-15 | bas | tam |
| Deniz Arslan (şef) | not changed | | | |

Opening balance: 2024-09-01, Kasa ₺1.200,00, Banka ₺15.300,00. Dues periods: Eylül–Kasım 2024 from example 8.3.5.

### 8.3 Per type

The shared prompt frame (each type fills `<…>`). It meets AC 8 for every type: header, `;` + UTF-8, the three format examples, every code, the "don't invent" rule, the `@eski.invalid` rule where there's `eposta`, and the "list what you skipped" rule.

```text
Aşağıdaki kayıtlarımı Arkhe Mülkiye Çoksesli Korosu portalının "<Tür adı>" içe aktarma dosyasına çevir.

ÇIKTI
- Yalnızca bir CSV ver, tek bir kod bloğunun içinde. Dosya oluşturabiliyorsan aynı içeriği "<n>-<slug>.csv" adlı, UTF-8 kodlu bir dosya olarak da ver.
- Ayırıcı noktalı virgül (;), kodlama UTF-8. Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) olduğu gibi yaz.
- İlk satır tam olarak şu başlık olsun. Sütun ekleme, çıkarma, adını değiştirme:
<başlık satırı>
- Her kayıt bir satır. Bilinmeyen hücreyi boş bırak (iki noktalı virgül yan yana). Hücrede noktalı virgül varsa hücreyi çift tırnağa al. Bir hücrede satır sonu olmasın.
- Çıktı uzunsa (yaklaşık 300 satırdan fazla) yarıda kesme: dosya olarak ver. Dosya veremiyorsan dur ve bana kayıtları nasıl bölmem gerektiğini söyle (her parça ayrı ay ya da sezon olsun; <bölünmeyecek birim> iki parçaya bölünmesin).

BİÇİMLER
- Tarih: YYYY-AA-GG (örnek 2025-10-07). 07/10/2025, 7 Ekim 2025 ya da 25-10-07 yazma.
- Saat: SS:DD, 24 saat (örnek 19:00).
- Tutar: binlik ayırıcı, ₺, TL ve boşluk olmadan; kuruş varsa virgülle (örnek 1250,50 ya da 1250). Eksi işareti yok.
- Kod sütunlarında yalnızca aşağıda yazan değerleri kullan.

SÜTUNLAR
<her sütun için bir satır: `ad` (zorunlu | isteğe bağlı | koşul): ne yazılır. İzin verilen: a, b, c.>

BU DOSYAYA ÖZEL KURALLAR
<türe özel maddeler>

DÜRÜSTLÜK
- Bilmediğin bir değeri uydurma; boş bırak. Zorunlu bir alan bilinmiyorsa o satırı CSV'ye koyma.
- Bir kişiyi üye listesinde kesin eşleştiremiyorsan (örneğin listede iki "Selin" var) tahmin etme; satırı koyma.   <- only in types 1, 3, 6
- CSV'den sonra, kod bloğunun dışında şu başlıklarla yaz:
  "Atladıklarım": CSV'ye koymadığın her kayıt, kaynaktaki hâliyle ve nedeniyle.
  "Tahmin ettiklerim": yaklaşık yazdığın her değer (örneğin yalnızca ay biliniyordu, ayın 1'ini yazdım).
  Hiçbiri yoksa "Atladığım kayıt yok." yaz.

Kayıtlarım:
(buraya yapıştır ya da dosyayı ekle)
```

The `KİŞİLER` block is used in types 3 and 6 (type 1 has its own):

```text
KİŞİLER
- Kişileri ekteki üye listesindeki (arkhe-uyeler-….csv) e-postayla eşleştir; adresi listeden aynen kopyala.
- Ayrılmış eski üyeler listede @eski.invalid ile biten adresleriyle durur; onları da aynen kullan.
- Listede hiç olmayan biri için adres uydurma (ad.soyad@eski.invalid bile yazma): o satırı koyma, Atladıklarım'a "üye listesinde yok, önce Üye geçmişi'ne eklenmeli" diye yaz.
- Listede rolü "sef" olan kişiyi bu dosyaya koyma.
```

#### 8.3.1 `1-uyeler` — Üye geçmişi

Header: `eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon;aidat_orani`

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `eposta` | Evet | e-posta | — | `ayse.demir@ornek.com` | Portaldaki kişiyle eşleştirir. Eski üyenin adresi bilinmiyorsa `ad.soyad@eski.invalid`. |
| `ad` | Eski üyede | 2–80 karakter | — | `Ayşe Demir` | Portaldaki kişide yalnızca kontrol edilir; farklıysa uyarı çıkar, ad değişmez. |
| `katilim_tarihi` | Eski üyede | tarih | — | `2019-09-01` | Koroya ilk geldiği gün. |
| `ayrilis_tarihi` | Eski üyede | tarih | — | `2024-01-15` | Koroda son günü. **Aktif bir üyeye yazılırsa o kişi pasifleşir.** Boş bırakmak kimseyi geri getirmez. |
| `partisyon` | Eski üyede | kod | `soprano`, `alto`, `tenor`, `bas` | `alto` | Bugünkü partisyon. Portalda olan kişide değiştirmek istemiyorsan boş bırak. |
| `aidat_orani` | Hayır | kod | `tam`, `indirimli`, `muaf` | `indirimli` | Bugünkü aidat oranı; tüm dönemlere uygulanır. Değiştirmeyeceksen boş bırak. |

The type-specific parts of the prompt:

```text
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
- Listede rolü "sef" ya da "yonetim" olan kişilerin satırlarını ayrı tut: CSV'nin sonuna koy ve "Yönetim satırları" başlığıyla adlarını yaz. Bunları yalnızca koro şefi aktarabilir.
```

The `bölünmeyecek birim` for this type is `bir kişi`.

**Worked example.**

Source (pasted from the old Excel "Korist listesi" sheet, plus the member list of §8.2):

```
Ad Soyad       | Ses  | Giriş        | Ayrılış      | Aidat
Ayşe Demir     | Alto | Eylül 2019   |              |
Mehmet Kaya    | Ten  | 12.02.2021   |              | öğrenci (yarım)
Zeynep Ak      | Sop  | 2018 güz     | Ocak 2026    |
Burak Öztürk   | Bas  | 03.10.2022   | 15.01.2024   |
Selin          | Alto | 2020         |              |
Can Yıldız     | Bas  | 15.09.2022   |              |
```

Expected output:

```csv
eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon;aidat_orani
ayse.demir@ornek.com;Ayşe Demir;2019-09-01;;;
mehmet.kaya@ornek.com;Mehmet Kaya;2021-02-12;;;
zeynep.ak@eski.invalid;Zeynep Ak;2018-09-01;2026-01-31;soprano;
burak.ozturk@eski.invalid;Burak Öztürk;2022-10-03;2024-01-15;bas;
can.yildiz@ornek.com;Can Yıldız;2022-09-15;;;
```

> **Atladıklarım:** "Selin, Alto, 2020": üye listesinde iki Selin var (Selin Çakır, Selin Aydın); hangisi olduğunu bilmiyorum.
> **Tahmin ettiklerim:** Ayşe Demir katılım: yalnızca "Eylül 2019", 2019-09-01 yazdım. Zeynep Ak katılım: "2018 güz", 2018-09-01; ayrılış: "Ocak 2026", 2026-01-31. Mehmet Kaya: kayıtta "öğrenci (yarım)" yazıyor; bugünkü oranı bilmediğim için aidat_orani'nı boş bıraktım. İndirimliyse söyle, ekleyeyim.
> **Pasifleşecekler:** yok.
> **Yönetim satırları:** Can Yıldız (yonetim). Bu satırı yalnızca koro şefi aktarabilir.

What this example teaches: month-only dates, the season guess, a former member with an invented `@eski.invalid` address, a blank part and rate for existing people, an ambiguous first name skipped, and the board-row caveat.

Note for @backend: the repo sample `1-uyeler.csv` must also show `aidat_orani` filled once (AC 7). Use a separate sample row, `selin.aydin@ornek.com;Selin Aydın;2020-09-01;;;indirimli`, not the AI example above.

#### 8.3.2 `2-donemler` — Çalışma dönemleri

Header: `ad;baslangic;bitis`

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `ad` | Evet | 1–40 karakter | — | `2024–25 Güz` | Raporlardaki dönem seçicide görünen ad. Aynı ad iki kez olmaz. |
| `baslangic` | Evet | tarih | — | `2024-09-16` | Dönemin ilk günü. |
| `bitis` | Evet | tarih, gelecekte olabilir | — | `2025-01-31` | Son günü. Başlangıçtan en fazla 366 gün sonra. |

Prompt specifics:

```text
SÜTUNLAR
- ad (zorunlu): dönemin adı, en fazla 40 karakter. Portaldaki gibi yaz: "2024–25 Güz", "2024–25 Bahar" (yıllar arasında uzun tire –). Koro sezonu bölmüyorsa "2024–25 sezonu".
- baslangic (zorunlu): ilk gün.
- bitis (zorunlu): son gün.

BU DOSYAYA ÖZEL KURALLAR
- Dönemler birbiriyle çakışmasın: bir dönemin bitişi, sonrakinin başlangıcından önce olsun. Aradaki tatiller boşta kalabilir.
- Bir dönem en fazla bir yıl (366 gün) sürebilir.
- Kesin başlangıç ya da bitiş günü yoksa o dönemi yazma; Atladıklarım'a yaz ve bana tarihleri sor.
```

The `bölünmeyecek birim` for this type is `bir dönem` (this file is always short).

**Worked example.** Source (a WhatsApp message from the old conductor):

> 23-24'te güzde 18 eylülde başladık, son prova 26 ocak. bahar 12 şubat - 21 haziran. 24-25 aynı düzen, eylülün üçüncü haftası başladık sanırım

Expected output:

```csv
ad;baslangic;bitis
2023–24 Güz;2023-09-18;2024-01-26
2023–24 Bahar;2024-02-12;2024-06-21
```

> **Atladıklarım:** "24-25 aynı düzen, eylülün üçüncü haftası": kesin tarih yok. Başlangıç ve bitiş günlerini verirsen 2024–25 Güz ve Bahar satırlarını eklerim.

What it teaches: the en-dash naming, and refusing to turn "sanırım" into dates. **Terms are never guessed**: a wrong boundary moves report numbers, and the user can answer in one message.

#### 8.3.3 `3-yoklama` — Çalışmalar ve yoklama

Header: `tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not`

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `tarih` | Evet | tarih | — | `2025-10-07` | Çalışmanın günü. |
| `baslangic` | Hayır | saat, varsayılan `19:00` | — | `19:00` | Aynı gün iki çalışma varsa farklı olmalı. Boşsa çalışmanın ilk satırından alınır. |
| `bitis` | Hayır | saat, varsayılan `22:00` | — | `22:00` | Başlangıçtan sonra. |
| `tur` | Hayır | kod, varsayılan `tutti` | `tutti`, `partisyon`, `genel_prova`, `konser` | `tutti` | |
| `partiler` | Partisyonda | `+` ile birleşik | `soprano`, `alto`, `tenor`, `bas` | `soprano+alto` | Yalnızca `partisyon` türünde, orada zorunlu. |
| `baslik` | Hayır | ≤ 80 karakter | — | `Bahar konseri provası` | |
| `yer` | Hayır | ≤ 120 karakter | — | `Mülkiye Salonu` | |
| `eposta` | Evet | e-posta | üye listesindeki adresler | `ayse.demir@ornek.com` | Eski üyeler `@eski.invalid` adresleriyle. |
| `durum` | Evet | kod | `geldi`, `gec_geldi` (ya da `gec`), `mazeretli`, `gelmedi` | `geldi` | Listede olmayan beklenen kişiler `gelmedi` sayılır. |
| `not` | Hayır | ≤ 200 karakter | — | `Sınav haftası` | Yalnızca `mazeretli` satırda. |

Prompt specifics:

```text
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
- O tarihte henüz katılmamış ya da çoktan ayrılmış birini, ya da partisyonda başka partideki birini yazma; portal reddeder. Kaynakta böyle biri varsa Atladıklarım'a yaz.
- Gelecekteki ya da bugün bitmemiş çalışmayı yazma.
```

Plus the `KİŞİLER` block. The `bölünmeyecek birim` is `bir çalışmanın satırları`.

**Worked example.** Source (a photo of the attendance notebook, as the AI would transcribe it):

```
7 Ekim Salı — Mülkiye Salonu — tutti
  Ayşe ✓   Mehmet geç   Zeynep izinli (sınav)   Can ✓   Elif ✓   Deniz hoca
9 Ekim Perş. 20.00–21.30 — sop+alto partisyon
  Ayşe ✓   Elif ✓   Zeynep yok   Selin Ç. ✓
```

Expected output (the year is 2025, from the notebook's cover):

```csv
tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not
2025-10-07;;;tutti;;;Mülkiye Salonu;ayse.demir@ornek.com;geldi;
2025-10-07;;;;;;;mehmet.kaya@ornek.com;gec_geldi;
2025-10-07;;;;;;;zeynep.ak@eski.invalid;mazeretli;Sınav
2025-10-07;;;;;;;can.yildiz@ornek.com;geldi;
2025-10-07;;;;;;;elif.sahin@ornek.com;geldi;
2025-10-09;20:00;21:30;partisyon;soprano+alto;;;ayse.demir@ornek.com;geldi;
2025-10-09;;;;;;;elif.sahin@ornek.com;geldi;
2025-10-09;;;;;;;zeynep.ak@eski.invalid;gelmedi;
2025-10-09;;;;;;;selin.cakir@ornek.com;geldi;
```

> **Atladıklarım:** 7 Ekim "Deniz hoca": koro şefi (Deniz Arslan), yoklamaya yazılmaz.
> **Tahmin ettiklerim:** yıl 2025 (defter kapağından). 7 Ekim'in saati yok; boş bıraktım (19:00–22:00 sayılır). "Selin Ç." → Selin Çakır (listede soyadı Ç ile başlayan tek Selin).

What it teaches: the inherited blank cells, the default times, `izinli` → `mazeretli` with a note, the conductor excluded, `yok` → `gelmedi`, a sectional with `+`, and the Zeynep address taken from the re-downloaded list (she was created in step 1).

In the preview (with the §8.2 state after step 1), the effects read `7 Eki 2025 19:00 Tutti · Mülkiye Salonu: 7 kişi, 2 Gelmedi (listede yok)` (both Selins were expected and aren't listed) and `9 Eki 2025 20:00 Partisyon (Soprano, Alto): 5 kişi, 1 Gelmedi (listede yok)` (Selin Aydın). The `Dikkat` block reads `2 çalışmada toplam 3 beklenen kişi listede yok; Gelmedi sayılacak.` That's correct, and it's exactly what the user should notice if the notebook was incomplete.

#### 8.3.4 `4-hareketler` — Finans hareketleri

Header: `kayit_no;tarih;tur;kategori;tutar;hesap;hedef_hesap;aciklama;karsi_taraf;sponsor;etkinlik;belge_linki`

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `kayit_no` | Evet | 1–40, harf, rakam, `- _ . /` | — | `20240905-1` | Her satırda farklı. Tarih + o günün sırası. |
| `tarih` | Evet | tarih | — | `2024-09-05` | Açılış tarihinden önce olamaz. |
| `tur` | Evet | kod | `gelir`, `gider`, `virman` | `gider` | Virman: kasa ile banka arası para aktarma. |
| `kategori` | Gelir ve giderde | kod | Gelir: `sponsorluk`, `bilet_satisi`, `bagis`, `hibe_destek`, `diger_gelir`. Gider: `kostum`, `salon_mekan`, `sef_korrepetitor_ucreti`, `nota_ve_telif`, `ulasim_ve_konaklama`, `festival_katilim_ucreti`, `organizasyon_tanitim`, `ikram`, `iade`, `banka_masrafi`, `diger_gider` | `salon_mekan` | Virmanda boş. `aidat` burada kullanılmaz (6. adım). |
| `tutar` | Evet | tutar | — | `1500` | `1250,50` biçiminde; binlik ayırıcı, ₺ ve eksi yok. |
| `hesap` | Evet | kod | `kasa`, `banka` | `banka` | Virmanda paranın çıktığı hesap. |
| `hedef_hesap` | Virmanda | kod | `kasa`, `banka` | `kasa` | Yalnızca virmanda; `hesap`'tan farklı. |
| `aciklama` | Hayır | ≤ 200 karakter | — | `Salon kirası Eylül` | |
| `karsi_taraf` | Hayır | ≤ 120 karakter | — | `Mülkiye Vakfı` | Parayı ödeyen ya da alan. |
| `sponsor` | Sponsorlukta | ≤ 120 karakter | — | `Kaya Matbaa` | Portalda yoksa oluşturulur. Başka kategoride boş. |
| `etkinlik` | Hayır | portaldaki etkinliğin adı | — | `Bahar Konseri 2025` | Yalnızca portalda olan bir etkinlik. |
| `belge_linki` | Hayır | `https://…` | — | `https://drive.google.com/…` | Fiş ya da fatura bağlantısı. |

Prompt specifics:

```text
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
- etkinlik (isteğe bağlı): yalnızca şu etkinlik adlarından biri, aynen: <portaldaki etkinlik adlarını buraya yaz ya da bu satırı sil>. Değilse boş.
- belge_linki (isteğe bağlı): https:// ile başlayan bağlantı.

BU DOSYAYA ÖZEL KURALLAR
- Aidat ödemelerini bu dosyaya KOYMA. Onları Atladıklarım'da "Aidat (6. adımda aktarılacak)" başlığıyla, tarih, kişi ve tutarla listele.
- "Devreden", "devir", "açılış" ya da "önceki yıldan kalan" satırlarını hareket olarak yazma. Onları sonda "Açılış bakiyesi" başlığıyla tarih, kasa ve banka tutarı olarak yaz.
- Bir satırda hem gelir hem gider varsa iki ayrı satır yaz.
- Ara toplamları, bakiye sütununu ve "toplam" satırlarını yazma.
```

The `bölünmeyecek birim` is `aynı günün kayıtları`.

**Worked example.** Source (the treasurer's Excel, pasted):

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

Expected output:

```csv
kayit_no;tarih;tur;kategori;tutar;hesap;hedef_hesap;aciklama;karsi_taraf;sponsor;etkinlik;belge_linki
20240905-1;2024-09-05;gider;salon_mekan;1500;banka;;Salon kirası Eylül;Mülkiye Vakfı;;;
20240905-2;2024-09-05;gider;ikram;185,50;kasa;;Prova çay-simit;;;;
20240912-1;2024-09-12;gelir;sponsorluk;5000;banka;;Sponsorluk;;Kaya Matbaa;;
20240914-1;2024-09-14;virman;;2000;banka;kasa;Bankadan nakit çekildi;;;;
20240930-1;2024-09-30;gider;banka_masrafi;8,50;banka;;EFT masrafı;;;;
```

> **Atladıklarım:** Aidat (6. adımda aktarılacak): 2024-09-20, "Eylül aidatları (Ayşe, Mehmet)", 450,00, banka. Kişi başı tutarlar aidat dosyasında ayrı satır olmalı.
> **Açılış bakiyesi:** 2024-09-01, kasa 1200, banka 15300. Finans › Ayarlar'a gir.
> **Tahmin ettiklerim:** 14.09 "Bankadan nakit çekildi" gider sütununda ama bir harcama değil, bankadan kasaya virman olarak yazdım.

What it teaches: thousands separators removed (`1.500,00` → `1500`), the parenthesised negative, a transfer recognised from a "gider" column, a new sponsor, dues pulled out, the opening line pulled out, and the deterministic `kayit_no`.

#### 8.3.5 `5-aidat-donemleri` — Aidat dönemleri

Header: `ad;baslangic;bitis;son_odeme;tutar;indirimli_tutar`

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `ad` | Evet | 1–40 karakter | — | `Eylül 2024` | Aylık dönemlerde portalın adı: ay ve yıl. 6. adımda bu adla eşleşir. |
| `baslangic` | Evet | tarih | — | `2024-09-01` | |
| `bitis` | Evet | tarih, gelecekte olabilir | — | `2024-09-30` | |
| `son_odeme` | Evet | tarih, gelecekte olabilir | — | `2024-09-10` | Başlangıçtan önce olamaz. |
| `tutar` | Evet | tutar | — | `300` | Tam aidat. |
| `indirimli_tutar` | Hayır | tutar | — | `150` | Tam aidattan az. |

Prompt specifics:

```text
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
```

The `bölünmeyecek birim` is `bir dönem`.

**Worked example.** Source:

> 2024-25'te aylık aidat 300 TL, öğrenciler 150. Eylülden hazirana, her ayın 10'una kadar. Temmuz ağustos aidat yok.

Expected output (10 rows; first 3 and last shown here, the `.md` shows all 10):

```csv
ad;baslangic;bitis;son_odeme;tutar;indirimli_tutar
Eylül 2024;2024-09-01;2024-09-30;2024-09-10;300;150
Ekim 2024;2024-10-01;2024-10-31;2024-10-10;300;150
Kasım 2024;2024-11-01;2024-11-30;2024-11-10;300;150
…
Haziran 2025;2025-06-01;2025-06-30;2025-06-10;300;150
```

> **Atladığım kayıt yok.**

The page also says: `Aynı tutarlı ardışık aylar için Aidat › Aylık toplu oluştur daha hızlı.`

#### 8.3.6 `6-aidat-odemeleri` — Aidat ödemeleri ve muafiyetler

Header: `kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama`

| Sütun | Zorunlu | Biçim | İzin verilen değerler | Örnek | Açıklama |
|---|---|---|---|---|---|
| `kayit_no` | Evet | 1–40, harf, rakam, `- _ . /` | — | `O-20240905-1` | Ödeme: `O-` + tarih + sıra. Muafiyet: `M-` + dönemin ayı + sıra. |
| `islem` | Hayır | kod, varsayılan `odeme` | `odeme`, `muaf` | `odeme` | |
| `eposta` | Evet | e-posta | üye listesindeki adresler | `ayse.demir@ornek.com` | Eski üyeler `@eski.invalid` adresleriyle. |
| `donem` | Evet | portaldaki aidat döneminin adı | — | `Eylül 2024` | |
| `tutar` | Ödemede | tutar | — | `300` | Dönemin kalan borcundan fazla olamaz. Muafiyette boş. |
| `tarih` | Ödemede | tarih | — | `2024-09-05` | Açılış tarihinden önce olamaz. Muafiyette boş. |
| `hesap` | Ödemede | kod | `kasa`, `banka` | `banka` | Muafiyette boş. |
| `aciklama` | Muafiyette | ≤ 200; muafiyette 3–200 | — | `Geçmiş dönem borcu silindi` | Muafiyette nedeni. |

Prompt specifics:

```text
SÜTUNLAR
- kayit_no (zorunlu): her satıra farklı numara. Ödemede O- + ödeme tarihinin rakamları + o günün sırası (O-20240905-1). Muafiyette M- + dönemin başladığı yıl ve ay + sıra (Eylül 2024 için M-202409-1, M-202409-2…). Yalnızca harf, rakam ve - _ . / kullan.
- islem (isteğe bağlı): İzin verilen: odeme (varsayılan), muaf.
- eposta (zorunlu): KİŞİLER kurallarına bak.
- donem (zorunlu): aidat döneminin portaldaki adı, aynen: <dönem adlarını buraya yaz, örnek: Eylül 2024, Ekim 2024 …>.
- tutar, tarih, hesap (ödemede zorunlu, muafiyette boş): hesap için izin verilen: kasa, banka.
- aciklama: ödemede isteğe bağlı; muafiyette zorunlu, en az 3 karakter, muafiyetin nedeni.

BU DOSYAYA ÖZEL KURALLAR
- Bir satır = bir kişi, bir dönem, bir ödeme. Birden çok ayı kapsayan ödemeyi her ay için ayrı satıra böl (aynı tarih ve hesap; tutarı aylara dağıt). Tutar aylara tam bölünmüyorsa satırları yazma, Atladıklarım'a yaz.
- Bir kişinin bir döneme ödediği toplam, o dönemin tutarını (indirimli üyede indirimli tutarı) geçmesin.
- Kişi o dönemde koroda olmalı: katılım tarihi dönemin bitişinden sonra ya da ayrılış tarihi dönemin başlangıcından önce ise o dönem için satır yazma.
- Rolü "sef" olan kişi aidat ödemez; ona satır yazma.
- Muafiyet: ben "şu dönemler için ödemeyenleri muaf tut" dersem, o dönemlerin her biri için, o dönemde koroda olup (yukarıdaki kural) o döneme HİÇ ödemesi olmayan her kişiye bir muaf satırı yaz. Kısmen ödemiş birine muaf yazma; onu Atladıklarım'a yaz.
```

Plus the `KİŞİLER` block. The `bölünmeyecek birim` is `bir dönemin satırları`.

**Worked example.** Source (the treasurer's notes), with the member list re-downloaded after step 1:

> Eylül 2024: Ayşe 300 (5 Eyl, banka), Mehmet 150 öğrenci (8 Eyl, kasa). Can 2 Ekim'de 900 yatırdı, Eylül-Ekim-Kasım için, banka. Selin Ç. Ekim için 100 verdi (kasa, 15 Eki).
> Eylül–Kasım 2024 için ödemeyenler muaf tutulsun (yönetim kararı, Ekim 2026).

Dönemler: Eylül 2024, Ekim 2024, Kasım 2024 (300 / indirimli 150), member dates as in the §8.2 state after step 1.

Expected output:

```csv
kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama
O-20240905-1;odeme;ayse.demir@ornek.com;Eylül 2024;300;2024-09-05;banka;
O-20240908-1;odeme;mehmet.kaya@ornek.com;Eylül 2024;150;2024-09-08;kasa;
O-20241002-1;odeme;can.yildiz@ornek.com;Eylül 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241002-2;odeme;can.yildiz@ornek.com;Ekim 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241002-3;odeme;can.yildiz@ornek.com;Kasım 2024;300;2024-10-02;banka;3 aylık ödeme
O-20241015-1;odeme;selin.cakir@ornek.com;Ekim 2024;100;2024-10-15;kasa;
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
> **Tahmin ettiklerim:** Can'ın 900 TL'sini üç aya 300'er böldüm.

What it teaches: a multi-month payment split, a reduced-rate member, the waiver generation rule (Elif not in Eylül because she joined 1 Oct, Burak not at all, the conductor not at all), a partial payment blocking a waiver, and `@eski.invalid` taken from the list.

The repo sample `6-aidat-odemeleri.csv` is a 4–5 row cut of this (two payments, the split, one `muaf`).

### 8.4 How we check the pack before shipping (for the tech lead / e2e)

- AC 7 covers the samples. In addition, the **examples in the `.md` files must pass `Kontrol et`** against the §8.2 cast, with 0 errors. One e2e loop: arrange the cast, then check each `.md`'s fenced `csv` block.
- Manual test once, before the PO review: paste each prompt plus the §8.3 "source" into free ChatGPT and free Claude, save the output, and run `Kontrol et`. Record the number of rounds to 0 errors in `review-ux.md`. The bar: **≤ 2 rounds** for every type.

---

## 9. Agreements

- @po: agree with D1–D16, with the six types and their order, with no nav entry, with all-or-nothing, with the stack undo, and with the AC copy, except where §0.2 proposes a change.
- The `İçe aktarıldı` marker stays neutral (§5). Imported data must not look second-class.
