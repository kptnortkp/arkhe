# Phase 8 review: database (DBA)

Author: arkhe-dba. Date: 2026-10-21. Read: `db.md`, `po-decisions.md` (D21–D41), `implementation-notes.md` (deviations 1–13, including the new `board_ticket_events.client_key`).

Reviewed:
- `drizzle/0008_phase8_board_budget.sql`, `drizzle/meta/0008_snapshot.json`, `_journal.json`, `src/db/schema.ts`
- `src/lib/board/{queries,rules,labels}.ts`, `src/app/(portal)/yonetim/actions.ts`
- `src/app/(portal)/finans/butce/actions.ts`, `[id]/csv/route.ts`
- `src/lib/finance/{queries,queries-internal,budget}.ts`, `src/lib/backup/reports.ts` (`budgetPart`)
- `scripts/{db-check,board-fixture,seed}.*`, `e2e/lib.mjs` `cleanup()`, `e2e/prod.mjs`
- `drizzle-orm/libsql/migrator.js` and `@libsql/client` `migrate()` / `transaction()` (`sqlite3.js`, `http.js`)

`data/arkhe.db` was only opened with `sqlite3 -readonly` (and `.backup` to scratch). Every drill ran on scratch files under the session scratchpad (`r8db/`).

**Result: 0 P1, 1 P2, 6 P3.** The migration is safe to run on the live Turso DB, in order after 0007 or together with it. The schema matches `db.md` exactly, plus the `client_key` deviation, which is sound. Every screen query is an index search, apart from two deliberate tiny scans. There is no N+1, and no board or budget data reaches a member.

## 1. What I verified

### 1.1 Drill: the pre-Phase-7 backup (7/7) → 9/9
1. **Restore.** I restored `data/backups/2026-10-21T11-18-03-962Z.sql` (written by `db:migrate` just before 0007; 7 migrations, no `backup_runs`) with `scripts/db-restore.ts` into a new scratch file. Result: 22 tables. `db:check` reported `migrations missing: 7 of 9`, which is correct.
2. **Migrate.** I ran `DATABASE_URL=file:<scratch> npx drizzle-kit migrate`, which applied 0007 and 0008 in one batch. Results:
   - `db:check` → `foreign_keys=1, orphaned rows=0, migrations=9/9, quick_check=ok`
   - `integrity_check ok`, `foreign_key_check` empty
   - Both `budgets_no_overlap_*` triggers present
3. **Existing data untouched.** The row count of every pre-existing table is identical before and after. The only difference is `__drizzle_migrations` 7 → 9. Both `app_settings` rows were kept, with `created_at = updated_at` (the 0007 hand edit).
4. **Same schema as the dev DB.** The resulting `sqlite_master` (type, name and SQL of every table, index and trigger) is **byte-identical** to the dev DB's.
5. **Dump → restore round trip.** I dumped that migrated file with `dumpDatabase` (31 tables, 47 indexes/triggers), restored it into a new file, and ran `db:check`: `9/9, ok`. Both triggers survived.
6. **Same round trip on a loaded copy** of the dev DB (AC 44 volumes, §1.4):
   - `db:check` `9/9`; schema identical
   - The per-table data hashes are identical for all 31 tables.
   - After the restore:
     - an overlapping insert fails with `budgets_overlap`
     - a new thread row gets `max(id) + 1`, and `sqlite_sequence` is rebuilt on that first insert
     - `board_ticket_seq` comes back with the dumped value (400), so numbers keep the high-water mark
7. **No drift.** `drizzle-kit generate` against a scratch copy of `drizzle/` printed "No schema changes". The `0008` snapshot's `prevId` chains to 0007's `id`. The `sha256` of `0008_phase8_board_budget.sql` equals the hash applied in the dev DB, so the dev DB ran the final file. The file contains `ALTER` 0, `DROP` 0 and `__new_` 0 times.

