# Phase 6: database plan (DBA)

Author: arkhe-dba. Date: 2026-10-19. Inputs: `po-spec.md`, `phase-5/review-po.md`, `phase-5/review-db.md`, `src/db/schema.ts`, `drizzle/0005_*`, `scripts/{seed.ts,finance-fixture.mjs,homework-fixture.mjs,assert-local-db.mjs,db-backup.ts,db-check.ts,create-admin.ts}`, `e2e/{lib.mjs,run.mjs,phase5-finance.mjs}`, `src/lib/finance/{queries,ledger,dues}.ts`, `finans/actions.ts`, `finans/aidat/actions.ts`. No other phase-6 role file exists yet. All probes ran on a scratch copy (`sqlite3 -readonly data/arkhe.db ".backup …"`). The live DB was not written.

## 0. Summary of the data-model change

- **No new tables. No new columns.** "Son değişiklik" uses existing columns (§5).
- **One migration, `0006_phase6_payment_group`**: one partial index plus one data cleanup statement (§3). No table rebuild.
- Money stays integer kuruş, timestamps stay unix seconds UTC, and nothing new is hard-deleted except stale `freeze` rows. A freeze is derived state, not money.
- **Found while planning (P1 for the deploy path):** `db:backup` produces a dump that **can't be restored into a working DB**. It skips all 31 explicit indexes (including the unique partial ones `fe_opening_idx`, `fe_replaces_idx`, `events_rehearsal_idx` …) and the `__drizzle_migrations` table. I verified this on `data/backups/2026-10-17T23-03-59-422Z.sql`: 0 `CREATE INDEX` and 0 `__drizzle_migrations`. A restored DB would silently lose its integrity constraints, and the next `db:migrate` would re-run `0000` and fail. The fix is in §7.1, and AC 38 step 8 depends on it.

---

## 1. @po AC 25 / 34: fixture and seed production guards

### 1.1 One shared guard: `scripts/fixture-guard.mjs` (new; plain `.mjs` so `e2e/` and `seed.ts` can both import it)

```js
// Refuses to let demo/e2e fixtures touch anything but a local file DB outside production.
export function assertFixtureTarget(client) {
  const url = process.env.DATABASE_URL ?? "file:";
  const remote = !url.startsWith("file:") || (client?.protocol && client.protocol !== "file");
  if (process.env.NODE_ENV === "production" || remote) {
    throw new Error("Fixtures only run against a local file database outside production.");
  }
}
```

The guard checks `client.protocol` (`@libsql/core` `Client.protocol`; `"file"` for the sqlite3 client) **as well as** the env var. `seedFinance(client)` and `seedHomework(client)` take a client that the caller built, so the client is what will actually be written to. Today `seedFinance` checks only the env var and `seedHomework` checks nothing.

| Call site | Change |
|---|---|
| `scripts/finance-fixture.mjs` `seedFinance` | Replace the two-line URL check (lines 85–86) with `assertFixtureTarget(client)`. It stays the **first statement**, before the users select. |
| `scripts/homework-fixture.mjs` `seedHomework` | Add `assertFixtureTarget(client)` as the first statement. |
| `scripts/seed.ts` `main()` | Already refuses both conditions. Keep it, and also call `assertFixtureTarget(db.$client)` right after `createDb()`. That way the check runs before `insert(users)`. |
| `scripts/assert-local-db.mjs` (used by `db:reset`) | **Add `NODE_ENV === "production"` refusal.** Today it checks only the URL. `NODE_ENV=production npm run db:reset` with a `file:` URL would `rm -f data/arkhe.db*`. Also refuse unless the URL is unset or is exactly `file:data/arkhe.db`, because the `rm` in `db:reset` is hard-coded to `data/arkhe.db*`. With `DATABASE_URL=file:data/e2e-prod.db` it would delete the dev DB and then migrate the other file. |
| `e2e/lib.mjs` (module top, before `createClient`) | Throw if the resolved URL doesn't start with `file:`. Also throw if `BASE` is not `http://127.0.0.1:*` or `http://localhost:*`, so the suite can never log in against a deployed site. Keep `NODE_ENV` out of this check, because the prod runner process itself isn't production (§2). |

