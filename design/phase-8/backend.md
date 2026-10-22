# Phase 8: backend and security plan (arkhe-backend)

Author: arkhe-backend. Date: 2026-10-21. Inputs: `po-spec.md` (AC 1–45), `CLAUDE.md`, `AGENTS.md`, `design/TEAM.md`, `design/phase-7/{po-decisions,implementation-notes,review-backend}.md`. `db.md`, `ux.md` and `ui.md` did not exist when I wrote this, so §1 is a **proposed data contract** for @dba to accept or replace; everything after it only depends on the names in §1.

Code read: `src/lib/{permissions,validation,money,time,text,flash,csv,api}.ts`, `src/lib/auth/{dal,rate-limit}.ts`, `src/db/{write-tx,index}.ts`, `src/db/schema.ts`, `src/lib/finance/{queries,queries-internal,csv,schemas,guard,categories,dates}.ts`, `src/app/(portal)/finans/actions.ts`, `src/app/(portal)/finans/rapor/csv/route.ts`, `src/app/(portal)/layout.tsx`, `src/lib/backup/{run,reports,email,schedule,constants,dump}.ts`, `e2e/phase7-{a-cron,b-page}.mjs` (attachment and body assertions), `node_modules/@libsql/client` (`transaction(mode = "write")`), `node_modules/drizzle-orm/libsql/session.js`. Next docs read: `02-guides/server-actions.md`, `02-guides/data-security.md`, `01-getting-started/07-mutating-data.md`.

`src/` is untouched, nothing was written to `data/arkhe.db`, and no e2e was run.

---

## 0. Decisions in one table

| Topic | Decision |
|---|---|
| Module layout | Board: `src/lib/board/rules.ts` (pure), `src/lib/board/queries.ts` (server-only, every export authorizes), `src/app/(portal)/yonetim/actions.ts` (`"use server"`). Budget: `src/lib/finance/budget.ts` (pure computation), the unguarded reads in `queries-internal.ts`, the guarded reads in `queries.ts`, actions in `src/app/(portal)/finans/butce/actions.ts`, and the CSV builder in `src/lib/finance/csv.ts`. |
| D11 allowlist (Phase 7) | Unchanged: only `src/lib/finance/queries.ts` and `src/lib/backup/*` import `queries-internal`. The budget reads go into those two files, so no new importer is added. |
| Authorization | Actions: `assertManager()` as the first statement, returning `{ error: FORBIDDEN }` before any parsing. Pages and queries: `requireManager()`. Home card and nav badge: a **non-redirecting** variant (§2.9), because `requireManager` would redirect korist@ from `/` to `/` in a loop. |
| Delete rules | `canDeleteTicket` and `canDeleteComment` in `permissions.ts`, used by the UI. The server also enforces them **inside the SQL `where`**, so a check-then-delete race can't slip through. |
| Optimistic lock | Field edits: `tickets.revision` CAS. Moves: CAS on `status = from` (D11). The two are independent, so a move doesn't invalidate an open editor. Budgets: `budgets.revision` CAS on every write. No locks on `updated_at` (it has 1 s resolution). |
| Ticket numbers | A counter row in a normal table, not `AUTOINCREMENT`. `sqlite_sequence` isn't in the Phase 7 dump, so after a restore a deleted top number would be reused (§1.1). |
| "New for me" | Integer `activity_rev` on the ticket and `seen_rev` per (ticket, user). Integers have no clock or same-second ambiguity. Marking a ticket seen is a **server action called from the detail page on mount**, not a write during render, because a prefetch must never mark anything seen (§2.8). |
| Idempotency | Ticket create and comment create carry a per-mount `clientKey` (uuid), unique in the DB: the Phase 5 `createEntry` pattern. A double submit returns the existing row. |
| Overlap | Checked inside `writeTx`. libSQL's `transaction()` defaults to `"write"` (`BEGIN IMMEDIATE`), locally and over HTTP, so check-then-insert is serialized. A DB trigger is an optional backstop (@dba). |
| Actuals | One unguarded query `categoryActuals(from, toExclusive)` in `queries-internal.ts`, with the same `live` and `kind in ('income','expense')` filter as `categoryTotals`. It is used by the report, the list, the prefill and the email. |
| Email | `buildReports` gets an optional `budget` part. It is **best effort**: if it throws, the email goes out exactly as in Phase 7 and the error is logged, because the encrypted backup matters more than the budget CSV. Without a covering budget, the output is byte-identical to Phase 7. |
| CSV negatives | `csvCell` prefixes a leading `-` with `'`, so the signed `Fark` `-300,00` would become the text `'-300,00`. I add a number-cell path for strictly numeric strings (§4.1). |
| Rate limits | Only comment create (60 per 10 min per user) and ticket create (30 per hour per user), through `consumeAttempt`. Nothing else: the users are trusted managers, and every other write is CAS-guarded and bounded in size. |

---

## 1. Proposed data contract (for @dba)

The names are mine. @dba owns the final DDL, the CHECKs (AC 41) and the indexes. The migration is additive only (AC 40).

### 1.1 Board

```
ticket_counter (id integer primary key check (id = 1), last_number integer not null check (last_number >= 0))
  -- seeded with (1, 0) by the migration; a normal table, so it is in the Phase 7 dump
tickets (
  number integer primary key,                 -- the #numara, from ticket_counter, never reused
  client_key text not null unique,            -- per-mount uuid from the form
  title text not null,                        -- 3..120 after trim
  description text,                           -- null or 1..4000
  status text not null default 'todo',        -- todo | in_progress | blocked | done
  urgency text not null default 'medium',     -- low | medium | high | urgent
  assignee_id text references users(id) on delete restrict,
  due_on text,                                -- 'YYYY-MM-DD' Istanbul day, or null
  done_at integer,                            -- unixepoch; (status = 'done') = (done_at is not null)
  revision integer not null default 0,        -- bumped by field edits only
  activity_rev integer not null default 1,    -- bumped by every create/edit/move/comment
  created_by text not null references users(id) on delete restrict,
  created_at integer not null default (unixepoch()),
  updated_by text references users(id) on delete restrict,
  updated_at integer                          -- (updated_by is null) = (updated_at is null)
)
  index tickets_board_idx (status, done_at)
  index tickets_assignee_idx (assignee_id, status)

ticket_entries (
  id integer primary key autoincrement,       -- thread order; same-second entries keep insert order
  ticket_number integer not null references tickets(number) on delete cascade,
  kind text not null,                         -- comment | system
  actor_id text not null references users(id) on delete restrict,
  client_key text unique,                     -- comments only; null for system
  body text,                                  -- comments: 1..2000; system: null
  event text,                                 -- system: created | status | assignee | urgency | due
  from_value text, to_value text,             -- codes / user ids / days; null means "none"
  created_at integer not null default (unixepoch())
)
  -- CHECK: kind='comment' → body not null, event null; kind='system' → body null, event not null
  index ticket_entries_ticket_idx (ticket_number, kind)

ticket_reads (
  ticket_number integer not null references tickets(number) on delete cascade,
  user_id text not null references users(id) on delete restrict,
  seen_rev integer not null,
  primary key (ticket_number, user_id)
)
```

