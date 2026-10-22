# Phase 8: database plan (DBA)

Author: arkhe-dba. Date: 2026-10-21.

Inputs:
- `po-spec.md`. It is the only other phase-8 file so far, so there are no ux/ui/backend notes to reply to yet.
- `src/db/schema.ts`, `src/db/write-tx.ts`, `src/lib/finance/{categories,queries,queries-internal,dates}.ts`, `src/lib/money.ts`
- `src/lib/backup/dump.ts`, `scripts/{db-check,db-restore,seed,finance-fixture}.*`, `e2e/lib.mjs` `cleanup()`
- `drizzle/0007_*` and the journal

How I verified it:
- I took a scratch copy of the dev DB with `sqlite3 -readonly data/arkhe.db ".backup …"`. I never wrote to `data/arkhe.db`, `src/` or `drizzle/`.
- I put the Drizzle code in §1 and §2 into a **copy** of `schema.ts`, ran the real `drizzle-kit generate --name phase8_board_budget` against a copy of `drizzle/`, appended the two triggers from §3, and ran `drizzle-kit migrate` on the copy.
- On the migrated copy I ran:
  - 67 accept/reject inserts (§5)
  - a 24-way concurrent ticket create (§1.3)
  - `EXPLAIN QUERY PLAN` on every screen query with AC 44 volumes: 300 tickets (200 archived), 3300 thread rows, 8000 ledger rows, 5000 of them in one budget range (§4)
  - a full `dumpDatabase` → `db:restore` → `db:check` round trip (§6)

## 0. Summary

- **Board: 4 tables.**
  - `board_tickets`
  - `board_ticket_events`: one thread table, system entries and comments together
  - `board_ticket_reads`: per-user "seen", for `Yeni`
  - `board_ticket_seq`: a one-row high-water mark, so a `#numara` is never reused, even after the highest ticket is deleted or after a restore
- **Budget: 4 tables.**
  - `budgets`: 12 months `[start_month, end_month)`, draft/approved via the `approved_at/by` pair
  - `budget_lines`: one row per planned category, PK `(budget, category)`
  - `budget_revisions` and `budget_revision_lines`: the history
- **No overlap is enforced in the DB** by two `BEFORE INSERT/UPDATE` triggers, plus a unique `start_month`. A CHECK can't do it, because SQLite forbids subqueries in CHECK.
- **Migration `0008_phase8_board_budget`** only creates tables, indexes and the two triggers. It does not alter, drop or rebuild anything (grep: 0 × `ALTER`/`DROP`/`__new_`). The migration was applied to a Phase 7 copy: 9/9, `foreign_key_check` empty, `integrity_check ok`.
- **No new index on `finance_entries`.** The plan-vs-actual sum is a range search on the existing `fe_occurred_idx`. A covering partial index was not chosen by the planner and isn't needed at our size (§4.3).
- **Money:** integer kuruş with a `typeof(...) = 'integer'` guard (the existing `kurus()` helper), 1 … 1 000 000 000, the same as `MAX_KURUS`. **Time:** unix seconds UTC. `due_on` and `start_month` are plain Istanbul calendar labels (text).
- **Deletes:**
  - tickets: hard delete, cascades their thread and reads
  - comments: hard delete within 15 min, author only
  - draft budgets: hard delete, cascades their lines
  - approved budgets and revisions: never deleted by the app
  - every FK to `users` is `restrict`, except `board_ticket_reads.user_id` (cascade, §1.4)

---

## 1. Board

### 1.1 Drizzle (`src/db/schema.ts`, after `financeEntries`)

