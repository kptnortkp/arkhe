# Phase 5 — UI engineering plan (Finans)

Author: arkhe-ui-engineer. Inputs: `po-spec.md`, `ux.md`, `backend.md` (§1 money helpers, §3 queries, CSV), Phase 4 `ui.md` + `implementation-notes.md`, code (`components/{use-run-action.ts,confirm-dialog.tsx,filter-chip.tsx,part-dot.tsx,forms/*}`, `homework/deadline-chip.tsx`, `odevler/matris/page.tsx`, `raporlar/csv/route.ts`, `shell/{nav-items.ts,app-nav.tsx}`), Next 16 docs (`02-components/form.md`, `guides/forms.md`, `guides/server-actions.md`). `ux.md` owns copy and visuals; this file owns how they're built. Replies at the end (§15).

## 0. Principles
- Server Components by default. Client islands: `AmountInput`, `EntryForm`, `EntryEditSheet`, `VoidDialog`, `LedgerFilterSheet`, `DuesList` (search + payment sheet), `DuesMemberSheet`, `PaymentForm`, `RateForm`, `WaiverForm`, `PeriodForm`, `BulkPeriodForm`, `SponsorField`, `CsvRangeForm`, `CopyButton`. Overview, ledger rows, detail, matrix, events, sponsors, report and member `Aidatım` are server HTML.
- **No new dependencies** (no money, table, chart or combobox lib).
- Every `/finans/**` page calls `requireManager()` itself; `finans/layout.tsx` only renders the sub-nav (layouts aren't an auth boundary: they don't re-run on client navigation). Route handlers start with `managerOrError()` (backend §CSV).
- Totals, statuses and display strings are computed on the server. The client formats money only for what the user is typing (echo, payment sum).

## 1. Routes and component map
```
src/app/(portal)/finans/
  layout.tsx               <FinanceNav> chip row (all widths, ux §1); no auth
  page.tsx                 Özet
  loading.tsx              tiles + rows skeleton; also aidat/, hareketler/, rapor/
  actions.ts               @backend
  hareketler/page.tsx      ledger (§5)
  yeni/page.tsx            <EntryForm> (?tur, ?etkinlik, ?sponsor, ?duzelt, ?geri)
  [id]/page.tsx            detail, audit, DocumentLink, EntryActions (Düzenle sheet, Düzelt link, İptal et)
  aidat/page.tsx           ?donem, ?filtre=borclu, ?gorunum=tablo, ?uye (§7, §8)
  aidat/donemler/page.tsx  periods + PeriodForm / BulkPeriodForm sheets
  aidat/csv/route.ts       dues CSV
  etkinlikler/page.tsx, etkinlikler/[id]/page.tsx, sponsorlar/page.tsx, sponsorlar/[id]/page.tsx
  rapor/page.tsx           monthly + categories + #csv (§10)
  rapor/csv/route.ts       Muhasebe CSV
  ayarlar/page.tsx         opening balances + Ödeme bilgisi
src/components/finance/
  money-amount.tsx         <MoneyAmount> pure, usable from server and client (§3)
  amount-input.tsx         client (§2)
  entry-form.tsx, entry-edit-sheet.tsx, entry-actions.tsx, void-dialog.tsx, sponsor-field.tsx   client
  entry-row.tsx, entry-day-groups.tsx, ledger-filter-sheet.tsx (client), month-stepper.tsx
  dues-chip.tsx            server-safe tone chip (ux §6.5)
  dues-list.tsx            client: rows, search, payment sheet (§7)
  dues-member-sheet.tsx    client shell; content rendered on the server for ?uye= (§7)
  payment-form.tsx, rate-form.tsx, waiver-form.tsx, period-form.tsx, bulk-period-form.tsx   client
  dues-matrix.tsx          server (§8)
  balance-tiles.tsx, finance-nav.tsx, home-cards.tsx (Kasa, Aidatım), my-dues.tsx   server
  csv-range-form.tsx       client (§10)
src/components/copy-button.tsx   extracted from homework/singer-steps.tsx (props: text, label, toast)
src/components/tone-chip.tsx     tone→class map extracted from deadline-chip.tsx, used by DeadlineChip and DuesChip
src/components/link-preview.tsx  Drive preview extracted from repertoire/link-row.tsx, used by DocumentLink
```
Moves are behaviour-neutral (Phase 4 D18 style), imports updated in the same change. `ConfirmDialog` gets an optional `children` slot (rendered between description and footer) so the void reason textarea fits without a second dialog component.