- **Why a counter row and not `AUTOINCREMENT`:** `dumpDatabase` skips `sqlite_*` tables (`src/lib/backup/dump.ts:25`). After a restore, `sqlite_sequence` is rebuilt from `max(number)`, so a deleted `#12` above `#11` would come back. AC 14 says the number is never reused. The create transaction runs `update ticket_counter set last_number = last_number + 1 where id = 1 returning last_number`, which is atomic under the write lock.
- **Why system entries are structured, not stored sentences:** names and labels render at read time, from `rules.ts` plus a join on `users`, so the copy can still be polished in `po-decisions.md` without a data migration. The assignee entry stores user ids, and a rename shows the current name (the same as everywhere else in the portal).
- `ticket_entries.id` as an integer: the thread order must be total. Saving one edit writes up to three system entries in the same second.

### 1.2 Budget

```
budgets (
  id text primary key,                        -- uuid from the create form (idempotent)
  name text not null unique,                  -- 1..40 after trim
  start_month text not null unique,           -- 'YYYY-MM' (glob); unique is a cheap partial backstop
  note text,                                  -- null or 1..500
  status text not null default 'draft',       -- draft | approved
  approved_by text references users(id) on delete restrict,
  approved_at integer,                        -- CHECK: (status='approved') = (approved_by is not null) = (approved_at is not null)
  revision integer not null default 0,
  created_by text not null references users(id) on delete restrict,
  created_at integer not null default (unixepoch()),
  updated_by text references users(id), updated_at integer
)
budget_lines (
  budget_id text not null references budgets(id) on delete cascade,
  category text not null,                     -- the CATEGORIES list (same CHECK source as finance_entries)
  amount_kurus integer not null,              -- typeof integer, 1..1_000_000_000; 0 = no row
  primary key (budget_id, category)
)
budget_revisions (
  id integer primary key autoincrement,
  budget_id text not null references budgets(id) on delete cascade,
  reason text not null,                       -- 5..200 after trim
  actor_id text not null references users(id) on delete restrict,
  created_at integer not null default (unixepoch())
)
budget_revision_lines (
  revision_id integer not null references budget_revisions(id) on delete cascade,
  category text not null,
  old_kurus integer not null, new_kurus integer not null,   -- ≥ 0, old <> new
  primary key (revision_id, category)
)
```

- **0 means no row.** It reuses the existing `kurus()` CHECK helper (`1..1e9`) and keeps "blank = not planned" literal. Saving a line as blank or `0` deletes its row.
- **Overlap backstop (optional, @dba):** a `BEFORE INSERT` / `BEFORE UPDATE OF start_month` trigger that `RAISE(ABORT, 'budget_overlap')` when another row's month index is within ±11. The dump already writes triggers after the data (`dump.ts:49`), so a restore isn't affected. drizzle-kit doesn't generate triggers, so it would be a hand-written block in the migration. The app check alone is race-safe (§0). The trigger only protects against a future code path that forgets the check.

---

## 2. Board: server actions and queries

All actions live in `src/app/(portal)/yonetim/actions.ts` (`"use server"`). The file **exports only these actions**: every export of a `"use server"` module is a public endpoint (`phase-7/po-decisions.md` D11.3). The helpers stay non-exported or live in `src/lib/board/*`.

### Shared rules for every board action

1. The first line is `const actor = await assertManager(); if (!actor) return { error: FORBIDDEN };`. It reads the role fresh from the DB (`getSessionUser`), so a demoted or deactivated manager loses access on the next request. Nothing is parsed or read before this check (AC 1: "changes nothing").
2. **Bound arguments are untrusted.** `moveTicket.bind(null, number, from)` arguments are sent by the client and are *not* encrypted. Only closure captures are (`data-security.md`, "Closures and encryption"). Every bound value is parsed with zod: `number` → `z.coerce.number().int().min(1).max(9_999_999)`, status and urgency → `z.enum`, uuid → `z.uuid()`.
3. Writes run in `writeTx`, wrapped in `guarded(formData, …)` from `src/lib/finance/guard.ts`. It's generic despite the folder: FK → `Kayıt bulunamadı.`, CHECK/UNIQUE → `Kaydedilemedi. Alanları kontrol et.`. `redirect()` is called **after** `guarded` returns, because it throws (the `correctEntry` pattern).
4. After a successful write: `revalidatePath("/", "layout")`. The sidebar badge (portal layout) and the home card live outside `/yonetim`, the same reason as `revalidateFinance()`.
5. Every write by the actor also sets the actor's own `seen_rev` to the new `activity_rev` in the same transaction: `insert … on conflict (ticket_number, user_id) do update set seen_rev = max(seen_rev, excluded.seen_rev)`. That makes D7's "my own actions never mark anything new for me" true by construction.

Constants (in `src/lib/board/rules.ts`; Turkish strings are UI copy):

```ts
export const TICKET_STALE = "Bu iş az önce değişti. Sayfayı yenile.";
export const TICKET_NOT_FOUND = "Bu iş bulunamadı.";
export const BAD_ASSIGNEE = "Bu kişi sorumlu olarak seçilemez.";
export const DELETE_TICKET_DENIED = "Bu işi yalnızca açan kişi ya da koro şefi silebilir.";
export const COMMENT_NOT_OWN = "Yalnızca kendi yorumunu silebilirsin.";
export const COMMENT_TOO_OLD = "Yorum 15 dakika geçtikten sonra silinemez.";
export const COMMENT_DELETE_WINDOW_S = 15 * 60;
export const ARCHIVE_AFTER_S = 30 * 86_400;
```