```ts
export const TICKET_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TICKET_URGENCIES = ["low", "medium", "high", "urgent"] as const;
export const TICKET_EVENT_KINDS = ["created", "status", "assignee", "urgency", "due", "comment"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketUrgency = (typeof TICKET_URGENCIES)[number];
export type TicketEventKind = (typeof TICKET_EVENT_KINDS)[number];

// One row; the high-water mark keeps #numbers unique for ever, even after a delete or a restore.
export const boardTicketSeq = sqliteTable(
  "board_ticket_seq",
  {
    id: integer("id").primaryKey(),
    lastNumber: integer("last_number").notNull(),
  },
  () => [
    check("board_ticket_seq_single", sql`id = 1`),
    check("board_ticket_seq_last", sql`typeof(last_number) = 'integer' and last_number >= 0`),
  ],
);

export const boardTickets = sqliteTable(
  "board_tickets",
  {
    id: id(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TICKET_STATUSES }).notNull().default("todo"),
    urgency: text("urgency", { enum: TICKET_URGENCIES }).notNull().default("medium"),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "restrict" }),
    // Plain Europe/Istanbul calendar day.
    dueOn: text("due_on"),
    doneAt: integer("done_at", { mode: "timestamp" }),
    // Optimistic lock for edits; bumped by every write to this row.
    revision: integer("revision").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("board_tickets_number_idx").on(t.number),
    index("board_tickets_status_idx").on(t.status, t.doneAt),
    index("board_tickets_assignee_idx").on(t.assigneeId, t.status),
    check("board_tickets_number_check", sql`typeof(number) = 'integer' and number >= 1`),
    check("board_tickets_status_check", sql`status in (${inList(TICKET_STATUSES)})`),
    check("board_tickets_urgency_check", sql`urgency in (${inList(TICKET_URGENCIES)})`),
    check(
      "board_tickets_title_length",
      sql`length(trim(title)) between 3 and 120 and length(title) <= 120`,
    ),
    check("board_tickets_description_length", optText("description", 4000)),
    check(
      "board_tickets_due_format",
      sql`due_on is null or (${day("due_on")} and date(due_on) is due_on)`,
    ),
    check("board_tickets_done_at", sql`(status = 'done') = (done_at is not null)`),
    check("board_tickets_revision_check", sql`typeof(revision) = 'integer' and revision >= 0`),
  ],
);

// The ticket's thread: system entries (who changed what) and comments, oldest first by id.
export const boardTicketEvents = sqliteTable(
  "board_ticket_events",
  {
    // AUTOINCREMENT: ids never repeat, so "seen up to id N" is exact.
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => boardTickets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TICKET_EVENT_KINDS }).notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Comment text; null for system entries.
    body: text("body"),
    // status/urgency codes or due days; null means "none" (— or Atanmadı).
    fromValue: text("from_value"),
    toValue: text("to_value"),
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "restrict" }),
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("board_ticket_events_ticket_idx").on(t.ticketId),
    index("board_ticket_events_comments_idx").on(t.ticketId).where(sql`kind = 'comment'`),
    check("board_ticket_events_kind_check", sql`kind in (${inList(TICKET_EVENT_KINDS)})`),
    check(
      "board_ticket_events_body",
      sql`(kind = 'comment') = (body is not null) and (body is null or (length(trim(body)) >= 1 and length(body) <= 2000))`,
    ),
    check(
      "board_ticket_events_users",
      sql`kind = 'assignee' or (from_user_id is null and to_user_id is null)`,
    ),
    check(
      "board_ticket_events_values",
      sql`coalesce(case kind
        when 'status' then from_value in (${inList(TICKET_STATUSES)}) and to_value in (${inList(TICKET_STATUSES)}) and from_value <> to_value
        when 'urgency' then from_value in (${inList(TICKET_URGENCIES)}) and to_value in (${inList(TICKET_URGENCIES)}) and from_value <> to_value
        when 'due' then (from_value is null or date(from_value) is from_value) and (to_value is null or date(to_value) is to_value) and from_value is not to_value
        when 'assignee' then from_value is null and to_value is null and from_user_id is not to_user_id
        else from_value is null and to_value is null end, 0)`,
    ),
  ],
);

// Per manager: the last thread entry and ticket revision they saw on the detail page.
export const boardTicketReads = sqliteTable(
  "board_ticket_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => boardTickets.id, { onDelete: "cascade" }),
    seenEventId: integer("seen_event_id").notNull(),
    seenRevision: integer("seen_revision").notNull(),
    seenAt: integer("seen_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ticketId] }),
    // The cascade from board_tickets looks rows up by ticket alone.
    index("board_ticket_reads_ticket_idx").on(t.ticketId),
    check(
      "board_ticket_reads_seen",
      sql`typeof(seen_event_id) = 'integer' and seen_event_id >= 0 and typeof(seen_revision) = 'integer' and seen_revision >= 0`,
    ),
  ],
);
```

**Why `is` and `coalesce` in the CHECKs.** A CHECK only fails on `false`. `NULL` passes. `date('2026-02-30')` and `strftime(... '2026-13-01')` both return NULL. `x in (...)` with a NULL `x` is NULL too. So with `=`, `2026-02-30` and a status entry with a NULL `from_value` were silently accepted. My first draft had exactly that hole. `is` and `coalesce(…, 0)` close it. Both cases are in the reject tests (§5).

### 1.2 Column semantics

- **`id`** is a UUID, like every other table, and it is the FK target.
- **`number`** is the user-facing `#12`. It is only used for routing (`/yonetim/12`) and display. A lookup by number is an indexed unique search.
- **`title`/`description`:** the app trims them, and stores an empty description as `NULL`.
  - Title: 3–120. Description: 1–4000. Both as the spec says.
  - SQLite `length()` counts characters, not bytes, so Turkish letters count once.
- **`status`** is an English code. **`done_at`** is set exactly when `status = 'done'` (CHECK). Moving out of `Bitti` must clear it in the same statement.
- **`due_on`:** `YYYY-MM-DD`, and it must be a real date (CHECK).
- **`assignee_id`:** null means `Atanmadı`.
  - "Active conductor or board" can't be a DB rule: it depends on another table, and it changes over time (AC 11 keeps a demoted assignee). It is enforced in the action: `select 1 from users where id = ? and is_active = 1 and role in ('conductor','board')`, inside the write transaction.
  - The FK only guarantees that the user exists.
- **`updated_at` / `updated_by`:**
  - `updated_at` is NOT NULL and starts equal to `created_at`.
  - Both are set by **every edit and every move**. `Son değişiklik` is shown when `updated_by is not null` (AC 12).
  - **Comments do not touch the ticket row.** So a comment never reorders a column (AC 7 "most recently updated") and never makes an open editor stale (D11 "comments never conflict").
- **`revision`** is the optimistic lock, because `updated_at` has only second resolution. It is the same pattern as `finance_entries.revision`, bumped by every write to the row.
- **Archive (D9)** is not stored. It is `status = 'done' and done_at < :now - 30 × 86400`. Moving an archived ticket out of `Bitti` clears `done_at`, which puts it back on the board (AC 23). Nothing is ever deleted automatically.

### 1.3 Ticket numbers: `board_ticket_seq`

Why not `max(number) + 1`: AC 14 requires that a deleted number is never reused. Deleting the current maximum would hand the same number out again.

Why not `INTEGER PRIMARY KEY AUTOINCREMENT` on `number`: the dump skips `sqlite_%` tables (`dump.ts`), so `sqlite_sequence` is not restored. After a restore, the next number would be max + 1 again, and a deleted max would come back.

The counter row is ordinary data, so it is dumped and restored like everything else.

**Create is one `db.batch([...], "write")`, one transaction and one round trip:**

```sql
-- 1. Allocate. Self-heals if the row is missing (e.g. a hand-made DB): starts at max(number) + 1.
insert into board_ticket_seq (id, last_number)
  values (1, (select coalesce(max(number), 0) from board_tickets) + 1)
  on conflict(id) do update set last_number = last_number + 1
  returning last_number;
-- 2. The ticket, with a client-generated uuid :id.
insert into board_tickets (id, number, title, description, status, urgency, assignee_id, due_on, done_at, created_by)
  values (:id, (select last_number from board_ticket_seq where id = 1), …);
-- 3. The creation system entry (D5).
insert into board_ticket_events (ticket_id, kind, actor_id) values (:id, 'created', :me);
```

