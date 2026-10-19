# Phase 4 — UI engineering plan (Kayıt ödevleri)

Author: arkhe-ui-engineer. Inputs: `po-spec.md`, Phase 3 `ui.md` + `po-decisions.md`, current code (`repertuvar/`, `components/repertoire/`, `shell/`, `lib/time.ts`, `lib/links.ts`), Next 16.4 docs (`forms.md` useOptimistic, `server-actions.md`, `preventing-flash-before-hydration.md`). `ux.md`, `db.md` and `backend.md` don't exist yet. Where ux decides copy or visuals, I give a default and ux overrides.

## 0. Principles
- Server Components by default. The client islands are `SubmitToggle`, `CopySubjectButton`, `AssignmentForm`, `AssignmentRoster` (manager list + one note sheet), `AssignmentMenu`, `RecordingEmailDialog`. Lists, the detail page, the matrix and the home cards are server HTML.
- **No new dependencies.** No date picker, clipboard library or table library.
- All time maths and date formatting happen **on the server** (fixed TZ `Europe/Istanbul`, `tr-TR`). The client never calls `new Date()` to render text, so hydration can't mismatch (server and browser ICU can disagree, e.g. `Cmt` vs `Cts`).
- One isomorphic module, `src/lib/homework/deadline.ts`, plus `src/lib/homework/mail.ts`. Neither has Node APIs or `server-only`, so the toggle can reuse the label logic.

## 1. Routes and component map
```
src/app/(portal)/odevler/
  page.tsx                server: ?liste=guncel|gecmis, member rows or manager rows, header actions
  loading.tsx             skeleton rows (shared shape with repertuvar/loading.tsx)
  actions.ts              @backend: submit/undo self, manager mark, feedback, CRUD, recording email
  yeni/page.tsx           requireManager(); <AssignmentForm> (?eser= prefill)
  matris/page.tsx         requireManager(); <SubmissionMatrix> (server table)
  [id]/page.tsx           server: header, deadline, description, part links, mail block, toggle, note; managers: roster
  [id]/duzenle/page.tsx   requireManager(); <AssignmentForm initial=…>
src/components/homework/
  deadline-badge.tsx      server: tone chip + absolute date (§2)
  assignment-title.tsx    server: "{Eser} · {Ölçü 12–34|Tüm eser}" + PartChips (Tutti when 4)
  assignment-row.tsx      server <li>: link + sibling SubmitToggle (PieceRow pattern, no button inside <a>)
  submit-toggle.tsx       client: Teslim ettim / Geri al, optimistic (§4)
  mail-block.tsx          server: mailto <a>, address text, hint; embeds CopySubjectButton (§3)
  copy-subject-button.tsx client: clipboard + fallback
  feedback-note.tsx       server: "Şefin notu", author + date, whitespace-pre-line
  assignment-roster.tsx   client: per-assignment manager list grouped S/A/T/B, filter, one shared Sheet (§5)
  submission-matrix.tsx   server: /odevler/matris table (§6)
  assignment-form.tsx     client: useActionState + useFocusError (§8)
  assignment-menu.tsx     client: Düzenle link + Sil via ConfirmDialog
  recording-email-dialog.tsx client: Dialog with one Field
  home-cards.tsx          server: Ödevlerim / Ödevler cards
```
Moves (no behaviour change): `useRunAction` from `repertoire/piece-menu.tsx` → `src/components/use-run-action.ts`; `ConfirmDialog` and `PartDot` → `src/components/` (both are generic now). Imports in repertoire updated in the same change. `FilterChip` is already shared.