### 2.1 Validation schemas (`src/lib/board/rules.ts`, isomorphic)

| Field | Schema | Messages |
|---|---|---|
| `title` | `z.string().overwrite(cleanLine).trim().min(3).max(120)` | `Başlık en az 3 karakter olmalı.` / `Başlık en fazla 120 karakter olabilir.` |
| `description` | `z.string().overwrite(cleanText).trim().max(4000)`, `""` → null | `Açıklama en fazla 4000 karakter olabilir.` |
| `assigneeId` | `""` → null, else `z.uuid()` (a bad uuid gives `BAD_ASSIGNEE`); eligibility is checked in the transaction (§2.2) | `Bu kişi sorumlu olarak seçilemez.` |
| `urgency` | `z.enum(URGENCIES)`, default `medium` | `Aciliyet seç.` |
| `dueOn` | `""` → null, else `isRealDay` and `inDateBounds` (2000-01-01 … today + 730, read per call) | `Geçerli bir tarih seç.` |
| `status` (create) | `z.enum(STATUSES)`, default `todo` | `Durum seç.` |
| `revision` (edit) | `z.coerce.number().int().min(0)` | missing → `TICKET_STALE` |
| `clientKey` | `z.uuid()` | missing → `TICKET_STALE` |
| comment `body` | `z.string().overwrite(cleanText).trim().min(1).max(2000)` | `Yorum boş olamaz.` / `Yorum en fazla 2000 karakter olabilir.` |

- `cleanText` already drops `\r` and the bidi or invisible characters, and keeps `\n`.
- JS `.length` counts UTF-16 units, while SQLite `length()` counts characters. So the zod limit is always the stricter one, and a DB CHECK never fires first for valid input.
- Past due dates are allowed: logging an already-late job is legitimate.

### 2.2 `createTicket(_prev, formData): Promise<FormState>`

- **Authorization:** any manager. `created_by` = `actor.id` from the session, never from the form.
- **Rate limit:** `consumeAttempt("board-create:" + actor.id, 30, 3600_000)`. When blocked: `Çok fazla deneme. Biraz sonra yeniden dene.` On a validation failure the attempt is forgotten (`forgetAttempt`), so typos don't count.
- **Transaction:**
  1. `select number from tickets where client_key = ?`. If found, this is a replay: return that number (go to step 5).
  2. If `assigneeId` is set: `select 1 from users where id = ? and is_active = 1 and role in ('conductor','board')`. Missing → `FieldError("assigneeId", BAD_ASSIGNEE)`.
  3. `update ticket_counter … returning last_number` → n.
  4. Insert the ticket (`done_at = unixepoch()` if `status = 'done'`, `activity_rev = 1`), then the system entry `event = 'created'`, then the actor's `ticket_reads` row with `seen_rev = 1`.
  5. After the transaction: `setFlash("is-acildi", n)` and `redirect("/yonetim/" + n)`.
- **Errors:** field errors with `values` echoed (`fieldErrorsOf`), `FORBIDDEN`, `TICKET_STALE` (no clientKey).
- **Replay or double tap:** the unique `client_key` plus step 1 means one row, and the second request lands on the same detail page.

### 2.3 `updateTicket(number, _prev, formData)` (bound: `number`)

- **Authorization:** any manager can edit any ticket (AC 13).
- **Fields:** title, description, assigneeId, urgency, dueOn, revision. The status is **not** in this form.
- **Transaction:**
  1. Read the current row. Missing → `TICKET_NOT_FOUND`.
  2. Assignee: if it differs from the current `assignee_id`, check eligibility as in §2.2. If it is unchanged, keep it even when the person is no longer an active manager. That is the AC 11 `(kurulda değil)` case: an untouched form must still save.
  3. Compute the diff. If nothing changed, return `{ success: "Kaydedildi." }` without writing anything (no revision bump, no entries).
  4. `update tickets set …, revision = revision + 1, activity_rev = activity_rev + 1, updated_by = actor, updated_at = unixepoch() where number = ? and revision = ?` `returning activity_rev`. Zero rows → `{ error: TICKET_STALE, values }`, and nothing is saved.
  5. Insert one system entry per changed field among `assignee`, `urgency` and `due`, in that fixed order (title and description write none, D5). Bump the actor's `seen_rev`.
- **Returns** `{ success: "Kaydedildi." }`. If @ux puts the editor on its own page (`/yonetim/<n>/duzenle`), it's `setFlash("kaydedildi")` plus a redirect to the detail page instead.

### 2.4 `moveTicket(number, from, to)` (bound or plain args; returns `{ error } | { success }`)

- **Authorization:** any manager.
- **Validation:** `from` and `to` ∈ STATUSES and `from !== to`. Anything else → `TICKET_STALE` (a forged or stale call).
- **One statement:** `update tickets set status = :to, done_at = case when :to = 'done' then unixepoch() else null end, activity_rev = activity_rev + 1, updated_by, updated_at where number = :n and status = :from returning activity_rev`.
  - Zero rows: re-read. Missing → `TICKET_NOT_FOUND`, otherwise `TICKET_STALE` (AC 18).
  - Then the system entry `status from → to` and the actor's `seen_rev`.
- **Success:** `{ success: "#12 → Devam ediyor" }`, built from `STATUS_LABELS`.
- **Concurrency:** AC 18 gets exactly one status entry, because the entry is only written when the CAS update hit a row.
- **Moves don't bump `revision`:** a concurrent move must not refuse an unrelated title fix.
- **`Son değişiklik`:** I set `updated_by`/`updated_at` on moves too. @po: AC 12 says "when the ticket was edited". I read a move as an edit of the status, and the alternative leaves `Son değişiklik` older than the latest status entry, which looks wrong. Please confirm.
- **Archive:** an archived `Bitti` ticket moved out gets `done_at = null` and is back on the board (AC 23). Moving it back to `Bitti` starts a new 30 days.

### 2.5 `deleteTicket(number)`

- **Authorization:** `canDeleteTicket(actor, ticket)` = `isManager(actor.role) && (ticket.createdBy === actor.id || actor.role === "conductor")`, enforced in SQL: `delete from tickets where number = ? and (created_by = :actor or :isConductor = 1) returning number`.
  - Zero rows: re-read. Missing → `TICKET_NOT_FOUND`, otherwise `DELETE_TICKET_DENIED`.
