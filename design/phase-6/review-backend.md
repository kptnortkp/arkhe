# Phase 6: backend and security review (arkhe-backend)

Author: arkhe-backend. Date: 2026-10-19. Scope: everything WP4, WP5, WP9 (proxy/SW), WP12 and WP13 touched, plus a fresh authorization sweep of every server action and route handler. I wrote much of WP4/5/13 myself, so I reviewed it as an attacker would and didn't assume my own plan was right.

Method: I read `po-spec.md`, `po-decisions.md`, `implementation-notes.md` and `backend.md`, then the code. I used curl against the running dev server (http://127.0.0.1:3100) and no cookie unless stated. I did not run e2e or builds and did not edit `src/`. Where a claim depends on production-only behaviour I couldn't run, I say so and name the one-line check that would confirm it.

**Totals: P1 0 · P2 2 · P3 13.**

---

## What holds (verified)

- **Server-action authorization is intact.** All 61 exported actions in the 10 `"use server"` files call `requireUser`/`requireManager`/`assertUser`/`assertManager` as their first statement. The exceptions are `login` (pre-auth by design), `logout` (only touches its own cookie) and `setPassword` (gated by the token, which is claimed atomically). Every route handler checks auth itself: `managerOrError` in both `/api/calismalar/*` handlers and all three CSVs, and `sameOrigin` on the mutating one. The only public handler is `/api/saglik`. Every page calls the DAL or redirects (`yoklama/page.tsx` only redirects).
- **`duesAuditOf`** (`src/lib/finance/queries.ts:655`) calls `requireManager()`, checks the uuid, returns finished strings only and serialises no ids or editor ids. The page fetches it only when a sheet is open. Finance is manager-wide, so there's no role widening.
- **Demo refusal.** Every path is closed: `login()` is folded into the generic branch (`giris/actions.ts:61`), and `getSessionUser()` covers sessions, actions, route handlers and the live screen (`session.ts:62`). An invite or reset for a demo user in production can set a password, but the session it creates is then refused. `create-admin` refuses demo emails on a remote DB or under production (`scripts/create-admin.ts:16`). `seed.ts` against a production `file:` DB on a VPS (shell without `NODE_ENV`) is still allowed, but the accounts it creates can't log in.
- **Flash.** It holds a key from a fixed map, read with `Object.hasOwn`, and is `Secure` in production.
- **CSP and nonce.** The nonce is fresh per request. Spoofed `x-nonce` and `content-security-policy` request headers are overwritten, and `-report-only` is deleted. There is no inline-script sink in `src/` (no `dangerouslySetInnerHTML` or `next/script`).
- **Headers.** Present on HTML and JSON, with no `X-Powered-By` (curl `/giris`, `/api/saglik`). `/sw.js` and `/offline.html` get their own CSP and cache headers.
- **`/api/saglik`.** It answers `{"ok":true}` with `no-store`, and `POST` gets 405. There's no version, count or error text in the body, and the logged error never includes the token.
- **Env check.** It never prints `DATABASE_URL` or the token. `APP_URL` is echoed only as `protocol//host`.
- **The service worker can't leak pages or data.** The order is: non-GET → cross-origin → navigation (network, offline fallback, never stored) → `/api/` and RSC bail out → an allow-list of static paths. HTML responses are `no-store` in any case. After logout, nothing personal is left in Cache Storage.
- **Input hygiene.** Every free-text zod field in actions now goes through `cleanText`/`cleanLine` (`optionalText`, `nameSchema`, `voidReason`, waiver, period, event, sponsor, payment info, piece title, link labels, term). The remaining non-cleaned strings are enum, uuid, date, amount or URL fields, or `login.email` (lookup only). U+202E, U+2066–2069, C0/C1, ALM, LRM/RLM and BOM are stripped (I checked against the regex bytes). CSV cells keep the formula-prefix guard (`src/lib/csv.ts:4`).
- **Finance changes.** `voidEntry` deletes the freeze only under `notExists(live payment)` in the same `writeTx`. Replay checks `memberId` and `createdBy`. `guarded` maps FK, UNIQUE and CHECK errors and rethrows `NEXT_REDIRECT`. Date bounds are read per call in Istanbul time. Opening amounts of `0`, `0,00` and `0.00` mean none.

---

## P2

### P2-1. Without a trusted IP, six anonymous requests lock any account out of login for 15 minutes, renewable forever
`src/lib/auth/rate-limit.ts:31-33` and `:54`. When `clientIp()` is null (`TRUST_PROXY_HEADERS` unset), the "pair" bucket becomes `email|?`. That bucket is shared by the whole internet and is blocked after `MAX_PER_EMAIL_IP = 5`.

**Exploit:** on the documented Render fallback (README says to leave the flag unset there), or on Vercel if the deployer forgets the flag, anyone who knows the conductor's email can POST six wrong passwords. Real logins for that email then get `Çok fazla hatalı deneme yapıldı…` for 15 minutes, and a cron of six requests every 15 minutes keeps it that way. Existing 90-day sessions survive, but a new phone, a cleared browser or an expired session on rehearsal night can't get in, and neither can a member on their invite day. The comment on `MAX_PER_EMAIL` ("high enough that a stranger can't easily lock the conductor out") shows the intended design. The `?` pair quietly undoes it. AC 26 says "only the per-email limits apply", which reads as 30, not 5.

**Fix:** with no trusted IP, skip the pair bucket so only `email:` (30 per 15 min) applies.

```ts
const keys = ip
  ? { pair: `${email}|${ip}`, email: `email:${email}`, ip: `ip:${ip}` }
  : { email: `email:${email}` };
// …
const blocked =
  (keys.pair !== undefined && (n[keys.pair] ?? 0) > MAX_PER_EMAIL_IP) || …
```

`forgetLoginAttempts(…, pairKey)` then takes `keys.pair ?? keys.email`. That costs at most 30 guesses per account per 15 minutes against scrypt and the minimum password length, which is acceptable for about 60 accounts.

The AC 26 e2e then asserts that the spoofed `X-Forwarded-For` values created no `email|<ip>` or `ip:` rows (query `login_attempts.key`), instead of "locked after 5". If the PO prefers to keep the lock-at-5 behaviour, record it in `po-decisions.md` as an accepted risk and add a README line next to the Render fallback ("anyone can lock an account's new logins for 15 min"). It must not stay implicit.

### P2-2. Logout doesn't clear `__Host-arkhe_session` in production
`src/lib/auth/session.ts:32`: `store.delete(SESSION_COOKIE)`. Next's `ResponseCookies.delete(name)` (`node_modules/next/dist/compiled/@edge-runtime/cookies/index.js:302-304`) serialises `__Host-arkhe_session=; Path=/; Expires=Thu, 01 Jan 1970…` **without `Secure`**. Browsers reject any `__Host-` cookie that isn't `Secure`, deletions included, so the stale cookie stays in the jar for up to 90 days.

**Failure:** the server-side row is deleted, so the token is dead and this isn't an account takeover. That's why AC 17 still passes. But:
- (a) After logout, the proxy sees a session cookie and lets every path through. The portal then redirects to `/giris` from the DAL, without `?next=`.
- (b) On a shared or borrowed phone, the jar keeps a session-shaped secret.
- (c) If the session deletion ever fails or races (for example `deleteCurrentSession` throws after a Turso blip), the user is told they're logged out while their still-valid token stays in the browser. That's the case where it matters.

This is production-only; the dev cookie has no prefix, so dev e2e can't see it. To confirm, assert in `e2e/prod.mjs` that the logout response's `Set-Cookie` contains `Secure`, or that `context.cookies()` no longer has `__Host-arkhe_session` after logout.

**Fix:**

```ts
store.delete({ name: SESSION_COOKIE, path: "/", secure: secureCookies, httpOnly: true, sameSite: "lax" });
```

Add the prod-e2e assertion above. Also have `deleteCurrentSession` clear the cookie even when the DB delete throws (`try/finally`).

---

## P3

### P3-1. The proxy matcher skips any path ending in an image extension, so real HTML pages render without CSP
`src/proxy.ts:60`: `.*\.(?:svg|png|ico|webp|jpg|jpeg|webmanifest)$` matches at any depth. `curl /davet/abc.png` returns 200 HTML (the invalid-link page) with **no `Content-Security-Policy`** and no nonce, while `/davet/abc` has one. The same happens for every 404 such as `/x.svg`. Auth isn't bypassed: the DAL still redirects, and `/uyeler/x.png` gave a 307 to `/giris`. `X-Frame-Options: DENY` still comes from `next.config.ts`. So this is defence in depth: AC 19 promises a CSP on every page, and an attacker can strip it from any dynamic page by appending `.png`.

**Fix:** only skip root-level metadata files, and keep `brand/` and `icons/` as directory prefixes:

```
"/((?!_next/static|_next/image|brand/|icons/|sw\\.js$|offline\\.html$|[^/]+\\.(?:svg|png|ico|webmanifest)$).*)"
```

`webp`/`jpg` live only under `/brand/`. Add one e2e: `/davet/x.png` has a CSP header.

### P3-2. The replay success message claims periods that were never paid
`src/app/(portal)/finans/aidat/actions.ts:95-98`. The form keeps one `clientId` per mount (`payment-form.tsx:34`). Suppose the first submit for period A committed but the response was lost (a timeout shown as an error), and the treasurer then ticks A and B in multi mode and resubmits. `existing` finds A's row, and the action returns `Ödeme alındı: … (A, B)` with A's total. B was never recorded. The money isn't wrong, but the message is, and a treasurer reads it as a receipt.

**Fix:** select `duesPeriodId` in `existing` and build the message from the existing rows' periods, `paidMessage(total, existing.map(e => e.periodId))`. Optionally return `STALE` when the request's `periodIds` aren't a superset of the existing rows.

### P3-3. `cleanText` regex holds invisible raw characters, and a few invisible characters still pass
`src/lib/text.ts:3`. Bytes `d8 9c e2 80 8e e2 80 8f e2 80 aa 2d e2 80 ae e2 81 a6 2d e2 81 a9 ef bb bf` are literal U+061C, U+200E/F, U+202A–202E, U+2066–2069 and U+FEFF. Nobody can see them in review or a diff, and an editor or formatter that normalises them silently disables AC 28. Write them as `؜‎‏‪-‮⁦-⁩﻿`.

Also still passing (tested with `cleanLine`): U+2028/2029, which become a line break inside "single-line" names; U+200B, U+2060–2064, U+00AD; tag characters U+E0000–E007F; and U+3164 / U+115F (Hangul fillers). A name of `ㅤㅤ` passes `min(2)` and renders blank, and `Ayşe​Yılmaz` can impersonate another singer in rosters.

**Fix:** add `  ​⁠-⁤­ᅟᅠㅤﾠ` and `\u{E0000}-\u{E007F}` (with the `u` flag) to `INVISIBLE`. ZWJ and ZWNJ stay.

### P3-4. Single-line fields use the multi-line cleaner
`optionalText` keeps `\n`, but it's used for one-line fields:
- `calismalar/actions.ts:53-54` (rehearsal `title`, `location`)
- `repertuvar/actions.ts:64-65` (and `language`, `voicing`)
- `finance/schemas.ts:88-89` (`description`, `counterparty`)
- `aidat/actions.ts:433` (rate `note`)

A pasted newline survives into lists, CSV cells and `flagsOf` (`finans/aidat/page.tsx`). **Fix:** add `optionalLine(max)` built on `cleanLine` and use it for those fields. Keep `optionalText` for `note` and `description` on rehearsals and homework, and for feedback.

`scripts/create-admin.ts:9,29` stores `name` raw. Apply `cleanLine(name).trim()` and require 2–80 characters, like `nameSchema`.

### P3-5. The service worker's `Set-Cookie` guard is a no-op
`public/sw.js:58`. `Set-Cookie` is a forbidden response header name, so `res.headers.has("set-cookie")` is always false in a worker. Safety today comes from the path allow-list and `res.type === "basic"`, not from this check, but the comment and AC 15 imply a guard that doesn't exist. **Fix:** delete the line and add a one-line comment saying the allow-list is the guard, so nobody later widens the allow-list relying on it.

### P3-6. The choir photo is public and guessable
`public/brand/stage-choir.webp` is imported by the logged-in home (`(portal)/page.tsx:4`) but also served without auth at `/brand/stage-choir.webp` (curl: 200, matcher-excluded). Brand-integration A2 and the spec's out-of-scope list say member photos stay off public surfaces until the board consents. **Fix:** move the source to `src/assets/` (statically imported, so it ships only under a content-hashed `/_next/static/media/…` URL). Better still, leave it out until consent is recorded. The hashed copy is still technically public, so this is "not guessable", not "private"; note that in `STATUS.md`.

### P3-7. IPv6 clients get a fresh per-IP bucket for every address
`src/lib/auth/rate-limit.ts:18-20`. With `TRUST_PROXY_HEADERS=1` on Vercel, an attacker with a /64 (any home IPv6 line) rotates addresses, which defeats `MAX_PER_IP` (spraying many emails from one place). **Fix:** when the IP contains `:`, key the bucket on the first four hextets (`ip.split(":").slice(0, 4).join(":") + "::/64"`), after expanding `::`. Or accept it and note it in `po-decisions.md`.

### P3-8. Unauthenticated writes can burn the free-tier quota
`rate-limit.ts:36-39` inserts 2–3 `login_attempts` rows per login POST, including blocked ones (insert-then-count), and only a *successful* login prunes rows older than 24 h (`:65-67`). A scripted flood of `/giris` POSTs is cheap: blocked requests skip scrypt, but every one costs Turso row writes and storage, plus Vercel invocations. On a zero-budget deployment, exhausting the free tier takes the whole portal down. A WAF is out of scope, but two cheap mitigations fit the current code:
- (a) when `blocked`, delete the just-inserted rows, or insert only after a successful count, so a lockout stops the growth;
- (b) prune `< now − 24 h` on every attempt with a `LIMIT`, not only on success.

Also add a README line under "Free-tier limits": watch Turso's usage page, and if it spikes, rotate the token and redeploy.

### P3-9. `APP_URL=http://localhost` passes the production check on Vercel or Render
`src/lib/env.ts:16` allows loopback `http:` whenever `NODE_ENV=production`, which prod-e2e needs. On Vercel or Render, though, that value means every invite and reset link points at the member's own phone. **Fix:** when `env.VERCEL || env.RENDER`, require `https:`, whatever the host. That's one extra condition and doesn't affect prod-e2e, which sets neither variable.

### P3-10. The README puts long-lived Turso secrets in shell history
`README.md:48, 53, 58-59, 72`. Inline `DATABASE_AUTH_TOKEN=<token> npm run …` lands in `~/.zsh_history` or `~/.bash_history` on the laptop. Step 1 also creates a single full-access, non-expiring token used everywhere. **Fix:** in step 1, create two tokens:
- Vercel: `turso db tokens create arkhe`
- laptop: `turso db tokens create arkhe --expiration 7d`, created fresh per maintenance session

Show the laptop pattern as `read -rs DATABASE_AUTH_TOKEN && export DATABASE_AUTH_TOKEN DATABASE_URL=libsql://…`, then run the npm commands and `unset DATABASE_AUTH_TOKEN DATABASE_URL` at the end. Add one line: "If a token leaks, `turso db tokens invalidate arkhe`, then update Vercel and redeploy." (`invalidate` rotates every token of the DB.)

### P3-11. The README doesn't say to keep production secrets out of Preview deployments
`README.md:64` says "(Production)" but doesn't forbid ticking Preview. If the deployer applies the variables to all environments, every pushed branch's preview runs unreviewed code against the live member DB. **Fix:** add "Tick **Production only**. Preview deployments then fail the boot check (`DATABASE_URL is required`), which is intended."

### P3-12. A typo in `TRUST_PROXY_HEADERS` stops the server with no hint on Vercel
This is a doc nit. `env.ts:47` fails boot for any value other than `1`, as decided. README step 6 says a 500 on every page "usually means a bad env variable; the function log names it". Add where the log is (Vercel → Project → Logs, filter "Invalid environment"), because `process.exit(1)` in a function shows only as `FUNCTION_INVOCATION_FAILED` on the page.

### P3-13. `sameOrigin` trusts `X-Forwarded-Host` when no proxy sets it
`src/lib/api.ts:23`. This is fine in browsers: a cross-site page can't set that header without a preflight, and the `SameSite=Lax` cookie isn't sent on cross-site POSTs anyway. But under `next start` with no proxy (the Render model, if Render ever passes the header through), the check is only as strong as the cookie's `SameSite`. This is pre-existing and is noted so the next change doesn't weaken `SameSite`. No change is needed now. If the check is touched again, compare `Origin` against `new URL(process.env.APP_URL).host` in production, which is fixed and validated at boot.

---

## Checked and not a finding

- **`safeNext`** (`giris/actions.ts:22`) handles `//evil`, `/\evil` and tabs. **`safeReturn`** limits redirects to `/finans` paths.
- **Session cookie in production:** `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain` (prod-e2e asserts this). `arkhe_fin_hesap` is `httpOnly`, has `Path=/finans` and is `Secure` in production. The flash cookie is cleared client-side with `Secure` on https.
- **CSP policy:** `strict-dynamic` with nonce, no `unsafe-inline` in `script-src`, `unsafe-eval` only in dev, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Spoofed request headers can't inject a nonce. The nonce appears in the `Link` preload header of the same response, which is expected.
- **Health:** `/api/saglik` has no auth and no rate limit (accepted, D29). It returns only fixed bodies, and the 3 s race and `clearTimeout` are correct.
- **`sw.js` kill switch and update path:** `no-store` plus `updateViaCache: "none"`. The precache uses `redirect: "error"` and `credentials: "omit"`, so a login redirect can never be precached.
- **Timezones:** `formatAuditDate`, `inDateBounds` and the opening cap all use Istanbul time, computed per call, never at module load.
- **`create-admin`:** the demo guard uses lowercased, trimmed input. Promoting an existing email to conductor is intended for a CLI holder.
- **Backups:** README says they hold PII, stay under the git-ignored `/data/`, and must never be committed.
