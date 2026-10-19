# Phase 2 backend review (security and correctness)

Reviewer: arkhe-backend. Scope: `src/app/(portal)/calismalar/actions.ts`, `src/app/api/calismalar/[id]/{durum,isaret}/route.ts`, `src/app/(portal)/raporlar/csv/route.ts`, `src/lib/attendance/*`, `src/lib/api.ts`, `src/lib/time.ts`, `src/lib/auth/rate-limit.ts`, `src/lib/permissions.ts`, the pages that call them, and the client parts that talk to the routes (`src/components/attendance/{live-screen,marking-roster,qr-check-in}.tsx`). Final rules: `po-decisions.md`.

Method: code read plus live attacks on http://127.0.0.1:3100. I inserted an `E2E review` rehearsal straight into the DB (opened, known secret, so I could compute valid codes), captured the real `checkIn` action request from a Playwright session and replayed it, and called the route handlers with demo-account cookies. Everything I created was deleted afterwards. `login_attempts` was cleared (the e2e cleanup does the same).

## Live test results

| Attack | Result |
|---|---|
| 20 parallel wrong check-in codes (limit 5 per 5 min) | Held: 4 evaluated, 16 blocked. A correct code afterwards is blocked too (AC 9). Insert-then-count works. |
| `korist@`: `GET …/durum?kodlar=1`, `POST …/isaret`, `GET /raporlar/csv` | 403, 403, 403. Anonymous `durum` → 401. |
| `POST …/isaret` as conductor with `Origin: https://evil.example` / no Origin | 403 / 403. |
| `POST …/isaret` same-origin with `Content-Type: text/plain` | 200. That's fine: a cross-site text/plain form is stopped by the Origin check. |
| `POST …/isaret` with `Origin: https://evil.example` **and** `X-Forwarded-Host: evil.example` | 200 (see P3-1). A browser can't send this cross-site, so it isn't exploitable as CSRF. |
| Stale offline write: manual `present` now, then `absent` with `markedAt = now − 10 min` | Stale write dropped, row stays `present`. |
| Manager `durum?kodlar=1` | 241 codes, no secret in the payload. Member's `/calismalar/<id>` HTML contains neither the secret nor a code schedule. |
| Phase 1 P1-1 re-test: `next` = `/\t/example.com`, `/\example.com`, `//example.com` | All land on `/`. `/yoklama/kod/<id>?c=1234` keeps its query (QR login flow works). |
| **32 failed logins on random `@e2e.test` emails, then `sef@` with the right password** | **Blocked** ("Çok fazla hatalı deneme"). All attempts share the key `ip:direct`. See P1-1. |

## Verdict on the tech lead's deviations

1. **Open window until `max(end of start's Istanbul day, endsAt)`**: agree. Today the `endsAt` branch never applies, because `createRehearsal` rejects `end <= start` (`actions.ts:70`), so a 21:00–00:30 concert can't be created at all (P3-7). Once that's allowed, the deviation is exactly what's needed.
2. **Manual marks through one batch route handler with its own Origin check**: agree. It avoids the per-client action queue, and the Origin check holds (tests above). Two fixes: don't trust `X-Forwarded-Host` (P3-1), and send a skew-free mark time (P2-1).
3. **Roster/stats in TS over ~60 users instead of the SQL CTE**: agree at this scale. `isExpected` (`roster.ts:34`) is the single definition and stats follow D9 (only closed, non-cancelled rehearsals count). Cost per 5 s poll is one users scan (~60 rows) plus the rehearsal's attendance rows, in line with the DBA's estimate.

## P1

### P1-1 Anyone can lock every user out of login (shared `ip:direct` bucket)
`src/lib/auth/rate-limit.ts:15-19, 27, 47`. Unless `TRUST_PROXY_HEADERS=1` is set, `clientIp()` returns `"direct"` for every request, so the per-IP limit (`MAX_PER_IP = 30`) becomes one global counter. 31 failed logins with any random emails block **all** logins, the conductor's included, for 15 minutes, and a script can repeat that forever. Confirmed live. `TRUST_PROXY_HEADERS` is not in `.env.example`, `CLAUDE.md` or any design doc, so a Vercel deploy gets this behaviour by default.

Fix (both parts):
```ts
// rate-limit.ts
export async function clientIp(): Promise<string | null> {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return null;
  const h = await headers();
  return h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
// registerLoginAttempt: when ip is null, use pair key `${email}|-`, skip the `ip:` key entirely.
```
Also add `TRUST_PROXY_HEADERS=1` (Vercel sets `x-real-ip` itself) with a one-line comment to `.env.example` and the deploy checklist. Add an e2e check: 31 failures on random emails, then `korist@` still logs in.

## P2

### P2-1 Manager corrections silently lost on a tablet whose clock is slow
`src/components/attendance/marking-roster.tsx:172` sends `markedAt: Date.now()` (raw device clock). `isaret/route.ts:49` only clamps it to `[now − 3 h, now]`, and the upsert keeps the newer row (`setWhere recordedAt <= markedAt`, `:92`). On an iPad running 10 minutes slow, every manual mark carries a time 10 minutes in the past, so it loses to any check-in or other mark from the last 10 minutes. Example: a friend checks Ayşe in from outside, the conductor taps `Gelmedi`, and the mark is dropped; the client then clears the pending flag (`marking-roster.tsx:132`) and the row silently snaps back to `Geldi`. This is the scenario D1/D3 rely on. A fast clock is clamped to `now` and always wins, so it fails only one way. The skew offset that `live-screen.tsx:28` computes is not used here, and the detail page has no schedule to compute one from.

