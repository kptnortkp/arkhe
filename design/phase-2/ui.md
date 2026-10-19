# Phase 2 — UI engineering plan

Author: arkhe-ui-engineer. Inputs: `po-spec.md`, `db.md` (present at the time of writing). `ux.md` and `backend.md` don't exist yet; I'll reply to them in a follow-up section here. Checked against the bundled Next 16.4.2 docs (`02-guides/server-actions.md`, `backend-for-frontend.md`, `offline-support.md`).

## 0. Principles

- Server Components by default. The only heavy client islands are the **live screen**, the **code-entry sheet**, the **roster mark control** and the **excuse sheet**. Calendar, history and reports are server-rendered HTML.
- **No new runtime dependencies** except the shadcn `input-otp` component (MIT, about 3 KB gz). QR uses `qrcode.react`, which is already in `package.json` (MIT, SVG output). No chart, date-picker or data-grid library.
- Polling uses **Route Handlers, not Server Actions**, for anything high-frequency. The docs say the client dispatches Server Actions one at a time (`server-actions.md` "Sequential dispatch"; `backend-for-frontend.md:902` "Server Actions are queued"), and each one also triggers an RSC refresh. A 5 s poll plus a burst of manual marks through actions would queue behind each other and re-render the whole page on an old iPad.
- No experimental flags. `experimental.useOffline` requires Cache Components + Partial Prefetching (`offline-support.md:34`). That is too much to change for one screen; the live screen handles offline itself (§2.4).

## 1. Routes and component map

```
src/app/(portal)/calismalar/
  page.tsx                       server: upcoming list + Geçmiş tab (?tab=gecmis), my status per row
  yeni/page.tsx                  server shell + <RehearsalForm> (client, useActionState)
  [id]/page.tsx                  server: info, my status / excuse (member); <RosterEditor> (manager)
  [id]/duzenle/page.tsx          edit / cancel / Seriyi bitir
  [id]/canli/page.tsx            server loader (requireManager, selects codeSecret) → <LiveScreen> (client)
  actions.ts                     create/edit/cancel/endSeries/open/close/excuse (low-frequency → Server Actions OK)
src/app/(portal)/raporlar/
  page.tsx                       server: period select (?donem=), tables, warning filter (?uyari=1)
  csv/route.ts                   GET → text/csv attachment
src/app/yoklama/kod/[id]/page.tsx  QR landing (outside (portal) shell: fast, no nav); server-side check-in, then result page
src/app/api/calismalar/[id]/
  canli/route.ts                 GET  live snapshot (manager)   — polled
  isaret/route.ts                POST batch of manual marks (manager) — offline queue target
src/components/rehearsal/
  rehearsal-hero.tsx             server; states from review-phase0 §1, one client child <CheckInButton>
  check-in-sheet.tsx             client; Sheet + InputOTP, posts to a Server Action (one call per user)
  excuse-sheet.tsx               client; textarea maxLength 200
  rehearsal-list.tsx             server; grouped by week
  status-pill.tsx                server; Geldi/Geç/Mazeretli/Gelmedi/Yoklama alınmadı/İptal
  mark-control.tsx               client; 4-way segmented radio (shared by LiveScreen and RosterEditor)
  live/                          client: live-screen.tsx, rotating-code.tsx, live-qr.tsx, counters.tsx,
                                 use-live-poll.ts, use-mark-queue.ts, use-wake-lock.ts, totp.ts
src/lib/attendance/totp.ts        isomorphic (Web Crypto); imported by server verify and client display
```

`/yoklama` (the current bottom tab) redirects to `/calismalar` (permanent redirect in `next.config.ts`), so old links and home-screen shortcuts keep working.

## 2. Live attendance screen (`/calismalar/[id]/canli`)

