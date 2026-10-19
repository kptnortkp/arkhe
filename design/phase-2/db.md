# Phase 2: database design (DBA)

Author: arkhe-dba. Inputs: `design/phase-2/po-spec.md`, `design/phase-1/review-db.md`, `src/db/schema.ts`. At the time of writing, no `ux.md` / `ui.md` / `backend.md` exists in this folder. I'll reply to them in `review-db.md` or a follow-up here.

## 0. Ground rules for this schema

- **Timestamps** are `integer(…, { mode: "timestamp" })`: UTC epoch seconds, as in Phase 1. **Calendar dates** (term start/end) are `text` `'YYYY-MM-DD'` and mean Europe/Istanbul days. The backend turns a term into the half-open range `[start 00:00 TRT, end+1 00:00 TRT)` before querying. A date isn't an instant, and storing it as one invites off-by-one-day bugs.
- **Enums are enforced in the DB** with `CHECK`s, not only in TS (review-db P2-1). Inside `check()` I write column names literally (`sql\`role in (…)\``) rather than `${t.role}`, so the generated DDL doesn't depend on how drizzle-kit qualifies column refs.
- **History is never cascade-deleted with a user.** Users leave by deactivation (`is_active = false`, `left_at`); every FK from history to `users` is `restrict` (subject) or `set null` (actor).
- **Migrations:** there is no production data, so the tech lead's P1-1 baseline (`drizzle-kit generate` → `drizzle/0000_*.sql`) is generated **after** these schema changes. That gives one clean `0000` with the final Phase 2 schema, the local DB is rebuilt with `db:migrate` + `seed`, and no table-rebuild migration is needed. If `0000` is already generated before this lands, then `0001` rebuilds `users`/`attendance`/`rehearsals`. Hand-wrap that file in `PRAGMA foreign_keys=OFF; … PRAGMA foreign_key_check; PRAGMA foreign_keys=ON;` (see review-db P1-1).

## 1. Schema (replaces the relevant parts of `src/db/schema.ts`)

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ROLES = ["conductor", "board", "member"] as const;
export const VOICE_PARTS = ["soprano", "alto", "tenor", "bass"] as const;
export const REHEARSAL_TYPES = ["tutti", "sectional", "dress", "concert"] as const;
export const ATTENDANCE_STATUSES = ["present", "late", "excused", "absent"] as const;
export const CHECK_IN_METHODS = ["qr", "code", "manual", "self", "auto"] as const;
export const FILE_KINDS = ["midi", "score", "recording", "other"] as const;
export const TOKEN_PURPOSES = ["invite", "reset"] as const;

export type RehearsalType = (typeof REHEARSAL_TYPES)[number];
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

/** `'a', 'b', …` for CHECK constraints; values are our own constants, never user input. */
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

