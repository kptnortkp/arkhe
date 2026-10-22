# Phase 8 UX review: Yönetim Kurulu board and budget

Author: UX designer. Date: 2026-10-21. Reads: `ux.md`, `po-decisions.md` (D21–D41), `implementation-notes.md` (UI section and deviations).

## How it was checked

- The live dev server at 127.0.0.1:3100, using Playwright with real Chrome.
  - Phone: 375×812, DPR 2, touch.
  - Desktop: 1280×900, plus 1024 to check the tab layout.
  - Light and dark.
- Accounts:
  - yk@: board, detail, forms, archive, budgets
  - sef@: home card and bar
  - korist@: `/yonetim` and `/finans/butce` both redirect to `/`; the bar keeps 4 tabs; there is no home card
- Flows run end to end:
  - **Ticket:** create from the `Takıldı` tab (with `Bana ata` and `Yüksek`), comment, `Durum` menu move, copy link, edit the due date (system entry), `Taşı` from the board (toast with `Göster`), delete the comment, delete the ticket.
  - **Budget:** create a draft (Eylül 2027), prefill, invalid amount, prefill overwrite confirm, save, draft report, approve confirm (cancelled), `Bilgileri düzenle`, the list with the draft, `Hiçbir tutar değişmedi.`, the revise dialog on the approved season (cancelled), delete the draft.
- `scrollWidth − innerWidth` is 0 on every page checked, so there is no horizontal scroll anywhere.
- Screenshots are in the scratchpad `p8review-ux/`, not the repo.
- **Cleanup.** I deleted ticket #7 and its comment and draft budget `UXR 2027–28 deneme` through the UI. I also deleted my `board_ticket_reads` row for yk@ on #1, so the seeded `Yeni` shows again.
  - I left `board_ticket_seq` alone: it reads 8, because someone else made #8 while I was working.

## Verdict on the listed deviations

| Deviation | Verdict | Why |
|---|---|---|
| `Taşı` in the card footer, not beside the title | **Accept** | One card design works at both 343 and 227 px. The title keeps the full width (`board-375-light.png`, `board-1280-light.png`). The icon-only `ArrowLeftRight` at `xl` with `title="Taşı"` reads well. |
| Report lines are cards, not a table, at `lg` | **Accept** | At 1280 the two-column cards are easy to scan (`b-report-cur-1280-light.png`), and every number has a `dt`. We lose column-by-column comparison, but at 9–12 lines nobody misses it. |
| Visible `Sil` on the detail page instead of an overflow menu | **Accept on desktop, change on the phone** (P2-6) | At 375 it wraps to its own row, at the same weight as `Durum` and `Düzenle`. |
| Filter row wraps at 375 | **Accept** | Nothing is hidden and there's no sideways scroll. It costs 52 px of height. With 3 chips (Herkes ≈ 80, Bana atananlar 2 ≈ 145, Aciliyet: Tümü ≈ 145, plus gaps) the row can't fit 343 px anyway. |
| No unsaved-changes prompt in the plan editor | **Accept for now, P3 follow-up** | The risk is real: the `BackLink` sits at the top of the editor and the bottom nav is always visible. A guard on in-app links only (no `beforeunload`) won't fight AC 28. |
| `/finans/butce/<id>/bilgiler` route | **Accept** | The labels are `Bilgileri düzenle` on a draft and `Notu düzenle` on an approved budget. Both are plain, and AC 29 needed this somewhere. |
| `(pano)` route group | **Accept** | Users never see it. |
| Not listed: the revise reason is asked in a dialog after `Kaydet`, not as the first field | **Accept, better than my spec** | The dialog shows the diff lines (`Ulaşım ve konaklama: ₺20.000,00 → ₺26.000,00`) right above `Değişiklik gerekçesi`. The user sees exactly what they're explaining. |
| Not listed: the board bar swap, home card position and copy | **Matches D22 / D28** | `Yönetim` with badge `1` fits the 75 px slot. The move toast `#7 Bitti sütununa taşındı.` + `Göster`, `#7 açıldı.`, `Kaydedildi.`, `#7 silindi.` and `Yorum silindi.` all read naturally. |

## Findings

Counts: **P1: 1 · P2: 6 · P3: 16**

### P1

**P1-1. A budget whose period hasn't started reports `Sürüyor`, `eksik` and `kaldı` everywhere.**
- Where:
  - `src/lib/finance/budget.ts:133`: `signalOf` gives `pending` whenever the period hasn't ended, `future` included.
  - `src/lib/finance/budget.ts:142-143`: `diffWords`.
  - `src/components/budget/report.tsx` (Summary, around :205-276, and `LineCard`).
