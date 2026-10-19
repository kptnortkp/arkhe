# Phase 6: DB review (DBA)

Author: arkhe-dba. Date: 2026-10-19. Scope: migration 0006 + journal/snapshot, `scripts/{db-backup.ts,db-check.ts,fixture-guard.mjs,assert-local-db.mjs,seed.ts,finance-fixture.mjs,homework-fixture.mjs,create-admin.ts}`, `src/lib/finance/{queries,dates,guard,ledger,dues}.ts`, `finans/actions.ts`, `finans/aidat/actions.ts`, `src/db/write-tx.ts`, `e2e/{prod.mjs,phase6-z-guards.mjs,phase6-b-security.mjs (AC39),lib.mjs}`, README "Deploy". I also reviewed my own WP1–3 work. Every probe ran on a scratch copy (`sqlite3 -readonly data/arkhe.db ".backup …"`, in the session scratchpad `review-db/`). The live DB was not written, and `npm run e2e` was not run.

**Result: 0 P1, 4 P2, 6 P3.**

## Verified (no action)

- **Migration 0006**: one `CREATE INDEX` plus the orphan-freeze `DELETE`, with no `__new_` rebuild, so it is expand-only. The journal has 7 entries, and the `0006_snapshot.prevId` matches the `0005` id. The snapshot diff against 0005 is exactly `fe_payment_group_idx`. A `drizzle-kit generate` run into a scratch copy of `drizzle/` against the current `schema.ts` reports "No schema changes", so there is no drift. The live DB has `__drizzle_migrations` = 7 and 32 explicit indexes.
- **EXPLAIN QUERY PLAN** on the scratch copy:
  - month summary → `SEARCH fe_occurred_idx (occurred_on>? AND occurred_on<?)`
  - `Aynı ödemede` → `SEARCH fe_payment_group_idx (payment_group_id=?)`
  - freeze cleanup → `sqlite_autoindex_dues_overrides_1` + subquery on `fe_member_idx (member_id=? AND dues_period_id=?)`
  - `duesAuditOf` → `dues_overrides_user_idx` / `member_dues` PK + `users` PK
  
  No N+1 anywhere in the changed code: `getEntry` and `duesAuditOf` use `Promise.all`.
- **Backup restore drill** (scratch): `db-backup.ts` run against the scratch copy, then restored with `sqlite3`:
  - `sqlite_master` identical to the source
  - every table's content identical (sha of `select * order by 1`)
  - `db:check` → `foreign_keys=1, orphaned rows=0, migrations=7/7, quick_check=ok`
- **Fixture guards**:
  - `assertFixtureTarget` is the first statement in `seedFinance`/`seedHomework`, and `seed.ts` calls it on `db.$client` before any write.
  - `assert-local-db.mjs` refuses production and any URL other than unset/`file:data/arkhe.db`.
  - `e2e/lib.mjs` refuses non-`file:` URLs and non-loopback bases.
  - `drizzle-kit` loads `.env` via dotenv and `tsx/node --env-file` don't override shell vars, so `DATABASE_URL=… npm run db:migrate` hits the same DB in all three steps.
- **`phase6-z-guards.mjs`**: every guarded command targets a temp file or `libsql://guard.invalid`. The `rm` in `db:reset` is never executed. `prod.mjs` points `DATABASE_URL` at the throwaway DB before importing `lib.mjs`, never calls `cleanup()`, gives `NODE_ENV=production` only to the server child and deletes `-wal/-shm` too.
- **Role leakage**: `duesAuditOf` calls `requireManager()`, uuid-checks its input and returns finished strings that only the server component renders. `duesMatrix`/`myDues`/CSV are untouched. Waivers only: freezes never get an audit line.
- **Voiding**: `voidEntry` deletes the freeze in the same `writeTx` and only when no live entry remains (`notExists`).
- **Ids and groups**: replay ids and the group id include the member, and the replay path checks `memberId` + `createdBy`. The dev DB has no legacy `payment_group_id` shared across members (0 rows), and production starts empty.
- **Range helpers**: string-only; an invalid value matches nothing (`sql\`0\``) in aggregates. That deviation is accepted, because it's safer than all-time totals under a month label.

## P2

### P2-1 `correctEntry` validates a dues correction against the un-frozen rate, so it can store an overpayment
`src/app/(portal)/finans/actions.ts:179`. `duesPosition` runs **after** the old entry is voided in the same transaction. If that entry was the period's only live payment, `paid` = 0, so `owedFor` (`dues.ts:54`) ignores the freeze and `remaining` = the current rate. After the insert, `paid` > 0 again and the freeze applies once more.
- **Rate went up** (reduced ₺150 → standard ₺300, freeze ₺150, paid ₺100): correcting ₺100 → ₺250 is accepted, and the period ends up owed ₺150 / paid ₺250. That breaks the "never overpay" invariant.
- **Rate went down**: a legitimate correction up to the frozen amount is refused with the overpayment error.

**Fix:** read the position **before** the void update and allow `remaining = before.remaining + old.amountKurus`. Before the void, paid > 0, so the freeze is honoured.

```ts
const before = await duesPosition(tx, old.memberId!, [old.duesPeriodId!]); // before the void update
const remaining = (before?.periods[0]?.remaining ?? 0) + old.amountKurus;
```

Add an e2e case to `phase6-c-finance.mjs` AC31: a partial payment, then the rate goes up, then Düzelt to more than the frozen owed is refused.

### P2-2 `db:backup` is not a consistent snapshot
`scripts/db-backup.ts:19-47` issues one `execute` per table plus two `sqlite_master` reads, each in its own implicit transaction. If someone writes while the backup runs (README step 8 says monthly, with the app live), the dump can be inconsistent. Example: tables are read alphabetically, so a `dues_periods` row created after that table was read, plus a `finance_entries` row pointing at it, gives a dump that restores with FK checks off and then **fails `db:check`** (orphan). Or a partial-unique index can't be created at the end.

