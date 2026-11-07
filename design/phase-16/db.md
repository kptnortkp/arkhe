# Phase 16 — DB (migration 0020)

Migration: `drizzle/0020_phase16_announcements.sql`. Three new tables, no change to existing tables, no `UPDATE` (so no `-- deploy: reviewed` header). `npm run db:generate` after it reports "No schema changes".

## Tables

`announcements`: `id` uuid (checked), `title` stored trimmed, 3–80 characters, `body` 1–1000 (trimmed length ≥ 1), `audience` in `all | parts | board`, `important` 0/1, `created_by` → users **restrict**, `created_at`, `updated_at` (the app sets it on edit), `show_until` Istanbul day `YYYY-MM-DD` (glob + `date(x) is x`), `deleted_at` null = live (soft delete).
- Indexes: `(created_at) where deleted_at is null` for the list and home queries; `(created_by)` for the restrict FK check when a user row is deleted.
- `show_until` has no DB default: the app writes today + 7 (Istanbul) and enforces today … today + 60. An edit may keep a stored day that is already past.

`announcement_parts` (`announcement_id` → announcements cascade, `voice_part` checked), pk both. Only for `audience = 'parts'`, whole parts, 1–4 rows. `db:check` fails when a `parts` announcement has no rows or another audience has some.

`announcement_reads` (`announcement_id` → cascade, `user_id` → users cascade, `read_at`), pk both, index `(user_id, announcement_id)` for the home card's "not read by me". The sender gets a read row at creation, so their own announcement never shows on their home card.

## Audience rule (queries in `src/lib/announcements/queries.ts`)

- Viewer filter: managers see every live announcement; a member sees `all`, and `parts` when their `voice_part` is listed.
- Recipients and "Okuyan X/Y": active users (`is_active = 1 and left_at is null`) addressed by the announcement, the sender excluded on both sides.

## Other touch points

- `src/lib/import/undo.ts`: `announcements.created_by` added to the restrict-reference list.
- `e2e/lib.mjs` cleanup deletes E2E announcements and those sent by `@e2e.test` users before the users go.
- Backups pick the tables up automatically (`sqlite_master`).
