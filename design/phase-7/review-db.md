# Phase 7 review: database (DBA)

Author: arkhe-dba. Date: 2026-10-21. Read: `po-decisions.md`, `db.md`, `implementation-notes.md`. Reviewed: `drizzle/0007_phase7_backup.sql`, `drizzle/meta/0007_snapshot.json`, `_journal.json`, `src/db/schema.ts`, `src/lib/backup/{run,queries,recipients,dump,crypto,messages,reports}.ts`, `src/app/(portal)/yedek/actions.ts`, `src/app/api/cron/aylik-yedek/route.ts`, `src/lib/homework/queries.ts` (`homeworkDueBetween`), `e2e/lib.mjs` `cleanup()`, `scripts/db-{backup,restore,decrypt,check}.ts`, and drizzle-kit / `@libsql/client` `migrate` (`sqlite3.js`, `http.js`, `hrana.js`). `data/arkhe.db` was only opened with `sqlite3 -readonly`; all drills ran on scratch copies.

**Result: 0 P1, 1 P2, 6 P3.** The migration is safe for the live Turso DB. The claim, finish and reap SQL is correct and indexed. There is no N+1, and no data crosses roles.

## 1. What I verified (drill)

1. **Pre-0007 → 0007 on real data.** I restored `data/backups/2026-10-21T11-18-03-962Z.sql` (written by `db:migrate` just before 0007; 7/7 migrations) with `scripts/db-restore.ts` into a scratch file. `db:check` correctly reported `7 of 8`. Then `DATABASE_URL=file:<scratch> npx drizzle-kit migrate`:
   - `db:check` → `foreign_keys=1, orphaned rows=0, migrations=8/8, quick_check=ok`
   - `integrity_check ok`, `foreign_key_check` empty
   - Row counts per table identical before and after, apart from `__drizzle_migrations` +1 and the new empty `backup_runs`.
   - `app_settings`: both rows kept, `value`/`updated_at`/`updated_by` unchanged, `created_at = updated_at` (the hand edit works).
   - The resulting `sqlite_master` (tables, indexes, CHECK text) is **byte-identical** to the dev DB's.
2. **No drift.** `drizzle-kit generate` (scratch `out`, repo untouched): "No schema changes". The 0007 snapshot's `prevId` chains to 0006. The `sha256` of `0007_phase7_backup.sql` equals the hash applied in the dev DB, so the dev DB ran the final file, not a draft.
3. **Atomic on Turso.** drizzle-kit (`dialect: "turso"`) → `drizzle-orm/libsql/migrator` → `client.migrate()`.
   - Over HTTP, `executeHranaBatch("deferred", …, disableForeignKeys = true)` sends `PRAGMA foreign_keys=off` before `BEGIN` and `on` after `COMMIT`/`ROLLBACK`. Every step is conditioned on the previous one succeeding. The `__drizzle_migrations` insert is in the same batch.
   - The file's own `PRAGMA foreign_keys=OFF/ON` lines are no-ops inside the transaction. That is harmless.
   - Nothing references `app_settings`, so the `DROP` can neither cascade nor orphan anything even if FKs stayed on. A failure halfway rolls back to the 0006 state.
   - Old (Phase 6) code works against the new table, because `created_at` has a default. So the gap between migrate and deploy, and a code rollback, are both safe.
   - The README runs backup → migrate → check with `DATABASE_URL`/`DATABASE_AUTH_TOKEN` exported in one shell (README l.41–43), so all three steps hit the same DB.
4. **CHECKs.**
   - `backup_runs`: a bad month, `cron` with an actor, `sent` without `finished_at`, `failed` without `error`, `recipient_count` 0, and a second `running` row for a month are all rejected.
   - Recipients: accepted 1, 2 and 5 addresses. Rejected 6 addresses, uppercase, `;`, space, tab, CR, LF, `<>`, `"`, `,,`, a leading or trailing comma, an element without `@`, `a@@b.co`, and `a@b` (no dot).
   - **The `char(59)` deviation is semantically identical** to `db.md` §2.1: `;` is rejected, and the glob class is `[ <>"\t\n\r;]`.
