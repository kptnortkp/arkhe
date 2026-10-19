# Phase 4: database design (DBA)

Author: arkhe-dba. Inputs: `po-spec.md` (§3, §6, §7), `src/db/schema.ts`, `drizzle/0000–0002`, `scripts/seed.ts`, `e2e/lib.mjs`, `src/lib/attendance/roster.ts`, Phase 2/3 `db.md` + `review-db.md`. No `ux.md`/`ui.md`/`backend.md` yet; replies go in `review-db.md`. DDL, upserts and the badge query plan were tried on a scratch SQLite 3.51 DB.

@po: §6 accepted with these changes: (1) a `submissions` row must carry a submission or feedback, so undo/clear **delete** an empty row; (2) `marked_by` only with `method = 'manual'`; (3) `app_settings.value` is NOT NULL, and clearing the email deletes the row; (4) index `(piece_id, due_at)` instead of `piece_id` alone; (5) seeded homework gets fixed ids so e2e can re-anchor it to "now" (§6). Open Q1: I agree, a singer's undo deletes a manual mark too. That's one rule and one statement.

## 0. Rules carried over
- Timestamps: `integer(…, { mode: "timestamp" })`, UTC epoch seconds. The app writes `createdAt`/`submittedAt`/`feedbackAt` from the JS clock (`now()` in `src/lib/time.ts`), the same clock as `users.joined_at`, so `joined_at <= created_at` compares like with like. `due_at` is entered as Istanbul date + time and converted with `istanbulToUtc(date, time)`. Display uses `Intl` tr-TR, Europe/Istanbul. Late = `submitted_at > due_at`, computed, never stored.
- Enums are enforced by CHECK via `inList`. Fixed write lists go in `db.batch`. Use `db.transaction()` (`BEGIN IMMEDIATE`) only when a read decides the write.
- History is never cascade-deleted with a user. The subject FK is `restrict`, actor FKs are `set null` (Phase 2 rule). The app never hard-deletes users; only e2e cleanup does (§5).