const now = sql`(unixepoch())`;
```

### 1.1 `users` (Phase 1 fixes folded in, plus membership period)

```ts
export const users = sqliteTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(), // index name stays users_email_unique
    phone: text("phone"),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    voicePart: text("voice_part", { enum: VOICE_PARTS }),
    passwordHash: text("password_hash"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    // Membership period; drives who is expected at past rehearsals.
    joinedAt: integer("joined_at", { mode: "timestamp" }).notNull().default(now),
    leftAt: integer("left_at", { mode: "timestamp" }),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  () => [
    check("users_role_check", sql`role in (${inList(ROLES)})`),
    check("users_voice_part_check", sql`voice_part is null or voice_part in (${inList(VOICE_PARTS)})`),
    check("users_email_lower_check", sql`email = lower(email)`),
    check("users_left_matches_active", sql`(is_active = 1) = (left_at is null)`),
    check("users_left_after_joined", sql`left_at is null or left_at >= joined_at`),
  ],
);
```

- `joined_at` vs the PO's `users.createdAt`: `created_at` is when the *row* was made (often when the invite went out, sometimes weeks before the first rehearsal, which is PO open question 6). `joined_at` defaults to the same moment but is a separate field a manager can correct on the member form (`Koroya katılış tarihi`). Because we keep it, open question 6 no longer applies.
- `left_at` is required by the `is_active` CHECK. `setMemberActive(false)` sets `{ isActive: false, leftAt: new Date() }` and reactivation sets `{ isActive: true, leftAt: null }` in the same `UPDATE`. A gap between leaving and rejoining therefore counts as "expected" after reactivation. That's rare and acceptable; a `memberships` table would fix it, and I'm deliberately not building one.
- Roles are current, not historical. A board member who was a plain member last term is fine (both are on rosters). A conductor is never on a roster.

### 1.2 `terms`

```ts
export const terms = sqliteTable(
  "terms",
  {
    id: id(),
    name: text("name").notNull().unique(), // "2026–27 Güz"
    startsOn: text("starts_on").notNull(), // 'YYYY-MM-DD', Europe/Istanbul
    endsOn: text("ends_on").notNull(), // inclusive
    createdAt: createdAt(),
  },
  (t) => [
    check("terms_dates_format", sql`starts_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and ends_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`),
    check("terms_dates_order", sql`ends_on >= starts_on`),
    check("terms_name_length", sql`length(name) between 1 and 40`),
    index("terms_starts_idx").on(t.startsOn),
  ],
);
```

Terms don't reference rehearsals. A rehearsal belongs to whatever term's date range contains it, so editing a term's dates needs no data migration. **Overlap** can't be expressed as a CHECK; the backend rejects a term whose range overlaps an existing one (`where starts_on <= :end and ends_on >= :start and id <> :id`). Without that rule, "the term containing today" would be ambiguous.

### 1.3 `rehearsals`

```ts
export const rehearsals = sqliteTable(
  "rehearsals",
  {
    id: id(),
    type: text("type", { enum: REHEARSAL_TYPES }).notNull().default("tutti"),
    // Null means the UI derives it from type and parts.
    title: text("title"),
    location: text("location"),
    note: text("note"), // shown to the choir, e.g. "Requiem nota getirin"
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    // Shared by all occurrences created together by "Her hafta tekrarla"; no series table.
    seriesId: text("series_id"),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    openedAt: integer("opened_at", { mode: "timestamp" }),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    // HMAC key for the rotating code; regenerated on every open; managers only.
    codeSecret: text("code_secret").notNull().$defaultFn(randomSecret),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    check("rehearsals_type_check", sql`type in (${inList(REHEARSAL_TYPES)})`),
    check("rehearsals_time_order", sql`ends_at > starts_at`),
    check("rehearsals_closed_after_open", sql`closed_at is null or (opened_at is not null and closed_at >= opened_at)`),
    check("rehearsals_cancelled_not_open", sql`cancelled_at is null or opened_at is null`),
    check("rehearsals_title_length", sql`title is null or length(title) <= 80`),
    check("rehearsals_note_length", sql`note is null or length(note) <= 500`),
    index("rehearsals_starts_idx").on(t.startsAt),
    index("rehearsals_series_idx").on(t.seriesId, t.startsAt),
  ],
);
```

Notes:
- `codeSecret` uses Web Crypto, not a UUID and not `node:crypto`, because `schema.ts` is imported by `src/lib/validation.ts`, which client forms use. Define it next to `id()`: `const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");` **Regenerate it in the same `UPDATE` that sets `opened_at`.** The secret then reaches manager browsers only for the session that's live, and a secret seen last week is useless (@backend).
- `rehearsals_cancelled_not_open`: an occurrence that was opened (attendance taken) can't be cancelled. Cancel happens before the rehearsal; once records exist, correct the records instead. A cancelled occurrence can't be opened either.
- "Close" on a past rehearsal that was never opened: the backend sets `opened_at = coalesce(opened_at, :now), closed_at = :now` in one update, which satisfies `closed_after_open`.
- `endsAt` defaults are app-side (start + 2.5 h); the CHECK only guarantees order.
- Series generation: compute each occurrence's wall-clock time in `Europe/Istanbul` (`Intl`/`Temporal`-free arithmetic is fine; Türkiye has had no DST since 2016, but don't hard-code +3; derive the offset), and insert all rows in **one** multi-row `insert` inside the same transaction as their `rehearsal_parts` rows. That's at most 27 rehearsals × 4 parts.

### 1.4 `rehearsal_parts` (target parts of a sectional)

```ts
export const rehearsalParts = sqliteTable(
  "rehearsal_parts",
  {
    rehearsalId: text("rehearsal_id")
      .notNull()
      .references(() => rehearsals.id, { onDelete: "cascade" }),
    voicePart: text("voice_part", { enum: VOICE_PARTS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.rehearsalId, t.voicePart] }),
    check("rehearsal_parts_voice_check", sql`voice_part in (${inList(VOICE_PARTS)})`),
  ],
);
```

