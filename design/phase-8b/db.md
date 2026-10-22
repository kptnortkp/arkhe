# Phase 8b: database plan (DBA)

Author: arkhe-dba. Date: 2026-10-21.

Inputs:
- `po-spec.md` (45 ACs, §7 q1 is mine) and `ui.md` (the only other 8b file so far; I reply to its @dba point in §11)
- Phase 8 `db.md` and `po-decisions.md`: migration 0008 comes first, so this one is **0009**
- `src/db/schema.ts`, `src/db/write-tx.ts`, `src/lib/attendance/{close,roster,rehearsals}.ts`, `src/app/(portal)/uyeler/actions.ts`, `calismalar/actions.ts`, `api/calismalar/[id]/isaret/route.ts`, `finans/actions.ts`, `finans/aidat/actions.ts`, `src/lib/backup/dump.ts`, `scripts/{db-check,db-restore,finance-fixture}.*`, `e2e/lib.mjs` `cleanup()`, drizzle's `SQLiteTimestamp`

How I verified it (scratch only; I never wrote to `data/arkhe.db`, `src/` or `drizzle/`):
- Started from a backup of the Phase 8 scratch DB (migrations 0000–0008, 9/9).
- Put the Drizzle code of §2 into a **copy** of the Phase 8 `schema.ts`, ran the real `drizzle-kit generate --name phase8b_import` against a copy of `drizzle/`, then `drizzle-kit migrate` on the copy: 10/10, `foreign_key_check` empty, `db:check` ok. Grep of the generated SQL for `ALTER|DROP|__new_`: **0**.
- 67 accept/reject direct writes (§8), all as expected.
- Bulk-write timings for 5000 attendance rows and 5000 finance entries, three write strategies (§5.3).
- `EXPLAIN QUERY PLAN` for every new query at volume: 50 batches, 400 imported rehearsals with 9200 attendance rows, 8000 imported entries (§7).
- `dumpDatabase` → `db:restore` → `db:check` round trip with import rows in every target kind (§10).
- The e2e cleanup order in §11, run against the new FKs (and the current order, which fails).

---

## 0. Summary

- **Two new tables, nothing else.** `import_batches` (one row per committed file: the log and the undo stack) and `import_items` (one row per thing a batch created or changed: the undo list and the `İçe aktarıldı` marker). **No new column on any existing table**, no new index on any existing table, no trigger. @po §7 q1: confirmed, with one change: the before-values are stored as JSON **for every type whose rows can be edited by hand**, not only member rows (§2.3), because "edited since" needs them.
- **`import_items` has one typed FK column per target table** (not a polymorphic `target_table + id`), so every link is a real FK and a CHECK forces exactly one target per row (AC 42).
- **Attendance is not itemised.** One item per imported rehearsal; its attendance rows go with it by the existing cascade. A 5000-row `yoklama` file writes ~140 items, not 5000.
- **Former members pass every `users` CHECK** (§3.1), verified by insert.
- **A 5000-row commit fits easily**: about 40–90 statements and 20–50 ms of SQLite work. Against Turso from Vercel `arn1` the cost is round trips, roughly 0.3–1 s in-region. **The only way to break the 60 s limit is one statement per row** (5 000–10 000 round trips ≈ 25–150 s). So chunked multi-row inserts are a hard rule (§5).
- **Undo deletes the batch's items** and keeps the batch row with `status = 'undone'`. So "`kayit_no` unique among non-undone items" is a plain partial unique index.
- **One recommendation that changes D13 (§6.4):** an undo should **hard-delete** the untouched finance entries it created, not void them. With voiding, a dues-period batch can never be undone once a payment batch was committed against it, and because undo is a stack, every older batch is then frozen for ever. @po please decide; both variants are specified.
- **e2e `cleanup()` must wipe the import tables before `seedFinance`** (§11). I ran the order; the current order fails on the new FKs.

---

## 1. Answers to @po §7 q1

1. **Tables only: yes.** Markers and undo live in `import_batches` + `import_items`.
   - Marker on a rehearsal: `exists (select 1 from import_items where rehearsal_id = ?)`.
   - Marker on an entry: `select kayit_no from import_items where finance_entry_id = ?`.
   - Both are unique-index lookups (§7). No column on `rehearsals` or `finance_entries`.
   - The marker disappears with the undo, because the items do.
2. **Former members vs. the `users` CHECKs: they pass.** See §3.1. Checked by insert:
   - `users_left_matches_active` `(is_active = 1) = (left_at is null)`: `is_active = 0`, `left_at` set.
   - `users_left_after_joined` `left_at >= joined_at`: `left_at` = end of the leaving day, `joined_at` = start of the joining day, and the importer checks `ayrilis_tarihi ≥ katilim_tarihi`. Even a same-day join and leave passes (start of day ≤ 23:59:59).
   - `users_email_lower_check`: the importer stores `email.toLowerCase()`, the same as the member form.
   - `users_role_check`: `member`. `users_voice_part_check`: one of the four, required for new former members.
   - `password_hash` is NULL; there is no CHECK on it, which is exactly the invite-pending shape.

   Rejected, as they should be: inactive without `left_at`, `left_at < joined_at`, an upper-case email, active with `left_at`.

---

## 2. Schema

### 2.1 Drizzle (`src/db/schema.ts`, after the Phase 8 tables)

Add `foreignKey` to the `drizzle-orm/sqlite-core` import.

