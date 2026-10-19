# Phase 2 review: database layer (DBA)

Scope: `src/db/schema.ts`, `drizzle/0000_baseline.sql` + `meta/`, `package.json` db scripts, `src/lib/attendance/*`, `src/lib/auth/rate-limit.ts`, `src/app/(portal)/calismalar/actions.ts`, `src/app/api/calismalar/[id]/{isaret,durum}/route.ts`, `src/app/(portal)/uyeler/actions.ts` (joined/left), the callers of `autoCloseStale` / `attendanceStats`, and the live `data/arkhe.db`. Inspection was read-only; I ran the write tests on a copy in the scratchpad.

**Verdict: no new P1 in the Phase 2 code.** The schema matches `db.md` closely, and the constraints really fire (tested below). The guarded check-in statement is correct. The remaining P1 is the go-live gate carried over from Phase 1: backups and the FK check.

## What I verified

| Check | Result |
|---|---|
| Baseline | `drizzle/0000_baseline.sql` has 20 CHECKs, all FKs with the planned on-delete rules, and all indexes. `__drizzle_migrations` holds one row whose hash matches the journal. `db:push` has been removed from the scripts. |
| `PRAGMA integrity_check` / `foreign_key_check` | `ok` / no rows |
| Closed rehearsals with an expected person but no row | 0, so closing materialises the roster as designed |
| Opened rehearsals without a secret | 0 |
| `users_left_matches_active` | Setting `is_active=0` without `left_at` → `CHECK constraint failed` |
| `attendance.user_id … restrict` | `DELETE FROM users` for a member with history → `FOREIGN KEY constraint failed` |
| Check-in `INSERT … SELECT … ON CONFLICT DO UPDATE … WHERE attendance.method='self'` | Inserts `present/code` on an open rehearsal. The `WHERE` on the `SELECT` also avoids SQLite's documented upsert-after-SELECT parsing ambiguity. |
| `drizzle-kit migrate` and FKs | `@libsql/client.migrate()` runs `PRAGMA foreign_keys=off` *before* its transaction, so future table rebuilds (`users`, `rehearsals`) won't cascade-delete sessions or hit the `restrict`. FKs are unchecked during migrations, though (see P2-5). |
| Query plans | `rehearsals` range reads use `rehearsals_starts_idx`; `attendance` reads use the PK or `attendance_user_idx`; the rate-limit count uses a covering `login_attempts_key_idx`. |

## "Who is expected" computed in TS (`roster.ts` / `stats.ts`) instead of the SQL CTE: verdict

**Acceptable, arguably better at this scale.** `isExpected()` is the single definition, shared by roster, close, bulk mark, excuse and stats, and it's unit-testable. The cost is loading all users (≈60 rows) per call. That's fine locally and on Turso: each call reads ~60 rows, about the same as the SQL join would. Keep it. There are two consequences, and P2-1 and P3-1 fix them.

## P1 (carried over from Phase 1: a go-live gate, not a Phase 2 blocker)

### P1-A Backups and the FK check script still don't exist
This is unchanged from Phase 1 review-db P1-1 and P1-2. The migration half is done. Before the first real member is imported on Turso, two things must exist:
1. `scripts/db-check.ts`: assert `PRAGMA foreign_keys = 1` and that `PRAGMA foreign_key_check` returns no rows, against `DATABASE_URL`.
2. `scripts/backup.ts`: export every table to one JSON/SQL file via `@libsql/client`.

Without git or CI, the zero-cost minimum is to run `npm run db:backup` by hand before every `db:migrate` against Turso and weekly, and keep the files outside the repo. They contain personal data (names, phones, excuse reasons), so encrypt them with `age` if they leave the laptop. Once there is a GitHub repo, move this to a nightly Actions cron as described in Phase 1 review-db P1-1.

## P2

### P2-1 Reports rewrite history when a member's voice part, role or join date changes
`attendanceStats` recomputes `isExpected(person, r)` with the user's **current** `voice_part`, `role` and `joined_at` for every past closed rehearsal. Examples:
- An alto moves to soprano in week 8. Her `absent/auto` rows from past alto sectionals are now "not expected", so they're dropped (only present/late count off-roster), and her percentage goes up.
- A manager edits `joined_at` backwards. Past closed rehearsals now "expect" her, find no row, and silently skip.
- A board member promoted to conductor disappears from past reports.

Choir members do change parts. Closing already **freezes the roster as rows** (every expected person gets a row; verified 0 gaps), so for closed rehearsals the rows are the truth:

