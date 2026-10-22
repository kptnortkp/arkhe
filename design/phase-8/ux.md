# Phase 8 UX plan: Yönetim Kurulu board and budget plan vs actual

Author: UX designer. Date: 2026-10-21. Reads: `po-spec.md` (AC 1–45), `CLAUDE.md`, `design/TEAM.md`, current code `src/app/(portal)/layout.tsx`, `src/components/shell/{app-nav,nav-items}.tsx`, `src/app/(portal)/page.tsx`, `src/components/{homework,finance}/home-cards.tsx`, `src/app/(portal)/odevler/page.tsx`, `src/app/(portal)/finans/rapor/page.tsx`, `src/components/finance/{finance-nav,amount-input,money-amount,net-label,choice-chips}.tsx`, `src/components/filter-chip.tsx`, `src/components/homework/{deadline-chip,assignment-menu}.tsx`, `src/lib/finance/categories.ts`, `src/lib/labels.ts`, `src/lib/money.ts`.

Evidence: screenshots of the live dev server as yk@ (home, `/finans`, `/finans/rapor`, `/odevler`) at 390, 768, 1024 and 1280 px, light and dark, plus **mocks injected into the real portal shell** (real sidebar, real fonts, real tokens) for the board at 360/375/768/1024/1280 px, the six-tab bottom bar at 360/375/390 px, and the budget report at 375 px light/dark. All files are in the scratchpad `p8ux/` folder (not the repo); file names are cited where they prove a point.

**No token changes.** Everything maps onto existing tokens (table in §0.4). No raw colours.

---

## 0. Replies to the PO

### 0.1 Breakpoint for four columns (D4): @po: agree with `lg`, with one correction and one condition

- **Correction to the arithmetic.** The content width is smaller than D4 says. The sidebar is `w-64` (256 px) and `main` has `md:px-10` (80 px), so the board gets **432 px at 768**, **688 px at 1024** and **944 px at 1280** (`main` is capped by `max-w-5xl`). Not 520 at 768.
- **768 px with four columns is unusable** (`board-768-cols-light.png`): columns are 99 px wide, the `Taşı` button covers the number, titles show one or two words, names truncate to `De…`, and the header wraps (`Devam / ediyor`). Tabs at 768 are right. `md` is out.
- **1024 px works only with a compact card** (`board-1024-cols-light.png` vs `boardC-1024-cols-light.png`). With the phone card (the `Taşı` button beside the title) the title column shrinks to about 50 px (`Bahar / kons…`). With the compact card below (§1.4), the 2-line titles read (`Bahar konseri için / CSO salon…`) and only the assignee name truncates (`Demo Y…`), which is acceptable because the avatar initials stay and the full name is on the detail page. At 1280 everything fits (`boardC-1280-cols-dark.png`).
- **Condition:** from `lg` the card uses the compact variant (§1.4). Below `lg` it uses the phone variant. AC 5 stays as written.

### 0.2 The bottom bar (D8): @po: agree there's no sixth tab; disagree with leaving the board out of the bar

- **A sixth tab really does break the bar.** Measured in the real bar with a sixth item (`crop-bar-360-six-light.png`): at 360 px each tab is 60 px wide and `Repertuvar` is 57 px, `Çalışmalar` 55 px. The labels touch (`Çalışmalar Repertuvar` reads as one phrase). At 375 there's 6–8 px between labels. So: no sixth tab.
- **But the board is the main manager tool on the phone, and Üyeler isn't.** Üyeler is used for inviting someone and looking up a member: a few times a season, and mostly at a desk. The board is meant to replace a daily WhatsApp habit (risk 2). Its only "someone gave you a job" signal (D7) is a badge. If that badge is only in a desktop sidebar and halfway down the home page, most board members (on phones, 30–60 years old) won't see it. The home card is a fallback, not a signal: it scrolls below the hero, Ödevlerim and Ödevler (`_-m-light.png`: the first manager card starts at y≈700 of 844).
- **Proposal (preferred), for managers only:**
  - Replace `Üyeler` in the bottom bar with **`Yönetim`** (icon `SquareKanban`), which carries the D7 badge.
  - It fits: `Yönetim` is 41 px in a 75 px slot at 375 (`crop-bar-375-swap-light.png` shows the shorter `Kurul` at 27 px; `Yönetim` was measured at 41 px).
  - Use the label `Yönetim`, not `Kurul`. `Kurul` alone is unclear, and the şef isn't a board member but uses the page too.
  - `Üyeler` becomes `sidebarOnly`. On the phone it is reached from the board header (`Üyeler` link, §1.2) and from the home card's footer. Members are unchanged (4 tabs).
  - AC 2 changes to "the 5 manager tabs are Ana sayfa, Çalışmalar, Repertuvar, Ödevler, Yönetim", with the same no-overflow check.
- **If you keep D8 as written,** the minimum is:
  - The home card goes directly **below the hero**, above `Ödevlerim`, for managers.
  - The card shows the most urgent assigned ticket's title (§3), so it is worth a glance.
  - Re-check in a month as §7 says.

  I still recommend the swap: it costs one array entry in `nav-items.ts` and one AC wording.

### 0.3 Other replies

- **@po: urgency filter on the phone (D10).** Two chip groups make 7 chips plus a divider, and at 375 the urgency chips are off-screen (`board-375-tabs-light.png`: `Tüm aciliyetler` is cut at the edge). Three filled primary elements (`Herkes`, `Tüm aciliyetler`, the active tab) compete with `Yeni iş`. Proposal, below `lg`:
  - One row: `Herkes` · `Bana atananlar <n>` · `Aciliyet: Tümü ▾`.
  - The last one is a dropdown of 5 links (`Tümü`, `Acil`, `Yüksek`, `Orta`, `Düşük`), each with `aria-current` when active.
  - When an urgency is set, the trigger reads `Acil` with a filled style, plus a separate `×` link (44 px, `aria-label="Aciliyet filtresini kaldır"`).
  - From `lg`, all chips are inline as in AC 9.
  - The URLs and AC 9's semantics are unchanged. The label `Tüm aciliyetler` becomes `Tümü` inside the urgency group: shorter, and the group label says what it is.