```ts
export const IMPORT_KINDS = [
  "members",
  "terms",
  "attendance",
  "entries",
  "dues_periods",
  "dues_payments",
] as const;
export const IMPORT_STATUSES = ["imported", "undone"] as const;
export const IMPORT_TARGETS = [
  "user",
  "term",
  "rehearsal",
  "finance_entry",
  "dues_period",
  "dues_override",
  "sponsor",
] as const;
export const IMPORT_ACTIONS = ["create", "update"] as const;
export const KAYIT_SCOPES = ["entries", "dues_payments"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

// One row per committed file; never stores the file itself. Integer id = commit order (the undo stack).
export const importBatches = sqliteTable(
  "import_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: IMPORT_KINDS }).notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("imported"),
    // The commit form's uuid: a double tap or replay finds the batch it already wrote.
    clientKey: text("client_key").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    fileSha256: text("file_sha256").notNull(),
    rowCount: integer("row_count").notNull(),
    addedCount: integer("added_count").notNull(),
    updatedCount: integer("updated_count").notNull(),
    unchangedCount: integer("unchanged_count").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    undoneAt: integer("undone_at", { mode: "timestamp" }),
    undoneBy: text("undone_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("import_batches_client_key_idx").on(t.clientKey),
    index("import_batches_kind_idx").on(t.kind, t.id),
    index("import_batches_sha_idx").on(t.fileSha256),
    check("import_batches_kind_check", sql`kind in (${inList(IMPORT_KINDS)})`),
    check("import_batches_status_check", sql`status in (${inList(IMPORT_STATUSES)})`),
    check(
      "import_batches_undo",
      sql`(status = 'undone') = (undone_at is not null) and (undone_at is null) = (undone_by is null) and (undone_at is null or undone_at >= created_at)`,
    ),
    check("import_batches_client_key_check", sql`length(client_key) = 36`),
    check(
      "import_batches_file_name",
      sql`length(trim(file_name)) between 1 and 120 and length(file_name) <= 120 and file_name not glob ('*[' || char(1, 9, 10, 13, 47, 92) || ']*')`,
    ),
    check(
      "import_batches_file_size",
      sql`typeof(file_size) = 'integer' and file_size between 1 and 1048576`,
    ),
    check(
      "import_batches_sha",
      sql`length(file_sha256) = 64 and file_sha256 not glob '*[^0-9a-f]*'`,
    ),
    check(
      "import_batches_counts",
      sql`typeof(row_count) = 'integer' and typeof(added_count) = 'integer' and typeof(updated_count) = 'integer' and typeof(unchanged_count) = 'integer' and row_count between 1 and 5000 and added_count >= 0 and updated_count >= 0 and unchanged_count >= 0 and added_count + updated_count + unchanged_count = row_count and added_count + updated_count >= 1`,
    ),
  ],
);

const itemTargetColumns = {
  user: "user_id",
  term: "term_id",
  rehearsal: "rehearsal_id",
  finance_entry: "finance_entry_id",
  dues_period: "dues_period_id",
  dues_override: "override_period_id",
  sponsor: "sponsor_id",
} as const satisfies Record<ImportTarget, string>;
// Restrict FKs never go null; set-null ones go null when the row was deleted by hand ("gone").
const neverNull = new Set<ImportTarget>(["user", "finance_entry", "sponsor"]);
const itemTargetCheck = sql.raw(
  `coalesce(case target ${IMPORT_TARGETS.map((target) => {
    const own = itemTargetColumns[target];
    const others = Object.values(itemTargetColumns)
      .filter((c) => c !== own)
      .map((c) => `${c} is null`)
      .join(" and ");
    return `when '${target}' then ${others}${neverNull.has(target) ? ` and ${own} is not null` : ""}`;
  }).join(" ")} end, 0)`,
);

// What a batch wrote: the undo list and the "İçe aktarıldı" marker. Deleted with the undo.
export const importItems = sqliteTable(
  "import_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    target: text("target", { enum: IMPORT_TARGETS }).notNull(),
    action: text("action", { enum: IMPORT_ACTIONS }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "restrict" }),
    termId: text("term_id").references(() => terms.id, { onDelete: "set null" }),
    rehearsalId: text("rehearsal_id").references(() => rehearsals.id, { onDelete: "set null" }),
    financeEntryId: text("finance_entry_id").references(() => financeEntries.id, {
      onDelete: "restrict",
    }),
    duesPeriodId: text("dues_period_id").references(() => duesPeriods.id, {
      onDelete: "set null",
    }),
    overridePeriodId: text("override_period_id"),
    overrideUserId: text("override_user_id"),
    sponsorId: text("sponsor_id").references(() => sponsors.id, { onDelete: "restrict" }),
    kayitScope: text("kayit_scope", { enum: KAYIT_SCOPES }),
    kayitNo: text("kayit_no"),
    // Member updates: the values to restore. JSON, see db.md §2.3.
    beforeJson: text("before_json"),
    // The row as written; undo refuses when the live row no longer matches it.
    afterJson: text("after_json"),
  },
  (t) => [
    foreignKey({
      columns: [t.overridePeriodId, t.overrideUserId],
      foreignColumns: [duesOverrides.duesPeriodId, duesOverrides.userId],
      name: "import_items_override_fk",
    }).onDelete("set null"),
    index("import_items_batch_idx").on(t.batchId, t.target),
    uniqueIndex("import_items_kayit_idx")
      .on(t.kayitScope, t.kayitNo)
      .where(sql`kayit_no is not null`),
    index("import_items_user_idx").on(t.userId).where(sql`user_id is not null`),
    uniqueIndex("import_items_term_idx").on(t.termId).where(sql`term_id is not null`),
    uniqueIndex("import_items_rehearsal_idx")
      .on(t.rehearsalId)
      .where(sql`rehearsal_id is not null`),
    uniqueIndex("import_items_entry_idx")
      .on(t.financeEntryId)
      .where(sql`finance_entry_id is not null`),
    uniqueIndex("import_items_period_idx")
      .on(t.duesPeriodId)
      .where(sql`dues_period_id is not null`),
    uniqueIndex("import_items_override_idx")
      .on(t.overridePeriodId, t.overrideUserId)
      .where(sql`override_period_id is not null`),
    uniqueIndex("import_items_sponsor_idx").on(t.sponsorId).where(sql`sponsor_id is not null`),
    check("import_items_target_check", sql`target in (${inList(IMPORT_TARGETS)})`),
    check("import_items_action_check", sql`action in (${inList(IMPORT_ACTIONS)})`),
    check("import_items_one_target", itemTargetCheck),
    check(
      "import_items_override_pair",
      sql`(override_period_id is null) = (override_user_id is null)`,
    ),
    check("import_items_update_is_user", sql`action = 'create' or target = 'user'`),
    check(
      "import_items_kayit",
      sql`(kayit_no is null) = (kayit_scope is null) and (kayit_scope is null or kayit_scope in (${inList(KAYIT_SCOPES)})) and (kayit_no is null or (length(kayit_no) between 1 and 40 and kayit_no not glob '*[^A-Za-z0-9._/-]*')) and (kayit_no is null or target in ('finance_entry', 'dues_override')) and (target <> 'finance_entry' or kayit_no is not null)`,
    ),
    check(
      "import_items_json",
      sql`(action = 'update') = (before_json is not null) and (before_json is null or (json_valid(before_json) and length(before_json) <= 4000)) and (after_json is null or (json_valid(after_json) and length(after_json) <= 4000)) and (target not in ('user', 'rehearsal', 'dues_period', 'dues_override', 'sponsor') or after_json is not null)`,
    ),
  ],
);
```

There is no literal `;` in any CHECK; drizzle-kit cuts CHECK text at one (see the `backup_recipients` comment). The file-name CHECK uses `char(...)` for that reason.

### 2.2 Column semantics

**`import_batches`**
- **`id`** is an integer AUTOINCREMENT, used as the **commit order**. "The latest batch that is not undone" is `where status = 'imported' order by id desc limit 1`. `created_at` has one-second resolution and can't order two commits in the same second.
  - Batches are never deleted by the app (only by e2e), so `sqlite_sequence` not being in the dump is harmless: a restore resumes at max + 1 (verified, §10).
  - The URL of a batch is never shown to members, so a guessable integer is fine.