**Fix:** do every read (both `sqlite_master` queries and every `select *`) inside one read transaction. That snapshot is consistent on both `file:` and Turso:

```ts
const tx = await client.transaction("read");
try { /* tables, rows, extras: tx.execute(...) instead of client.execute(...) */ } finally { tx.close(); }
```

The dump is a few hundred KB, so this stays well inside Turso's interactive-transaction timeout.

### P2-3 The restore depends on `PRAGMA foreign_keys=OFF` being honoured, which is unverified on Turso
`scripts/db-backup.ts:26-39` writes `CREATE TABLE` + its `INSERT`s per table in **alphabetical** order. With FK enforcement on, `INSERT INTO assignment_parts` needs the parent table `assignments`, which doesn't exist yet. I verified this on scratch: with the leading pragma removed and `foreign_keys=ON`, the restore fails at the first insert with `no such table: main.assignments` (and `main.users`). `sqlite3` and `executeMultiple` honour the pragma, so the drill and the e2e pass. The real-incident path (`turso db shell … < file`, README:81) is the one path we can't test this phase.

**Fix (verified on scratch):** emit all `CREATE TABLE`s first, then all `INSERT`s, then the indexes/triggers/views, and add `PRAGMA defer_foreign_keys=ON;` right after `BEGIN;`. Keep `PRAGMA foreign_keys=OFF;` in front. A dump built that way restored cleanly **with `foreign_keys=ON`**: 24 users, 32 indexes, `foreign_key_check` empty. The pragma then becomes an optimisation instead of a requirement.

### P2-4 README rollback after a restore promotes a deployment that still points at the old database
`README.md:90` (and step 8 restore 5 → 9). The restore goes into a **new** Turso DB (new URL and token), and the env vars are then changed and redeployed. Vercel deployments keep the environment they were built with, so an env change applies only to new deployments. "Promote the deployment that matches that schema" therefore brings back the **old** `DATABASE_URL`/token. If the old DB was destroyed, every page fails. If it wasn't, writes go to the broken DB and the restored one silently diverges.

**Fix (README text):**
- In 9 "Schema or data", replace "then promote the deployment that matches that schema" with: "then, in Vercel → Deployments, open the deployment whose code matches that schema and use **Redeploy** (not Promote), so it is rebuilt with the new `DATABASE_URL`/`DATABASE_AUTH_TOKEN`. Never Promote a deployment created before a database switch."
- Add the same sentence under "Code" ("Promote is only safe while the database URL is unchanged"), and the Render equivalent in the fallback section (Render rollbacks also reuse the old env snapshot unless you redeploy).

## P3

1. **`sqlite_sequence` is not restored.** `db-backup.ts:21` excludes it. `login_attempts` is `AUTOINCREMENT` (live seq 5610, 0 rows), so after a restore its ids restart at 1. That's harmless today because the rows are ephemeral and nothing references them. Optional fix: after the INSERTs, emit `INSERT INTO sqlite_sequence(name, seq) VALUES (…)` for each row, or leave it and note it in the header comment.
2. **README restore drill cleanup.** `README.md:78`: `db:check` switches the restored file to WAL, so "Delete `/tmp/arkhe-restore.db`" leaves `-wal`/`-shm` behind. Use `rm -f /tmp/arkhe-restore.db /tmp/arkhe-restore.db-wal /tmp/arkhe-restore.db-shm`.
3. **README: cheaper restore options.** Next to `turso db shell … < file` (README:81), name `turso db create arkhe-restore-<yyyymmdd> --from-dump data/backups/<file>.sql`: one step, and the server imports the file as a whole. Also mention Turso point-in-time restore (`turso db create <new> --from-db arkhe --timestamp <UTC>`) as the first resort, but only if the free plan includes it at go-live ("re-read terms", as the README already says). It loses less data than the last backup.
4. **`db:check` counts migrations, not which ones.** `db-check.ts:28-31`: a DB that holds 7 rows from a different journal still passes. Cheap hardening: also require `max(created_at)` from `__drizzle_migrations` to equal the last journal entry's `when`. That is exactly what drizzle uses to decide what's pending.
5. **`phase6-z-guards.mjs:22,110` mtime check is weak and can flake.** In WAL mode a write lands in `arkhe.db-wal`, so the main file's mtime doesn't change. A checkpoint caused by the running dev server's own writes (sessions, login attempts) can also change the mtime with no fixture writing at all. Either drop mtime and keep the five row counts, or add `arkhe.db-wal` size/mtime and accept that the dev server may legitimately write. Row counts are the real proof.
6. **`phase6-b-security.mjs:161-169` masks a failed backup.** If `db:backup` fails, `file` is `undefined` and `join(ROOT, file)` throws a `TypeError`. The test aborts with that error instead of the clear AC39 FAIL that was already logged. Return early (`if (!file) return;`) after the first `check`.

## Replies

- **@backend:** P2-1 is in your `correctEntry`. The fix is two lines and doesn't change the freeze model (D31 stands). P2-2/P2-3 are in my scripts and touch no `src/`.
- **@tech lead:** P2-4 is README text only. With P2-2 and P2-3 fixed, please re-run the AC39 e2e (`executeMultiple`) and the scratch `sqlite3` drill. Both should still pass, and the drill should also pass once with `sqlite3 -cmd "PRAGMA foreign_keys=ON"` after removing the dump's first line. That shows the restore no longer depends on the pragma.
- **@po:** no AC changes. P2-4 makes AC 38 step 9 correct for the restore case.