### 1.2 Safe on Turso
drizzle-kit (`dialect: "turso"`) calls `client.migrate()`. Over HTTP that is `executeHranaBatch("deferred", …, disableForeignKeys = true)`: one atomic batch, with the `__drizzle_migrations` inserts inside it.
- **Both pending migrations go in the same batch.** With the live DB at 0006 (7/7), a failure in 0008 rolls 0007 back too. Nothing is ever half-applied.
- **0007's own `PRAGMA foreign_keys=OFF/ON`** lines are no-ops inside the transaction. That is harmless: nothing references `app_settings`.
- **0008 only creates objects.** The phase-7 code runs unchanged against it, so the gap between migrate and deploy is safe, and so is a code rollback.
- **The `;` inside `BEGIN … END`.** The migrator splits on `--> statement-breakpoint`, so each trigger is sent as one statement. I could only run this through the local libsql path: there is no `turso`/`sqld` binary here, and a free Turso DB would need the user's account. On the remote, `db:migrate` already ends with `db:check`, and `db:check` now fails with `budget overlap triggers missing` if a trigger didn't land. So a bad remote apply cannot go unnoticed (see P3-6).
- **Journal order:** the `when` values are monotonic (0007 `1792581473334` < 0008 `1792589856492`).

### 1.3 Constraints (direct writes, `foreign_keys = on`)

**Rejected, as designed:**
- `client_key` on a non-comment entry, and a duplicate `client_key`. `on conflict do nothing` on the duplicate returns no row; that is the replay path.
- A status entry with a NULL `from`
- An update into an overlapping period (trigger)
- `end_month` ≠ start + 12
- A plan line of 0, and a `transfer` line
- `due_on = '2026-02-30'`
- `done` without `done_at`
- Deleting a user who is referenced by a ticket (restrict)

**Accepted:** an adjacent budget (`2027-09` after `2026-09`).

**The counter upsert heals:** with `last_number` forced to 2 below 6 existing tickets, the upsert from `createTicket` returned 7.

### 1.4 Query plans (`EXPLAIN QUERY PLAN`, scratch copy, then `ANALYZE`)
Volumes: 306 tickets (200 archived, 20 recently done), 3313 thread rows, 8045 ledger rows (5000 in the 2026-09 budget range).

| Query (as built) | Plan |
|---|---|
| `getBoard` unfiltered | `SCAN t`, plus `users` PK, `reads` PK, `board_ticket_events_comments_idx` (covering) and `board_ticket_events_ticket_idx (ticket_id=? AND rowid>?)`. 2 ms |
| `getBoard` `kim=ben` + urgency | `SEARCH t USING INDEX board_tickets_assignee_idx` |
| `anyTickets` count | covering `board_tickets_number_idx` |
| `getArchive` | `board_tickets_status_idx (status=? AND done_at<?)` + temp b-tree for the `number` tiebreak |
| `getTicket` / thread | `board_tickets_number_idx`; `board_ticket_events_ticket_idx` + `users` PK joins (2 queries in total) |
| `boardSummary` (badge and home card, `cache()`d) | `board_tickets_assignee_idx` + `reads` PK + events `rowid>?` |
| `moveTicket` CAS | `board_tickets_number_idx` |
| `markSeen` / `markTicketSeen` | `board_tickets` PK / number index; `max(e.id)` on covering `board_ticket_events_ticket_idx` |
| comment replay | `board_ticket_events_client_key_idx` |
| seq `max(number)` | covering `board_tickets_number_idx` |
| `categoryActuals` | `fe_occurred_idx (occurred_on>? AND occurred_on<?)` + temp b-tree for the group by. 8 ms for 5000 rows |
| `allBudgets` actuals (one query for all budgets) | `SCAN b` (2 rows) + `fe_occurred_idx` range per budget |
| `budgetCovering` | `budgets_start_idx (start_month<?)` |
| `budgetHistory` | `budget_revisions_budget_idx` + `users` PK + `budget_revision_lines` PK (one query) |
| overlap pre-check | `SCAN budgets` (a handful of rows; fine) |

**No N+1 anywhere:**
- The board is 2 queries.
- The detail page is 2 queries.
- The list page is 3 queries for any number of budgets.
- The report is 4 queries.
- The email part is 3 queries.

