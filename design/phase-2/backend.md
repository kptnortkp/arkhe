# Phase 2 backend design: rehearsals, check-in, attendance, reports

Author: arkhe-backend. Inputs: `design/phase-2/po-spec.md`, `design/phase-2/db.md`, `design/phase-1/review-backend.md`, Next 16.4 docs in `node_modules/next/dist/docs/` (server actions are dispatched **one at a time per client**, `02-guides/server-actions.md#sequential-dispatch-on-the-client`; layouts don't guard segments, `02-guides/authentication.md#layouts-and-auth-checks`). `ux.md` / `ui.md` don't exist yet; I'll reply to them in `review-backend.md` or a follow-up here.

## 0. Cross-cutting rules

- **Every page, action and route handler authorizes itself.** Pages call `requireUser()` / `requireManager()`. Actions call `assertUser()` / `assertManager()`, a new DAL variant that **returns** `{ error: "Bu işlem için yetkin yok." }` instead of `redirect("/")` (AC 6 wants an authorization error from actions). Route handlers return `401`/`403` JSON, never a redirect.
- **Validate every action argument with zod**, bound args included (Phase 1 P3-5): ids `z.uuid()`, statuses `z.enum(ATTENDANCE_STATUSES)`, parts `z.array(z.enum(VOICE_PARTS)).min(1).max(4)`, code `z.string().regex(/^\d{4}$/)`, text fields trimmed with the DBA's limits (title 80, location 120, note 500, excuse 200, term name 40).
- **Identity comes from the session only.** No member-facing action takes a `userId`. Manager actions take a `userId` and check that the target is an active `member`/`board` (or already has a row on that rehearsal, for corrections).
- **Time.** All instants are UTC epoch seconds. Business time is computed on the server with `Date.now()`, never from the client. Europe/Istanbul is used only to turn wall-clock input into instants and back. One module, `src/lib/time.ts`:
  - `istanbulToUtc(date: "YYYY-MM-DD", time: "HH:mm"): Date` derives the offset via `Intl.DateTimeFormat(..., { timeZone: "Europe/Istanbul", timeZoneName: "longOffset" })` (no hard-coded +3, no dependency).
  - `istanbulDayRange(date) -> [start, nextStart)` for terms, "until end of that day" and "today".
  - `istanbulDateOf(instant) -> "YYYY-MM-DD"` and the formatters.
  Never use `new Date(y, m, d)`, `setHours` or `toDateString()` on the server: Vercel runs in UTC, so a 00:30 TRT rehearsal would land on the previous day. Unit-test 00:30 and 23:30 TRT cases.
- **Constants** in `src/lib/attendance/rules.ts`: `CODE_STEP_SECONDS = 30`, `LATE_AFTER_MINUTES = 15`, `OPEN_BEFORE_MINUTES = 120`, `CHECKIN_MAX_WRONG = 5`, `CHECKIN_WINDOW_MS = 5 * 60_000`, `WARN_ABSENT_OF_LAST = [2, 4]`, `WARN_BELOW_PERCENT = 70`, `WARN_MIN_COUNTED = 4`, `SERIES_MAX_WEEKS = 26`.
- **Atomic rate limiting** (lesson from Phase 1 P1-2): insert the attempt first, then count, in one helper `consumeAttempt(key, max, windowMs): Promise<boolean>`. The login limiter and the check-in limiter both use it.

## 1. Rotating code

### 1.1 Algorithm
`step = floor(serverNowSeconds / 30)`;
`code = (HMAC-SHA256(key = code_secret, msg = rehearsalId + ":" + step) → first 4 bytes as uint32 BE) mod 10_000`, zero-padded to 4 digits.

One pure function `codeFor(secret, rehearsalId, step)` in `src/lib/attendance/code.ts` (`node:crypto` `createHmac`), with fixed test vectors. Including `rehearsalId` in the message means two rehearsals open at once (tenor sectional plus soprano sectional) never share codes, even by accident.

Verification accepts `step` and `step − 1` (AC 10: the previous code works, two steps old fails), compared with `timingSafeEqual` on the 4-byte strings. A repeat check-in with the same code is a no-op (§2.1), so codes don't need single-use tracking.

### 1.2 How the manager's screen gets codes: a code schedule, not the secret
@po (Q2), @dba: I propose **not sending `code_secret` to any browser.** The live-screen loader computes a **schedule** of upcoming codes on the server and sends that:

```ts
type CodeSchedule = { serverNow: number; firstStep: number; codes: string[] }; // codes[i] is for step firstStep + i
```

- On load and every 10 minutes (piggy-backed on the 5 s poll response when `codes` runs low), the server returns codes from `step − 1` through `step + 240` (2 hours, ~1.2 KB).
- The client computes `offset = serverNow − Date.now()/1000` once and picks `codes[floor((Date.now()/1000 + offset)/30) − firstStep]`. **This also fixes tablet clock skew**, which the secret-in-the-browser design gets wrong: an iPad whose clock is 40 s off would show a code the server rejects. The countdown ring uses the same corrected clock.
- Offline: the tablet keeps rotating for up to 2 hours with no network (spec §3.8 only needs "a while").
- If the schedule runs out (more than 2 h offline), show `Bağlantı yok, kod yenilenemiyor` instead of a wrong code.

Why this is better than the secret:
- A leaked schedule (screenshot of devtools, a borrowed board phone, a cached RSC payload) is worth at most 2 hours of one rehearsal. A leaked secret is worth the whole open session.
- No Web Crypto on the client. `crypto.subtle` exists only in secure contexts, so a tablet opening the dev server via a LAN IP over http would break, and old iPad Safari support stops mattering.
- One implementation of the HMAC, on the server only, so client and server can't disagree.

If @po/@ui still want the secret on the client, the safeguards are: deliver it only from the `requireManager()` live loader, regenerate it on open (the DBA already does this), `Cache-Control: no-store`, and exclude `/calismalar/*/canli` from any future service-worker cache. With the schedule, all of these apply to the schedule instead.

### 1.3 Where the secret lives
@dba: `code_secret` on `rehearsals` plus "never select it on member paths" depends on discipline. One `db.select().from(rehearsals)` in a member loader, or a `findFirst` without `columns`, would serialize it into a member's RSC payload. Two cheap guards; I'd take (a):
- (a) Move it to a 1:1 table `rehearsal_secrets (rehearsal_id PK → rehearsals cascade, code_secret, rotated_at)`, read only by `src/lib/attendance/code.ts` (`import "server-only"`). Opening a rehearsal upserts the row.
- (b) Keep the column but export a `rehearsalPublicColumns` object and use it in every rehearsal query. A test greps that `codeSecret` appears only in `code.ts`.

Either way, `codeSecret`'s `$defaultFn` doesn't need Web Crypto in `schema.ts` if (a) is chosen; the secret is generated in the server-only module with `randomBytes(32)`.

## 2. Check-in

### 2.1 `checkIn` action (`src/app/(portal)/calismalar/actions.ts`)
Input: `{ rehearsalId: uuid, code: /^\d{4}$/, method: "code" | "qr" }`. Authorization: `assertUser()`; any active role (a conductor checking in is harmless, but the conductor isn't on the roster, so the UI won't offer it).

Steps:
1. `consumeAttempt("checkin:" + rehearsalId + ":" + userId, 5, 5 min)` **before** verifying. On success the attempt row is deleted, so only wrong codes count. Blocked → `Çok fazla hatalı deneme. Birkaç dakika bekle ya da yoklamayı alan kişiye söyle.` even for a correct code (AC 9).
2. Load the rehearsal (PK, public columns plus the secret through `code.ts`). Not found or cancelled → generic `Bu çalışma bulunamadı.`. Not opened yet → `Yoklama henüz açılmadı.`. Closed → `Yoklama kapandı. Geldiysen yoklamayı alan kişiye söyle.` (AC 13). **Check these before the code**, so a closed rehearsal doesn't burn attempts.
3. Verify the code (§1.1). Wrong → `Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.`
4. `status = now > startsAt + 15 min ? "late" : "present"` (server clock; AC 12).
5. Write **one guarded statement** so a check-in can't land after close (a close can commit between steps 2 and 5):
   ```sql
   insert into attendance (rehearsal_id, user_id, status, method, recorded_by, recorded_at)
   select r.id, :me, :status, :method, :me, unixepoch()
   from rehearsals r
   where r.id = :rid and r.opened_at is not null and r.closed_at is null and r.cancelled_at is null
   on conflict (rehearsal_id, user_id) do update
     set status = excluded.status, method = excluded.method, note = null,
         recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
     where attendance.method = 'self'          -- only an advance excuse is overwritten
   ```
   `rowsAffected = 0`: if a row exists, return its current state (idempotent; see below); otherwise the rehearsal closed in between → the "kapandı" message.

Idempotency and overwrite rules (@dba: this differs from your unconditional upsert in §1.5):
- A repeat check-in (double tap, auto-submit plus button, retry after a timeout) changes nothing and returns `YOKLAMAYA KATILDIN` with the existing status. In particular a second submit at minute 16 must **not** downgrade `present` to `late`.
- An advance excuse (`method = 'self'`) is overwritten (spec §3.5).
- **A manager's mark is not overwritten by self check-in.** If the manager marked someone `Gelmedi` because they aren't in the room and a friend then checks them in from outside with a WhatsApp'd code, the manager's decision stands. The member sees `Yoklamayı alan kişi seni zaten işaretledi.` @po: please confirm; it's the only mitigation we have for Q1 apart from watching the list.

### 2.2 QR link and replay
- Format: `/yoklama/kod/<rehearsalId>?c=<code>` (as spec). The code has the same 30–60 s life as the typed code, so a photo of the QR sent to WhatsApp is the same accepted risk as Q1, nothing more.
- **The GET must not write.** WhatsApp/Telegram link previews, Safari prefetch and the login redirect all issue GETs. The page (`requireUser()`, which also covers the logged-out → `/giris?next=…` → back flow) renders a client component that calls `checkIn({ method: "qr" })` once on mount. That's a POST with Next's Origin check.
- Logged-out flow (AC 11): proxy puts `next=/yoklama/kod/<id>?c=1234`. **This depends on the Phase 1 P1-1 fix keeping `search`** (`pathname + search + hash`). Login takes ~15–30 s, inside the 60 s grace. If it takes longer, the page falls back to the code sheet with `Kod yenilendi. Ekrandaki kodu gir.`, pre-scrolled. The expired QR code counts as one wrong attempt; 5 per 5 min leaves enough headroom.
- The code in the URL ends up in access logs and history; harmless after 60 s. `Referrer-Policy: no-referrer` is already global.
- After success, `router.replace("/yoklama/kod/<id>")` to drop `?c=` from history.

### 2.3 Brute force
4 digits, 2 valid codes at any moment: a guess succeeds with p = 2/10,000. At 5 wrong per 5 min per member per rehearsal, a 2.5-hour open window allows 150 guesses, ≈ 3% for a determined member at home, which is far less effective than asking a friend for the code. Accepted. Guards that matter:
- the limiter is atomic (§0), so parallel bursts can't exceed 5;
- a per-user cap of 30 wrong codes per day across rehearsals (`checkin-day:<userId>`), so opening several rehearsals doesn't multiply attempts;
- no IP-based limit (shared choir Wi-Fi would lock everyone out).

## 3. Manager actions

All in `src/app/(portal)/calismalar/actions.ts`, all `assertManager()`, all revalidate `/calismalar`, `/calismalar/<id>` and `/`.

| Action | Input | Rules | Write |
|---|---|---|---|
| `createRehearsal` | type, date, start, end, location, note, title?, parts (sectional only), repeatUntil? | `endsAt > startsAt`, duration ≤ 12 h, not more than 1 day in the past (typo guard), `repeatUntil ≤ start + 26 weeks` and ≥ start date. Non-sectional ⇒ parts ignored. | One transaction: N rehearsals (same `seriesId`) + parts. Each occurrence is `istanbulToUtc(date + 7k days, time)`, so wall-clock is stable. |
| `updateRehearsal` | id + same fields | Not cancelled. If attendance rows exist, allow changing `startsAt` only by ≤ 1 day and warn that statuses aren't recalculated. | update + replace parts in one transaction. |
| `cancelRehearsal` / `uncancelRehearsal` | id | Not opened (DBA CHECK `cancelled_not_open`). Cancel only before `endsAt`. | `cancelledAt/By`; future excuse rows kept (uncancel restores them). |
| `endSeries` | id | Occurrence belongs to a series. | @dba's proposal: delete occurrences of that series with `startsAt > max(now, this.startsAt)` regardless of excuse rows. I agree. The PO's "no attendance records" rule would keep every future occurrence someone excused from. |
| `openAttendance` | id | Not cancelled, not closed, `now ∈ [startsAt − 2 h, end of the Istanbul day of startsAt)`. Idempotent: already open → return. | `openedAt = now`, regenerate the secret (same transaction). |
| `markAttendance` | rehearsalId, userId, status \| null | Target is on the roster or already has a row. `null` (clear) only while open (spec §3.6). Manager can't mark the conductor. | Upsert `method='manual', recordedBy=actor, recordedAt=now, correctedAt = closedAt ? now : keep`; keep `note` when status stays `excused`, clear it otherwise. |
| `markRemainingPresent` | rehearsalId, part | Rehearsal opened and not cancelled. | Single `INSERT … SELECT roster(part) … ON CONFLICT DO NOTHING` (AC 18). Returns the count. |
| `closeAttendance` | rehearsalId, seenUnmarked | Not cancelled; past rehearsals that were never opened may be closed (DBA: `openedAt = coalesce(openedAt, now)`). Idempotent. | Transaction: `update … set closed_at = now where closed_at is null`, then roster `absent/auto` insert `ON CONFLICT DO NOTHING`. If the real count ≠ `seenUnmarked` (someone checked in meanwhile), still close and return the real count for the toast. |
| `createTerm` / `updateTerm` | name, startsOn, endsOn | DBA's overlap check, dates valid, ≤ 1 year long. | plain insert/update. |

Offline retries (spec §3.8) and the sequential action queue:
- Next dispatches one action at a time per client, and a request that hangs on a dead network blocks the queue. The client must abort a mark after ~8 s (`AbortController` isn't available for actions, so wrap it with `Promise.race` and treat the late result as unknown), mark the row `Kaydedilmedi`, and retry on `online`.
- Retries are idempotent because the write is "set status X". **Last write wins** across two managers: a retry from a tablet that was offline for 10 minutes can overwrite a newer correction from a phone. To bound it, the client sends `markedAt` (its corrected clock, §1.2). The upsert's `DO UPDATE … WHERE attendance.recorded_at <= :markedAt` drops stale retries and returns the current row, so the UI shows the newer value. `recorded_at` must then be written from `markedAt` for manual marks, clamped to `[now − 3 h, now]`.
- **Polling must not be a server action** (it would sit in the same queue as marks and delay them by up to 5 s each). Use a route handler (§5).

## 4. Excuses (members)

| Action | Rules | Write |
|---|---|---|
| `excuse(rehearsalId, reason?)` | `assertUser()`; rehearsal not cancelled, `now < startsAt`, caller on its roster (shared roster helper, so AC 5's "not for your part" has no button and the server agrees). No row, or the existing row is `method='self'` (editing the reason). | Upsert `excused/self/note`, `recordedBy = me`. Never overwrites a manager mark. |
| `withdrawExcuse(rehearsalId)` | `now < startsAt` | `DELETE where rehearsal_id = ? and user_id = :me and method = 'self'` (DBA). `rowsAffected = 0` → `Mazeret geri alınamadı; yoklamayı alan kişiye yaz.` |

Reason privacy (AC 16): member loaders select `note` only `where user_id = :me`. The roster helper takes `{ includeNotes: boolean }` and only manager loaders pass `true`. Reasons are rendered as text (React escapes); in CSV see §6.

## 5. Read paths and polling

- **Member pages** (`/`, `/calismalar`, `/calismalar/[id]`, `/yoklama/kod/[id]`): public rehearsal columns, own attendance row, own stats. No other member's status or note. On `/calismalar/[id]` a member sees no roster at all (spec doesn't ask for one).
- **Live poll:** `GET /calismalar/[id]/canli/durum` route handler (`src/app/(portal)/calismalar/[id]/canli/durum/route.ts`):
  - Authorization: `getSessionUser()` + `isManager`, else `401/403` JSON. GET with no side effects, so no CSRF concern; the JSON can't be read cross-origin (no CORS headers).
  - Response: `{ closedAt, rows: [{ userId, status, method, correctedAt, recordedAt }], extras: [{ userId, name, voicePart }], schedule? }`. Names and parts of the roster are sent once by the page, not every 5 s. `extras` covers off-roster check-ins.
  - `?since=<max recordedAt>` returns only changed rows (`attendance where rehearsal_id = ? and recorded_at > ?`). Deletions (cleared marks) need a full refresh, so the client does a full fetch every 60 s or after its own clear. Optional; the full response is ~60 rows anyway.
  - `Cache-Control: no-store`. The client polls only while `visibilityState === "visible"` and the rehearsal is open, with a 5 s interval that backs off to 30 s after network errors.
  - Cost: the DBA's numbers (≈235k rows read per rehearsal, ≈3M per month) hold. That's about 1% of Turso's free allowance; re-check the current quota at go-live. Members don't poll; the home hero re-fetches on `visibilitychange`/focus instead (no timers).
- **Reports:** the DBA's §3 query (rows, aggregate in TS). One function `attendanceStats({ from, to, userId? })` in `src/lib/attendance/stats.ts` (`server-only`) serves `/raporlar`, the CSV, the member's own history and the member-detail summary. Member pages call it with `userId = me` (filtered in SQL, not after the fact). I agree with the DBA's proposal that an unmarked person on a counted, unclosed rehearsal counts as absent in both the percentage and the warning, so they never disagree. The warning's "last 4 counted" = the person's last 4 counted rehearsals with a non-`excused` result (excused ones are skipped, not counted as attended).

## 6. CSV export

`GET /raporlar/csv?period=<termId|son90>&uyari=1` (`src/app/(portal)/raporlar/csv/route.ts`):
- `getSessionUser()` + `isManager`, else `403`. The route handler sits under `(portal)`, but layouts don't apply to route handlers, so this check is mandatory.
- `period` validated (`z.uuid()` existing term, or `son90`); invalid → `400`.
- Body: `"﻿" + rows` joined with `\r\n`, `;` or `,` separator (Turkish Excel expects `;` because the decimal separator is `,`. @po: I recommend `;` and `%` values written like `85`).
- **CSV/formula injection:** names and other fields are user-controlled (a member sets their own name in `/profil`). Every cell is quoted with `"` doubled, and a cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`. Excuse reasons are **not** exported.
- Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="arkhe-devam-2026-27-guz.csv"; filename*=UTF-8''<encoded Turkish name>`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` (already global).
- SameSite=Lax means a cross-site top-level link can trigger the download in a manager's browser, but the attacker can't read it. Acceptable.

## 7. Authorization matrix

| Capability | member | board | conductor |
|---|---|---|---|
| See rehearsal list, own status, own history/percentage | yes | yes | yes |
| Check in, excuse/withdraw (own, roster only) | yes | yes | n/a (not on roster) |
| Create/edit/cancel rehearsals and series, terms | no | yes | yes |
| Open/close attendance, live screen, poll, code schedule | no | yes | yes |
| Mark/correct anyone's attendance, bulk | no | yes (incl. self, spec Q5) | yes |
| Reports, CSV, others' excuse reasons | no | yes | yes |

Every "no" is enforced in the action/handler; hiding buttons is only UX (AC 6).

## 8. Threats and mitigations

| # | Threat | Mitigation |
|---|---|---|
| T1 | Secret leaks to a member (bad `select`, RSC payload) | Code schedule instead of secret (§1.2); secret in `rehearsal_secrets` read only by `code.ts` (§1.3). |
| T2 | Code brute force, parallel bursts | Atomic `consumeAttempt` before verifying; 5 / 5 min per rehearsal plus a 30/day per user cap (§2.3). |
| T3 | Remote check-in via a WhatsApp'd code or QR photo | Accepted (PO Q1). 30 s rotation, live list, manager marks win over self check-in (§2.1). |
| T4 | Check-in after close (race) | Guarded single-statement insert (§2.1 step 5). |
| T5 | Double submit downgrades `present` → `late` | Conflict update only over `method='self'` rows. |
| T6 | GET side effects from link previews/prefetch | QR page writes only via POST action on mount (§2.2). |
| T7 | IDOR: member excuses/withdraws/reads another member | No `userId` in member inputs; notes only for `user_id = me` or managers. |
| T8 | Member calls manager actions/route handlers directly | `assertManager()` in every action, `403` in handlers; e2e AC 6 calls them as `korist@`. |
| T9 | Stale offline retry overwrites a newer correction | `markedAt` + conditional update (§3). |
| T10 | Timezone off-by-one (Vercel UTC) | `src/lib/time.ts` only; unit tests at 00:30/23:30 TRT; terms as `YYYY-MM-DD` ranges (DBA). |
| T11 | Tablet clock skew → wrong codes | `serverNow` offset in the schedule (§1.2). |
| T12 | CSV formula injection via self-chosen names | Quote + `'` prefix (§6). |
| T13 | Huge series / input DoS | ≤ 27 occurrences, field length limits, ids validated. |
| T14 | Poll endpoint load / Turso quota | Route handler (not action), visible-only, managers only, PK/index reads, ~1% of the free quota. |
| T15 | Open redirect through `next` on the QR login flow | Depends on Phase 1 P1-1 fix (origin-checked `safeNext` that keeps `search`). |

## 9. Replies

- **@po Q2:** HMAC is confirmed, but I'd send a 2-hour code schedule rather than the secret (§1.2). It's simpler, survives clock skew and leaks less. Clock tolerance: accept steps `n` and `n−1`, and correct the client clock with `serverNow`.
- **@po Q7:** fine. See §5 and the DBA's numbers.
- **@po Q1 / §3.5:** please confirm "a manager's mark beats self check-in" (§2.1).
- **@po §3.6:** "clear only while open". After close a manager can still change a status but not clear it. Agreed; that keeps reports complete.
- **@po §3.2:** agree with the DBA on `Seriyi bitir` deleting all future occurrences.
- **@dba §1.5 upsert:** make the self check-in conflict update conditional (`where attendance.method = 'self'`) and make the whole insert a guarded `INSERT … SELECT` instead of read-then-write in a transaction. libsql transactions are deferred, and a read followed by a write can hit `SQLITE_BUSY` under the 50-phones-at-once burst; a single statement can't.
- **@dba §1.6 rate limit:** reuse `login_attempts`, yes, but insert-then-count (Phase 1 P1-2 showed count-then-insert lets 34 of 40 parallel tries through).
- **@dba §1.3 `codeSecret`:** please consider `rehearsal_secrets` (§1.3). It also removes the need for Web Crypto in `schema.ts`.
- **@ux / @ui:** the live screen gets `{ serverNow, firstStep, codes[] }` and must use the corrected clock for both the code and the countdown. `data-testid="live-code"` on the code. On the QR page show a spinner while the mount action runs, and never auto-submit twice.