## 1. Schema (`src/db/schema.ts`)
```ts
export const SUBMISSION_METHODS = ["self", "manual"] as const;
export const SETTING_KEYS = ["recording_email"] as const;
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];
export type SettingKey = (typeof SETTING_KEYS)[number];

export const assignments = sqliteTable("assignments", {
  id: id(),
  pieceId: text("piece_id").notNull().references(() => pieces.id, { onDelete: "restrict" }),
  barFrom: integer("bar_from"),
  barTo: integer("bar_to"),
  description: text("description"),
  dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  // Also the "given at" moment: only members who joined by then are expected.
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now).$onUpdateFn(() => new Date()),
}, (t) => [
  check("assignments_bars_pair", sql`(bar_from is null) = (bar_to is null)`),
  check("assignments_bars_range", sql`bar_from is null or (bar_from between 1 and 9999 and bar_to between bar_from and 9999)`),
  check("assignments_description_length", sql`description is null or length(trim(description)) between 1 and 1000`),
  index("assignments_due_idx").on(t.dueAt),
  // Piece detail "open homework" + the FK lookup when a piece is deleted.
  index("assignments_piece_due_idx").on(t.pieceId, t.dueAt),
]);

// Always ≥ 1 row per assignment (enforced in the action; written in the same batch).
export const assignmentParts = sqliteTable("assignment_parts", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  voicePart: text("voice_part", { enum: VOICE_PARTS }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.assignmentId, t.voicePart] }),
  check("assignment_parts_voice_check", sql`voice_part in (${inList(VOICE_PARTS)})`),
]);

// One row per (assignment, singer): a submission, a feedback note, or both.
export const submissions = sqliteTable("submissions", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  submittedAt: integer("submitted_at", { mode: "timestamp" }),
  method: text("method", { enum: SUBMISSION_METHODS }),
  markedBy: text("marked_by").references(() => users.id, { onDelete: "set null" }),
  // Private: only this singer and managers may read it.
  feedback: text("feedback"),
  feedbackBy: text("feedback_by").references(() => users.id, { onDelete: "set null" }),
  feedbackAt: integer("feedback_at", { mode: "timestamp" }),
  feedbackSeenAt: integer("feedback_seen_at", { mode: "timestamp" }),
}, (t) => [
  primaryKey({ columns: [t.assignmentId, t.userId] }),
  index("submissions_user_idx").on(t.userId, t.assignmentId),
  check("submissions_method_check", sql`method is null or method in (${inList(SUBMISSION_METHODS)})`),
  check("submissions_method_matches", sql`(submitted_at is null) = (method is null)`),
  check("submissions_marked_by_manual", sql`marked_by is null or method = 'manual'`),
  check("submissions_feedback_at_matches", sql`(feedback is null) = (feedback_at is null)`),
  check("submissions_feedback_meta", sql`feedback is not null or (feedback_by is null and feedback_seen_at is null)`),
  check("submissions_feedback_length", sql`feedback is null or length(trim(feedback)) between 1 and 1000`),
  check("submissions_not_empty", sql`submitted_at is not null or feedback is not null`),
]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key", { enum: SETTING_KEYS }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
}, () => [
  check("app_settings_key_check", sql`key in (${inList(SETTING_KEYS)})`),
  check("app_settings_value_length", sql`length(value) between 1 and 2000`),
  check("app_settings_recording_email", sql`key <> 'recording_email' or (value = lower(trim(value)) and length(value) <= 254 and value like '%_@_%._%')`),
]);
```
Notes:
- **On delete:** `assignments.piece_id` is `restrict`. `submissions.user_id` is `restrict` (it's history). Every `*_by` is `set null`, so `submissions_marked_by_manual` and `submissions_feedback_meta` stay valid after the set null. `assignment_parts` and `submissions` cascade from the assignment. Assignment delete is a **hard delete**: the spec says it can't be undone and there is no archive. No `deleted_at` anywhere.
- **Indexes, justified:** `assignments_due_idx` serves the Güncel/Geçmiş range, the badge and the matrix's last 8. `assignments_piece_due_idx` serves the piece detail's `piece_id = ? and due_at >= ?`, and without it the restrict check on piece delete would scan the table. The `assignment_parts` PK `(assignment_id, voice_part)` covers both the "parts of" lookup and the "is my part in it" lookup. The `submissions` PK covers `assignment_id in (…)` (matrix, counts). `submissions_user_idx` serves "my submissions" (list, home). Plan checked: the badge query is a SEARCH on all three tables, with no scan.
- **Bars and parts:** a single bar is `bar_from = bar_to`. Integers come from zod; SQLite would store `'12'` as an integer anyway. The rule "≥ 1 part" can't be a CHECK, so create and edit write the assignment and its parts in one `db.batch`.
- **Email CHECK** is a backstop only. Zod does the real validation (`Geçerli bir e-posta adresi gir.`). Clearing the email = `delete from app_settings where key = 'recording_email'`. Setting it is an upsert on `key`.

## 2. Who is eligible / expected (one helper, `src/lib/homework/roster.ts`)
Pure functions next to Phase 2's `isExpected`, fed by one users query (`loadRosterUsers()` plus `isActive`):
```ts
isEligible(u, a) = u.isActive && (u.role === "member" || u.role === "board")
                   && u.voicePart !== null && a.parts.includes(u.voicePart)
isExpected(u, a) = isEligible(u, a) && u.joinedAt <= a.createdAt
```
- **Left members:** `is_active = 0`, so they're neither eligible nor expected, for past and open homework alike (spec §3.4). We don't use the Phase 2 `left_at > starts_at` window, because the spec hides left non-submitters everywhere.
- **Joined later:** eligible, can submit, never expected, never red (spec §3.4).
- **Voice part changes:** the current `users.voice_part` decides. Submissions are never touched by a part change.
- **Assignment edits:** adding a part on edit makes that part's existing members expected (`created_at` doesn't move). Removing a part doesn't delete submissions.
- **Matrix rows / denominator** = `expected ∪ {users with submitted_at not null}`, grouped by the user's **current** part (null part → a `Partisyonsuz` group, with an `Ayrıldı` tag when inactive). Numerator = rows with `submitted_at`. A feedback-only row of a user who isn't expected doesn't show in the matrix (the row stays in the DB).
- **Cell state** (JS, server `now`): submitted → `submitted_at <= due_at` ? on time : late. Not submitted and expected → `due_at < now` ? `Gecikti` : `Bekleniyor`. Not expected and not submitted → blank (eligible-but-new users get no red).