### 2.1 Layout and a11y
- Landscape-first (1024×768): left column has the code (`font-heading tabular-nums`, `font-size: clamp(6rem, 18vh, 12rem)`, AC 30 needs ≥96 px) and the QR (square, `min(40vh, 320px)`, quiet zone 4 modules, always dark modules on a white plate, also in dark mode, because phone cameras struggle with inverted QR). Right column: counters and the roster. Portrait/phone: code + QR on top, roster below.
- The portal chrome (bottom nav, sidebar) is hidden on this route: render it in its own layout segment or with a `full-bleed` flag, plus an `Çık` button (44 px) back to `/calismalar/[id]`.
- Countdown: a thin progress bar (CSS `animation` keyed by time step, `prefers-reduced-motion` → static "Yenilenme: 12 sn" text).
- The code has `aria-live="off"`, so it isn't announced every 30 s. Counters live in a `role="status"` region that only updates when numbers change (debounced). `data-testid="live-code"` (AC 7).
- `aria-label` on the QR: "Yoklama QR kodu". The code's digits are also visible text.

### 2.2 Rotating code (client)
- `totp.ts`: `code(secretHex, step) = HMAC-SHA256(key, step as 8-byte BE) → dynamic truncation → % 10_000`, zero-padded to 4 digits. It uses `crypto.subtle` (Safari ≥ 11, all target devices). The same module verifies on the server (Node has Web Crypto globally), so client and server can't drift. @backend: please own the module; I only need `codeFor(secret, at: number)`.
- **Secure context:** `crypto.subtle` is undefined on plain `http://<LAN-IP>`. Production (https) and `127.0.0.1` are fine. For phone testing over the LAN, use the Cloudflare quick tunnel from Phase 1. If `crypto.subtle` is missing, the screen shows "Bu ekran güvenli bağlantı (https) gerektirir".
- **Clock skew:** the tablet clock can be off. The live snapshot returns `serverNow`; the client stores `offset = serverNow − Date.now()` (median of the last 3 polls) and computes steps from `Date.now() + offset`. Offline it keeps the last offset. The server accepts steps n and n−1 (db.md §6).
- Tick: one `setTimeout` to the next step boundary (not a 1 s interval), recomputed on `visibilitychange`, because iOS throttles timers in the background.
- QR value `${origin}/yoklama/kod/${id}?c=${code}`. `QRCodeSVG` with `level="M"` and `marginSize={4}`, memoised on the code.

### 2.3 Polling (`use-live-poll.ts`)
- `GET /api/calismalar/[id]/canli?since=<cursor>` every **5 s** while `document.visibilityState === "visible"` and the rehearsal is open. It pauses when hidden, stops after close, and backs off to 15 s after 3 failures. One request at a time (`AbortController`; skip a tick if the previous one is still running).
- Response: `{ serverNow, cursor, openedAt, closedAt, rows: [{ userId, status, method, correctedAt }] }`. `cursor` = max `recordedAt`. When `since` is passed, only rows changed after it are returned, plus `removed` userIds for unmarks. @backend: deletes can't be diffed from the attendance table. Simplest is a full row list every poll (≈60 small rows, ~3 KB gz), so I'm fine with **always full** and dropping `since`. Names/parts come once from the server page, not from every poll.
- Response headers: `Cache-Control: no-store`. The route calls `requireManager()` itself.
- Alternatives considered: SSE/WebSockets need long-lived connections, which Vercel Hobby functions don't keep (duration limit), and a free external realtime service adds an account and a dependency. Turso has no change feed. Polling is the right call (cost in db.md §6: ~235k rows/rehearsal).
- **Member phones don't poll.** The hero gets its state from the server render and from the check-in action's result. On `visibilitychange → visible` it calls `router.refresh()` at most once per 30 s, so a member who opens the app mid-rehearsal sees `YOKLAMA AÇIK` (no timers in the background).