## 2. Money input (`AmountInput`, on top of backend's `src/lib/money.ts`)
- Helpers are backend §1.1 (`parseAmount`, `formatKurus`, `formatSigned`, `formatNet`, `amountInput`, `csvAmount`), isomorphic, string-only parsing. I checked Node 24 ICU: `₺1.250,50`, `₺10.000.000,00`, and negatives come out `-₺…` with an ASCII hyphen, which is why the sign is ours.
- **@backend:** ux §0 change 2 and I both need the dot-decimal rule your regex rejects: with no `,` and exactly one `.` followed by **1–2 digits at the end**, `.` is the decimal mark (`150.5` → ₺150,50, `1250.50` → ₺1.250,50). `.` + exactly 3 digits stays thousands. Reason: `inputMode="decimal"` on an iPhone/Android with an English region shows only `.`, so kuruş can't be typed at all otherwise. AC4 cases are unchanged. Also add `Tutar gir.` for empty (ux §4.2).
- Markup: `<Input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} enterKeyHint="next" name="amount">`, `h-14 text-2xl font-sans tabular-nums pl-9`, with a `₺` prefix (`aria-hidden`, absolutely positioned). The wrapper gets `has-focus-visible:ring-3`. No `type="number"`: wheel scroll, locale and `e` quirks.
- Echo: `<p id="{name}-echo" aria-live="polite">` **`Kaydedilecek: ₺1.250,50`**, linked by `aria-describedby`. Valid → echo. Invalid → nothing while typing, the parse error on blur (no shouting mid-typing). A server error from `useActionState` replaces the client one.
- On blur, a valid value is rewritten with `amountInput` (`1250,5` → `1.250,50`).
- The initial echo string comes from the server as a prop, so the first client render never formats (no ICU hydration mismatch). `autoFocus` only on `/finans/yeni` (ux).
- Optional `max` (payment): the echo adds `Kalan ₺300,00`; above it the error is the exact server copy `Kalan borç ₺300,00; daha fazlası girilemez.`

## 3. Money display (`MoneyAmount`)
- `<MoneyAmount kurus kind="income|expense|transfer|opening|balance" />` → `<span data-kind data-kurus={kurus} class="font-sans tabular-nums whitespace-nowrap">` + `sr-only` prefix `Gelir`/`Gider`/`Virman` (ux §2). Colours exactly as the ux §2 table; balance/net < 0 → `formatNet` + `text-absent-ink`, and the caller adds the `Eksi bakiye` chip or the `Zarar` word.
- `data-kurus` is the e2e hook, so tests don't parse display text.
- Amounts never use Fraunces: anything numeric inside a heading is wrapped in `font-sans`.
- Long values: tiles use `min-w-0 [overflow-wrap:anywhere]` so `₺10.000.000,00` wraps inside a 165 px Kasa tile instead of making the page scroll (AC23).

## 4. Entry form (`/finans/yeni`)
- Layout and copy per ux §4.2. Implementation: `useActionState` + `Field` + `useFocusError`. `Tür`, `Kategori`, `Hesap`, `Hedef hesap`, date chips and `Sponsor` are controlled (the category set and labels depend on kind), so the form submits with **`submitWithoutReset`**.
- **`submitWithoutReset` needs the submitter** for `Kaydet ve yenisini ekle`: it builds `new FormData(form)` without it, so `name="intent" value="next"` would be lost. Change to `new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)`. Backwards compatible for Phase 3/4 forms.
- `Kaydet ve yenisini ekle`: the action returns `{ success }` without redirect; the client clears amount/description, keeps kind/category/account/date, focuses `Tutar`.
- Category: `ChoiceGroup` radios (ux), `Aidat` never rendered, plus the server refusing `dues` (AC5).
- `SponsorField`: see §15 counter-proposal (native select + inline `+ Yeni sponsor`).
- `Etkinlik`: native `<select>` (`Etkinlik yok` first), consistent with Phase 4's piece picker.
- `Tarih`: `type="date"`, `max` = today + 31 and the default from the server (`istanbulDateOf(now())`); `Bugün`/`Dün` chips set the value from server-provided strings, not `new Date()` on the client.
- `?geri=` must be a same-origin path starting with `/finans` (validated on the server, else `/finans/hareketler`). Success redirect uses the `?toast=` pattern.
- `?duzelt={id}`: the page loads the entry server-side (manager + not voided, else `notFound()`/toast `Bu kayıt zaten iptal edilmiş.`), prefills via `amountInput`, adds hidden `replacesId`; the action voids + inserts in one transaction (backend, ux, PO agree).
- Mobile sticky submit: `sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]`; I'll measure the real tab bar (`app-nav.tsx` fixed bar) in screenshots and adjust; `bg-background/95` (ux §9).