## 2. Deadline tone helper
`src/lib/homework/deadline.ts`:
```ts
type Tone = "green" | "amber" | "red" | "done" | "none";
deadlineState(input: { dueAt: Date; now: Date; submittedAt: Date | null; joinedAfter: boolean })
  → { tone: Tone; label: string; late: boolean }
pendingState(...)  // same, ignoring submittedAt: what "Geri al" falls back to
```
- Rules exactly as spec §3.5, in ms with `H = 3_600_000`: `r > 72H` green, `24H < r ≤ 72H` amber, `0 < r ≤ 24H` red, `r ≤ 0` red. Days `Math.floor(r / 24H)`, hours `Math.ceil(r / H)`, `r < H` → `1 saatten az kaldı`. Overdue `d = floor(−r / 24H)`, `d = 0` → `Gecikti`, else `Gecikti · {d} gün`.
- `joinedAfter` (new joiner, §3.4): never red. While `r > 0` green or amber (the red band shows amber), after the deadline tone `none` with `Son tarih geçti` (muted chip). @ux: copy is yours.
- Submitted: tone `done`, `Teslim edildi · 22 Eki` or `Geç teslim · 26 Eki` (`late = submittedAt > dueAt`), with a `Check` icon.
- **Where:** computed in the server component with `now()` from `lib/time.ts`, once per request (one `const at = now()` passed down, so a page never shows two tones for the same instant). No client ticking: a page is dynamic (session cookie), every navigation and every `router.refresh()` after an action recomputes. A tab left open overnight shows yesterday's tone until the next interaction. Accepted: a `setInterval` re-render would need client clocks and hydration workarounds for a badge that changes at most once an hour.
- **Rendering:** `<DeadlineBadge state dueLabel>` → `<span data-tone={tone} data-testid="deadline-badge">` with icon (`Clock` pending, `AlertTriangle` red/overdue, `Check` done) + text, then `Son tarih: 24 Eki Cmt 23:59` in muted text. Colour is never the only cue.
- **Tokens** (reuse the Phase 2 attendance colours, already contrast-checked in both themes): green `bg-present/14 text-present-ink`, amber `bg-late/18 text-late-ink`, red `bg-absent/12 text-absent-ink`, done/none `bg-muted text-foreground`. `text-gold`/`text-success` on paper fails 4.5:1, so they're not used for text. @ux: if you want the spec's `success/gold/destructive` names, I'll alias them in `globals.css` to these values.
- **Formatters** to add to `lib/time.ts`: `formatDue = {day:numeric, month:short, weekday:short, hour, minute}` → `24 Eki Cmt 23:59`; `formatDueLong` (weekday/month long) for the mail body → `24 Ekim Cumartesi 23:59`; `formatShortDate` `{day, month:short}` → `22 Eki`. Note: tr-TR's short Saturday is `Cmt`, not the spec's `Cum`-style example.
- **@backend / @po (seed precision):** with `floor`, a homework seeded at `+5 d` reads `4 gün kaldı` a few seconds later, and `+2 d` reads `1 gün kaldı`, so AC3 would fail. Seed A at `+5 d + 2 h`, B at `+2 d + 2 h`, C at `+5 h − 10 min` (ceil → `5 saat`), D at `−2 d − 2 h`. The AC3 boundary tests (`72 h ± 1 min`, `23 h`) are unaffected.

