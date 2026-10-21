# Phase 7: database plan (DBA)

Author: arkhe-dba. Date: 2026-10-21. Inputs: `po-spec.md` (the only other phase-7 file so far), `src/db/schema.ts`, `drizzle/0005_*` (the last `app_settings` rebuild), `drizzle/0006_*`, `scripts/{db-backup,db-check,assert-local-db}.*`, `e2e/lib.mjs` `cleanup()`, `node_modules/drizzle-orm/libsql/session.js` (`migrate`). I ran every SQL statement below on a scratch copy (`sqlite3 -readonly data/arkhe.db ".backup <scratch>/copy.db"`). That covers the migration, every CHECK (accept and reject cases), the claim under 8 concurrent libsql clients, the query plans, and a full dump → `executeMultiple` restore. The live dev DB was not written.

## 0. Summary

- **One new table, `backup_runs`** (§1). It holds a per-month claim, enforced by a partial unique index plus a single-statement `INSERT … WHERE NOT EXISTS`. It is not a settings row (answers §7 Q7).
- **`app_settings` gets the key `backup_recipients`** and **a new `created_at` column** (§2). The value is a canonical comma-separated list, not JSON, because only that format lets a CHECK validate it (§2.2). `created_at` closes a hole in banner rule (b) (§2.3).
- **Migration `0007_phase7_backup`** (§3). The new table is pure expand. `app_settings` needs a rebuild, because SQLite can't alter a CHECK. It is the same pattern `0005` used, and it is atomic and FK-safe under libsql's `migrate` (§3.2).
- **The run table is in the dump.** Restoring it is correct, including the in-flight `running` row (§4).
- **`db:restore`** uses `@libsql/client` `executeMultiple` into an exclusively created new file. It works today against the current dump format: 25 ms, `integrity_check ok`, 35 indexes, 7/7 migrations (§5).
- Money: none in this phase. Timestamps: unix seconds UTC, as everywhere. `backup_runs` rows are **hard-deleted** after 24 months: it's an operational log, not a record.

---

## 1. `backup_runs`

### 1.1 Drizzle definition (`src/db/schema.ts`, after `appSettings`)

```ts
export const BACKUP_TRIGGERS = ["cron", "manual"] as const;
export const BACKUP_STATUSES = ["running", "sent", "failed"] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

// One row per send attempt. A month is covered when any row for it is `sent`.
export const backupRuns = sqliteTable(
  "backup_runs",
  {
    id: id(),
    reportMonth: text("report_month").notNull(), // 'YYYY-MM', Istanbul calendar month
    trigger: text("trigger", { enum: BACKUP_TRIGGERS }).notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status", { enum: BACKUP_STATUSES }).notNull().default("running"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(now),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    sizeBytes: integer("size_bytes"),
    recipientCount: integer("recipient_count").notNull(),
    error: text("error"),
  },
  (t) => [
    // At most one in-flight run per month: the claim for AC 4.
    uniqueIndex("backup_runs_running_idx").on(t.reportMonth).where(sql`status = 'running'`),
    index("backup_runs_month_status_idx").on(t.reportMonth, t.status),
    index("backup_runs_started_idx").on(t.startedAt),
    check(
      "backup_runs_month_check",
      sql`report_month glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and substr(report_month, 6, 2) between '01' and '12'`,
    ),
    check("backup_runs_trigger_check", sql`trigger in (${inList(BACKUP_TRIGGERS)})`),
    check("backup_runs_status_check", sql`status in (${inList(BACKUP_STATUSES)})`),
    check("backup_runs_cron_actor", sql`trigger = 'manual' or actor_id is null`),
    check(
      "backup_runs_finished",
      sql`(status = 'running') = (finished_at is null) and (finished_at is null or finished_at >= started_at)`,
    ),
    check(
      "backup_runs_error",
      sql`(status = 'failed') = (error is not null) and (error is null or length(trim(error)) between 1 and 500)`,
    ),
    check(
      "backup_runs_size",
      sql`size_bytes is null or (typeof(size_bytes) = 'integer' and size_bytes between 0 and 1000000000)`,
    ),
    check(
      "backup_runs_recipients",
      sql`typeof(recipient_count) = 'integer' and recipient_count between 1 and 5`,
    ),
  ],
);
```

