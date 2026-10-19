# Phase 4 UX: Kayıt ödevleri

Author: arkhe-ux-designer. Inputs: `po-spec.md`, Phase 3 `ux.md`/`po-decisions.md`/`review-ux.md`, `/calismalar` and home code, `src/lib/labels.ts`, `globals.css`. No `ui.md`/`db.md`/`backend.md` yet.

Mobile first at 375px (`px-4`, 343px content, page `pb-28`), tap targets ≥ 44px, `max-w-3xl` from `md`. Reuse: `FilterChip`, `PartDot`, `VoicePartBadge`, `BackLink`, `ConfirmDialog`, `Sheet` (bottom < md, `Dialog sm:max-w-sm` ≥ md), `forms/field.tsx`, sonner toasts. **No new tokens.**

## 0. Replies and decisions

**@po:**
- **Q1 undo after manual mark:** agree, the singer may undo. Their detail shows `Teslimini {Ad Soyad} işaretledi.` under the state, so they know why it says submitted.
- **Q2 tab badge:** agree. **Change:** the badge is for *anyone with expected homework*, so YK members get it too (they sing); only users with nothing expected (conductor, no part) get none. Colour `bg-primary`, not red (§1).
- **Q3 `Güncel` window:** agree, `dueAt ≥ now − 7 d`. A weekly rhythm keeps last week's late homework visible for one more rehearsal, then it drops to `Geçmiş` where it still shows `Gecikti` (no red fill there, §2).
- **Q4 feedback authors:** agree, both managers. Heading is `Şefin notu` when the author's role is `conductor`, otherwise `Geri bildirim`; always followed by `{Ad Soyad} · 22 Eki`. Seeded notes are by the conductor, so AC8/AC17 text holds.
- **Q5 label/icon:** `Ödevler` + `Mic`. `Kayıtlar` collides with "kayıt" = registration and with `Partisyon kaydı` links. `AudioLines` is already the part-file icon, so not that.
- **Q6 matrix columns** (@ui owns): 8 on every width; on phones the grid scrolls inside its box, newest column on the left so the latest homework is visible without scrolling (§5).
- **Tones use the attendance status tokens, not `success`/`gold`/`destructive`.** `success` and `gold` have no `-ink` pair; gold text on `bg-card` is ≈ 2:1 in light. `present`/`late`/`absent` already have soft+ink pairs tuned for both themes and singers already read them as good/careful/bad from Phase 2.
- **Managers' rows past the deadline** don't say `Gecikti` (the homework isn't late, singers are): they show neutral `Süre doldu` + `{k} eksik` in `text-absent-ink`.
- **Detail = 3 numbered steps** (`Dinle` → `Gönder` → `Teslim ettim`); after the mail button is tapped, step 3 gets a nudge line (§3.2). Reduces "tapped `Teslim ettim`, never sent".

## 1. Nav and tab badge

Measured with the live tab bar (`src/components/shell/app-nav.tsx`, `text-[11px]`) and an injected 5th tab at 375px: cells are 75px, widest label `Repertuvar` 57px, `Çalışmalar` 55, `Ana sayfa` 51, `Ödevler` 41, `Üyeler` 33. At 320px cells are 64px and everything still fits on one line (≥ 3px each side). Tab height 69px. **No label changes, no truncation needed.** Screenshots: scratchpad `p4-ux/tabs-*.png`.

- `NAV_ITEMS`: `{ href: "/odevler", label: "Ödevler", icon: Mic }` between `Repertuvar` and `Raporlar`. Members get 4 tabs, managers 5.
- **Badge** on the icon pill (`span.relative`): `absolute -top-1 left-[calc(50%+6px)] min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums grid place-items-center ring-2 ring-background`. `9+` above 9. Hidden at 0. Same badge after the label in the sidebar (`ml-auto`). Link `aria-label="Ödevler, {n} bekleyen ödev"`.
- Why `bg-primary`: indigo/cream in light, gold/ink in dark, ≥ 7:1 both; red would mark green homework as alarming. Overdue items get their red on the page, not the tab.

## 2. Deadline badge (`DeadlineBadge`, shared)

`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium` + icon `size-3.5`, `data-tone`. Always followed by the absolute date (`text-xs text-muted-foreground tabular-nums`).

| State | `data-tone` | Classes (light & dark via tokens) | Icon | Copy |
|---|---|---|---|---|
| > 72 h | `green` | `bg-present/14 text-present-ink` | `Clock` | `5 gün kaldı` |
| 24–72 h | `amber` | `bg-late/18 text-late-ink` | `Hourglass` | `2 gün kaldı` · `1 gün kaldı` |
| 0–24 h | `red` | `bg-absent/12 text-absent-ink` | `AlarmClock` | `5 saat kaldı` · `1 saatten az kaldı` |
| overdue | `red` | **solid** `bg-absent text-white` | `CircleAlert` | `Gecikti` · `Gecikti · 2 gün` |
| done on time | `done` | `bg-muted text-foreground` | `CircleCheck` (`text-present-ink`) | `Teslim edildi · 22 Eki` |
| done late | `done` | `bg-muted text-foreground` | `CircleCheck` (`text-late-ink`) | `Geç teslim · 26 Eki` |
| new joiner | `neutral` | `bg-muted text-muted-foreground` | `Clock` | `İsteğe bağlı` (+ hint §3.1) |
| manager, past due | `neutral` | `bg-muted text-muted-foreground` | `CalendarX` | `Süre doldu` |
| not my part | — | no badge | — | — |

Non-colour cues: icon differs per state, red-overdue is solid vs red-soon soft, copy carries the state. Absolute date format: `Son tarih: 24 Eki Cum 23:59`; within 24 h `Son tarih: bugün 23:59` / `yarın 21:00`. In `Geçmiş` overdue uses the soft red (no solid fill) to keep an archive calm.

## 3. `/odevler`

### 3.1 Singer list (375px)
1. h1 `Ödevler` (`text-4xl font-medium`), sub `text-sm text-muted-foreground` `Alto · {n} bekleyen` (0 → `Alto · hepsi tamam`).
2. Chips `nav aria-label="Ödev listesi"`: `Güncel {n}` · `Geçmiş {n}` (`?liste=guncel|gecmis`).
3. Groups, eyebrow h2 (`text-xs tracking-[0.2em] uppercase text-muted-foreground`): **`YAPILACAK`** (unsubmitted, `dueAt` asc, so overdue first) then **`TESLİM ETTİKLERİM`** (`submittedAt` desc). Each `ul.divide-y.rounded-2xl.border.bg-card`.
4. **Row** `li flex gap-3 pr-3 min-h-[88px]`:
   - Left `Link` → `/odevler/[id]` (`flex-1 min-w-0 py-3 pl-4`): line 1 piece title `font-medium line-clamp-2`; line 2 `text-sm text-muted-foreground` `Ölçü 12–34` / `Tüm eser` + `·` + part dots (`Tutti` for all four); line 3 `mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1`: `DeadlineBadge` + absolute date. `Yeni not`: `inline-flex gap-1 text-xs font-medium text-primary` with `size-2 rounded-full bg-gold` dot + `Yeni not`, before the badge.
   - Right (unsubmitted, eligible): `Button variant="outline" h-11 rounded-full px-3 gap-1.5` `Check` **`Teslim ettim`** (`w-[124px]`), `aria-label="Teslim ettim: {başlık}"`. Text column at 375: 343 − 16 − 12 − 12 − 124 = 179px.
   - After tap: optimistic move to `TESLİM ETTİKLERİM`, toast **`Teslim edildi.`** with action **`Geri al`** (6 s).
   - New joiner row: badge `İsteğe bağlı`, line 4 `text-xs text-muted-foreground` **`Sen katılmadan önce verildi; istersen teslim edebilirsin.`**
5. Members see only their part's homework. Managers (incl. the conductor) get §3.2; a `member` without a part sees all homework read-only with no badges or buttons.

### 3.2 Manager list
- Header right: `Button h-10 rounded-full px-4` `Plus` **`Ödev ver`** → `/odevler/yeni`.
- Under the h1, a tools row `flex flex-wrap gap-2`: `Button variant="outline" h-11 rounded-full` `Grid3x3` **`Teslim matrisi`** → `/odevler/matris`; `Button variant="ghost" h-11` `Mail` **`Kayıt e-postası`** (opens dialog §7). Text below in `text-xs text-muted-foreground`: `Kayıtlar şu adrese gidiyor: kayit@arkhe.local`.
- **Missing email banner** (above the list): `rounded-2xl border border-late/40 bg-late/10 p-4 flex gap-3`, icon `TriangleAlert text-late-ink`, **`Kayıt e-postası ayarlanmadı. Koristler kaydını nereye göndereceğini göremiyor.`** + `Button variant="outline" h-11` **`Ayarla`**.
- One list (no groups), `Güncel` by `dueAt` asc. **Row** (whole row is a link, `min-h-[96px]`, `ChevronRight` right): title; `Ölçü 12–34 · {dots}`; badge (deadline tone, or `Süre doldu`) + date; line 4 `text-sm tabular-nums`: **`12/31 teslim`** + `h-1.5 w-20 rounded-full bg-muted` bar with `bg-present` fill, and when past due and missing > 0 `· 3 eksik` (`text-absent-ink font-medium`); line 5 `text-xs text-muted-foreground tabular-nums` `S 5/8 · A 6/9 · T 3/6 · B 4/8` (only the homework's parts).
- **YK who sings:** same manager row, but if they're eligible their own `DeadlineBadge` replaces the deadline tone and an inline `Teslim ettim` appears only on the detail (keeps the row one link).

### 3.3 Empty / loading
| Case | Copy |
|---|---|
| Güncel empty, singer | dashed card, icon `Mic`: **`Şu an ödev yok.`** / `Şef ödev verince burada görünür.` |
| Güncel empty, manager | **`Şu an ödev yok.`** + primary **`Ödev ver`** |
| All done, singer (only `TESLİM ETTİKLERİM`) | above the group, `rounded-2xl bg-present/10 p-4 text-present-ink` `CircleCheck` **`Bütün ödevlerini teslim ettin.`** |
| Geçmiş empty | **`Geçmiş ödev yok.`** |
| Loading | 4 skeleton rows: `h-4 w-2/3`, `h-3 w-1/3`, `h-5 w-28 rounded-full`; right `h-11 w-[124px] rounded-full` |

## 4. `/odevler/[id]`

### 4.1 Header (everyone)
`BackLink` **`Ödevler`** (keeps `liste`). Eyebrow `ÖDEV · {Ölçü 12–34 | TÜM ESER}`. h1 piece title (`text-3xl`). Row: part chips (`VoicePartBadge`s or `Tutti`), `DeadlineBadge`, then on its own line `Son tarih: 24 Eki Cum 23:59` (`text-sm`). Managers, right of the eyebrow: `Pencil` `size-11` (`aria-label="Ödevi düzenle"`) and `MoreHorizontal` menu: **`Düzenle`**, **`Sil`** (destructive). `Açıklama` (if any): `rounded-2xl bg-accent/60 p-4`, eyebrow `NE ÜZERİNE ÇALIŞMALI`, `text-sm whitespace-pre-line`. Link row: **`Esere git`** (`Library` icon, `text-primary min-h-11`) → `/repertuvar/{pieceId}?partisyon=alto` (no part → `tumu`).

### 4.2 Singer block (eligible): card `rounded-2xl border bg-card p-4 space-y-4`, title h2 **`Ödevini teslim et`**
Numbered steps (`ol`, number `size-7 rounded-full bg-muted font-heading grid place-items-center`):
1. **`Partisyonunu dinle`** → Phase 3 `PartFileButton` full-width (`Partisyonumu aç (Alto)` / disabled `Alto için partisyon kaydı yok`).
2. **`Kaydını gönder`** → full-width `Button h-12 rounded-2xl` primary, `Mail` icon, **`Kaydı e-postayla gönder`**, `<a href="mailto:…">`. Under it `text-xs text-muted-foreground`: **`Kaydını e-postaya eklemeyi unutma. Dosya büyükse Drive'a koyup bağlantısını yapıştır.`** Then a `rounded-xl bg-muted p-3` box: label `text-xs` **`Konu`**, subject `text-sm font-mono break-words select-all`, **`Konuyu kopyala`** (`Button variant="outline" h-11`, `Copy`), and `Adres: kayit@arkhe.local` (`select-all`). Toasts **`Konu kopyalandı.`** / error **`Kopyalanamadı, konuyu elle seç.`**
   - No email set: step 2 shows instead `text-sm text-muted-foreground` **`Kayıt e-postası henüz ayarlanmadı. Kaydını şefe nasıl ileteceğini sor.`** (no mailto, no copy box).
3. **`Gönderdiysen işaretle`** → `Button h-12 w-full rounded-2xl variant="outline"` `Check` **`Teslim ettim`**. After step 2's button is tapped (client state, this visit), step 3 gets `ring-2 ring-primary` and the line `text-sm` **`E-postayı gönderdin mi? Gönderdiysen "Teslim ettim"e dokun.`**

**Submitted state** replaces steps with: `DeadlineBadge` done (`Teslim edildi · 22 Eki 21:14`), manual mark line `text-xs` **`Teslimini {Ad Soyad} işaretledi.`**, and actions row: `Button variant="outline" h-11` `Mail` **`Yeniden gönder`** (same mailto) + `Button variant="ghost" h-11` `Undo2` **`Geri al`** (hidden when feedback exists). `Geri al` toast **`Teslim geri alındı.`**
**Not eligible:** muted card **`Bu ödev senin partisyonun için değil.`** (no-part users and the conductor get no card at all).
**New joiner:** steps shown, above them `text-sm text-muted-foreground` **`Sen katılmadan önce verildi; istersen teslim edebilirsin.`**

### 4.3 Feedback (recipient only)
Card `rounded-2xl border-l-4 border-gold bg-gold/10 p-4` (dark: same tokens, gold reads on `bg-gold/10`), eyebrow **`ŞEFİN NOTU`** / **`GERİ BİLDİRİM`** (§0), body `whitespace-pre-line`, footer `text-xs text-muted-foreground` `{Ad Soyad} · 22 Eki 21:40`. Placed **above** the singer block once the singer has submitted (it's the news); below it otherwise. Opening the page sets `feedbackSeenAt`.

### 4.4 Manager matrix (on detail)
- h2 **`Teslimler`** + `text-sm tabular-nums` **`12/31 teslim`**. Chips: **`Tümü`** · **`Teslim etmeyenler {k}`** (`?filtre=eksik`).
- Per part (`S`, `A`, `T`, `B` order, only the homework's parts): section header `flex items-center gap-2` `PartDot` **`Alto · 6/9`**, then `ul.divide-y.rounded-2xl.border.bg-card`.
- **Row** = `button` (`min-h-14 w-full px-4 flex items-center gap-3 text-left`, opens the sheet): name `font-medium truncate flex-1`; state chip: `Teslim edildi 22 Eki` (`present` soft, `Check`), `Geç teslim 26 Eki` (`late` soft, `Clock`), `Bekleniyor` (dashed muted, `Minus`), `Gecikti` (`absent` soft, `X`); under the name `text-xs text-muted-foreground`: **`şef işaretledi`** (manual), **`Ayrıldı`**, **`Sonradan katıldı`**; right `MessageSquareText size-4` in `text-primary` when a note exists, else `text-muted-foreground/50`. `aria-label="{Ad Soyad}: {durum}. Not yaz"`.
- Filtered empty: **`Herkes teslim etti.`**
- **Sheet** (`SheetTitle` = name, `SheetDescription` = `Alto · {durum}`):
  - Toggle row: `Button variant="outline" h-11 w-full` **`Teslim edildi olarak işaretle`** / **`Teslimi kaldır`**. Toasts **`Teslim işaretlendi.`** / **`Teslim kaldırıldı.`**
  - **`Not`** `Textarea rows=4`, counter from 800 `812/1000`, help `text-xs` **`Yalnızca {Ad} ve yönetim görür.`**, placeholder `ör. Girişler çok iyi, 20. ölçüde nefesi erken alıyorsun.`
  - Buttons: **`Notu kaydet`** (primary `h-12`), **`Notu sil`** (ghost destructive, only when a note exists), **`Kapat`**. Toasts **`Not kaydedildi.`** / **`Not silindi.`**; error **`En fazla 1000 karakter.`**
  - When a note exists, under it `text-xs`: **`Not yazıldığı için {Ad} teslimini geri alamaz.`**

### 4.5 Delete confirm
`ConfirmDialog`: title **`"{Ave Verum Corpus · Ölçü 12–34}" silinsin mi?`**, description **`{n} teslim kaydı ve notlar da silinir. Bu işlem geri alınamaz.`** (n = 0 → **`Bu işlem geri alınamaz.`**), **`Vazgeç`** / **`Sil`**. Then → `/odevler`, toast **`Ödev silindi.`**

## 5. `/odevler/matris` (managers)

- `BackLink` **`Ödevler`**, h1 **`Teslim matrisi`**, sub `text-sm text-muted-foreground` **`Son 8 ödev · yeni olan solda`**.
- Legend `flex flex-wrap gap-x-3 gap-y-1 text-xs` with the same cell visuals: **`Zamanında`**, **`Geç`**, **`Gecikti`**, **`Bekleniyor`**, **`Bu partisyon için değil`**.
- Grid box `-mx-4 overflow-x-auto overscroll-x-contain` (page never scrolls sideways), `table` `border-separate border-spacing-0 text-sm`.
  - Sticky first column `sticky left-0 z-10 bg-card w-[120px] max-w-[120px] truncate px-3` with names; part group rows `bg-muted text-xs font-medium` `● Alto · 9 kişi` spanning the row (sticky label).
  - Column header (`h-16`, `w-12`): piece short name `text-[11px] leading-tight line-clamp-2` (first word(s), `title` = full title) + date `24.10` `tabular-nums text-muted-foreground`; whole header links to the assignment.
  - Cells `size-12`, a `Link` with `aria-label="{Ad}, {eser}: {durum}"`: on time `Check` on `bg-present/14 text-present-ink`; late `Clock` on `bg-late/18 text-late-ink`; overdue missing `X` on `bg-absent/12 text-absent-ink`; pending `·` (`text-muted-foreground`); not eligible: empty, `bg-muted/40`, no link.
  - Last column sticky right `bg-card` **`{n}/{m}`** `tabular-nums font-medium`; `text-absent-ink` when < 50 %.
  - 375 math: 120 + 8×48 + 56 = 560px inside a 375px box; newest left keeps the 4 latest visible.
- Empty: **`Henüz ödev verilmedi.`** + **`Ödev ver`**. Non-managers are redirected to `/odevler`.

## 6. Create / edit form (`/odevler/yeni`, `/odevler/[id]/duzenle`)

h1 **`Ödev ver`** / **`Ödevi düzenle`** (sub = title). `BackLink` to the origin (piece page when `?eser=`, else `Ödevler`; edit → the homework). `max-w-2xl`, one column.

| Field | Control | Help / placeholder | Errors |
|---|---|---|---|
| **Eser** | Field-looking `button h-12 rounded-xl border` showing the piece (`font-medium` + composer) or placeholder **`Eser seç`**; opens a Sheet: search `Input` **`Eser ara`**, list of non-archived pieces, `Çalışılıyor` group first then `Hazır` (eyebrows), rows `min-h-12`, selected `Check`. Prefilled from `?eser=`. | — | **`Bir eser seç.`** |
| **Ölçüler** | `Başlangıç` and `Bitiş` `Input inputMode="numeric" w-24` with `–` between | **`Boş bırakırsan tüm eser.`** | **`Ölçüleri başlangıç ve bitiş olarak gir (ör. 12–34).`** · **`Bitiş ölçüsü başlangıçtan küçük olamaz.`** |
| **Partisyonlar** | `fieldset`, 5 toggle chips `min-h-11 rounded-full` with dots: **`Tutti`** · `Soprano` · `Alto` · `Tenor` · `Bas` (all on by default; `Tutti` is on when all four are, toggles all) | — | **`En az bir partisyon seç.`** |
| **Son tarih** | native `input type="date"` + `type="time"` (`grid grid-cols-[1fr_7rem] gap-3`); quick chips below: **`Sonraki çalışmaya kadar`** (fills next rehearsal's start, label shows `Çar 21 Eki 19:00`; hidden if none), **`1 hafta`** | `Türkiye saati` | **`Son tarih geçmişte olamaz.`** · **`Tarih ve saat gir.`** |
| **Açıklama** | `Textarea rows=4`, counter from 800 | **`Herkes görür. ör. "Metronom 60, 20. ölçüde nefes yok."`** | **`En fazla 1000 karakter.`** |

- Live preview under the fields, `rounded-xl bg-muted p-3 text-xs`: **`Koristlerin e-posta konusu:`** `Arkhe ödev · Ave Verum Corpus · Ölçü 12–34 · {Partisyon} · {Ad Soyad}`.
- Submit `h-12 w-full md:w-auto rounded-xl`: **`Ödevi ver`** (toast **`Ödev verildi.`**, → detail) / **`Değişiklikleri kaydet`** (toast **`Kaydedildi.`**). Banner **`Bazı alanları düzeltmen gerekiyor.`** Focus first error (`use-focus-error`).
- Edit with existing submissions: note above submit `text-xs text-muted-foreground` **`{n} kişi teslim etti. Partisyonları değiştirirsen teslimleri silinmez.`**
- Repertuvar detail menu gets **`Ödev ver`** → `/odevler/yeni?eser={id}`; detail page lists open homework under eyebrow **`ÖDEVLER`**: rows `{Ölçü 12–34} · {badge}` linking to `/odevler/[id]`.

## 7. Recording email dialog

`Dialog` title **`Kayıt e-postası`**, description **`Koristlerin "Kaydı e-postayla gönder" düğmesi bu adrese e-posta hazırlar.`** `Input type="email" inputMode="email" autoCapitalize="off"`, placeholder `kayit@ornek.org`, help **`Boş bırakırsan e-posta düğmesi gizlenir.`** Buttons **`Vazgeç`** / **`Kaydet`**. Error **`Geçerli bir e-posta adresi gir.`** Toasts **`Kayıt e-postası güncellendi.`** / cleared **`Kayıt e-postası kaldırıldı.`**

## 8. Home cards

- **Singer `Ödevlerim`** (directly under the next-rehearsal hero; hidden when nothing unsubmitted in `Güncel`): `Card`, header h2 **`Ödevlerim`** + right link **`Tümü`** → `/odevler`. Body = the most urgent unsubmitted row (overdue first, then nearest `dueAt`), identical to §3.1 row incl. inline `Teslim ettim`. Footer `text-sm text-primary min-h-11` **`+{n} ödev daha`** (only n ≥ 1). After submit the card shows the next one; when none left, **`Bütün ödevlerini teslim ettin.`** for this visit, gone on reload.
- **Manager `Ödevler`**: nearest open homework (title, `Ölçü`, deadline badge) + **`12/31 teslim`** with the bar and the per-part line; right link **`Teslimler`** → detail `#teslimler`. None open → **`Açık ödev yok.`** + **`Ödev ver`**. YK who sings gets both cards (singer first).

## 9. Errors (server action results)

**`Bu işlem için yetkin yok.`** · **`Şef geri bildirim yazdı; teslimi geri alamazsın.`** · **`Bu ödev artık yok.`** (deleted while open; → `/odevler`) · **`Bu esere bağlı ödevler var. Silmek yerine arşivle.`** · generic **`Bir sorun oldu. Tekrar dene.`** All via `toast.error` except form-field errors.

## 10. Dark mode checks

- Solid overdue `bg-absent text-white`: dark `--absent` is L 0.68, white text ≈ 3.2:1 at 12px; @ui: use `text-background` in dark (`dark:text-background`) or keep soft + `CircleAlert` there. Verify in review.
- `bg-late/18 text-late-ink` and `bg-present/14 text-present-ink` already pass on dark `bg-card` (Phase 2 chips).
- Tab badge `bg-primary` is gold in dark; on the active tab its `ring-background` keeps it separate from the `bg-primary/10` pill.
- Matrix sticky columns must use `bg-card` (not transparent) in both themes so cells don't show through.