### 2.4 Manual marks and the offline queue (`use-mark-queue.ts`)
- A mark updates local state optimistically and enqueues `{ userId, status | null, clientAt }` in a `Map` keyed by `userId`, so a later tap on the same person replaces the queued one.
- A flusher sends the whole map as **one batch** `POST /api/calismalar/[id]/isaret` (JSON array, ≤ 60 items). It runs immediately after a tap (debounced 300 ms), on `online` events, and every 5 s while the queue is non-empty, with exponential backoff to 30 s.
- Row states: `kaydediliyor` (spinner, subtle), `kaydedildi`, `Kaydedilmedi` (warning icon + `Tekrar dene`, AC 22). The banner `Bağlantı yok — işaretlemeler bağlantı gelince kaydedilecek. Bu sekmeyi kapatma.` appears on `navigator.onLine === false` **or** on the first failed flush (`onLine` lies on captive Wi-Fi).
- `beforeunload` warning while the queue is non-empty.
- Conflicts: the server applies items in order with last-write-wins. Poll results never overwrite a row that has a pending queued mark, so local intent wins until it's flushed. @backend: the batch endpoint returns per-item `ok | error`, and the closed-rehearsal correction rule (`correctedAt`) applies per item.
- Memory only, as the spec says (no IndexedDB). This keeps the risky part small. If we later want marks to survive a reload, `localStorage` keyed by rehearsal id is a 20-line change.
- Bulk `Kalanları geldi işaretle` and `Yoklamayı kapat` are **online-only Server Actions** (they need the server roster). They're disabled with a hint while offline.

### 2.5 Screen wake lock (`use-wake-lock.ts`)
- `navigator.wakeLock.request("screen")` on mount, re-requested on `visibilitychange → visible` (the lock is released whenever the tab is hidden), and released on unmount. It must be called after a user gesture on some browsers, so it's requested from the `Yoklamayı başlat` click handler as well.
- Support: Chrome/Android ✓, Safari ≥ 16.4 ✓ in the browser. In an iOS **home-screen PWA** it only works from iOS 18.4. Fallback: no hidden-video hacks (battery, autoplay policies). Show a dismissible hint "Ekran kapanmasın diye Ayarlar → Ekran → Otomatik Kilit'i 'Hiçbir zaman' yap." when `!("wakeLock" in navigator)` or the request is rejected.
- A small pill `Ekran açık kalacak` / `Ekran kapanabilir` so the person at the piano knows.

### 2.6 Roster on the live screen
- Grouped S/A/T/B (+ `Listede olmayanlar`), sticky group headers with counts. Row = name + `MarkControl` + status meta (`Kod ile · 19:42`, `Düzeltildi · Mert`). Max ~60 rows, so no virtualisation. Rows are `React.memo` keyed by userId and only re-render on change.
- `MarkControl`: a native radio group (`fieldset` + 4 `input type=radio`, sr-only, labels as chips) like `ChoiceGroup`. Arrow-key navigation comes free. Each chip ≥ 44×44, labels `Geldi / Geç / Mazeretli / Gelmedi` (short form `G / Geç / M / Yok` under 360 px, with full `aria-label`). "Tap selected again clears": radios can't be unchecked natively, so add an explicit `Temizle` icon button (44 px, `aria-label="İşareti kaldır"`) shown only when marked. That's more discoverable than toggling a selected radio.
- Filter chips `Tümü / İşaretlenmeyen / Geldi …` and a search box (`type="search"`, 16 px, Turkish folding helper from the Phase 1 review).
- `Yoklamayı kapat` → `Dialog` with the count (AC 19), not `confirm()`.

## 3. Member check-in

### 3.1 Code entry
- shadcn `input-otp` (one real `<input>` under the slots, so paste, autofill and screen readers work): `maxLength={4}`, `inputMode="numeric"`, `pattern="^[0-9]+$"`, `autoComplete="one-time-code"`, `aria-label="Yoklama kodu"`, slots 56×64 px, 16 px+ font. `onComplete` auto-submits (spec).
- Rendered in a bottom `Sheet` from the hero's `Geldim`. This is a 1-field form, so a sheet is fine here (unlike the member form). Autofocus on open, so the numeric keyboard comes up immediately.
- Submit through a Server Action via `useActionState` (one call, low frequency). Pending: slots read-only + spinner. On error, clear the slots, refocus, and show the message in a `role="alert"` under the slots. Network failure (`fetch` throws inside the action call) → the spec's no-connection copy.
- Success: the sheet closes, the hero swaps to `YOKLAMAYA KATILDIN` from the action result, focus moves to the hero heading, and `navigator.vibrate?.(30)` gives feedback on Android.