Column notes:
- `report_month` is text `YYYY-MM`, not a timestamp. It is the Istanbul calendar month the email reports on. That is a calendar label, so it stays independent of time zones and sorts correctly as text.
- `trigger`: `cron` | `manual`. `actor_id` is null for `cron` (CHECK). For `manual` it is the conductor, `ON DELETE SET NULL`, so the log survives a user hard-delete (e2e `cleanup()` hard-deletes `@e2e.test` users). The UI shows `Elle` when the name is gone. A manual row with `actor_id` null is allowed for that reason.
- `status`: `running` | `sent` | `failed`. **`Yarıda kaldı` is not stored.** It is derived at read time as `status = 'running' and started_at <= now - 600`. Once a later claim reaps such a row, it is stored as `failed` (§1.3).
- `finished_at` is set exactly when the status leaves `running` (CHECK).
- `error` is non-null exactly when the status is `failed` (CHECK). It is at most 500 characters and holds the mapped Turkish message from AC 22–24 only, never a raw error.
- `size_bytes` is the sum of the attachment sizes. It is null while running and set on `sent`, and also on `failed` when the size guard (AC 13) tripped, so the log can show why.
- `recipient_count` is required, 1–5. It is known at claim time, because no run is ever logged without recipients (§1.4).

### 1.2 Queries the screens and the route need, and the indexes behind them

| Query | SQL shape | Plan (verified) |
|---|---|---|
| Is month M covered? (cron fast path, Durum card, banner) | `select 1 from backup_runs where report_month = ? and status = 'sent' limit 1` | covering `backup_runs_month_status_idx` |
| Claim pre-check (fresh `running` or `sent` for M) | `… where report_month = ? and status in ('sent','running')` | covering `backup_runs_month_status_idx` |
| Reap stale running rows | `update … where status = 'running' and started_at <= unixepoch() - 600` | `backup_runs_started_idx` range |
| Run log (`Geçmiş`, 12 rows) | `select r.*, u.name from backup_runs r left join users u on u.id = r.actor_id order by r.started_at desc, r.rowid desc limit 12` | `backup_runs_started_idx` backwards, **one query with the join, no N+1** |
| Banner (a): latest automatic run | `select report_month, status, started_at from backup_runs where trigger = 'cron' order by started_at desc limit 1` | `backup_runs_started_idx` backwards, stops at the first cron row |
| Manual cooldown | `select max(finished_at) from backup_runs where status = 'sent' and started_at >= unixepoch() - 1200` | `backup_runs_started_idx` range. Bounding by `started_at` keeps it indexed: a run that finished in the last 10 min started at most 10 min + `maxDuration` (60 s) ago. 1200 gives slack. |
| Retention | `delete from backup_runs where started_at < unixepoch('now', '-24 months')` | `backup_runs_started_idx` range |

I did not add a `(trigger, started_at)` index. The table holds about 1–3 rows a month, so about 70 rows at the 24-month cap. Banner (a) walks at most a handful of index entries. Three indexes are enough: every query above is a search, and there are no full scans.

`r.rowid desc` is the tiebreak for two rows started in the same second. `id` is a random UUID, so it can't order rows.

### 1.3 The automatic claim (AC 3–5): exact procedure for the backend

The cron route, for month M = the previous Istanbul month of "today":