Fix: send the mark's **age** instead of an absolute time, so the server's clock decides:
```ts
// client: marks: [{ userId, status, ageMs: Date.now() - p.markedAt }]
// server: const markedAt = new Date(now - Math.min(Math.max(mark.ageMs, 0), 3 * 3600_000));
```
`ageMs` is a difference on one device clock, so skew cancels out. Also return per-mark `applied: boolean` from `isaret`, and show `Daha yeni bir işaret var` on rows that didn't apply, instead of silently dropping them.

## P3

1. **`sameOrigin` trusts `X-Forwarded-Host`.** `src/lib/api.ts:23`. A browser can't set it cross-site, so this isn't CSRF today. But a check that a header can satisfy is fragile, and behind some proxies the header is client-controlled. Compare `Origin` against `new URL(process.env.APP_URL).host`, falling back to `Host` in dev.
2. **The daily check-in cap actually lasts 15 minutes.** `rate-limit.ts:55-57`: every successful login deletes all `login_attempts` older than 15 minutes, including the `checkin-day:<user>` rows (`actions.ts:364-368`). Restrict that cleanup to login keys (`key not like 'checkin%'`), and delete `checkin-day` rows older than 24 h instead.
3. **A double open rotates the secret twice.** `actions.ts:236-250`: when two managers press `Yoklamayı başlat` at the same moment, both pass `phaseOf` and both upsert a new secret. The first tablet then shows codes the server rejects until its schedule runs low (~1 h 50 min later), because routine polls don't refresh the schedule. Fix: `.returning()` on the `openedAt` update and only write the secret when a row was updated. Optionally include `rotatedAt` in every poll and refetch codes when it changes.
4. **`endSeries` can delete the occurrence that's being taken right now.** `actions.ts:212-216`. Called from an older occurrence while the current one is open (opened up to 2 h before start, so `startsAt > now`), it deletes that rehearsal and cascades its check-ins. Add `isNull(rehearsals.openedAt)` to the delete.
5. **`undoBulkPresent` works after close.** `actions.ts:306-324`. Deleting rows from a closed rehearsal leaves expected people with no row, and stats (`stats.ts:74`) then silently drop them from the denominator. `isaret` already forbids clearing after close (`route.ts:51`); add `closedAt is null` to the undo.
6. **Editing type/parts of a closed rehearsal changes who is expected without rows.** `actions.ts:157-183`. A closed sectional turned into tutti adds expected people with no row, and they're silently excluded from stats. Reject type/parts changes once `closedAt` is set, or re-run the absent fill after the update.
7. **No overnight rehearsals.** `actions.ts:70` rejects `end <= start`. For concerts ending after midnight, accept `end < start` as next day: `endsAt = istanbulToUtc(addDays(date, 1), end)`.
8. **Date/time inputs aren't range-checked.** `actions.ts:43-44`: `2026-02-30` or `25:70` pass the regex, and `Date.UTC` rolls them into another day. Check with `istanbulDateOf(istanbulToUtc(date, time)) === date` and the time round-trip, else return a field error.
9. **`submitExcuse` can report success it didn't do.** `actions.ts:435-455`: if a manager marks the member between the `existing` read and the upsert, `setWhere method='self'` makes the write a no-op, but the action still returns `Mazeretin iletildi.` Use `.returning()` and return the "zaten işaretledi" error when nothing was written.
10. **The conductor can check in.** `checkIn` doesn't exclude `role === "conductor"`, so a row appears under `Listede olmayanlar` on the live screen. Stats ignore it. Return `NOT_FOUND`-style text for the conductor.
11. **Close computes absentees outside its transaction.** `close.ts:10`. A manager `İşareti kaldır` (delete) that lands between the roster read and the commit leaves that person unmarked on a closed rehearsal, and so uncounted. It's tiny and only affects open rehearsals. Move `unmarkedExpected` inside the transaction, or after the `closedAt` update do the absent fill as a single `INSERT … SELECT` over the roster.
12. **GET requests write.** `autoCloseStale()` runs on every member page view (`/`, `/calismalar`, `/yoklama/kod`) and in `durum`. That's D8 by design and idempotent. Just keep it cheap: it's one indexed query per request now. Don't add work to it.

## What is solid

- Every action starts with `assertUser`/`assertManager` and zod-validates ids; every route handler calls `managerOrError()`; every manager page calls `requireManager()`, including the `(live)` group, whose layout does no auth.
- The secret lives in `rehearsal_secrets`, read only by `code.ts`. Rehearsal reads go through `publicColumns`. The live screen gets a 2-hour code schedule and corrects its clock with `serverNow`.
- Check-in follows D3: repeat check-ins are no-ops, a manager's mark wins, the write is a single guarded `INSERT … SELECT … ON CONFLICT … WHERE method='self'` so nothing lands after close, and the rate limit is consumed before the code is verified.
- Excuse reasons: `rosterOf({ includeNotes })` is false on every non-manager path, member queries are keyed by session user id, the CSV has no reasons and neutralises formula cells (`csv.ts:7`). No IDOR found: no member input carries a `userId`.
- Time: all instants are UTC. `src/lib/time.ts` derives the Istanbul offset with `Intl`, and terms are half-open Istanbul day ranges (`period.ts:24-25`).
- Phase 1 fixes verified: `safeNext` (origin-based), the token is checked before scrypt in `setPassword`, and `canIssueLink` blocks board from issuing links for self and other board members.