### 1.2 AC 25 e2e: order matters (this protects the dev DB)

**Implement the guards before writing the test.** The test runs `db:reset` with `NODE_ENV=production`. Without the new `assert-local-db` check, that test **wipes `data/arkhe.db` while the dev server is running**.

Test recipe (in the runner setup step):
1. Take row counts: `select (select count(*) from users),(select count(*) from finance_entries),(select count(*) from dues_overrides),(select count(*) from assignments),(select count(*) from submissions)`.
2. Run the in-process calls. Set `process.env.NODE_ENV = "production"`, then `await seedFinance(db)` and `await seedHomework(db)`. Each must reject. Restore `NODE_ENV` in `finally`.
3. Run the child processes with `spawnSync` and `env: { ...process.env, NODE_ENV: "production" }`: `npx tsx scripts/seed.ts`, then `npm run db:reset`. Each must give status ≠ 0. Repeat both with `NODE_ENV` unset and `DATABASE_URL=libsql://guard.invalid`, which never connects because the guard exits first.
4. Take the counts again. They must be identical, and `data/arkhe.db` must still exist.

---

## 2. Throwaway DB for `npm run e2e:prod` (spec §5)

`e2e/prod.mjs`, in this order:

1. `const PROD_DB = path.resolve("data/e2e-prod.db")`, an absolute path so `next start` resolves the same file. Delete `PROD_DB`, `-wal` and `-shm` first, in case a crashed run left them behind.
2. Set `process.env.DATABASE_URL = "file:" + PROD_DB` **before** dynamically importing `./lib.mjs`. Every helper, and any accidental `cleanup()`, then points at the throwaway DB, never at `data/arkhe.db`. `prod.mjs` must **not** call `cleanup()`: the DB is deleted at the end anyway, and `cleanup` runs `seedFinance`, which needs the demo users.
3. Migrate: `npx drizzle-kit migrate`, then `npx tsx scripts/db-check.ts`, with `env: { ...process.env, DATABASE_URL }` (`drizzle.config.ts` reads the env var). **Don't use `npm run db:migrate`**: it would write a pointless backup of an empty DB into `data/backups/`. `db-check` also turns on WAL.
4. Admin: `npx tsx scripts/create-admin.ts "E2E Admin" admin@e2e-prod.test` with `APP_URL=http://127.0.0.1:3101`. Parse the `/davet/<token>` link from stdout and set the password through the UI. That one step also exercises the invite flow on the prod build.
5. AC 24 demo user: insert a `.local` user by copying the admin's hash, so the runner needs no scrypt: `insert into users (id, name, email, role, password_hash) select '<uuid>', 'Demo', 'demo@arkhe.local', 'member', password_hash from users where email = 'admin@e2e-prod.test'`. Logging in with the admin's password must give `E-posta ya da şifre hatalı.`
6. Server: `next start -H 127.0.0.1 -p 3101` with `NODE_ENV=production`, `APP_URL=http://127.0.0.1:3101` and `DATABASE_URL=file:<PROD_DB>`. Only the **child** gets `NODE_ENV=production`. The runner process doesn't, so the fixture guards stay meaningful.
7. In `finally`: kill the server and `rm -f PROD_DB{,-wal,-shm}`. `data/` is already git-ignored.

AC 27 (bad `APP_URL`) starts a separate `next start` that exits before it touches the DB. Use the same `PROD_DB` env so it can never fall back to `data/arkhe.db`.

---

## 3. @po AC 35: performance, migration 0006

### 3.1 Schema change (`src/db/schema.ts`, `financeEntries` indexes)

```ts
index("fe_payment_group_idx").on(t.paymentGroupId).where(sql`payment_group_id is not null`),
```

### 3.2 Exact migration SQL

`npm run db:generate -- --name phase6_payment_group` should emit exactly one statement. **Reject the output if it contains `__new_`** (no rebuild is expected). Then append the cleanup by hand, after a breakpoint:

```sql
CREATE INDEX `fe_payment_group_idx` ON `finance_entries` (`payment_group_id`) WHERE payment_group_id is not null;--> statement-breakpoint
DELETE FROM `dues_overrides` WHERE `kind` = 'freeze' AND NOT EXISTS (SELECT 1 FROM `finance_entries` f WHERE f.`member_id` = `dues_overrides`.`user_id` AND f.`dues_period_id` = `dues_overrides`.`dues_period_id` AND f.`voided_at` IS NULL);
```

