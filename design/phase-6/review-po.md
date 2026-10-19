# Phase 6 PO review: brand, PWA, security, deploy-ready (final phase)

Author: arkhe-po. Date: 2026-10-19. Checked against `po-spec.md` (AC 1–42; AC 43, the presentation, follows this acceptance), `po-decisions.md` (D1–D40 and §3 amendments), `implementation-notes.md` (all sections, including both "Review fixes"), `review-ux.md`, `review-ui.md`, `review-db.md`, `review-backend.md`, `e2e-results.txt`, the README deploy section, `.env.example`, and my own read-only pass on the running dev app (375×812, DPR 2, light and dark, as korist@; no data created).

## Verdict: **ACCEPTED**

Phase 6 meets every acceptance criterion. Two of them (AC 3, AC 26) are amended below, and AC 31 was already narrowed in D31. The final run after the review fixes is green:
- `npm run e2e`: **521/521**. The first full run was 520/521 because of the known phase 4 AC10 manifest flake during a Turbopack recompile. Phase 4 alone passed 112/112, and the full rerun was clean.
- `npm run e2e:prod`: **28/28**, against a real `next build` + `next start`.
- `npm run lint`, `npm run typecheck` and `npm run build` are clean. Every HTML route is dynamic (`ƒ`).

The team review found 0 P1 and 12 P2s (ux 3, ui 3, db 4, backend 2). All 12 are fixed, and where a test could see the fix it has one.

All three of the user's constraints hold:
- **The logo is drawn from the JPEG.** IoU is 0.951 against `brand/images.jpeg`, the max edge deviation is 2 px, and the hairline counts match the original.
- **The phase ends deploy-ready, with no accounts and no deploy.** The README is a checklist the user can follow alone, and Render is the fallback host.
- **Zero budget.** The only new dependencies are dev-only and free: sharp (Apache-2.0), fontkit (MIT), the Jost font (OFL) and axe-core (MPL-2.0). Nothing needs a card.

For a choir this is the phase that turns a working site into something we can put on 50 phones:
- The real ARKHE logo, as an icon on the home screen.
- A Turkish offline page in the basement instead of the dinosaur.
- Demo accounts and fixtures that can't touch production.
- A board that can see who exempted whom.

There are no must-fix items. The presentation (AC 43) can start.

## AC-by-AC