- Screenshots: `bflow-draft-report-light.png`, `crop-draft-report-1.png`.
- What happens: the eyebrow says `DÖNEM HENÜZ BAŞLAMADI.`, but under it the page reads:
  - `₺0,00` and `Plan ₺23.500,00 · %0 · ₺23.500,00 eksik`
  - every income card shows a `Sürüyor` chip and `₺12.500,00 eksik`
  - every expense card shows `Bütçe içinde` and `kaldı`
- Why it's P1: a plan is normally written and approved **before** its season starts. So this is the exact screen the board looks at when it votes on the budget (`Onayla`). It tells them money is "missing" from a season that hasn't begun.
- Fix (when `phase === "future"`):
  - Summary:
    - Eyebrow `Dönem henüz başlamadı`, with no full stop. An eyebrow is a label, not a sentence.
    - Three blocks: `Planlanan gelir` / `Planlanan gider` / `Planlanan net` with `formatKurus` / `formatNet`, in the same type scale as now (`text-2xl font-semibold`).
    - No `Plan … · %… · … eksik` line.
    - Below them, `text-sm text-muted-foreground`: `Gerçekleşenler Eylül 2027'den itibaren burada görünür.`
  - `LineCard`:
    - Keep the label and `Plan ₺12.500,00`.
    - Hide the `Gerçekleşen` dt/dd, the words line and the bar.
    - Show the neutral chip `Başlamadı`: `bg-muted text-muted-foreground`, icon `CalendarClock`.
  - `signalOf`: add a `future` signal, or return `null`, so the CSV `Durum` cell is empty for future budgets rather than `Sürüyor`.
  - The list row (`/finans/butce`) already omits `Gelir %… · Gider %…` for the draft, which is correct. Keep it that way.

### P2

**P2-1. On the phone, the active `Bütçe` chip is off-screen.**
- Where: `src/components/finance/finance-nav.tsx` (the `nav` has `overflow-x-auto`, but nothing scrolls the active chip into view). Screenshot: `b-list-375-light.png`, which shows `Özet · Hareketler · Aidat · Etkinlikler` with nothing active.
- My `ux.md` §6 assumed `ActiveChipIntoView` already did this; it is only mounted on `/finans/hareketler`. The same bug hits `Rapor`, `Sponsorlar` and `Ayarlar`; Bütçe, as the seventh of eight chips, just makes it obvious.
- Fix: render `<ActiveChipIntoView label="Finans bölümleri" />` inside `FinanceNav`, once. Every finance page then gets it.

**P2-2. `Yeni bütçe` opens on a start month that's already taken, so the first thing the user sees is an error.**
- Where: `src/lib/finance/budget.ts:69` `defaultStart`, used at `src/lib/finance/queries.ts:790`. Screenshot: `b-new-overlap-375-light.png`.
- What happens: today (Oct 2026) the default is Eylül 2026. Pressing `Oluştur` without changing anything gives `Bu tarihler 2026–27 sezonu bütçesiyle çakışıyor.` That will happen in every month of a season that already has its budget, i.e. most of the year.
- Fix (needs a one-line D33 amendment by @po):
  - Default to the D33 September **unless it overlaps an existing budget**.
  - In that case, default to the month after the latest budget's `end_month` (here Eylül 2027, named `2027–28 sezonu`).
  - `budgetFormDefaults()` already runs on the server with the budget list available.

**P2-3. On the phone the report hides its answer below 3–5 action buttons.**
- Where: `src/app/(portal)/finans/butce/[id]/page.tsx:46-63`. Screenshots: `crop-b-report-cur-375-light-0.png`, `bflow-draft-report-light.png`.
- What happens:
  - An approved budget shows `Planı değiştir`, `Notu düzenle` and `CSV indir` (2 rows), plus the CSV hint.
  - A draft shows `Onayla`, `Planı düzenle`, `Bilgileri düzenle`, `CSV indir` and `Sil` (3 rows).
  - The summary card starts at about 400 px CSS on approved budgets and 500 px on drafts.
  - The board opens this page to read numbers, not to edit them. Five equal pills also put `Sil` one row away from `Onayla`.