- Verified:
  - 24 concurrent creates from 8 libsql clients gave 24 distinct numbers (1–24) and `last_number = 24`
  - after deleting #24, the next one was 25
  - after deleting the seq row, the next was max + 1
- A ticket created directly as `Bitti` sets `done_at` in step 2.
- **Validate the assignee before the batch.** A batch can't branch. Re-checking it inside is unnecessary: a role change in the same millisecond is harmless.
- The migration does **not** seed the row. The upsert creates it on first use.

### 1.4 `board_ticket_reads` and "Yeni" (D7)

**What is stored:**
- `seen_event_id`: the highest thread `id` the user saw
- `seen_revision`: the ticket `revision` the user saw

Both come from the data the detail page rendered. Stored this way, `Yeni` is exact: there is no same-second race, which a `seen_at` timestamp compare would have. It also doesn't flake in the AC 22 e2e, where "sef@ comments → 1 again" can happen in the same second as yk@'s open.

**Why AUTOINCREMENT on the events id:** a plain rowid can be reused after the newest row is deleted (a 15-min comment delete). Then a fresh comment could get an id ≤ `seen_event_id` and be missed. With AUTOINCREMENT that can't happen during normal running. After a restore it could happen for one id, which is negligible.

**Mark as seen when the detail page renders:**
```sql
insert into board_ticket_reads (user_id, ticket_id, seen_event_id, seen_revision, seen_at)
  values (:me, :ticket, :maxEventIdRendered, :revisionRendered, unixepoch())
  on conflict (user_id, ticket_id) do update set
    seen_event_id = max(seen_event_id, excluded.seen_event_id),
    seen_revision = max(seen_revision, excluded.seen_revision),
    seen_at = excluded.seen_at;
```
The `max()` stops an older tab from moving it backwards.

**"New for me"**, for ticket `t` and user `:me`:
```sql
t.assignee_id = :me and t.status <> 'done' and (
  exists (select 1 from board_ticket_events e
          where e.ticket_id = t.id and e.id > coalesce(r.seen_event_id, 0) and e.actor_id <> :me)
  or (t.revision > coalesce(r.seen_revision, -1) and t.updated_by is not :me)
)  -- with: left join board_ticket_reads r on r.user_id = :me and r.ticket_id = t.id
```

What this covers:
- **Never opened:** someone else created it → their `created` event qualifies. If I created and self-assigned it, nothing qualifies, so it's not new.
- **Assigned to me by someone else:** their `assignee` event qualifies.
- **My own comments and moves** never qualify (`actor_id <> :me`). AC 22 holds.
- **Title/description edits** have no event (D5), so they are caught by the revision clause. Known gap: someone else edits the title, then I move the card before opening it. Then `updated_by` = me and the edit no longer flags. I'm acting on the card anyway. Accepted.

**`user_id` cascades on user delete** (the one non-restrict FK to `users`): read marks are disposable per-user UI state. In practice users are never hard-deleted by the app; only e2e `cleanup()` deletes `@e2e.test` users, and that must not trip over read rows.

**@backend: prefetch.** The page must not mark "seen" on a prefetch. In Next 16, `prefetch` defaults to `auto`. For a dynamic route, `auto` renders only down to the nearest `loading.js` and doesn't run the page, and prefetch is production-only. Two rules follow:
- Never use `prefetch={true}` on links to `/yonetim/<n>`.
- If you add a `loading.js` under `/yonetim/[numara]`, re-check this.

The alternative is to mark seen from a client effect that calls a server action after mount. That costs one extra round trip, but it is immune to prefetch.

### 1.5 Writes and concurrency (D11, AC 13–20)

All of these go through `writeTx` (`src/db/write-tx.ts`). It uses an IMMEDIATE transaction and retries on `SQLITE_BUSY`. In every case the **conditional UPDATE is the real guard**. Never decide from an earlier read alone.

**Move** (card `Taşı` or the `Durum` select). The guard is the from-status, per the spec:
```sql
update board_tickets
   set status = :to, done_at = case when :to = 'done' then unixepoch() else null end,
       revision = revision + 1, updated_at = unixepoch(), updated_by = :me
 where id = :id and status = :from and :to <> :from
returning number;
```
- No row → `Bu iş az önce değişti. Sayfayı yenile.`, and nothing else is written.
- Otherwise insert one `status` event `(from_value = :from, to_value = :to)`.
- AC 18: the second session's update matches 0 rows, so the ticket stays `in_progress` with exactly one status event.

**Edit:**
1. Read the row inside the transaction.
2. `update … set title, description, assignee_id, urgency, due_on, revision = revision + 1, updated_at, updated_by where id = :id and revision = :revisionFromForm`.
3. No row → the same stale message.
4. Otherwise insert one event per changed field among assignee (`from_user_id`/`to_user_id`), urgency and due (`from_value`/`to_value`, NULL = —). Title and description write none (D5).
5. If nothing changed at all, skip the write. That way you don't bump the revision for nothing.
- **Consequence:** a move bumps `revision`, so an editor opened before someone moved the card is refused on save. That is the safe side. @po, see §8.

**Delete ticket:** `delete from board_tickets where id = :id and (created_by = :me or :meIsConductor)`. Events and reads cascade. If it matches 0 rows, re-read: either the ticket is gone (404), or the caller isn't allowed (`Bu işi yalnızca açan kişi ya da koro şefi silebilir.`). The seq is untouched, so the number is never reused.

**Comment:** one insert. It doesn't touch the ticket row, so it never conflicts. The double tap is handled in the UI (AC 19 pending state). The DB has no dedupe key, and two identical comments are legal data.