- **Side effects:** the entries and reads cascade. The counter is untouched, so the number is never reused. Then `setFlash("is-silindi", n)` and `redirect("/yonetim")`.
- **Idempotency:** a second delete finds nothing and returns `TICKET_NOT_FOUND`. The client is on `/yonetim` already after the first one.
- **Deactivated opener:** only the conductor can delete their tickets, which is acceptable.

### 2.6 `addComment(number, _prev, formData)`

- **Authorization:** any manager.
- **Rate limit:** `consumeAttempt("board-comment:" + actor.id, 60, 600_000)`, with the same blocked copy as §2.2.
- **Transaction:**
  1. Insert into `ticket_entries` (`kind = 'comment'`, `client_key`) `on conflict (client_key) do nothing returning id`. If the conflict row's actor is someone else → `TICKET_STALE` (the `createEntry` replay rule). Same actor → success, no second row.
  2. Then `update tickets set activity_rev = activity_rev + 1 where number = ? returning activity_rev`, and bump the actor's `seen_rev`.
  3. A ticket deleted in the meantime gives an FK failure → `Kayıt bulunamadı.`
- **Returns** `{ success: "Yorum eklendi." }` with **no** `values`, so the box clears. The form remounts with a fresh `clientKey` (keyed on the success counter).
- Comments don't touch `revision` or `updated_at`: comments never conflict (D11), and they don't reorder the column (AC 7 orders by `updated_at`).

### 2.7 `deleteComment(entryId)`

- **One statement:** `delete from ticket_entries where id = ? and kind = 'comment' and actor_id = :actor and created_at > unixepoch() - 900 returning id`.
- **Zero rows:** re-read the entry.
  - missing or `kind = 'system'` → `Kayıt bulunamadı.` (system entries are never deletable, AC 17)
  - another author → `COMMENT_NOT_OWN`
  - otherwise → `COMMENT_TOO_OLD`
- **The conductor gets no exception** (D6).
- **Clock:** both `created_at` (DB default) and the comparison use the DB's `unixepoch()`. There is no JS/DB clock mix, and the e2e "backdate by 16 min" is a plain `update … set created_at = created_at - 960`.
- **No `activity_rev` bump:** a deleted comment must not light up `Yeni` for the assignee.
- **UI:** shows `Sil` only while `canDeleteComment(actor, entry, nowSeconds)` holds. A page left open past 15 minutes still shows it, and the server answers `COMMENT_TOO_OLD`.

### 2.8 `markTicketSeen(number, seenRev)`: the "Yeni" clear (AC 22)

- **Not a write during render.** `<Link>` can prefetch `/yonetim/<n>` from the board's cards. If the detail page's Server Component wrote `seen_rev`, a prefetch (or a double render) would clear the dot for tickets the user never opened.
- **Mechanism:** the detail page renders a tiny client component that calls this action once on mount with the `activity_rev` it rendered.
- **Statement:** `insert into ticket_reads (ticket_number, user_id, seen_rev) select number, :actor, min(:seenRev, activity_rev) from tickets where number = :n on conflict do update set seen_rev = max(seen_rev, excluded.seen_rev)`.
  - `min(…, activity_rev)`: a forged huge `seenRev` can't pre-mark future activity as seen.
  - `max(…)`: an old tab can't move the marker backwards.
- **After the write:** `revalidatePath("/", "layout")` refreshes the badge.
- **Card links:** also set `prefetch={false}` on the ticket card links, to save 300 detail prefetches on the board. That is a performance choice, not the protection.
- **Authorization:** any manager. It only ever writes the caller's own row (`user_id` from the session), so there is no IDOR.

### 2.9 Queries (`src/lib/board/queries.ts`, `import "server-only"`)

Every export starts with `await requireManager()`, except the two marked below.

| Function | Notes |
|---|---|
| `boardTickets(filters)` | `filters = parseBoardFilters(searchParams)` from rules.ts, a whitelist: `kim=ben`, `aciliyet=acil\|yuksek\|orta\|dusuk`, `sutun=yapilacak\|devam\|takildi\|bitti`. Anything unknown is ignored (AC 9). One query: `status <> 'done' or done_at > unixepoch() - ARCHIVE_AFTER_S`, plus the filters. It joins the assignee (name, `is_active`, role → `formerMember` flag for `(kurulda değil)`), a comment count (`(select count(*) from ticket_entries e where e.ticket_number = t.number and e.kind = 'comment')`, indexed), and the viewer's `seen_rev` (left join `ticket_reads` on the session user). Grouping by status, the counts and the AC 7 order are done in JS by `sortColumn()` in rules.ts: urgency rank, then `due_on` with nulls last, then `updated_at ?? created_at` desc; `Bitti` by `done_at` desc. `isNew` = assignee = me, status ≠ done, and (`seen_rev` is null or `activity_rev > seen_rev`). `overdue` = `due_on < todayIstanbul()` and status ≠ done. |
| `archivedTickets(page)` | `page` = `z.coerce.number().int().min(1).max(10_000)`, default 1. `status = 'done' and done_at <= unixepoch() - ARCHIVE_AFTER_S order by done_at desc, number desc limit 51 offset (page-1)*50`. The 51st row only decides `Daha eski`. |
| `ticketDetail(number)` | The number is validated by `/^[1-9]\d{0,6}$/` before any query, otherwise `notFound()` (AC 12: `/yonetim/abc`). It returns the ticket, the creator, the updater, the assignee, the thread (`order by id`), with system entries rendered by `systemSentence(entry, names)` in rules.ts, `canDelete` per comment, `canDeleteTicket`, and `activityRev` for §2.8. |
| `assignableUsers()` | `is_active = 1 and role in ('conductor','board')`, ordered with `collator`. The editor adds the current assignee when they're not in the list (AC 11). |
| `boardNavBadge()` **(non-redirecting)** | `cache()`d. It calls `assertManager()`: `null` → 0. Otherwise `count(*)` over the new-for-me rows (index `tickets_assignee_idx`). **No `userId` parameter**: it reads the session itself, so nobody can call it for someone else (unlike `openHomeworkCount(userId)`). |
| `myBoardSummary()` **(non-redirecting)** | For the home card. `null` for non-managers, so the home page renders no card and no ticket data reaches korist@'s HTML (AC 3). Otherwise `{ open, fresh, urgent }` for the session user, from one grouped query. |