- **@po: the `Durum` select on the detail page (AC 16).** A native `<select>` that saves on `change` is a keyboard trap: in desktop Chrome, arrow keys fire `change` per step, so one keypress moves the ticket. Use the **same menu button as `Taşı`**: a button labelled `Durum: Yapılacak ▾`, menu of the other three columns. It looks the same, uses the same code path and the same toast, and is keyboard-safe. In the edit form (`Düzenle`), `Durum` is not an editable field; status only changes through the menu. AC 16's wording "select" should become "menu".
- **@po: `Plandan iyi / Plandan kötü` during a running period (AC 35).** D16 argues that choir money is lumpy, so we don't pro-rate. The same argument applies to net. In October the dues plan is 12 months but 2 months have arrived, while the costume deposit is already paid. Net will read `Plandan kötü` almost all year, and that's the line the board reads first. Proposal: show `Plandan iyi` / `Plandan kötü` **only when the period has ended**. While it runs, show `Dönem sürüyor` muted under Net, like the income `pending` rule. Same for the CSV/email (no change there; they don't carry it).
- **@po: Turkish suffixes after percentages are wrong for most numbers.** In `Dönemin %<p>'si geçti`, the email's `gelir hedefin %<x>'i, gider planın %<y>'si`, and the list's `Gelir %<x> · Gider %<y> of plan`, the suffix depends on how the number is read: %40'ı, %30'u, %42'si, %100'ü, %6'sı, %3'ü, %9'u. A fixed `'si`/`'i` is wrong for more than half of 0–100. Don't write a suffix function; rephrase so no suffix is needed:
  - `Dönemin geçen kısmı: %42` (header), with `21 Ekim 2026 itibarıyla` on the next line.
  - Email: `Bütçe (2026–27 sezonu, Onaylandı): gelir planın %41 kadarı, gider planın %43 kadarı gerçekleşti.` Simpler alternative: `… gelir: plana göre %41 · gider: plana göre %43.` I prefer the second, because it matches the list row.
  - List row: `Gelir %41 · Gider %43 (plana göre)`.
- **@po: system entries for an empty due date (D5).** `son tarihi — → 15 Kas 2026 olarak değiştirdi.` reads badly aloud and on screen. Proposal:
  - set: `Demo Şef son tarih koydu: 15 Kas 2026.`
  - changed: `Demo Şef son tarihi 15 Kas 2026 → 22 Kas 2026 olarak değiştirdi.`
  - removed: `Demo Şef son tarihi kaldırdı.`

  The other D5 sentences are fine. Name + accusative object (`durumu`, `sorumluyu`, `aciliyeti`) never puts a suffix on a person's name.
- **@po: move toast (AC 15).** `#12 → Devam ediyor` is developer shorthand. Plain: `#12 Devam ediyor sütununa taşındı.` On the phone the card leaves the visible tab, so the toast has an action `Göster` that goes to `?sutun=<new>`. Sonner supports one action button.
- **@po: stale refusal (D11).** Same copy, but as an error toast with the action `Yenile` (`router.refresh()`). A 60-year-old shouldn't have to find the browser's reload.
- **@po: `Planı revize et` → `Planı değiştir`.** `Revize` is office jargon. `Değişiklik gerekçesi` stays.
- **@po: prefill label (D18).** `Geçen yılın gerçekleşenleriyle doldur` says "last year", but the window is the 12 months before the start (Eylül 2025 – Ağustos 2026), not a calendar year. It's also 38 characters on a 343 px button. Use:
  - Button: `Önceki 12 aydan doldur`.
  - Hint under it: `Eylül 2025 – Ağustos 2026 gerçekleşenleri yazılır, liraya yukarı yuvarlanır. Kaydetmeden önce değiştirebilirsin.`
  - If any input already has a value, show a confirm: `Yazdığın tutarların yerine önceki 12 ayın rakamları yazılsın mı?` / `Vazgeç` / `Doldur`.
- **@backend: `parseAmount` rejects 0** (`AMOUNT_ZERO`). In the plan editor `0` and `0,00` must mean "not planned", the same as blank, and not an error. Treat `kurus === 0` as blank in the budget action only.
- **@po: agree** with D1–D3, D5–D7, D9, D11–D17, D19 and D20, with the Turkish column labels, with `Takıldı`, with the 15-minute comment delete, and with no drag-and-drop.

### 0.4 Token map (no new tokens)

| Meaning | Fill / bar | Text | Chip |
|---|---|---|---|
| Alert (Acil, Gecikti, Bütçe aşıldı) | `bg-absent` | `text-absent-ink` | solid `bg-absent text-absent-foreground` (solid fill = readable without hue, like the overdue `DeadlineChip`) |
| Warning (Yüksek, Sınıra yakın, Hedefin altında, Plansız gider) | `bg-late` | `text-late-ink` | `bg-late/18 text-late-ink` |
| Good (Hedefe ulaşıldı, Bütçe içinde, Plandan iyi) | `bg-present` | `text-present-ink` | `bg-present/14 text-present-ink` |
| Neutral (Orta, Sürüyor, Plansız gelir) | `bg-muted` | `text-muted-foreground` | `bg-muted text-muted-foreground` |
| Low (Düşük) | none | `text-muted-foreground` | `border bg-transparent text-muted-foreground` (no fill, so it's quieter than Orta) |
| Income bar | `bg-present` | `MoneyAmount kind="income"` | — |
| Expense bar | `bg-foreground/40` (as on `/finans/rapor`; spending isn't red) | `MoneyAmount kind="expense"` | — |
| Period marker | `bg-foreground/60`, 2 px | — | — |
| `Yeni` | dot `bg-gold`, 8 px | `text-primary font-semibold` (navy in light, gold in dark) | — |

Every chip carries an icon or a word, so colour is never the only signal.

---

## 1. `/yonetim`: the board

### 1.1 Page frame

- `metadata.title = "Yönetim Kurulu"`, `requireManager()`.
- Container: the normal `main` (no extra max width). `space-y-4` below `lg`, `space-y-5` from `lg`.

### 1.2 Header (all widths)

- Row 1: `flex items-end justify-between gap-3`.
  - `h1.text-4xl.font-medium` `Yönetim Kurulu`. It fits next to the button at 360 (`board-360-tabs-light.png`).
  - Primary button `Yeni iş` (`Plus` icon), `h-11 rounded-full px-4`, links to `/yonetim/yeni?sutun=<current tab>` so a job created from the `Takıldı` tab starts as `Takıldı`.
- Row 2 (links, `text-sm font-medium text-primary`, each `min-h-11 inline-flex items-center`):
  - `Arşiv` (icon `Archive`) → `/yonetim/arsiv`
  - `Üyeler` (icon `Users`) → `/uyeler`, only if the bar swap in §0.2 is accepted, and only below `md`. On desktop the sidebar has it.
  - Separated by `·` in `text-muted-foreground`.

### 1.3 Filters

- **Below `lg`:** one row, `flex gap-2 overflow-x-auto -mx-4 px-4` (as `FinanceNav`), `nav aria-label="Filtreler"`:
  1. `FilterChip` `Herkes` → removes `kim`.
  2. `FilterChip` `Bana atananlar` with `count` = my open tickets under the current urgency filter.
  3. Urgency menu chip (§0.3): same 44 px pill. Label `Aciliyet: Tümü` with `ChevronDown`. When a value is set, it shows the label (`Acil`) in the filled `bg-primary text-primary-foreground` style, plus an `×` link to clear it.
- **From `lg`:** two inline groups, `nav aria-label="Kişi"` and `nav aria-label="Aciliyet"`, separated by a 1 px `bg-border` divider: `Herkes`, `Bana atananlar <n>` | `Tümü`, `Acil`, `Yüksek`, `Orta`, `Düşük`. All `FilterChip`.
- Active chips use the existing `aria-current="page"`, which AC 9 allows.

### 1.4 Columns below `lg`: segmented tabs

- `nav aria-label="Sütunlar"` of 4 links (server-rendered, works without JS, matches `FilterChip`'s `aria-current` pattern). If @ui prefers `role="tablist"` for AC 5's e2e, use links inside `role="tablist"` with `role="tab"` and `aria-selected`. Pick one and stay consistent.
- Track: `grid grid-cols-4 gap-1 rounded-2xl bg-muted p-1`.
- Tab: `min-h-13` (52 px), `rounded-xl`, two lines centred:
  - count: `text-lg tabular-nums leading-tight` (`data-count`)
  - label: `text-xs whitespace-nowrap`
  - Measured: `Devam ediyor` at 12 px fits a 78 px cell at 360 (`board-360-tabs-light.png`).
- Selected tab: `bg-card dark:bg-background shadow-sm font-semibold text-foreground`. In dark mode `bg-card` is too close to `bg-muted` (`board-375-tabs-dark.png`); `bg-background` is darker than the track and reads clearly. Unselected: `text-muted-foreground`.
- Accessible name per link: `Yapılacak, 4 iş`.
- `Takıldı` count > 0 gets a 6 px `bg-late` dot before the count. A stuck job is the one thing the board must notice. `Bitti` never gets a dot.
- Cards below: `ul.flex.flex-col.gap-3` of phone cards.
- In the `Bitti` tab, after the list: link `Arşiv: 30 günden eski işler` → `/yonetim/arsiv`.
- Between 768 and 1023 the same layout is used. At 768 a 2-column card grid is possible (432 px is too narrow), but single column is calmer, so keep single column.

### 1.5 Columns from `lg`: four regions

- `div.grid.grid-cols-4.gap-3.items-start`. Each column is a `section aria-labelledby` with `rounded-2xl bg-muted/50 p-2 space-y-2`.
- Header: `h2.font-sans.text-sm.font-semibold.px-1.5.py-1 flex justify-between` showing `Yapılacak` and `4` (`text-muted-foreground tabular-nums`, `data-count`).
- No per-column add button: one `Yeni iş` in the header.
- Columns scroll with the page, not independently. Nested scroll areas trap trackpads and break the e2e "visible" checks. At our scale (tens of open tickets), page scroll is fine.
- `Bitti` column footer: the archive link from §1.4.

### 1.6 Ticket card (`data-testid="ticket-card"`, `data-status`, `data-urgency`)

The whole card is one link to `/yonetim/<n>`, except the move button. Implement it as `li.relative`, with the title link stretched by `after:absolute after:inset-0`, and the `Taşı` button `relative z-10`. No nested interactive elements.

**Phone card (below `lg`)** (`board-375-tabs-light.png`):
- `rounded-2xl border bg-card p-3 pl-3.5`, `space-y-2`, `hover:border-primary/30`.
- Row 1 (`flex items-start gap-2`):
  - Left, `flex-1 min-w-0`:
    - line 1: `#14` (`text-xs text-muted-foreground tabular-nums`) and, when new, the `Yeni` marker: 8 px `bg-gold` dot + `Yeni` (`text-xs font-semibold text-primary`). The visible word is the accessible text; there's no separate sr label (AC 6 asks for `yeni`, so use `<span class="sr-only">, yeni</span>` only if the visible word is removed).
    - line 2: the title, `text-[15px] font-medium leading-snug line-clamp-2`.
  - Right: `Taşı` button, `h-11 rounded-full border px-3 text-sm` with `ChevronDown`, `aria-label="#14 taşı"`.
- Row 2 (`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground`):
  - urgency chip (§0.4): `Acil` solid alert, `Yüksek` warning, `Orta` muted, `Düşük` outline. `rounded-full px-2.5 py-0.5 text-xs font-medium`. `Acil` gets the `Flame` icon (size-3.5) and `Yüksek` gets `ArrowUp`, so the level reads without colour.
  - due date: `15 Kas` with `CalendarDays` size-3.5. Overdue and not `Bitti`: `Gecikti · 15 Kas` in `text-absent-ink font-medium` with `AlarmClock`, `data-overdue="true"`. Today: `Bugün` in `text-late-ink`.
  - comments when > 0: `MessageSquare` size-3.5 + `3`, with `<span class="sr-only"> yorum</span>`.
- Row 3: the assignee (`flex items-center gap-2 text-sm`):
  - `UserAvatar` `size-6 text-[10px]` + full name, `truncate`.
  - Unassigned: a dashed 24 px circle (`border border-dashed border-input`) + `Atanmadı` in `text-muted-foreground`.
  - Former manager: `Ayşe Kaya (kurulda değil)`, with the suffix in `text-muted-foreground`.
- `Bitti` cards: title `text-muted-foreground`; the urgency chip is hidden, because urgency is irrelevant once done (AC 6 still finds it via `data-urgency`); `Bitti · 3 Eki` replaces the due date.

**Compact card (from `lg`)** (`boardC-1024-cols-light.png`):
- `rounded-xl p-2.5 pl-3 space-y-1.5`, title `text-sm font-medium line-clamp-2`.
- Row 2 as on the phone.
- Row 3: avatar `size-[22px]`, name `text-xs truncate flex-1`, and the move button at the end: **icon-only** `ArrowLeftRight`, `size-11 rounded-full text-muted-foreground hover:bg-muted`, same `aria-label="#14 taşı"`, `title="Taşı"`. On desktop the icon + tooltip is enough; on the phone the word stays because touch has no hover.

### 1.7 `Taşı` menu

- `DropdownMenu` (base-ui; keyboard per AC 15), `align="end"`, `min-w-52`.
- Group label: `Şuraya taşı` (`text-xs text-muted-foreground`).
- Items, `min-h-11`, in column order, excluding the current one:
  - `Yapılacak` (icon `Circle`)
  - `Devam ediyor` (`CircleDot`)
  - `Takıldı` (`CircleAlert`, `text-late-ink`)
  - `Bitti` (`CircleCheck`, `text-present-ink`)
- While pending, the trigger shows a spinner and is disabled. On success:
  - the card leaves the list (optimistic; it comes back if refused)
  - both tab counts update
  - toast `#14 Takıldı sütununa taşındı.` with action `Göster` → `?sutun=takildi` (kept filters)
- Stale: error toast `Bu iş az önce değişti. Sayfayı yenile.` with action `Yenile`.
- The same icons are used for the `Durum` menu on the detail page.

### 1.8 Empty states

- **The whole board is empty** (no tickets at all, filters off; this happens on the first day of use): one dashed panel instead of the tabs/columns, `staff-lines rounded-2xl border border-dashed bg-card px-6 py-12 text-center space-y-3`:
  - icon `SquareKanban` size-8 muted
  - `p.font-medium` `Panoda henüz iş yok.`
  - `p.text-sm.text-muted-foreground` `Kurulun yapacağı işleri buraya yaz. Her işin bir numarası olur; WhatsApp'ta “12 numaralı iş” diye paylaşabilirsin.`
  - button `Yeni iş`
- **Empty column:** `rounded-xl border border-dashed p-4 text-sm text-muted-foreground text-center` `Bu sütunda iş yok.` From `lg` it sits inside the column, so the column keeps its height.
- **Filter has no match:** `Bu filtreye uyan iş yok.` + link `Filtreleri temizle` (`text-primary`, 44 px) → `/yonetim?sutun=<same>`.

---

## 2. `/yonetim/yeni` and `/yonetim/<n>/duzenle`: ticket form

- Container `max-w-xl space-y-6`. Back link `BackLink` `Panoya dön`. `h1.text-3xl` `Yeni iş` / `#14 düzenle`.
- Field order (ten-second rule: the first three are all that's needed):
  1. `Başlık`: `Input h-11 text-base`, `autoFocus` on create, `maxLength` not set (server message), counter `42/120` from 100 characters.
     - Hint: `Kısa ve net: “Bahar konseri için salon rezervasyonu”.`
  2. `Sorumlu`: native `select h-11` (`Atanmadı` first, then names A→Z).
     - To the right (from `sm`; below on the phone), a link-button `Bana ata` (`text-sm text-primary min-h-11`) that sets the select to me.
     - Former manager as the current value: option `Ayşe Kaya (kurulda değil)`, shown only when it is the current value.
  3. `Aciliyet`: `ChoiceChips`, 4 chips `Düşük` `Orta` `Yüksek` `Acil`, default `Orta`. They fit one row at 343 px (≈ 300 px).
  4. `Son tarih`: `input type="date" h-11`, plus a `Temizle` link when set. Optional label `(isteğe bağlı)` in muted text.
  5. `Açıklama`: `Textarea rows=5 min-h-32`, `(isteğe bağlı)`.
     - Hint: `Bağlantıları olduğu gibi yapıştır; tıklanır olmaz ama kopyalanabilir.`
     - Counter from 3800 characters.
  6. `Durum` (create only): `ChoiceChips` `Yapılacak` `Devam ediyor` `Takıldı` `Bitti`, default from `?sutun=` or `Yapılacak`. They wrap to 2 rows at 343, which is fine. In edit, status isn't a field (§0.3).
- Actions: `Kaydet` (primary, `h-11 rounded-full`, full width below `sm`) and `Vazgeç` (ghost, back to where the user came from).
- Errors inline under each field (`text-sm text-destructive`), values kept, focus on the first error (`use-focus-error`). Copy as in AC 10/11.
- Create success → detail page, toast `#14 açıldı.`
- Edit success → detail page, toast `Kaydedildi.`
- Edit stale → form stays with a banner above the actions:
  - `rounded-2xl border border-late/40 bg-late/10 p-4` with `TriangleAlert text-late-ink`
  - `Bu iş az önce değişti. Sayfayı yenile.` + button `Yenile`
  - Nothing is saved. Add one line: `Yazdıkların yenileyince silinir; önce kopyalayabilirsin.` Without it, someone loses a long description silently.

## 3. Ticket detail `/yonetim/<n>`

### 3.1 Phone (375)

Top to bottom, `space-y-5`:
1. `BackLink` `Panoya dön` → `/yonetim?sutun=<column>`.
2. Header block:
   - `#14` (`text-sm text-muted-foreground tabular-nums`) + `CopyButton` icon-only `Bağlantıyı kopyala` (44 px), which copies the absolute `/yonetim/14` URL. Risk 2 relies on pasting the URL into WhatsApp, so make that one tap.
   - `h1.text-2xl.font-medium.leading-tight` the title (wraps, no clamp).
3. State row (`flex flex-wrap gap-2`):
   - `Durum: Takıldı ▾` menu button (`h-11 rounded-full border px-4`, the column icon in its tone)
   - overflow menu `MoreHorizontal` (44 px, `aria-label="Diğer işlemler"`) with `Düzenle` and `Sil` (destructive, only for the opener and the şef)
   - plus a visible outline button `Düzenle` (`Pencil`), as `AssignmentMenu` does
4. Facts `dl` (`grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm rounded-2xl border bg-card p-4`):
   - `Sorumlu`: avatar + name / `Atanmadı`
   - `Aciliyet`: chip
   - `Son tarih`: `15 Kasım 2026 Pazar`, or `Gecikti · 15 Kas` alert, or `Son tarih yok` muted
   - after a `Separator`, `text-xs text-muted-foreground`:
     - `Açan: Demo Şef · 3 Eki 2026`
     - `Son değişiklik: Demo YK · 20 Eki 14:05` (Phase 6 pattern)
5. Description: `whitespace-pre-wrap break-words text-[15px] leading-relaxed`. Absent: nothing (no "Açıklama yok" noise).
6. Thread `section aria-labelledby="akis"`, `h2.text-xl` `Akış` with the count `3 yorum` muted. Oldest first, `ol.space-y-3`:
   - **Comment** (`data-kind="comment"`):
     - `UserAvatar size-8` + name (`text-sm font-medium`) + time (`text-xs text-muted-foreground`, `20 Eki 14:05`)
     - body `whitespace-pre-wrap break-words text-sm` in `rounded-2xl bg-card border p-3`
     - Own comment under 15 minutes: ghost `Sil` button, `h-11 px-3 text-sm text-muted-foreground`, with `· 12 dk` remaining in the hint. It hides itself when time runs out (client timer). The server is the check.
     - Confirm: `Yorum silinsin mi?` / `Bu yorum kalıcı olarak silinir.` / `Vazgeç` / `Sil`.
   - **System entry** (`data-kind="system"`):
     - no avatar and no box: `flex gap-2 text-xs text-muted-foreground py-1 pl-3`, a 6 px `bg-border` dot aligned with the avatar column
     - the sentence (actor name `font-medium text-foreground/80`, values as plain text) and the time after `·`
     - no controls
   - With 10+ comments, no "load more": AC 42 tests 10, and the scale is small. Plain list.
7. Comment box (`form`, at the end, not sticky; sticky textareas fight the phone keyboard):
   - `Label` `Yorum ekle` (visible, satisfies AC 43)
   - `Textarea rows=3 min-h-24` placeholder `Yorum yaz…`
   - `Gönder` primary `h-11 rounded-full`, right-aligned, disabled while pending and while empty
   - Counter from 1800 characters. Errors inline.
   - After success the textarea clears, focus stays in it, and the new comment scrolls into view.

### 3.2 Desktop (from `lg`)

- `grid grid-cols-[minmax(0,1fr)_18rem] gap-8`.
- Left: header, description, thread, comment box.
- Right `aside` (sticky `top-10`): the `Durum` menu (full width), the facts card, `Düzenle`, and `Sil`.
- `md`–`lg`: as on the phone.

### 3.3 Delete confirm

`ConfirmDialog`: `#14 silinsin mi?` / `İş ve tüm yorumları kalıcı olarak silinir.` / `Vazgeç` / `Sil` (destructive). Success → `/yonetim`, toast `#14 silindi.`

## 4. `/yonetim/arsiv`: archive

- `BackLink` `Panoya dön`. `h1.text-3xl` `Arşiv`. Lead `text-sm text-muted-foreground`: `30 günden uzun süredir Bitti'de duran işler. Hiçbiri silinmez.`
- List `ul.divide-y.rounded-2xl.border.bg-card`, rows `min-h-16 px-4 py-3` linking to the detail:
  - line 1: `#5` muted + the title (`line-clamp-2`)
  - line 2: `text-xs text-muted-foreground`: `Bitti · 3 Eyl 2026 · Demo YK`
- Paging: `flex justify-between` with `Daha yeni` (left) and `Daha eski` (right), outline `h-11 rounded-full`, shown only when there is something to page to.
- Empty: the dashed panel with `Archive` icon and `Arşivde iş yok.`
- No filters here (out of scope).

## 5. Navigation and home

### 5.1 Sidebar (`md`+)

- `Yönetim Kurulu` (icon `SquareKanban`) between `Finans` and `Üyeler`.
- It carries a new `boardBadge` with the existing `Badge` and the sr text `, <n> yeni iş` (AC 22).
- `aria-current` on `/yonetim*` already works via `startsWith`.

### 5.2 Bottom bar

- Preferred: managers see `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim`, with the badge on `Yönetim` (§0.2).
- Otherwise: unchanged.

### 5.3 Home card (`data-testid="home-board"`)

- Position: for managers, **right after the hero** (before `Ödevlerim`), if the bar swap isn't accepted. If the swap is accepted, put it after `Ödevlerim` and before the manager `Ödevler` card.
- `CardHeader` pattern from `home-cards.tsx`: `h2` `Yönetim Kurulu`, link `Pano ›` → `/yonetim`.
- With assigned open tickets:
  - A block linking to `/yonetim?kim=ben`, `rounded-2xl border bg-card p-4 space-y-2`:
    - `Sana atanan 3 açık iş` (`text-lg font-medium`; the `3` is `tabular-nums`)
    - then inline: `· 1 yeni` (gold dot + `text-primary font-semibold`) and `· 1 acil` (`text-absent-ink font-medium`). Exact text order per AC 3.
  - Below, inside the card, `divide-y`: up to **2** of my tickets (most urgent first, same order as AC 7). Each row links to its detail, `min-h-11`, showing `#14 Bahar konseri için CSO salon…` (`truncate`) + the urgency chip. One tap from home to the job. Managers only; AC 3's korist HTML check is unaffected.
- With none: `p.text-sm.text-muted-foreground` `Sana atanmış açık iş yok.` + link `Panoya git ›` (`text-primary`, 44 px).
- If the swap is accepted, the card's footer adds `Üyeler ›` as a small link for the phone. Otherwise not needed.

## 6. Budget `/finans/butce`

`FinanceNav` gains `Bütçe` between `Rapor` and `Ayarlar` (`["butce", "Bütçe", "/finans/butce"]`). On the phone the chip row already scrolls; `ActiveChipIntoView` keeps `Bütçe` visible.

### 6.1 List

- Header row: `h1.text-4xl` `Bütçe` + primary `Yeni bütçe` (`Plus`, `h-11 rounded-full`). `FinanceNav active="butce"` below.
- `ul.space-y-3` of cards (`rounded-2xl border bg-card p-4`, whole card links to the report):
  - line 1: name (`font-medium text-lg`) + status chip:
    - `Taslak`: `border text-muted-foreground`, `PencilLine` icon
    - `Onaylandı`: `bg-present/14 text-present-ink`, `CircleCheck` icon
    - plus `Şu anki` (`bg-primary/10 text-primary`) for the current one
  - line 2: `Eylül 2026 – Ağustos 2027` (`text-sm text-muted-foreground`)
  - line 3 (current/past only): `Gelir %41 · Gider %43 (plana göre)` (`text-sm tabular-nums`) and, for the current one, a 6 px period bar (`bg-foreground/60` on `bg-muted`) with `aria-hidden` (the header text carries it).
- Empty: dashed panel, icon `Calculator`:
  - `Henüz bütçe yok.`
  - `Sezon başında planı yaz; portal yıl boyunca gerçekleşenle karşılaştırır.`
  - `Yeni bütçe` button

### 6.2 Create `/finans/butce/yeni`

- `max-w-xl`. `BackLink` `Bütçeler`. `h1.text-3xl` `Yeni bütçe`.
- `Başlangıç ayı`: **two native selects**, not `input type="month"`. `type=month` is a free-text box in desktop Safari and Firefox, and a treasurer will try both.
  - `Ay` (Ocak…Aralık, `h-11`) and `Yıl` (current year −1 … +2), side by side, `grid grid-cols-[1fr_7rem] gap-2`.
  - Default: per AC 26 (Eylül, current year in Sep–Dec, else the coming year).
- Read-only line below: `Bitiş: Ağustos 2027 · 12 ay` (`text-sm text-muted-foreground`, `aria-live="polite"`).
- `Ad`: `Input h-11`, prefilled `2026–27 sezonu` (Sep start), `2027` (Jan start), otherwise `Ekim 2026 – Eylül 2027`.
  - It follows the start month **until the user types in it**; after that it keeps the user's text.
  - Hint: `Örn. 2026–27 sezonu`.
- `Not`: `Textarea rows=3` `(isteğe bağlı)`.
  - Hint: `Varsayımlar: “2 konser, 40 korist × aylık 300 ₺”.`
  - Counter from 450 characters.
- `Oluştur` primary → the plan editor, toast `Taslak oluşturuldu. Şimdi tutarları yaz.`
- Errors inline (AC 26 copy). The overlap error sits under the month selects.

### 6.3 Plan editor `/finans/butce/<id>/duzenle` (17 rows on a phone)

The existing `AmountInput` is `h-14 text-2xl` with an echo line, about 120 px per field, so 17 of them is about 2000 px. Too long. The editor uses a **compact row**:

- Page: `BackLink` `<ad>`. `h1.text-3xl`: `Planı yaz` (draft) / `Planı değiştir` (approved). Subline `Eylül 2026 – Ağustos 2027`.
- Approved only, **first** field: `Değişiklik gerekçesi` `Textarea rows=2`.
  - Hint: `Örn. “Festival daveti geldi, ulaşım arttı.” Geçmişe yazılır.`
  - First on purpose: the sticky save can't be reached "by accident" without it, and the error focuses it.
- Prefill row: outline button `Önceki 12 aydan doldur` (`Sparkles` icon, `h-11 rounded-full`, full width below `sm`) + the hint from §0.3. Draft and approved both.
- Two `fieldset`s with a legend eyebrow `Gelir` / `Gider` and the group subtotal on the right of the legend (`tabular-nums`, `aria-live="polite"`).
- Each row: `li.flex.items-center.gap-3.py-2` inside `rounded-2xl border bg-card px-4 divide-y`:
  - `label` (`flex-1 text-sm`, wraps: `Şef / korrepetitör ücreti` takes 2 lines at 375; that's fine)
  - input wrapper `w-[9.5rem] relative` with a `₺` prefix (`absolute left-3 text-muted-foreground`), `Input h-11 text-base text-right tabular-nums pl-7`, `inputmode="decimal"`, `enterKeyHint="next"`, `placeholder="0"`
  - on blur, a valid value is normalised to `12.500,00` (as `AmountInput`), which serves as the dot/comma echo
  - error: a second line under the row, `text-sm text-destructive`, `aria-describedby`; the row gets `bg-destructive/5`
  - approved only, when the value differs from the saved one: a line under the input `önceki ₺20.000,00` (`text-xs text-muted-foreground`), and a 2 px `bg-gold` left bar on the row. The user sees the diff before writing the reason.
- In-flow totals after the groups (`dl`, `rounded-2xl bg-muted p-4`):
  - `Planlanan gelir` `₺175.000,00`
  - `Planlanan gider` `₺150.000,00`
  - `Planlanan net` `+₺25.000,00` (`formatNet`; negative → `text-absent-ink`)
- **Sticky save bar:** `sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-4`, `rounded-2xl border bg-background/95 backdrop-blur p-3 flex items-center justify-between gap-3 shadow-lg`. It sits above the bottom nav.
  - left: `Net +₺25.000,00` (`text-sm tabular-nums`, `aria-hidden`: the in-flow `dl` is the accessible copy)
  - right: `Kaydet` primary `h-11 rounded-full px-6`, `type="submit"`, disabled while pending
  - About 68 px tall. With the bottom nav (66 px) that leaves about 700 of 844 px for the form.
- Leaving with unsaved changes: `beforeunload` warning only (no custom dialog).
- Success → the report with toast `Plan kaydedildi.` Errors keep every typed value.
- Desktop `lg`: the two fieldsets side by side (`grid-cols-2 gap-6`), totals and save in a normal row under them (not sticky).

### 6.4 Report `/finans/butce/<id>` (`budget-375-x-light.png`, `budget-375-x-dark.png`)

**Header**
- `BackLink` `Bütçeler`. `h1.text-3xl md:text-4xl` name.
- Subline: `Eylül 2026 – Ağustos 2027` · status chip (§6.1).
- Approved only: `Onaylayan: Demo Şef · 12 Eyl 2026` (`text-xs text-muted-foreground`).
- Actions (`flex flex-wrap gap-2`):
  - draft: `Onayla` (primary), `Planı düzenle` (outline), overflow with `Sil`
  - approved: `Planı değiştir` (outline)
  - both: `CSV indir` (outline, `Download`)
- Draft only, a note `rounded-2xl border border-dashed p-4 text-sm`: `Bu bütçe taslak. Kurulda ya da genel kurulda kabul edilince Onayla'ya bas.`

**Summary card** (`rounded-2xl border bg-card p-4 md:p-6 space-y-4`)
- Eyebrow: `Dönem içi durum` / `Dönem sonu raporu` / (future) `Dönem henüz başlamadı.`
- Running:
  - `Dönemin geçen kısmı: %42` (`text-base font-medium`)
  - `21 Ekim 2026 itibarıyla` (`text-sm text-muted-foreground`)
  - a 6 px bar `bg-foreground/60` on `bg-muted`, `aria-hidden`
- Three rows, each a **block** (not one dense line; the mock's single-line `₺72.300,00 / ₺175.000,00 %41` was too dense at 375):
  - `Toplam gelir`: `₺72.300,00` (large, `text-2xl font-semibold tabular-nums`). Below it in `text-sm`: `Plan ₺175.000,00 · %41 · ₺102.700,00 eksik`.
  - `Toplam gider`: the same pattern, with `kaldı` / `aşıldı`.
  - `Net (gelir − gider)`: `+₺8.388,00` (`formatNet`). Below it: `Plan +₺25.000,00`, then either `Plandan iyi` (present-ink, `TrendingUp`), `Plandan kötü` (absent-ink, `TrendingDown`), or `Dönem sürüyor` (muted) while running (§0.3).
  - Phone: stacked. From `md`: three columns.
- The cash-basis note, once, under the card (`text-xs text-muted-foreground`): `Gerçekleşen: bu tarihlerde kasaya ve bankaya gerçekten giren ve çıkan para. Ödenmemiş aidat sayılmaz.`
- Legend for the bars (once, above `Gelir`): a 2 px × 12 px marker + `Dönemin geçen kısmı` (`text-xs text-muted-foreground`). Running periods only.

**Line cards, phone** (`data-testid="budget-line"`), grouped under `h2` eyebrows `Gelir`, then `Gider`:
- `rounded-2xl border bg-card px-4 py-3.5`.
- Row 1: label (`font-medium`) + signal chip (§0.4, with icon: `CircleCheck` good, `TriangleAlert` warning, `CircleAlert` over, `Hourglass` pending, `Plus` unplanned).
- `dl` 2 columns: `Plan` / `₺120.000,00`; `Gerçekleşen` / `₺49.800,00` (`font-semibold`) + `%42` (muted). Every number has its label in the `dt`, so a screen reader reads "Gerçekleşen ₺49.800,00" (AC 43).
- Bar (`h-2 rounded-full bg-muted relative mt-2.5`, `aria-hidden`):
  - fill `min(pct,100)%`: income `bg-present`; expense `bg-foreground/40`; `near` `bg-late`; `over` `bg-absent`
  - over-mark when pct > 100: a 4 × 14 px `bg-absent` cap at the right end
  - period marker at `p%` (`data-elapsed`), 2 × 16 px `bg-foreground/60`, running periods only
- Words line (`text-sm`): `₺70.200,00 eksik` / `₺1.500,00 fazla` / `₺10.500,00 kaldı` / `₺6.000,00 aşıldı` / `Planla aynı`, in the signal's text tone (good → present-ink, over → absent-ink font-medium, else muted).
- **Plan = 0 lines** (unplanned): `Plan` shows `Planlanmadı`, no bar, no % and no words line. The chip says it all; the mock's `Plansız` under `Plansız gider` was redundant.

**Table from `lg`:**
- `table` inside `rounded-2xl border bg-card`, `caption.sr-only` `<ad> plan ve gerçekleşen`.
- `th scope=col`: `Kategori` | `Plan` | `Gerçekleşen` | `%` | `Fark` | `Durum` | `İlerleme` (`w-40`, bar only, `aria-hidden` cell content with `sr-only` "%42").
- Rows `th scope=row` per category; group header rows `Gelir` / `Gider` (`th colSpan` `bg-muted/50`); a total row per group.

**History** (approved only, when revisions exist), `section` `h2.text-xl` `Değişiklik geçmişi`, newest first:
- each entry `rounded-2xl border bg-card p-4 space-y-1.5`:
  - `Demo YK · 20 Eki 2026 14:05` (`text-sm font-medium`)
  - the reason in quotes (`text-sm`)
  - `ul.text-sm.tabular-nums`: `Ulaşım ve konaklama: ₺20.000,00 → ₺26.000,00`
- Approval itself appears as the oldest entry: `Demo Şef · 12 Eyl 2026 · Onaylandı` (no lines). It shows the full chain on one page. @backend: derive it from the approval fields; it's not a revision row.

**Approve confirm:** `Bütçe onaylansın mı?` / `Onaydan sonra adı ve başlangıç ayı değişmez. Tutar değişiklikleri gerekçesiyle geçmişe yazılır.` / `Vazgeç` / `Onayla`. Success toast `Bütçe onaylandı.`

**Delete confirm (draft):** `“2026–27 sezonu” silinsin mi?` / `Plan tutarları da silinir. Kayıtlar (hareketler) etkilenmez.` / `Vazgeç` / `Sil`. The second sentence matters: a treasurer fears losing ledger data.

### 6.5 CSV

- Button `CSV indir` (no range form, unlike `/finans/rapor`; the budget fixes the range).
- Hint under it: `Excel'de Türkçe açılır.` Same as the other CSVs.

---

## 7. Copy review: final strings I propose (for `po-decisions.md`)

| Where | PO draft | Proposed |
|---|---|---|
| Move toast | `#12 → Devam ediyor` | `#12 Devam ediyor sütununa taşındı.` + action `Göster` |
| Stale (any) | `Bu iş az önce değişti. Sayfayı yenile.` | same + action `Yenile` |
| Due-date system entry | `son tarihi — → 15 Kas 2026 olarak değiştirdi.` | `son tarih koydu: 15 Kas 2026.` / `son tarihi 15 Kas 2026 → 22 Kas 2026 olarak değiştirdi.` / `son tarihi kaldırdı.` |
| Detail status control | `Durum` select | menu button `Durum: <değer>` |
| Urgency filter "all" | `Tüm aciliyetler` | `Tümü` (inside the `Aciliyet` group) |
| Board empty (new) | — | `Panoda henüz iş yok.` + `Kurulun yapacağı işleri buraya yaz. Her işin bir numarası olur; WhatsApp'ta “12 numaralı iş” diye paylaşabilirsin.` |
| Form self-assign (new) | — | `Bana ata` |
| Period header | `Dönemin %<p>'si geçti (<bugün> itibarıyla)` | `Dönemin geçen kısmı: %<p>` + `<bugün> itibarıyla` |
| List row | `Gelir %<x> · Gider %<y>` of plan | `Gelir %<x> · Gider %<y> (plana göre)` |
| Email line | `gelir hedefin %<x>'i, gider planın %<y>'si.` | `Bütçe (<ad>, <durum>): gelir plana göre %<x> · gider plana göre %<y>.` |
| Net verdict | `Plandan iyi` / `Plandan kötü` always | same, only after the period ends; `Dönem sürüyor` while running |
| Cash note | `Gerçekleşen: o tarihlerde kasaya ve bankaya giren ve çıkan tutarlar.` | `Gerçekleşen: bu tarihlerde kasaya ve bankaya gerçekten giren ve çıkan para. Ödenmemiş aidat sayılmaz.` |
| Revise | `Planı revize et` | `Planı değiştir` |
| Prefill | `Geçen yılın gerçekleşenleriyle doldur` | `Önceki 12 aydan doldur` + hint + overwrite confirm |
| Prefill none | `Önceki 12 ayda kayıt yok.` | same |
| Approve confirm body | `Onaydan sonra plan değişiklikleri gerekçeyle kaydedilir.` | `Onaydan sonra adı ve başlangıç ayı değişmez. Tutar değişiklikleri gerekçesiyle geçmişe yazılır.` |
| Budget empty | `… yıl sonunda gerçekleşenle karşılaştıralım.` | `Henüz bütçe yok.` + `Sezon başında planı yaz; portal yıl boyunca gerçekleşenle karşılaştırır.` |
| Draft delete body | — | `Plan tutarları da silinir. Kayıtlar (hareketler) etkilenmez.` |
| Unplanned line plan cell | — | `Planlanmadı` |
| Create toast (new) | — | `Taslak oluşturuldu. Şimdi tutarları yaz.` |

The rest of the PO's copy is plain and stays as written: `Yapılacak`, `Devam ediyor`, `Takıldı`, `Bitti`, `Yeni iş`, `Taşı`, `Atanmadı`, `(kurulda değil)`, `Yeni`, `Sana atanan <n> açık iş`, `Sana atanmış açık iş yok.`, `Panoya git`, `Yorum yaz…`, `Gönder`, the comment errors, `Arşivde iş yok.`, the signal labels, `Planla aynı`, `Hiçbir tutar değişmedi.`, `Bu plan az önce değişti. Sayfayı yenile.`

## 8. Checks for @ui and the review round

- At 360 and 375, light and dark: `/yonetim` (each tab, with the filter row), a detail with 10 comments, `/yonetim/yeni`, `/finans/butce`, a report and the editor. No horizontal scroll; every target ≥ 44 px, including the urgency menu `×`, the `Sil` on comments and the copy-link button.
- 1024 px: compact cards, titles readable on 2 lines; 768 px: tabs.
- The sticky save bar never covers the last input: the form needs `pb-24` below `md`, so the last row can scroll above the bar.
- The dark selected tab is `bg-background` (not `bg-card`).
- Every chip has an icon or a word; no colour-only signal.