```ts
// stats.ts: counted = closed, not cancelled. Use the rows as the frozen roster.
const marks = await db
  .select({ rehearsalId: attendance.rehearsalId, userId: attendance.userId, status: attendance.status })
  .from(attendance)
  .where(and(inArray(attendance.rehearsalId, ids), userId ? eq(attendance.userId, userId) : undefined));
// history = every mark of the person on a counted rehearsal; no isExpected() here.
```

Then `loadRosterUsers()` is only needed for name/part/conductor filtering, and `partsByRehearsal` drops out of stats entirely. Off-roster `present/late` rows are still counted (D13); off-roster `absent` rows can't be created (the mark route skips non-expected people without a row). This also fixes P3-2.

### P2-2 `autoCloseStale()` scans every past rehearsal on every page view and every 5 s live poll
The query is `opened_at is not null and closed_at is null and starts_at < now`. The plan is `SEARCH rehearsals USING INDEX rehearsals_starts_idx (starts_at<?)`, which visits **every past rehearsal row** to find the zero or one that is open. It runs on `/`, `/calismalar`, `/calismalar/[id]`, `/raporlar`, CSV, the QR page, the live page **and the 5 s poll**. Weekly tutti plus sectionals come to ~150 rows a year: after two years that's ~300 rows × 1,800 polls ≈ 540k rows per rehearsal from the poll alone, plus every member's page views. That's still inside the Turso free tier, but it's the one cost here that grows without bound. Use a partial index, which turns it into a read of 0–1 rows:

```ts
index("rehearsals_open_idx")
  .on(t.startsAt)
  .where(sql`opened_at is not null and closed_at is null`),
```

Then run `db:generate`, which gives `0001_*.sql` with `CREATE INDEX … WHERE …`, a plain additive migration. Also drop `autoCloseStale()` from the `durum` poll route: the live page already ran it on load, and a rehearsal can't go stale during the 2.5 h it's being polled.

### P2-3 The mark route does 2–3 sequential round trips per mark and isn't batched
`POST /api/calismalar/[id]/isaret` loops over up to 100 marks, and each iteration does `select hasRow` plus an `insert … on conflict` (or a `delete`). An offline batch replayed after reconnecting (D23) with 40 marks means ~80–120 sequential statements. That's instant on a local file, but several seconds on Turso over HTTP from a free-tier region, while the tablet shows `Kaydedilmedi`. Fix: read the rehearsal's rows once and send all writes as one batch (one round trip, atomic):

```ts
const existing = new Set(
  (await db.select({ u: attendance.userId }).from(attendance).where(eq(attendance.rehearsalId, id))).map((x) => x.u),
);
const statements = [];
for (const mark of parsed.data.marks) {
  // …same validation, using existing.has(mark.userId) instead of the per-mark select…
  statements.push(mark.status === null ? db.delete(attendance).where(…) : db.insert(attendance).values(…).onConflictDoUpdate(…));
}
if (statements.length) await db.batch(statements as [typeof statements[0], ...typeof statements]);
```

The `recorded_at <= markedAt` stale-write guard stays per statement, so replays are still idempotent.

### P2-4 The per-day check-in cap is silently cut to 15 minutes
`consumeAttempt("checkin-day:<user>", 30, 24h)` relies on rows living 24 h, but `forgetLoginAttempts()` (every successful login) runs `DELETE FROM login_attempts WHERE attempted_at < now − 15 min` for **all keys**. So D6's daily cap only holds until someone in the choir logs in. Make the cleanup keep the longest window:

```ts
const LONGEST_WINDOW_MS = 24 * 3600_000; // keep in sync with the day-long check-in cap
await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(Date.now() - LONGEST_WINDOW_MS)));
```

That's one row per wrong attempt, so the table stays tiny. The cleanup `DELETE` is a full scan (`SCAN login_attempts`), which is irrelevant at this size; add `index("login_attempts_at_idx").on(t.attemptedAt)` only if it ever matters.