## 3. Queries (all server-side, no per-row queries)
`window = now − 7 days`. Güncel = `due_at >= window`, Geçmiş = `due_at < window`.
1. **Badge** (layout, members/board with a part only; conductor or no part → 0 with no query):
   ```sql
   select count(*) from assignments a
   join assignment_parts ap on ap.assignment_id = a.id and ap.voice_part = :myPart
   left join submissions s on s.assignment_id = a.id and s.user_id = :me
   where a.due_at >= :window and a.created_at >= :myJoinedAt and s.submitted_at is null
   ```
   Wrap it in React `cache()` so the home card and the layout share it.
2. **Member list:** one query: `assignments` join `pieces` (title) join `assignment_parts` on my part, left join `submissions s` on `(a.id, :me)`, selecting `s.submitted_at`, `s.method`, and `hasNewNote = s.feedback is not null and (s.feedback_seen_at is null or s.feedback_seen_at < s.feedback_at)`. **Not** the feedback text. Part chips come from a correlated `(select group_concat(voice_part) from assignment_parts where assignment_id = a.id)`. Sort in JS (unsubmitted first, then `due_at`). Home `Ödevlerim` = the same rows, filtered to unsubmitted and expected-or-eligible, first by `due_at`.
3. **Manager list / home card:** (a) assignments in the window + piece title + parts (`group_concat`); (b) `select assignment_id, user_id, submitted_at from submissions where assignment_id in (…ids) and submitted_at is not null`; (c) the roster users. `{n}/{m}` and `S 5/8 …` are computed in JS with §2. That's 3 queries for any row count.
4. **Detail:** `getAssignment(id)` in React `cache()` (Phase 3 P3-1): assignment + piece + parts (`db.batch` of 2). Member: `mySubmission` = `select … from submissions s left join users fb on fb.id = s.feedback_by where s.assignment_id = ? and s.user_id = :me`. Managers additionally: all submissions of the assignment (with feedback, `markedBy` name and `feedbackBy` name via aliases) + roster users = 2 more queries. Mark seen when the singer opens it: `update submissions set feedback_seen_at = :now where assignment_id = ? and user_id = :me and feedback is not null and (feedback_seen_at is null or feedback_seen_at < feedback_at)`.
5. **Matrix `/odevler/matris`:** (a) `select … from assignments join pieces order by due_at desc limit 8` (shown ascending); (b) parts `where assignment_id in (…)`; (c) `select assignment_id, user_id, submitted_at, method from submissions where assignment_id in (…)` (**no feedback column**); (d) roster users. Rows = union of the expected users across the 8 + submitters.
6. **Piece detail line:** `select id, bar_from, bar_to, due_at from assignments where piece_id = ? and due_at >= :window order by due_at`.
7. **Delete confirm count:** `select count(*) from submissions where assignment_id = ? and submitted_at is not null`.

**Leak rule:** member code paths only ever read `submissions` with `user_id = :me`. The functions that read other people's rows (`submissionsOf(assignmentIds)`, with feedback) live in `src/lib/homework/manager.ts` and take the session user, return null unless `isManager`. The matrix and counts never select `feedback`. Members never receive `{n}/{m}`, `marked_by`, or other users' rows.