5. **Claim race.** 12 concurrent libsql clients on one WAL file (6 cron, 6 manual) for one month, with an 11-minute-old `running` row present. Result: the stale row was reaped to `failed`, exactly one insert got `rowsAffected = 1`, and there were 0 errors.
6. **Query plans** (`EXPLAIN QUERY PLAN`, 32 runs, with and without `sqlite_stat1`). Every `backup_runs` query is an index search; none is a full scan:
   - covered / claim pre-check / cron `NOT EXISTS` → covering `backup_runs_month_status_idx`
   - reap, cooldown, retention delete, manual-cooldown `NOT EXISTS` → `backup_runs_started_idx` range
   - finish → PK
   - run log → `backup_runs_started_idx` backwards, with the `users` PK lookup in the same query. No N+1, and `rowid desc` is satisfied by the index.
   - banner (a) → `started_idx` backwards, stopping at the first cron row
   - `previousState` → `month_status_idx` plus a temp sort over at most 3 rows (fine)
   - `homeworkDueBetween` → `assignments_due_idx` range and the `submissions` PK prefix: 4 flat queries
7. **Dump → encrypt → decrypt → restore → check.** I dumped the migrated scratch DB with `dumpDatabase` after adding 32 runs (including a `running` and a reaped row) and `backup_recipients`.
   - `encryptBackup`/`decryptBackup` round trip is byte-exact. A wrong passphrase gives `Wrong passphrase or damaged file.`
   - `db-restore.ts` into a new file, then `db:check` → `8/8, quick_check=ok`.
   - The schema is identical and the per-table data hashes are identical across all 23 tables.
   - The refusals all work: existing target, `libsql://`, encrypted input. A dump cut mid-statement fails and leaves no file.

## 2. Findings

### P2-1. `db:restore` reports success for a dump that didn't commit or holds orphans
- **Where:** `scripts/db-restore.ts:44-50`, plus the comment at `src/lib/backup/dump.ts:16-19`. `db.md` §5 claims that orphans "fail as a whole"; that claim was wrong.
- **Scenario 1, dump without `COMMIT`.** A dump truncated at a line boundary (I cut the last 40 lines) runs `BEGIN` and the inserts, then `close()` rolls back. The script prints `Restored: … (0 tables)` and exits 0, leaving an empty 0-byte DB. A plain dump can lose its tail like this: an interrupted copy, or a `turso db shell .dump > file` that died. The encrypted attachment can't, because GCM catches it.
- **Scenario 2, orphans.** The dump starts with `PRAGMA foreign_keys=OFF`, so `defer_foreign_keys` is inert and FKs are never checked at `COMMIT`. A hand-built dump with an orphan row restored with exit 0. Our own dumps come from one read snapshot of an FK-enforced DB, so this needs a foreign or edited file.
- `db:check` afterwards catches both (`migrations missing: 0 of 8`, `orphaned rows`). But `Restored:` is the line people trust during an incident, and README's Turso path (`turso db shell … < file`) never runs `db-restore`.
- **Fix** (in `db-restore.ts`, after `executeMultiple`):
  1. Fail if the dump's last non-empty line isn't `COMMIT;`.
  2. Fail if the table count is 0.
  3. Run `pragma foreign_key_check` and fail if it returns any rows.
  4. On failure, use the existing cleanup path (close, delete the four files, exit 1).
  5. Fix the `dump.ts:18` comment: FKs are checked only where `foreign_keys=OFF` is ignored.

### P3-1. A sent email whose `finish('sent')` fails is logged as `failed`/`unexpected`
- **Where:** `src/lib/backup/run.ts:176-194`.
- **Scenario:** `sendMail` succeeds, then the finish batch throws (a Turso blip). The `catch` then runs `finish(id, 'failed', …, RUN_ERRORS.unexpected)`. If that second write succeeds, the row claims the email wasn't sent:
  - the cron answers 500
  - banner (a) tells the board `Gönderilemedi`
  - the next morning sends a duplicate