## 3. Mail block (`mail.ts` + `mail-block.tsx`)
```ts
buildSubject({ pieceTitle, bars, partLabel, name }): string   // "Arkhe ödev · … · Alto · Ad Soyad"
buildBody({ pieceTitle, bars, dueLong, name }): string
buildMailto(to: string, subject: string, body: string): string
```
- Encoding: `encodeURIComponent` for subject and body (spaces → `%20`, never `+`; **don't use `URLSearchParams`**, which writes `+` and many clients show it literally). Body line breaks normalised to `\r\n` → `%0D%0A` (RFC 6068 §5). The address goes in as is: it was validated to `x@y.z` with no `?`, `&`, `#` or `%`, so `href` starts literally `mailto:kayit@arkhe.local?subject=` (AC4).
- Length: the subject is built from the piece title cut to 80 characters (`…`) and the name cut to 60. The body doesn't include `Açıklama`. The whole `href` stays under ~600 bytes, well below the ~2000 limit of old Windows/Outlook handlers. Turkish letters and `·` become UTF-8 `%C3%B6`-style escapes, and iOS Mail, Gmail (Android/iOS/web via handler) and Outlook mobile decode them.
- Platform behaviour (documented, not coded around): iOS opens the default mail app (iOS 14+), or offers to restore Mail if none is installed. Android shows the intent chooser, and Gmail honours subject and body. Desktop without a handler does nothing visible, which is why the address and `Konuyu kopyala` are always on screen. Plain `<a href>`, no `target`, no `rel`. Strings are built on the server; the client only receives the final `href` and the subject string.
- `CopySubjectButton` (client): `navigator.clipboard.writeText(subject)` → toast `Konu kopyalandı.`. Fallback when the API is missing or rejects (non-secure context, old WebView, denied permission): a temporary off-screen `<textarea>` + `document.execCommand("copy")`; if that also returns false, show the subject in a read-only `<input>` below, focused and selected, with toast `Kopyalanamadı. Konuyu seçip kopyala.`. 44 px outline button with a `Copy` icon. The headless Playwright clipboard often rejects, and the `execCommand` path still produces the toast, so AC4 holds without granting permissions.
- With no email set: no `<a>`, render spec §3.2 copy (muted box). `Teslim ettim` still shows.

## 4. `Teslim ettim` / `Geri al` (optimistic)
- `SubmitToggle` props (all server-computed): `assignmentId`, `submitted: boolean`, `canUndo: boolean` (false when feedback exists), `pending: {tone,label}` (from `pendingState`), `doneLabel` (`Teslim edildi · {today}` or `Geç teslim · {today}`, computed with server `now`), and `variant: "row" | "hero"`.
- `const [optimistic, setOptimistic] = useOptimistic(submitted)`. On tap: `startTransition(async () => { setOptimistic(!submitted); const r = await action(id); if (r.error) toast.error(r.error); router.refresh(); })`. On error the optimistic value falls back to the server prop when the transition ends, so no manual rollback is needed. Built on the shared `useRunAction` (extended with an optional `optimistic` callback) so the pattern stays one place.
- The badge and the button live in the same client island, so the chip flips to `done` instantly. The tab badge and home card catch up on the `router.refresh()` (it re-renders the layout, see §7).
- No toast on success: the visible change is the feedback. Errors go to a toast. Double taps: the button is `disabled` while pending, and the server is idempotent anyway.
- Focus and announcements: one stable `<Button>` element whose label and variant change (`Teslim ettim` default → `Geri al` ghost), so focus stays put. A sibling `<span role="status" class="sr-only">` announces `Teslim edildi` / `Teslim geri alındı`.
- When `canUndo` is false the button isn't rendered, and the server rejects anyway. A manual mark shows `şef işaretledi` under the chip (PO Q1: undo allowed, so `canUndo` doesn't depend on `method`).
- `data-testid="submit-toggle"`, `data-state="pending|done"` for e2e.

## 5. Per-assignment roster (managers, `[id]/page.tsx`)
- Not a wide table: a grouped list. `<section aria-labelledby>` per part with `<h3>Alto · 6/9</h3>` and a `<ul>` of rows: name, state chip (`Teslim edildi 22 Eki` / `Geç teslim` / `Bekleniyor` / `Gecikti` / `Ayrıldı`), `şef işaretledi` tag, a note icon when feedback exists, and a `Not` button (44 px).
- `AssignmentRoster` is one client component (≤ 60 rows, small payload) holding **one** `Sheet` (`side="bottom"` under `md`, `right` from `md`) for the selected singer: `Teslim edildi` switch-style checkbox (manager mark) + feedback `Textarea` (max 1000, counter after 800) + `Kaydet`, and `Notu sil` when a note exists. Saving uses `useRunAction`, toast from the action, the sheet closes, refresh.
- Filter `Tümü` · `Teslim etmeyenler`: `FilterChip` with `?durum=eksik` (URL state, server-filtered, works without JS).
- Privacy: the roster props (with all feedback text) are only built inside `if (isManager)`. Members' RSC payload never contains other singers' rows (AC10 checks the HTML; the RSC payload is inside the HTML, so the server filter is the guarantee).