**Rule:** rows exist **only for `type = 'sectional'`** (≥1 row). Every other type means all parts, and a member without a voice part is expected only at those, which matches spec §2. I picked a join table over a JSON/CSV column so the roster is a plain SQL join and a CHECK guards each value. A cross-table rule ("sectional ⇒ ≥1 part, others ⇒ 0") can't be a CHECK; the backend writes rehearsal and parts in one transaction and validates with zod. When a sectional is edited to tutti, delete its parts in the same transaction.

### 1.5 `attendance`

```ts
export const attendance = sqliteTable(
  "attendance",
  {
    rehearsalId: text("rehearsal_id")
      .notNull()
      .references(() => rehearsals.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ATTENDANCE_STATUSES }).notNull(),
    method: text("method", { enum: CHECK_IN_METHODS }).notNull(),
    // Excuse reason; visible to managers and the member only.
    note: text("note"),
    // Last write wins: who and when.
    recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull().default(now),
    recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
    // Set when a manager changes the row after the rehearsal was closed ("Düzeltildi").
    correctedAt: integer("corrected_at", { mode: "timestamp" }),
  },
  (t) => [
    primaryKey({ columns: [t.rehearsalId, t.userId] }),
    index("attendance_user_idx").on(t.userId, t.rehearsalId),
    check("attendance_status_check", sql`status in (${inList(ATTENDANCE_STATUSES)})`),
    check("attendance_method_check", sql`method in (${inList(CHECK_IN_METHODS)})`),
    check("attendance_self_is_excuse", sql`method <> 'self' or status = 'excused'`),
    check("attendance_auto_is_absent", sql`method <> 'auto' or status = 'absent'`),
    check("attendance_checkin_attended", sql`method not in ('qr', 'code') or status in ('present', 'late')`),
    check("attendance_note_length", sql`note is null or length(note) <= 200`),
  ],
);
```

