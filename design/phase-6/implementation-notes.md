# Phase 6 implementation notes

## WP6–8 (UI)

Author: UI engineer. Brand geometry, logo, icons, brand colours, staff motif, eyebrows (AC 1–8, D1–D10).

### Files
- `brand/fonts/Jost[wght].ttf` + `brand/fonts/OFL.txt`: from `github.com/google/fonts/ofl/jost` (SIL OFL 1.1). Dev-only input to the generator; never served.
- `src/lib/brand/logo-geometry.ts`: pure geometry (ux §1.2 coordinates, band clipping per ux §1.1, `cut` as a parameter, the R bowl band pitch follows `cut`). Exports `WORDMARK_PATH` (cut 0.4), `WORDMARK_PATH_SMALL` (cut 0.8), `MONOGRAM_PATH` (full 5/4/4, cut 0.4), `MONOGRAM_PATH_SMALL` (2 bands, cut 1.6 ≈ 1 device px at 24 px tall, for the install-card and other sub-32 px tiles), `letterA(counts, cut)` and the boxes (wordmark 358×79, lockup 358×107, monogram 80×79).
- `src/lib/brand/logo-geometry.generated.ts`: `SUBTITLE_PATH` (Jost 600 outlines, cap 7.5, baseline 102.5, ink-justified 0 → 357.5, letter gap 10.56, word gap +13.2). Generated, don't edit.
- `src/lib/brand/colors.ts`: the only hex source (`stage #26214e`, `stageDark #1a1436`, `stageForeground #f9f5ec`, `background #f9f6f1`, `backgroundDark #0d0b19`). WP9 can add the offline-page muted/foreground values here.
- `src/components/arkhe-logo.tsx`: `ArkheWordmark` (`density="regular" | "small"`), `ArkheLockup`, new `ArkheMonogram` (`density` picks the 2-band small variant). One `<svg role="img" fill="currentColor">` with one `<path>`; no mask, no `useId`, no text. Labels: lockup `Arkhe Mülkiye Çoksesli Korosu`, others `Arkhe`.
- `scripts/brand-assets.ts` (replaces `brand-assets.mjs`), `npm run brand:assets`: writes the generated subtitle, the six standalone SVGs, all icons, and the existing photo crops (unchanged). devDependencies added: `sharp` (explicit, was transitive), `fontkit`, `@types/fontkit`.

### Call sites (D4)
Mobile header `ArkheWordmark h-5 density="small"` → 90.6 × 20 px. Sidebar `ArkheLockup w-44` → 176 × 52.6. Login band `w-48` → 192 px; login panel md+ `w-64` → 256 px. Measured in Chrome, light and dark.

### Icons (D7–D9)
| File | Variant | cut | Mark / canvas | Background |
|---|---|---|---|---|
| `public/icons/icon-512.png` | full | 0.4 | 0.58 | stage tile rx 22 % on transparent |
| `public/icons/icon-192.png` | full | 0.7 | 0.58 | same |
| `public/icons/icon-maskable-512.png` | full | 0.4 | 0.52 | stage full bleed |
| `src/app/apple-icon.png` (180) | full | 0.7 | 0.56 | stage full bleed, RGB (no alpha) |
| `src/app/favicon.ico` 32 | 2 bands | 1 px | 0.72 | stage tile |
| `src/app/favicon.ico` 16 | solid | 0 | 0.75 | stage tile |
| `src/app/icon.svg` | 2 bands (32-px geometry) | 1 px | 0.72 | light: stage tile; dark: no tile (`@media (prefers-color-scheme: dark)` inside the SVG) |