## 4. Writes (single statements; libSQL serialises writers)
- **Create:** `db.batch([insert assignments (id = randomUUID(), createdAt = now(), createdBy), insert assignment_parts …])`. **Edit:** `db.batch([update assignments …, delete from assignment_parts where assignment_id = ?, insert parts …])`. **Delete:** `delete from assignments where id = ?` (cascade), `returning id` for not-found.
- **Self submit** (eligibility checked from the session user + parts read first; a race with a part change is harmless):
  `insert into submissions (assignment_id, user_id, submitted_at, method) values (?, :me, :now, 'self') on conflict do update set submitted_at = excluded.submitted_at, method = 'self', marked_by = null where submissions.submitted_at is null`. A double tap is a no-op. A feedback-only row gains the submission.
- **Self undo:** `delete from submissions where assignment_id = ? and user_id = :me and feedback is null returning 1`. If 0 rows and a row exists → `Şef geri bildirim yazdı; teslimi geri alamazsın.` It also removes manual marks (Q1).
- **Manager mark on:** the same upsert with `method = 'manual', marked_by = :manager`. **Mark off:** `db.batch([update submissions set submitted_at = null, method = null, marked_by = null where … and feedback is not null, delete from submissions where … and feedback is null])`. The target must be eligible or already have a row (checked in the action).
- **Feedback set:** `insert … (feedback, feedback_by, feedback_at) values (…) on conflict do update set feedback = excluded.feedback, feedback_by = excluded.feedback_by, feedback_at = excluded.feedback_at`. A later edit bumps `feedback_at`, which makes `Yeni not` show again. **Clear:** `db.batch([update … set feedback = null, feedback_by = null, feedback_at = null, feedback_seen_at = null, delete … where submitted_at is null and feedback is null])`.
- **`deletePiece`:** already runs links + piece in one `db.transaction`, so the FK failure rolls back the link delete. Map `SQLITE_CONSTRAINT_FOREIGNKEY` / `FOREIGN KEY constraint failed` (found on `cause`) to `Bu esere bağlı ödevler var. Silmek yerine arşivle.`. `restrict` on `assignments` is the only FK that can fire there. Better still, pre-check `select 1 from assignments where piece_id = ? limit 1` and keep the mapping as a backstop.

## 5. Migration
- Number it after the PO/tech lead's label fix. If `0003` (`piece_links` label CHECK → 120) lands first, this one is **`0004_phase4_homework`** (`npx drizzle-kit generate --name phase4_homework`). Otherwise `0003_phase4_homework`. Don't merge the two: the label fix rebuilds `piece_links`, and this one only adds tables.
- Pure additive: four `CREATE TABLE`s + 3 indexes. There's no table rebuild and no data to migrate. Existing pieces/users are untouched. Then the tech lead runs `npm run db:migrate` (backup + `db:check`). Check that the generated SQL has all 14 named CHECKs and the `ON DELETE restrict` on `piece_id`.
- The setting row is not inserted by the migration (prod gets it from the board via the UI). The seed inserts it.
- **e2e cleanup order (`e2e/lib.mjs`):** before `delete from pieces where title like 'E2E%'`, run `delete from assignments where piece_id in (select id from pieces where title like 'E2E%')`. Before deleting `%@e2e.test` users, run `delete from submissions where user_id in (…)`. Otherwise the restrict FKs fail the cleanup. Also restore `app_settings` to `kayit@arkhe.local` (AC12/AC20 change it).