**Delete comment (D6).** Compare against the DB clock, because `created_at` is DB-defaulted:
```sql
delete from board_ticket_events
 where id = :eventId and ticket_id = :ticketId and kind = 'comment'
   and actor_id = :me and created_at > unixepoch() - 900;
```
If it matches 0 rows, read the row to pick the message:
- missing → 404 or no-op
- `kind <> 'comment'` → refuse (system entries are never deletable)
- another author → `Yalnızca kendi yorumunu silebilirsin.`
- otherwise → `Yorum 15 dakika geçtikten sonra silinemez.`

The e2e backdates `created_at` by 16 min (AC 20), which works with this guard.

### 1.6 Read queries (one query each, no N+1)

**Board (`/yonetim`):** one query for all four columns. The app splits the rows by status.
```sql
select t.id, t.number, t.title, t.status, t.urgency, t.due_on, t.done_at, t.updated_at,
       u.name as assignee_name, (u.is_active = 1 and u.role in ('conductor','board')) as assignee_on_board,
       (select count(*) from board_ticket_events c where c.ticket_id = t.id and c.kind = 'comment') as comments,
       <new-for-me expression from §1.4> as is_new
  from board_tickets t
  left join users u on u.id = t.assignee_id
  left join board_ticket_reads r on r.user_id = :me and r.ticket_id = t.id
 where (t.status <> 'done' or t.done_at >= :cutoff)        -- cutoff = now − 30 days
   [and t.assignee_id = :me]                               -- ?kim=ben
   [and t.urgency = :urgency]                              -- ?aciliyet=
 order by case t.urgency when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          t.due_on is null, t.due_on, t.updated_at desc, t.number desc;
```
- `Bitti` is re-sorted by `done_at desc, number desc` in JS, or use a second `order by` branch.
- The `number desc` tiebreak makes AC 7 deterministic.
- The tab counts come from the same rows: no second query, and they follow the filters (D10).

Other screens:
- **Detail:** `where number = :n` → `board_tickets_number_idx`. Then the thread:
  ```sql
  select e.*, a.name, fu.name as from_name, tu.name as to_name
    from board_ticket_events e
    join users a on a.id = e.actor_id
    left join users fu on fu.id = e.from_user_id
    left join users tu on tu.id = e.to_user_id
   where e.ticket_id = :id order by e.id;
  ```
- **Archive:**
  ```sql
  … where t.status = 'done' and t.done_at < :cutoff
    order by t.done_at desc, t.number desc limit 51 offset :page*50
  ```
  Fetch 51 to know whether `Daha eski` exists. Offset paging is fine at our size: 200 archived rows are 4 pages.
- **Badge and home card (AC 3, 22):** one query for the three numbers, run once per request.
  ```sql
  select count(*) as open_n,
         sum(t.urgency = 'urgent') as urgent_n,
         sum(<new-for-me exists/or clause>) as new_n
    from board_tickets t
    left join board_ticket_reads r on r.user_id = :me and r.ticket_id = t.id
   where t.assignee_id = :me and t.status in ('todo','in_progress','blocked');
  ```
  - Wrap it in React `cache()` so the sidebar and the home card share one execution per request.
  - **Only call it after the role check.** A member must never trigger it. They'd get 0 anyway, but the rule is: no board query for members.

---

## 2. Budgets

### 2.1 Drizzle

```ts
const monthOk = (column: string) =>
  sql.raw(
    `${column} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and strftime('%Y-%m', ${column} || '-01') is ${column}`,
  );

// Exactly 12 months [start_month, end_month); no two budgets overlap (triggers in 0008).
export const budgets = sqliteTable(
  "budgets",
  {
    id: id(),
    name: text("name").notNull(),
    startMonth: text("start_month").notNull(),
    // Exclusive; always start_month + 12 months, stored so range queries stay indexable.
    endMonth: text("end_month").notNull(),
    note: text("note"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "restrict" }),
    // Optimistic lock for plan saves.
    revision: integer("revision").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("budgets_name_idx").on(t.name),
    uniqueIndex("budgets_start_idx").on(t.startMonth),
    check("budgets_name_length", sql`length(trim(name)) between 1 and 40 and length(name) <= 40`),
    check("budgets_start_format", monthOk("start_month")),
    check(
      "budgets_end_month",
      sql`end_month is strftime('%Y-%m', start_month || '-01', '+12 months')`,
    ),
    check("budgets_note_length", optText("note", 500)),
    check("budgets_approved_pair", sql`(approved_at is null) = (approved_by is null)`),
    check("budgets_updated_pair", sql`(updated_at is null) = (updated_by is null)`),
    check("budgets_revision_check", sql`typeof(revision) = 'integer' and revision >= 0`),
  ],
);

// One row per planned category; a missing row means 0 ("not planned").
export const budgetLines = sqliteTable(
  "budget_lines",
  {
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    category: text("category", { enum: CATEGORIES }).notNull(),
    amountKurus: integer("amount_kurus").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.category] }),
    check("budget_lines_category_check", sql`category in (${inList(CATEGORIES)})`),
    check("budget_lines_amount", kurus("amount_kurus")),
  ],
);

// One row per "Planı revize et" save on an approved budget.
export const budgetRevisions = sqliteTable(
  "budget_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("budget_revisions_budget_idx").on(t.budgetId),
    check(
      "budget_revisions_reason_length",
      sql`length(trim(reason)) between 5 and 200 and length(reason) <= 200`,
    ),
  ],
);

export const budgetRevisionLines = sqliteTable(
  "budget_revision_lines",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => budgetRevisions.id, { onDelete: "cascade" }),
    category: text("category", { enum: CATEGORIES }).notNull(),
    fromKurus: integer("from_kurus").notNull(),
    toKurus: integer("to_kurus").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.category] }),
    check("budget_revision_lines_category_check", sql`category in (${inList(CATEGORIES)})`),
    check(
      "budget_revision_lines_amounts",
      sql`typeof(from_kurus) = 'integer' and typeof(to_kurus) = 'integer' and from_kurus between 0 and 1000000000 and to_kurus between 0 and 1000000000 and from_kurus <> to_kurus`,
    ),
  ],
);
```