The second statement removes freezes whose payments were all voided before the AC 31 fix existed (see §4 for why they're harmful). It is idempotent, and today it deletes 0 rows on the dev DB (`count(*) where kind='freeze'` = 0). It goes into the migration so that any older copy or backup is cleaned the same way. The migration is additive: the previous deployment runs unchanged on the new schema (§7.3).

### 3.3 Range filters instead of `substr`

Add two pure helpers next to the finance queries, for example in `src/lib/finance/dates.ts`. They work on strings only, with no `Date` and so no time-zone drift:

```ts
monthRange("2026-12") -> ["2026-12-01", "2027-01-01"]   // [from, to)
yearRange("2026")    -> ["2026-01-01", "2027-01-01"]
```

Validate the input with `/^\d{4}-(0[1-9]|1[0-2])$/` (month) or `/^\d{4}$/` (year). If it doesn't match, drop the filter instead of building SQL from it.

| Query (`src/lib/finance/queries.ts`) | Now | New |
|---|---|---|
| `monthSummary` :74 | `substr(occurred_on,1,7) = ?` | `occurred_on >= from and occurred_on < to` (`gte`/`lt`) |
| `listEntries` :125 | same | same |
| `categoryTotals` :452–453 | month or year `substr` | `monthRange` or `yearRange` |
| `listSponsors` :317 | `case when substr(…,1,4) = ?` | `case when occurred_on >= ? and occurred_on < ?`. For consistency only; it's a per-sponsor join, so there's no index gain. |
| `getSponsor` :333, `reportYears` :350, `monthlyReport` :384 | `substr` in SELECT / GROUP BY | **Keep.** These are groupings, not filters. `monthlyReport` already filters with a range. |

### 3.4 Gate evidence: `EXPLAIN QUERY PLAN` (scratch copy with the 0006 index created)

| Query | Before | After |
|---|---|---|
| month summary | `SCAN finance_entries` | `SEARCH finance_entries USING INDEX fe_occurred_idx (occurred_on>? AND occurred_on<?)` |
| category totals (year) | full scan | `SEARCH … fe_occurred_idx (occurred_on>? AND occurred_on<?)` |
| ledger month + `order by occurred_on desc, created_at desc limit 200` | full index walk | `SEARCH … fe_occurred_idx (range)`, with no temp B-tree for ORDER BY |
| `Aynı ödemede` siblings | `SCAN finance_entries` | `SEARCH fe USING INDEX fe_payment_group_idx (payment_group_id=?)` |
| AC 31 freeze delete (§4) | — | `SEARCH dues_overrides USING INDEX sqlite_autoindex_dues_overrides_1`, with the subquery `SEARCH f USING INDEX fe_member_idx (member_id=? AND dues_period_id=?)` |

The results are byte-identical (Oct 2026: income 675000 / expense 210000, matching `financeExpected`). The planner can use the partial index for `payment_group_id = ?` because equality implies `is not null`. `getEntry` should use `Promise.all` for its three follow-ups (`replaces`, `replacedBy`, `siblings`). They are independent reads, so no transaction is needed.

---

## 4. @po AC 31 and 33: freeze cleanup on void, in `writeTx`

**Why the read-time lapse from Phase 5 P2-3 isn't enough.** korist pays ₺100 on P2 at rate standard (₺300). The rate then moves to İndirimli (₺150), which freezes P2 at ₺300. Then the ₺100 is voided. While paid = 0 the freeze is ignored and P2 shows ₺150, which is correct. Next, ₺150 is paid. Now paid > 0, so **the stale freeze switches back on**, owed becomes ₺300, and the sheet shows `₺150 kaldı`. That is exactly the AC 31 scenario. The row has to go.

`voidEntry` (`finans/actions.ts:298`) becomes:

```ts
const result = await writeTx(async (tx) => {
  const [v] = await tx.update(financeEntries)
    .set({ voidedAt: now(), voidedBy: actor.id, voidReason: reason.data })
    .where(and(eq(financeEntries.id, id), isNull(financeEntries.voidedAt), ne(financeEntries.kind, "opening")))
    .returning({ category: financeEntries.category, memberId: financeEntries.memberId, periodId: financeEntries.duesPeriodId });
  if (!v) { /* same NOT_FOUND / ALREADY_VOID / OPENING_ONLY_IN_SETTINGS lookup, using tx */ }
  if (v.category === "dues") {
    await tx.delete(duesOverrides).where(and(
      eq(duesOverrides.duesPeriodId, v.periodId!), eq(duesOverrides.userId, v.memberId!),
      eq(duesOverrides.kind, "freeze"),
      sql`not exists (select 1 from ${financeEntries} f where f.member_id = ${v.memberId} and f.dues_period_id = ${v.periodId} and f.voided_at is null)`,
    ));
  }
});
```

- **Delete only when no live payment remains for that member and period.** AC 31 says "deletes that period's freeze". Taken literally, voiding one of two partial payments would drop the freeze while the other payment still relies on it. The `not exists` keeps the freeze in that case. @po: this is a narrowing of AC 31, not a change to it.
- **Only waivers are protected by this rule.** The delete filters on `kind = 'freeze'`, so it never touches a waiver.
- **`correctEntry` must not clean up.** It voids and then inserts a replacement for the same member and period with an amount > 0 in the same transaction, so the freeze is still needed.
- **`updateEntryMeta` (AC 33) goes into `writeTx` too.** It's still one statement, but the wrapper gives BUSY retry, and `guarded(formData, …)` turns a constraint error into `Kaydedilemedi. Alanları kontrol et.`
- **Hard delete is right here.** A freeze is a cache of "what was owed under the old rate". The audit trail for money stays on the voided entry (`voided_by/at/reason`).

---

## 5. @po AC 30: data for "Son değişiklik": existing columns, no migration

| Line | Source | Already set by |
|---|---|---|
| under the rate | `member_dues.updated_by` (FK `users`, `set null`), `member_dues.updated_at` (unix s, UTC) | `setDuesRate` insert and upsert (`aidat/actions.ts:436-439`); the fixture sets both (`finance-fixture.mjs:149,153`) |
| under each waiver | `dues_overrides.created_by` (FK `set null`), `dues_overrides.created_at` | `setWaiver` insert |

Semantics: **"last written by/at"**. A note-only edit of the rate sheet also stamps `member_dues`. That's acceptable, because the label says *değişiklik*, not *oran değişikliği*.

**Integrity hole to fix (backend):** the `setWaiver` upsert (`aidat/actions.ts:488-491`) updates `created_by` but **not `created_at`**. Editing a waiver's reason, or a waiver replacing a stale freeze, would then show the new person next to the **old date**. Add `createdAt: now()` to the `set`. I'm not renaming the columns, because a rebuild isn't worth it in the final phase. A one-line comment on `duesOverrides` ("created_* = last written") is enough.

Display rules:
- No `member_dues` row (standard rate, never touched): **no line**. Don't show "silinmiş üye", since nobody changed anything.
- Row present with `updated_by` null (the user was deleted, FK `set null`): `Son değişiklik: silinmiş üye · {d MMM yyyy}`.
- Freeze rows: no line. They're system-made, and their trigger is visible on the rate line.
- `removeWaiver` leaves no trace. That's accepted, because an audit log is out of scope (spec §4).

Query shape, with no N+1. In `duesMatrix` (`queries.ts:556`, manager-only via `requireManager()`):
- **roster query:** add `const rateBy = alias(users, "rate_by")`, then `.leftJoin(rateBy, eq(rateBy.id, memberDues.updatedBy))`, then select `rateChangedAt: memberDues.updatedAt`, `rateChangedBy: rateBy.name`, and `hasDuesRow: sql<boolean>\`${memberDues.userId} is not null\``.
- **overrides query:** change `db.select().from(duesOverrides)` to an explicit select with `.leftJoin(waiverBy, eq(waiverBy.id, duesOverrides.createdBy))`, adding `createdAt` and `waiverBy.name` into the cell's `override`.

These stay the same 4 parallel queries, now with 2 more PK lookups per row.

**Role leakage:** `myDues()` (`queries.ts:679`) stays untouched and must not select either column. The e2e check (korist's `/finans` HTML has no `Son değişiklik`) covers this. The manager's name is visible only to managers.

---

## 6. @po AC 32: replay id includes the member, and the payment group does too

`aidat/actions.ts:70` and `:113` change from `derivedId(d.clientId, p)` to `derivedId(d.clientId, d.memberId, p)`.

**Second hole, same cause:** `paymentGroupId = d.clientId` (`:110`). If one client id pays two members, each multi-period, both members' rows share one group. `Aynı ödemede` on member A's entry would then list member B's periods. Use `group = parts.length > 1 ? derivedId(d.clientId, d.memberId, "group") : null`. That is still a uuid shape, and the `fe_dues` CHECK only requires `category = 'dues'`.

Migration: none. Old rows keep their ids and groups, and replays only matter within seconds of the original.

**e2e impact:** `phase5-finance.mjs` asserts the old shapes at `:729` (`payment_group_id === clientId`), `:739`, `:747` and `:752` (`derivedId(clientId, p)`). Update those, and the mirrored `derivedId` helper at `:1238` stays as is.

---

## 7. @po AC 24, 38, 39: Turso deploy path

### 7.1 `db:backup` fix (P1, `scripts/db-backup.ts`, not `src/`)

1. **Include `__drizzle_migrations`.** The filter `name not like '\_%'` drops it today. Replace it with an explicit exclusion of engine and tool tables only: `name not like 'sqlite\_%' escape '\' and name not like 'libsql\_%' escape '\' and name not like '\_litestream%' escape '\'`.
2. **After all INSERTs, emit `select sql from sqlite_master where type in ('index','trigger','view') and sql is not null`**, each statement followed by `;`. The autoindexes have `sql is null` and are recreated by the `CREATE TABLE`. Creating the indexes after the data load also proves the data still satisfies every unique and partial-unique index: if it doesn't, the restore fails loudly.
3. Keep `PRAGMA foreign_keys=OFF; BEGIN; … COMMIT;`, keep the output under `data/backups/` (git-ignored, never in `public/`), and print the row count per table.
4. The file contains password hashes and member PII. The README says: laptop only, never committed, never uploaded anywhere public.

**Acceptance (DBA review):** restore the newest backup into a scratch file (`sqlite3 <scratch>/r.db < backup.sql`). `DATABASE_URL=file:<scratch>/r.db npm run db:check` must pass, and the index count must equal the live DB's (31 today, 32 after 0006).

### 7.2 `db:check` additions (`scripts/db-check.ts`)

The existing check stays: `foreign_keys = 1`, and `foreign_key_check` returns no rows. Then:
- **Migrations applied:** `select count(*) from __drizzle_migrations` must be ≥ the number of entries in `drizzle/meta/_journal.json`. Print `migrations=7/7`. This catches "deployed code ahead of schema" and a restore that lost the table.
- **AC 24:** if the URL isn't `file:`, run `select count(*) from users where email like '%@arkhe.local'`. More than 0 fails with `demo accounts present: N`. Emails are stored lowercased (`create-admin` and the invite flow trim and lowercase).
- On `file:` only: `pragma quick_check` must return `ok`. This stays off Turso to avoid relying on a pragma the remote server might restrict.

`db:backup` and `db:check` already build the client from `DATABASE_URL` + `DATABASE_AUTH_TOKEN`, so they work against `libsql://` (AC 39). I'll confirm this in review against a `file:` URL plus code reading, since there's no Turso account this phase. libSQL builds with foreign keys on by default, which is why the local check reports 1. If Turso ever reports `foreign_keys=0`, `db:check` fails and the deploy stops.

### 7.3 Migration rule for this and every later deploy

- **Migrate first, then deploy code.** Every migration must be **expand-only**: the currently deployed build must keep working on the new schema. That's what makes the Vercel "Promote" rollback safe. 0006 qualifies: an index plus deleting rows the old code already ignored. A destructive change (drop or rename) would need two releases.
- Run migrations from the laptop, with the Turso URL **in the shell env only**:
  `DATABASE_URL=libsql://arkhe-<org>.turso.io DATABASE_AUTH_TOKEN=… npm run db:migrate`.
  Variables set in the shell win over `--env-file`. **Never put the Turso URL or token in `.env`.** Otherwise `npm run dev`/`e2e`/`seed` would aim at production. The guards would refuse the destructive ones, but `npm run dev` would happily write.

### 7.4 README text the tech lead can lift (AC 38 steps 2, 3, 8, 9)

**2. Migrate.** `DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run db:migrate`. This runs `db:backup`, then `drizzle-kit migrate`, then `db:check`. On a fresh DB the backup is empty, and that's fine.

**3. Verify.** `DATABASE_URL=… DATABASE_AUTH_TOKEN=… npm run db:check`. Expect `foreign_keys=1, orphaned rows=0, migrations=N/N` and no `demo accounts present`.

**8. Backups.** Run `npm run db:backup` (same env) before every migration (`db:migrate` does it automatically) and on the 1st of every month. Files go to `data/backups/<UTC timestamp>.sql` and contain personal data, so keep them on the laptop and never commit them. A second, independent copy with the free Turso CLI: `turso db shell <db> .dump > data/backups/<date>-turso.sql`.

**Restore drill (do it once before go-live, then after every migration that changes tables):**
1. `sqlite3 /tmp/arkhe-restore.db < data/backups/<file>.sql`
2. `DATABASE_URL=file:/tmp/arkhe-restore.db npm run db:check`, which must pass with `migrations=N/N`.

**Restore to Turso (real incident):**
1. `turso db create arkhe-restore-<yyyymmdd>`. Restore into a **new** DB, never on top of the broken one.
2. `turso db shell arkhe-restore-<yyyymmdd> < data/backups/<file>.sql`
3. `turso db show arkhe-restore-<yyyymmdd> --url` and `turso db tokens create arkhe-restore-<yyyymmdd>`
4. `DATABASE_URL=<new url> DATABASE_AUTH_TOKEN=<new token> npm run db:check`
5. In Vercel → Settings → Environment Variables, set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` to the new DB, then Redeploy and open `/api/saglik`.
6. Keep the old DB until the choir confirms the data, then `turso db destroy <old>`. If the free plan's database limit is reached at step 1, destroy the broken DB first, but only after the restore drill passed on that backup.

Data written between the backup and the incident is lost. The README states this, and says that's why the backup runs before every migration.

**9. Rollback.**
- **Code:** Vercel → Deployments → the previous good deployment → "Promote to Production". This is safe because migrations are expand-only (§7.3).
- **Schema or data:** there is no down-migration. Restore the backup that `db:migrate` wrote just before (steps above), then promote the deployment that matches that schema.
- **Service worker:** see the UI engineer's kill switch.

---

## 8. Replies

- **@po AC 24:** `db:check` fails on `@arkhe.local` users only for non-`file:` URLs (§7.2). The dev DB is full of them by design. The prod-smoke DB is `file:`, so AC 24's login refusal is proven by the app guard there, not by `db:check`.
- **@po AC 25:** agree. I extended it in two places: `assert-local-db` must also refuse `NODE_ENV=production`, otherwise the AC 25 test itself wipes the dev DB; and it must refuse a `file:` URL other than `data/arkhe.db`. Guards first, test second (§1.2).
- **@po AC 30:** no new columns are needed. One fix: `setWaiver` must also refresh `created_at` (§5).
- **@po AC 31:** implemented as "delete the freeze when no live payment remains for that member and period" (§4).
- **@po AC 32:** the payment group also needs the member (§6). Otherwise the `Aynı ödemede` list can mix two members.
- **@po AC 35:** the exact SQL is in §3.2, and the plans in §3.4.
- **@po AC 39:** confirmed for the client config. The backup content was **not** restorable, so §7.1 is a must and belongs with AC 38 (Must, priority 6).
- **@po deferred:** Phase 5 P3-7 and P3-8 stay deferred per spec §4. No schema impact.
- **@backend:** §4, §5 and §6 are action-code changes. None of them needs a migration besides 0006.
- **@tech lead:** in `db:check`, read the journal with `fs` relative to `process.cwd()`. The scripts always run from the repo root.
