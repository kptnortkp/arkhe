# Phase 1 backend review (security and correctness)

Reviewer: arkhe-backend. Scope: `src/lib/auth/*`, `src/lib/permissions.ts`, `src/lib/validation.ts`, `src/proxy.ts`, `next.config.ts`, `src/app/giris/*`, `src/app/davet/*`, `src/app/actions/*`, `src/app/(portal)/uyeler/*`, `src/app/(portal)/profil/*`, `scripts/*`.

Method: code read plus live attacks against http://127.0.0.1:3100 (Playwright capture of the real server-action request, then replayed with `fetch`). All test data used `@e2e.test` emails and was deleted afterwards; `login_attempts` was cleared after the rate-limit tests.

## Live test results

| Attack | Result |
|---|---|
| Post-login open redirect: `/giris?next=%2F%09%2Fexample.com%2Fpwned`, then log in as `korist@arkhe.local` | **Exploited.** Browser lands on `https://example.com/pwned`. |
| 40 parallel wrong logins for one email (limit is 5 per 15 min) | **Bypassed.** 34 passwords were checked, only 6 got "Çok fazla hatalı deneme". |
| 30 sequential logins, rotating `X-Forwarded-For`, different emails (IP limit is 20) | **Bypassed.** 0 blocked; DB keys show the spoofed IPs (`ip:10.0.0.1`, …). |
| Server action POST with `Origin: https://evil.example` | Rejected (500, "Invalid Server Actions request"). CSRF on actions is covered by Next's Origin check plus `SameSite=Lax`. |
| 10 parallel `setPassword` calls with the same invite token | Safe: 1 session issued, 9 rejected; GET afterwards shows "Link geçersiz". |
| Board (`yk@`) creates a member with role `board` | Allowed (role stored as `board`). |
| Board opens own `/uyeler/<self>` | "Yenileme linki oluştur" is available, so board can reset its own password without the current one. |
| Board opens the conductor's page | Read-only, no email shown. Correct. |

## P1

### P1-1 Open redirect after login via control characters in `next`
`src/app/giris/actions.ts:21-24`. `safeNext` only rejects `/` or `\` right after the leading slash. `"/\t/example.com"` passes the regex; the WHATWG URL parser strips tab/CR/LF, so the browser resolves it to `//example.com` and Next does a hard navigation off-site. Confirmed live. A phishing link to the real portal (`…/giris?next=%2F%09%2Fevil.tld`) sends a user who just entered real credentials to an attacker page ("oturum süren doldu, şifreni tekrar gir").

Fix: resolve and compare origins instead of pattern-matching.
```ts
function safeNext(next: string | undefined) {
  if (!next) return "/";
  try {
    const base = new URL("http://arkhe.invalid");
    const url = new URL(next, base);
    if (url.origin !== base.origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
```
Also apply it in `src/app/giris/page.tsx:20` before echoing `next` into the hidden input (defence in depth), and add an e2e case for `%09`, `%0a`, `%5c`, `//`.

### P1-2 Login rate limit is check-then-act; parallel requests bypass it
`src/app/giris/actions.ts:33` (check) vs `:52` (record), `src/lib/auth/rate-limit.ts:20-38`. Every request reads the count before any of them has written a failure, and scrypt (~100 ms) keeps the window open. One burst of 40 got 34 guesses through against a 5-per-15-min limit; larger bursts scale linearly. With an 8-character minimum and no common-password check, this is the main defence against online guessing of the conductor's and board's accounts, and it doesn't hold.

Fix: count the attempt before verifying, in one write, and decide from the post-insert count.
```ts
// rate-limit.ts
export async function registerLoginAttempt(email: string) {
  const { emailKey, ipKey } = keysFor(email, await clientIp());
  const since = new Date(Date.now() - WINDOW_MS);
  await db.insert(loginAttempts).values([{ key: emailKey }, { key: ipKey }]);
  const counts = /* same grouped count as isLoginBlocked */;
  return (byKey[emailKey] ?? 0) > MAX_PER_EMAIL || (byKey[ipKey] ?? 0) > MAX_PER_IP;
}
```
In `login`: `if (await registerLoginAttempt(email)) return blocked;` before the user lookup, and on success `clearFailedLogins(email)` as now. SQLite serialises the inserts, so the N-th parallel request sees at least N rows. Note: the attempt timestamp uses `unixepoch()` (second precision); that's fine for a 15-min window.