## 5. Ledger (`/finans/hareketler`) and URL state
- Params (Turkish, zod-parsed, invalid → ignored, never a 500): `ay=YYYY-MM`, `tur=gelir|gider|virman`, `kategori=<code>`, `hesap=kasa|banka`, `etkinlik=<id>`, `sponsor=<id>`, `belgesiz=1`, `iptal=1`.
- Range: `ay` if present; else the current Istanbul month, **except** when `belgesiz`, `etkinlik` or `sponsor` is set without `ay`: then no month bound (AC10 must find the seeded costume wherever the seed dated it). The stepper is hidden in that case and the heading says **`Tüm aylar`**. Unbounded lists cap at 200 rows with **`İlk 200 kayıt gösteriliyor. Ay seçerek daralt.`**
- Month stepper: two `Link`s `size-11` with `aria-label`; the future one renders as `<span aria-disabled="true">` (a link can't be disabled). Filter chips are `FilterChip` links that preserve the other params (helper `withParams(searchParams, patch)` in `src/lib/url.ts`).
- `LedgerFilterSheet` (ux `Filtre`): a `next/form` `<Form action="/finans/hareketler">` inside the Sheet with native selects + hidden inputs for the preserved params; `Uygula` is the submit (client navigation, no `router.push` code). Active filters are removable chip links (`X`, `aria-label="Filtreyi kaldır: …"`).
- Day groups: `<section aria-labelledby>` with `<h2>` eyebrow (ux) and `<ul>`; each row is one `Link` (no nested interactive elements, so `Paperclip`/`Belge yok` are text+icon, not buttons). Voided rows add the visible `İptal` chip: `line-through` isn't announced.
- Footer `<dl>` month totals (voided and transfers excluded), hidden under `iptal=1`.

## 6. `Ödeme al` (`PaymentForm`, in a Sheet owned by `DuesList`)
- Data: the aidat page passes `DuesList` each roster row with `openPeriods: { id, name, remainingKurus, tone }[]` (oldest first, all periods, not only the selected one; ≤ 60 members × a few periods = a few KB). The payment sheet opens instantly with no server round trip.
- Single mode: period radios (`Eylül 2026 · ₺200,00 kaldı`), oldest preselected; `Tutar` = `AmountInput` prefilled with that remaining, `max` = remaining; switching period resets the amount. `Tarih` (today, `Bugün`/`Dün`), `Hesap` Kasa default.
- `Birden fazla dönem` (`Checkbox`, 44 px row): radios become checkboxes, oldest ticked, amount input replaced by read-only **`Toplam ₺500,00 (2 dönem)`** (`aria-live="polite"`). Each ticked period is paid its full remaining; submits `periodIds`. Controlled → `submitWithoutReset`.
- Submit label follows the amount: **`₺300,00 al`** (formatted from the parsed input; while invalid, **`Ödeme al`**). The server recomputes remaining in the transaction and rejects over-payment with the AC15 copy; nothing is saved.
- After success: see §15 (sheet stays open with `Sonraki borçlu`, instead of a toast action).

## 7. Dues list (`/finans/aidat`)
- `?donem` (default: period containing today, else latest), `?filtre=borclu`, `?uye` (member sheet). Period chips newest left, capped at 12 + `Dönemler`.
- Summary card: server. Progress bar = `div role="img" aria-label="18/32 ödendi"` with a `bg-present` fill (no `<progress>`: its styling differs by engine).
- `DuesList` (client): grouped S/A/T/B, `Üye ara` filters rows by `searchKey` (from `lib/format.ts`, isomorphic). The `Borçlular` filter stays server-side (URL); search is client-only. Row = name `Link href="?donem=…&uye=…" scroll={false}` (opens member sheet) + `DuesChip` + `Plus` button (`aria-label="Ödeme al: {Ad}"`, size-11) for owing rows. Row id `uye-{id}`.
- `DuesMemberSheet`: when `?uye` is set the page server-renders that one member's history/payments/rate/waiver and passes it as `children`; the client shell only controls open/close. Close → `router.replace` without `uye`, `scroll: false`, then focus `#uye-{id} a`. Other members' history never reaches the client.
- `DuesChip`: `data-tone` + `data-testid="dues-status"`, classes and icons per ux §6.5 via `tone-chip.tsx`; the label includes the remaining amount (server string).
- `RateForm` (ChoiceGroup + note), `WaiverForm` (reason + `Muaf tut`), `Muafiyeti kaldır` (`ConfirmDialog`): all `useRunAction`, then refresh.

## 8. Dues table (`?gorunum=tablo`)
- Same pattern as `odevler/matris`, including the parts ux §6.6 left out: `<div role="region" aria-labelledby tabIndex={0} class="max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border bg-card focus-visible:ring-3">` (axe `scrollable-region-focusable`), `table.w-max.min-w-full.border-separate.border-spacing-0` (sticky cells lose borders under `collapse`), sr-only `<caption>`, `<tbody>` per part with a `scope="rowgroup"` header, sticky `<th scope="row" class="sticky left-0 z-10 bg-card w-[120px]">` name (truncate + `title`).
- Columns: last 6 periods, newest left; header name + `son ödeme 15 Eki`. Cell = `Link` `size-12` → `?donem={p}&uye={u}` (member sheet), `aria-hidden` status icon, `aria-label="{Ad}, Ekim 2026: Gecikti, ₺200,00 kaldı"`, `data-cell="paid|partial|unpaid|overdue|exempt|none"`; `none` (not on roster) has no link. `<tfoot>`: collected / expected per period. Legend in words above.

## 9. Void and edit
- `VoidDialog` = `ConfirmDialog` + `children` slot: `Textarea` **`İptal nedeni`** (`maxLength=200`, initial focus via the AlertDialog's `initialFocus`), inline error from the action (`İptal nedeni yaz (en az 5 karakter).`), Cancel-first focus order, `Vazgeç` / `İptal et`. Reason state is cleared when the dialog closes.
- `EntryEditSheet` (ux: Sheet, not a route): four fields only. Amount/date/account/category are not inputs anywhere in it (AC9).
- No delete control is rendered for entries (AC7). `Düzelt` is a `Link` to `/finans/yeni?duzelt={id}&geri=/finans/{id}`.

## 10. Report (`/finans/rapor`) and CSV
- `?yil`, `?hesap=toplam|kasa|banka`, `?ay` (category breakdown). The ux `ChoiceGroup` for hesap becomes `FilterChip` links: it changes the URL, not a form value.
- From `md`: `<table>` with sr-only `<caption>`, `th scope="col"`, `th scope="row"` month, `text-right tabular-nums`, `<tfoot>` `Yıl`. Sticky `thead` (`sticky top-0 bg-card`) works only while no ancestor scrolls; the table is not wrapped in an overflow box from `md` (it fits 944 px).
- Phone: month cards (`<ol>` + `<dl>`). Both render; `md:hidden` / `hidden md:table` (display:none removes the inactive one from the a11y tree). `data-testid="report-row" data-month` on both; e2e uses visible locators.
- Category share bar `aria-hidden`; the `%` is text.
- `#csv`: `CsvRangeForm` = a plain GET `<form action="/finans/rapor/csv" method="get">` (not `next/form`: the target is a download), `from`/`to` date inputs, `CSV indir` submit. Client validation shows `Bitiş başlangıçtan önce olamaz.` inline before submitting (a toast can't come from a download). The route returns 400 with the same text as the backstop. Dues CSV is a plain `<a href>` (not `Link`, which would try client navigation).

## 11. Nav and entry points
- `nav-items.ts`: `{ href: "/finans", label: "Finans", icon: Wallet, managersOnly: true, sidebarOnly: true }` after Raporlar. `app-nav.tsx` already matches with `startsWith`, so sub-routes highlight it.
- `FinanceNav`: the ux chip row inside `<nav aria-label="Finans bölümleri">`, server, `active` passed by each page (no `usePathname` island). The row scrolls inside itself; its links are focusable, so no `tabIndex` is needed on the scroller.
- Home: `KasaCard` (managers) and `MyDuesCard` (members with remaining > 0) in `finance/home-cards.tsx`, each one query. `/profil`: `Finans` and `Raporlar` link rows (managers), `MyDues` first with `id="aidat" scroll-mt-20` (conductor hidden).
- `MyDues` data comes from a query that takes no user id parameter (session only, backend). `CopyButton` keeps the Phase 4 fallback chain (clipboard API → `execCommand` → selected read-only input), toast `Kopyalandı.`

## 12. Accessibility
- Targets ≥ 44 px: rows `min-h-16`, chips `min-h-11`, steppers and `+` `size-11`, matrix cells `size-12`, sheet buttons `h-11`/`h-12`. Focus ring `focus-visible:ring-3 ring-ring/50`, including the matrix region and the `₺` input wrapper.
- Signs are characters, kinds have sr-only words, statuses are icon + word, voided has a text chip, negative balance has a word.
- Forms: visible labels, `fieldset`/`legend` for radio groups, `aria-describedby` for hint/echo/error, `aria-invalid`, first error focused. Sheets return focus to their trigger (base-ui does this for trigger-opened sheets; URL-opened sheets use the explicit focus in §7).
- Headings: page `h1`, sections `h2`, part groups `h3`; tables have captions and scoped headers.
- Contrast: tokens are the Phase 2/4 checked pairs; I'll re-check the `bg-stage` Toplam tile with a negative amount (`text-absent-ink` on stage may fail; fallback: chip on `bg-card` inside the tile) and the dark sticky submit bar.

## 13. Performance
- Aggregation in SQL (backend §3): overview ≈ 4 queries, ledger 1 (+1 for totals), dues list 3, matrix 3, report 1 grouped by month+account+kind. Sums are integers (< 2^53).
- Member sheet data only for `?uye`; payment data is the small per-row `openPeriods`. No per-row server components inside client lists.
- No charts, no new packages; Lucide icons are tree-shaken. `loading.tsx` per heavy route.

## 14. e2e hooks
`balance-cash|bank|total` (+`data-kurus`), `entry-row` (`data-id`, `data-voided`), `money` (`data-kind`, `data-kurus`), `amount-echo`, `dues-row` (`data-user`), `dues-status` (`data-tone`), `matrix-cell` (`data-cell`), `report-row` (`data-month`), `void-line`, `replaces-link`, `pl-result` (`data-kurus`, signed).

## 15. Replies
**@ux:** agree with almost all of it, and I've built §1–§14 on your copy and layout. Counter-proposals:
1. **Last-used account in `localStorage`:** reading it after hydration flips the `Hesap` radio a frame after paint (flash, and a moved focus target for fast tappers). Same behaviour without the flash: the save action sets a `arkhe_fin_hesap` cookie (httpOnly not needed, `SameSite=Lax`, 1 year) and the page reads it on the server for the default. Dues still default `Kasa`.
2. **`Ödeme alındı` toast with a `Sonraki borçlu` action:** toasts auto-dismiss (WCAG 2.2.1), and focus doesn't move into a sonner toast. Instead the sheet stays open in a success state: **`Ödeme alındı: {Ad} · ₺500,00.`** + a focused primary **`Sonraki borçlu: {Ad}`** + **`Kapat`**. Same two-tap loop, keyboard and screen-reader friendly. The toast still fires.
3. **Sponsor picker Sheet with search:** a choir has tens of sponsors; a native `<select>` (type-to-search on desktop, the OS picker on phones) is faster and needs no nested sheet in a form. `+ Yeni sponsor` stays inline under it (name `Input` + `Ekle`, then the new one is selected). I'll switch to a Sheet if the list passes ~40 active.
4. **`Ödeme al` on Özet with an `Üye seç` step:** it duplicates roster + open periods on the overview. Proposal: the button links to `/finans/aidat?filtre=borclu` and focuses `Üye ara`; it's one step either way.
5. **Dues table sticky right `Kalan` column:** two sticky columns at 375 leave room for ~3 period cells. I'd put the remaining as a second line in the sticky name cell (`₺500 kalan`, `text-absent-ink` when late) and a normal last column from `md`.
6. **Matrix box:** `-mx-4 overflow-x-auto` alone fails axe (`scrollable-region-focusable`); I add `role="region" tabIndex={0}` + focus ring as in Phase 4.
7. **CSV `<a download>` with date inputs:** an anchor can't read the inputs without JS; a GET form gives the same download, and the range error is inline instead of a toast (§10).
8. **Hesap `ChoiceGroup` on the report:** it's navigation, so `FilterChip` links (§10).
**@po:** Q1 no UI impact. Q2 agree (RateForm hint + owed shown per period). Q3 agree. Q5/Q6 agree with ux (Kasa for dues; `/profil#aidat`). §3.1 decimals and Düzelt order: same counter-proposals as ux §0 and backend (§2, §4 here).
**@backend:** dot-decimal rule and `Tutar gir.` (§2); `submitWithoutReset` submitter fix (§4); dues list needs per-member `openPeriods` across all periods in one query (§6); the member-sheet query is per `?uye` (§7).