- Fix:
  - Header: keep only the **one** primary action under the subline: `Onayla` for a draft, `Planı değiştir` for an approved budget.
  - Then the summary card, the cash note and the lines, unchanged.
  - Move the rest to the end of the page (after `Değişiklik geçmişi`), in a `section` with `h2.text-xl` `Bütçe işlemleri`, as a `flex flex-wrap gap-2` row:
    - draft: `Planı düzenle` · `Bilgileri düzenle` · `CSV indir` (+ hint `CSV, Excel'de Türkçe açılır.`) · `Sil`, as ghost `text-destructive`
    - approved: `Notu düzenle` · `CSV indir`
  - From `lg`, the header may keep `CSV indir` next to the primary (there's room). The phone keeps one button.

**P2-4. In the plan editor, `Hiçbir tutar değişmedi.` breaks the save bar and outlives the change it describes.**
- Where: `src/components/budget/plan-editor.tsx:281` (sticky bar). Screenshots: `bflow-nochange-light.png`, `bflow-changed-row-light.png`.
- What happens:
  - At 375 the message squeezes the Net text, so it wraps as `Net +` / `₺81.450,00`: the sign is split from the number.
  - After I changed `Ulaşım ve konaklama` to `26.000`, the bar still said `Hiçbir tutar değişmedi.`, in red, while there was a change.
- Fix:
  - Show it as `toast.info("Hiçbir tutar değişmedi.")`, not in the bar. It isn't an error, so it shouldn't be `text-destructive`.
  - If it stays inline, clear it in the inputs' `onChange`.
  - Either way, give the bar's Net `whitespace-nowrap tabular-nums`.

**P2-5. `Önceki 12 aydan doldur` silently uses a window that hasn't finished.**
- Where: `src/components/budget/plan-editor.tsx:246-249` (button and hint) and `prefillPlan`. Screenshot: `bflow-prefilled-light.png`.
- What happens: for a budget starting Eylül 2027, the hint says `Eylül 2026 – Ağustos 2027 gerçekleşenleri yazılır`. But today is 21 Ekim 2026, so it fills `Aidat ₺4.000,00` for a 12-month plan (7 weeks of dues). The numbers look authoritative and are off by a factor of about 8.
  - This happens whenever next season's draft is written before August ends, which is when a careful treasurer starts it.
- Fix, when the window's last day is after today:
  - Hint: `Eylül 2026 – 21 Ekim 2026 arası yazılır; bu dönem henüz bitmedi, rakamlar eksik olabilir.` (date via `formatAuditDate`).
  - Button stays enabled.
  - After filling, use `toast.warning("Önceki dönem henüz bitmedi: yazılan rakamlar yalnızca 21 Ekim 2026'ya kadarki kayıtlar.")` instead of the success toast.

**P2-6. On the phone, the ticket's `Sil` takes a whole row at the same weight as `Durum` and `Düzenle`.**
- Where: `src/app/(portal)/yonetim/[numara]/page.tsx` (aside, `{t.canDelete && <TicketDelete …/>}`). Screenshots: `detail3-375-light.png`, `flow-created-light.png`.
- What happens: `Durum: Takıldı ▾` and `Düzenle` fill row 1, and `Sil` (outline, red) wraps to row 2, directly above the facts card. The page is opened daily to move or comment. Delete is rare, and it's the most prominent thing after the title.
- Fix:
  - Below `lg`, render `TicketDelete` at the end of the page, after the comment form: a ghost button `İşi sil` (`Trash2`, `h-11 px-3 text-sm text-destructive`), left-aligned, `mt-6`.
  - From `lg`, keep it in the aside under `Düzenle`, as now.
  - The confirm (`#7 silinsin mi?` / `İş ve tüm yorumları kalıcı olarak silinir.`) is good as is.

### P3

1. **Description hint is ungrammatical.**
   - Where: `src/components/board/ticket-form.tsx:218`.
   - `Bağlantıları olduğu gibi yapıştır; tıklanır olmaz ama kopyalanabilir.` → `Bağlantıyı olduğu gibi yapıştırabilirsin; tıklanmaz ama kopyalanabilir.` (my own `ux.md` §2 wording; I correct it here).
2. **Active urgency trigger loses its label.**
   - Where: `src/components/board/board-controls.tsx` (trigger).
   - A filled `Acil ▾` looks like a card's urgency chip. Show `Aciliyet: Acil` visibly; it's on its own wrapped row anyway, so width isn't a constraint.
3. **Edit page back link reads only `‹ #1`.**
   - Where: `src/app/(portal)/yonetim/[numara]/duzenle/page.tsx:22`.
   - Use `İşe dön`, matching `Panoya dön`.
4. **Comment `Sil` has no time left.**
   - Where: `CommentDelete` in `src/components/board/ticket-client.tsx`.
   - The spec'd `· 12 dk` hint is missing. Render `Sil · 12 dk` (minutes left, refreshed by the existing timer), so people know it disappears.
5. **Copy-link control is icon-only.**
   - Where: `CopyLinkButton` (`#7 🔗`). A 30–60 year old won't guess the chain-link icon means "share in WhatsApp".
   - Add visible text: `Bağlantıyı kopyala` (`text-sm`, still 44 px).
6. **Desktop detail aside actions are ragged.**
   - Where: `src/app/(portal)/yonetim/[numara]/page.tsx` (aside `flex flex-wrap gap-2`). Screenshot: `detail1-1280-light.png`.
   - `Durum: Yapılacak` and `Düzenle` stack at different widths. From `lg`:
     - `Durum` gets `w-full justify-between`
     - `Düzenle` and `Sil` share a `grid grid-cols-2 gap-2` row below it
7. **No stuck signal on the 4-column board.**
   - Where: the `xl` column header in `board-column.tsx`.
   - The tabs show a `bg-late` dot on `Takıldı` when its count is above 0; the 4-column header doesn't. Add the same 6 px dot before the count.
8. **Plan editor group subtotals are duplicated and misaligned.**
   - Where: `src/components/budget/plan-editor.tsx:255-256`.
   - `Planlanan gelir/gider` appear under each card, inset differently from the card (x = 20 vs 33 CSS px), and again in the totals box 60 px later.
   - Move the subtotal into the legend row, right-aligned, as specified: `GELİR ……… ₺130.000,00`.
9. **Save bar is sticky on desktop too.**
   - Where: `md:bottom-4` on the sticky bar (`plan-editor.tsx:281`). Screenshot: `b-editor-cur-1280-light.png`.
   - At 1280 it covers the expense column's `Banka masrafı` row while scrolling. Either add `lg:static`, or keep it sticky but limit it to the form column. Low impact.
10. **Net line on desktop has no separator.**
    - Where: `src/components/budget/report.tsx:262-276`.
    - `Plan +₺81.450,00  Dönem sürüyor` reads as one phrase. Add ` · ` before the verdict or status.
11. **`kaldı` is wrong once the period has ended.**
    - Where: `diffWords`, `src/lib/finance/budget.ts:143`.
    - After the end, `₺10.000,00 kaldı` suggests money can still be spent. When `ended`, use `₺10.000,00 harcanmadı`. Income `eksik` stays.
12. **History entry squeezes the reason onto the name/date line.**
    - Where: `History` in `report.tsx`.
    - `Demo Yönetim · 11 Eki 2026 17:33 · "Festival daveti geldi…"` is all on one line. Put the reason on its own `text-sm` line, as `ux.md` §6.4 specified.
13. **Approved `Notu düzenle` shows locked fields.**
    - Where: `budget-meta-form.tsx` when `locked`.
    - The disabled month and year selects and the greyed name input look broken. Render `2026–27 sezonu · Eylül 2026 – Ağustos 2027` as plain text with the existing hint `Onaylanmış bütçenin adı ve tarihleri değişmez.`, and leave only `Not` editable.
14. **List period bar is unexplained.**
    - Where: `src/app/(portal)/finans/butce/page.tsx`.
    - The grey bar sits right under `Gelir %12 · Gider %14`, so it reads as money. Add `text-xs text-muted-foreground` `Dönemin geçen kısmı: %14` above it, or drop the bar.
15. **Draft delete confirm copy.**
    - `Kayıtlar (hareketler) etkilenmez.` → `Kasa hareketleri etkilenmez.` The parentheses were my wording, and they aren't plain.
16. **Home card `Üyeler ›` looks like a board row.**
    - Where: `src/components/board/home-card.tsx`.
    - It sits inside the card as a third bordered row. Move it outside the card, under it, as `text-sm text-primary` `Üyeler ve davetler ›`, so it isn't read as a board item. Keep it phone-only.

## What works well (keep)

- **Tabs.** The board tabs at 375 have clear counts, the dark selected tab is `bg-background`, and the `Takıldı` dot shows.
- **Move feedback.** After a move the card leaves the tab and `Göster` takes you to the new column.
- **Empty states.** The no-match panel `Bu filtreye uyan iş yok.` + `Filtreleri temizle` and the `Bitti` tab's `Arşiv: 30 günden eski işler` both work.
- **System entries.** Muted and avatar-less, so the comments stand out. `Demo Yönetim son tarih koydu: 15 Kas 2026.` reads naturally.
- **Errors.** Form errors show both a summary banner and the field message (`Başlık en az 3 karakter olmalı.`), and focus goes to the first error. The overlap message names the colliding budget.
- **Editor rows.** Compact rows with the `₺` prefix and blur normalisation. The `Tutarı 1.250,50 biçiminde gir.` row error and the overwrite confirm `Yazdığın tutarların yerine önceki 12 ayın rakamları yazılsın mı?` work as specified.
- **Running report.** `Dönemin geçen kısmı: %14` / `21 Ekim 2026 itibarıyla`, the period marker on each bar, and `Dönem sürüyor` instead of a premature net verdict. In the ended report, `Plandan kötü` uses `TrendingDown` and the absent-ink tone.
- **Tokens and themes.** Dark mode is correct everywhere I checked. No raw colours were seen, and the chips always carry an icon or a word.