The `null` variants exist because `requireManager()` redirects to `/`. On the home page that would loop for korist@.

### 2.10 Flash messages with a number

`FLASH_MESSAGES` only carries fixed keys, and `#12 açıldı.` / `#12 silindi.` need a number. I'd extend `src/lib/flash.ts` with **typed, validated params only**:

- `setFlash("is-acildi", 12)` writes `is-acildi:12`.
- `readFlash` accepts only `^(is-acildi|is-silindi):([1-9]\d{0,6})$` and renders from a template.
- Any other value is ignored as today, so no text injection is possible.

The new fixed keys are `kaydedildi`, `plan-kaydedildi` and `butce-silindi`.

---

## 3. Budget: server actions and queries

Actions live in `src/app/(portal)/finans/butce/actions.ts` (`"use server"`, actions only). They follow the finance rules of §2 point 1–4: `assertManager()` first, `FORBIDDEN` from `finance/schemas.ts`, `writeTx` + `guarded`, `revalidatePath("/", "layout")`.

Constants:

```ts
export const PLAN_STALE = "Bu plan az önce değişti. Sayfayı yenile.";
export const APPROVED_LOCKED = "Onaylanmış bütçenin adı ve tarihleri değiştirilemez.";
export const APPROVED_NO_DELETE = "Onaylanmış bütçe silinemez.";
export const NO_CHANGE = "Hiçbir tutar değişmedi.";
export const NAME_TAKEN = "Bu adla bir bütçe zaten var.";
export const overlapError = (name: string) => `Bu tarihler ${name} bütçesiyle çakışıyor.`;
```

### 3.1 Pure helpers (`src/lib/finance/budget.ts`, isomorphic, no `server-only`)

- `monthIndex("2026-09") = 2026*12 + 8`, `addMonths(ym, k)`, `budgetRange(start) → [start-01, addMonths(start,12)-01)` (half-open plain days, like `monthRange`), `endMonth(start) = addMonths(start, 11)`.
- `overlaps(a, b) = Math.abs(monthIndex(a) - monthIndex(b)) < 12`.
- `defaultStart(today)`: always `${year}-09` of today's Istanbul year. September–December gives "the current September", and January–August gives "the coming September", which is the same calendar year. The PO wording sounds like two cases, but it is one.
- `defaultName(start)`: `-01` → `"2027"`, `-09` → `"2026–27 sezonu"` (en dash). @po: other start months aren't specified. I propose the same `YYYY–YY sezonu` form for any non-January start; @ux may prefer something else.
- `phaseOf(range, asOf)`: `asOf < from` → `future`; `asOf >= toExclusive` → `ended`; else `running`.
  - **`asOf` means "everything before this day has happened"**: today on the page, and the day after M in the email (§5).
- `elapsedPercent(range, asOf) = round(clamp(days(from, asOf), 0, total) / total × 100)`, with `days()` = the difference of `Date.UTC` plain days (no time zone involved), and `total` = 365 or 366.
- `computeReport({ plan: Map<Category, kurus>, actual: Map<Category, kurus>, range, asOf })` returns:
  - `lines[]`: the hidden ones (0/0) dropped, ordered as in `categories.ts`, income first. Each line has `{ kind, category, plan, actual, diff, pct, signal }`.
  - `totals.income`, `totals.expense` and `totals.net`, summed from **all** lines including the unplanned ones (AC 35).
  - `phase` and `elapsed`.
- Signals use integer comparisons only:
  - `near` iff `actual * 10 > plan * 9 && actual <= plan`
  - `pct = plan > 0 ? Math.round(actual * 100 / plan) : null` (kuruş × 100 stays < 2^53)
- `diffWords(kind, diff)` → `₺1.200,00 fazla` / `₺800,00 eksik` / `₺500,00 aşıldı` / `₺300,00 kaldı` / `Planla aynı`.
- `possessivePercent(n)` → see the @po note in §7.1. Without it, AC 35 and 39 print `%40'si`, which is wrong Turkish.

### 3.2 Validation

| Field | Rule | Message |
|---|---|---|
| `name` | `overwrite(cleanLine).trim().min(1).max(40)` | `Bir ad yaz.` / `Ad en fazla 40 karakter olabilir.` |
| `startMonth` | `/^\d{4}-(0[1-9]\|1[0-2])$/`, the year in 2000 … Istanbul year + 2. Safari desktop renders `type=month` as text, so the format check is real. | `Başlangıç ayı seç.` |
| `note` | `optionalText(500)` with the custom message | `Not en fazla 500 karakter olabilir.` |
| `amount.<category>` | For each of the 17 `CATEGORIES`: trimmed `""` or a `parseAmount`-zero form (`0`, `0,00`, `₺0`) → 0, else `parseAmount`. Errors go per line, `fieldErrors["amount.<category>"]`. **All 17 keys must be present.** A missing key is a crafted or broken request and is refused with `CHECK_FAILED`, never read as "set to 0", which would silently wipe a line. Unknown keys are ignored. | the existing `parseAmount` messages |
| `reason` | `overwrite(cleanLine).trim().min(5).max(200)` | `Gerekçe en az 5 karakter olmalı.` / `En fazla 200 karakter.` |
| `revision` | `z.coerce.number().int().min(0)` | missing → `PLAN_STALE` |
| `id` (bound) | `z.uuid()` | → `Kayıt bulunamadı.` |

### 3.3 `createBudget(_prev, formData)`

- **Fields:** `id` (per-mount uuid), `name`, `startMonth`, `note`.
- **Transaction:**
  1. A replay by `id` with the same creator → go to step 4.
  2. `select name from budgets where start_month > :start-12 and start_month < :start+12 limit 1` (zero-padded `YYYY-MM` compares as text). A hit → `FieldError("startMonth", overlapError(name))`.
  3. `select 1 where name = ?` → `FieldError("name", NAME_TAKEN)`. Then insert with `status = 'draft'`.
  4. Redirect to `/finans/butce/<id>/duzenle`.
- **Races:** the write transaction is `BEGIN IMMEDIATE`, so two concurrent creates serialize and the second sees the first. A UNIQUE failure on `name` is mapped to `NAME_TAKEN`; on `start_month`, or on the optional trigger (`budget_overlap` in the message), it re-reads the overlapping name for the message.