- **`kind`:** English codes, as everywhere in the DB. Slug ↔ kind lives in the type definitions (`uyeler` → `members`, `donemler` → `terms`, `yoklama` → `attendance`, `hareketler` → `entries`, `aidat-donemleri` → `dues_periods`, `aidat-odemeleri` → `dues_payments`).
- **`status` + `undone_at` + `undone_by`:** all three set together, or none (CHECK `import_batches_undo`, AC 42). Status is redundant with `undone_at`, but the spec wants a status CHECK and the log page reads clearer with it.
- **`client_key`:** the uuid the commit form carries. It is unique. A double tap or a replay finds the existing batch, and the action returns its result instead of writing again (AC 18). The unique index is the backstop if two requests race.
- **`file_name`:** cleaned by the app (basename, control characters removed, trimmed, cut to 120). The CHECK refuses `/`, `\`, tab, CR, LF and char(1), so a path can't sneak in.
- **`file_size`:** bytes, 1 … 1 048 576 (the spec's 1 MB, `ui.md` §9 point 8).
- **`file_sha256`:** lower-case hex, exactly 64. The `not glob '*[^0-9a-f]*'` form rejects upper case and non-hex.
- **Counts:** integers ≥ 0, `added + updated + unchanged = row_count`, and at least one change. A file that changes nothing is never committed (AC 17: no button), so a batch with nothing to undo can't exist. `row_count` is the number of **data rows** in the file (≤ 5000), and the three counts are per row, exactly as the preview shows them. @backend: count per file row, not per rehearsal.
- **No column can hold file content.** The widest text is `file_name` (120). AC 18's `pragma table_info` check holds.

**`import_items`**
- **`target` + one FK column.** The FK `on delete` follows what can happen to the target:

  | target | column | on delete | why |
  |---|---|---|---|
  | `user` | `user_id` | restrict | AC 42. Users are never deleted by the app. Undo deletes the item first, then the former member. |
  | `finance_entry` | `finance_entry_id` | restrict | Entries are never deleted by hand (ledger rule). |
  | `sponsor` | `sponsor_id` | restrict | No sponsor delete exists. |
  | `term` | `term_id` | set null | No delete exists today; set null keeps any future delete from failing. |
  | `rehearsal` | `rehearsal_id` | set null | e2e cleanup deletes rehearsals. A hand delete must not fail on a marker. |
  | `dues_period` | `dues_period_id` | set null | `deleteDuesPeriod` exists. With restrict it would fail with a misleading FK error. |
  | `dues_override` | (`override_period_id`, `override_user_id`) → `dues_overrides` PK | set null | `removeWaiver` and `voidEntry`'s freeze cleanup delete overrides. |

  A set-null column that went NULL means **the row was deleted by hand since**. Undo treats it as a conflict (§6.2). The `import_items_one_target` CHECK therefore requires "no other column set" for every target, and "own column set" only for the three restrict targets. Verified: the delete by hand nulls the column, and the CHECK still holds.
- **`action`:** `create` (the batch made the row) or `update` (the batch changed an existing row). `update` exists only for `user` (CHECK).
- **`kayit_scope` + `kayit_no`:** set together (CHECK). Scope = the type namespace: `entries` for `hareketler`, `dues_payments` for `aidat-odemeleri` (payments **and** waivers share it, D11). Every imported finance entry has a number (CHECK). Freeze overrides written by a member-history rate change have none.
- **`before_json` / `after_json`:** see §2.3. `before_json` exists exactly for `update` items (CHECK). `after_json` is required for every target that can be edited by hand. Both must be valid JSON ≤ 4000 characters.
- **No `line` column.** The undo messages need a name, a date, a period name or a `kayit_no`, and all of those come from the target row or the snapshot.

### 2.3 Snapshot JSON (exact keys; timestamps = unix seconds, booleans = 0/1, absent = `null`)

Undo compares the live row with `after_json` using `is` (NULL-safe), in SQL with `json_extract` or in JS. A mismatch means "edited since". The keys are camelCase, matching the Drizzle field names.

| target / action | `before_json` (restore values) | `after_json` (what must still be true) |
|---|---|---|
| `user` / `update` | `joinedAt, leftAt, isActive, voicePart, rate, rateNote` (`rate: null` = no `member_dues` row) | the same keys after the import, plus `role` |
| `user` / `create` (former member) | — | `name, email, phone, role, voicePart, isActive, joinedAt, leftAt, hasPassword, rate, rateNote` |
| `rehearsal` / `create` | — | `type, title, location, note, startsAt, endsAt, openedAt, closedAt, cancelledAt, parts` (sorted, comma-joined, `""` for none), `rows` (attendance row count incl. auto-absent) |
| `dues_period` / `create` | — | `name, startsOn, endsOn, dueOn, amountKurus, reducedAmountKurus` |
| `dues_override` / `create` | — | `kind, owedKurus, reason, createdBy, createdAt` |
| `sponsor` / `create` | — | `name, nameKey, contactName, contact, note, isActive` |
| `term`, `finance_entry` | — | none (terms have no edit path; entries carry their own `revision`/`updated_at`/`voided_at`) |

**Why member updates ignore name, phone and email edits:** the import never changes them, and undo doesn't restore them. A treasurer fixing a typo in a name after the import shouldn't block the undo of a date change. `role` is included because a role change moves the person in or out of the dues and attendance rules. This also keeps personal data out of the item rows: an update item holds only dates, a part and a rate.

I tested the compare and the restore on a copy, with `json_object(...)` written at import and `json_extract(...)` + `is` at undo. A clean row matches. A hand edit of the voice part is detected. The restore writes back integer types (`typeof(joined_at) = 'integer'`).

---

## 3. What each type writes (exact shapes)

Everything is written by the importer's user id (`:me`) inside **one** write transaction per file (§5). Every created or updated row gets one item, except attendance rows.

### 3.1 `members` (`uyeler`)

**Existing user, changed fields only:**
- `users.joined_at` = `istanbulToUtc(katilim_tarihi)` (start of that Istanbul day, the member form's `joinedOn`).
- `users.left_at` = `istanbulToUtc(ayrilis_tarihi + 1 day) − 1 s`, i.e. 23:59:59 Istanbul.
  - Drizzle's timestamp mode floors to seconds (`Math.floor(ms / 1000)`), so `.999` is stored as `:59`. Use whole seconds anyway.
  - A `left_at` of "today 23:59:59" is in the future for a few hours. Nothing in the code assumes `left_at ≤ now`: `isExpected` and `owesPeriod` compare it with the rehearsal or period dates. OK.
- Deactivating an active user: `is_active = 0` and `left_at` in the **same UPDATE** (the CHECK pairs them). Then, like `setMemberActive(false)`: `delete from sessions where user_id = ?` and `delete from invites where user_id = ? and used_at is null`. Neither table is restorable by undo (spec D13 accepts it).
- `voice_part`: as in the member form.
- `aidat_orani`: exactly `setDuesRate`'s logic. If the rate changes and periods are partly paid, insert the **freeze** overrides it would insert. Each one is an item (`dues_override`, `create`, no `kayit_no`), so undo removes them. Then upsert `member_dues (rate, note = existing note or null, updated_by = :me, updated_at = now)`.
- One item: `user` / `update` with `before_json` / `after_json` as in §2.3. **Rows that change nothing get no item and are counted `değişmeyecek`.**

**Former member (unknown email):**
```sql
insert into users (id, name, email, role, voice_part, password_hash, is_active, joined_at, left_at)
values (:uuid, :name, lower(:email), 'member', :part, null, 0, :joinStartOfDay, :leaveEndOfDay);
```
- `phone` NULL; `created_at` defaults to now; no invite row, no session. Login refuses it (no password, inactive), and `createMemberLink` refuses inactive users. So it can never log in unless a manager deliberately reactivates it on `/uyeler/<id>`.
- An optional `aidat_orani` creates its `member_dues` row (no freezes possible: no payments yet).
- One item: `user` / `create` with the §2.3 snapshot.
- `@eski.invalid` addresses satisfy `users.email` unique and lower-case like any other. Two files that use the same made-up address resolve to the same person, which is the point.

### 3.2 `terms` (`donemler`)

`insert into terms (id, name, starts_on, ends_on)`, exactly `createTerm`'s row. One item per term (`term` / `create`, no snapshot). Existing CHECKs (`terms_dates_order`, format, name length) and the unique name back the D8 rules. Overlap and the 366 days are app rules, as today.

### 3.3 `attendance` (`yoklama`): closed past rehearsals

Per rehearsal:
```sql
insert into rehearsals (id, type, title, location, note, starts_at, ends_at, series_id,
                        cancelled_at, cancelled_by, opened_at, closed_at, created_by)
