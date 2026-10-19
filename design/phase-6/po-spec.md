# Phase 6 spec: brand, PWA, security and deploy-ready (final phase)

Author: PO. Date: 2026-10-19. Inputs: `PLAN_INPUT.md` (Faz 6), `design/STATUS.md`, `design/brand-integration.md`, `design/phase-5/review-po.md` ("Carried to Phase 6"), `design/phase-4/review-po.md`, `brand/`, the current code (`src/components/arkhe-logo.tsx`, `src/app/icon.svg`, `src/proxy.ts`, `next.config.ts`, `src/lib/flash.ts`, `scripts/*`).

User decisions of 2026-10-19 (fixed, not up for discussion):
1. No vector logo exists. We draw the official ARKHE logo as SVG from `brand/images.jpeg` in three forms: full lockup, wordmark only, "A" monogram.
2. The phase ends at **deploy-ready**. No Vercel/Turso accounts and no real deploy. We deliver everything the user needs to deploy later on free tiers.
3. Zero budget.

## 1. Problem

The portal works: 440/440 e2e tests pass and Phases 1–5 are accepted. It is not yet something a choir can put on 50 phones and trust:
- **It doesn't look like Arkhe yet.** `ArkheWordmark` is a construction that only resembles the logo. In the original (`brand/images.jpeg`, 447×447, white on black), each stroke is a closed outline that holds parallel hairlines. The A has a sharp apex, and the E arms and the H bar have closed ends. Our version has open, clipped stroke ends. Singers know the logo from Instagram, so a near-miss looks like a fake.
- **It isn't an app on the phone.** There is no manifest and no app icons except `icon.svg`, so "Ana ekrana ekle" can't be done. On a basement rehearsal-room connection the browser shows its own dinosaur page.
- **It isn't safe to deploy.** The CSP allows `'unsafe-inline'` scripts. `seedHomework` has no production guard, and `seedFinance` checks only the URL scheme. Nothing stops a demo `@arkhe.local` account from working in production. The flash cookie carries free text. Nothing fails fast if the environment is wrong (for example, a `file:` DB on Vercel's read-only filesystem).
- **Nobody knows how to deploy it.** There is no checklist.

`brand/Mmrozet2.jpg` (332×393) is the **Mülkiye shield**: purple field, gold "MM", a map of Turkey, "1859". It belongs to the faculty or alumni association, not to the choir. **We do not use it anywhere in the app or icons.** It is reference only, and it confirms that our navy-violet + gold palette fits the Mülkiye family. Using it would need permission from its owner. See Out of scope.

## 2. Users and roles

| Role | What Phase 6 changes for them |
|---|---|
| Korist (member) | Adds the portal to the home screen and opens it like an app with the Arkhe icon. Gets a friendly Turkish offline page. Sees the real logo. |
| Yönetim kurulu (board) | Same as above. Can see who last changed a member's dues rate or exemption (self-dealing visibility). |
| Şef (conductor) | Same as above. The live attendance screen keeps working under the stricter CSP. |
| The user (future deployer) | Gets a README deploy checklist, a complete `.env.example`, fail-fast env checks, `db:backup`/`db:check` that work against Turso, and a production smoke test that proves the guards. |

## 3. User stories and acceptance criteria

Numbering is global so that e2e test names can reference "AC n". "e2e" means the dev-server suite `npm run e2e`. "prod-e2e" means the new production smoke suite (see §5). "gate" means a check the reviewer does by hand or script, recorded in `review-*.md`.

### S1. Brand: the real logo everywhere (korist, everyone)
*As a singer I want the portal to show the same ARKHE logo as our Instagram, so it feels like our choir's app.*

1. **Fidelity (gate):** the new SVG wordmark, rendered white on black at 447 px canvas width and overlaid at 50 % on `brand/images.jpeg`, matches it:
   - letter outer edges within 3 px
   - each stroke is a **closed outline holding the same number of hairlines as the original** (count from the 3× crop)
   - the A has a sharp apex with its crossbar at the original height
   - the R has a round bowl and a diagonal leg
   - the K has a straight stem with two diagonals
   - the H bar and the E arms have closed ends
   
   The UX reviewer attaches the overlay screenshot (scratchpad) and the hairline count to `review-ux.md`.