### 3.4 `updateBudget(id, _prev, formData)`: name, start and note

- **CAS** on `revision`.
- **On `approved`:** if the name or start differ from the stored values → `{ error: APPROVED_LOCKED }`, and nothing is saved, the note included. The server compares values. Hiding the inputs isn't the check (AC 29).
- **On `draft`:** the overlap and name checks of §3.3, **excluding itself** (`id <> ?`).
- **Note:** @po, I let the note change on approved budgets without a reason or history entry, because it describes assumptions, not numbers. If you want it locked, it's one more comparison.

### 3.5 `saveBudgetPlan(id, _prev, formData)`: draft edit and revision in one action

1. Parse all 17 amounts (§3.2). Any error → `fieldErrors`, nothing saved.
2. Transaction:
   - Read the budget (missing → not found).
   - Read the current lines into a Map and compute the diff (`old !== new`).
   - **Draft:**
     - no diff → success, no write
     - otherwise CAS `update budgets set revision = revision + 1, updated_* where id = ? and revision = ? and status = 'draft'`
     - zero rows → `PLAN_STALE` (this includes "it was approved meanwhile")
     - then upsert the changed lines (`on conflict (budget_id, category) do update`) and delete the lines that went to 0
     - no history (AC 31)
   - **Approved:**
     - `reason` required (§3.2)
     - no diff → `{ error: NO_CHANGE }`
     - CAS as above with `status = 'approved'` → `PLAN_STALE` on zero rows
     - then the same line writes, plus one `budget_revisions` row and one `budget_revision_lines` row per changed category, all in the same transaction
3. `setFlash("plan-kaydedildi")` and redirect to `/finans/butce/<id>` (the report).

AC 27 asks for "all lines in one write": it's one transaction, either all rows commit or none do.

### 3.6 `approveBudget(id, formData{revision})`

- `update budgets set status = 'approved', approved_by = actor, approved_at = unixepoch(), revision = revision + 1 where id = ? and status = 'draft' and revision = ?`.
- Zero rows: re-read. Missing → not found, `approved` → `{ success }` if this same actor approved it (a replay), otherwise `PLAN_STALE`.
- **The revision is part of the approval on purpose:** approving numbers you didn't see (someone saved seconds earlier) is refused.
- **Who:** any manager (D17). @po: should a plan with zero planned lines be approvable? I suggest refusing with `Onaylamak için plana en az bir tutar gir.`. Not blocking.

### 3.7 `deleteBudget(id)`

- `delete from budgets where id = ? and status = 'draft' returning id`. The lines cascade.
- Zero rows: missing → not found, approved → `APPROVED_NO_DELETE`.
- Then `setFlash("butce-silindi")` and redirect to `/finans/butce`.

### 3.8 `priorActuals(id)`: the prefill (AC 28)

