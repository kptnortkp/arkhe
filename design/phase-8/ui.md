# Phase 8 UI engineering plan

Author: UI engineer. Date: 2026-10-21. Reads: `po-spec.md` (no `ux.md`, `db.md` or `backend.md` yet; I'll reconcile once they land), Next 16 docs (`01-getting-started/04-linking-and-navigating.md` § Native History API), and the current `src/app/(portal)/{layout,page}.tsx`, `finans/rapor/page.tsx`, `finans/loading.tsx`, `src/components/{filter-chip,confirm-dialog,use-run-action,flash-toast}.tsx`, `src/components/shell/{nav-items.ts,app-nav.tsx}`, `src/components/finance/{finance-nav,amount-input,money-amount,net-label,home-cards}.tsx`, `src/components/forms/*`, `src/components/repertoire/piece-menu.tsx`, `src/components/homework/{deadline-chip,feedback-seen}.tsx`, `src/components/ui/tabs.tsx`, `src/lib/{money,time,labels}.ts`, `src/lib/finance/{categories,queries}.ts`, `scripts/finance-fixture.mjs`, `e2e/{run,lib,mail,phase4-homework,phase5-finance,phase6-c-finance,phase6-z-guards,phase7-a-cron}.mjs`.

Facts I checked before planning:
- **Phase 5 e2e asserts the exact FinanceNav chip list** (`e2e/phase5-finance.mjs:174-176`: `"Özet,Hareketler,Aidat,Etkinlikler,Sponsorlar,Rapor,Ayarlar"`). Adding `Bütçe` breaks it. So AC 40's "All Phase 1–7 e2e tests pass **unchanged**" isn't possible. See @po 1.
- **Phase 4 e2e reads the first `[data-nav-badge]` in the page** (`e2e/phase4-homework.mjs:17-20`) and asserts `sef@` has **no** badge (`:110`). If the board badge also uses `data-nav-badge` and sef@ has a `Yeni` ticket, Phase 4 fails. See @po 2.
- **Phase 7 asserts exactly 5 attachments** for January 2025 (`phase7-a-cron.mjs:369`) and January 2024 (`:462`). The seeded budgets must never cover those months. They won't if the budget seed is anchored to "now" like the finance fixture (§9.4).
- **`parseAmount` refuses 0** (`AMOUNT_ZERO`, `src/lib/money.ts:27`) and blank (`AMOUNT_EMPTY`). The plan editor needs blank → 0 and `0` → 0. See @backend 3.
- **There is no clock override for pages.** `now()` is `new Date()` (`src/lib/time.ts:5`). Only the cron route takes `?bugun=`. So "a page render with today pinned to the end of M" (AC 38) can't be done as written. See @po 4.
- **The seeded ledger covers only M-2…M** (`scripts/finance-fixture.mjs:5`), and `seedFinance` wipes every finance table on each e2e cleanup. Today that happens to touch both seeded seasons (Aug 2026 falls in 2025–26), but from December on it won't. So "the seeded ledger already has entries in both ranges" is true only by accident (§9.4).
- **The sidebar leaves less room than D4 assumes.** The sidebar is `w-64` (256 px), `main` has `md:px-10` (80 px) and `max-w-5xl` (1024 px). Content width: 768 → 432 px, 1024 → 688 px, 1280 → 944 px. Four columns with three 12 px gaps come to **99 px at 768, 163 px at 1024, 227 px at 1280**. See @po 3.
- **Safari desktop has no `<input type="month">`** (it falls back to a text box), and the user tests in Safari (see the Phase 7 Safari invite fix). The month picker uses two native selects (§5.2).
- **The finance `loading.tsx` would wrap `/finans/butce`** with the Özet skeleton (tiles plus a list), which is the wrong shape. So the budget pages get their own (§7).
- The existing "seen" pattern is a client effect calling an action on mount (`homework/feedback-seen.tsx`), which never fires on a prefetch. I reuse it for the board (§3.6).
- `lucide-react` has `SquareKanban`, `ArrowRightLeft`, `MessageSquare`, `CalendarX`, `Siren`, `Archive`, `Target`, `ChevronsUp`.
- `axe-core` is already a devDependency (`phase6-c-finance.mjs:247`).

**No new dependency. No new shadcn component.** Everything below uses `button`, `dropdown-menu`, `alert-dialog` (through `ConfirmDialog`), `input`, `textarea`, `label`, `card`, `separator` and `sonner`, which are already in `src/components/ui`.
- I don't use `tabs`: base-ui hides inactive panels, and at `xl` all four columns must be visible (§2.2).
- I don't use `select`: native `<select>` is the house style (`entry-form.tsx:241`, `assignment-form.tsx:105`) and gives the OS picker on the phone.
- I don't use `table`: one DOM for cards and rows avoids duplicate `data-testid` (§5.4).

---

## 1. Files (frontend side; the backend owns `src/lib/board/*`, `src/lib/budget/*` and the actions)

| File | Kind | Content |
|---|---|---|
| `src/app/(portal)/yonetim/page.tsx` | Server | `requireManager()`, parses `sutun`/`kim`/`aciliyet`, one `getBoard()` call, renders `BoardHeader`, `BoardControls` and the 4 `BoardColumn`s |
| `src/app/(portal)/yonetim/loading.tsx` | Server | skeleton (§7) |
| `src/app/(portal)/yonetim/yeni/page.tsx` | Server | `requireManager()`, `assigneeOptions()`, `<TicketForm mode="create">` |
| `src/app/(portal)/yonetim/[numara]/page.tsx` | Server | `requireManager()`; `notFound()` unless `/^\d{1,9}$/` and the row exists; detail plus thread |
| `src/app/(portal)/yonetim/[numara]/duzenle/page.tsx` | Server | `<TicketForm mode="edit" revision=…>` |
| `src/app/(portal)/yonetim/arsiv/page.tsx` | Server | `?sayfa=` paging, 50 per page |
| `src/app/(portal)/yonetim/actions.ts` | backend | §8.1 |
| `src/components/board/board-controls.tsx` | Client | column switcher plus filter chips (§2.2, §2.6) |
| `src/components/board/board-column.tsx` | Server | `<section>` with heading, count and cards or empty state |
| `src/components/board/ticket-card.tsx` | Server | card (§2.3) |
| `src/components/board/move-menu.tsx` | Client | `Taşı` dropdown (§2.4) |
| `src/components/board/urgency-chip.tsx` | Server | chip by urgency |
| `src/components/board/due-label.tsx` | Server | `15 Kas` / `Gecikti · 15 Kas` |
| `src/components/board/ticket-form.tsx` | Client | create/edit form (§3.2) |
| `src/components/board/status-select.tsx` | Client | detail `Durum` select (§3.3) |
| `src/components/board/thread.tsx` | Server | thread list (§3.4) |
| `src/components/board/comment-form.tsx` | Client | textarea plus `Gönder` (§3.5) |
| `src/components/board/comment-delete.tsx` | Client | `Sil` plus confirm |
| `src/components/board/ticket-delete.tsx` | Client | `Sil` plus confirm |
| `src/components/board/ticket-seen.tsx` | Client | marks seen on mount (§3.6) |
| `src/components/board/home-card.tsx` | Server, async | home card (§4.2) |
| `src/app/(portal)/finans/butce/page.tsx` | Server | list |
| `src/app/(portal)/finans/butce/loading.tsx` | Server | skeleton |
| `src/app/(portal)/finans/butce/yeni/page.tsx` | Server | `<BudgetCreateForm>` |
| `src/app/(portal)/finans/butce/[id]/page.tsx` | Server | report |
| `src/app/(portal)/finans/butce/[id]/duzenle/page.tsx` | Server | `<PlanEditor>` |
| `src/app/(portal)/finans/butce/[id]/csv/route.ts` | backend | CSV |
| `src/app/(portal)/finans/butce/actions.ts` | backend | §8.2 |
| `src/components/budget/budget-create-form.tsx` | Client | §5.2 |
| `src/components/budget/plan-editor.tsx` | Client | §5.3 |
| `src/components/budget/plan-amount-row.tsx` | Client | compact amount row |
| `src/components/budget/revise-dialog.tsx` | Client | diff preview plus reason (§5.5) |
| `src/components/budget/budget-line.tsx` | Server | one report line (§5.4) |
| `src/components/budget/budget-bar.tsx` | Server | bar, over-mark and period marker |
| `src/components/budget/signal-chip.tsx` | Server | signal chip |
| `src/components/budget/budget-summary.tsx` | Server | totals and net |
| `src/components/budget/budget-history.tsx` | Server | `Değişiklik geçmişi` |
| `src/components/budget/budget-actions.tsx` | Client | `Onayla` / `Sil` with confirms |
| `src/components/finance/finance-nav.tsx` | edit | add `["butce", "Bütçe", "/finans/butce"]` between `rapor` and `ayarlar` |
| `src/components/shell/nav-items.ts` | edit | the new entry plus `badge?: "homework" \| "board"` instead of `homeworkBadge` |
| `src/components/shell/app-nav.tsx` | edit | `badges: { homework; board }` prop; `badgeLabel(kind, n)` |
| `src/app/(portal)/layout.tsx` | edit | `Promise.all([openHomeworkCount, boardBadgeCount, readFlash])` |
| `src/app/(portal)/page.tsx` | edit | `{manager && <BoardHomeCard />}` after `ManagerHomeworkCard` (@ux may move it) |
| `src/lib/board/labels.ts` | add (shared) | status/urgency labels, URL slugs ↔ codes, tones; isomorphic, no Node APIs |

Labels live in one isomorphic module so the server's system-entry sentences (D5), the CSV and the UI can't drift. @backend: please put `STATUS_LABELS`, `URGENCY_LABELS`, `SUTUN_SLUGS` and `ACILIYET_SLUGS` there, or tell me where you'd rather keep them.

---

## 2. `/yonetim` (the board)

### 2.1 Page structure

```
<header>  h1 "Yönetim Kurulu"   [Arşiv] (link, outline)   [+ Yeni iş] (primary, h-11)
<BoardControls>                   client: column nav (< xl) + filter chips
<div class="xl:grid xl:grid-cols-4 xl:gap-3">
  <BoardColumn status="todo" />   server-rendered, all 4 always in the HTML
  …
</div>
```
- At 375 px the header wraps (`flex flex-wrap items-end justify-between gap-3`). `Yönetim Kurulu` at `text-4xl` is about 290 px, so the two buttons go to the second row. On mobile `Arşiv` is an icon-plus-text link `h-11`. It's also linked at the bottom of the `Bitti` column (AC 23).
- All four columns are rendered on the server every time. Below `xl`, the not-selected ones get `max-xl:hidden`. The cost is small (≤ 100 non-archived tickets in practice, 300 in the AC 44 test), and it makes switching columns instant.

### 2.2 Columns vs tabs: a nav of links, enhanced on the client

- **Below `xl`:** `<nav aria-label="Sütunlar">` with 4 links (`?sutun=yapilacak|devam|takildi|bitti`, keeping `kim`/`aciliyet`). The selected one has `aria-current="true"` and `data-count`.
- `BoardControls` gets `initialColumn` from the server and keeps it in `useState`. On click it calls `preventDefault()`, sets the state, and runs `window.history.replaceState(null, "", href)`. Next 16 syncs that with the router (docs § Native History API), so a later `router.refresh()` after a move re-renders with the right `searchParams`, and a reload keeps the tab (AC 4).
- I use `replaceState`, not `pushState`, so switching tabs doesn't fill the back stack. Without JS, the links still work as plain navigation.
- Column visibility is driven from the client by a single attribute:
  - `BoardControls` renders a wrapper `<div className="group/board" data-column={selected}>` around the columns. The columns arrive as `children` (Server Components passed through the client boundary).
  - Each server-rendered column has a static class pair for its own status, for example `max-xl:hidden group-data-[column=todo]/board:max-xl:flex`.
  - The server HTML is identical for every tab, and switching changes one attribute.
- **Why not ARIA `tablist`/`tabpanel`:** at `xl` the "panels" are all visible and the tabs hidden, so the tab semantics would lie. Base-ui `Tabs` also sets `hidden` on inactive panels. AC 43 allows "a nav of links with `aria-current`".
  - @po: AC 5's test wording "the tablist is visible" becomes "`nav[aria-label=Sütunlar]` is visible". AC 4's "segmented control with four tabs" is unchanged visually.
- **Shape at 375 px:** a 4-cell segmented control won't fit in one row with label and count side by side. The content width is 343 px, and `Yapılacak 4 · Devam ediyor 2 · Takıldı 1 · Bitti 3` needs about 365 px at 14 px.
  - Each cell therefore stacks the **count on top** (`text-lg font-semibold tabular-nums`) and the **label below** (`text-xs`). That's `grid grid-cols-4`, each cell `min-h-14`, about 84 px wide, and `Devam ediyor` at 12 px is about 75 px.
  - Accessible name: `Yapılacak, 4 iş`. The visual count is `aria-hidden`, and the sr-only text carries it.
  - @ux: this is the constraint. The visual treatment is yours.
- **At `xl`:** the nav is `xl:hidden`. Each column is `<section aria-labelledby>` with `<h2>` `Yapılacak` and a count pill (`data-count`).

### 2.3 Breakpoint (D4)

**@po: I recommend four columns from `xl` (1280 px), not `lg`.**
- At 1024 px a column is 163 px. After the card's `p-3` that leaves 139 px for `#12 Salon için Mülkiye ile görüş` (2 lines clamp), the urgency chip, the date and a 44 px `Taşı` button. That fits, but titles clamp at about 16 characters a line, and `Gecikti · 15 Kas` plus `Acil` won't share a row.
- At 1280 px a column is 227 px, which is comfortable.
- Between 1024 and 1279 the tab layout is a single wide column, which reads fine.
- AC 5's e2e (1280 → columns, 768 → tabs) passes unchanged with `xl`. I'd add 1024 → tabs.
- I'll attach a 1024 px screenshot to `review-ui.md` once it exists, since I'm not writing to the dev DB now.

### 2.4 Card (`ticket-card.tsx`, Server)

```
<article data-testid="ticket-card" data-status data-urgency data-number data-overdue? data-new?
         class="relative rounded-2xl border bg-card p-3 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50">
  <h3 class="line-clamp-2 text-base font-medium [overflow-wrap:anywhere]">
    <a href="/yonetim/12" class="outline-none after:absolute after:inset-0 after:rounded-2xl">
      <span class="text-muted-foreground tabular-nums">#12</span> Başlık
      {new && <span class="sr-only">, yeni</span>}
    </a>
  </h3>
  <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <UrgencyChip/> <DueLabel/> <span>Atanmadı | Ad Soyad</span> <comments/>
  </div>
  <MoveMenu class="relative z-10 …"/>   // outside the link: no nested interactive content
  {new && <span aria-hidden class="absolute top-3 right-3 size-2.5 rounded-full bg-primary" data-testid="new-dot"/>}
</article>
```
- **Stretched link.** The whole card is clickable through the link's `::after`, and `Taşı` sits above it with `relative z-10`. That gives one tab stop for the link and one for `Taşı`, with no link-inside-button.
- **The `Yeni` marker** is a dot plus sr-only `yeni` inside the link name, so a screen reader hears `#12 Salon rezervasyonu, yeni` (AC 6: the accessible text is `yeni`). AC 6 says "the `Yeni` dot". If @ux wants a visible word, use a `Yeni` pill and drop the sr-only text.
- **Urgency chip** (text always visible, so colour is never the only cue):
  - `Acil`: `bg-absent/12 text-absent-ink` plus `Siren`
  - `Yüksek`: `bg-late/18 text-late-ink` plus `ChevronsUp`
  - `Orta`: `bg-muted text-foreground`
  - `Düşük`: `bg-muted text-muted-foreground`

  These are the same token pairs as `DeadlineChip`, already checked in both themes.
- **Due date:** `15 Kas` (`formatter({ day: "numeric", month: "short" })`). When overdue and not done, it's `CalendarX` plus `Gecikti · 15 Kas` in `text-absent-ink font-medium`, with `data-overdue="true"`. "Overdue" means `due_on < today (Istanbul)`, computed on the server only, so there's no hydration risk.
- **Comments:** `MessageSquare` plus `3` with sr-only `yorum`, shown only when > 0.
- **Assignee:** the first name plus surname initial at `xl` (narrow columns), and the full name below `xl`. A former manager shows `Ad Soyad (kurulda değil)` (AC 11).
- **Titles** use `[overflow-wrap:anywhere]` so a pasted Drive URL in a title can't widen the page (AC 4 overflow).

### 2.5 `Taşı` menu (`move-menu.tsx`, Client)

- It uses `DropdownMenu` like `PieceMenu`. The trigger is `<Button variant="outline" size="sm" class="h-11 min-w-11">` with `ArrowRightLeft` plus `Taşı`, and `aria-label="#12 taşı"` (AC 15). Below `xl` it's icon plus text. At `xl` it's icon only, with the same aria-label.
- The items are the other three statuses, each `min-h-11`, with label only.
- Base-ui Menu gives Enter/Space to open, arrows, Enter to choose, and Esc, so AC 15's keyboard path comes for free.
- On choose it calls `run(() => moveTicket({ number, from: status, to }))` through `useRunAction` (toast plus `router.refresh()`). The server returns `success: "#12 → Devam ediyor"` or the D11 error. The trigger is disabled while pending, so it can't double-move.
- **Focus after a successful move.** Below `xl` the card leaves the visible column, so its trigger unmounts and focus would fall to `<body>`.
  - In the `after` callback I move focus to the **next card's link** in the same column, or to the column's heading (`tabIndex={-1}`) when it was the last card.
  - Sonner's live region announces the toast.
  - At `xl` the same rule applies, because the card left the column.
- No optimistic update: a refresh is about 100 ms locally, and the D11 check must be able to say no. If it feels slow on Turso, `useOptimistic` on the column lists is a local change for later.

### 2.6 Filters (inside `BoardControls`)

- There are two `<nav>`s of `FilterChip`s: `aria-label="Kişi"` (`Herkes`, `Bana atananlar`) and `aria-label="Aciliyet"` (`Tüm aciliyetler`, `Acil`, `Yüksek`, `Orta`, `Düşük`). `FilterChip` already sets `aria-current="page"` and `min-h-11` (AC 9).
- They live in the client component so their hrefs carry the **current** `sutun` after a client-side tab switch. Otherwise a filter click would jump back to the server's initial column.
- The urgency row is one horizontal scroller (`-mx-4 flex overflow-x-auto px-4`, the `FinanceNav` pattern, with `ActiveChipIntoView`). It doesn't change `document.scrollingElement.scrollWidth`, so the AC 4 overflow check holds. The `Kişi` row is 2 chips and fits.
- Unknown values: the server ignores them and treats them as no filter (AC 9). The client gets the normalized values as props and never reads raw `searchParams`.
- Filter links are real navigations (`<Link>`, push), because counts and cards must come from the server.

### 2.7 Empty states (AC 8)

- `Bu sütunda iş yok.` is a dashed-border block like `/finans/rapor`.
- With filters: `Bu filtreye uyan iş yok.` plus a `Filtreleri temizle` link (`min-h-11`) to `/yonetim?sutun=<same>`.
- `Bitti` always ends with `Arşiv ›` (`min-h-11`), even when empty.

---

## 3. Tickets

### 3.1 Routes

- `/yonetim/<numara>` is the detail page, and `/yonetim/<numara>/duzenle` is the editor.
- AC 13's stale test ("load the editor in two pages") needs a page, so I use a route, not an inline edit. It also reuses `TicketForm` from `/yonetim/yeni`.
- The segment is `[numara]`. The page validates `/^\d{1,9}$/` before the query, so `abc` gives `notFound()` without a DB hit (AC 12).

### 3.2 `TicketForm` (Client, `useActionState`)

- **`Başlık`:** `Field`, `autoFocus` on create, no `maxLength`. The server owns the 3–120 rule, so the AC 10 over-length message is testable by typing. A live `112/120` hint appears from 100 characters (`aria-live="polite"` only once it crosses 120).
- **`Açıklama`:** `Textarea`, `rows={5}`, `field-sizing-content` with a `max-h-[50dvh]`, hint `Bağlantıları düz metin olarak yapıştırabilirsin.`
- **`Sorumlu`:** a native `<select>` styled like `entry-form.tsx`:
  - `Atanmadı` (value `""`) first, then `assigneeOptions()` (active conductor and board, by name)
  - on edit, if the current assignee is no longer eligible, one extra `<option>` `Ad Soyad (kurulda değil)` at the top, selected (AC 11)
- **`Aciliyet`:** `ChoiceGroup` with 4 radio chips (`Düşük`, `Orta`, `Yüksek`, `Acil`), default `Orta`. Radio chips beat a select on the phone, and the house pattern already says so.
- **`Son tarih`:** `<input type="date">`, `h-11`. On edit, when it's set, there's a small `Tarihi kaldır` button (`min-h-11`), because iOS's clear control is easy to miss.
- **`Durum`:** create only, `ChoiceGroup` with 4 chips, default `Yapılacak`. On edit, the status changes only through `Durum` on the detail page or `Taşı`, so every status change goes through one action and one system entry.
- Hidden `revision` on edit (§8.1).
- Errors are inline per field (`fieldErrors`), and values are kept with `submitWithoutReset`. `useFocusError` focuses the first invalid field. The D11 stale message is a form-level `FormMessage` with `role="alert"`.
- Buttons: `Kaydet` (primary, `h-11`, disabled plus `Kaydediliyor…` while pending) and `Vazgeç` (a link back).
- Success redirects on the server with a flash (`#12 açıldı.` / `Kaydedildi.`), using the existing `readFlash` / `FlashToast`.

### 3.3 Detail page (Server)

- **Layout:** one column below `lg`. From `lg` it's `grid-cols-[1fr_18rem] gap-8`, with the main column (description, thread, comment form) and an aside (meta and actions).
- **Top:** `‹ Panoya dön` (`BackLink` style, `min-h-11`) to `/yonetim?sutun=<slug of status>`, then `#12` (`text-muted-foreground`) and `h1` (title, `[overflow-wrap:anywhere]`).
- **Meta** is a `<dl>`:
  - `Durum`: the `StatusSelect` (native `<select>`, `h-11`, `aria-label` comes from the `dt` through `aria-labelledby`). Changing it calls `moveTicket` with `from` = the rendered status. It toasts the same `#12 → Devam ediyor` and refreshes, so the new system entry appears without a full reload (AC 16). On error it toasts, refreshes, and the select snaps back to the server value; it's keyed on `status` so it re-mounts.
  - `Aciliyet`: chip
  - `Sorumlu`
  - `Son tarih`: `15 Kasım 2026`, `Gecikti · 15 Kasım 2026`, or `Son tarih yok`
  - `Açan: Ad · 21 Eki 2026`
  - `Son değişiklik: Ad · 21 Eki 2026 14:05`, only when edited
- **Actions:** `Düzenle` (outline link `h-11`), and `Sil` (destructive outline) only when `canDelete` (opener or conductor, computed on the server, AC 14).
- **Description:** `whitespace-pre-wrap [overflow-wrap:anywhere]`, rendered as a text node, never `dangerouslySetInnerHTML` (AC 21). React escapes it. No linkify.

### 3.4 Thread (`thread.tsx`, Server)

```
<section aria-labelledby="gecmis"> <h2 id="gecmis">Geçmiş</h2>
<ol>
  <li data-kind="system" class="flex gap-2 text-sm text-muted-foreground">
     <icon aria-hidden/> <p>Demo Şef durumu Yapılacak → Takıldı olarak değiştirdi. <time dateTime>21 Eki 14:05</time></p>
  </li>
  <li data-kind="comment" data-id>
     <UserAvatar/> <p class="font-medium">Demo YK</p> <time/> <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">…</p>
     {canDelete && <CommentDelete id/>}
  </li>
```
- System entries are a single muted line, with no avatar and no controls (AC 17).
- Comments are a little card (`rounded-xl bg-muted/40 p-3`).
- The `→` arrow is a real character, so it's read as "sağ ok". I add an sr-only `"den"` / `"e"` only if @ux asks. The sentence reads fine.
- The `canDelete` flag on a comment (author = me and age < 15 min) is computed on the server at render. A page left open past 15 minutes still shows `Sil`, and the server answers `Yorum 15 dakika geçtikten sonra silinemez.` That's acceptable, and simpler than a client timer that would also need care with hydration.
- Oldest first. With 10+ comments (AC 42) the page is just long. No virtualisation at our scale.

### 3.5 Comment form (Client)

- `<form action>` with a visible `<Label htmlFor="yorum">Yorum</Label>` (AC 43), a `Textarea` with placeholder `Yorum yaz…`, `rows={3}`, and `enterKeyHint="send"`.
- `Gönder` uses `useFormStatus().pending` → `disabled`. Combined with the server's single insert, a double tap makes one row (AC 19).
- On success: the form resets (React 19 resets an uncontrolled form after a successful action), focus stays in the textarea, `router.refresh()` shows the new entry, and an sr-only `role="status"` says `Yorum eklendi.` I also scroll the new `li` into view (`block: "nearest"`).
- On error: `submitWithoutReset` keeps the text, and the inline `role="alert"` shows `Yorum boş olamaz.` / `Yorum en fazla 2000 karakter olabilir.`
- `Cmd/Ctrl+Enter` submits, since desktop users expect it. Enter alone inserts a newline, because line breaks are kept (AC 19).

### 3.6 "New for me" clearing (`ticket-seen.tsx`)

- `useEffect(() => { void markTicketSeen(number).then((r) => r.changed && router.refresh()) }, [number])`. It runs only when the page is really mounted, never on a `<Link>` prefetch, like `FeedbackSeen`.
- It refreshes only when the ticket was actually new for me (`changed`), so the sidebar badge, rendered by the layout in parallel with the page, drops right away. It costs one extra render, and only on the first open.

### 3.7 Delete (`ticket-delete.tsx`, `comment-delete.tsx`)

- `ConfirmDialog` with the exact copy of AC 14 / AC 20. Cancel comes first, and the dialog can't close while pending.
- Ticket: the server redirects to `/yonetim` with the flash `#12 silindi.`
- Comment: `useRunAction`, then focus moves to the comment textarea (the deleted `li`'s button is gone).

### 3.8 Archive (`/yonetim/arsiv`)

- `h1` `Arşiv`, `‹ Panoya dön`, then the same `TicketCard` in a `ul` (`grid gap-3 md:grid-cols-2`). `Taşı` is kept, so a card can be moved out of the archive (AC 23).
- Paging: `?sayfa=<n>` (offset, 50). `Daha eski ›` / `‹ Daha yeni` are links, `min-h-11`, in a `nav aria-label="Sayfalar"`. A `sayfa` that's invalid or out of range is treated as 1.
- Empty state: `Arşivde iş yok.`

---

## 4. Navigation and home

### 4.1 Sidebar entry and badge

- `nav-items.ts`: `{ href: "/yonetim", label: "Yönetim Kurulu", icon: SquareKanban, managersOnly: true, sidebarOnly: true, badge: "board" }`, inserted between `Finans` and `Üyeler`. The Ödevler entry becomes `badge: "homework"`.
- `isActive` already uses `startsWith`, so `/yonetim/12` and `/yonetim/arsiv` get `aria-current="page"` (AC 2). `/yoklama` doesn't match `/yonetim`.
- `app-nav.tsx`: `Badge` takes a `kind`.
  - `badgeLabel("homework", n)` → `, n bekleyen ödev` (unchanged)
  - `badgeLabel("board", n)` → `, n yeni iş`
  - Rendering stays `9+` above 9.
- The bottom bar is unchanged: `sidebarOnly` keeps it out, so the manager bar stays at 5 tabs (AC 2).
- **Attribute:** see @po 2. I propose `data-board-badge={n}` for the board badge and leave `data-nav-badge` to homework. If the PO keeps `data-nav-badge`, the seed must guarantee that sef@ has 0 new tickets, and Phase 4's `badge()` helper keeps working only because of that seed.

### 4.2 Home card (`home-card.tsx`, async Server)

- It's `data-testid="home-board"` and reuses the `CardHeader` look of `finance/home-cards.tsx`: `h2` `Yönetim Kurulu` and the link `Panoya git ›` to `/yonetim`.
- **Body,** one link block (`min-h-11`) to `/yonetim?kim=ben`:
  - `Sana atanan <n> açık iş` plus `· <k> yeni` plus `· <u> acil`, with each number in `data-*` (`data-open`, `data-new`, `data-urgent`)
  - the `acil` part in `text-absent-ink` with its word (not colour-only)
- With n = 0: the text `Sana atanmış açık iş yok.` and only the header's `Panoya git` link (AC 3).
- No ticket titles are rendered at all, so korist@'s home HTML can't contain one, even by accident (AC 3).
- It reads `myBoardSummary(user.id)`, the **same `cache()`-wrapped function** the layout's badge uses, so on `/` it's one query, not two (§6).

### 4.3 FinanceNav

`Bütçe` goes between `Rapor` and `Ayarlar`. That's 8 chips in a horizontal scroller on the phone, and `ActiveChipIntoView` already brings the active one into view.

---

## 5. `/finans/butce`

### 5.1 List (Server)

- The header is `h1` `Bütçe` and `Yeni bütçe` (primary `h-11`), then `FinanceNav active="butce"`.
- Each budget is a link card (`rounded-2xl border bg-card p-4`, `data-testid="budget-row"`, `data-status`):
  - the name (`text-lg font-medium`) and `Şu anki` (a `bg-primary/10 text-primary` pill) when it contains today
  - the range `Eylül 2026 – Ağustos 2027`
  - the status chip: `Taslak` (`bg-muted`) or `Onaylandı` (`bg-present/14 text-present-ink` plus `CircleCheck`)
  - for current and past budgets, `Gelir %x · Gider %y` with sr-only `plana göre`
- Empty state: the exact AC 25 copy, with `Yeni bütçe` repeated as a link.

### 5.2 Create (`budget-create-form.tsx`, Client)

- **`Başlangıç ayı`** is a `fieldset` with legend `Başlangıç ayı` and two native selects side by side (`grid grid-cols-2 gap-3`):
  - `Ay` (Ocak…Aralık)
  - `Yıl` (current − 3 … current + 3)

  A hidden `start` field holds `YYYY-MM`. This works in Safari desktop, unlike `type="month"`. The default comes from the server per AC 26.
- **`Bitiş`** is a read-only `<output>`, `Bitiş: Ağustos 2027`, updated live. It's an `<output>`, so it's announced politely when it changes.
- **`Ad`:** `Field`. It **follows the start month** (`2026–27 sezonu`, or `2027` for a January start) until the user types in it, and after that it's left alone. The rule for other months needs PO/UX copy (see @po 5).
- **`Not`:** `Textarea`, with a counter from 450 characters.
- `Oluştur` redirects to `/finans/butce/<id>/duzenle`. Errors are inline (overlap and duplicate on `Ad` / `Başlangıç ayı`, as the backend returns them).

### 5.3 Plan editor (`plan-editor.tsx`, Client) for 17 lines at 375 px

The existing `AmountInput` is far too big for 17 rows (`h-14`, `text-2xl`, an echo line). I add a compact `PlanAmountRow`:

```
<div class="grid grid-cols-[1fr_9.5rem] items-center gap-x-3 gap-y-1 py-2">
  <Label htmlFor="plan-travel" class="text-sm leading-snug">Ulaşım ve konaklama</Label>
  <div class="relative"> <span aria-hidden class="absolute left-3 …">₺</span>
    <Input id="plan-travel" name="travel" inputMode="decimal" enterKeyHint="next"
           class="h-11 rounded-xl pl-7 text-right text-base tabular-nums" placeholder="0" /> </div>
  <p id="plan-travel-error" class="col-span-2 text-sm text-destructive">…</p>
</div>
```
- **Width at 375 px:** the content is 343 px, the input column 152 px, and the label column about 179 px. `Şef / korrepetitör ücreti` wraps to 2 lines, which is fine. The input fits `₺10.000.000,00`, the maximum `parseAmount` accepts, at 16 px.
  - 16 px also stops iOS from zooming into the field.
  - There's no horizontal scroll.
- **Groups:** two `<fieldset>`s with `<legend>` `Gelir` and `Gider` (AC 27), separated by `divide-y`, in `categories.ts` order. Each fieldset ends with its live total, `Planlanan gelir ₺…` / `Planlanan gider ₺…`.
- **Parsing:**
  - on blur, normalise to `12.500,00` (the `amountInput` helper), which serves as the echo
  - on an invalid value, inline `parseAmount` message with `aria-invalid` and `aria-describedby`
  - blank and `0` are valid and mean 0 (needs @backend 3)
- **Sticky footer:** `sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4`, so it sits above the fixed bottom bar.
  - It's a `rounded-2xl border bg-background/95 backdrop-blur p-3` bar with `Planlanan net` (`NetLabel`-like signed text, `<output>`) and `Kaydet` (`h-11`).
  - That keeps Save reachable while scrolling 17 rows (AC 27). The page's `pb-28` already leaves room.
  - The totals are `<output>` elements without `aria-live`, because announcing on every keystroke is noise. They're read on demand.
- **`Geçen yılın gerçekleşenleriyle doldur`:** an outline button at the top.
  - It calls `prefillPlan(budgetId)`, which returns kuruş per category, already rounded up to whole lira.
  - If any input is non-empty, it first asks `ConfirmDialog` `Girilen tutarların yerine geçen yılın gerçekleşenleri yazılsın mı?` (@ux copy).
  - It fills the state and saves nothing. An empty result toasts `Önceki 12 ayda kayıt yok.` (AC 28).
- **Unsaved changes:** a `beforeunload` guard while dirty. Losing 17 typed numbers to a mis-tap on the tab bar would hurt.
  - It's not a router interception: Next has no blocking API. The tab-bar links stay a risk, which is acceptable.
- **Server errors:** `fieldErrors` keyed by category. `useFocusError` focuses the first invalid row, and nothing is saved (AC 27).
- **Draft mode:** `Kaydet` → `savePlan` → redirect to the report with the flash `Plan kaydedildi.`

### 5.4 Revise (approved budgets)

- The page `h1` is `Planı revize et`. The footer button is `Revizyonu kaydet…`.
- Clicking it computes the diff on the client. If nothing changed, it shows the inline footer message `Hiçbir tutar değişmedi.` (the server checks again). Otherwise it opens the **`ReviseDialog`**, a `ConfirmDialog` with children:
  - the title `Plan revizyonu`, and the description `Değişiklik geçmişine şu satırlar yazılacak:`
  - a list of the changed lines in the history format, `Seyahat: ₺20.000,00 → ₺26.000,00`
  - a required `Textarea` labelled `Değişiklik gerekçesi`, 5–200 characters, with its inline error
  - the buttons `Vazgeç` and `Kaydet`
- The dialog shows exactly what will be recorded before it's permanent. It also keeps the reason next to the diff, instead of in a field the user scrolled past. AC 31 is satisfied: the editor is titled `Planı revize et`, and the reason is required.
- On the stale error, the dialog stays open and shows `Bu plan az önce değişti. Sayfayı yenile.` with `role="alert"`.

### 5.5 Report `/finans/butce/<id>` (Server)

**Header:**
- `‹ Bütçe`, the `h1` name, the range, the status chip, and `Onaylayan: Ad · 21 Eki 2026` when approved.
- The state line, one of:
  - `Dönem içi durum`, then `Dönemin %42'si geçti (21 Ekim 2026 itibarıyla)` (copy: @po 6)
  - `Dönem sonu raporu`
  - `Dönem henüz başlamadı.`
- Actions (`flex flex-wrap gap-2`, all `h-11`):
  - `Planı düzenle` / `Planı revize et`
  - `Onayla` (draft only)
  - `CSV indir` (a plain `<a href=…/csv download>`, `Download` icon)
  - `Sil` (draft only, destructive outline)

**Summary (`budget-summary.tsx`)** is three blocks, each a `<dl>`:
- `Toplam gelir`
- `Toplam gider`
- `Net (gelir − gider)`

Each shows `Plan`, `Gerçekleşen`, `%` and the words. Net shows both signed nets and `Plandan iyi` / `Plandan kötü` (with `TrendingUp` / `TrendingDown` icons, and the word is always there). The cash-basis note sits below in `text-sm text-muted-foreground`, once (AC 35).

**Lines: one DOM for every width.** I don't use `rapor`'s two copies (`ol lg:hidden` plus `table hidden lg:block`), because duplicated `data-testid` / `data-*` would double-count in e2e and in a screen reader's "list of N items".

```
<section aria-labelledby="gelir"> <h2 id="gelir">Gelir</h2>
<div aria-hidden class="hidden lg:grid lg:grid-cols-[minmax(10rem,1.4fr)_repeat(4,minmax(0,1fr))_9rem] … text-xs text-muted-foreground">
  <span>Kalem</span><span>Plan</span><span>Gerçekleşen</span><span>Fark</span><span>%</span><span>Durum</span></div>
<ul>
  <li data-testid="budget-line" data-kind="income" data-category="donation" data-signal="met"
      data-plan-kurus data-actual-kurus data-pct
      class="rounded-2xl border bg-card p-4 lg:grid lg:grid-cols-[…same…] lg:items-center lg:rounded-none lg:border-x-0 lg:border-t-0 lg:p-3">
    <h3 class="font-medium">Bağış</h3>
    <dl class="grid grid-cols-2 gap-y-1 text-sm lg:contents">
      <div class="lg:contents"><dt class="text-muted-foreground lg:sr-only">Plan</dt><dd>₺1.000,00</dd></div>
      <div class="lg:contents"><dt class="… lg:sr-only">Gerçekleşen</dt><dd>₺1.200,00</dd></div>
      <div class="lg:contents"><dt class="… lg:sr-only">Fark</dt><dd>₺200,00 fazla</dd></div>
      <div class="lg:contents"><dt class="… lg:sr-only">Gerçekleşme</dt><dd>%120</dd></div>
    </dl>
    <SignalChip/>
    <BudgetBar class="col-span-full mt-3"/>
  </li>
```
- A screen reader always gets "Plan, ₺1.000,00", because the `dt` stays in the accessibility tree (`sr-only`, not `hidden`). That's AC 43's "each number with its label". The visual column header row at `lg` is `aria-hidden`.
- Every number cell has its label, so there's no need for a real `<table>`. AC 33 says "may".
- At 375 px each line is a card: the label and chip on one row, then a 2×2 `dl`, then the bar. There's no horizontal scroll.

**Signal chip:** an icon plus the label, using the tokens of AC 34:

| Signal | Classes | Icon |
|---|---|---|
| `met`, `within` | `bg-present/14 text-present-ink` | `CircleCheck` |
| `near`, `short`, expense `unplanned` | `bg-late/18 text-late-ink` | `TriangleAlert` |
| `over` | `bg-absent/12 text-absent-ink` | `CircleAlert` |
| `pending`, income `unplanned` | `bg-muted text-muted-foreground` | `Hourglass` / `CirclePlus` |

The label is always visible, so colour is never the only cue (AC 42/43).

**Bar (`budget-bar.tsx`), decorative (`aria-hidden`), because the numbers are text:**
- The track is `relative h-2 rounded-full bg-muted`. The fill width is `min(pct,100)%`, with a colour by signal:
  - `bg-present` for met/within
  - `bg-late` for near/short/unplanned expense
  - `bg-absent` for over
  - `bg-foreground/40` for pending
- **Over-mark** (pct > 100): the fill is full, plus a 3 px `bg-foreground` cap at the right end (`data-over="true"`) and a `ChevronRight` glyph after the bar. Shape, not hue, says "past the end", which matters for colour-blind readers and in dark mode.
- **Period marker:** `absolute -inset-y-1 w-0.5 bg-foreground/70` at `left: p%`, with `data-elapsed={p}`, only for a running period. Its meaning is stated once in text in the header (`Dönemin %42'si geçti`), and a small legend under the first bar says `| = dönemin geçen kısmı` (@ux to polish).
- Lines with plan 0 (`unplanned`) get **no bar**, because there's no denominator (pct `—`). @po: please confirm, since AC 33 says "a bar filled to min(pct,100)%" and pct is undefined there.
- Inline `style={{ width }}` is fine under our CSP: style attributes aren't blocked by `style-src` with React's DOM property API. Phase 5's `rapor` already does it.

**History (`budget-history.tsx`):** `section` `Değişiklik geçmişi`, then an `ol` newest first. Each `li` holds `<p>Ad · 21 Eki 2026 14:05 · “gerekçe”</p>` and a `ul` of changed lines. The reason is a text node (it's user text, so escaped). The section is omitted for drafts with no history.

**Approve and delete (`budget-actions.tsx`):** `ConfirmDialog` with the AC 29 / AC 30 copy. Approve uses `useRunAction` plus refresh, with the toast `Bütçe onaylandı.` (@po: the copy isn't in the spec). Delete redirects with the flash `Bütçe silindi.`

---

## 6. Server/client boundaries and performance

**Client components** (all small, no data fetching): `BoardControls`, `MoveMenu`, `StatusSelect`, `TicketForm`, `CommentForm`, `CommentDelete`, `TicketDelete`, `TicketSeen`, `BudgetCreateForm`, `PlanEditor` (plus `PlanAmountRow` and `ReviseDialog`), `BudgetActions`. Everything else, including the cards, columns, thread, report lines, bars, chips, summary and history, is a Server Component.
- The board's cards cross into `BoardControls` as `children`, so no ticket data is serialised as client props twice.
- `MoveMenu` gets `{ number, status }` only.
- `PlanEditor` gets `{ budgetId, status, revision, lines: Record<Category, number>, labels }`. That's 17 numbers.

**Authorization:**
- Every page calls `requireManager()` first, and every action and the CSV route call the null-returning variant and answer `Bu işlem için yetkin yok.` / 403 (AC 1, 24).
- `canDelete` (ticket, comment), `canEdit` and the approval state are computed on the server and only *shape* the UI. The actions re-check them.

**Badge cost on every manager page view:**
- The layout today awaits `openHomeworkCount` and then `readFlash` **sequentially**. I change it to `Promise.all([openHomeworkCount(id), boardBadgeCount(user), readFlash()])`, so the new query adds **no** latency, only one parallel round trip. On Turso that round trip is the real cost (about 20–60 ms), not the SQL.
- `boardBadgeCount` returns 0 for members **without touching the DB**.
- `myBoardSummary(userId)` is `cache()`-wrapped. The layout's badge and the home card share one execution per request.
- The query is one aggregate over the open tickets assigned to me, each with an indexed `EXISTS` on the activity table (§8.1). At 300 tickets and 2000 comments that's well under 1 ms in SQLite.
- @dba: index `(assignee_id, status)` on tickets, `(ticket_id, created_at)` on the activity table, and PK `(user_id, ticket_id)` on the seen table.

**The board page itself:**
- One query for the non-archived tickets (`status <> 'done' OR done_at >= now−30d`, index `(status, done_at)`), already filtered and ordered by AC 7.
- One grouped comment count over `ticket_id IN (…)`, or a denormalised `comment_count` if @dba prefers.
- The per-card `new` flag comes from the same `EXISTS` for tickets assigned to me.
- No N+1.

**The detail page:** the ticket plus its people (one join), and the thread (one indexed range). `markTicketSeen` is a single upsert.

**The budget report:**
- One grouped `sum(amount_kurus) … where occurred_on >= ? and occurred_on < ? and kind in ('income','expense') and voided_at is null group by category`, which must use the `occurred_on` index (AC 44).
- The plan lines, plus the revisions with their changed lines, are two small queries.

**The list:** one grouped query per budget in `Promise.all` (a handful of budgets), or one `CASE`-bucketed query. Either is fine at our scale.

**JS weight:** no new libraries, and the dropdown and dialog are already in the bundle. The board route's client JS is `BoardControls` plus `MoveMenu`.

---

## 7. Loading, error and empty states

- **`yonetim/loading.tsx`:** the title bar, a 4-cell segmented skeleton (`xl:hidden`) and 3 card skeletons per column (`xl:grid-cols-4`), with `aria-busy` and `aria-label="Yükleniyor"` like the existing ones.
- **`finans/butce/loading.tsx`:** the title, the chip row, a summary skeleton and 4 line cards. It overrides `finans/loading.tsx` for this subtree.
- **Not found:** `notFound()` for an unknown ticket or budget id goes to `src/app/not-found.tsx`.
- **Errors:** thrown errors go to the existing `(portal)/error.tsx`. Action failures never throw to the UI: `useRunAction` turns a throw into `Bir şeyler ters gitti, tekrar dene.`
- **Pending:**
  - every submit button is `disabled` plus a `…yor` label (`Kaydediliyor…`, `Gönderiliyor…`)
  - `MoveMenu`'s trigger and `StatusSelect` are disabled while pending
  - `ConfirmDialog` blocks closing while pending

---

## 8. Data contracts I need (@backend; shapes, not names, are what matters)

### 8.1 Board
```ts
type TicketCardData = {
  number: number; title: string; status: TicketStatus; urgency: Urgency;
  dueOn: string | null;            // "YYYY-MM-DD"
  overdue: boolean;                // server-computed, Istanbul today
  assignee: { name: string; active: boolean } | null;   // active=false → "(kurulda değil)"
  commentCount: number; isNew: boolean;                 // isNew only true for my tickets
};
type Board = {
  columns: Record<TicketStatus, TicketCardData[]>;      // filtered, ordered per AC 7, archive excluded
  counts: Record<TicketStatus, number>;                 // with filters applied
  filters: { kim: "herkes" | "ben"; aciliyet: Urgency | null };  // normalised
};
getBoard(viewer, { kim, aciliyet }): Promise<Board>
getArchive(page: number): Promise<{ rows: TicketCardData[]; hasOlder: boolean; hasNewer: boolean }>
getTicket(number, viewer): Promise<null | TicketCardData & {
  description: string | null; createdBy: string; createdAt: Date;
  lastEdit: { name: string; at: Date } | null;
  revision: number;                // or updatedAt ms; opaque to me, round-tripped in a hidden field
  canDelete: boolean;
  thread: Array<
    | { kind: "system"; id: string; at: Date; text: string }      // full D5 sentence built on the server
    | { kind: "comment"; id: string; at: Date; author: string; body: string; canDelete: boolean }>;
}>
assigneeOptions(): Promise<{ id: string; name: string }[]>
myBoardSummary(userId): Promise<{ open: number; fresh: number; urgent: number }>   // cache()-wrapped
boardBadgeCount(user): Promise<number>                // 0 for members without a query

// actions → FormState { error?; success?; fieldErrors? } (the house type)
createTicket(prev, fd) → redirect + flash
updateTicket(prev, fd /* incl. revision */) → redirect + flash | { error: D11 } | fieldErrors
moveTicket({ number, from, to }) → { success: "#12 → Devam ediyor" } | { error }
deleteTicket(number) → redirect + flash | { error }
addComment(prev, fd /* number, body */) → { success: "" } | fieldErrors.body
deleteComment(id) → FormState
markTicketSeen(number) → { changed: boolean }
```
- The system-entry sentence is built on the server from stored old/new codes, at read time. That way a renamed user shows the current name, and the labels module is the single source. @backend/@dba: if you'd rather store the rendered sentence, that's fine too. Just tell me.
- "New" rule I'm assuming: `exists (activity by someone else, created_at > my seen_at or never seen)` or `(updated_by ≠ me and updated_at > seen_at)`, for tickets assigned to me and not `done`. Title and description edits have no activity row, so they're the second clause.

### 8.2 Budget
```ts
type BudgetLine = { kind: "income" | "expense"; category: Category; planKurus: number; actualKurus: number;
  diffKurus: number /* actual − plan */; pct: number | null; signal: Signal; words: string /* "₺200,00 fazla" */ };
type BudgetReport = {
  id; name; startMonth: "YYYY-MM"; endMonth; rangeLabel: "Eylül 2026 – Ağustos 2027";
  status: "draft" | "approved"; approvedBy: { name; at: Date } | null;
  phase: "future" | "running" | "ended"; elapsedPct: number | null; asOf: string /* Istanbul today */;
  lines: BudgetLine[];             // plan 0 & actual 0 already removed; income first, categories.ts order
  totals: { income: Totals; expense: Totals; net: { planKurus; actualKurus; better: boolean } };
  history: Array<{ by: string; at: Date; reason: string; changes: Array<{ category: Category; fromKurus; toKurus }> }>;
  revision: number;
};
budgetReport(id, { asOfMonthEnd?: "YYYY-MM" }) // the same pure builder feeds page, CSV route and email (AC 37/38)
listBudgets(): Promise<Array<{ id; name; rangeLabel; status; current: boolean; incomePct: number | null; expensePct: number | null }>>
planForEditor(id): Promise<{ id; name; status; revision; lines: Record<Category, number> }>
createBudget(prev, fd) → redirect to editor | fieldErrors { name, start, note }
savePlan(prev, fd /* revision, 17 amounts, reason? */) → redirect + flash | fieldErrors by category | { error }
prefillPlan(id) → { lines: Partial<Record<Category, number>> /* kuruş, ceil to lira */ } | { empty: true }
approveBudget(id), deleteBudget(id) → FormState / redirect
```
- **`words`, `signal` and `pct`** come from one isomorphic function (`src/lib/budget/signals.ts`), so the page, the CSV and the email can't disagree. I render, and never compute.
- **@backend 3:** please add `parsePlanAmount(raw)` to `money.ts`: blank → 0, `0` → 0, otherwise `parseAmount`. That way the client's blur check and the server's validation are the same function.

---

## 9. E2E plan

### 9.1 Files (runner order is alphabetical, so all of them run after Phase 7)

| File | Covers |
|---|---|
| `e2e/board.mjs` | helper module, not a phase file: `insertTicket`, `insertComment`, `setSeen`, `ticketRow(n)`, `threadOf(n)`, `boardCounts(page)`, `cards(page, status)` |
| `e2e/budget.mjs` | helper module: `insertBudget({ name, start, status, lines, approvedBy })`, `insertEntry({ kind, category, kurus, day, voided, account })`, `lineOf(page, category)`, `expected` constants for the fixed fixtures |
| `e2e/phase8-a-board.mjs` | AC 1–23, plus the board parts of AC 41–44 |
| `e2e/phase8-b-budget.mjs` | AC 24–37, plus the budget parts of AC 41–44 |
| `e2e/phase8-c-email.mjs` | AC 38–39 (and AC 37's formula-safety in the email) |
| `e2e/phase8-d-migration.mjs` | AC 40 (a Phase 7 snapshot in a tmp dir, migrate, `db:check`, grep the SQL), plus the EXPLAIN QUERY PLAN part of AC 44 |
| `e2e/prod.mjs` | edit: `/yonetim`, `/yonetim/arsiv`, `/finans/butce` refuse korist@ in production mode (AC 45) |
| `e2e/lib.mjs` `cleanup()` | edit: `seedBoard(db, now)` **before** the e2e-user delete (ticket FKs are `restrict`). Budgets are wiped and reseeded inside `seedFinance`, because the budget is finance demo data. |
| `scripts/board-fixture.mjs` | new, shared by `scripts/seed.ts` and `e2e/lib.mjs`, guarded by `assertFixtureTarget` like the others. Wipes all board tables, then seeds the 6 tickets with times relative to `T`. |

Style is as in Phase 7:
- `check(ok, message)` with the AC number first
- arrange through `db.execute`
- `newPage(browser, { phone: true, context: { colorScheme } })`
- `callAction(page, ids.moveTicket, args)` for the korist@ direct calls (`actionIds("src/app/(portal)/yonetim/actions.ts", "1")`)
- row counts before and after
- each file restores what it changed in a `finally`

### 9.2 Board highlights

- **AC 4/5/42:** for `scheme of ["light","dark"]` × viewport 375, 768, 1024 and 1280, check:
  - the nav is visible or not visible
  - the number of visible `section[data-status]`
  - `document.scrollingElement.scrollWidth <= clientWidth`
  - every visible `a,button,select,input,textarea,[role=menuitem]` has `getBoundingClientRect().height >= 44` (inline text links inside `p` are excluded)
- **AC 15 keyboard:** at 1280, Tab to `#N taşı`, press Enter, ArrowDown ×2, then Enter. Then assert the toast, `data-count` and the DB row.
- **AC 18:** two contexts (sef@, yk@) on `/yonetim`. sef moves; yk moves from the stale page. Assert the toast text, the DB `status = in_progress`, and exactly one `status` activity row.
- **AC 21:** save `<img src=x onerror=alert(1)>` as the title and a comment. `page.on("dialog")` fails the check, and `getByText` finds the literal.
- **AC 22:**
  - the seeded ticket gives yk@ `[data-board-badge="1"]` (or `data-nav-badge`, see @po 2) plus `data-new`
  - open the detail page, wait for the `markTicketSeen` response, and reload: badge absent
  - sef@ comments: 1 again
  - yk@ comments: stays absent
  - `home-board[data-new]` agrees
- **AC 23:** insert 51 tickets with `done_at` 31–80 days ago. Check that page 1 has 50 and page 2 has the rest, with correct ordering, and that moving one back puts it into `Yapılacak`.
- **AC 44:**
  - `db.batch` inserts 300 tickets (200 archived) and 2000 comments under an `E2E perf` title prefix
  - `const t = Date.now(); await page.goto(...)`; under 1500 ms on the first hit (dev compile excluded by a warm-up visit), under 1000 ms on the second
  - the AC is "loose", so I check the warm second load

### 9.3 Fixtures for the budget math (fixed, known, outside the seed and Phase 7)

The seeded ledger only lives in M-2…M, and Phase 7 uses January 2024 and January 2025. The fixed fixtures use years nobody else touches, with **literal expected kuruş** written in the test. A test that recomputed with SQL would only test SQL against SQL.

**F-past: `E2E 2019–20`**, start `2019-09`, approved by yk@. Its range is `2019-09-01 … 2020-08-31` (it has ended, crosses a leap year, and starts outside January).
- **Entries included:**
  - `donation` 1.000,00 on `2019-09-01` (the first day)
  - `donation` 200,00 on `2020-08-31` (the last day)
  - `grant` 400,00 on `2020-02-29`
  - `travel` 1.300,00
  - `festival_fee` 950,00
  - `scores_royalties` 800,00
  - `organisation` 1.000,00
  - `other_expense` 50,00
  - `other_income` 300,00
- **Entries excluded:**
  - `donation` 9.999,00 on `2019-08-31`
  - `donation` 9.999,00 on `2020-09-01`
  - a voided `travel` 5.000,00 in range
  - a `transfer` 7.000,00 in range
  - an `opening` 8.000,00 in range
- **Plan:**
  - donation 1.000 → actual 1.200: `met`, `₺200,00 fazla`, `%120`
  - grant 1.000 → actual 400, period ended: `short`, `₺600,00 eksik`, `%40`
  - other_income 0 → actual 300: `unplanned`, `—`
  - scores_royalties 1.000 → 800: `within`, `₺200,00 kaldı`
  - festival_fee 1.000 → 950: `near`
  - organisation 1.000 → 1.000: `near`, `Planla aynı`
  - travel 1.000 → 1.300: `over`, `₺300,00 aşıldı`
  - other_expense 0 → 50: `unplanned`, `Plansız gider`
  - one category planned 500 with no entries, which is shown (plan > 0)
  - all others 0/0 and hidden
- **Expected totals,** spelled out in the test: income actual 1.900,00 and expense actual 4.100,00. These give AC 32 (boundaries and exclusions), AC 33/34 (every signal except `pending`), AC 35 (the `Dönem sonu raporu` heading and the totals arithmetic), and AC 37 (the CSV).

**F-cal: `E2E 2021`**, start `2021-01`, draft.
- **Entries:** a few income and expense entries spread over 2021, including one with kuruş (`1.234,56` `tickets`), plus one voided entry and one transfer.
- **AC 36:** the `Toplam gelir` / `Toplam gider` actuals equal `[data-testid=year-income]` / `[data-testid=year-expense]` on `/finans/rapor?yil=2021&hesap=toplam`. Those `data-*` attributes already exist (`rapor/page.tsx`).
- **AC 28 (prefill):** create `E2E 2022` (start `2022-01`) through the UI. Its prior window is exactly 2021, so `Geçen yılın gerçekleşenleriyle doldur` must give the F-cal sums rounded up to lira (`1.234,56` → `1.235`), with the voided entry and the transfer ignored. Reload and check the DB has no plan rows.
- **AC 28 empty:** a budget whose prior window has no entries (`E2E 2017`, start `2017-01`) gives the toast.

**Running period:** the **seeded current season** (the only budget that may contain today, because budgets can't overlap).
- The test arranges plan lines and entries **only in categories the finance fixture never uses**:
  - income: `donation`, `grant`, `other_income`
  - expense: `scores_royalties`, `travel`, `festival_fee`, `organisation`, `refund`, `other_expense`
- That isolates them from the seeded M-2…M ledger. The entries are dated between the season start and today.
- That gives `pending` (grant 1.000 → 400 while running). The elapsed text and `data-elapsed` are checked with the same formula in JS from `istanbulDate()` and the season start (@backend: please fix the formula in `backend.md`; my assumption is `round((today − start + 1) / total days × 100)`).
- `cleanup()` reseeds, so nothing leaks.

**Future:** AC 26 creates a January budget for `year(today) + 5` through the UI, so it never collides with an anchored seed. It checks the name `<year>`, the range `Ocak <y> – Aralık <y>`, and `Dönem henüz başlamadı.` on its report.
- @po: AC 26's literal `2028` will overlap the seeded season from September 2027 on, so the test computes the year.

**Formula safety (AC 37):** `insertBudget({ name: "=2+3 sezon", … })`. Check that no CSV cell starts with `=` unescaped (`csvCell` prefixes `'`), and that the email body has the literal name.

### 9.4 Seed anchoring (@backend/@dba, needed for stable e2e)

Anchor the two seeded budgets to `T` like the finance fixture:
- `current = September of (T's year if T's month ≥ 9 else T's year − 1)`, and `previous = current − 12 months`
- names `YYYY–YY sezonu`, both approved
- plan lines for 3 or more income and 5 or more expense categories

Because the ledger fixture only spans M-2…M, the "past season has entries" premise is true only in September–November. If PO wants the past season always to have actuals, the budget fixture can add a few entries dated in `previous`'s range, in categories the e2e "running" test doesn't use (`dues`, `tickets`, `venue`, `costume`).

That keeps January 2024 and January 2025 budget-free forever, so Phase 7's five-attachment checks stay true.

### 9.5 Monthly email (AC 38/39), reusing Phase 7's `e2e/mail.mjs`

- `resetBackup()` and `setRecipients(["p8@e2e.test"])`.
- **Covered month:** `cron("?bugun=2020-03-01")` sends M = `2020-02`, inside F-past.
  - The email has `mail.attachments.length === 6` and includes `arkhe-butce-2020-02.csv`.
  - `csvRows(att)` has header `Tür;Kategori;Plan;Gerçekleşen;Fark;Gerçekleşme;Durum`.
  - Actuals run **up to 2020-02-29 only**: donation 1.000,00 (the 2020-08-31 entry excluded), grant 400,00 (the leap day included), and so on, as literal values.
  - The body line has the exact AC 39 sentence (copy: @po 6).
  - This replaces "a page render with today pinned" (@po 4): a literal oracle is stronger, and needs no clock override.
- **Header and format parity with the route:** fetch `/finans/butce/<F-past id>/csv` as yk@. Compare the header row, the BOM, CRLF and the column count. For F-past (ended) the route's full-period rows must equal the literal full-period expectation.
- **Uncovered month:** `cron("?bugun=2018-02-01")` gives 5 attachments, no `arkhe-butce-*`, and no line starting `Bütçe (`.
- **18 MB guard:** a unit-free check is enough. The `backup_runs.size_bytes` of the covered send is ≥ the sum of all 6 attachment sizes, since Phase 7 stores the measured size. If Phase 7 stores only the dump size, @backend tell me and I'll drop this check.
- `removeEmails(created)` in `finally`.

### 9.6 Keeping Phases 1–7 green

1. **`phase5-finance.mjs:175`:** the expected chip list gains `Bütçe`. This is a one-word edit to a Phase 5 test (@po 1).
2. **`phase4-homework.mjs:17`:** unaffected if the board badge uses its own attribute. If it doesn't, the board fixture must leave sef@ with 0 new tickets, and yk@'s Ödevler badge must stay the **first** `[data-nav-badge]`. Sidebar order guarantees that, since Ödevler comes before Yönetim Kurulu.
3. **Phase 7 attachment counts:** guaranteed by §9.4. Phase 7's manual send on `/yedek` (M = last month, which the seeded season covers) now carries 6 attachments. No Phase 7 test counts those (I grepped: only `phase7-a-cron.mjs:369,462`, both on uncovered months).
4. **Phase 7 body checks** use `includes` per line, so the extra budget line doesn't break them.
5. **`phase6-z-guards.mjs`:** `board-fixture.mjs` must refuse production through `assertFixtureTarget`. I'll add its refusal check in `phase8-d` rather than edit Phase 6.
6. **Dump/restore (Phase 7 C):** `dump.ts` enumerates `sqlite_master`, so the new tables are included automatically. `phase8-d` asserts that a restored snapshot has the board and budget row counts.
7. Run the **full** `npm run e2e` (not filtered) for the phase gate, since the fixture order matters.

---

## 10. Replies

- **@po 1 (AC 40 "unchanged"):** I disagree with "unchanged" as literal. `phase5-finance.mjs:175` hard-codes the FinanceNav chips, and D20 adds one. Please reword it to "pass, with the one-word update to the Phase 5 chip list".
- **@po 2 (AC 22 `data-nav-badge`):** I disagree. Phase 4 reads the *first* `[data-nav-badge]` and asserts sef@ has none. Please let the board badge be `data-board-badge` (same visuals, same `9+`, sr text `, <n> yeni iş`), so the two badges can't be confused by any test or style.
- **@po 3 (D4 breakpoint):** I'd go further than you: four columns from **`xl` (1280)**, not `lg`. The real content widths are 99 px per column at 768, 163 px at 1024 and 227 px at 1280 (§2.3). AC 5's e2e stays as written; I'd add 1024 → tabs.
- **@po 4 (AC 38 "a page render with today pinned"):** no page has a clock override, and I don't want one in production code. I propose literal expected values for the fixed `E2E 2019–20` fixture (§9.5), which is a stronger oracle. The route CSV is compared for format only.
- **@po 5 (D12 default names):** D12 names only September (`2026–27 sezonu`) and January (`2027`) starts. What's the default for a March start? I'll use `2026–27` for any non-January start (the season-style year pair) and `<year>` for January, unless you or @ux say otherwise.
- **@po 6 (Turkish suffixes after numbers):**
  - `gelir hedefin %<x>'i, gider planın %<y>'si` and `Dönemin %<p>'si geçti` hard-code the suffix, but it depends on how the number is read: `%40'ı`, `%50'si`, `%9'u`, `%100'ü`, `%6'sı`, `%120'si`.
  - Either rephrase to avoid the suffix, for example `Bütçe (<ad>, Onaylandı): gelir hedefe göre %<x>, gider plana göre %<y>.` and `Dönemin geçen kısmı: %<p> (<bugün> itibarıyla)`, or let @backend add a small `withPossessive(n)` helper in `src/lib/format.ts` (last non-zero digit / tens / hundreds table).
  - I prefer rephrasing.
  - Also, D16's example (`%42'si … 5 Mart 2027`) doesn't match a September start; that's about 51%. It's only an example, but the e2e will use the real formula.
- **@po 7 (AC 33 bar on unplanned lines):** pct is `—` there, so I render no bar, and the chip and the words carry the meaning. Please confirm.
- **@po (agree):** D3 (menu, no drag-and-drop), D6, D7 kept small, D8 (`sidebarOnly` plus the home card), D9 and D13–D17 are all straightforward on the UI side with what we have. I'm not asking for any new dependency.
- **@ux:** please own the visuals of the stacked segmented control (§2.2), the card's meta row, the bar legend, and whether `Yeni` is a dot or a word. The constraints I need kept are in §2.4 and §5.5.
- **@dba:** the indexes in §6, plus `revision` (an integer, or `updated_at` in ms) on tickets and budgets for D11 / AC 31.
- **@backend:**
  - the contracts in §8
  - `parsePlanAmount` (3)
  - the elapsed-days formula (§9.3)
  - the shared `budgetReport` builder used by the page, the route and the email
  - building system sentences at read time (or tell me otherwise)