- `db.md` §1.3 and D7 describe something different: there, the row stays `running`, is reaped as `Yarıda kaldı`, and the next day resends. The duplicate itself is accepted in D7; the misleading log line isn't.
- **Fix:** set a `mailed` flag after `sendMail`. In the `catch`, when `mailed` is true, retry `finish(id, 'sent', size, null)` once and never write `failed`.

### P3-2. The finish batch ignores `rowsAffected`
- **Where:** `run.ts:98-109`.
- If a row was already reaped (impossible on Vercel with 60 s vs 600 s), the run returns `sent` while the row says `failed`. This is reachable only on a host without `maxDuration` (the README's Render alternative) when SMTP hangs for more than 10 minutes.
- **Fix:** log a warning when `rowsAffected === 0`. No behaviour change.

### P3-3. The home banner costs up to 3 sequential DB round trips per manager page view
- **Where:** `src/lib/backup/queries.ts:154-179`, rendered by `src/components/backup/backup-banner.tsx` after the page's own awaits.
- On Turso each round trip is a network hop. That is not a correctness issue.
- **Fix (optional):** one statement returning `created_at`, `covered` and the latest cron row's `(report_month, status)` via scalar subqueries. All three are already index searches.

### P3-4. Plain dumps and restored DBs are world-readable
- **Where:** `scripts/db-backup.ts:15` (`writeFileSync` with no mode; files in `data/backups/` are `-rw-r--r--`) and the file `scripts/db-restore.ts:37` creates.
- `db-decrypt.ts:74` correctly writes `0o600`. All three hold the same password hashes and member PII.
- **Fix:** add `{ mode: 0o600 }` to `db-backup.ts`, and pass `openSync(abs, "wx", 0o600)` in `db-restore.ts`.

### P3-5. The `char(59)` workaround has no comment
- **Where:** `src/db/schema.ts:441-444`.
- The reason (drizzle-kit truncates CHECK text at a literal `;`) lives only in `implementation-notes.md`. Someone "simplifying" it back to `'*[ ;<>"'` regenerates broken SQL.
- **Fix:** one line, e.g. `// char(59) is ';': drizzle-kit cuts CHECK text at a literal semicolon.`

### P3-6. The recipients CHECK counts `@`s globally, not per element (accepted limitation, noted)
- `a@b@c.co,d.co` passes: 2 `@`, 1 comma. The CHECK can't iterate elements (no subqueries), and `splitRecipients` drops malformed elements on read. No header-splitting character can get through, so this is not exploitable.
- The same goes for non-ASCII case: SQLite's `lower()` is ASCII-only, but `RECORDING_EMAIL_RE` is ASCII-only too.
- No change needed. Mention it in the schema comment if you touch it for P3-5.

## 3. Checked and fine
- **Role exposure:**
  - `loadBackupPage` → `requireManager()`
  - `backupBannerState` returns null for members before any query, and `setup` only for the conductor
  - both actions check `canManageBackup` before any read; `loadRecipients` is called only after that check
  - `queries-internal` is imported only by `finance/queries.ts` and `backup/reports.ts`
  - `backup_runs.error` only ever holds `RUN_ERRORS` constants (the reap included)
- **Transactions:**
  - The claim is one write batch with the reap first.
  - The recipients save is one `db.transaction`. Drizzle's libsql transaction defaults to `write`, which is `BEGIN IMMEDIATE`, so there is no read-to-write upgrade `SQLITE_BUSY`. `created_at` is never in the update set.
  - The dump is one read transaction.
- **Restoring `backup_runs`:** the in-flight `running` row is restored and reaped later, as designed. `sqlite_sequence` is not dumped, so `login_attempts` ids may be reused after a restore. That is harmless (ids are only used within one request), and it was already true before this phase.
- **e2e `cleanup()`:** clears `backup_runs` and the setting behind the existing local-file guard. The seed adds neither.
- **Timestamps:** all unix seconds UTC; `report_month` is a calendar label by design. No money in this phase.