- A **read-only** server action called by the editor button. It returns `{ amounts: Record<Category, string> }` (whole lira, `amountInput(ceil(k / 100) * 100)`, blank where 0), or `{ info: "Önceki 12 ayda kayıt yok." }`.
- **Authorization:** `assertManager()`. It reads `start_month` from the DB by `id` (it doesn't trust a client-sent month). Window: `[addMonths(start, -12)-01, start-01)`.
- **Writes nothing.** Rounding up: `Math.ceil(kurus / 100) * 100`, an integer.
- **Why an action, not `?doldur=1`:** a GET re-render would throw away amounts already typed in other inputs. AC 28 says it fills every input, which the client does from the returned map without a navigation.

### 3.9 Budget queries

The unguarded ones go in `queries-internal.ts`, next to `monthTotals`:

```ts
/** Unguarded: callers must authorize first. Per-category income/expense actuals in [from, toExclusive). */
export async function categoryActuals(from: string, toExclusive: string): Promise<Map<Category, number>>
  // where(and(live, inArray(fe.kind, ["income","expense"]), gte(fe.occurredOn, from), lt(fe.occurredOn, toExclusive)))
  // .groupBy(fe.category); uses fe_occurred_idx (AC 44)
/** Unguarded. Budget row + plan Map. */
export async function budgetWithPlan(id: string)
/** Unguarded. The budget whose 12 months contain `month` (at most one, by no-overlap). */
export async function budgetCovering(month: string)
  // start_month <= :month and start_month > addMonths(:month, -12)
```

The guarded ones go in `queries.ts` (each `await requireManager()` first):

- `listBudgets()`: the rows newest start first. For current and past ones it computes `categoryActuals` per budget (N is small: one per season). `current` = today's Istanbul day is in the range.
- `budgetReport(id)`: `budgetWithPlan` + `categoryActuals(range)` + `computeReport({ asOf: todayIstanbul() })` + the revision history (newest first, with lines and actor names).
- `budgetEditor(id)`: the plan, revision and status.

The page `/finans/butce/<id>` does `if (!z.uuid().safeParse(id).success) notFound()` before any query.

**AC 36 equality:** `monthlyReport(year, "total")` sums `kind = 'income'` / `'expense'` with `live`, `account in ('cash','bank')` (every row) and `occurred_on` between `Y-01-01` and `Y-12-31`. `categoryActuals("Y-01-01", "Y+1-01-01")` sums the same rows grouped by category, so the totals are equal. Two differences exist and neither changes a sum:
- `monthlyReport` drops empty leading months.
- `monthlyReport` uses `lte 12-31`, and on valid days that's the same as `lt next-01-01`.

**Actuals are not capped at today on the page.** Future-dated entries (allowed up to 31 days ahead) count, exactly as on `/finans/rapor`, so AC 36 holds on any day.

---

## 4. Budget CSV

### 4.1 Signed numbers and `csvCell`

`csvCell` (`src/lib/csv.ts:3`) prefixes any cell starting with `-` with `'`, so `Fark` `-300,00` would land in Excel as the text `'-300,00`. No existing CSV has hit this, because ledger and dues amounts are never negative. Fix, additive and without changing a byte of the other CSVs (Phase 7 AC 11 compares them byte for byte):

```ts
// src/lib/csv.ts
const NUMBER = /^-?\d{1,12},\d{2}$/;
export type CsvNumber = { csvNumber: string };
export const csvNum = (v: string): CsvNumber => ({ csvNumber: v });
// in csvCell: if (typeof value === "object" && value && NUMBER.test(value.csvNumber)) return `"${value.csvNumber}"`;
```

Only values built by `csvNum(csvAmount(k))` take this path. The strict regex can't carry a formula, so formula safety is unchanged for every string cell, and the budget name never appears in a cell anyway.

### 4.2 The builder (`src/lib/finance/csv.ts`, pure)

```ts
export const BUDGET_HEADER = ["Tür", "Kategori", "Plan", "Gerçekleşen", "Fark", "Gerçekleşme", "Durum"];
export function budgetRows(report: BudgetReport): CsvRow[]
```

- The rows: the shown income lines, `Gelir;Toplam;…`, the shown expense lines, `Gider;Toplam;…`, then `Net;Gelir − gider;planNet;actualNet;actualNet − planNet;;`.
- `Gerçekleşme` is `%120` or empty. `Durum` is the signal label, or empty on the total rows.
- The page, the route and the email all use the same `computeReport` output, so the CSV matches the DOM to the kuruş (AC 37).

### 4.3 Route `src/app/(portal)/finans/butce/[id]/csv/route.ts`

`GET` only, side-effect free:

1. `managerOrError()` → 401/403 JSON (route handlers aren't covered by layouts).
2. uuid check → 404 JSON.
3. `budgetReport(id)`.
4. `csvHeaders("arkhe-butce-<start>-<today>.csv")`, which already sets `no-store` and `nosniff`.

There's no CSRF surface: it's a GET with no side effect, the cookie is `SameSite=Lax`, and the body is a download (`Content-Disposition: attachment`) that a cross-origin page can't read.

---

## 5. Monthly email (Phase 7 change, AC 38–39)

Changes, in order of the flow in `run.ts`:

1. **`reports.ts` `buildReports(month, today, at)`** gets one more step after the existing `Promise.all`:
   ```ts
   let budget: BudgetMailPart | null = null;
   try {
     const b = await budgetCovering(month);
     if (b) {
       const range = budgetRange(b.startMonth);
       const asOf = `${nextMonth(month)}-01`;              // M is complete
       const to = asOf < range[1] ? asOf : range[1];       // actuals from start to end of M
       const report = computeReport({ plan: b.plan, actual: await categoryActuals(range[0], to), range, asOf });
       budget = { name: b.name, status: b.status, report, csv: csvDocument(BUDGET_HEADER, budgetRows(report)) };
     }
   } catch (e) {
     console.error("budget attachment skipped", describeError(e, []));
   }
   ```
   - `budget` is added to the return value. **Best effort:** a budget bug must never cost the choir its monthly encrypted backup.
   - Everything else in `buildReports` stays as it is.
2. **`email.ts`**:
   - add `budgetAttachmentName(month) = "arkhe-butce-${month}.csv"`
   - add an optional `budget?: { name; status; incomePct: number | null; expensePct: number | null; filename }` input to `monthlyEmail`
   - when it is absent, the `lines` array is identical to today
   - when it is present, insert right after the `Gelir: …` line: `Bütçe (${name}, ${status === "approved" ? "Onaylandı" : "Taslak"}): gelir hedefin ${possessivePercent(x)}, gider planın ${possessivePercent(y)}.` (for `null`, see §7.1)
   - `AttachmentNames` is unchanged, so the `/yedek` page and its tests don't move
3. **`run.ts`**: if `reports.budget`, push `csv(budgetAttachmentName(month), reports.budget.csv)` **before** the encrypted backup and before the `size` reduce. The 18 MB guard counts it automatically (AC 38).
4. **The subject is unchanged.**

**Phase 7 tests that must stay green**, checked against `e2e/phase7-a-cron.mjs`:
- The attachment counts are asserted only for January 2025 (`:369`) and January 2024 (`:462`). The seeded budgets start 2025-09 and 2026-09, so neither month is covered, and both stay at 5 attachments.
- The 2026-09/10/11 runs (`:201`–`:285`) assert only status, run rows and `.eml` counts, so a 6th attachment doesn't break them.
- AC 8 checks that lines are **included** (`:347`), not the exact body.
- AC 17 (`phase7-b-page.mjs:445`) checks the subject and the manual paragraph.

So nothing in Phase 7 breaks as long as the subject and the existing lines stay byte-identical.

**AC 38's "equal a page render with today pinned to the end of M":** the email uses `asOf` = the 1st of M+1 and caps actuals there. The page uses today, uncapped. They agree only when nothing is dated after M inside the range. The test must arrange that, or compare against `computeReport` fed the same `asOf`. See §7.4.

---

## 6. Threats and mitigations

| Threat | Where | Mitigation |
|---|---|---|
| Member reaches board or budget data | pages, actions, the CSV route, home, layout | `requireManager()` on pages and queries; `assertManager()` first in every action; `managerOrError()` in the route; the home card and badge return `null` or 0 for non-managers before any ticket query (§2.9). AC 1/24 e2e compares row counts before and after the forged calls. |
| Privilege escalation: board deletes the conductor's ticket | `deleteTicket` | The rule is in the SQL `where` (§2.5); the role is read fresh per request. |
| Deleting others' comments, or after 15 minutes | `deleteComment` | Author, kind and age in one `delete … where` on the DB clock (§2.7). |
| IDOR through bound args | every bound action | Bound args are client-controlled, not encrypted: zod-parse every one. All tickets and budgets are shared by all managers by design, so the only object-level rules are delete and comment-delete, both enforced in SQL. `markTicketSeen` writes only the caller's row. |
| Forged creator or approver | create, approve | `created_by`, `approved_by`, `actor_id` and `updated_by` always come from the session. |
| Assigning to a member, an inactive user or a made-up id | create, update | Eligibility checked in the transaction on change (§2.2–2.3), plus the FK. The unchanged-assignee exception only keeps the stored value. |
| Lost updates | edit, move, plan, approve | CAS on `revision` or `status = from`; system entries and history rows are written only when the CAS hit. |
| Overlapping budgets in a race | create, update | `BEGIN IMMEDIATE` write transaction + check, unique `start_month`, optional trigger. |
| Replay or double submit | create ticket, comment, budget | A unique `client_key`/`id` per mount; a replay by the same actor returns the existing row. Approve and delete are naturally idempotent (status-guarded). |
| CSRF | actions | Next's Origin/Host check on Server Actions (`server-actions.md`). No mutating route handler is added. The CSV GET has no side effect. Cookies are `SameSite=Lax`. |
| Stored XSS | titles, descriptions, comments, budget name and note, the email body | Stored as cleaned plain text, rendered as React text nodes (`whitespace-pre-wrap`), never `dangerouslySetInnerHTML`, no linkify, no markdown (AC 21). The email is `text/plain`. The CSP nonce (Phase 6) is a second layer. |
| CSV formula injection | the budget CSV | `csvCell` for every string; numbers only through the strict `csvNum` path (§4.1). |
| Flash text injection | `#12 açıldı.` | A param-typed flash with a strict regex (§2.10). |
| Prefetch marks tickets seen | detail page | Seen is a mount-time action, never a render-time write (§2.8). |
| Input size or DB growth | all text | zod max lengths (≤ 4000 per field) under Next's 1 MB action body cap; DB CHECKs as the backstop; comment and create rate limits; 17 fixed plan keys (unknown keys ignored). |
| Time zone | due dates, overdue, the archive, the 15 minutes, budget ranges, elapsed, the default start, the `Şu anki` budget | Plain Istanbul days (`istanbulDateOf(now())`) for every business day; epoch seconds for durations (the 30 days, the 15 minutes), both sides on the DB clock; day arithmetic through `Date.UTC` plain-day helpers (`addDays`), never `setHours`. The email's month M comes from `schedule.ts` (Istanbul). |
| Unbounded reads | the archive, the thread | The archive is paged (50, `sayfa` ≤ 10 000). A thread with 2000 comments on one ticket is acceptable at our scale (AC 44 measures it). If it gets slow: the last 200 plus `Daha eski`. |

---

## 7. Replies

### @po

1. **The Turkish suffix after a percentage is not fixed.** It follows how the number is read: `%40'ı`, `%50'si`, `%30'u`, `%100'ü`, `%3'ü`, `%6'sı`. AC 35 (`Dönemin %<p>'si geçti`) and AC 39 (`hedefin %<x>'i`, `planın %<y>'si`) hard-code one form, which is wrong for most values. I'll add `possessivePercent(n)` in `budget.ts`: the last non-zero digit decides (1 'i, 2 'si, 3 'ü, 4 'ü, 5 'i, 6 'sı, 7 'si, 8 'i, 9 'u). For a round number, the magnitude decides: 10 'u, 20 'si, 30 'u, 40 'ı, 50 'si, 60 'ı, 70 'i, 80 'i, 90 'ı, 100 'ü, 1000 'i, 0 'ı. The e2e should then assert per value, not a fixed `'si`. When a plan total is 0, I propose `gelir hedefi yok` / `gider planı yok` instead of a percentage.
2. **AC 37 `Fark` = `-300,00` collides with `csvCell`'s formula guard**, which would make it `'-300,00`. The fix is in §4.1. Please keep the AC as written; it'll pass with that fix.
3. **AC 24 says "403 or a redirect" for a logged-out CSV request.** The existing pattern (`managerOrError`, used by `/finans/rapor/csv`) answers **401** JSON for logged-out and 403 for korist@. Please accept 401 or 403 with no CSV body, rather than adding a special case.
4. **AC 38 equality with the page:** see §5. The email reports "as of the end of M". The page reports "as of today", including future-dated entries. I suggest wording the e2e as: "the CSV values equal `computeReport` for the same budget with `asOf` = the 1st of M+1, and the test arranges no entries after M in the range".
5. **AC 39 "one line":** the `Ekler:` list names every attachment today. A sixth file that isn't listed will confuse recipients. I propose also adding `- arkhe-butce-<M>.csv: bütçe planı ve gerçekleşen` to `Ekler:` when it's attached. With no budget, the body is still byte-identical to Phase 7, so the Phase 7 tests are unaffected.
6. **AC 14 "the number is never reused":** that requires the counter table of §1.1. `AUTOINCREMENT` alone breaks after a backup restore, which Phase 7 made a real procedure.
7. **D7 and my own actions:** I implement "my action never marks it new" by advancing my own seen marker when I act. A side effect: if sef@ commented and yk@ then moves the card from the board without opening it, the dot clears for yk@. I think that's right ("you touched it, you saw it"). Tell me if not.
8. **Moves update `Son değişiklik`** (§2.4). Also, comment deletion doesn't trigger `Yeni` (§2.7). Please confirm both.
9. **Open product points** (not blocking):
   - the default name for non-September/January starts (§3.1)
   - whether the note stays editable after approval (§3.4)
   - refusing to approve an empty plan (§3.6)
   - the new rate-limit copy `Çok fazla deneme. Biraz sonra yeniden dene.` (§2.2/2.6)
10. **D12's default start** is always September of the current Istanbul year (§3.1). That matches your rule; the e2e should pin the date.
11. **AC 35 elapsed:** p = days strictly before today / total days. On the first day it's `%0`, and on the last day `%100`, rounded. Say if you want today counted.

### @dba

- Please treat §1 as a proposal. The points I need whatever the names are:
  - an integer `activity_rev` on tickets and `seen_rev` per (ticket, user)
  - a separate `revision` for field edits
  - a total order on thread entries (an integer pk)
  - unique `client_key` on tickets and comments
  - a counter row for ticket numbers (not `sqlite_sequence`)
  - `(status = 'done') = (done_at is not null)`
  - 0-kuruş plan lines stored as no row
  - unique `budgets.start_month` and `name`
  - the revision lines with old/new kuruş
- Indexes I rely on: `tickets(status, done_at)`, `tickets(assignee_id, status)`, `ticket_entries(ticket_number, kind)`, the `ticket_reads` pk, and the existing `fe_occurred_idx` for every budget actual (AC 44 `EXPLAIN QUERY PLAN`).
- The overlap trigger is optional. If you add it, use the message `budget_overlap`, so `guarded` can map it.

### @ux / @ui

- The detail page needs a small client component that calls `markTicketSeen(number, activityRev)` once on mount (§2.8). The board's card links use `prefetch={false}`.
- Forms carry hidden `clientKey`/`id` (a uuid per mount) and `revision`. Remount the comment form after each success so the key changes.
- The editor posts all 17 `amount.<category>` fields every time, even when blank.
- Show `Sil` on comments using `canDeleteComment(actor, entry, nowSeconds)` from `permissions.ts`. The server is the real check.