| AC | Result | Evidence |
|---|---|---|
| 1 Logo fidelity (gate, amended D1) | PASS | ux review: the overlay `scratchpad/wp6/overlay-wordmark.png` gives IoU 0.951 (≥ 0.90) and a max edge deviation of 2 px (≤ 3). Every stroke has 3 hairlines / 4 bands, and the A left leg has 4 / 5. The flat A top, the flush band ends and the E bottom-arm end hairline are all present. Jost 600 kept. My 375 px `/giris` shot reads as the Instagram logo. |
| 2 Three components | PASS | e2e AC2 ×6 (light and dark): `svg[role=img]`, `currentColor`, no `<text>`, labels `Arkhe Mülkiye Çoksesli Korosu` / `Arkhe`. ui review: no hex, no mask, no `useId`. |
| 3 Placement and sizes | PASS, **amended** | Header wordmark is 90.6×20 px (24 % of 375); login band 192 px; login panel 256 px. **Amendment (ux P2-1, accepted):** at 1× DPR the md+ sidebar shows the wordmark (176 px) and at ≥ 2 dppx it shows the lockup (176 px ≥ 160). A 3.7 px subtitle is noise, and "below a legible subtitle, use the wordmark" is my own rule. The e2e covers both densities in both themes. The header logo link is now a 44 px target. |
| 4 Staff motif (gate, D6) | PASS | 5 lines of 1 px on a 4 px pitch, no moiré at 1×. After ux P2-2 the motif is on the real empty states (repertuvar, odevler, calismalar, uyeler, finans/*), not only on the unused `ComingSoon`. Re-shot light and dark at 1× and 2×. |
| 5 Standalone SVGs | PASS | e2e AC5: six files (black and `-white`), 200, `image/svg+xml`, `<title>`, no `<text>`. I confirmed `/brand/arkhe-lockup.svg` → 200 `image/svg+xml`. |
| 6 Eyebrows | PASS | ux gate: `tracking-[0.2em]` everywhere; no `0.14em` left in `src/`. |
| 7 Icon generation (amended D7–D9) | PASS | `scripts/brand-assets.ts` generates every icon (sharp, plus a hand-written ICO). The maskable margin is asserted. The ICO has a solid 16 px frame and a 2-band 32 px frame. `icon.svg` drops its tile in dark (e2e AC7). The 16 px SVG shimmer (ux P3-4) is deferred. |
| 8 Icon URLs | PASS | e2e AC8: hrefs are read from the HTML, every icon returns 200, the IHDR sizes match, and the apple icon is colour type 2 (no alpha). |
| 9 Manifest | PASS | e2e AC9 ×2. My curl of `/manifest.webmanifest` shows every field exactly as specified: `#26214e` / `#0d0b19`, the maskable 512 icon, and the shortcuts `Yoklama` and `Ödevlerim`. |
| 10 Public assets | PASS | e2e AC10. My curl without a cookie: manifest, `sw.js`, `offline.html`, `/icons/*` and `/brand/*` all return 200 with no redirect. |
| 11 Installability (prod-e2e, D14) | PASS | `/giris` and `/` return `[]` in a persistent Chrome profile. |
| 12 Install card | PASS | e2e AC12 ×5: the generic text sits directly above `Aidatım` in both themes. An iPhone UA gets the Safari text. A stored prompt shows a 44 px `Ana ekrana ekle` that leads to `Eklendi.`. In standalone the card isn't rendered. Standalone is tested with an init-script stub because this Chrome ignores CDP `display-mode` (allowed by D13). After ui P2-2 the test waits for proof that the stub was read, so it can't pass by timing. My 375 px dark shot shows the generic text with typographic quotes and the tile ring. |
| 13 Hand-written SW | PASS | e2e AC13: `sw.js` is served `no-cache, no-store` as JavaScript and registered only in production. After ui P2-1, dev also unregisters any leftover worker. prod-e2e: the worker controls the page. |
| 14 What it caches | PASS | ui and backend reviews (code reading): the fetch order matches D15/D16; precache uses `redirect: "error"` and `credentials: "omit"`; the cache holds at most 200 entries and the kill switch is present. |
| 15 What it never caches (prod-e2e) | PASS | Walk as `e2e-yk@example.org` across the finance, homework, member and profile pages: 36 cached URLs, every one allow-listed, none a page, `/api/` or `_rsc`. |
| 16 Offline page | PASS | prod-e2e at 375 in light and dark, `setOffline` path: `Bağlantı yok` + `Tekrar dene`, no horizontal scroll. The copy is exact and uses a system sans heading. The favicon now points at the precached icon, so no network error. My dark shot matches ux §5. `Tekrar dene` stays `/` (decision 2 below). |
| 17 Logout offline | PASS | prod-e2e: logged out and offline shows the offline page, never a portal page. After backend P2-2, logout also clears `__Host-arkhe_session` (asserted). |
| 18 SW update path | PASS | The implementation notes explain the path: `no-store`, `updateViaCache: "none"`, `skipWaiting`, old caches deleted, `clients.claim`. The README documents the kill switch (step 9). |
| 19 Nonce CSP | PASS | Dev e2e ×6 and prod-e2e ×9: every `<script>` carries the header nonce, two requests get two nonces, `strict-dynamic`, no `unsafe-inline`, and no `unsafe-eval` in prod. The build table shows only 3 metadata files static. After backend P3-1, `/davet/x.png` gets a CSP too (I checked with curl). |
| 20 No CSP violations | PASS | 0 violations in dev on every page of each role, and 0 on the prod walk (including the live screen with QR and a Drive preview). |
| 21 Headers | PASS | prod-e2e: HSTS, nosniff, DENY, no-referrer, COOP `same-origin`, `Permissions-Policy` with `camera=()`, no `X-Powered-By`. I saw the same set on dev. |
| 22 Secure cookies | PASS | prod-e2e: `__Host-arkhe_session` is `Secure; HttpOnly; SameSite=Lax; Path=/` with no Domain, on `127.0.0.1` (the `localhost` fallback wasn't needed). The flash cookie is `Secure` and carries a key. |
| 23 Flash key | PASS | e2e: tampered `<b>Hacked</b>` and `constructor` values show no toast and no error page. The real `Düzelt` flow still shows its toast (prod). |
| 24 Demo accounts | PASS | prod-e2e: `korist@arkhe.local` gets `E-posta ya da şifre hatalı.`. `getSessionUser()` refuses existing sessions, `create-admin` refuses demo emails on a remote DB, and `db:check` flags demo accounts on non-`file:` DBs (code reading). |
| 25 Fixture guards | PASS | e2e `phase6-z-guards` ×9 (last file): seed, db:reset's guard, `lib.mjs`, `seedFinance` and `seedHomework` all refuse production and remote targets. The dev DB's row counts and row hashes are unchanged. The guards were proven by hand before the test existed (D25). |
| 26 `TRUST_PROXY_HEADERS` | PASS, **amended** | prod-e2e: the boot warning `TRUST_PROXY_HEADERS is not set; per-IP login limits are off.` is shown. Dev e2e: six spoofed `X-Forwarded-For` values produce one `email:` bucket and no per-IP bucket. **Amendment (decision 1 below):** when the flag is unset there is no shared lock-at-5 bucket; only the per-email limit applies (30 per 15 min). |
| 27 Fail-fast env | PASS | prod-e2e: `APP_URL=http://example.org` → exit 1 within 15 s, and stderr names `APP_URL`. The deviation is accepted: `process.exit(1)` from `boot-check.ts`, because Next 16.4.2 only logs a throw in `register()`. |
| 28 Input hygiene | PASS | e2e: a waiver containing U+202E/U+202C is stored clean, and an opening dated 1999-12-31 gives `Tarih 2000 ile gelecek iki yıl arasında olmalı.`. Hygiene now goes further than specified: more invisible characters are stripped, `optionalLine` covers single-line fields, and `create-admin` cleans names. |
| 29 Health | PASS | e2e and prod-e2e: `{"ok":true}`, `no-store`, nothing else. My curl gives the same. |
| 30 Son değişiklik | PASS | e2e ×6: `Son değişiklik: Demo Yönetim · 19 Eki 2026` under the rate and under the waiver. korist sees none. The dues CSV has no editor column. ux checked the placement at 375. This was my Phase 6 priority from Phase 5, and it's done the way I wanted: a two-person board can still work, and everyone can see it. |
| 31 Freeze cleanup (narrowed D31) | PASS | e2e ×6: voiding the only payment drops the freeze and the member owes the new rate; with two partial payments, voiding one keeps the freeze. db P2-1 (`correctEntry` against an un-frozen rate) is fixed, with an e2e in both directions. |
| 32 Replay ids | PASS | e2e ×3: two members, one client id, two separate groups, and each `Aynı ödemede` lists only its own periods. |
| 33 Dues errors | PASS | Backend review: every dues action is `guarded`, and void and meta edits run in `writeTx`. |
| 34 Fixture safety | PASS | Same as AC 25. |
| 35 Performance | PASS | db review `EXPLAIN QUERY PLAN`: range on `fe_occurred_idx`, `fe_payment_group_idx`, `getEntry` with `Promise.all`. The finance suite stays green. |
| 36 Polish | PASS | e2e ×11: dues rows titled by name; axe reports no `aria-prohibited-attr`; disabled trash; bulk preview month; check icon; sticky bar gap −0.7 px; overdue chip contrast **computed** ≥ 4.5:1 in both themes (ui P2-3); exempt member has no `Nasıl ödenir?`. ux P2-3 raised the light `Geldi`/`Mazeretli` chips to 4.83 / 4.95:1 on the şef's marking roster. |
| 37 `.env.example` | PASS | I grepped `process.env.*` in `src/`, `scripts/` and `e2e/`: `APP_URL`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `TRUST_PROXY_HEADERS` are set in the file; `E2E_BASE_URL` and `E2E_SHOTS` are commented out on purpose; the platform names are listed in a comment. |
| 38 README deploy | PASS | I read it end to end. It has steps 1–9 plus golden rules (secrets only in the shell via `read -rs`, two tokens, `invalidate` on a leak, Production-only env, migrate-then-deploy, expand-only), a restore drill, restore to a new Turso DB, rollback with the Redeploy-vs-Promote caveat, the kill switch, free-tier limits with the Hobby non-commercial note, and the Render fallback. A volunteer can follow it. |
| 39 Backup and check | PASS | e2e AC39 ×3: backup under `data/backups/`, restored with `executeMultiple`, 53/53 indexes, 7/7 migrations, `db:check` passes. db P2-2 (one read transaction) and P2-3 (all tables first, `defer_foreign_keys`, restore works with FKs on) are fixed and drilled. The Turso path is checked only by code reading, as decided (no account). |
| 40 Manual checklist | PASS | The README "Post-deploy manual checklist" covers every item carried from Phases 2–6: Drive and YouTube, QR and wake lock, mailto, decimal input, CSVs, dark-mode badges, install, offline, demo refusal, invite. |
| 41 Final runs | PASS | 521/521, 28/28, lint, typecheck and build clean, route table in `e2e-results.txt`. The Phase 6 dev tests run at 375×812, which settles the Phase 5 "375 vs 390" note. Note: the per-check log in `e2e-results.txt` is from the pre-fix run (513 / 26); the post-fix run is recorded as a summary. Accepted. |
| 42 Team review | PASS | Four reviews, 0 P1, 12 P2, all fixed (see the two "Review fixes" sections). |
| 43 Presentation | — | Follows this acceptance. |

**My own pass (read-only, 375×812, DPR 2, light and dark):** I checked `/giris`, `/` and `/profil` as korist@, and `/offline.html`:
- No horizontal scroll.
- The install card reads well.
- The offline page and the logo look right.

The dev overlay showed one hydration-attribute warning (`caret-color: transparent` on the login inputs). My screenshot tool caused it: Playwright hides the caret before React hydrates. It is not an app defect, and the e2e suites log 0 console errors.

## Decisions on changes made during review

1. **Login limit without a trusted IP: accepted (AC 26 amended).** With `TRUST_PROXY_HEADERS` unset (Render, or a forgotten flag on Vercel), only the per-email bucket applies: 30 wrong passwords per 15 minutes. The old shared `email|?` bucket meant any stranger could lock the şef out of new logins with six requests and keep them locked out with a cron.
   - The real choir cost of a lockout is high: a new phone on rehearsal night, or a singer on invite day.
   - 30 guesses per 15 minutes against scrypt and our password rules, for about 60 accounts, is an acceptable risk.
   - With the flag set to `1` on Vercel, the per-pair (5), per-email (30) and per-IP (30) limits all apply.
   - The README Render section states this. AC 26's wording "only the per-email limits apply" now means exactly this.
2. **`Tekrar dene` stays `href="/"`: accepted as built (AC 16 unchanged).**
   - `/` is always a safe landing. In an installed app with no URL bar, a guaranteed-good page beats re-requesting a deep link that may itself be the problem.
   - The cost is real but small. A singer offline on a QR check-in link has to scan again, and the QR is still on the screen in front of them.
   - The `href=""` reload-same-URL idea (ux P3-6 / ui P3-13) is backlog item 2, together with a copy check so the body and the button make the same promise.
3. **Sidebar logo by pixel density (AC 3 amended)**: see the table.
4. **Remaining open P3s are all deferred** to the backlog below. None is a security hole or a data-integrity risk at choir scale. The most exposed one is the choir photo, and it becomes a go-live precondition rather than a code blocker.

## Must-fix

None.

## Deferred backlog (after go-live), ordered by value to the choir

1. **Choir photo is public by URL** (backend P3-6). `/brand/stage-choir.webp` is served without login (it is not linked from any public page). If the board doesn't confirm consent (go-live precondition 3), move it to `src/assets/` (a hashed URL, so it can't be guessed) or remove it. That is a one-line change.
2. **`Tekrar dene` resumes the same page** (ux P3-6, ui P3-13): `href=""`, plus re-reading the body copy `kaldığın yerden`. Update the AC16 e2e string.
3. **Disabled period trash gives no feedback on touch** (ux P3-3): `toast("Ödemesi olan dönem silinemez")` on tap.
4. **The replay message lists periods that weren't paid** (backend P3-2). A treasurer reads that message as a receipt, so build it from the stored rows.
5. **`APP_URL` must be `https` whenever `VERCEL`/`RENDER` is set** (backend P3-9). Until then, README step 5 covers it by hand.
6. **Free-tier protection:** stop growing `login_attempts` once a login is blocked, prune on every attempt (backend P3-8), and add a README line to watch Turso usage. Also key IPv6 per-IP buckets by /64 (backend P3-7).
7. **Service worker hardening:**
   - the `Set-Cookie` check is a no-op; `isCacheable` should also refuse redirected, `text/html` and `text/x-component` responses (backend P3-5, ui P3-5)
   - write the cache in `event.waitUntil` (ui P3-4)
   - enable navigation preload (ui P3-6)
   - the kill switch reloads open tabs (ui P3-2); this needs a README note at least
   - a page re-registers the worker after a kill (ui P3-3)
   - the cache audit should also check content-type (ui P3-12)
8. **Brand polish:**
   - `icon.svg` uses the solid A at 16 device px (ux P3-4)
   - a `density` prop on `ArkheLockup` for the 1× login panel (ux P3-7)
   - the offline monogram cut is about 1 CSS px (ui P3-9)
   - prettier/constant housekeeping (ui P3-14)
9. **DB:**
   - restore `sqlite_sequence` (db P3-1; harmless today)
   - `db:check` should compare the last migration's identity, not just the count (db P3-4)
10. **Noted, no change needed now:** `sameOrigin` and `X-Forwarded-Host` (backend P3-13). Do not weaken `SameSite` on the session cookie.
11. **Test harness:** the phase 4 AC10 flake during a Turbopack recompile (dev only; standalone runs are always green).
12. **Deferred by earlier decisions, still open:**
    - Phase 6 `po-decisions` §5: the ` (kendisi)` suffix, a `removeWaiver` audit trail, Base UI `CSPProvider` and zod `jitless` (rules only), COEP/CORP, HSTS preload, a rate limit on `/api/saglik`.
    - Phase 5: #6 (roster when a payer becomes conductor; `removeWaiver` no-op success), ux P3-3/7/8/9/10 and ui P3-5…10, and everything in Phase 5 `po-decisions` §4 (dues table view, sponsor picker, treasurer role, un-void, charts).
    - Phases 2–4: the late-poll flicker, ticked sectional parts lost after a form error, the wake-lock indicator, freezing reports at close, the optimistic-lock `version` column, and the Phase 3 polish list.

My advice for after go-live: run the choir for a month before touching any of this. Items 1–4 are worth a small release once singers have used the app for real. Everything else should wait until someone asks for it.

## Go-live preconditions (for the user)

None of these block this acceptance. All of them must be done before the choir is invited:

1. **Git and hosting identity.** Set up git with your personal identity only (repo-local `user.name`/`user.email`, personal SSH alias), as `CLAUDE.md` requires, and put the code in a private repository under your personal account. Vercel and Render both import from a repository.
2. **Re-read the free terms of Vercel Hobby and Turso.** Hobby is "non-commercial". If you're not comfortable that a volunteer choir's dues tool fits, use the Render fallback (README). Never enter a card and never upgrade.
3. **Board decisions:**
   - Consent for the choir photo `stage-choir.webp`. Without consent, apply backlog item 1 first.
   - The Mülkiye shield stays unused until its owner gives written permission.
   - The şef's real email for `create-admin`.
   - Who the second manager (board) account is, so nobody depends on one login.
4. **Follow the README checklist 1–9 exactly:**
   - Env variables Production only.
   - `APP_URL` is the `https://` origin.
   - `TRUST_PROXY_HEADERS=1` on Vercel only, unset on Render.
   - The Turso token only in the dashboard and in a `read -rs` shell session, never in `.env`.
5. **Run the restore drill once before go-live** on the first real backup.
6. **Run the post-deploy manual checklist** (README) on one iPhone and one Android phone, in light and dark. Any failure is fixed before inviting the choir.
7. **Confirm the demo refusal:**
   - `korist@arkhe.local` is refused on the live site.
   - `npm run db:check` against Turso shows no demo accounts.
8. **Roll out in two steps.** First the şef and the board for one rehearsal (attendance, a homework, a dues payment). Then invite the rest of the choir, part by part, from `Üyeler` → `Üye ekle`. Invite links last 24 hours, so send them on a rehearsal day.
9. **Update `CLAUDE.md` yourself (D40).** It still says headings use Fraunces; the app uses Jost. Agents may not edit that file.

## Process note

Phase 6 is the final phase, and with this verdict the app is accepted as **deploy-ready**. Next comes AC 43, the final presentation of Phases 0–6 (extending the existing 18-slide deck). After that, the remaining work belongs to the user: the go-live preconditions above, and the deferred backlog once real singers have used the portal.