1. **Fast path (one indexed read):** if M is covered → `{"status":"skipped"}`, no write. This is the normal daily call (AC 34).
2. **Recipients:** read `backup_recipients`. If it is missing → `skipped`, no row (§1.4).
3. **Claim**, one `db.batch([...], "write")`, which is one transaction:
   ```sql
   update backup_runs
     set status = 'failed', finished_at = unixepoch(),
         error = 'Gönderim yarıda kaldı (10 dakikada tamamlanmadı).'
     where status = 'running' and started_at <= unixepoch() - 600;
   insert into backup_runs (id, report_month, trigger, actor_id, status, recipient_count)
     select ?, ?, 'cron', null, 'running', ?
     where not exists (select 1 from backup_runs
                       where report_month = ? and status in ('sent', 'running'));
   ```
   `rowsAffected` of the insert decides it. 1 → we own the run. 0 → `skipped` (covered meanwhile, or a fresh `running` row exists: AC 5 "younger than 10 minutes blocks").
   - A `SQLITE_CONSTRAINT_UNIQUE` on `backup_runs_running_idx` or `SQLITE_BUSY` from the batch also means "someone else has it": return `skipped` and log nothing. The next day retries anyway.
   - Why both the `NOT EXISTS` and the partial unique index: SQLite (and Turso's single writer) runs the whole insert under the write lock, so the `NOT EXISTS` is already atomic. The index is the backstop if someone later splits the read and the write. I raced 8 separate libsql clients on one file: exactly one `rowsAffected = 1`, no errors.
   - The reap must run in the same batch **before** the insert. Otherwise a stale `running` row would hold the unique slot for M forever.
4. Build the dump, CSVs and encryption (AC 26), then send.
5. **Finish**, one batch:
   ```sql
   update backup_runs set status = ?, finished_at = unixepoch(), size_bytes = ?, error = ?
     where id = ? and status = 'running';
   delete from backup_runs where started_at < unixepoch('now', '-24 months');
   ```
   The `and status = 'running'` guard means a row that some later claim already reaped is never flipped back. That can't happen with `maxDuration = 60` against the 600 s threshold, but the guard is free.

**Failure semantics (accepted trade-off):** if the email went out but the finish batch fails (Turso blip), the row stays `running`. After 10 min it reads as `Yarıda kaldı`, the next daily call reaps it and **sends again**. For a backup, at-least-once is the right side to err on. The board may get a duplicate once in a blue moon.

### 1.4 The manual claim (AC 17)

Use the same batch shape, with one extra `NOT EXISTS` so that a double tap or two tabs can't both pass the cooldown:
```sql
insert into backup_runs (id, report_month, trigger, actor_id, status, recipient_count)
  select ?, ?, 'manual', ?, 'running', ?
  where not exists (select 1 from backup_runs where report_month = ? and status = 'running')
    and not exists (select 1 from backup_runs where status = 'sent'
                    and started_at >= unixepoch() - 1200 and finished_at > unixepoch() - 600);
```
When `rowsAffected = 0`, the action does one read to pick the message: a fresh `running` row → see @po 4. Otherwise it shows the cooldown text, with minutes = `ceil((last_sent_finished_at + 600 - now) / 60)`.

**No row without recipients**, for both triggers. `recipient_count` is NOT NULL 1–5. The cron returns `skipped`, because banner 21 already tells the conductor. The action refuses with `Önce en az bir alıcı kaydet.` A run with recipients but a missing SMTP or passphrase **is** logged as `failed` (AC 22/23), and those rows have a valid count.

### 1.5 Role exposure

- `/yedek` and the banner are manager-only, so the run log never reaches a member. The board can see `error` (mapped Turkish strings only, AC 24), `recipient_count`, and the actor's name. They see all of that in the app already.
- `error` must be written from the fixed message map. The CHECK limits its length, not its content. **@backend:** never interpolate `err.message`.

---

## 2. `backup_recipients` in `app_settings`

### 2.1 Drizzle changes

```ts
export const SETTING_KEYS = ["recording_email", "dues_payment_info", "backup_recipients"] as const;

export const appSettings = sqliteTable(
  "app_settings",
  {
    key: text("key", { enum: SETTING_KEYS }).primaryKey(),
    value: text("value").notNull(),
    // First save of this key; upserts never touch it.
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  () => [
    /* existing four checks unchanged */
    check(
      "app_settings_backup_recipients",
      sql`key <> 'backup_recipients' or (value = lower(value)
        and value not glob ('*[ ;<>"' || char(9, 10, 13) || ']*')
        and length(value) <= 1274 and value like '%_@_%._%'
        and value not like ',%' and value not like '%,' and instr(value, ',,') = 0
        and length(value) - length(replace(value, ',', '')) <= 4
        and length(value) - length(replace(value, '@', '')) = length(value) - length(replace(value, ',', '')) + 1)`,
    ),
  ],
);
```

### 2.2 Value format: `a@x.com,b@y.org` (canonical, comma-separated, no spaces)

- The app writes `addresses.join(",")` after it has trimmed, lowercased, deduped (order of first appearance) and checked each address against `RECORDING_EMAIL_RE` (`src/lib/homework/mail.ts`, the Phase 4 rule, as AC 14 asks). It reads with `value.split(",").filter((a) => RECORDING_EMAIL_RE.test(a))`, the same defensive read `getRecordingEmail` does.
- **Why not JSON:** SQLite forbids subqueries in CHECK, so `json_each` is out. A JSON CHECK could only test "is an array of length 1–5", not what is inside. With commas, the CHECK can count the elements (≤ 4 commas, so ≤ 5 addresses) and require exactly one `@` per element and no empty element. It also blocks whitespace, `;`, `<`, `>` and `"`. Those characters are what would let a value turn into a display name or a second address once it is in the `To:` header (pass nodemailer the split array, never the raw string). `RECORDING_EMAIL_RE` allows none of them, so the CHECK never rejects what the app accepts.
- Max length: 5 × 254 + 4 = 1274, inside the existing 1–2000 `app_settings_value_length`.
- The CHECK doesn't enforce uniqueness. The app dedupes. A duplicate would only mean one address appears twice in `To:`.
- Verified on the scratch copy: 1, 2 and 5 addresses are accepted. Rejected: 6 addresses, `", "`, uppercase, `,,`, a trailing comma, an element without `@`, and an embedded newline.

**Writes:** `insert … on conflict(key) do update set value, updated_at, updated_by`. **Never set `created_at` in the update.** Do it in `db.transaction` (write) that first reads the old value. That way the change notice's "old list" (AC 14) is exactly the one this save replaced, even with two conductor tabs. Send the notice **after** commit. "Changed" means the old canonical string ≠ the new one. If there was no row, it's a first save and no notice goes out.

There is no delete path in the app (the minimum is 1 address). Only e2e deletes the row, to get a clean state.

### 2.3 Why `created_at` (banner rule (b), AC 20)

Rule (b) needs "recipients were **first** saved before the 1st of the current month". `updated_at` moves on every save. If the şef edits the list on the 2nd, rule (b) would stop warning on the 3rd about a month that genuinely wasn't sent. That is also exactly the pattern a hijacked session would produce. `created_at` is set on first insert and never updated, so rule (b) becomes `created_at < <unix of 1st of current month 00:00 Istanbul>`. The column is generic (every setting gets it). In the migration, existing rows are backfilled from their `updated_at`.

**@po:** the AC 20 e2e should backdate `created_at` (not `updated_at`) of `backup_recipients`. The audit line `Son değişiklik` keeps using `updated_at`/`updated_by`.

---

## 3. Migration `0007_phase7_backup`

### 3.1 Generation

1. Edit `schema.ts` as in §1.1 and §2.1.
2. Run `npx drizzle-kit generate --name phase7_backup`. The output is `drizzle/0007_phase7_backup.sql` plus `meta/0007_snapshot.json` and a journal entry.
3. **One hand edit**, in the rebuild's copy statement, so existing rows keep a meaningful `created_at` instead of the migration time:
   ```sql
   INSERT INTO `__new_app_settings`("key", "value", "created_at", "updated_at", "updated_by")
     SELECT "key", "value", "updated_at", "updated_at", "updated_by" FROM `app_settings`;
   ```
   Drizzle generates it without `created_at` (the column would get its default). Add the column to both lists. Nothing else should be edited, and the snapshot is unaffected.
4. Expected statement order: `CREATE TABLE backup_runs`, its 3 indexes, then `PRAGMA foreign_keys=OFF`, `CREATE TABLE __new_app_settings` (5 checks), `INSERT … SELECT`, `DROP TABLE app_settings`, `ALTER TABLE … RENAME`, `PRAGMA foreign_keys=ON`. That is exactly the shape I applied to the scratch copy: `foreign_key_check` empty, `integrity_check ok`, both existing settings kept with `created_at = updated_at`.

### 3.2 Live-data safety (AC 35)

- **`backup_runs`:** a new table with no data. Pure expand.
- **`app_settings` rebuild:** not literally "expand-only". It is a data-preserving copy of 2 rows, and it is backward-compatible:
  - Old code reading or writing `app_settings` still works against the new table, because `created_at` has a default and no column was removed or renamed. That covers the gap between `db:migrate` and the deploy.
  - New code against the old table never happens, because the README order is migrate first.
- **Atomic on Turso:** drizzle's libsql `migrate` calls `client.migrate()`. That runs `PRAGMA foreign_keys=off` outside the transaction and the statements as one batch. A failure halfway rolls back, so there is no state with a missing `app_settings`. Nothing references `app_settings`, so `DROP TABLE` can't cascade or orphan anything even if FKs were on. `0005` did the same rebuild.
- Deploy: `npm run db:migrate` (backup → migrate → `db:check`), then deploy the code. `db:check` then expects 8/8 migrations.
- **@po (AC 35 wording):** please accept "expand-only, plus a lossless rebuild of `app_settings` to widen its key CHECK". There is no way to add an allowed key to a SQLite CHECK without the rebuild. The alternative, a separate table only for recipients, would split settings across two places for no gain.

### 3.3 Seed, fixtures and e2e

- `seed.ts`: **no** `backup_recipients` and no runs, so a fresh `db:reset` matches AC 21's "not configured" state.
- `e2e/lib.mjs` `cleanup()`: add `delete from backup_runs` and `delete from app_settings where key = 'backup_recipients'`. Both are covered by the existing local-file guard at the top of `lib.mjs`. Tests that need recipients insert them, and should use the canonical format (e2e inserts bypass the action's normalisation, but the CHECK still enforces the shape).
- `e2e/prod.mjs` gets the migration through `drizzle-kit migrate` as before. Nothing new is needed.

---

## 4. The run table and `db:backup` / restore: **include it**

**Yes, `backup_runs` (schema and rows) is in every dump**, both `db:backup` and the email attachment. They use one shared dump module and one rule: every non-engine table (AC 27).

1. **Schema consistency.** `__drizzle_migrations` is in the dump and says `0007` is applied. If the table's `CREATE` were left out, the restored DB would claim migration 0007 while lacking its table. `db:check` would pass (it counts migrations and doesn't diff the schema), and `/yedek` and the cron would crash on first use. So at least the schema must be included, and a schema-only special case in the shared dump code isn't worth it.
2. **Restoring the rows is the correct behaviour.** After an incident restore into Turso, the covered months come back, so the cron doesn't re-send old months. The run log history is kept.
3. **The in-flight row is correct as-is.** The attachment's dump is taken after the claim, so it contains its own `status = 'running'` row. In a restored DB, that row is older than 10 minutes, so it reads `Yarıda kaldı` and is reaped as `failed` on the next claim. That is true for the restored world: the restored DB never saw that run finish. The effect is that the next daily cron sends a fresh backup of the restored DB if that month isn't otherwise covered, which is what you'd want after an incident. **No special case in the dump or the restore.**
4. Size: about 70 short rows at most, negligible.

The same reasoning puts `app_settings.backup_recipients` in the dump: a restore brings the recipients back.

The dump's secret-like content is already safe at rest: session IDs and invite tokens are stored as SHA-256 hashes and passwords as scrypt hashes, and nothing new in this phase stores a secret.

---

## 5. `db:restore` design (`scripts/db-restore.ts`)

`package.json`: `"db:restore": "tsx scripts/db-restore.ts"`. It reads no `.env`, because it never uses `DATABASE_URL`.

```
npm run db:restore -- <file.sql> <target.db>
```

Steps:
1. **Args:** exactly 2, else print usage and exit 1.
2. **Input checks:** the input must exist. If it starts with the encryption magic (`ARKHE-BK1`), exit 1 with `This file is encrypted; run npm run db:decrypt first.`
3. **Target must be a local path.** Refuse anything matching `/^[a-z][a-z0-9+.-]*:/i` (`file:`, `libsql:`, `http(s):`, `ws(s):`) or `:memory:` with `Restore target must be a local file path.`
4. **Never overwrite.** If `target`, `target-wal`, `target-shm` or `target-journal` exists → `Refusing to restore over an existing file.`, exit 1. Then create the file with `fs.openSync(target, "wx")` (`O_EXCL`), which closes the check-then-create race, and close it. Run `mkdirSync(dirname(target), { recursive: true })` first. An empty 0-byte file is a valid empty SQLite DB for libsql.
5. `createClient({ url: "file:" + path.resolve(target) })`, then **`await client.executeMultiple(dump)`**.
   - Never split the dump on `;` or newlines yourself: text values contain both, and only SQLite's parser handles them correctly.
   - The dump's own `PRAGMA foreign_keys=OFF; BEGIN; PRAGMA defer_foreign_keys=ON; … COMMIT;` makes it one transaction, with FKs checked at `COMMIT`. A dump with orphans or a broken unique index fails as a whole.
6. **On any error:** `client.close()`, delete `target` plus `-wal`, `-shm` and `-journal`, print `Restore failed: <sqlite message>`, exit 1. There is never a half-restored file.
7. **On success:** print `Restored: <absolute path> (<n> tables)` and the next step, `DATABASE_URL=file:<absolute path> npm run db:check`. Keep `db:check` a separate command, as AC 29/30 have it. Node's `--env-file` doesn't override an already-set `DATABASE_URL`, so the `.env` in `db:check` can't redirect it.

Verified with the **current** `db-backup.ts` output of the scratch copy: `executeMultiple` restore in 25 ms, `foreign_key_check` empty, `integrity_check ok`, 35 indexes, `__drizzle_migrations` 7/7, row counts equal. So the format needs no change for restore.

Notes for the README and the drill:
- A backup from an older schema, restored with newer code, makes `db:check` report `migrations missing: 7 of 8`. That is correct. The fix is `DATABASE_URL=file:<target> npx drizzle-kit migrate` on the restored file.
- `db:check` switches the restored file to WAL. The AC 30 cleanup must remove `<temp>`, `<temp>-wal` and `<temp>-shm`. Put the temp file under `data/` (git-ignored), not `/tmp`. Then the README path and the e2e path are the same.
- AC 30 compares `users`, `attendance`, `submissions` and `finance_entries` counts. `backup_runs` would differ, because the dump holds the run as `running` while the live row is `sent`. Don't add it to that comparison.

---

## 6. Replies to the PO

- **@po §7 Q7 (table vs settings row):** a table. A settings row can't hold a history (AC 19 needs 12 rows and 24 months), and it can't make the claim atomic per month. With the table, the claim is one `INSERT … WHERE NOT EXISTS` behind a partial unique index (§1.3).
- **@po §7 Q8 (weekly later):** the table supports it with an expand-only `ALTER TABLE ADD COLUMN kind` (`monthly` | `weekly_backup`) defaulting to `monthly`, plus widening the unique index. Nothing to build now.
- **@po §7 Q3 (mailboxes as a data store):** from the DB side, the attachment holds only hashes for passwords, sessions and invites (§4). The plain CSVs are the larger exposure, as you already say.
- **@po AC 19 "Yarıda kaldı" chip:** a stale row shows `Yarıda kaldı` only until the next claim reaps it. From then on it is `failed`, shown as `Başarısız` with the error `Gönderim yarıda kaldı (10 dakikada tamamlanmadı).`, and the retry row sits right above it. A fourth stored status isn't worth it. Your AC 19 e2e (arranging a fresh and a stale `running` row) still works, as long as the two rows are for **different months** (unique index per month).
- **@po AC 17 + AC 28 conflict:** AC 28 wants "two manual sends' attachments differ", but AC 17's cooldown refuses a second manual send within 10 minutes. The e2e must backdate the first `sent` row (`started_at`/`finished_at` − 15 min) between the two sends. Please note that in the AC so nobody "fixes" the cooldown.
- **@po 4, new copy needed:** a manual send while another run for the same month is `running` (fresh) is refused. Proposed toast: `Şu anda bir gönderim sürüyor. Birkaç dakika sonra yeniden dene.` No run is logged.
- **@po AC 20 e2e:** backdate `app_settings.created_at` for `backup_recipients`, not `updated_at` (§2.3).
- **@po AC 2/3 detail:** a cron call with no recipients saved returns `skipped` and logs no row (`recipient_count` is required). Banner 21 covers that state.
- **@po AC 35:** see §3.2. The `app_settings` rebuild is lossless and backward-compatible, but it is not literally "expand-only".
- **@backend:** the claim and finish SQL is in §1.3 and §1.4. Keep the stale threshold (600 s) and the cooldown in one shared constant. `maxDuration` 60 must stay well below 600. Treat `SQLITE_BUSY` or a unique violation on the claim as `skipped`. Use `db.batch` (not an interactive transaction) for the claim, so a skipped or claimed call is one round trip to Turso.
