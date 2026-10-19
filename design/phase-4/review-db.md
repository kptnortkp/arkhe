# Phase 4: database review (DBA)

Author: arkhe-dba. Reviewed against `db.md` and `po-decisions.md` (wins), plus `implementation-notes.md`. Everything was checked on scratch copies of `data/arkhe.db`. The live DB was opened read-only (`.backup`) and never written.

## Verified

| Check | Result |
|---|---|
| Schema vs snapshot | `drizzle-kit generate` against a copy of `drizzle/` reports "No schema changes". `src/db/schema.ts`, `0004_phase4_homework.sql` and `0004_snapshot.json` agree. |
| Migration on a pre-phase-4 DB | I took a copy of the live DB, dropped the 4 new tables and the 0004 journal row, then ran `drizzle-kit migrate` with the real `drizzle/`. It applied cleanly: 14 named CHECKs, `piece_id ON DELETE restrict`, cascades from `assignments`, `set null` on every `*_by`. `integrity_check` ok, `foreign_key_check` empty. Purely additive, so existing data is untouched. |
| Fixture | Running `seedHomework(client, now)` twice on the migrated copy is idempotent: 6 assignments, 18 parts, 20 submissions, one `yeni@`, one setting. Everything goes in one `client.batch(…, "write")`. UUID-shaped ids are fine, and the `LIKE` prefix can't match a `randomUUID()`. |
| CHECK safety of writes | I replayed the action SQL on the copy: a self submit on a feedback-only row (Ceren on D) becomes `self` with `marked_by` null. A manager mark-on over a submitted row is a no-op (`setWhere`). Mark-off with feedback keeps a valid feedback-only row. A note on a row that doesn't exist inserts a feedback-only row. Clearing the note on a feedback-only row deletes it. Undo deletes only when `feedback is null`. Every path satisfies `submissions_not_empty`, `method_matches`, `marked_by_manual`, `feedback_meta`. `setRecordingEmail`: anything `RECORDING_EMAIL_RE` accepts also passes the `app_settings_recording_email` CHECK (ASCII-only, lowercased, has a dot). |
| Transactions | Drizzle's libsql `transaction()` calls `client.transaction()` with the default mode `"write"`, i.e. `BEGIN IMMEDIATE` (sqlite3 and http clients). So `deletePiece` (read, then write), `createAssignment` (`onConflictDoNothing` + creator check) and `updateAssignment` (version-guarded update, then part replace) are atomic and serialised. `db.batch` for mark-off and note-clear is atomic. |
| `deletePiece` | Pre-check `select … where piece_id = ? limit 1` inside the IMMEDIATE transaction. It uses `assignments_piece_due_idx`. The FK message is matched along `cause` as a backstop, and links survive (AC21). Live copy: `delete from pieces where title='Sicut Cervus'` fails on the FK as designed. |
| Query plans (`ANALYZE`d copy) | Badge: SEARCH `assignments_due_idx` + COVERING `assignment_parts_voice_idx` + PK probe on `submissions`, with no scan. `listForSinger`: due index + pieces PK + `submissions_user_idx`. `partsOf`/`submittedKeys`/`rosterFor`: PK prefix. Matrix: index-order scan with LIMIT 8. Piece line: `(piece_id, due_at)`. `countHomework`: covering. The extra `assignment_parts(voice_part, assignment_id)` is used, so keep it. |
| N+1 | None. Every list costs a fixed number of queries: manager list 4, singer list 2, matrix 4, detail ≤ 5. They run in parallel where independent, and the badge is `cache()`d per user. |
| Privacy | `feedback` text is selected only in `mySubmission` (own row: `user_id = session`) and `rosterFor`, which only runs inside `if (manager)` on the detail page. `listForSinger` exposes only the `hasNewNote` boolean. The matrix and counts never select `feedback`. `/odevler/matris` is behind `requireManager`. The singer actions take the user from the session, so there's no userId parameter to tamper with. The manager actions call `assertManager` first, so AC10 holds. |
| e2e cleanup order | `submissions` → `assignment_parts` → `assignments` (E2E piece or `E2E…` description) → `piece_links` → `pieces` → `attendance`/`submissions` of `@e2e.test` → `users` → `seedHomework(now)`. No restrict FK can fire. AC13's homework (`E2E yeni ödev`) is caught by the description rule. |

## Findings

No P1. No P2.

### P3
- **P3-1** `src/app/(portal)/odevler/actions.ts:202-211` `deleteAssignment` always returns `Ödev silindi.`, even for an unknown id. D25 wants `Ödev bulunamadı.`. It also runs 3 unconditional deletes in an interactive transaction, even though the cascades already do the work. Fix: `db.delete(assignments).where(eq(assignments.id, id)).returning({ id })`, and if the result is empty return NOT_FOUND.
- **P3-2** `actions.ts:187` The edit version is `updated_at` in whole seconds. Two saves in the same second both pass (a lost update), and a double-tap on `Kaydet` returns STALE for the second request even though the first succeeded. That's acceptable at choir scale. If it ever matters, switch to an integer `version` column (`version = version + 1`).
- **P3-3** `src/lib/homework/queries.ts:276,333` `rosterFor`/`homeworkMatrix` read other users' rows but don't check the role themselves. `db.md` §3 asked for them to take the session user and return null for non-managers. Today every caller is guarded (`if (manager)`, `requireManager`). Fix (defence in depth): pass the user in and return `null`/empty unless `isManager`.
- **P3-4** `src/db/schema.ts` The `length(trim(x))` CHECKs on `description`/`feedback` only strip spaces in SQLite, so a backstop write of `char(10)` passes. The app is safe because zod trims all whitespace. If raw-SQL writers appear, use `trim(x, ' ' || char(9,10,13))`.
- **P3-5** `queries.ts:109,192` The `Geçmiş` list is unbounded (about 50 rows a year), so it's fine for years. Add `limit`/paging when it passes ~200.
- **P3-6** `odevler/[id]/page.tsx:136` `submissionCount` is a fourth query whose answer is already in `rosterFor`'s rows (`submitted_at is not null`). Derive it there. The delete dialog on `duzenle` can keep the query.
- **P3-7** The actor FKs (`submissions.marked_by`, `feedback_by`, `assignments.created_by`, `app_settings.updated_by`) have no index, so deleting a user scans these tables. Only e2e cleanup deletes users (Phase 2 rule), and the tables are small, so no index is needed.

## Replies
- @backend: the upserts (`setWhere: isNull(submitted_at)`), the mark-off/note-clear batches and the IMMEDIATE transactions are correct as written. Only P3-1 touches your code.
- @tech lead: the deviation from `db.md` (UUID-shaped seed ids, explicit child deletes in the fixture and cleanup) is fine. The migration is safe to run on Turso with `db:backup && db:migrate && db:check`.