values (:id, :type, :title, :location, null, :startsAt, :endsAt, null, null, null, :startsAt, :endsAt, :me);
insert into rehearsal_parts (rehearsal_id, voice_part) values … ;   -- sectional only
```
- `rehearsals_closed_after_open` (`closed_at >= opened_at`), `rehearsals_time_order` and `rehearsals_cancelled_not_open` all hold. Verified by insert.
- **No `rehearsal_secrets` row.** The rehearsal is closed and never live. @backend: check that `/calismalar/<id>` doesn't assume a secret exists for an opened rehearsal (AC 27, "nothing shows a live code").

Attendance:
- each file row: `(rehearsal_id, user_id, status, method = 'manual', note, recorded_at = starts_at, recorded_by = :me, corrected_at = null)`. `note` only for `excused` (the app rule). `attendance_note_length` is ≤ 200.
- every other `isExpected` person: `(…, status = 'absent', method = 'auto', note = null, recorded_at = ends_at, recorded_by = null)`. This is exactly `closeRehearsal`'s row (`recordedAt: closedAt`, no `recordedBy`).
- `attendance_auto_is_absent` and `attendance_checkin_attended` hold for both shapes. `method = 'self'` is never written (an imported excuse is a manager's mark, spec §6).

**Don't call `closeRehearsal()`** for imported rehearsals. It reads the roster through the global `db` outside the transaction and runs its own transaction per rehearsal: 140 transactions and 280+ round trips. Compute the absentees in memory from the users already loaded (`isExpected`) and insert them in the same chunked statements.

One item per rehearsal: `rehearsal` / `create`, with the snapshot including `rows` = the total attendance rows written for it.

### 3.4 `entries` (`hareketler`)

- `insert into finance_entries` with exactly the columns `createEntry` sets: `kind, category, amount_kurus, occurred_on, account, to_account, description, counterparty, document_url, sponsor_id, event_id, created_by = :me, created_at = now`. `revision` 0; all update and void columns NULL; `member_id`, `dues_period_id` and `payment_group_id` NULL.
- Every `fe_*` CHECK backs a rule of D10: `fe_category_present`, `fe_transfer`, `fe_sponsor`, `fe_dues` (refuses `dues` without member/period), `fe_event`, `fe_amount` (integer kuruş 1 … 1 000 000 000, the `₺10.000.000,00` max), and `fe_occurred_format`.
- **New sponsor:** `insert into sponsors (id, name, name_key = searchKey(name))`. The unique `sponsors_name_key_idx` also merges two rows of the file naming the same new sponsor into one. One item `sponsor` / `create` with the snapshot.
- One item per entry: `finance_entry` / `create`, `kayit_scope = 'entries'`, `kayit_no`.

### 3.5 `dues_periods` (`aidat-donemleri`)

`insert into dues_periods (id, name, starts_on, ends_on, due_on, amount_kurus, reduced_amount_kurus, created_by = :me, created_at = now)`, exactly `createDuesPeriod`'s row. `dues_periods_dates`, `dues_periods_amount` and `dues_periods_reduced` back the D11 rules (reduced < full, `due_on ≥ starts_on`). Overlap and the unique name are as today. One item each: `dues_period` / `create` with the snapshot.

### 3.6 `dues_payments` (`aidat-odemeleri`)

- **`odeme`:** one `finance_entries` row exactly like one period of `recordDuesPayment`: `kind 'income', category 'dues', member_id, dues_period_id, amount_kurus, occurred_on, account, description, payment_group_id = null, created_by = :me`. Item `finance_entry` / `create`, scope `dues_payments`.
- **`muaf`:** the row `setWaiver` writes:
  ```sql
  insert into dues_overrides (dues_period_id, user_id, kind, owed_kurus, reason, created_by, created_at)
  values (:period, :user, 'waiver', 0, :reason, :me, now)
  ```
  - **A plain insert, not `setWaiver`'s upsert.** If a row already exists for (period, user):
    - a waiver made by hand: the file row is `değişmeyecek` and **no item is written** (we never take ownership of hand data). @po: or an error, if you prefer; I chose "unchanged" because the outcome the file asks for is already true.
    - a freeze: it only exists when there are payments, so the row is already refused with `Bu döneme ödeme var; muafiyet verilemez.`
  - `dues_overrides_owed` (waiver ⇒ 0) and `dues_overrides_reason_length` (3–200 after trim) back D11.
  - Item `dues_override` / `create`, scope `dues_payments`, with the snapshot.

### 3.7 Money and time, as everywhere

- **Money:** integer kuruş only. The strict D5 parser yields an integer; the `typeof(...) = 'integer'` CHECKs refuse a float that slips through.
- **Instants:** unix seconds UTC (`joined_at`, `left_at`, `starts_at`, `recorded_at`, `created_at`, `undone_at`).
- **Calendar labels:** plain Istanbul days as `YYYY-MM-DD` text (`occurred_on`, `starts_on`, …).

---

## 4. Natural keys and `kayit_no`

| Type | Key | Where the "already there" lookup goes |
|---|---|---|
| `members` | `lower(eposta)` | `users.email` unique |
| `terms` | `ad` | `terms.name` unique |
| `attendance` | rehearsal = `starts_at` (from `tarih` + `baslangic`, Istanbul → UTC); row = rehearsal + email | `rehearsals_starts_idx`, then `import_items_rehearsal_idx` decides portal-made vs imported (D9) |
| `entries` | `kayit_no` in scope `entries` | `import_items_kayit_idx` |
| `dues_periods` | `ad` | `dues_periods.name` unique |
| `dues_payments` | `kayit_no` in scope `dues_payments` | `import_items_kayit_idx` |

- **Uniqueness per type** is the partial unique index on `(kayit_scope, kayit_no)`. `2024-001` may exist once in `entries` and once in `dues_payments` (verified).
- **"Among non-undone items"** holds by construction: the undo deletes the batch's items, so an undone number is free at once (D10). `db:check` gets an invariant for it (§10).
- **Case:** `kayit_no` is compared exactly (`2024-a` ≠ `2024-A`). It's a record number copied from a ledger, and folding it would make two genuine receipt numbers collide. @backend: trim only.
- **Re-import of a `kayit_no` whose entry was voided or corrected by hand** (the item still exists): that's a conflict, not "unchanged". The portal row no longer is what the file says. Use the D10 conflict message.

---

## 5. Commit: one transaction, chunked writes

### 5.1 Shape (`writeTx`, i.e. `BEGIN IMMEDIATE` through `client.transaction("write")`)

1. **Replay guard:** `select id, added_count, updated_count, unchanged_count from import_batches where client_key = ?`. If found, return that result.
2. **Bulk reads, a fixed number of queries.** Never one per file row: that would be an N+1 over the network. Per type:
   - members: all `users` + `member_dues`; the payment position for the members whose rate changes
   - attendance: all `users` (roster fields); `rehearsals` with `starts_at` in the file's [min, max] left-joined to `import_items` (rehearsal); `rehearsal_parts` and `attendance` for the imported ones among them (for "unchanged")
   - entries: `import_items` of scope `entries`; the opening date; `sponsors` (id, name_key); `events` (id, name); the account balances (one `group by`)
   - dues periods: all `dues_periods`
   - dues payments: `users`, `member_dues`, `dues_periods`, `dues_overrides`, the live dues entries per (member, period) as one `group by` (the open amounts), the `dues_payments` items, the opening date
3. **Validate in JS** against those maps. Any error → throw a typed error carrying the list, which rolls back.
4. **Write:**
   - `insert into import_batches … returning id` (the items need it)
   - then the target rows and the items as **multi-row INSERTs in chunks of ≤ 999 bound parameters** (attendance: 7 columns → 142 rows per statement; finance entries: 10–16 columns → 60–99 rows; items: 5–7 columns → 140–199 rows)
   - user updates are one UPDATE per changed user (≤ ~100, fine), or `update … from (values …)`
5. **Commit.**

**Chunking is not optional.** Drizzle's `tx.insert(t).values(array)` emits **one** statement for the whole array. 5000 attendance rows × 7 = 35 000 parameters, which is over SQLite's 32 766 limit, so it would fail. The 999 cap also stays portable and keeps each request body small (~100 KB). @backend: a small `insertChunked(tx, table, rows)` helper.

**The check step (`Kontrol et`)** runs steps 2–3 only, inside a **read** transaction (`client.transaction("read")`). It gets one consistent snapshot and writes nothing (AC 15).

### 5.2 Concurrency

- `writeTx` serialises writers (IMMEDIATE). A commit re-validates against the state it holds the lock on (D12 step 3).
- Two concurrent commits of the same `kayit_no` or the same rehearsal: the second sees the first's rows. `import_items_kayit_idx` and `import_items_rehearsal_idx` are the backstops.
- `writeTx` retries the whole function on `SQLITE_BUSY`, so step 2 must be inside the function (it is, above).
- The AC 19 fault hook throws between chunks. The rollback removes everything, including the batch row and created sponsors and users.

### 5.3 Measured (local libSQL file, Phase 8 scratch copy + migration 0009, 36 active members, foreign keys on)

| Workload | Strategy | Statements | Time |
|---|---|---|---|
| 4 968 attendance rows + 138 rehearsals + 138 items + batch + 4 reads | one statement per row, interactive tx | 5 249 | 103–106 ms |
| same | multi-row, ≤ 999 params, interactive tx | 43 | 22 ms |
| same | multi-row, one `client.batch` | 39 | 20 ms |
| 5 000 finance entries + 5 000 items + batch + 3 reads | one statement per row, interactive tx | 10 004 | 353–370 ms |
| same | multi-row, ≤ 999 params, interactive tx | 86 | 47 ms |
| same | multi-row, one `client.batch` | 83 | 47 ms |
| undo of the attendance batch (checks + cascade delete of 4 968 rows) | interactive tx | 5 | 7–8 ms |
| undo of the entries batch, hard delete of 5 000 entries + items | interactive tx | 5 | 17–23 ms |

The SQLite work is negligible. All CHECKs, FKs and indexes are included.

### 5.4 Turso from Vercel `arn1`: the estimate

- I can't measure Turso from here: there is no Turso DB or credentials in this repo yet, and I won't create a service. So this is an estimate with stated assumptions.
- On a remote libSQL URL, every statement in an interactive transaction is **one network round trip**: hrana over WebSocket/HTTP from the function to the primary.
- Vercel `arn1` and a Turso primary in Stockholm are in the same metro. A round trip plus the server's statement overhead is realistically **3–10 ms**. If the DB were ever placed in another EU region (Frankfurt/Ireland), it would be ~25–40 ms.

| Commit of 5 000 rows | Round trips | In-region (3–10 ms) | Cross-region (25–40 ms) |
|---|---|---|---|
| chunked (attendance ≈ 45, entries ≈ 90, + begin/commit) | 45–95 | **0.15–1 s** | 1.2–3.8 s |
| one statement per row | 5 250–10 000 | 16–100 s | 130–400 s |

- **Chunked fits the 60 s Hobby limit by a factor of 50 or more**, including the check step (~10 reads) and the parse.
- **Per-row statements do not fit.** They would also hold Turso's write lock for tens of seconds. The open-source libSQL server limits how long an interactive write transaction may hold the lock before another writer can take it over (5 s in the sqld source, as far as I know). Keeping the transaction under ~1 s keeps us clear of that whatever its exact value.
- **The 5000-row cap can stay** (PO risk 5). I see no reason to lower it.
- **@backend:** log the commit's duration and statement count (`console.info`, no data). On the first real import, run a small file and read the Vercel log to confirm the per-statement cost. If you want a number before go-live: a read-only probe script (`select 1` × 20 against `DATABASE_URL`, median) is harmless. It's optional and not in the ACs.

---

## 6. Undo

### 6.1 Claim, then check, then apply: one `writeTx`

```sql
-- 1. Claim. Refuses an older batch and a concurrent second undo in one statement.
update import_batches
   set status = 'undone', undone_at = unixepoch(), undone_by = :me
 where id = :id and status = 'imported'
   and (created_by = :me or :meIsConductor)
   and not exists (select 1 from import_batches b where b.id > :id and b.status = 'imported')