### 3.2 QR landing `/yoklama/kod/[id]?c=`
- A server page, no client JS needed: `requireUser()` (the proxy already sends logged-out users to `/giris?next=…`, so the `?c=` survives; check that `safeNext` keeps the query). Check in on GET? **No**: a GET with side effects gets prefetched/repeated by link previews (WhatsApp unfurls the URL!). The page renders a one-button form `Yoklamaya katıl` that is already focused and posts the code. That's one extra tap, and much safer. If the PO insists on zero taps, auto-submit with a tiny client effect on mount (not on GET), still never on the server render.
- The code may expire between scan and login (> 60 s). The result page then offers the OTP input prefilled empty with copy `Kodun süresi doldu. Ekrandaki yeni kodu gir.`

## 4. Calendar and list

- **No calendar-grid component in Phase 2.** For a weekly choir a list grouped by week (`Bu hafta`, `Gelecek hafta`, then `13–19 Ekim`) is clearer on a phone and has no dependency. Row: date block (day number + short weekday), title/type, time range, location, `StatusPill` for my status, and `Senin partisyonun değil` for other sections' sectionals (muted, no actions).
- Dates/times via `lib/format.ts` formatters with `timeZone: "Europe/Istanbul"` only, server-rendered, so there's no hydration mismatch.
- Create/edit form: native `<input type="date">` and `<input type="time" step="300">` (iOS/Android native pickers, accessible, 0 KB). Type as `ChoiceGroup`, target parts as checkbox chips (shown only for `sectional`), `Her hafta tekrarla` as a `Switch`-style checkbox revealing `Son tarih` with `max` = +26 weeks. Live preview line under it: `Bu ayarla 9 çalışma oluşacak: 21 Ekim – 16 Aralık` (computed client-side with the same helper the server uses).
- `Geçmiş` tab: a server-rendered list with status pills and the gentle warning card on top (§3.4 copy).

## 5. Reports (`/raporlar`)

- Server component. Filters are links/`<select>` in a GET form (`?donem=<termId|90g>&uyari=1&sira=yuzde`), so state lives in the URL and the back button works. No client table state.
- **Desktop:** `Table` with sticky header and sticky first column, numeric columns right-aligned `tabular-nums`, sorting via column header links (`aria-sort` on the active `th`).
- **Mobile (<md):** a card list instead of a 7-column table: name + part badge, big `%`, a mini bar, and `G 12 · Geç 2 · M 1 · Yok 3`, plus the warning badge. Same data, no horizontal scrolling (AC 30).
- Per-part summary: 4 tiles with average % and a horizontal bar.
- **CSV** (`raporlar/csv/route.ts`, `requireManager()`): `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="devam-<donem-slug>.csv"; filename*=UTF-8''<encoded>`, `Cache-Control: no-store`. Body starts with BOM `﻿` (AC 27). **Delimiter `;`**: Excel with a Turkish locale uses `;` as the list separator (decimal separator is `,`), so a comma CSV opens as one column. Percentages as integers (no decimal-separator problem). Quote every field, double inner quotes, and prefix cells starting with `= + - @` with `'` (CSV injection: names are user input). The `CSV indir` link is a plain `<a href download>` (no JS). @po: AC 27 says "same columns"; with `;` it is still a valid CSV, so please confirm `;`.
- Data for table and CSV comes from the one TS aggregation helper db.md §3 proposes.

## 6. Charts (keep it light)