## P2

### P2-1 `X-Forwarded-For` is trusted blindly
`src/lib/auth/rate-limit.ts:11-14`. The first XFF entry is client-controlled unless the platform overwrites it. Confirmed locally: rotating XFF gives unlimited attempts against the per-IP limit (password spraying across many emails, 1 guess each, never hits the per-email limit). On Vercel the header is overwritten by the edge, so production is protected only by that platform behaviour. Without any header the key is `ip:unknown`, so all clients share one bucket (20 failures then lock out everyone).
Fix: read the IP from a single trusted source selected by env, e.g. `TRUSTED_IP_HEADER=x-vercel-forwarded-for` in production, and fall back to the rightmost XFF hop added by the known proxy; in local dev ignore XFF entirely. Don't fall back to a shared `unknown` bucket for the IP limit; skip the IP limit instead.

### P2-2 Per-email lockout lets anyone lock out the conductor
`src/lib/auth/rate-limit.ts:8,29`. Five wrong passwords from anywhere block `sef@…` for 15 min, renewable forever (a cron of 5 requests every 15 min). Choir-night lockout is a real availability risk.
Fix: key the strict limit on `(email, ip)` (5 per 15 min) and keep a looser global per-email limit (e.g. 50 per 15 min) that only adds a delay. Optional: let a still-valid session on the device skip the block (not applicable at login), or show the reset-link path in the blocked message.

### P2-3 Managers can take over peer and own accounts through reset links, no re-auth
`src/lib/permissions.ts:13-20`, `src/app/(portal)/uyeler/actions.ts:107-116`. `canEditMember` lets a board member act on any non-conductor, including other board members and themselves. Consequences, both confirmed live:
- Board B issues a reset link for board peer C, sets C's password, and is now C (no audit trail). Board can also create new board members (`createMember`, role `board`) and deactivate peers.
- Anyone holding a stolen board session generates a reset link for **themselves** (`createMemberLink(self.id)`), sets a new password without knowing the old one, and `setPassword` (`src/app/davet/[token]/actions.ts:54`) kills the real owner's sessions. Full persistent takeover from a session cookie, bypassing the current-password check in `changePassword`.
Fix: in `createMemberLink` reject `actor.id === id` (self uses `/profil`). Ask @po whether board may manage board: if not, add `if (target.role === "board" || nextRole === "board") && actor.role !== "conductor"` to `canEditMember` (and the UI mirror in `member-form.tsx:107-109`). Either way add a minimal `audit_log` row (actor, target, action, time) for link creation, role change and (de)activation; @dba.

### P2-4 Unauthenticated scrypt before token check (CPU/memory DoS)
`src/app/davet/[token]/actions.ts:20`. `hashPassword` (scrypt N=2^15, ~32 MB, ~100 ms) runs for any random token before the token is checked, with no rate limit. A few hundred concurrent POSTs exhaust a Vercel function's memory/CPU budget (free tier).
Fix: `if (!(await findValidLink(token))) return invalid;` before hashing (keep the atomic claim in the transaction as the real check). The same applies to login when the IP limit is bypassed (P2-1).

## P3