returning kind;
```
- 0 rows → re-read to pick the message:
  - a later live batch exists → `Önce daha sonraki içe aktarmayı geri al.`
  - another manager's batch → `Bu içe aktarmayı yalnızca yapan kişi ya da koro şefi geri alabilir.`
  - already undone → stale
2. Run the conflict checks for the kind (§6.2), each **one bulk query** for the whole batch. The first conflict → throw with its D13 message → the claim rolls back too.
3. Apply the effects (§6.3) in chunked statements.
4. `delete from import_items where batch_id = :id`. With the restrict targets (users, entries, sponsors), read the ids first, delete the items, then delete the rows.

### 6.2 "Edited since": the exact rule per type

| Batch kind | Refuse when (any of) | Query shape |
|---|---|---|
| `members`, update items | live `users`/`member_dues` ≠ `after_json` (§2.3 keys); **or** a finance entry with `member_id` = the user and `created_at ≥ batch.created_at`; **or** a `dues_overrides` row for the user with `created_at ≥ batch.created_at` that isn't one of this batch's freeze items; **or** an attendance row for the user with `recorded_at ≥ batch.created_at` on a rehearsal that **started before** the batch (a mark or correction on the past, built on the new dates) | one join over `import_items_batch_idx` → `users` PK → `member_dues` PK, plus `exists` probes on `fe_member_idx`, `dues_overrides_user_idx`, `attendance_user_idx` |
| `members`, create items (former) | live row ≠ `after_json` (catches reactivation, a password set, a rename); **or** any row references the user: `attendance`, `finance_entries.member_id`, `submissions`, `dues_overrides` not owned by this batch, `member_dues` not created by this batch, `board_tickets.assignee_id`, `sessions`, `invites` | `exists` per table, each indexed (§7) |
| `members`, freeze items | the override is gone (`override_period_id` null) or ≠ snapshot | item join |
| `attendance` | rehearsal gone (`rehearsal_id` null); **or** rehearsal ≠ snapshot (type, title, location, note, times, open/close/cancel, parts); **or** attendance count ≠ `rows`; **or** any attendance row with `corrected_at is not null`; **or** an `events` row points at the rehearsal | one query: items → `rehearsals` PK, correlated `count(*)` on the attendance PK prefix, `events_rehearsal_idx` |
| `terms` | nothing (no edit or delete path exists; nothing references terms by FK) | — |
| `entries` | any item entry with `voided_at is not null or revision <> 0 or updated_at is not null` (a correction voids the original, so a replacement is covered) | items → `finance_entries` PK, `limit 1` |
| `dues_periods` | period gone or ≠ snapshot; **or** any `finance_entries.dues_period_id` = it (voided or not, D13); **or** any `dues_overrides` on it (a delete would cascade them away) | `fe_period_idx`, the `dues_overrides` PK prefix |
| `dues_payments` | entries as for `entries`; waiver items gone or ≠ snapshot (`removeWaiver`, a re-`Muaf tut` refreshes `created_at`/`created_by`) | as above |

Why each non-obvious clause is there:
- **The attendance count.** `undoBulkPresent` can delete `manual`/`present` rows recorded by the same manager, even after close. That is the importer's own imported rows. The count catches it, because nothing else marks such a delete.
- **Members, created since.** Undoing a `joined_at` move under payments or past marks that were made because of it would leave money or history that the restored dates say is impossible. Live check-ins on rehearsals after the import do **not** block (they started after the batch). So a member batch stays undoable through normal weekly use, but not after someone built history on it.
- **Accepted gap:** a rehearsal created and closed in the portal after a member import has auto-absent rows computed with the new dates. Undo leaves them. They're real marks of a real rehearsal, so I don't block on them.

The messages are D13's. The names come from the joined rows (`users.name`, the snapshot's `startsAt` formatted, `kayit_no`, `dues_periods.name` or the snapshot's name when gone).

### 6.3 Effects

- **`members`:**
  1. Restore each update item from `before_json` in one UPDATE per user (or `update users set … from import_items`; tested). `is_active` and `left_at` go together, so the CHECK holds.
  2. `member_dues`: `rate` null → `delete`; else upsert the old rate and note, with `updated_by = :me` and `updated_at = now`.
  3. Delete the freeze overrides the batch created.
  4. Delete the items. Delete the created users' `member_dues`, then the users (`sessions`/`invites` cascade; there are none).
- **`terms`:** `delete from terms where id in (…)`.
- **`attendance`:** `delete from rehearsals where id in (…)`. `attendance`, `rehearsal_parts` and `rehearsal_secrets` cascade.
- **`dues_periods`:** `delete from dues_periods where id in (…)`. The checks guarantee nothing cascades.
- **`entries` / `dues_payments`:** see §6.4. Waivers: `delete from dues_overrides where (dues_period_id, user_id) in (…) and kind = 'waiver'`. After removing dues entries, apply `voidEntry`'s freeze rule: delete `freeze` overrides of the touched (member, period) pairs that no longer have a live payment.
- **Sponsors created by the batch:** see §6.4.

### 6.4 Void or delete the imported entries? @po, please decide

**D13 says void.** That has a consequence the spec doesn't show:
- A voided entry still references its `dues_period_id` and `sponsor_id`, both with `on delete restrict`, and D13's own table refuses a dues-period undo while "any finance entry (voided or not)" references the period.
- So the normal fix cycle "periods (5) → payments (6) → notice a wrong period amount → undo 6 → undo 5" **dead-ends at undo 5, for ever**.
- Undo is a stack, so batches 1–4 below it (member history, terms, rehearsals, finance) can then never be undone either.
- A 2000-row ledger imported wrongly and undone also leaves 2000 voided rows in `Hareketler` permanently.

**I recommend: the undo hard-deletes the batch's entries.** This applies only when they are untouched, which the §6.2 check already guarantees: no `revision`, no `updated_at`, never voided, never replaced.
- Why this doesn't break the ledger rule:
  - The rule exists so that **real money that was recorded** can't disappear.
  - An entry that was never touched since a mistaken import was never confirmed as real.
  - The audit trail is the batch row: who, when, file name, size, SHA-256, counts, and who undid it when.
- It makes the stack work: periods and sponsors become deletable after their entries go.
- `kayit_no` is free either way, since the items are deleted.
- Cost: measured 17–23 ms for 5000 entries.
- Created sponsors: delete each if no entry references it any more **and** it equals its snapshot. Otherwise (the treasurer added a contact, or a hand entry uses it) leave it, active. That's master data with value, and refusing the undo over it would be out of proportion.

**If you keep voiding:**
- `update finance_entries set voided_at = unixepoch(), voided_by = :me, void_reason = 'İçe aktarma geri alındı' where id in (…) and voided_at is null`. The reason is 22 characters, so `fe_void_reason` (5–200) passes, and `fe_void_triple` is set together.
- Created sponsors are set `is_active = 0`.
- AC 39's "they still show as voided" stays.
- But then please amend D13's dues-period row to "any **live** entry". Even so, the period **can't be deleted** while voided entries reference it (FK restrict). So the dues-period undo would have to be refused permanently in that case. Either way the dead-end above stays, and the e2e for "undo a dues-period batch after its payments batch was undone" cannot pass.

AC 39 / `ui.md` §8.7 depend on this choice. Under my recommendation, the "voided entries present" exception becomes "imported entries gone, balances back".

---

## 7. Indexes and query plans

Each new index is justified by a query. Plans are verbatim from the volume copy (50 batches, 400 imported rehearsals, 9200 attendance rows, 8000 imported entries, `ANALYZE`d).

| Query (screen) | Index | Plan |
|---|---|---|
| Latest not-undone batch (`Geri al`, the undo claim) | PK | `SCAN import_batches` in rowid-desc order, stops at the first `imported` (≤ a few hundred rows ever) |
| Index cards "Son aktarım per type" (AC 3), one query: `join (select kind, max(id) … where status='imported' group by kind)` | `import_batches_kind_idx (kind, id)` | `SCAN … USING INDEX import_batches_kind_idx`, then `SEARCH b USING INTEGER PRIMARY KEY` |
| Log page, 50 per page (AC 37), joined to `users` for the importer and the undoer names | PK | `SCAN b` (rowid desc) + `SEARCH u USING INDEX sqlite_autoindex_users_1` |
| "This file was imported on…" (AC 17) | `import_batches_sha_idx` | `SEARCH … USING INDEX import_batches_sha_idx (file_sha256=?)` |
| Double-tap replay (AC 18) | `import_batches_client_key_idx` | unique search |
| `kayit_no` lookup, entries and dues payments | `import_items_kayit_idx` | `SEARCH … (kayit_scope=? AND kayit_no=?)` |
| Entry marker on `/finans/<id>` (AC 35) | `import_items_entry_idx` | `SEARCH … (finance_entry_id=?)` |
| Rehearsal marker on `/calismalar/<id>` (AC 35) | `import_items_rehearsal_idx` | `SEARCH … USING COVERING INDEX` |
| Rehearsals in the file's range + imported? (D9 conflicts) | `rehearsals_starts_idx` + `import_items_rehearsal_idx` | `SEARCH r … (starts_at>? AND starts_at<?)` + `SEARCH i USING COVERING INDEX … LEFT-JOIN` |
| Undo checks, per batch | `import_items_batch_idx (batch_id, target)` + target PKs | `SEARCH i … (batch_id=? AND target=?)`; correlated `SEARCH a USING COVERING INDEX sqlite_autoindex_attendance_1 (rehearsal_id=?)`; `events_rehearsal_idx`; `fe_period_idx`; `sqlite_autoindex_dues_overrides_1`; `attendance_user_idx`; `fe_member_idx`; `submissions_user_idx` |
| FK child lookups when a target is deleted (rehearsal, period, override, entry) | the partial `import_items_*_idx` | each delete of a parent probes one index instead of scanning `import_items` (thousands of rows over time) |
| `/calismalar` past list page 3 (AC 36): `where starts_at < :todayStart order by starts_at desc limit 61 offset 120` | existing `rehearsals_starts_idx` | `SEARCH rehearsals USING INDEX rehearsals_starts_idx (starts_at<?)` |

- **The FK-target indexes are unique** (one item per target row), except `user_id`: a user can be updated by several batches over time.
- **No new index on existing tables.** Imported history only grows `attendance` and `finance_entries`, which the existing indexes already cover. With 5000 extra attendance rows the report queries keep their plans: `inArray(attendance.rehearsalId, ids)` on the PK prefix, the rehearsal range on `rehearsals_starts_idx`.
- **AC 36 paging:** `listRehearsals` gains `offset`. Fetch 61 to know whether `Daha eski` exists. Offset paging is fine: 5 seasons are ~200 past rehearsals, 4 pages.
- **Member history and `listRehearsals`' default `limit = 200`:** @backend, check that no history or report path silently relies on that default. With imported seasons, a member's full history can exceed 200 rehearsals.

---

## 8. Constraint tests (AC 42)

These were run on the migrated copy, with `foreign_keys = on`. 67 cases, 0 surprises. **The e2e should pick a few from the reject list** (`ui.md` §8.7 already lists the right ones).

**Accepted:**
- a valid batch; an undone batch with the triple set
- items: an entry with a `kayit_no`; the same `kayit_no` in the other scope; a rehearsal, term, period, override (composite FK), user update and user create
- a delete by hand of an override or a rehearsal: sets the item's column to NULL, and the CHECK still holds
- a batch delete cascades its items
- former members (incl. same-day join/leave)
- an imported closed rehearsal, a `manual` row at start, an `auto`/`absent` row at end, a waiver

**Rejected:**
- batch:
  - undone without `undone_by`; `undone_at` with status `imported`
  - an unknown kind or status
  - a SHA-256 in upper case, with 63 characters, or non-hex
  - a negative count, a real count, counts not summing to `row_count`, all unchanged, 5001 rows
  - a file name of 121 characters, blank, with `/`, or with a newline
  - a size of 0 or over 1 048 576
  - a duplicate `client_key`
  - an unknown creator (FK)
- items:
  - a duplicate live `kayit_no` in the same scope
  - an entry item without `kayit_no`
  - a `kayit_no` with a space, of 41 characters, or without a scope
  - a `kayit_no` on a rehearsal item
  - the same entry twice
  - a rehearsal item without a snapshot
  - two targets set; the column of another target
  - a user item without a user; an unknown user (FK)
  - a user update without `before_json`
  - an `update` on a rehearsal
  - a create with `before_json`
  - invalid JSON
  - an unknown target
  - half an override pair; an override pair that doesn't exist (FK)
- deleting a user or an entry that an item references (restrict)
- users: inactive without `left_at`; `left_at < joined_at`; an upper-case email; active with `left_at`

---

## 9. Migration `0009_phase8b_import`

- **Order:** after Phase 8's `0008_phase8_board_budget` is in the repo, edit `schema.ts` (§2.1), then run `npm run db:generate -- --name phase8b_import`. That gives `drizzle/0009_phase8b_import.sql`, `meta/0009_snapshot.json` and journal idx 9.
  - **Regenerate in the repo; don't copy my scratch SQL.** If Phase 8's schema changed during implementation, the snapshot diff must come from the real 0008.
- **Content:** `CREATE TABLE import_batches`, 3 indexes; `CREATE TABLE import_items`, 9 indexes. **No hand edit, no trigger.** Grep `ALTER|DROP|__new_` → 0 (AC 41).
- **Existing data:** nothing migrates. No backfill, and existing rows are not marked as imported. The 37 live users' `joined_at` gets fixed **by the import itself** (step 1), as data, with undo.
- **Live-data safety:**
  - Pure expand. Old code (Phase 8) runs unchanged against the new schema; it never reads the new tables.
  - `migrate` applies the file atomically.
  - Deploy order as before: `npm run db:migrate` (backup → migrate → `db:check`, which then expects 10/10), then the code. Only after Phase 7 is live (constraint 1).
  - **Before the first real bulk import:** `Yedekleme › Şimdi gönder` (D14 hint) or `npm run db:backup`.
- **AC 41 script:** migrate a copy of a Phase 8 DB, run `db:check`, then grep the file. That's exactly what I did.

---

## 10. Backup dump, restore and `db:check`

**Dump (`dump.ts`): no change.**
- It takes every non-engine table, so both new tables are in `db:backup` and in the monthly encrypted email.
- They hold no secrets. The personal data in them is a subset of what `users` already holds (dates, part, rate; for former members also name and email), with the same board/conductor audience as the dump.
- Round trip verified (rows in every target kind incl. the composite override FK): 33 tables and 59 indexes/triggers dumped; `db:restore` OK with `foreign_key_check` empty; `db:check` → `migrations=10/10, quick_check=ok`.
- After the restore:
  - the next batch got id 2 (`max + 1`), so the stack continues
  - a duplicate live `kayit_no` is still rejected
- Index creation after the data proves `import_items_kayit_idx` and the other unique indexes still hold.

**`scripts/db-check.ts`: add one invariant** (run it only when `import_items` exists, like the Phase 8 trigger check):
```sql
select count(*) from import_items i join import_batches b on b.id = i.batch_id where b.status = 'undone'
```
- It must be 0, else `problems.push("undone import batches still have items")`.
- Without it, a half-written undo, a hand edit or a buggy restore would leave `kayit_no`s blocked and markers on rows that are no longer "imported".

**Restore drill (Phase 7 AC 30):** unchanged.

---

## 11. Seed and e2e

**`scripts/seed.ts` / `db:reset`:** nothing to seed. The tables start empty; the demo shows `Henüz aktarılmadı` everywhere.

**`scripts/finance-fixture.mjs` `seedFinance`:** make it self-sufficient. **Prepend `delete from import_batches`** (the items cascade) to its wipe list, before `delete from finance_entries`. Otherwise `npm run seed` on a DB that has imports fails on the restrict FKs from `import_items` (entries, sponsors). It refuses non-file DBs and production already.

**@ui (§8.2, your question): the order that works with these FKs.** I ran it on a copy holding a batch of every kind. The current order fails with `FOREIGN KEY constraint failed` on `delete from finance_entries` and on `sponsors`.
```sql
-- e2e/lib.mjs cleanup(), BEFORE seedFinance:
delete from rehearsals where id in (select rehearsal_id from import_items where rehearsal_id is not null);  -- attendance, parts cascade
delete from terms where id in (select term_id from import_items where term_id is not null);
delete from import_batches;                         -- items cascade; frees every restrict FK
-- seedFinance(db, now): wipes entries, overrides, member_dues, periods, events, sponsors (as today)
-- … the existing E2E deletes …
-- AFTER seedFinance (entries reference users with restrict), next to the @e2e.test deletes:
delete from attendance  where user_id in (select id from users where email like '%@ornek.com' or email like '%@eski.invalid');
delete from submissions where user_id in (select id from users where email like '%@ornek.com' or email like '%@eski.invalid');
delete from users where email like '%@ornek.com' or email like '%@eski.invalid';   -- sessions, invites cascade
```
- **Rule for the tests: every former member created by an e2e import uses `@eski.invalid` or `@ornek.com`.** Arranged users use `@ornek.com` too. Then the email patterns catch everything.
- **Same caveat as Phase 8:** every e2e run wipes all import batches on the local dev DB. If the user tries real history imports on `data/arkhe.db`, they won't survive `npm run e2e`.
  - Their imported rehearsals and terms are deleted.
  - Their former members with `@eski.invalid` addresses are deleted too.
  - Their ledger already is, today (`seedFinance`).
  - Production is unaffected.
  - @tech lead: one README line.
- **Your `wipeImports()`** (start and end of each `phase8b-*` file) = the first three statements plus the user deletes. Don't call `seedFinance` there unless the file needs the ledger reset.

**AC 42 e2e:** a few rejects from §8, asserting `SQLITE_CONSTRAINT`.

**AC 44 bulk arrange:** insert with multi-row statements as in §5.1. The cleanup above removes it.

**`e2e/prod.mjs`:** nothing new for the DB. It migrates (so it gets 0009) and seeds.

---

## 12. Replies

**@po:**
- **§7 q1:** confirmed with one change (§1): before/after snapshots for every hand-editable type, not only members. No new column on `rehearsals` or `finance_entries`.
- **§7 q1, CHECKs:** the former-member insert passes all five `users` CHECKs (§1.2). The importer must still check `ayrilis ≥ katilim` and the lower-case email first, to give a message instead of a constraint error.
- **D13 void vs. delete:** please decide §6.4. My recommendation is to hard-delete untouched imported entries on undo. Otherwise the dues-period undo dead-ends and freezes the whole stack below it. AC 39's "still show as voided" and "created sponsors: inactive" change with it.
- **D13 "edited since" for member history:** I defined it in §6.2. It means the fields the import touched, plus the role, plus anything built on the new dates since: payments, overrides, past marks. Name, phone and email edits don't block. It also includes one accepted gap (auto-absent rows of a portal rehearsal closed after the import).
- **D13 rehearsals:** besides `corrected_at` and edits, undo is also refused when an **event** points at the rehearsal (deleting it would silently unlink the event) and when an attendance row disappeared (`undoBulkPresent`).
- **D13 dues periods:** also refused when the period was **edited** by hand after the import (`updateDuesPeriod` allows that while no live payment exists).
- **D11 waiver on a hand-waived period:** I count it `değişmeyecek` and write no item (§3.6). Say if you want an error instead.
- **D14 "the link to each written row":** every row except attendance rows, which are linked through their rehearsal (one item per rehearsal). The marker and the undo don't need more. It keeps a 5000-row file at ~140 items.
- **D10 `kayit_no`:** compared case-sensitively, trimmed (§4). A re-import of a number whose entry was voided or corrected by hand is a conflict, not "unchanged".
- **AC 42 wording:** "each item row pointing to exactly one target" → "at most one target column set, and the right one". A set-null target goes NULL when the row is deleted by hand, and undo then refuses. "kayit_no unique per type among non-undone items" holds because undo deletes the items (§4, plus the `db:check` invariant).
- **Risk 5 (time limit):** measured and estimated in §5. Chunked writes fit with a margin of 50× or more. **Keep the 5000-row cap.**

**@ui:**
- §8.2 order: given in §11 and verified.
- §8.7 snapshot exceptions: `import_items` rows of an undone batch are **gone** (0 rows); only the batch row is kept, with the undo fields set.
- Voided entries vs. gone entries depends on the PO's §6.4 decision.
- §8.7 AC 18 "no column large enough to hold content": the widest text column is `file_name` (120). `before_json`/`after_json` are ≤ 4000 and hold only row snapshots (§2.3), never file text. Exclude them by name in the `table_info` check.

**@backend:**
- Write recipes: §3 (exact rows per type), §5.1 (transaction shape), §6 (undo claim, checks, effects).
- Rules that matter most:
  - bulk reads only (no per-row query)
  - **multi-row INSERTs chunked at ≤ 999 parameters** (Drizzle's `.values(array)` is one statement and breaks above 32 766 parameters)
  - the check step in a `read` transaction, the commit and the undo in `writeTx`
  - don't call `closeRehearsal` for imports
- `serverActions.bodySizeLimit` (`ui.md` §2.4): needed, since a 1 MB file plus form overhead exceeds the 1 MB default.
- `listRehearsals` gets `offset` (AC 36). Check that history paths don't rely on its default `limit = 200`.
- Map the unique violations to messages:
  - `import_items_kayit_idx` → the D10 conflict message
  - `import_batches_client_key_idx` → "return the existing batch"
  - `users.email` → a race with an invite
- Add the `db:check` invariant (§10) and the `seedFinance` wipe line (§11).