No chart library (Recharts ≈ 100 KB gz, and it's client-only). Three hand-rolled, server-rendered SVG/CSS pieces, all token-coloured and working in both themes:
1. **Attendance strip** (member history, member detail, report card): last N rehearsals as dots/squares coloured by status (`success` / `gold` for late / `muted` for excused / `destructive` for absent, plus **shape** differences for colour-blind users: filled / half / ring / ×). Container `role="img"` with an `aria-label` like `Son 8 çalışmadan 6'sına geldin, 1 geç, 1 mazeretli`.
2. **Bars** for per-part averages and the per-person %: a `div` with `width: %`, `aria-hidden` (the number is printed next to it).
3. **Turnout trend** on `/raporlar` (managers): a ≤ 40-point inline SVG polyline/column chart of per-rehearsal turnout %, about 30 lines of TSX, with a visually-hidden `<table>` fallback (or `<details>Tablo olarak göster</details>`) for screen readers.

If Phase 4+ needs real interactive charts, revisit (e.g. lazy-loaded `uplot`, MIT, about 45 KB).

## 7. Performance requirements

- Live screen client JS budget: **≤ 60 KB gz** on top of the framework/shared chunks (`qrcode.react` ~ 12 KB, our code ~ 15 KB). It's checked with `next build` output and Playwright `performance.getEntriesByType("resource")` on a production build. `input-otp` is loaded only inside the check-in sheet (`next/dynamic` on open), not on every home view.
- Live screen must stay smooth on a 2020 iPad: no `backdrop-blur` on that route (expensive on old GPUs), no full re-render per poll (memoised rows, state as `Map`), no layout animation on the roster.
- Poll payload ≤ 5 KB gz; requests are skipped while hidden.
- Calendar, history and reports pages ship **no extra client JS** beyond the shell (server-rendered; filters are links/forms).
- Add `(portal)/loading.tsx` (from the Phase 1 review) before this phase. Navigation into `/calismalar/[id]` and `/raporlar` must show a skeleton immediately.

## 8. Accessibility requirements (acceptance for my review)

- All targets ≥ 44 px (mark chips, filter chips, `Geldim`, sheet buttons). Body text ≥ 16 px in inputs (iOS zoom).
- Status is never colour-only: text label or shape plus colour; contrast ≥ 4.5:1 for pill text in both themes (reuse the `*-ink` approach for `late`/`excused`).
- Focus: visible 2px ring (Phase 1 P1-2). After a sheet closes, focus returns to the trigger. After check-in success, focus goes to the new hero heading. After the close dialog, focus goes to the closed-state banner.
- Live regions: the counter summary (`role="status"`), offline banner (`role="status"`, not `alert`, to avoid repeats), check-in errors (`role="alert"`). The rotating code is **not** live.
- Keyboard: the live roster works with Tab + arrow keys only (radio groups); `/` focuses the roster search on desktop (with a visible hint).
- `prefers-reduced-motion`: no countdown animation, no pulsing "YOKLAMA AÇIK" dot.
- Landscape and 200% zoom at 1024 px must not overlap code and roster (grid falls back to one column under ~900 px of available width).

## 9. Replies

**@po**
- §3.5 QR "log in and land back on the check-in": agreed, but **no side effects on GET** (link unfurlers in WhatsApp would check people in). One confirm tap on the landing page. If you need zero taps, I'll auto-submit from the client after load.
- §3.6 "Tapping the selected value again clears it": I'll give it an explicit `İşareti kaldır` button instead (radio semantics; toggling a selected radio is undiscoverable and breaks keyboard behaviour). Same outcome.
- §3.8 offline marks "memory only": agreed. A `beforeunload` warning covers "closing the tab loses them".
- AC 27: please accept `;` as the delimiter (Turkish Excel); see §5.
- Q8 IA: no frontend objection to `Çalışmalar`; `/yoklama` keeps redirecting.

**@dba**
- §1.5 "unmarking deletes the row": fine for the live poll. I'll send full snapshots (no `since` cursor), so deletes need no tombstone. Also fine with your §6 rule that members never poll.
- §6 `joined_at` on the member form: I'll add `Koroya katılış tarihi` (native `type="date"`, default today) to `MemberForm`.
- §5 exposure: the live page loader is the only place that selects `codeSecret`. It's passed to `<LiveScreen>` as a prop (it has to reach the manager's browser), and never through a layout or shared DTO.

**@backend** (ahead of `backend.md`)
- I need: `lib/attendance/totp.ts` (isomorphic), `GET …/canli` (full snapshot + `serverNow`), `POST …/isaret` (batch, per-item result, idempotent), Server Actions for open/close/bulk/excuse/check-in that return the new state rather than relying only on `revalidatePath`.
- Route Handlers must call `requireManager()` themselves. The proxy only does an optimistic cookie check.

**@ux** (ahead of `ux.md`): open points I'd like your call on: QR plate always white in dark mode (I recommend yes); mark chip labels under 360 px; whether the live screen hides the portal chrome entirely (I recommend yes, with an `Çık` button).