## 6. `/odevler/matris` (managers)
- A real `<table>` inside `<div role="region" aria-labelledby="matris-baslik" tabIndex={0} class="max-w-full overflow-x-auto rounded-2xl border">`. The focusable region lets keyboard users scroll it (axe `scrollable-region-focusable`). `main` is already `min-w-0`, so only this div scrolls. The page never does (AC18).
- `table class="w-max min-w-full border-separate border-spacing-0"`: separate borders, because `sticky` cells lose borders under `border-collapse`.
- `<caption class="sr-only">Son 8 ödevin teslim durumu</caption>`. Header row: `<th scope="col">` per assignment, two lines (short piece name truncated to 10ch + `24 Eki`), `title` = full title. Each part: `<tbody>` with a first row `<th scope="rowgroup" colSpan={n+2}>` (PartDot + `Alto`). Rows: `<th scope="row" class="sticky left-0 z-10 bg-card">` name (`max-w-[8.5rem] truncate`, `title` full name; a right border/shadow marks the sticky edge), then cells, then `{n}/{m}`.
- Cell = `<td>` with an `<a href="/odevler/{id}">` 44×44, symbol `aria-hidden` (✓ `Check` present-ink, `G` late-ink, ✗ `X` absent-ink, `·` muted, blank) and `aria-label="{Eser}, 24 Eki: Teslim edildi|Geç teslim|Gecikti|Bekleniyor"`. Blank cells (not eligible) have no link. `data-cell="done|late|missing|pending|none"` for e2e. A legend under the table repeats the symbols in words.
- Header is not sticky vertically: sticky-top inside an `overflow-x` box sticks to the box, not the page, and a fixed-height inner scroller is awkward on a phone. With ≤ 60 rows split into part groups, the group headers keep orientation.
- **@po Q6:** 8 columns on every width, **newest first (left)**, so the most relevant columns are visible at 375 px without scrolling. Desktop (≤ 944 px content) fits 8 × 64 px + 12 rem name column + total with no scroll.

## 7. Nav: 5 tabs at 375 px, badge
- `nav-items.ts`: add `{ href: "/odevler", label: "Ödevler", icon: Mic, badge: "homework" }` after Repertuvar. Members get 4 tabs, managers 5 (Raporlar stays `sidebarOnly`).
- Fit: 375 / 5 = 75 px per tab. The widest labels `Çalışmalar` and `Repertuvar` are ~58 px at 11 px Geist medium, and the icon pill is 48 px. Fits, with `whitespace-nowrap px-0.5`. At 360 px (common Android) a tab is 72 px, still fine. Below 360 px: `max-[359px]:text-[10px]`. I'll screenshot 320/360/375/390. Tab height stays ≥ 56 px (above 44).
- Badge: `BottomNav`/`SidebarNav` take `badges?: Partial<Record<"homework", number>>` from `PortalLayout`, which runs one count query for members (managers: none, PO Q2). The badge is a `<span aria-hidden>` pinned to the icon pill's top-right (`absolute -top-1 -right-1 min-w-4 h-4 rounded-full px-1 text-[10px] tabular-nums bg-primary text-primary-foreground ring-2 ring-background`), `9+` above 9, plus `<span class="sr-only">, {n} bekleyen ödev</span>` in the link text. Sidebar: the same count, right-aligned pill. Hook: `data-nav-badge={n}`. @ux: primary rather than destructive, because red already means "overdue" in this phase.
- Freshness: App Router layouts don't re-render on client navigation, only on `router.refresh()`/server-action refresh. Every submit/undo path refreshes, so the badge is right after the singer's own actions. A manager's change shows on the singer's next full load or refresh. Accepted.

