# Phase 15 — DB (migration 0019)

@po: implemented "Shared: migration 0019" as written, with one deviation in item 6 (deletion queue, §3).

Migration: `drizzle/0019_phase15_sections_reports.sql`. No table rebuilds: four `ALTER TABLE … ADD COLUMN`, three new tables, three triggers, two data updates. Column CHECKs are hand-written in the SQL; `schema.ts` carries no table check for them (a table check would make drizzle-kit rebuild `users` / `piece_audio` / `assignment_parts`). `npm run db:generate` after the hand edits reports "No schema changes".

## 1. New columns

| Column | Type | Meaning |
|---|---|---|
| `users.voice_section` | integer null, CHECK `in (1, 2)` | Sub-part: Bas 1 / Bas 2. Null = not chosen ("Bilmiyorum"). TS type `VoiceSection` (`VOICE_SECTIONS = [1, 2]`). |
| `users.handles_reports` | integer (boolean) not null default 0, CHECK `in (0, 1)` | Sees `/sorunlar`, gets the "Yeni sorun bildirimi" push. Set by SQL only. 0019 sets it for prod user `513103a7-…`; seed sets it for `yk@arkhe.local`. |
| `piece_audio.section` | integer null, CHECK `in (1, 2)` | Null = whole part (or Tutti when `voice_part` is null). Backfilled from labels (§2). |
| `assignment_parts.section` | integer null, CHECK `in (1, 2)` | Null = whole part (today's meaning). PK stays `(assignment_id, voice_part)`: one row per part, whole or one section. |

App rules for the builders (not DB checks, an ADD COLUMN check can't safely see other columns):
- **A section is only kept while `voice_part` is set.** Any write that changes or clears `users.voice_part` must write `voice_section = null` in the same statement (member form, import, profile). `db:check` fails on `voice_section is not null and voice_part is null`.
- `piece_audio.section` only with a `voice_part`; a Tutti row (`voice_part` null) always has `section` null. The upload/edit action must null it when the part is cleared.
- `assignment_parts.section` is set per part chip; changing a part's chip to "whole" writes null.
- Eligibility SQL everywhere: `ap.voice_part = u.voice_part and (ap.section is null or ap.section = u.voice_section)`. Null-safe on purpose: a user with null section never equals 1/2, so they are not eligible for section-only homework.
- No new indexes for sections: `assignment_parts_voice_idx (voice_part, assignment_id)` and `piece_audio_piece_idx (piece_id, voice_part)` already narrow to a handful of rows; the section test is a residual filter.

## 2. Backfill of `piece_audio.section`

Per part, the label must name that part: `label LIKE '<Part> <n>' OR label LIKE '<Part> <n> %'` with `soprano→Soprano, alto→Alto, tenor→Tenor, bass→Bas`, n = 1 or 2, only where `voice_part` is not null. Verified on a scratch DB against the real prod labels: all of `Alto 1`, `Alto 1 + Eşlik`, `Alto 1 - Tek`, `Alto 2(+ Eşlik / - Tek)`, `Bas 1`, `Bas 2`, `Soprano 1/2`, `Tenor 1`, `Tenor 1 - Piyano`, `Tenor 1 - Ses`, `Tenor 2` get their section; `Bas - Hızlı`, `Bas + Eşlik`, `Alto - Piyano`, `Toplu - Yavaş`, `Solo`, null stay null; also `Bas 10` and a label naming another part (`alto` row labelled `Bas 1`) stay null. A prod row labelled e.g. `Alto 1` but stored with `voice_part` null is not backfilled (by design: section needs a part).

## 3. Report images and the deletion queue (decision)

`storage_deletions` can't take report keys without a rebuild: besides `area in ('recording','midi','score')`, its `storage_deletions_key_check` ties every area to a key shape (`recordings/<uuid>.<audio>`, `midi/<uuid>.mid`, `scores/<uuid>.pdf`). Reusing an existing area (what piece_audio did) would mean storing screenshots as `recordings/<uuid>.webm`, which breaks the spec's `reports/<uuid>.<jpg|png|webp>` keys and the content-type/extension checks. A rebuild (as 0014 did) was ruled out for this phase.

So: a sibling queue **`report_image_deletions`**, same columns and semantics as `storage_deletions` minus `area` (`storage_key` pk with the `reports/` key check, `size_bytes` 1–2 000 000, `state`, `requested_at`, `not_before`, `attempts`, `last_attempt_at`, `last_error`, `done_at`, same CHECKs, same pending/done partial indexes).

Triggers (all checked by `db:check`, listed in `e2e/phase11-a-score.mjs` TRIGGERS):
- `issue_report_images_queue_on_delete` AFTER DELETE → `insert into report_image_deletions (storage_key, size_bytes)`. Fires on a direct delete, on the 90-day retention delete, and on the cascade from `issue_reports`.
- `issue_report_images_max` BEFORE INSERT → ABORT `issue_report_images_max` when the report already has 3 images (the app checks first; this closes the parallel-upload race).
- `issue_report_images_key_final` BEFORE UPDATE OF storage_key, size_bytes → ABORT (a changed key would orphan the old blob).

What the backend must do with it (`src/lib/storage/`):
- **Hold/put protocol** like other uploads: before the put insert a hold row into `report_image_deletions` (`not_before = now + 1 h`) and a `storage_events` put row; the transaction that inserts the `issue_report_images` row deletes the hold row. `storage_events.area` can't take `'report'` either: write puts with `area = null` (area is ignored for puts) and gets of report images with `area = 'score'` (the "non-recording delivery" bucket: counts toward transfer/reads, never toward the recording playback stop; `null` would be read as a recording).
- **Drain**: `drainKeys`/`drainQueue`/`releaseKey`/`releasePutFailure` must also work on `report_image_deletions` (e.g. pick the table by `key.startsWith("reports/")`; the sweep drains both queues).
- **Prune** in `sweep.ts`: also `delete from report_image_deletions where state = 'done' and done_at < now - 30 d`.
- **Quota** (`quota.ts` `usage()`): add `sum(size_bytes) from issue_report_images` and `sum(size_bytes) from report_image_deletions where state = 'pending'` to `storedBytes`.
- **Retention** (cron sweep): `delete from issue_report_images where report_id in (select id from issue_reports where closed_at is not null and closed_at <= now - 90 d)`; the trigger queues the keys. No index on `closed_at`: the table stays tiny.
- **e2e resets** that wipe `storage_deletions` (`e2e/lib.mjs` ~190 and suites that do it themselves) should also wipe `report_image_deletions` when they touch report images.

## 4. `issue_reports` / `issue_report_images`

`issue_reports`: `id` uuid (checked), `number` integer unique ≥1, `reporter_id` → users **restrict**, `title` stored trimmed (`title = trim(title)`, 3–120), `body` 1–4000 (trimmed length ≥1), `status` `ISSUE_STATUSES` default `new`, `reply` null or 1–2000, `page` null or 1–300, `device` null or 1–300, `created_at`, `updated_at` (default now; the app sets it on every change), `closed_at` with `(status in ('done','wontfix')) = (closed_at is not null)` (`ISSUE_CLOSED_STATUSES`). Indexes: unique `number` (also serves `max(number)`), `(reporter_id, created_at)` for "Bildirimlerim", `(status, created_at)` for the handler filters and the open-count badge (`status in ('new','in_progress')`). No time-order checks: DB and app clocks differ (same as storage_deletions).
- Numbering: in the insert transaction `coalesce(max(number), 0) + 1`; on a unique violation retry once. Reports are never deleted, so numbers never get reused.
- Status change: closing sets `closed_at = now`; reopening (done → in_progress) sets it back to null, which restarts the 90-day clock.
- Hidden from other roles: every read filters `reporter_id = session user` unless `handles_reports = 1` read fresh from the DB (not a role check).

`issue_report_images`: `id` uuid (use it in `/api/dosya/sorun/[id]`), `report_id` → issue_reports **cascade**, `storage_key` unique, CHECK `reports/<uuid>.<ext>` with ext matching `content_type` (`image/jpeg→jpg`, `image/png→png`, `image/webp→webp`, `ISSUE_IMAGE_EXTENSIONS`), `size_bytes` 1–`ISSUE_IMAGE_MAX_BYTES` (2 000 000), `created_at`. Index `(report_id, created_at)` for the detail page and the cascade. Authorize the image route with one join: `image → report → reporter_id = me or (select handles_reports from users where id = me)`.

## 5. Things the builders must not miss

- `src/lib/import/undo.ts` "referenced" list of restrict FKs to users: add `or exists (select 1 from issue_reports ir where ir.reporter_id = "users"."id")`, otherwise undoing an import whose new member already filed a report fails on the FK instead of being refused cleanly.
- Every user write that touches `voice_part` must also write `voice_section` (§1).
- Backups/restore pick new tables and triggers up automatically (`src/lib/backup/dump.ts` reads `sqlite_master`).
- Seed: `yk@arkhe.local` handles reports; sections set for Elif Yıldız (S1), Zeynep Kaya (S2), Can Erdoğan (T1), Ozan Yılmaz (B1), Mert Doğan (B2); `korist@arkhe.local` stays null so the home prompt shows. The current local DB got the same values by hand after `db:migrate`.

## Migration of existing data

All additive. Existing users, audio and assignment parts read as "no section / whole part", so behaviour is unchanged until someone picks a section; the only data change is the label backfill (§2) and the one prod handler flag. Rollback is not needed for prod safety: the new columns are nullable/defaulted and unused by the old code.