- **`method` is now NOT NULL.** Every row is written by one of the five paths.
- **"Corrected flag" = `corrected_at`.** It's set when a write happens while `rehearsals.closed_at is not null` and is never cleared. The UI shows `Düzeltildi · <first name of recorded_by>`: after close only managers can write, so `recorded_by` is the corrector. A timestamp instead of a boolean costs nothing and answers "when". I'm not adding an audit log in this phase (YAGNI; the PO hasn't asked for one).
- **Unmarking** ("tap the selected value again") **deletes the row**. "Unmarked" = no row, which keeps the report's `left join … is null` logic honest.
- **`user_id … restrict`**: a user with history can't be hard-deleted; deactivate instead. Phase 1 has no delete path, so nothing breaks.
- Writes, for @backend:
  - Self check-in: one upsert with a guard. The guard and the write go in one transaction: read the rehearsal by PK and check `opened_at is not null and closed_at is null and cancelled_at is null`, then
    ```ts
    tx.insert(attendance)
      .values({ rehearsalId, userId, status, method, recordedBy: userId })
      .onConflictDoUpdate({
        target: [attendance.rehearsalId, attendance.userId],
        set: { status, method, note: null, recordedAt: new Date(), recordedBy: userId },
      });
    ```
    This overwrites an earlier `excused` (spec 3.5) and clears its reason.
  - Manual mark: the same upsert with `method: "manual"`, `recordedBy: manager`, plus `correctedAt: closedAt ? new Date() : undefined` in `set`/`values`.
  - Bulk `Kalanları geldi işaretle`: a single `INSERT … SELECT` over the roster for that part, `ON CONFLICT DO NOTHING`, so already-marked people stay untouched (AC 18).
  - Close: in one transaction, update `closed_at` and then `INSERT INTO attendance (…, status, method) SELECT …roster…, 'absent', 'auto' … ON CONFLICT DO NOTHING`. The confirm count comes from the same roster query (`count(*) … where a.user_id is null`).
  - Advance excuse: an upsert with `status 'excused', method 'self', note`. Allowed only if `starts_at > now`, the rehearsal isn't cancelled and the user is on the roster. Withdraw = `DELETE … where method = 'self' and starts_at > now`, so a manager's later mark can't be withdrawn by the member.

### 1.6 Check-in code rate limit: reuse `login_attempts`

No new table. `login_attempts` is already a generic `(key, attempted_at)` log with the right index.
- Key: `checkin:<rehearsalId>:<userId>`. Record **wrong** codes only.
- Before verifying the code, count rows with that key and `attempted_at > now − 5 min`. If the count is ≥ 5, reject even a correct code (AC 9). This is the same pattern as `isLoginBlocked`, so extract a shared `isRateLimited(key, max, windowMs)` / `recordAttempt(key)`.
- The existing cleanup (`attempted_at < now − 15 min`, run on each failed login) also covers these rows, since 15 min > 5 min. Run the same cleanup on a failed check-in too.
- Optional rename to `rate_limit_attempts`: not worth a table rebuild. The comment on `key` in the schema gets the new format.

### 1.7 Unchanged or small Phase 1 fixes in the same migration

- `invites`: `check("invites_purpose_check", sql\`purpose in (…TOKEN_PURPOSES)\`)` and `index("invites_user_idx").on(t.userId)` (review-db P3-4).
- `sessions`, `login_attempts`: unchanged.
- `pieces`, `piece_files`: only `check("piece_files_kind_check", …)` and `check("piece_files_voice_check", "voice_part is null or …")`. The rest is Phase 3's business.
- `FILE_KINDS` and the piece tables are otherwise untouched.

## 2. Index ↔ query map

| Screen / action | Query shape | Index used |
|---|---|---|
| Home hero, upcoming list (`/calismalar`) | `rehearsals where starts_at >= :dayStart order by starts_at limit N` | `rehearsals_starts_idx` |
| History tab, reports, member summary | `rehearsals where starts_at between :from and :to` | `rehearsals_starts_idx` |
| `Seriyi bitir` | `rehearsals where series_id = ? and starts_at > ?` | `rehearsals_series_idx` |
| Live screen poll, roster, close | `attendance where rehearsal_id = ?` | PK `(rehearsal_id, user_id)` |
| My status on a rehearsal | `attendance where rehearsal_id = ? and user_id = ?` | PK |
| My history, member detail | `attendance where user_id = ? [and rehearsal_id in …]` | `attendance_user_idx (user_id, rehearsal_id)` |
| Sectional parts | `rehearsal_parts where rehearsal_id = ?` | PK |
| Check-in rate limit | `login_attempts where key = ? and attempted_at > ?` | `login_attempts_key_idx` |
| Current term | `terms where starts_on <= :today and ends_on >= :today` | `terms_starts_idx` (tiny table) |
| Roster (`users`) | full scan of ~60 rows | none needed |

## 3. The roster and report queries (one query each, no N+1)

Roster of one rehearsal: the people expected, with their mark. "Listede olmayanlar" is the attendance rows whose user isn't in this set.

```sql
select u.id, u.name, u.voice_part, a.status, a.method, a.note, a.corrected_at, a.recorded_by
from rehearsals r
join users u
  on u.role in ('member', 'board')
 and u.joined_at <= r.starts_at
 and (u.left_at is null or u.left_at > r.starts_at)
 and (r.type <> 'sectional'
      or u.voice_part in (select p.voice_part from rehearsal_parts p where p.rehearsal_id = r.id))
left join attendance a on a.rehearsal_id = r.id and a.user_id = u.id
where r.id = :id
```

Put this in **one** helper (`src/lib/attendance/roster.ts`, Drizzle `sql` template), used by the live screen, close, bulk mark, the excuse permission and reports, so "who is expected" is defined exactly once.

Reports: return **rows, not aggregates**, and aggregate in TS. At most ~60 people × ~40 rehearsals per term ≈ 2,400 rows, which is trivial. Percent, late/excused/absent counts and the "2 of the last 4" rule then come out of one pass, and the CSV, the table and the member's own view share the code.

```sql
with counted as (
  select r.id, r.type, r.starts_at
  from rehearsals r
  where r.cancelled_at is null
    and r.starts_at >= :from and r.starts_at < :to
    and r.starts_at < :now
    and (r.closed_at is not null
         or exists (select 1 from attendance a where a.rehearsal_id = r.id))
),
expected as (
  select c.id as rehearsal_id, c.starts_at, u.id as user_id
  from counted c
  join users u
    on u.role in ('member', 'board')
   and u.joined_at <= c.starts_at
   and (u.left_at is null or u.left_at > c.starts_at)
   and (c.type <> 'sectional'
        or u.voice_part in (select p.voice_part from rehearsal_parts p where p.rehearsal_id = c.id))
)
select e.user_id, e.rehearsal_id, e.starts_at, a.status
from expected e
left join attendance a on a.rehearsal_id = e.rehearsal_id and a.user_id = e.user_id
union
-- Non-roster people who came count for that rehearsal (spec 3.5).
select a.user_id, a.rehearsal_id, c.starts_at, a.status
from attendance a join counted c on c.id = a.rehearsal_id
where a.status in ('present', 'late')
order by 1, 3 desc
```

For a single member's own view, add `and user_id = :me` to both branches (managers-only reports must never be the data source for member pages; see §5).

## 4. Seed (for @backend / e2e)

`scripts/seed.ts` additions, all relative to "now" so the e2e can reset and rerun:
- Term `Demo dönem` from `today − 70 days` to `today + 60 days`.
- A weekly tutti series (Tuesday 19:30 TRT, `Mülkiye Konferans Salonu`) from `today − 63 days` to `today + 28 days`: 8 past occurrences, all closed with varied statuses (per-person table in the seed file as a comment, so AC 23 can compare exact numbers), one past occurrence `cancelled_at` set, and one past occurrence never opened and with no rows (`Yoklama alınmadı`, AC 21).
- One flagged member (2 × `absent` in the last 4 counted) and one with only `excused` misses (not flagged, AC 25).
- One upcoming sectional (tenor + bass), one upcoming concert.
- `joined_at` for demo users = `today − 120 days`, so all of them are expected for the whole series.

## 5. Data exposure rules (for @backend)

- `rehearsals.code_secret` is **never** selected by a query that serves a member. Select explicit columns everywhere, never `db.select().from(rehearsals)` (or `findFirst` without `columns`) on member paths. Expose it only from the manager live-screen loader.
- `attendance.note` (excuse reason): members may read only `where user_id = :me`. Managers read all.
- A member's history and percentage come from the §3 query with `user_id = :me`, not by filtering the managers' result in a component.

## 6. Replies and open questions

**@po (Q7, polling read cost on Turso):** Fine, with two constraints. Turso's free plan meters *rows read* per month (the allowance is in the hundreds of millions; check the current figure at go-live). Costs:
- **Live screen poll** = session lookup (2 rows) + rehearsal by PK (1) + roster query (~60 users + ~60 attendance rows + ≤4 parts) ≈ 130 rows. Every 5 s for 2.5 h is 1,800 polls ≈ **235k rows per rehearsal**.
- **Member phones should not poll.** A member's status only changes through their own action, which returns the new state. If @ux wants the hero to flip from `YOKLAMA AÇIK` to closed on its own, poll every 30 s with a PK-only query (≈5 rows): 50 phones × 300 polls × 5 ≈ 75k per rehearsal.
- Per month with ~10 rehearsals (weekly tutti + sectionals) that's **≈ 3M rows**, around 1% of the free allowance even if it is the lower figure. Constraints: (1) poll only while `opened_at` is set, `closed_at` is null and `document.visibilityState === "visible"`; (2) the poll endpoint reads by PK/index as in §2, never a full `attendance` scan. Writes (≈60 per rehearsal) are negligible.

**@po (Q6, members joining mid-term):** solved with `users.joined_at`, which managers can edit. Please add `Koroya katılış tarihi` to the member form (default: today) to the Phase 2 scope. It's one field and makes AC 23 correct for new joiners.

**@po (§3.2, `Seriyi bitir` vs advance excuses):** "deletes later occurrences that have no attendance records". Future occurrences will often have `excused` rows from members, so these would survive and confuse everyone. Proposal: delete every occurrence of the series with `starts_at > now` regardless of rows (their excuse rows cascade away; they were about a rehearsal that no longer exists), and keep all past ones. AC 4 stays true.

**@po (§3.4, unmarked people in an un-closed past rehearsal that has some records):** the formula puts them in the denominator, so they count against the percentage but not as `absent` in the warning. Proposal: treat "unmarked on a counted rehearsal" as **absent in both**, the same as what closing would have done, and show those rehearsals on `/raporlar` with an `Yoklama kapatılmadı` hint so a manager closes them. Otherwise percentages and warnings disagree.

**@po (Q3, concerts and dress rehearsals):** no data impact. All types weigh 1. `type` is stored, so a weighting rule later is a query change only.

**@po (Q5, board on roster):** reflected: the roster is `role in ('member','board')`.

**@backend:** the HMAC code needs no DB state beyond `code_secret` + `opened_at`. Derive the time step from `floor(unixNow / 30)` server-side, and accept steps `n` and `n−1` (AC 10). Regenerate `code_secret` in the same update that sets `opened_at`. Rate limit as in §1.6. All multi-statement writes (series create, close, bulk mark, check-in guard + upsert) go in `db.transaction`.

**@ux / @ui:** no data constraints on your side beyond the field limits: title ≤ 80, note ≤ 500, excuse reason ≤ 200, term name ≤ 40. Mirror them in zod and in the input `maxLength`.