## 8. Create / edit form (`AssignmentForm`)
- `useActionState` + `useFocusError` + `Field`, as in `piece-form.tsx`. Field errors keyed `pieceId`, `bars`, `parts`, `dueAt`, `description`; the bar errors attach to the `Ölçüler` fieldset.
- **Eser:** a native `<select name="pieceId">` with `<optgroup label="Çalışılıyor">` / `Hazır`, sorted by `searchKey`. Counter-proposal to the spec's "search as on /repertuvar": the native picker on iOS/Android is searchable by typing on desktop, is the most accessible option and needs no JS. A choir has well under 200 pieces. `?eser=` preselects it. On edit, an archived current piece appears as an extra `(Arşiv)` option. @ux/@po: object here if you want a combobox. It would be a base-ui Combobox, which costs one more shadcn component.
- **Ölçüler:** `<fieldset>` legend `Ölçüler` with two inputs `Başlangıç` – `Bitiş`, `type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4}` (avoids `type=number` wheel/locale quirks), side by side even at 375 px (`grid-cols-[1fr_auto_1fr]`), hint `Boş bırakırsan: Tüm eser`.
- **Partisyonlar:** `<fieldset>` with 4 checkbox chips (ChoiceGroup look, PartDot, `name="parts"`) plus a leading `Tutti` checkbox with native `indeterminate` when 1–3 are on, toggling all. Controlled client state, default all four. Chips are ≥ 44 px tall (ChoiceGroup is `min-h-10`; Phase 4 chips use `min-h-11`).
- **Son tarih:** `type="date"` + `type="time"` (same as `rehearsal-form.tsx`, no `datetime-local`, whose iOS rendering differs). Defaults are computed on the server: `istanbulDateOf(addDays(today, 7))` and `23:59`, with `min` = today on create. Hint `Türkiye saati (İstanbul)`. The server combines them with `istanbulToUtc(date, time)` and rejects past values on create.
- **Açıklama:** `Textarea`, `maxLength={1000}`, `rows=4`, live counter after 800, rendered on detail with `whitespace-pre-line break-words`.
- Submit `Ödev ver` / `Kaydet` (h-12, full width under `sm`). Redirect to `/odevler/[id]` with the toast (`?toast` pattern from Phase 3).

## 9. Reuse
`FilterChip` (liste and durum chips), `ConfirmDialog` (delete: title `"{başlık}" silinsin mi?`, description with `{n}`), `useRunAction` (toggle, mark, note, email, delete), `PartDot` + `VoicePartBadge` (part chips; `Tutti` = hollow ring), `PartButton` with `resolveMyPart` (`Partisyonum` unchanged, hidden without part), `BackLink`, `Field`, `useFocusError`, the `PieceRow` link+sibling layout for `AssignmentRow`, and `StatusChip` styling for roster states.

## 10. Accessibility
- Every interactive target is ≥ 44 px (row links `min-h-[76px]`, toggle `h-11`, matrix cells 44 px, sheet buttons `h-11`). Focus rings use the existing `focus-visible:ring-3 ring-ring/50`.
- Badges always have text and an icon. Part chips have text. The matrix cells carry `aria-label` and a legend.
- `Yeni not` dot: `<span class="size-2 rounded-full bg-primary" aria-hidden>` + sr-only `Yeni not`, plus visible text `Yeni not` from `sm`.
- Headings: page `h1`, sections `h2` (`Şefin notu`, `Teslim durumu`), part groups `h3`.
- Mail link text says where it goes: `Kaydı e-postayla gönder` + sr-only `(e-posta uygulaman açılır)`.
- Both themes are checked per screen, especially the amber chip and the sticky column background (`bg-card`, not transparent).

## 11. Performance
- No new JS dependencies. Client islands are small; the roster is the largest (≤ 60 rows).
- Queries, which @backend owns: the list page does one joined query per view. The layout badge is one `count(*)` with indexes on `submissions.user_id` and `assignments.due_at`, and is only run for members. The matrix is 8 assignments × roster in two queries, pivoted in JS.
- `loading.tsx` skeletons for `/odevler` and `[id]`. Lucide icons are tree-shaken.

## 12. Answers
- **@po Q1 (undo after manual mark):** agree, the singer may undo. UI-wise `canUndo` is then only about feedback, which is simpler.
- **@po Q2 (tab badge):** agree. One cheap indexed count in the layout. See §7 for freshness.
- **@po Q5 (`Mic` / `Ödevler`):** `Ödevler` fits at 375 px. `Kayıtlar` also fits but clashes with "Referans kayıt" and "Partisyon kaydı" in Repertuvar. `Mic` is fine. @ux decides.
- **@po Q6:** §6, 8 columns everywhere, newest first.
- **@po (seed):** §2, add slack to the seed offsets.
- **@po §4 (create from piece):** the `Ödev ver` item goes in `PieceMenu`'s dropdown as a link (`/odevler/yeni?eser={id}`), visible for managers only, and hidden for archived pieces.