### 2.2 Semantics

**Period.** `start_month` and `end_month` are `YYYY-MM` Istanbul calendar labels. The range in days is `[start_month || '-01', end_month || '-01')`, the same half-open shape as `monthRange`/`yearRange`. `end_month` is redundant, but a CHECK pins it to start + 12 months. Storing it keeps the overlap trigger, the "covers month M" lookup and the ledger join simple and indexable.

**No overlap (D12)** is enforced in three layers:
1. **The action**, for the message with the other budget's name, inside `writeTx`:
   ```sql
   select name from budgets where id <> :id and start_month < :end and :start < end_month limit 1
   ```
   → `Bu tarihler <ad> bütçesiyle çakışıyor.`
2. **The triggers in §3**, as the backstop. A direct write fails with `SQLITE_CONSTRAINT` and the message `budgets_overlap`. @backend: map it to the same text, looking the name up after the fact.
3. **`budgets_start_idx` unique.** It is implied by no-overlap, but it is a cheap second guard, and it holds even if someone drops the triggers.

Adjacent budgets (`2025-09` then `2026-09`) are allowed, and so are gaps. Both are verified.

**Draft / approved.** A budget is approved iff `approved_at is not null`. The `approved_at`/`approved_by` pair is all-or-nothing (CHECK, AC 41). There is no "unapprove". The lock rules are the app's, written as **conditional statements** so a race can't slip through:
- approve:
  ```sql
  update budgets set approved_at = unixepoch(), approved_by = :me, revision = revision + 1
   where id = :id and approved_at is null and revision = :rev
  ```
  The `revision` makes you approve the plan you saw.
- rename or change the start: `update … where id = :id and approved_at is null`
- delete a draft: `delete from budgets where id = :id and approved_at is null`. The lines cascade.

0 rows → re-read and answer `Onaylanmış bütçenin adı ve tarihleri değiştirilemez.` / `Onaylanmış bütçe silinemez.` / stale.

I deliberately did **not** put the approval lock in triggers. The e2e and seed reset must be able to wipe approved budgets, and a delete-blocking trigger would force them to drop it.

**Lines.**
- A row exists only for amounts > 0. Blank and 0 mean no row (AC 27 "no row").
- `kurus()` = integer, 1 … 1 000 000 000 = `MAX_KURUS` (`₺10.000.000,00`). `parseAmount` already refuses above that.
- The kind (income/expense) is derived from the category with `kindOfCategory`. Storing it would only add a consistency CHECK for nothing.

**Plan save** (draft or revision), one `writeTx`:
1. Read the current lines.
2. Build the new map. Compute the diff.
   - Revision with an empty diff → `Hiçbir tutar değişmedi.`, no write.
3. Run the guard:
   ```sql
   update budgets set revision = revision + 1, updated_at = unixepoch(), updated_by = :me
    where id = :id and revision = :revFromForm
      and approved_at is [not] null
   ```
   It is `is null` for a draft save and `is not null` for a revision. 0 rows → `Bu plan az önce değişti. Sayfayı yenile.`, or the approved/draft state flipped: re-read to pick the message.
4. Write the lines:
   - `delete from budget_lines where budget_id = :id and category not in (:newCategories)`
   - then `insert … on conflict(budget_id, category) do update set amount_kurus = excluded.amount_kurus` for each new line
5. **Revision only:**
   - insert `budget_revisions (budget_id, reason, actor_id)` returning `id`
   - then one `budget_revision_lines` row per changed category (`from_kurus`/`to_kurus`, 0 = not planned; the CHECK forbids from = to)

   Drafts write no history (AC 31).

The step-1 read is consistent with the step-3 guard: if the revision still matches, nobody changed the lines since the form loaded. A stale form fails at step 3.

**Revisions** are never deleted by the app. They cascade only with their budget, and an approved budget can't be deleted. History is listed newest first by `id desc`, with `id` = AUTOINCREMENT, in one query that joins `budget_revision_lines` and `users`.

### 2.3 Read queries

**Actuals for one budget (D14, AC 32):** exactly the `categoryTotals` filter, so `/finans/rapor` and the budget report can't disagree (AC 36). Reuse `live`, `inRange` and `inArray(fe.kind, ['income','expense'])` from `queries-internal.ts`.
```sql
select kind, category, sum(amount_kurus) from finance_entries
 where voided_at is null and kind in ('income','expense')
   and occurred_on >= :from and occurred_on < :to
 group by kind, category;
```
- **Report:** `from = start-01`, `to = end-01`.
- **Email (AC 38):** `to = min(end, M+1)-01`.
- **Prefill (D18):** `[start − 12 months, start)`. Round up to whole lira in JS: `Math.ceil(k / 100) * 100`.

**List page (AC 25):** "Gelir %x · Gider %y" for every budget, in **one** query, not one per row:
```sql
select b.id, fe.kind, sum(fe.amount_kurus) from budgets b
  join finance_entries fe on fe.occurred_on >= b.start_month || '-01' and fe.occurred_on < b.end_month || '-01'
   and fe.voided_at is null and fe.kind in ('income','expense')
 group by b.id, fe.kind;
```
The plan totals come from one more query: `select budget_id, category, amount_kurus from budget_lines`. Sum them in JS by `kindOfCategory`.

**Budget covering month M** (the email, `Şu anki`):
```sql
select … from budgets where start_month <= :M and end_month > :M order by start_month desc limit 1
```
There is at most one, by no-overlap.

---

## 3. Migration `0008_phase8_board_budget`