## 6. Seed (relative to seed time `T`)
Put the fixture in **`scripts/homework-fixture.mjs`** (plain JS, raw SQL on a libSQL client, keyed by email): `seedHomework(client, T)` deletes `assignments where id like 'seed-hw-%'` (cascade) and reinserts. `seed.ts` calls it, and so does e2e `cleanup()` with `T = new Date()`. That way the badges in AC3 (`5 gün`, `5 saat`) don't drift between a seed done days ago and a test run. Offsets carry a buffer so the floor/ceil text holds for at least 1 h. All rows are inserted in one `client.batch`. Setting: upsert `recording_email = kayit@arkhe.local`.

| id | piece · bars | parts | created_at | due_at | korist@ (alto) | state |
|---|---|---|---|---|---|---|
| seed-hw-a | Ave Verum Corpus · 12–34 | SATB | T−2d | T+5d+12h | pending | green `5 gün kaldı` |
| seed-hw-b | Aman Gülüm · Tüm eser | S, A | T−1d | T+2d+12h | pending | amber `2 gün kaldı` |
| seed-hw-c | Bogoroditse Devo · 1–16 | SATB | T−1d | T+5h | pending | red `5 saat kaldı` |
| seed-hw-d | Sicut Cervus · Tüm eser | SATB | T−9d | T−2d−12h | missing | red `Gecikti · 2 gün` |
| seed-hw-e | Hallelujah · 1–24 | S, A | T−17d | T−10d | submitted T−11d + feedback | Geçmiş, `Yeni not` |
| seed-hw-f | Sicut Cervus · 25–40 | T, B | T−1d | T+4d+12h | not eligible | — |

Each assignment has a 1–2 line `description`, and `created_by` = sef. **New joiner:** add login account `yeni@arkhe.local` ("Arda Tan", member, tenor, password set, `joined_at = T − 1h`): after D/E/F were given and after yesterday's rehearsal started, so Phase 2 reports don't change (he's expected at no past rehearsal). The members list and tenor count grow by 1, so the tech lead should check that no Phase 1–3 e2e asserts a fixed member count. Expected for SATB homework given before T−1h: S 7 (6 + yk), A 6, T 4, B 5 = 22.

Submissions (`self` unless noted, on-time times = `due − 1d`):
- **A:** yk@ → `1/22` (S 1/7). **B:** elif.yildiz@ → `1/13` (S 1/7, A 0/6). Yeni (tenor) is not eligible. **C:** none, `0/22`. **F:** can.erdogan@ → `1/9` (T 1/4, B 0/5). Yeni is eligible but not expected.
- **D:** on time: yk@, elif.yildiz@, zeynep.kaya@, defne.arslan@, ayse.ozturk@, melis.aydin@, can.erdogan@, emre.aksoy@, ozan.yilmaz@, mert.dogan@, burak.kilic@. **Late:** nazli.koc@ at T−1d. **Manual on time:** kaan.ozdemir@ (`marked_by` sef, at `due − 2h`). **Feedback only:** ceren.polat@ `Kaydın gelmedi, cumartesiye kadar gönderebilirsin.` (the leak test: never in korist's HTML). Missing: ece.demir, selin.celik, irem.sahin, korist, buse.kurt, ceren.polat, baris.gunes, deniz.aslan, onur.cetin. **Counts: S 4/7 · A 3/6 · T 3/4 · B 3/5 = 13/22.** After AC7 (korist late): A 4/6, 14/22. Yeni is not listed (AC11).
- **E:** korist@ at T−11d, feedback by sef at T−9d `Girişler çok iyi, 20. ölçüde nefesi erken alıyorsun.`, `feedback_seen_at` null; plus yk@, ayse.ozturk@ → `3/13` (S 1/7, A 2/6). Undo for korist is rejected (AC8).
- **Badge for korist@** = A, B, C, D = **4**. Badge for yeni@ = 0 (not expected anywhere). The matrix shows 6 columns (F, A, B, C, D, E ordered by due).
- The doc comment at the top of `seed.ts` repeats the counts above. A left member who submitted (`Ayrıldı`) isn't seeded, because deactivating a seeded user would change the Phase 2 report numbers. e2e can create one under `@e2e.test`.