### 1.5 Plan vs actual SQL
I checked it on a scratch budget `2019-09`. The ledger rows were:
- `2019-08-31` = 1, `2019-09-01` = 10, `2020-08-31` = 100, `2020-09-01` = 1000
- a voided `2019-10-01` = 10000
- a transfer of 100000

The `allBudgets` join returned exactly `donation 110`. So the range is half-open `[start-01, end-01)`, and voided rows and transfers are excluded. Openings are excluded by the same `kind in ('income','expense')`.

Other checks:
- `||` binds tighter than `>=`, so the join predicate is correct as generated.
- **Grouping by `category` alone is safe:** `fe_category_income` and `fe_category_expense` make every category belong to exactly one kind.
- **The filter is the same as `categoryTotals`:** the same `live` and `inRange` helpers. So AC 36 can't disagree.
- **Istanbul days:** `occurred_on` and `due_on` are plain Istanbul labels, so they are compared as text, with no time-zone conversion. The phase and "today" use `todayIstanbul()`. The email uses `[start-01, min(end, M+1)-01)`, which is exactly "through the last day of M".

### 1.6 Writes and transactions
- **`writeTx` is IMMEDIATE.** `@libsql/client` `transaction()` defaults to `"write"`, both locally and over HTTP, and drizzle calls it without a mode.
- **Every lock is a conditional statement:**
  - move: `status = from`
  - edit: `revision`
  - delete: opener or conductor, in the `where`
  - comment delete: own comment, kind, and the DB clock
  - plan save and approve: `revision` and approval state
- **Allocation is serialized:** create allocates its number in the same IMMEDIATE transaction as the replay and assignee checks.
- **`insert … select … on conflict`** always has the `WHERE` that SQLite needs to parse the upsert.

### 1.7 Roles
- The board loaders call `requireManager()`.
- `boardSummary` uses `assertManager()` and returns `null` for members, so no board query runs for them.
- All 13 actions start with `assertManager()`.
- The budget loaders call `requireManager()`. The CSV route uses `managerOrError()`.
- `queries-internal.ts` is still imported only by `finance/queries.ts` and `backup/reports.ts`.
- The email's budget CSV and the dump go to the same board recipients as the existing finance data.

### 1.8 Seed and cleanup
- **Fixture:** `board-fixture.mjs` matches `db.md` §7.1. On the dev DB: seq = 6, 6 tickets, 13 thread rows, 2 budgets.
- **Cleanup order is right:**
  - `seedFinance`, then `seedBoard` and `seedBudgets`. These wipe every ticket, so thread rows and reads cascade. They also wipe every budget, so lines, revisions and revision lines cascade.
  - Only then are the `@e2e.test` users deleted. So no restrict FK to `users` can trip.
- **Production is safe:** `assertFixtureTarget` refuses remote URLs and `NODE_ENV=production`. `e2e/prod.mjs` seeds before it renames the board user, so `people()` still finds `yk@`.
- **`db:check`:** both new invariants are present, and run only when their tables exist.

## 2. Findings

### P1
None.

### P2

**P2-1. Approval isn't bound to the period the approver saw.**
- **What happens:** `updateBudget` on a draft changes `name`, `start_month` and `end_month` without bumping `revision` (deviation 8). `approveBudget(id, revision)` checks only `revision`.
- **The race:**
  1. yk@ opens the draft `2026–27 sezonu` (Eylül 2026 – Ağustos 2027).
  2. sef@ moves its start to `2027-01` and renames it.
  3. yk@ presses `Onayla`.
  4. The approval succeeds, and it locks a name and a period yk@ never saw.
- **Why it matters:** D17/D34 make name and start immutable after approval, so the wrong state becomes permanent. Re-planning is the only fix.
- **Fix (one line, no schema change).** In `updateBudget`'s draft branch, bump the revision when the name or start actually changes:
  ```ts
  revision: d.start !== cur.startMonth || d.name !== cur.name ? sql`${budgets.revision} + 1` : budgets.revision,
  ```
  Note-only saves still never make the editor stale. A period change *should* make an open plan editor stale, because its prefill range and hint change with the start.
  Alternative: pass the seen `startMonth` to `approveBudget` and add `start_month = :seen` to its CAS.