Steps:
1. Add §1.1 and §2.1 to `schema.ts`.
2. Run `npx drizzle-kit generate --name phase8_board_budget`. That gives `drizzle/0008_phase8_board_budget.sql`, `meta/0008_snapshot.json` and journal entry idx 8, ordered after `0007_phase7_backup`.
3. **One hand edit: append the triggers at the end of the SQL file.** drizzle-kit doesn't model triggers. Copy this exactly:
   ```sql
   --> statement-breakpoint
   CREATE TRIGGER `budgets_no_overlap_insert` BEFORE INSERT ON `budgets`
   WHEN EXISTS (SELECT 1 FROM `budgets` b WHERE b.start_month < NEW.end_month AND NEW.start_month < b.end_month)
   BEGIN SELECT RAISE(ABORT, 'budgets_overlap'); END;--> statement-breakpoint
   CREATE TRIGGER `budgets_no_overlap_update` BEFORE UPDATE OF start_month, end_month ON `budgets`
   WHEN EXISTS (SELECT 1 FROM `budgets` b WHERE b.id <> NEW.id AND b.start_month < NEW.end_month AND NEW.start_month < b.end_month)
   BEGIN SELECT RAISE(ABORT, 'budgets_overlap'); END;
   ```
   The `;` inside `BEGIN … END` is safe. The migrator splits on `--> statement-breakpoint`, not on `;`, and SQLite parses a trigger as one statement. Verified with the real `drizzle-kit migrate`.

What the generated file does: it only creates the 8 tables, then the indexes (`board_tickets` 3, events 2, reads 1, revisions 1, budgets 2). Its output matched §1.1/§2.1. In the scratch run, the events table also had an `actor_id` index. I dropped it from the plan as unjustified: no screen queries by actor, and the restrict check on the rare e2e user delete scans ≤ 3000 rows. Grep: `ALTER` 0, `DROP` 0, `__new_` 0.

**Live-data safety (AC 40):**
- Pure expand: no existing table, column, CHECK or index is touched.
- Old code (Phase 7) runs unchanged against the new schema.
- The batch is atomic under libsql `migrate`.
- Deploy order, as before: `npm run db:migrate` (backup → migrate → `db:check`, which then expects 9/9), then the code. And only after Phase 7 is live (spec constraint 1).
- AC 40 script: migrate a copy of a Phase 7 DB, `db:check`, `grep -E 'ALTER|DROP|__new_'` on the file → none.

**Future-rebuild warning: add this one-line comment above `budgets` in schema.ts.** If a later migration ever rebuilds `budgets` with drizzle's `__new_budgets` pattern, the `DROP TABLE budgets` silently drops both triggers. drizzle-kit won't recreate them. The `db:check` addition in §6 catches that.

---

## 4. Indexes and query plans (AC 44)

### 4.1 Volumes on the scratch copy

300 tickets (200 archived + 20 recent `Bitti` + 80 open), 3300 thread rows (2000 comments), 300 read rows, 3 budgets, and 8045 ledger rows (5000 in the 2026-09 range, 3000 older). Then `ANALYZE`.

### 4.2 Plans (verbatim, abbreviated)

| Query | Plan | Time |
|---|---|---|
| Board with `kim=ben` + urgency, comment count, `Yeni` | `SEARCH t USING INDEX board_tickets_assignee_idx (assignee_id=?)`, `SEARCH c USING COVERING INDEX board_ticket_events_comments_idx (ticket_id=?)`, `SEARCH e USING INDEX board_ticket_events_ticket_idx (ticket_id=? AND rowid>?)`, `SEARCH r USING INDEX sqlite_autoindex_board_ticket_reads_1` | < 1 ms |
| Board, no filter | `SCAN t` (the `status <> 'done' or done_at >= ?` OR) + the same subquery searches | < 1 ms |
| Tab counts (if done separately) | `SCAN t USING COVERING INDEX board_tickets_status_idx` | < 1 ms |
| Badge / home card | `SEARCH t USING INDEX board_tickets_assignee_idx (assignee_id=? AND status=?)` + the events search | < 1 ms |
| Archive page | `SEARCH t USING INDEX board_tickets_status_idx (status=? AND done_at<?)` | < 1 ms |
| Detail by number / thread | `board_tickets_number_idx (number=?)`; `board_ticket_events_ticket_idx (ticket_id=?)` + PK joins to users | < 1 ms |
| Comment delete | `USING INTEGER PRIMARY KEY (rowid=?)` | — |
| Budget actuals (5000 rows in range) | `SEARCH finance_entries USING INDEX fe_occurred_idx (occurred_on>? AND occurred_on<?)` + temp b-tree group by | ≈ 2–8 ms |
| List page, all budgets at once | `SCAN b` (3 rows) + `SEARCH fe USING INDEX fe_occurred_idx` per budget | ≈ 2 ms |
| Budget covering M | `SEARCH budgets USING INDEX budgets_start_idx (start_month<?)` | — |
| Revision history | `budget_revisions_budget_idx` + `budget_revision_lines` PK | — |

- **The unfiltered board scans `board_tickets`.** I'm fine with that: at 300 rows the planner prefers it, and the per-row subqueries are all index searches. If the table ever reaches thousands of rows, split the query into `status in ('todo','in_progress','blocked')` plus `status = 'done' and done_at >= ?` (both indexed) with `union all`.
- **`budget_lines` with ≤ 17 rows per budget** is read through its PK, or scanned when tiny. Either is fine.

### 4.3 No new index on `finance_entries`

- The actuals query never scans `finance_entries` outside the `occurred_on` range (AC 44), because it uses the existing `fe_occurred_idx`.
- I tried a covering partial index `(occurred_on, kind, category, amount_kurus) where voided_at is null`. The planner kept `fe_occurred_idx`, and the gain would be a few ms at most.
- Not adding it keeps the migration free of any change to the live ledger table's index set.

---

## 5. Constraint tests (AC 41)

These are the direct writes I ran on the migrated copy, with `foreign_keys = on`. **The e2e should pick a few from the reject list.**

Accepted:
- a valid ticket, `done` + `done_at`
- every valid event kind, including the due change `— → 2026-11-15` and the assignee change `Atanmadı → yk`
- a read row
- adjacent budgets before and after
- a January budget
- a line of 2000000
- a revision with a reason of ≥ 5 characters, and a revision line `2000000 → 2600000`
- the cascade deletes