1. **Prior session not revoked on login/invite** — `src/lib/auth/session.ts:14-26`. `createSession` overwrites the cookie but leaves the previous session row valid until expiry (logging in as a second user on a shared phone, or via invite while logged in). Fix: in `createSession`, delete the row for the current cookie token first (reuse `deleteCurrentSession` logic without clearing the cookie).
2. **No cleanup of expired sessions/invites; fixed 90-day sessions** — `session.ts:9`, `set-password-links.ts`. Rows grow forever and a stolen cookie lives 90 days. Fix: opportunistic `delete from sessions where expires_at < now` in `createSession`; consider 30 days sliding (extend when <15 days left).
3. **No "sign out everywhere"** — `src/app/actions/auth.ts:6-9` only drops the current session. Add a `/profil` button calling `deleteUserSessions(user.id)`. Logout itself is fine (POST server action, Origin-checked, cookie deleted, row deleted).
4. **`changePassword` current-password check has no rate limit** — `src/app/(portal)/profil/actions.ts:42`. A stolen session can brute-force the real password (reuse elsewhere). Fix: reuse the login limiter keyed `pw:<userId>`.
5. **Server action arguments are not validated** — `uyeler/actions.ts:82,107,118`. `id` and `active` come from the client as arbitrary JSON (`active` may be a string, object, etc.). No escalation found (authorization runs on the loaded target), but validate: `z.uuid().parse(id)`, `z.boolean().parse(active)`, else return `FORBIDDEN`.
6. **`createMember` unique-email race** — `uyeler/actions.ts:59-69`. Two parallel submits pass `emailTaken` and the second insert throws (unhandled 500). Fix: catch the SQLite `UNIQUE constraint failed: users.email` and return the same field error.
7. **`setPassword` swallows all errors** — `davet/[token]/actions.ts:46`. `.catch(() => null)` turns DB outages into "link invalid". Fix: only map the rollback case to null; log and rethrow others.
8. **Inactive-account message differs from spec** — `giris/actions.ts:51` returns the generic error; `phase1-screens.md:55` wants "Hesabın şu an pasif…" after a correct password. Current behaviour is safer and doesn't leak status; @po: I recommend keeping it generic. If the spec wins, show it only when `ok && user && !user.isActive`.
9. **Proxy public-prefix check is loose** — `src/proxy.ts:10`. `startsWith("/giris")` also matches `/girisXYZ`. Use `pathname === "/giris" || pathname.startsWith("/davet/")`. Only optimistic, but keep it exact.
10. **Auth only in the portal layout for `/repertuvar` and `/yoklama`** — `(portal)/repertuvar/page.tsx`, `(portal)/yoklama/page.tsx`. Static placeholders today, so no leak, but Next's partial rendering can serve a page segment without re-running the layout. Every future page and route handler must call `requireUser()`/`requireManager()` itself (see `node_modules/next/dist/docs/01-app/02-guides/authentication.md` "Layouts and auth checks").
11. **CSP allows `'unsafe-inline'` scripts** — `next.config.ts:7`. Makes the CSP no real XSS defence. Move to a nonce-based CSP in `proxy.ts` (Next supports it) before Phase 3 brings user-supplied Drive links/notes.
12. **Self email change without re-auth** — a manager can edit their own email at `/uyeler/<self>` (`updateMember`). Low risk; disable the email field for `isSelf` or require current password.
13. **Password policy** — 8 chars minimum, no check against common passwords. Combined with P1-2 that is weak. Free fix: reject a small embedded list of the top ~1,000 passwords plus anything containing the user's email local-part or "arkhe".
14. **Demo accounts could reach production** — `scripts/seed.ts:55` blocks non-`file:` URLs, good; but if the prod Turso DB is ever created from the local file (`turso db create --from-file`), the three demo logins with the published password go live. Note it in the deploy checklist; `create-admin` should warn if `*@arkhe.local` users exist.

## What is solid
- Session tokens: 256-bit random, only SHA-256 stored, `HttpOnly`, `SameSite=Lax`, `__Host-` + `Secure` in production; role and `isActive` read live from DB on every request, so demotion/deactivation take effect immediately.
- Invite/reset tokens: hashed, single-use, atomically claimed (verified under 10x concurrency), GET doesn't consume (WhatsApp previews are safe), `Referrer-Policy: no-referrer`, new link revokes old ones, deactivation revokes pending links and sessions.
- Login timing: dummy scrypt hash for unknown or password-less users, one generic error message.
- Mass assignment: zod objects strip unknown keys, so `isActive`/`passwordHash` can't be injected through `updateMember`/`updateProfile`.
- Board can't create, edit, demote or reset a conductor; nobody can change their own role or deactivate themselves.
- Server actions reject foreign `Origin`.