All marks are centred and nudged down 1 % of the canvas. The ICO container (PNG-in-ICO) is written by hand, no dependency. Maskable assert in the generator: farthest point 192.5 px from the centre, limit `0.4 × 512 − 8 = 196.8` (passes; the 1 % nudge eats about 4 px of ux's 16 px margin). Next emits `favicon.ico`, `icon.svg?…` and `apple-icon.png?…` links; all three return 200 with the right type.

`viewport.themeColor` now reads `brandColors.background` / `backgroundDark` (`#f9f6f1` / `#0d0b19`).

### Overlay gate (AC 1)
Script and images in the scratchpad (`wp6/gate.mts`, `wp6/overlay-wordmark.png`, `wp6/overlay-lockup-50.png`). Wordmark rendered white on black at 447 px at the source origin, binarised at 128, compared within the wordmark rows (y 160–260):
- **IoU 0.951** (gate ≥ 0.90).
- **Max edge deviation 2 px** (distance from every mismatched pixel to the other mask; gate ≤ 3). Per-letter boxes differ by ≤ 1 px.
- Counts as drawn: 3 hairlines / 4 bands per stroke, A left leg 4 / 5; flat A top 20 units; E bottom arm end hairline at 353.
- Subtitle at Jost 600 is not heavier than the original in the 8× crop, so no step down to 500.

### Staff motif and eyebrows (AC 4, 6)
- `.staff-lines` is now `repeating-linear-gradient(var(--staff-line) 0 1px, transparent 1px 4px)` in a 17 px no-repeat band at `0 calc(100% - 28px)`; opacity tokens unchanged. Measured pixel rows: lines every 4 px at 1× and every 8 device px at 2×, each exactly 1 CSS px, uniform, no moiré, so the 4 px pitch stays.
- `ComingSoon` is no longer used by any route, so the gate screenshots inject the same markup (a dashed empty card and an `.on-stage` card) into `/profil`.
- Eyebrows: every `tracking-[0.14em]` uppercase eyebrow moved to `tracking-[0.2em]` (`(portal)/page.tsx`, `raporlar`, `calismalar`, `calismalar/[id]`, `marking-roster.tsx`). No `0.14em` left in `src/`.

### Notes for later packages
- Turbopack in the running dev server didn't pick up a `touch`-only change to `globals.css`; a real content edit did. If a CSS change looks stale in e2e, re-save the file.
- At 1× DPR the sidebar subtitle cap is 3.7 px: legible as texture, readable at 2×. It meets the 160 px floor; ux may want to judge it in review.

## WP9 (UI)

Author: UI engineer. PWA (AC 9–18, D11–D19).

### Files
- `src/app/manifest.ts`: fields exactly as AC 9; colours from `brandColors` (`theme_color #26214e`, `background_color #0d0b19`); icons 192/512 `any` + maskable 512; shortcuts `Yoklama` → `/yoklama`, `Ödevlerim` → `/odevler`, each with the 192 icon. Served as `/manifest.webmanifest` (`application/manifest+json`), `<link rel="manifest">` is emitted.
- `src/proxy.ts`: **matcher only**; adds `icons/`, `sw\.js$`, `offline\.html$` to the exclusions (the manifest, `.png`, `.svg`, `.ico` were already excluded). Backend can add the nonce CSP inside `proxy()` without touching the matcher.
- `src/lib/pwa-store.ts`: tiny external store (deferred `beforeinstallprompt`, status `idle | dismissed | installed`).
- `src/components/pwa-boot.tsx`: client, renders `null`, mounted once in `src/app/layout.tsx` after `<Toaster>`. Listens to `beforeinstallprompt` (`preventDefault` + store) and `appinstalled` on every page; registers `/sw.js` with `{ scope: "/", updateViaCache: "none" }` only when `NODE_ENV === "production"` (inlined at build, so the dev bundle never registers).
- `src/components/install-card.tsx`: `useSyncExternalStore` with server snapshot `hidden`, so nothing renders on the server or in standalone. States and copy exactly per D12; button `h-11 w-full rounded-full` with `SquarePlus` (44 px measured); iOS text with the `Share` icon after `Paylaş` (innerText reads with single spaces); installed state with `CircleCheck text-present`; `userChoice` dismissed falls back to the generic text. `section aria-labelledby` + `h2`, `data-testid="install-card"`. Placed in `profil/page.tsx` directly above `<MyDuesSection />` (`Aidatım`).
- `public/sw.js`: hand-written, no imports. `VERSION = "arkhe-v1"`, `KILL = false`. Order: non-GET → cross-origin → navigation (network, offline page on failure, never stored) → `/api/`, `_rsc`, `RSC`, any `next-router-*` header → `/_next/static/` cache-first → un-hashed allow-list (`/brand/`, `/icons/`, `favicon.ico`, `icon.svg`, `apple-icon.png`, manifest, offline page) stale-while-revalidate → everything else untouched. Put guard: `ok`, `basic`, no `Set-Cookie`, no `private|no-store`. Cap 200 entries, oldest evicted first, precached entries never evicted. Precache `/offline.html`, `/icons/icon-192.png`, `/manifest.webmanifest` with `{ cache: "reload", redirect: "error", credentials: "omit" }`; a non-ok response fails the install.
- `scripts/offline.template.html` → `public/offline.html` (written by `npm run brand:assets`; placeholders filled from `brandColors` and the monogram path, full count, cut 0.7; an unknown placeholder fails the script). Layout per ux §5, system sans, no JS, `<title>Çevrimdışı · Arkhe</title>`.
- `src/lib/brand/colors.ts`: added the measured hex for light/dark `--foreground`, `--muted-foreground` and `--primary`/`--primary-foreground` (dark primary is the gold) for the offline page.
- `next.config.ts`: two entries after the `/:path*` one (later entries override the same key; verified, only one CSP is sent): `/sw.js` → `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Type: application/javascript; charset=utf-8`, `Content-Security-Policy: default-src 'self'; script-src 'self'`; `/offline.html` → `Cache-Control: no-cache` (so the worker may store it) and the D18 CSP.

### Update path (AC 18)
`sw.js` is `no-store` and registered with `updateViaCache: "none"`, so the browser byte-compares it on every navigation. A changed file installs, calls `skipWaiting()`, and on activate deletes every cache that isn't the new `VERSION`, then `clients.claim()`. Open tabs keep their loaded JS; their next navigation is fresh HTML from the network that references the new hashed chunks, fetched and cached on demand. This is safe only because no HTML is ever cached; reject any change that caches navigations. Bump `VERSION` on every `sw.js` change.

**Kill switch:** set `KILL = true` in `public/sw.js` and deploy. On the next navigation each client installs it, which deletes every cache, unregisters, and reloads open windows; the fetch handler does nothing meanwhile.

### Verified (dev server, real Chrome, 375 px, light and dark)
- `/sw.js`, `/offline.html`, `/manifest.webmanifest`, `/icons/*` return 200 without a cookie, no redirect, with the headers above.
- Install card: generic text in a default context, iOS text with an iPhone UA, prompt state via a dispatched `beforeinstallprompt`, installed state after an accepted `userChoice`; the card sits above `Aidatım`; no console errors.
- **Standalone:** Chrome 155 headless accepts CDP `Emulation.setEmulatedMedia` with `display-mode: standalone` but **does not apply it** (`matchMedia` still reports `browser`). Per D13 fallback: checked by stubbing `matchMedia("(display-mode: standalone)")` and, separately, `navigator.standalone = true` in an init script; the card is not rendered in either case and `Aidatım` still renders. The dev e2e for D13 should use the same init-script stub, not CDP.
- Service worker smoke (registered by hand in a throwaway incognito dev context): controls the page; after visiting `/`, `/profil`, `/odevler`, `/repertuvar`, the cache held 39 entries, all allow-listed, none a page, `/api/` or `_rsc`; `setOffline(true)` + navigating to `/uyeler` served `Bağlantı yok` (`Çevrimdışı · Arkhe`). So Playwright's offline emulation does cover SW fetches in this Chrome.
- Offline page at 375 and 320: no horizontal scroll, button 48 px, visible focus ring, no console/CSP errors.

### Deviation
- The offline footer stave uses `--fg` at 12 % rather than the 6 % `--staff-line`: on a 17 px strip at 22rem the 6 % lines were invisible. It's a static page with no shared token.

## WP1–3 (DBA)

Author: DBA. Guards (AC 25 / D25), restorable backup and `db:check` (D35 / AC 39), migration 0006 and the finance carry-forward (AC 31–33, 35 / D31–D34).

### WP1: fixture guards
- New `scripts/fixture-guard.mjs` `assertFixtureTarget(client)`: throws when `NODE_ENV=production`, when `DATABASE_URL` is set and not `file:`, or when `client.protocol` isn't `file`. First statement of `seedFinance` and `seedHomework`; `seed.ts` calls it on `db.$client` right after `createDb()` (its own URL/`NODE_ENV` check stays in front).
- `scripts/assert-local-db.mjs` (db:reset): refuses `NODE_ENV=production`, and any `DATABASE_URL` other than unset or exactly `file:data/arkhe.db` (the `rm` is hard-coded to that file).
- `e2e/lib.mjs`: throws at import on a non-`file:` DB URL and on an `E2E_BASE_URL` that isn't `http://127.0.0.1[:port]` or `http://localhost[:port]`.
- Verified by hand (dev server running), all exit/reject as expected and the dev DB untouched (row counts users/finance_entries/dues_overrides/assignments/submissions `24|45|1|6|20` and `arkhe.db` mtime identical before and after):
  - `assert-local-db`: `NODE_ENV=production` → 1; `libsql://guard.invalid` → 1; `file:data/e2e-prod.db` → 1; unset and `file:data/arkhe.db` → 0.
  - `npx tsx scripts/seed.ts` with `NODE_ENV=production` → 1; with `DATABASE_URL=libsql://guard.invalid` → 1.
  - `npm run db:reset` with `NODE_ENV=production` → 1; with `libsql://guard.invalid` → 1 (stops before `rm`).
  - In-process `seedFinance` / `seedHomework`: rejected under `NODE_ENV=production`, with a `libsql://` client, and with a `libsql://` env URL.
  - `import("e2e/lib.mjs")` with a `libsql://` URL or `E2E_BASE_URL=https://arkhe.example.org` → throws.
- The AC 25 e2e test is **not** written (WP11, per D25).

### WP2: `db:backup` and `db:check`
- `scripts/db-backup.ts`: excludes only `sqlite_%`, `libsql_%`, `_litestream%` tables, so `__drizzle_migrations` is kept; emits every index/trigger/view `CREATE` after all INSERTs inside the same `PRAGMA foreign_keys=OFF; BEGIN; … COMMIT;`; prints a per-table row count; output stays under `data/backups/`. `sqlite_sequence` is skipped on purpose (SQLite rebuilds it from the restored rows).
- `scripts/db-check.ts`: now prints `foreign_keys=1, orphaned rows=0, migrations=N/N, quick_check=ok`. Fails on: FK off, orphans, fewer `__drizzle_migrations` rows than `drizzle/meta/_journal.json` entries (missing table counts as 0), `quick_check` ≠ `ok` (file only), `@arkhe.local` users present (non-`file:` only). The demo-account branch is checked by code reading only (no Turso account).
- Restore drill (scratchpad, before 0006): backup `data/backups/2026-10-19T12-22-53-359Z.sql` restored both with `sqlite3 r.db < file` and with libSQL `executeMultiple` → 31 indexes (= live), 6 migration rows, 24 users, `sqlite_master` identical to the live DB, `db:check` exit 0 with `migrations=6/6`, and `drizzle-kit migrate` on the restored copy applied nothing.

### WP3: migration 0006 and finance
- `src/db/schema.ts`: `fe_payment_group_idx` on `payment_group_id where payment_group_id is not null`; one-line comment on `duesOverrides` that `created_*` = last written.
- `drizzle/0006_phase6_payment_group.sql`: generated without a prompt (no `__new_`, one `CREATE INDEX`); the orphan-freeze `DELETE` from db §3.2 appended after a breakpoint. Rehearsed on the restored scratch copy first (7/7, 32 indexes; the `DELETE` removed a planted orphan freeze and kept a freeze with a live payment; `EXPLAIN` uses `fe_payment_group_idx`). Then `npm run db:migrate` on the dev DB: pre-migration backup `data/backups/2026-10-19T12-23-44-010Z.sql` (now restorable), `migrations=7/7`, 32 indexes, 0 freezes deleted.
- New `src/lib/finance/guard.ts` (`FieldError`, `guarded`), moved out of `finans/actions.ts`.
- `finans/actions.ts`: `voidEntry` runs in `writeTx` inside `guarded`; after the void a dues entry deletes the member/period `freeze` only when no live dues entry remains (`notExists`, same transaction). Lookup for the error message uses `tx`. `updateEntryMeta`: read, event check (now a `FieldError`) and the revisioned update in one `writeTx` inside `guarded`. `correctEntry` unchanged (never cleans up). The delete's SQL was checked by hand on the scratch DB (0 rows while a payment is live, 1 after all are voided).
- `finans/aidat/actions.ts`: ids `derivedId(clientId, memberId, periodId)`, group `derivedId(clientId, memberId, "group")` for > 1 period; replay returns `STALE` unless every existing row has the same `memberId` and `createdBy === actor`. `guarded` wraps `recordDuesPayment`, `createDuesPeriod`, `updateDuesPeriod`, `bulkCreateDuesPeriods`, `setDuesRate`, `setWaiver`; `bulkCreateDuesPeriods` uses `writeTx` (`BulkError` caught inside, so it isn't retried as BUSY); `removeWaiver` also goes through `writeTx`; `deleteDuesPeriod` uses `constraintKind(error) === "fk"`. `setWaiver` upsert sets `createdAt: now()`. No direct `db` write is left in that file.
- `src/lib/finance/dates.ts`: `monthRange` / `yearRange` (regex-validated, string-only, `[from, to)`). `queries.ts` uses them via a local `inRange()` in `monthSummary`, `listEntries`, `categoryTotals`, `listSponsors`. **Deviation from db §3.3:** an invalid month/year makes the aggregate match nothing (`sql\`0\``) instead of dropping the filter, because dropping it on `monthSummary`/`categoryTotals` would show all-time totals under a month label. `listEntries` still drops an invalid month (the param parser already does). All current callers pass valid values. `getEntry` runs its three follow-ups with `Promise.all`.
- `e2e/phase5-finance.mjs` AC14: group id and entry ids now expect `derivedId(clientId, koristId, …)`; the group check covers both rows.

### Runs
- `npm run lint`, `npm run typecheck`: clean.
- `npm run e2e`: 4 full runs. Every WP1–3 related check passed in each run that reached it. Last run **439/440**; the one failure is `AC22 Aidatım is the first section on /profil` (phase 5), caused by WP9's `InstallCard` now sitting above `Aidatım` per D11, not by WP1–3; that assertion needs updating with WP9/WP11. Two earlier full runs failed `AC10 every manager action refuses a member` (phase 4, untouched code): the homework action ids were missing from `.next/dev/server/server-reference-manifest.json` while teammates' edits (layout, proxy, next.config) made Turbopack recompile mid-run; phase 4 alone passed 112/112 and the last full run passed it. One run timed out on the AC14 payment sheet for the same reason; phase 5 alone passed AC14.

## WP4–5 (backend)

Author: backend. `Son değişiklik` (AC 30 / D30) and the security core (AC 19, 21–24, 26–29 / D20–D29).

### WP4: Son değişiklik
- `src/lib/time.ts`: `formatAuditDate(at)` → `19 Eki 2026` (tr-TR, Europe/Istanbul).
- `src/lib/finance/queries.ts`: `duesAuditOf(userId)`: `requireManager()` inside, uuid check, `member_dues.updated_*` and the member's `waiver` rows from `dues_overrides.created_*`, each left-joined to the editor; returns finished strings only (`rate`, `waivers: Map<periodId, string>`), `silinmiş üye` when the editor is gone. `duesMatrix` and `myDues` untouched.
- `finans/aidat/page.tsx`: fetched with `memberPayments` (`Promise.all`) only when a sheet is open, passed as strings to `RateForm` / `WaiverForm`.
- `member-dues-forms.tsx`: `AuditLine` (`History` `size-3.5`, `text-xs text-muted-foreground`, `items-start` + `mt-0.5`), `data-testid="rate-audit"` under the rate hint and `"waiver-audit"` under the waiver reason. Note: `ChoiceChips` replaces its hint with the field error, so the rate line hides while `rate` shows an error.
- Checked by hand: own rate → `Son değişiklik: Demo Yönetim · 19 Eki 2026`; waiver line the same; korist's `/profil` and `/finans` HTML and the dues CSV contain no `Son değişiklik`.

### WP5: security core
- `src/lib/auth/cookie-names.ts` (plain module): `secureCookies`, `SESSION_COOKIE`, `isRefusedDemoEmail()`. `session.ts` imports it; the proxy checks only `SESSION_COOKIE`.
- `src/proxy.ts`: nonce (16 random bytes, base64) and the D20 policy per request; request headers `x-nonce` and `content-security-policy` always overwritten and `content-security-policy-report-only` deleted (Next falls back to it for the nonce); redirects carry no CSP; matcher unchanged from WP9. `'unsafe-eval'` only when `NODE_ENV === "development"`.
- `src/app/layout.tsx`: `await connection()`. `next build` route table: every HTML route `ƒ`; only `apple-icon.png`, `icon.svg`, `manifest.webmanifest` are `○`.
- `next.config.ts`: global CSP removed (the proxy owns it); COOP `same-origin`; `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`; HSTS unless `NODE_ENV === "development"`; WP9's `/sw.js` and `/offline.html` entries kept.
- Flash: `src/lib/flash.ts` key map (`kayit-duzeltildi`) read with `Object.hasOwn`, `Secure` in production; `setFlash` takes a `FlashKey`. `flash-toast.tsx` clears with `SameSite=Lax` and `; Secure` on `https:`. `arkhe_fin_hesap` gets `secure` in production.
- Demo accounts: `login()` folds `isRefusedDemoEmail(email)` into the generic failure branch (same timing, attempt counted); `getSessionUser()` returns null for `@arkhe.local` in production; `create-admin` refuses `@arkhe.local` on a non-`file:` URL or under `NODE_ENV=production`.
- `src/lib/env.ts` (pure `envProblems`, `bootWarnings`), `src/instrumentation.ts` → `src/lib/boot-check.ts` (node only, skipped in dev and during `phase-production-build`).
- `TRUST_PROXY_HEADERS=1`: the IP must match `/^[0-9a-fA-F:.]{2,45}$/`, else per-email buckets only; any value other than unset/`""`/`1` fails boot.
- `src/lib/text.ts` `cleanText`/`cleanLine`, applied with `.overwrite()` before `trim`/`min`: `optionalText` (so finance `text()` too; the old `clean` is gone), `nameSchema`, `voidReason`, waiver reason, period name, event and sponsor names, payment info, piece title, bulk link label, term name.
- Dates: `boundedDayField` (2000-01-01 … Istanbul today + 730, computed per call) on period `startsOn/endsOn/dueOn`; bulk `fromMonth/toMonth` with the same message; `openingDayField` = bounded + the today + 31 cap (the opening previously had no cap at all, only `dayField`). Zero opening (`0`, `0,00`, `0.00`) = none.
- `GET /api/saglik`: `select 1` raced against 3 s, `no-store`, `{"ok":true}` / 503 `{"ok":false}`, details only in the server log.
- `e2e/lib.mjs`: `newPage()` adds a `securitypolicyviolation` listener (init script + `exposeBinding`) and catches console `Refused to … Content Security Policy`; any entry in `cspViolations` fails `summary()`. Verified to fire on an injected cross-origin `<img>`.

### Deviation: env check exits explicitly
backend §3.3 / D27 said a throw in `register()` exits 1 under `next start`. **Not true in 16.4.2:** `NextNodeServer` calls `prepare().catch(console.error)`, so the server logged `Failed to prepare server` and kept running (verified: still up after 15 s). `boot-check.ts` therefore prints `Invalid environment:` + the list and calls `process.exit(1)`. It lives in its own module behind `if (NEXT_RUNTIME === "nodejs")` because `process.exit` directly in `instrumentation.ts` triggers Turbopack's Edge-runtime warning. Verified: `APP_URL=http://example.org TRUST_PROXY_HEADERS=true` → exit 1 after 1 s with both messages on stderr.

### Prod-mode check (scratch, `next build` + `next start -p 3102` on a throwaway copy of the dev DB, stopped and deleted afterwards)
- Good env prints `TRUST_PROXY_HEADERS is not set; per-IP login limits are off.`; `/api/saglik` → `{"ok":true}`; CSP without `unsafe-eval`; HSTS, COOP, Permissions-Policy present.
- `korist@arkhe.local` login → `E-posta ya da şifre hatalı.`; a hand-inserted live session row for korist → 307 to `/giris`, the same for a non-demo user → 200.
- Login POST `Set-Cookie`: `__Host-arkhe_session=…; Path=/; Expires=…; Secure; HttpOnly; SameSite=lax` on `127.0.0.1` (stored; no need for the `localhost` fallback).
- 14 pages walked as a board user plus a 404: zero CSP violations; the service worker registers (worker-src works).
- Spoofed request `content-security-policy`/`x-nonce` headers are ignored (own nonce in the HTML and header).

### Dev server note
After `next.config.ts` changed, the dev server restarted into a Turbopack state where every page reloaded in a loop (`reloadPage: HMR hash mismatch`, the entry chunk list naming an HMR chunk the HTML didn't load); not caused by the CSP (it looped with the proxy reduced to `NextResponse.next()`). The next automatic restart (triggered by adding `instrumentation.ts`) cleared it. If e2e times out on `/giris` with "navigated to /giris" repeating, that is this; restart the dev server.

### Runs
- `npm run lint`, `npm run typecheck`: clean.
- `npm run e2e`: last full run **440/440**, zero CSP violations, zero console errors. Earlier runs: one with the known phase 4 `AC10 every manager action refuses a member` flake (phase 4 alone 112/112), one 440/440 with a single unattributed React hydration-attribute warning that did not recur in the next run.

## WP13 (backend): deploy package

- `.env.example`: `APP_URL`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `TRUST_PROXY_HEADERS` with production value shapes; platform-set names (`NODE_ENV`, `VERCEL`, `RENDER`, `NEXT_RUNTIME`, `NEXT_PHASE`) in a comment; `# e2e only` block with `E2E_BASE_URL` / `E2E_SHOTS` **commented out**, because an empty `E2E_BASE_URL=` copied into `.env` would override the default and fail the loopback guard. Every `process.env.*` name in `src/`, `scripts/`, `e2e/` appears in the file.
- `README.md`: local setup (the old `db:push` line was wrong; now `db:reset`), command table, "Deploy (Vercel Hobby + Turso)" checklist steps 1–9 (db §7.4 text for migrate/verify/backup/restore drill/restore-to-new-Turso-DB/rollback), SW kill switch, free-tier limits with "re-read terms before go-live" and the Hobby non-commercial note, Render free fallback (build/start commands, `TRUST_PROXY_HEADERS` unset, cold start), and the consolidated real-phone checklist (Phase 3 Drive/YouTube preview, Phase 4 mailto + overdue badge contrast, Phase 5 decimal input, CSVs in Excel/LibreOffice, `text-absent-ink` on stage, Phase 6 install + offline + logout-offline, plus QR scan/wake lock, demo refusal and invite on the live site). Free-tier figures are named by category, not number, since they can't be verified without accounts.
- `package.json`: `"engines": { "node": ">=20.9" }`; `"e2e:prod": "node e2e/prod.mjs"` (deliberately without `--env-file`: the script sets every variable itself, and a developer's `.env` must not leak into the production child).

### SW update path (AC 18)
As recorded under WP9: `sw.js` is `no-store` + `updateViaCache: "none"`, so every navigation byte-compares it; a changed worker `skipWaiting()`s, deletes caches other than `VERSION` and `clients.claim()`s. Safe only because no HTML is ever cached. Kill switch: `KILL = true` (README step 9).

### Env check deviation (D27)
See WP4–5: a throw in `register()` is only logged by `next start` 16.4.2, so `src/lib/boot-check.ts` exits with code 1 after printing every problem.

### Build route sizes
`next build` (16.4.2, Turbopack) no longer prints sizes; every HTML route is `ƒ`, only `apple-icon.png`, `icon.svg`, `manifest.webmanifest` are `○`. First-load client JS per route, gzipped, measured from `build-manifest.json` `rootMainFiles` + each route's `entryJSFiles` (scratch script `wp5/sizes.mjs`): shared 129.6 kB; largest `/repertuvar/[id]/duzenle` 255.6, `/odevler/[id]` 252.0, `/repertuvar/[id]` 232.5, `/` 225.0, `/finans/aidat` 223.6, `/calismalar/[id]/canli` 219.0; most finance and form pages 175–205; `/giris` 173.5, `/yoklama` 172.4, `/_not-found` 148.3.

## WP12 (backend): `npm run e2e:prod` (written, not yet run)

`e2e/prod.mjs`, order:
1. Deletes `data/e2e-prod.db*` and sets `DATABASE_URL=file:<abs>/data/e2e-prod.db`, `E2E_BASE_URL=http://127.0.0.1:3101` **before** importing `lib.mjs`; refuses to run with `NODE_ENV=production` (only the server child gets it). Never calls `cleanup()`.
2. `next build` (`NODE_ENV=production`, `APP_URL` = 3101).
3. `drizzle-kit migrate` + `db-check` + `seed.ts` on the throwaway DB (children without `NODE_ENV`, `DATABASE_AUTH_TOKEN`, `TRUST_PROXY_HEADERS`); `yk@arkhe.local` renamed to `e2e-yk@example.org`; `create-admin "E2E Admin" admin@e2e-prod.test` → invite link parsed.
4. AC 27: `next start` on 3102 with `APP_URL=http://example.org` → exit ≠ 0 within 15 s, `APP_URL` in stderr.
5. `next start` on 3101, readiness via `/api/saglik`; AC 26 boot warning in its output; AC 29 body and `no-store`.
6. Incognito contexts: invite completes on the prod build (README step 4); AC 24 `korist@arkhe.local` refused; AC 21 headers (HSTS, nosniff, DENY, no-referrer, COOP, `camera=()`, no `X-Powered-By`); AC 19 on `/giris` (raw HTML: every `<script>` has the header nonce; strict-dynamic, no unsafe-inline/eval; two requests, two nonces).
7. Persistent Chrome profile (`launchPersistent()` in `lib.mjs`, temp dir under `os.tmpdir()`), 375×812: AC 11 on `/giris` (logged out) and `/`; AC 22 `__Host-arkhe_session` flags from `headersArray()` of the login POST; AC 19 on `/` and the live screen; AC 22 flash cookie `Secure` via a real `Düzelt` (key `kayit-duzeltildi`); SW controls the page; AC 15 walk (`/`, `/finans`, `/finans/aidat`, `/odevler`, `/uyeler`, `/profil`, a member, plus `/yoklama`, live screen, a repertoire detail with a Drive link for AC 20) and the cache audit against the allow-list; AC 20 zero violations.
8. AC 16–17 last: a second incognito session logs in, gets the worker, logs out; both go offline via `setOffline`; if `/repertuvar` doesn't show `Çevrimdışı · Arkhe`, both go back online and the server is stopped, then retried (path logged). Light and dark, no horizontal scroll; the logged-out session gets the offline page for `/finans`.
9. `finally`: close browsers, stop the server (SIGTERM, SIGKILL after 5 s), close the DB client, delete `data/e2e-prod.db*` and the profile dir. `.next/` stays.

`lib.mjs`: `watchCsp` and new `watchConsole` exported (`newPage` uses both, behaviour unchanged), `launchPersistent(dir, options)`, and `ERR_CONNECTION_REFUSED` added to the expected console noise for the stopped-server offline path.

## WP10–11 (UI)

Author: UI engineer. Polish (AC 36, D38) and the Phase 6 dev e2e.

### WP10: polish
- **ux P3-1** `entry-row.tsx`: a dues entry without a description is titled by the member (`rowTitle`); its detail line becomes `Aidat · Ekim 2026`. `entryTitle` (detail page, Düzelt summary) is unchanged.
- **ux P3-5** `my-dues.tsx`: `Nasıl ödenir?` is hidden when the member is exempt and `remaining === 0`.
- **ux P3-6** `period-forms.tsx`: a `locked` period (has payments) renders the trash as `aria-disabled="true"` with `title` and `sr-only` text `Ödemesi olan dönem silinemez`, no click handler; the server refusal is unchanged. `phase5-finance.mjs` AC17 now asserts the disabled trash (force-click opens no dialog) instead of the post-confirm toast.
- **ui P3-1** `hareketler/page.tsx`: the disabled `Sonraki ay` span gets `role="link"` (+ `aria-hidden` icon); axe no longer reports `aria-prohibited-attr`.
- **ui P3-4** `globals.css`: `--present-foreground`, `--excused-foreground`, `--absent-foreground` (light `oklch(0.99 0 0)`, dark `var(--background)`) mapped to `text-*-foreground`; used by `dues-chip.tsx`, `deadline-chip.tsx` and the `solid` variants in `labels.ts`. No `text-white` left outside `components/ui`. Note: the dark `solid` marking chips in `marking-roster.tsx` now use dark text on the light fills (better contrast than the old white).
- **ui P3-2** `entry-form.tsx`: sticky bar `bottom-[calc(env(safe-area-inset-bottom)+4.3rem)]` with `pb-3`; it tucks ≈ 0.7 px under the tab bar (z-40), so no strip shows (the review's `4.375rem` left 0.5 px at 375).
- **Could, ux P3-2**: `ChoiceChips` and `ChoiceGroup` show a leading `Check` (`hidden group-has-checked:inline`) on the selected chip.
- **Could, ux P3-4**: bulk preview reads `Kasım 2026 · son ödeme 15 Kas`; a day outside 1–28 is shown as typed (the server still refuses it).
- devDependency `axe-core` (MPL-2.0, was transitive via eslint-plugin-jsx-a11y) for the AC 36 axe check.

### WP11: dev e2e (all at 375×812 via `newPage(browser, { phone: true, context })`)
`e2e/lib.mjs` `newPage` gains `phone` (375×812, DPR 2, touch) and `context` (extra context options such as `colorScheme`, `userAgent`); existing calls are unchanged.
- `phase6-a-brand.mjs` (24): AC 2, 3 (light and dark; header 90.6×20, sidebar 176 px), 5, 7 (icon.svg dark switch), 8 (hrefs read from the HTML; PNG IHDR sizes; apple colour type 2), 9, 10, 13 (sw.js headers), 16 (offline.html copy), 12 (generic text directly above `Aidatım` in both themes; iPhone UA → iOS text; dispatched `beforeinstallprompt` → 44 px button → `Eklendi.`; standalone via an init-script `matchMedia` stub, since this Chrome ignores CDP `display-mode`).
- `phase6-b-security.mjs` (13): AC 19 (raw HTML of `/giris`, `/`, `/calismalar/<id>/canli`; every `<script>` carries the header nonce; two requests differ; `strict-dynamic`, no `unsafe-inline`), AC 20 (korist: check-in by code, Drive preview iframe, home, odevler, profil; şef: live screen with QR; yk: home, finans, aidat, profil; zero new violations), AC 23 (`<b>Hacked</b>` and `constructor`), AC 26 (six spoofed `X-Forwarded-For`/`X-Real-IP` → only `email|?` bucket, locked), AC 29, AC 39 (`db:backup` → `executeMultiple` restore into `os.tmpdir()` → same index count as the source (53 incl. autoindexes), 7/7 migration rows, `db:check` exit 0 `migrations=7/7`; scratch DB and the backup file deleted).
- `phase6-c-finance.mjs` (27): AC 30 (rate and waiver lines `Son değişiklik: Demo Yönetim · <today>`, korist sees none, CSV has no `Son değişiklik` and the editor's name only as their own member row), AC 28 (waiver reason with U+202E/U+202C stored clean; opening `1999-12-31` refused), AC 31 (a rate change mid-payment freezes ₺300 → voiding the only payment deletes the freeze → korist owes ₺150 → re-pay settles; and two partials + rate change + void one → freeze stays ₺300), AC 32 (korist's client id injected into Kaan's sheet: both two-period payments stored in separate groups; each `Aynı ödemede` lists only its own periods), AC 36 (dues row titled by name; axe on `/finans/aidat` and `/finans/hareketler`: no `aria-prohibited-attr`; disabled trash; bulk preview month; check icon; sticky bar meets the tab bar; overdue chip token in both themes; exempt Barış has no `Nasıl ödenir?`). Resets finance with `seedFinance` around each scenario and at the end.
- `phase6-z-guards.mjs` (9), last file in the run: AC 25. Guarded commands only ever point at a throwaway `os.tmpdir()` file or `libsql://guard.invalid`, never the dev DB: `seed.ts` (production / remote) exits ≠ 0; `assert-local-db.mjs` (db:reset's guard) refuses production, remote and any other file (the `rm` in `db:reset` is never executed by the test; a static check asserts the guard runs first); `import("e2e/lib.mjs")` with a remote URL fails; in-process `seedFinance`/`seedHomework` reject with the guard's own message under `NODE_ENV=production` and with a remote client; the throwaway DB has no tables; `data/arkhe.db` row counts (users, finance_entries, dues_overrides, assignments, submissions) and mtime are identical before and after.

### Runs
- `npm run lint`, `npm run typecheck`: clean.
- `npm run e2e`: **513/513** (phase 1: 18, 2: 91, 3: 101, 4: 112, 5: 118, 6: 24 + 13 + 27 + 9 = 73), zero console errors, zero CSP violations. The first full run stopped at phase 5 AC17 because Playwright won't click an `aria-disabled` button; fixed with `force: true` in that assertion.

### WP12 run and WP14 final runs (backend)
- `npm run e2e:prod`: 26/26 on the first run. The only issue was two console errors `net::ERR_FAILED` for `/favicon.ico`: the browser fetches its own favicon from the offline page while offline, and the worker hasn't cached it yet (SWR, cache miss → network fails). `watchConsole` now ignores exactly that (ERR_FAILED with a `/favicon.ico` location). Possible polish for UI: an `<link rel="icon" href="/icons/icon-192.png">` in `offline.template.html` (precached) would avoid the request entirely.
- **Offline path used: `setOffline`** (both AC 16 and AC 17); the stop-the-server fallback was not needed.
- Teardown verified: nothing on 3101/3102, no `data/e2e-prod.db*`, no temp profile.
- Prettier `--write` on `e2e/phase2-attendance.mjs`, `calismalar/actions.ts`, `repertuvar/actions.ts`, `src/lib/env.ts`, `src/lib/finance/queries.ts`: line wrapping only (diffs checked). `scripts/offline.template.html` is still flagged by prettier; untouched (UI's file, not on the list).
- Final: lint, typecheck, build clean; `npm run e2e` 513/513; `npm run e2e:prod` 26/26 → `design/phase-6/e2e-results.txt`.

## Review fixes (UI/UX)

Author: UI engineer. Fixes for `review-ui.md` P2-1…3 and `review-ux.md` P2-1…3, plus the cheap P3s the lead picked.

- **ui P2-1** `pwa-boot.tsx`: outside production it unregisters every service worker on the origin and deletes our `arkhe-*` caches, so a worker left by `npm start` on 3100 can't serve stale dev chunks.
- **ui P2-2** `phase6-a-brand.mjs`: the standalone stubs (`matchMedia("(display-mode: standalone)")` and, new, `navigator.standalone` for iOS) set `window.__standaloneQueried`; the test waits for that flag plus one animation frame instead of a fixed 500 ms, so it can only pass after the card actually decided.
- **ui P2-3** `phase6-c-finance.mjs`: the overdue-chip check computes WCAG contrast from `getComputedStyle` colours (canvas → sRGB) and asserts ≥ 4.5:1 in both themes. The token pair already passes once the CSS is fresh: absent 5.03 light / 6.22 dark. The earlier failure in the review was the stale dev CSS; the dev server was restarted for this round.
- **ux P2-1** `(portal)/layout.tsx`: the sidebar shows `ArkheWordmark density="small"` (176 px) below 2 dppx and the lockup only at `min-resolution: 2dppx`. AC 3 e2e now runs the sidebar at DPR 2 (lockup ≥ 160 px, wordmark hidden) and at DPR 1 (wordmark shown, lockup hidden), in both themes.
- **ux P2-2**: `staff-lines` added to the real dashed empty states: `repertuvar`, `repertuvar/[id]`, `odevler` (both), `odevler/matris`, `calismalar`, `uyeler`, `finans`, `finans/hareketler`, `finans/aidat`. The `py-10` ones became `pt-10 pb-12` so the stave (28–45 px from the bottom) clears the text. Compact `p-6` notes, the home cards (`py-8`) and non-empty-state dashed elements are untouched. Checked on `/finans/hareketler?ay=2024-01` at 375, light and dark, 1× and 2×.
- **ux P2-3** `globals.css`: light `--present` `oklch(0.53 0.13 155)`, light `--excused` `oklch(0.55 0.11 300)`. Measured in Chrome against `--*-foreground`: present 4.83, excused 4.95, absent 5.03 (light); 7.71 / 7.58 / 6.22 (dark).
- **P3** offline favicon: `scripts/offline.template.html` links `/icons/icon-192.png` (precached); `public/offline.html` regenerated; the `offlineFavicon` exception in `e2e/lib.mjs` `watchConsole` is removed.
- **P3** install card: `dark:ring-1 dark:ring-border` on the tile; curly quotes (`“Ana ekrana ekle”`, `“Uygulamayı yükle”`, `“Ana Ekrana Ekle”`; e2e strings updated); the button is guarded by a ref plus `disabled` while the prompt is open, a throwing `prompt()` falls back to `dismissed`; afterwards focus moves to the card title (`tabIndex={-1}`) and the `Eklendi.` line is `role="status"`.
- **P3** mobile header logo link: `-my-3 inline-flex min-h-11 … focus-visible:ring-3`, a 44 px target with no layout change; asserted in AC 3 e2e. `box` null checks no longer crash the run (P3-11).
- `Tekrar dene` stays `href="/"` (AC 16, tech-lead decision).
- Running `prettier --write` over `src/app/(portal)` also reformatted `calismalar/actions.ts` and `repertuvar/actions.ts` (whitespace only; they were the files prettier had flagged).

Runs: `npm run lint`, `npm run typecheck` clean; `npm run e2e -- phase6-a` 29/29 on the restarted dev server. Full run left to the tech lead after the backend/db fixes land.
Screens: `scratchpad/wp15/` (sidebar 1×/2× light/dark, install card light/dark, empty state light/dark 1×/2×).

## Review fixes (backend/db)

Author: backend. From `review-backend.md` and `review-db.md`.

### Backend
- **P2-1 login lockout without a trusted IP.** `rate-limit.ts`: with `TRUST_PROXY_HEADERS` unset there is no `email|?` bucket any more, only `email:` (30 per 15 min); with a trusted IP the `email|ip` (5), `email:` (30) and `ip:` (30) buckets stay. `forgetLoginAttempts` takes a nullable pair key.
  **For the PO:** the shared `email|?` bucket meant anyone on the internet could block an account's new logins for 15 minutes with six wrong passwords, and keep it blocked with a cron, on Render (where the flag must stay unset) or on Vercel if the flag is forgotten. Rehearsal-night logins from a new phone and invite-day logins would fail. Without it, an attacker gets at most 30 guesses per account per 15 minutes against scrypt and our password rules, which is acceptable for ~60 accounts and matches AC 26's wording ("only the per-email limits apply"). README's Render section says this in one sentence.
  e2e: AC 26 (`phase6-b-security.mjs`) now asserts six spoofed `X-Forwarded-For` values leave exactly one bucket `email:<email>=6` and no lock; `phase1-auth.mjs` "parallel guesses" and "rate limited" prefill the per-email bucket (28 / 29 rows) and assert the lock at 30.
- **P2-2 logout and `__Host-`.** `deleteCurrentSession` deletes the cookie with `path: "/"`, `secure`, `httpOnly`, `sameSite: "lax"` (a `__Host-` deletion without `Secure` is ignored by browsers) and does so in `finally`, even if the DB delete throws. `prod.mjs` asserts the browser no longer holds `__Host-arkhe_session` after logout.
- **P3-1 matcher.** Extensions are skipped only for root-level files (`[^/]+\.(?:svg|png|ico|webmanifest)$`); `brand/` and `icons/` stay as prefixes. `/davet/x.png` now gets the CSP (checked on dev with curl and in `prod.mjs`); `icon.svg`, `favicon.ico`, `apple-icon.png`, manifest, `/brand/*.webp`, `/icons/*`, `sw.js` still bypass the proxy.
- **P3-3 `text.ts`.** Pure ASCII source with `\u` escapes (the earlier literal characters came from the tool chain decoding `\u` escapes on write; generated now from code points). Adds U+00AD, U+115F/1160, U+180E, U+200B, U+2060–2064, U+206A–206F, U+3164, U+FFA0 and tag characters U+E0000–E007F (`u` flag; note: subdivision flag emoji lose their tag sequence). U+2028/2029 become `\n` in `cleanText`, so `cleanLine` turns them into a space. ZWJ/ZWNJ kept (checked: family emoji intact).
- **P3-4 single-line fields.** New `optionalLine(max)` in `validation.ts` (`cleanLine`). Used for rehearsal `title`/`location`, piece `composer`/`arranger`/`language`/`voicing`, single link `label`, and finance `text()` (entry/dues `description`, `counterparty`, sponsor `contactName`/`contact`, rate `note`); sponsor `note` stays multi-line (`optionalText`). `create-admin` cleans the name with `cleanLine` and requires 2–80 characters.
- **P3-10/11/12 README.** Token typed via `read -rs` + `export`, `unset` at the end; two tokens (host token, 7-day laptop token); `turso db tokens invalidate` on a leak; env variables **Production only** (Preview fails the boot check by design); where to find `Invalid environment` on Vercel and Render.
- Not done (not in this round's list): P3-2 replay message periods, P3-5 SW `Set-Cookie` no-op, P3-6 public choir photo, P3-7 IPv6 /64, P3-8 login-attempt write amplification, P3-9 `https` on Vercel/Render, P3-13.

### DB
- **P2-1 `correctEntry`.** For a dues entry the position is read **before** the void, and the limit is `remaining_before + old.amount`, so a rate-change freeze is honoured in both directions. e2e appended at the end of `phase6-c-finance.mjs` (`correctionAfterRateChange`, called last in the default export): rate up (reduced ₺150 → Tam with ₺100 paid, freeze ₺150): Düzelt to ₺250 is refused with `Kalan borç ₺150,00; daha fazlası girilemez.`, to ₺150 accepted; rate down (Tam ₺300 → İndirimli with ₺100 paid, freeze ₺300): Düzelt to ₺250 accepted. Not run by me (dev e2e reserved for the UI engineer's final run).
- **P2-2/P2-3 `db-backup.ts`.** All reads in one `client.transaction("read")`; output is `PRAGMA foreign_keys=OFF; BEGIN; PRAGMA defer_foreign_keys=ON;`, every `CREATE TABLE`, every `INSERT`, then indexes/triggers/views, `COMMIT`. Verified on a scratch copy of the dev DB: restored with `sqlite3 -cmd "PRAGMA foreign_keys=ON"` **after removing the first line** → no error, `foreign_key_check` empty, 24 users, 53 `sqlite_master` indexes (= source), 7 migrations, `db:check` `foreign_keys=1, orphaned rows=0, migrations=7/7, quick_check=ok`; `executeMultiple` restore also fine.
- **P2-4 README.** Restore step uses **Redeploy**; rollback says Promote is safe only while the DB URL is unchanged and never to Promote a pre-switch deployment; Render's rollback has the same caveat (use Manual Deploy after changing variables).
- **P3s.** README drill cleans `-wal`/`-shm`; `--from-dump` and point-in-time restore (if the free plan offers it) named; AC 39 test prints the backup output and stops cleanly when `db:backup` fails; `phase6-z-guards.mjs` compares row counts plus a SHA-256 of every row of the five tables instead of the file mtime.

### Runs
- `npm run lint`, `npm run typecheck`: clean.
- `npm run e2e:prod`: **28/28** (two new checks: logout clears `__Host-arkhe_session`; `/davet/x.png` has a CSP), offline path `setOffline`, no server left on 3101/3102, no `data/e2e-prod.db*`.
- Dev `npm run e2e` not run (UI engineer's final run). Files touched that it covers: `phase1-auth.mjs`, `phase6-b-security.mjs`, `phase6-c-finance.mjs` (appended function + one call line at the end of the default export), `phase6-z-guards.mjs`.