Rejected:
- tickets:
  - a duplicate number; number 0; number 2.5
  - a title that trims to 2 characters; 121 characters
  - an unknown status or urgency
  - `2026-02-30` and `2026-13-01`
  - `done` without `done_at`; `todo` with `done_at`
  - an unknown assignee (FK)
  - a whitespace description; 4001 characters
- thread:
  - a blank comment; 2001 characters
  - a system entry with a body
  - a status entry with a NULL from, from = to, or an unknown code
  - a due entry `2026-11-31`; a due entry with both values NULL
  - an assignee entry with from = to, or an unknown user
  - user columns on a non-assignee entry
  - an unknown ticket
- seq id 2
- budgets:
  - an overlap that starts inside; an overlap that ends inside
  - an update into an overlap
  - a duplicate name; a 41-character name; a blank name
  - month 13; an end that is not start + 12
  - half an approval pair
  - a 501-character note
- lines:
  - a duplicate `(budget, category)`
  - 12.5; 0; −5
  - category `transfer`
- a revision reason that trims to 3 characters
- a revision line with from = to
- deleting a user referenced by a ticket (restrict)

Note: the text `'100'` is accepted as an amount. INTEGER affinity coerces it to the integer 100 before the CHECK, so it is stored as an integer. That is harmless and the same as `finance_entries`.

---

## 6. Backup dump, restore and `db:check`

**Dump (`src/lib/backup/dump.ts`): no change needed.**
- It takes every non-engine table, so the 8 new tables and their rows are included automatically, in `db:backup` and in the monthly email.
- Triggers are emitted **after** the data, in the existing `index → view → trigger` order. So they don't fire during the load, and they are back in force after it.
- Verified round trip on the perf copy:
  - `dumpDatabase` → 31 tables, 47 indexes/triggers (2 `CREATE TRIGGER`)
  - `db:restore` → OK, `foreign_key_check` empty
  - after the restore, an overlapping insert is rejected with `budgets_overlap`
  - a new event gets id `max + 1` (3301)
  - `db:check` → `migrations=9/9, quick_check=ok`
- `sqlite_sequence` is not dumped. It is recomputed from the max id on restore. The only effect: an id deleted at the top before the backup can be issued again after a restore. That is harmless for ticket numbers, because they use `board_ticket_seq`. For `Yeni` it could at most hide one comment. Accepted; no dump change.
- What's in the dump: ticket texts, comments and budgets go into the encrypted dump attachment. That is the same board audience as the finance data already in it. No secrets are stored.

**`scripts/db-check.ts`: add two invariants.** Small, and local and remote alike:
1. Both triggers exist, because drizzle doesn't track them (§3 warning):
   ```sql
   select count(*) from sqlite_master
    where type = 'trigger' and name in ('budgets_no_overlap_insert', 'budgets_no_overlap_update')
   ```
   It must be 2, else `problems.push("budget overlap triggers missing")`. Run it only when the `budgets` table exists, so an older restored DB reports "migrations missing" rather than this.
2. The ticket counter is not behind the data:
   ```sql
   select count(*) from board_tickets
    where number > coalesce((select last_number from board_ticket_seq where id = 1), number)
   ```
   It must be 0, else `ticket number counter behind data`. A missing row is fine (self-heals). A row that is behind would make the next create fail with a unique violation.

**Restore drill (Phase 7 AC 30):** unchanged. Don't add `board_ticket_reads` to any row-count comparison: viewing pages writes reads, so live and dump legitimately differ.

---

## 7. Seed and e2e

### 7.1 New fixture `scripts/board-fixture.mjs`

It exports `seedBoard(client, T)` and `seedBudgets(client, T)`, with raw SQL on a libSQL client, in the style of `finance-fixture.mjs`. It starts with `assertFixtureTarget(client)`.
- Fixed ids: `id("a", n)` for tickets, `id("b", n)` for budgets (hex group in the existing `00000000-0000-4000-9X00-…` scheme).
- All times are relative to `T`.
- Each function **wipes its tables first**, so it is idempotent:
  - board: `delete from board_tickets` (events and reads cascade), then `insert or replace into board_ticket_seq values (1, 6)`
  - budgets: `delete from budgets` (lines and revisions cascade)
- Call both in `seed.ts` after `seedFinance`, and in `e2e/lib.mjs` `cleanup()` right after `seedFinance` and **before** `delete from users where email like '%@e2e.test'`. Tickets and budgets reference users with restrict, and a full wipe also removes anything e2e created, including the AC 44 bulk arrange.

**Board** (`D = 86400`; sef = Demo Şef, yk = Demo Yönetim; seq = 6 after the seed):

| # | Title | Status | Urgency | Assignee | Due | Opener | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `Bahar konseri için salon rezervasyonu` | todo | urgent | yk | T+10 d | sef, T−1 d | **never opened by yk → `Yeni`** |
| 2 | `Festival başvurusu: katılım ücretini sor` | in_progress | high | yk | **T−2 d (overdue)** | yk, T−9 d | move event todo→in_progress (yk); comments: sef `Salon için iki teklif aldım.`, yk `Cuma'ya kadar karar verelim.`; read by yk up to the last event → not new |
| 3 | `Kostüm siparişi: kapora ödemesi` | blocked | medium | sef | — | yk, T−6 d | move event todo→blocked (sef); comment yk `Kapora ödenmeden kostümcü siparişi başlatmıyor.`; read by sef → not new |
| 4 | `Yeni sezon için korist alım duyurusu` | todo | low | — | — | sef, T−3 d | |
| 5 | `Kış konseri afiş baskısı` | done | medium | sef | — | yk, T−15 d | done event (yk), `done_at` T−5 d |
| 6 | `Eylül genel kurul tutanağı` | done | high | sef | — | sef, T−60 d | done event (sef), `done_at` **T−40 d → archived** |