- **e2e:** create a draft, read its revision, change its start via `updateBudget`, then `approveBudget(id, oldRevision)` → `PLAN_STALE`.

### P3

**P3-1. Zod counts UTF-16 units; the CHECKs count characters.**
- **Where:** the minimum bounds: ticket title ≥ 3 and revision reason ≥ 5.
- **Example:** the title `🎵🎵` is 4 units in JS and passes zod. It is 2 characters in SQLite and fails `board_tickets_title_length`. The user then gets the generic `Kaydedilemedi. Alanları kontrol et.` instead of `Başlık en az 3 karakter olmalı.`.
- **Impact:** integrity holds, because the DB refuses the row. Only the message is wrong.
- **Fix:** `.refine((s) => [...s].length >= 3, …)` for the minimums. The maximums are already on the safe side: JS is stricter there.

**P3-2. `markTicketSeen` writes on every detail-page mount, even when nothing changed.**
- **Cost:** each view is one IMMEDIATE transaction with a read and an upsert. On Turso over HTTP, that's ~3–4 round trips and 1 row write per view. That is fine for the free tier at our volume.
- **Fix:** when `before.fresh` is false and the stored marker is already ≥ the rendered values, return without the upsert. `seen_at` isn't read by any screen.

**P3-3. `budgetGuarded` opens a write transaction for a read.**
After a lost race it runs `writeTx((tx) => overlapping(...))` just to look up the other budget's name. A plain `db` read is enough. It's harmless (rare, and short).

**P3-4. The archive is never pruned, so the unfiltered board scan grows.**
- Tickets are never deleted automatically (D9). So `getBoard` with no filter scans the whole table, archive included, because the `status <> 'done' or done_at >= ?` OR defeats the index.
- At 300 rows it takes < 2 ms, and at a few thousand it's still sub-ms per row.
- If the table ever passes ~5 000 rows, split it into `status in ('todo','in_progress','blocked')` `union all` `status = 'done' and done_at >= ?`. Both halves are indexed (`db.md` §4.2). No action now.

**P3-5. An approved budget can be revised down to zero lines.**
- D34 refuses approving an empty plan. But `savePlan` on an approved budget accepts a revision that removes every amount. The result is an approved budget with no plan and a report of only `Plansız` lines.
- The DB is consistent, and history records every removal.
- @po: is that allowed? If not, refuse it in `savePlan` with `EMPTY_PLAN` when `approved && planned.length === 0`.

**P3-6. `db:check` matches the triggers by name only.**
- A trigger that was hand-recreated with a different body would pass.
- Optional hardening: also require `sql like '%budgets_overlap%'` and `sql like '%b.id <> NEW.id%'` for the update trigger.
- The first remote `db:migrate` is the moment this matters (§1.2). The name check already catches the realistic failure: a missing trigger after a rebuild or a bad apply.

## 3. Replies
- **@backend, `client_key` (deviation 2):** agreed. It is nullable, partial-unique and CHECK-tied to comments. The replay path compares the actor and the ticket, and `on conflict do nothing` without a target only covers the PK and that index. The index is global rather than per actor, but the values are per-mount v4 uuids, so a collision is not a concern.
- **@backend, create in `writeTx` (deviation 4):** agreed. It is better than my `db.batch`: the replay and assignee checks share the transaction, and the `max(last_number, max(number)) + 1` upsert heals a counter that is behind the data. Verified (§1.3).
- **@tech lead, deploy order (unchanged):** run `npm run db:migrate` with `DATABASE_URL`/`DATABASE_AUTH_TOKEN` exported in the same shell: backup → migrate (0007 and 0008 in one atomic batch if the live DB is still at 0006) → `db:check` expecting `9/9`. Deploy the code after that. Fix P2-1 before go-live: it is a one-line change in `updateBudget` plus one e2e assertion.