### P2-5 Migration hygiene going forward
- `drizzle-kit migrate` disables FKs for the whole migration (see above). Every migration that rebuilds a table therefore has to be followed by `PRAGMA foreign_key_check` (which `scripts/db-check.ts` from P1-A covers). Make this the rule: `db:backup && db:migrate && db:check`, in that order, against Turso.
- Never edit `0000_baseline.sql` once it has run on Turso. Its hash is in `__drizzle_migrations`, and an edited file is skipped silently.
- `db:reset` (`rm -f data/arkhe.db* && migrate && seed`) is local-only by construction, because the seed refuses non-`file:` URLs. But `drizzle-kit migrate` in the middle runs against whatever `DATABASE_URL` is in `.env`. If `.env` ever points to Turso, `db:reset` migrates production and then fails at the seed. Guard it: `"db:reset": "node -e \"if(!(process.env.DATABASE_URL??'file:').startsWith('file:'))process.exit(1)\" && rm -f data/arkhe.db* && drizzle-kit migrate && npm run seed"` (or move it into `scripts/reset.ts`).

## P3

- **P3-1 `closeRehearsal` computes the absentees outside its transaction.** A mark that a manager *clears* between that read and the insert leaves an expected person unmarked on a closed rehearsal, and with P2-1 they'd simply not count. That's harmless, but move `unmarkedExpected()` into the transaction (pass `tx`) so "closed ⇒ complete roster" is a real invariant.
- **P3-2 A member's own stats read the whole choir's marks.** `attendanceStats({ userId })` still loads every attendance row of the period (≈60 × 40) on each home or `/calismalar` view. The P2-1 code filters by `userId` in SQL (`attendance_user_idx`).
- **P3-3 `expectedFor()` loads all users to find one.** Use `where(eq(users.id, userId))`.
- **P3-4 Three planned CHECKs are missing from the baseline:** `terms_dates_format` (`glob 'YYYY-MM-DD'`), `users_left_after_joined` (`left_at is null or left_at >= joined_at`; `joined_at` is now editable, so a manager can set it after `left_at`), and `piece_files` kind/voice checks. Add them in the same `0001` as the P2-2 index. `users` will be rebuilt; that's fine, see P2-5.
- **P3-5 Two clocks.** Check-in writes `recorded_at = unixepoch()` (the DB clock on Turso), while `late` and the `markedAt` guard use the app server's clock. Use JS for both: pass `${Math.floor(Date.now() / 1000)}` instead of `unixepoch()` in the guarded insert.
- **P3-6 Fixed sequences belong in `db.batch`, not interactive transactions.** `createRehearsal` (rehearsals + parts), `openAttendance` (open + secret upsert) and `updateRehearsal` are fixed statement lists. On Turso, `db.transaction` holds a write transaction across several network round trips, while `db.batch([...])` is one atomic request. Keep `db.transaction` only where a read decides the write (`closeRehearsal`).
- **P3-7 Race guards in the `WHERE`.** `setCancelled` checks `openedAt` in JS and then updates. Add `isNull(rehearsals.openedAt)` to the update's `where` so a concurrent open returns "not cancelled" instead of a CHECK-failure 500. `endSeries`: add `isNull(rehearsals.openedAt)` to the delete as cheap insurance against an edited occurrence that has been moved and opened.
- **P3-8 The live poll reads the rehearsal twice.** `liveSnapshot` → `getRehearsal` and `rosterOf` → `loadRehearsalForRoster` each read the rehearsal and its parts. Pass the first into the second. It's ~4 rows per poll, so this is cosmetic.
- **P3-9 WAL / busy_timeout (Phase 1 P2-5) is still open.** With `autoCloseStale` now *writing* during page renders, local `SQLITE_BUSY` during e2e runs is more likely. Running `sqlite3 data/arkhe.db "PRAGMA journal_mode=WAL"` once after `db:reset` is enough; better, add it to the reset script.

## Data exposure (re-checked)

- The secret lives only in `rehearsal_secrets` and is read only by `code.ts` (`server-only`), and the live page receives codes, not the secret (D2/D4). Good.
- `rehearsals.ts` reads through `publicColumns`. `myMarks()` does `select()` on `attendance`, but filtered to the caller's own `user_id`, so the note is theirs. Good.
- Notes reach managers only (`rosterOf(…, { includeNotes })`), and the CSV has no reason column. The member-facing `rosterOf(…, false)` call sites are the action-internal ones, whose results don't go to members. Good.

## Turso cost summary after the fixes

Per 2.5 h rehearsal: the live poll is ≈ 150 rows × 1,800 ≈ 270k. Member page views add ≈ 50 × 10 views × ~150 rows ≈ 75k. Check-ins and marks are a few hundred writes. That's ≈ 3–4M rows/month at ~10 rehearsals, flat over time once P2-2 is in; without P2-2 it grows with every rehearsal in the table.