What this gives:
- Every ticket has its `created` event at `created_at`.
- `updated_at` = the last move, `updated_by` = the mover, `revision` = the number of moves.
- The reads rows store the `max(id)` of the ticket's events.
- Tab counts: `Yapılacak 2 · Devam ediyor 1 · Takıldı 1 · Bitti 1`.
- yk: `kim=ben` → #1, #2. Home card `Sana atanan 2 açık iş · 1 yeni · 1 acil`. Badge 1.
- sef: open assigned = 1 (#3), new 0.
- Every urgency is present, comments are on two tickets, one ticket is overdue and one is archived.

**Budgets** are anchored to the season of `T`: `S = month(T) ≥ 9 ? year(T) : year(T) − 1`. Today (2026-10) that gives exactly the spec's names.

| Name | Start | State | Lines (kuruş) |
|---|---|---|---|
| `${S}–${(S+1) % 100} sezonu` (`2026–27 sezonu`) | `${S}-09` | approved by sef at T−20 d | income: dues 9 000 000, tickets 3 000 000, sponsorship 1 000 000; expense: venue 1 200 000, musician_fee 900 000, costume 600 000, travel 2 000 000, scores_royalties 150 000, bank_fee 5 000 |
| `${S−1}–${S % 100} sezonu` (`2025–26 sezonu`) | `${S−1}-09` | approved by sef at T−380 d | income: dues 8 000 000, tickets 2 500 000; expense: venue 1 000 000, musician_fee 800 000, travel 1 500 000 |

- Plus **one revision** on the current budget: yk, T−10 d, `Festival daveti geldi, seyahat bütçesi arttı.`, travel 1 500 000 → 2 000 000. That way `Değişiklik geçmişi` isn't empty in the demo.
- e2e note for AC 31: count history entries **relative** to the seeded one.

### 7.2 e2e notes

- The `@e2e.test` and `E2E` prefix convention isn't needed for board and budget rows: the fixtures wipe everything. Tests may still prefix titles with `E2E` for readability.
- AC 22 badge flips: rely on `seen_event_id`, not time. No sleeps are needed.
- AC 20: `update board_ticket_events set created_at = created_at - 960 where id = ?`.
- AC 23 archive: arrange with `done_at = unixepoch() - 31*86400`.
- AC 41: a handful of rejects from §5. Assert on `SQLITE_CONSTRAINT`.
- AC 44: bulk-insert in one `executeMultiple` or batch like §4.1. Cleanup wipes it.
- `e2e/prod.mjs`: nothing new. It migrates, so it gets 0008, and it seeds, so it gets the fixtures.

---

## 8. Replies to the PO

- **@po AC 14 "the next created ticket gets max + 1":** it is **high-water + 1**, not "current max + 1". Example: if #7 (the highest) is deleted, the next ticket is #8, not #7. That is what "never reused" requires. Please reword the e2e note.
- **@po AC 40 wording:** "only creates tables and indexes" → "only creates tables, indexes and two triggers on the new `budgets` table". The triggers are the only way to enforce no-overlap in SQLite (no subqueries in CHECK). They don't touch any existing table.
- **@po AC 41 "FKs restrict to users":** agreed for every FK except `board_ticket_reads.user_id`, which cascades. Read marks are disposable per-user UI state, and e2e user cleanup must not trip over them (§1.4).
- **@po D9 "more than 30 days":** implemented as a rolling 30 × 24 h from `done_at`, not as Istanbul calendar days. The difference is at most a few hours at the edge and invisible in practice. The e2e should arrange 31 days for "archived" and 29 for "on the board", never exactly 30.
- **@po D11 + AC 13:** a move bumps the ticket's `revision`, so an editor opened before someone moved the card is refused on save with `Bu iş az önce değişti. Sayfayı yenile.`. That's the safe side, and it is rare. A comment never does this.
- **@po D7 "changed any field":** title/description edits by someone else do mark `Yeni` (via the revision), with one accepted gap: if I then move or edit the card myself before opening it, that earlier edit no longer flags. I've acted on the card in that case.
- **@po seed wording "2 assigned to yk@, 1 to sef@, 1 unassigned":** I read it as the **open** tickets. The two `Bitti` tickets are assigned to sef@. Otherwise AC 9 (yk@ `kim=ben` sees exactly 2) and the 6-ticket total can't both hold, because the seed has only two managers.
- **@po budget seed "the seeded ledger already has entries in both ranges":** the finance fixture re-anchors its ledger to the last three months (M−2…M), and the budgets are anchored to the season of today. So the past season has ledger rows only when today is in September or October. Today it does: August falls in `2025–26`, and September–October in `2026–27`. From November on, every demo row is in the current season. **AC 32–36 must arrange their own entries**, and I don't recommend adding older demo entries: they'd change the Phase 5/6 balance expectations.
- **@po (and the user): every e2e run and `db:reset` wipes all board and budget rows** and reinserts the demo ones, exactly as the finance fixture already does for the ledger. Tickets or budgets typed by hand into the local dev DB won't survive an `npm run e2e`. Production is unaffected: the fixtures refuse non-file DBs and `NODE_ENV=production`.
- **@po AC 26 duplicate name:** uniqueness is exact after trim. `2026–27 Sezonu` and `2026–27 sezonu` can both exist. Budgets are few and named by the default, so I don't think a Turkish-aware `name_key` (as on `sponsors`) is worth it. Say if you want it; it's one more column now, and a rebuild later.
- **@po AC 27 "no row (or 0)":** settled as **no row**. A line exists only for an amount > 0, and the CHECK forbids 0.
- **@backend:**
  - every write recipe is in §1.3, §1.5 and §2.2
  - use `writeTx` for edit, move, delete and plan saves, and `db.batch` for ticket create
  - map `budgets_overlap` and the unique violations on `budgets.name` / `budgets.start_month` to the AC 26 texts
  - compare the 15-min rule with the DB clock
  - mind the prefetch note in §1.4
  - add the two `db:check` invariants in §6