2. Three components replace the current `ArkheWordmark`/`ArkheLockup` (one file, `src/components/arkhe-logo.tsx`; names are the engineer's call):
   - **lockup:** ARKHE + `MÜLKİYE ÇOKSESLİ KOROSU`, with the subtitle tracked to span the wordmark width
   - **wordmark:** ARKHE only
   - **monogram:** A only
   
   All three use `fill="currentColor"`, have `role="img"` and a Turkish `aria-label` (`Arkhe Mülkiye Çoksesli Korosu` for the lockup, `Arkhe` for the others), and contain no raw hex colours. (e2e: on `/giris` and on the portal header at 375 px, and on the sidebar at 1280 px, an `svg[role=img]` with the right label is visible, in light and dark.)
3. Placement follows `brand-integration.md` A1:
   - lockup on the login panel and the md+ sidebar
   - wordmark in the mobile header at 18–20 px height
   - the subtitle is never rendered narrower than 160 px; below that, use the wordmark
   
   (e2e: the mobile header logo's bounding-box height is 18–20 px, and its width is less than 50 % of the 375 px viewport.)
4. **Staff motif aligned to the logo:** `.staff-lines` uses groups of 5 hairlines with about a 1:1 line/gap ratio, matching the logo strokes, not 1 px lines on a 9 px pitch. (Gate: screenshot of an empty state in both themes.)
5. **Standalone vector files for the choir** (they have none today): `public/brand/arkhe-lockup.svg`, `arkhe-wordmark.svg` and `arkhe-monogram.svg`, black on transparent, with **the subtitle converted to paths** so the files don't depend on a font. A dev-only script generates them (free tooling, for example opentype.js with the Jost font file). (e2e: each file returns 200 with `image/svg+xml` and contains no `<text>` element.)
6. Eyebrows use `tracking-[0.2em]` (brand-integration A1). (Gate.)

### S2. App icons and favicon
*As a singer I want a crisp Arkhe "A" on my home screen and browser tab.*

7. Icons are generated by a script (extend `scripts/brand-assets.mjs`, sharp) from the monogram SVG, not drawn by hand:
   - `favicon.ico` (16 + 32)
   - `icon.svg`, which switches colours via `prefers-color-scheme` inside the SVG
   - `icon-192.png` and `icon-512.png`
   - `icon-maskable-512.png`, with the mark inside the central 80 % safe circle
   - `apple-icon.png` (180, opaque `--stage` background, no transparency)
   
   At 32 px the monogram uses 3 hairlines; at 16 px it is solid (brand-integration A1).
8. (e2e) Every icon URL in the manifest and in `<link rel=icon|apple-touch-icon>` returns 200. Its PNG IHDR width and height equal the declared size. The apple icon has no alpha channel.

### S3. Installable PWA
*As a singer I want to add Arkhe to my home screen and open it full-screen with one tap before rehearsal.*

9. The manifest is served from `src/app/manifest.ts` (Next.js metadata route, `/manifest.webmanifest`; see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`) with these fields:
   - `name: "Arkhe · Mülkiye Çoksesli Korosu"`
   - `short_name: "Arkhe"`
   - `description: "Arkhe korist portalı: çalışmalar, yoklama, repertuvar, ödevler ve aidat."`
   - `lang: "tr"`, `dir: "ltr"`, `id: "/"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`
   - `background_color` = dark `--background` and `theme_color` = `--stage`, as hex (one value each; per-theme bar colour stays in the existing `viewport.themeColor` media pairs)
   - icons from AC 7, including one with `purpose: "maskable"`
   - `shortcuts`: `Yoklama` → `/yoklama`, `Ödevlerim` → `/odevler`
   
   (e2e: fetch and assert each field.)
10. The manifest, icons, `sw.js` and the offline page are public: no login redirect from `proxy.ts`. (e2e: fetched without a cookie, each returns 200 and is not a redirect to `/giris`.)
11. **Installability (prod-e2e):** in real Chrome on the production build, CDP `Page.getInstallabilityErrors` returns an empty list on `/giris` and on `/`.
12. **Install hint in Profil, no nagging:** `/profil` shows a small card titled `Telefonuna ekle`:
    - On Chrome/Android, when `beforeinstallprompt` fired, it has a button `Ana ekrana ekle`.
    - Otherwise it shows the iOS text: `Safari'de Paylaş simgesine, sonra "Ana Ekrana Ekle"ye dokun.`
    - It is hidden when `display-mode: standalone` matches.
    - No banner, modal or prompt anywhere else.
    
    (e2e: card visible on `/profil` in a normal tab. Gate: hidden in standalone, checked by emulating the display mode or by hand.)

### S4. Offline fallback and a safe service worker
*As a singer in a basement rehearsal room with no signal I want a clear Turkish message, not a browser error. As the board I need to know that no one's dues or notes are ever left in a phone's cache.*

13. **Approach:** a hand-written `public/sw.js` with no dependency (Serwist adds build coupling with Turbopack that we don't need). It is registered by a tiny client component **only when `NODE_ENV === "production"`**, so dev and HMR are untouched. It is served with `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript; charset=utf-8` (Next.js PWA guide).
14. **What it caches, exhaustively:**
    - (a) precache on install: the offline page and its own CSS, the monogram icon, and the manifest
    - (b) runtime cache-first: same-origin `GET` requests under `/_next/static/` (content-hashed) and `/brand/`, and the icon files
    - Versioned cache name. Old caches are deleted on `activate`.
15. **What it never caches:**
    - any navigation/HTML response
    - anything under `/api/`
    - any request with `RSC` / `Next-Router-*` headers or `_rsc=` in the URL
    - any non-GET request (server actions)
    - any cross-origin request
    - any response with `Set-Cookie` or `Cache-Control: private/no-store`
    
    These go straight to the network. (prod-e2e: log in as yk@ (finance manager), visit `/`, `/finans`, `/finans/aidat`, `/odevler`, `/uyeler`, `/profil` and one member detail. Then enumerate every request URL in every `caches` entry: each must match the allow-list in AC 14, and none may be a page path, `/api/`, or carry `_rsc`.)
16. **Offline fallback:** when a navigation fails because of the network, the service worker answers with the precached offline page. The page needs no JavaScript, works in both themes (`prefers-color-scheme`), shows the monogram, and has this copy:
    - Title `Bağlantı yok`
    - Body `İnternete yeniden bağlanınca kaldığın yerden devam edebilirsin. Yoklama, ödev ve aidat bilgileri yalnızca çevrimiçiyken görünür.`
    - Link styled as a button: `Tekrar dene` → `/`
    - `<title>Çevrimdışı · Arkhe</title>`
    
    (prod-e2e: load `/` once while logged in so the service worker activates, go offline, navigate to `/repertuvar`, and see `Bağlantı yok` and `Tekrar dene`. Run at 375×812 in light and dark with no horizontal scroll.)
17. Logout still works as before. After logout, while offline, a navigation shows the offline page and **never** a previously visited portal page. (prod-e2e.)
18. An updated `sw.js` takes over on the next visit (`skipWaiting` + `clients.claim` are acceptable because we never cache HTML). Gate: implementation notes explain the update path.

### S5. Security pass
*As the board I want members' data safe when this goes on the open internet.*

19. **Nonce-based CSP in `src/proxy.ts`**, following `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`:
    - a fresh nonce per request
    - `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `'unsafe-eval'` in dev only
    - **no `'unsafe-inline'` in `script-src`**
    - `style-src 'self' 'unsafe-inline'` stays, because base-ui/sonner set `style` attributes (documented as accepted)
    - `frame-src` (Drive and YouTube nocookie), `frame-ancestors 'none'`, `base-uri`, `form-action` and `object-src` as today
    - `worker-src 'self'` and `manifest-src 'self'` added
    
    The CSP moves out of `next.config.ts`, and the other headers stay there. Every page that needs the nonce renders dynamically. The existing auth redirect in `proxy.ts` keeps working, and the matcher still skips static assets.
    
    (e2e on dev and prod-e2e: on `/giris`, `/` and `/calismalar/<id>/canli`, the CSP header has a nonce, and every `<script>` element in the HTML carries that same nonce. Two requests get different nonces. `script-src` doesn't contain `unsafe-inline`.)
20. **No CSP violations in normal use:** the e2e harness listens for `securitypolicyviolation` (via an init script) and for console `Refused to` messages on the main pages of each role:
    - home, yoklama check-in by code, live screen with QR, repertuvar detail with a Drive preview iframe, odevler, finans, profil
    
    It asserts zero violations. (e2e + prod-e2e.)
21. **Headers (prod-e2e):** `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Permissions-Policy` are present on HTML responses. There is no `X-Powered-By`, and in production there is no `'unsafe-eval'`.
22. **Secure cookies in production (prod-e2e):** the login response sets `__Host-arkhe_session` with `Secure; HttpOnly; SameSite=Lax; Path=/` and no `Domain`. The flash cookie is also `Secure` in production.
23. **Flash cookie carries a key, not text:** `setFlash(key)` accepts only keys from a fixed map (Turkish messages live in code, for example in `src/lib/labels.ts` or next to the flash helper). Unknown or tampered keys are ignored silently. (e2e: setting `arkhe_flash` by hand to arbitrary text such as `<b>Hacked</b>` and loading `/finans` shows no toast with that text. The real redirect flow still shows its Turkish toast.)
24. **Demo accounts never work in production:** when `NODE_ENV=production`, login for any `@arkhe.local` email is refused with the same generic error as a wrong password (`E-posta ya da şifre hatalı.`, so no new information leaks). `db:check` reports `@arkhe.local` users as a failure when run against a non-`file:` DB. (prod-e2e: insert a `@arkhe.local` user into the prod-smoke DB and check that login fails with the generic message.)
25. **Seed and fixtures refuse production:**
    - `scripts/seed.ts`, `seedFinance` (`scripts/finance-fixture.mjs`) and `seedHomework` (`scripts/homework-fixture.mjs`) each throw before writing anything when `NODE_ENV === "production"` **or** the DB URL isn't `file:`.
    - `e2e/lib.mjs` refuses to run against a non-`file:` URL.
    - `db:reset` keeps `assert-local-db`.
    
    (e2e, in the runner's setup step: invoking each function or script with `NODE_ENV=production` rejects or exits non-zero, and a row count taken before and after is unchanged.)
26. **`TRUST_PROXY_HEADERS` behaviour, documented and checked:**
    - Unset: `X-Forwarded-For` / `X-Real-IP` are ignored, so only the per-email limits apply.
    - `1`: the first `X-Forwarded-For` hop or `X-Real-IP` is used for the per-IP bucket.
    - In production with the flag unset, the server logs one warning at boot: `TRUST_PROXY_HEADERS is not set; per-IP login limits are off.`
    
    (e2e on dev: with the flag unset, six wrong logins for one email under six different spoofed `X-Forwarded-For` values still lock that email+`?` pair after 5, showing the spoofed IP gave no fresh bucket.)
27. **Fail-fast env check in production** (`instrumentation.ts` `register()` or an equivalent server-start hook). The server refuses to start, with a clear English error naming the variable, when:
    - `APP_URL` is missing, or isn't `https://` (except for `127.0.0.1`/`localhost`)
    - `DATABASE_URL` is `libsql://`/`https://` but `DATABASE_AUTH_TOKEN` is empty
    - `VERCEL` is set and `DATABASE_URL` starts with `file:` (read-only filesystem)
    
    (prod-e2e: start the server once with a bad `APP_URL`, expect a non-zero exit and the variable name in stderr.)
28. **Input hygiene** (phase-5 #7, phase-4 P3-5): the shared `clean()` strips C0/C1 control characters and bidi overrides (U+202A–202E, U+2066–2069). The dues waiver reason uses it. Opening-balance and period dates are bounded to 2000-01-01 … today + 2 years. An opening amount spelled as zero (`0`, `0,00`) is treated as "none". (e2e: a waiver reason containing U+202E is stored without it, and an opening dated 1999-12-31 is refused with `Tarih 2000 ile gelecek iki yıl arasında olmalı.`)
29. **Health endpoint for the deployer:** `GET /api/saglik` returns `{"ok":true}` (200) after a trivial `select 1`, or 503 `{"ok":false}`. It needs no auth and returns nothing else: no version, no counts. (e2e.)

### S6. Phase 5 carry-forward that lands now
*As the board I want to see who exempted whom; as the tech lead I want no fixture to ever touch production.*

30. **Self-dealing visibility (Phase 5 #1, PO priority):** in the member dues sheet, under the rate and under each waiver, show `Son değişiklik: {Ad Soyad} · {d MMM yyyy}`, using `member_dues.updated_by/updated_at` and `dues_overrides.created_by/created_at`, formatted in `tr-TR` Europe/Istanbul. If the user was deleted, show `Son değişiklik: silinmiş üye · {tarih}`. Members don't see this line in their own Aidatım. (e2e: yk@ sets their own rate to `İndirimli`, and the sheet shows `Son değişiklik: Demo Yönetim · <today>`. korist@ sees no `Son değişiklik` on their Aidatım view at `/finans`.)
31. **Freeze cleanup on void (#2):** voiding a payment deletes that period's freeze for that member in the same transaction. (e2e: void, then re-pay at a different rate, and the owed amount equals the new rate.)
32. **Replay id includes the member (#3):** `derivedId(clientId, memberId, periodId)`. (e2e: bulk-pay two members with one client id, and both rows are created.)
33. **Constraint errors in dues actions (#4)** return `Kaydedilemedi. Alanları kontrol et.` instead of hitting the error boundary. The void and meta edits run in `writeTx`. (Gate: backend review.)
34. **Fixture safety (#5):** covered by AC 25.
35. **Performance (#8 / db P3-2, 3, 9):**
    - month and year filters use ranges (`occurred_on >= ? and occurred_on < ?`) instead of `substr`
    - partial index `on finance_entries(payment_group_id) where payment_group_id is not null` (migration `0006_phase6_*`)
    - `getEntry` uses `Promise.all`
    
    (Gate: DBA shows `EXPLAIN QUERY PLAN` using the index or range. e2e: the existing finance suite stays green.)
36. **Cheap UX/a11y polish from Phase 5:**
    - dues rows titled by the member's name (ux P3-1)
    - `Nasıl ödenir?` hidden for fully exempt members (ux P3-5)
    - the period trash icon disabled, with `aria-disabled` and the tooltip/text `Ödemesi olan dönem silinemez`, when the period has payments (ux P3-6)
    - the axe `aria-prohibited-attr` on the disabled `Sonraki ay` fixed (ui P3-1)
    - the overdue chip uses a token instead of `text-white` (ui P3-4)
    - the 6 px sticky-bar gap closed (ui P3-2)
    
    (e2e where observable. Axe on `/finans/aidat` reports no `aria-prohibited-attr`.)

### S7. Deploy-ready package (the user)
*As the user I want to deploy later, alone, on free tiers, by following one page.*

37. **`.env.example`** lists every variable the code reads, each with a one-line comment and the production value shape: `APP_URL`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `TRUST_PROXY_HEADERS`, and any new ones. (Gate: grep `process.env.` in `src/` and `scripts/`; every name is in the file.)
38. **README "Deploy (Vercel Hobby + Turso)" section,** in English with the Turkish UI terms quoted. It is a numbered checklist the user can follow without us:
    1. create a Turso DB and token (free)
    2. `DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run db:migrate` from the laptop (this runs `db:backup` first)
    3. `npm run db:check`
    4. `npm run create-admin` against Turso with a real email
    5. import the project into Vercel Hobby and set the env vars (`TRUST_PROXY_HEADERS=1`, `APP_URL=https://…`)
    6. deploy and open `/api/saglik`
    7. install on a phone and run the manual checks
    8. backups: run `npm run db:backup` against Turso before every migration and monthly; how to restore (`turso db shell <db> < backup.sql`)
    9. rollback: Vercel "Promote" of the previous deployment, and that schema rollbacks are restore-from-backup
    
    It also states the free-tier limits that matter and the Vercel Hobby "non-commercial" note (§7 risk 1).
39. `db:backup` and `db:check` work against a `libsql://` URL. Already true in code; the README states it, and the DBA confirms in review. `db:backup` never writes inside `public/`.
40. **Post-deploy manual checklist** in the README, collecting every "real phone" item carried from Phases 2–5:
    - Drive PDF and YouTube preview
    - homework mailto with Turkish characters on iOS and Android
    - decimal input with English and Turkish region on iOS, plus Android
    - CSVs in Turkish Excel and in LibreOffice
    - dark-mode contrast of the overdue badge and of `text-absent-ink` on stage
    - Add to Home Screen on iOS Safari and Android Chrome
    - the offline page in airplane mode

### S8. Final test round, acceptance and presentation
41. `npm run e2e` is fully green: all Phase 1–5 tests plus the new Phase 6 dev tests. The Phase 6 tests run in a **375×812** phone context (this settles the Phase 5 "375 vs 390" note). `npm run e2e:prod` is fully green. `npm run lint`, `npm run typecheck` and `npm run build` are clean. Results go to `design/phase-6/e2e-results.txt`.
42. Team review (`review-ux/ui/db/backend.md`) with every P1 and P2 fixed before PO review.
43. **Final presentation** of the whole process, Phases 0–6: extend the existing 18-slide deck. It covers the problem, the team process, each phase in one slide with its key screen, test counts per phase, the security and PWA story, what is deferred, and "how to deploy" in one slide. Turkish copy, built on the brand: real logo, stage colours, the staff motif.

## 4. Out of scope (explicitly)

- **An actual deploy**: no Vercel or Turso accounts, no domain, no DNS. No CI or GitHub Actions (there's no git yet).
- Push notifications, background sync, offline *data* (cached schedules, offline check-in), and iOS splash images.
- Any use of the Mülkiye shield (`brand/Mmrozet2.jpg`) until the owner gives written permission.
- Member photos on public pages (`/giris`, the offline page): the board's consent is still pending, per brand-integration A2.
- The `DUYURU` announcement card and the brand gradient beyond what exists today.
- Phase 5 carry-forward deferred: #6 (roster when a payer becomes conductor; `removeWaiver` no-op success), ux P3-2/3/4/7/8/9/10, ui P3-5/6/7/8/9/10, and everything in Phase 5 `po-decisions` §4 (dues table view, sponsor picker, treasurer role, un-void, charts).
- Phases 2–4 deferred P3s: optimistic-lock `version` column, the late-poll flicker, lost sectional ticks after a form error, wake-lock indicator, freezing reports at close, and the remaining Phase 3 polish list. These are recorded in `STATUS.md` as the post-launch backlog.
- Rate limiting beyond login, WAF, 2FA, and audit-log screens (AC 30 is the only audit surface).
- Hard performance budgets or Lighthouse scores as gates. We record build route sizes in implementation notes, nothing more.

## 5. E2E approach (real Chrome via playwright-core)

- **Dev suite** (`e2e/phase6-*.mjs`, run by `npm run e2e` against `127.0.0.1:3100`) covers AC 2, 3, 5, 8, 9, 10, 12, 19, 20, 23, 25, 26, 28, 29, 30–32 and 36. For CSP checks, read `response.headers()['content-security-policy']` and compare with `script[nonce]` in `page.content()`. Note that browsers hide the `nonce` attribute from `getAttribute` after parse, so read the **raw HTML** from the response, not the DOM. Violations: use `page.addInitScript(() => addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective)))`. Init scripts injected over CDP aren't subject to the page CSP.
- **Production smoke suite** (`npm run e2e:prod`, new `e2e/prod.mjs`):
  1. Runs `next build`, a separate build dir from the dev server's `.next/dev`, so the running dev server is untouched. If that turns out to be false, the tech lead uses a distinct `distDir`.
  2. Migrates a throwaway `data/e2e-prod.db`.
  3. Creates one admin via the `create-admin` logic, with a non-`.local` email.
  4. Starts `next start` on **127.0.0.1:3101** with `NODE_ENV=production` and `APP_URL=http://127.0.0.1:3101`.
  5. Runs AC 11, 15, 16, 17, 19–22, 24 and 27.
  6. Stops the server and deletes the DB.
  
  The service worker works on `http://127.0.0.1` because it counts as a secure context.
- **Offline in Playwright:** prefer `context.setOffline(true)`. If Chromium's offline emulation doesn't apply to SW-mediated navigations in our playwright-core version, **stop the prod server process** and navigate. That is real offline from the service worker's view, and it is the fallback the tech lead must use rather than skipping the test.
- **Cache audit:** `page.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url); return out; })`.
- **Installability:** `const cdp = await page.context().newCDPSession(page); await cdp.send('Page.getInstallabilityErrors')`.
- All new tests create only `E2E…` data and clean up after themselves (Phase 4 process note).

## 6. Priorities if time runs short

Must, in order:
1. AC 25 (fixture safety)
2. AC 19–24 and 27 (security)
3. AC 1–3 and 7–10 (logo, icons, manifest)
4. AC 13–17 (SW + offline)
5. AC 30 (self-dealing)
6. AC 37–41 (deploy package, tests)
7. AC 43 (presentation)

Should: AC 4–6, 11–12, 18, 26, 28–29, 31–33 and 35. Could: AC 36. Anything cut from Should or Could gets an entry in the out-of-scope list of `po-decisions.md`. The phase can't be accepted with a Must missing.

## 7. Open risks and questions for the team

1. **Vercel Hobby is "non-commercial / personal use".** A volunteer choir's internal tool that tracks dues is, in my reading, non-commercial, but that's not certain. @backend: name one free fallback host that works with Next 16 proxy and server actions, and note it in the README (alternatives that run `next start`, with Turso unchanged). I don't want a paid plan under any outcome.
2. **Nonce CSP forces dynamic rendering.** @ui-engineer: confirm which routes are static today (`/giris`, `/davet/*`, `not-found`) and that making them dynamic is acceptable for about 60 users. Also confirm that `qrcode.react`, sonner and base-ui inject no inline `<script>`. If any library needs inline scripts we can't nonce, say so before implementation.
3. **Logo fidelity from a 447 px JPEG.** The hairline count per stroke is hard to read at this size (4–5). @ux: count from the 3× crop and state the number in `ux.md`. If it's ambiguous, follow the brand-integration rule (5 hairlines, 1:1). Fidelity to the visible original beats our earlier construction.
4. **Subtitle to paths** needs a dev-only font-outlining dependency. @backend/@ui: confirm it's free (MIT/OFL), dev-only, and used only by the generator script.
5. **Service worker plus a later deploy:** a bad `sw.js` can pin users to stale static assets. AC 14 forbids caching HTML, and `sw.js` itself is `no-store`. @ui-engineer: also ship a documented kill switch (a `sw.js` that unregisters itself) in the README.
6. **Secure cookies on `http://127.0.0.1:3101`:** Chrome treats loopback as potentially trustworthy, but if `__Host-` cookies aren't stored, prod-e2e logs in via `localhost:3101` instead. AC 22 asserts on the `Set-Cookie` header in any case.
7. **The demo-account guard (AC 24) blocks by domain.** If the choir ever uses a real `.local` domain, which is very unlikely, it would bite. Accepted.
