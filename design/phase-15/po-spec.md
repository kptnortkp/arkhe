# Phase 15 spec: sub-parts (Bas 1 / Bas 2) and in-app issue reports

Author: PO (main session). Date: 2026-11-07. Status: **build**.

User request (2026-11-07):
- "galiba bas1- bas2 diye ayırmamışız, diğer gruplar da öyle. Bir özellik geliştirelim ve herkes kendinin 1 mi 2 mi olduğunu girebilsin."
- "bir sorun bildirme ekranı yapalım uygulamadaki sorunları bu linkten koristler girebilsin. Girildiğinde mert temize task olarak açılsın. içine ss de ekleyebilsinler isterlerse"

User decisions (asked 2026-11-07):
- Who sets the sub-part: **the singer (Profil) and managers (member edit)**.
- Where it is used: **the right rehearsal audio plays** and **homework can target a sub-part**. (Not chosen: member-list display/filter. Showing it on the member's own edit page and badge is fine.)
- Who sees issue reports: **only the handler (Mert Temiz) and the reporter.** Not the shared board kanban.

Process: fast loop. One DBA step (schema + one migration), then two builders in parallel (A: sub-parts, B: issue reports), one combined reviewer, one full `npm run e2e`. Commit and push only on the user's explicit go.

## Shared: migration 0019 (DBA step, before builders start)

All new columns are added with `ALTER TABLE … ADD COLUMN` (no table rebuilds). Column CHECKs are written by hand in the SQL (drizzle can't express column checks; table-level checks in `schema.ts` would make drizzle-kit rebuild the table). Comment that in `schema.ts` next to each column.

1. `users.voice_section integer` null. SQL check: `voice_section is null or voice_section in (1, 2)`. App rule (not a DB check, since an ALTER column check can't see other columns safely): a section is only kept while `voice_part` is set; changing or clearing `voice_part` clears `voice_section`.
2. `piece_audio.section integer` null, check `section is null or section in (1, 2)`. Backfill in the migration from the label when it names the same part with 1 or 2 at a word boundary, e.g. `Bas 1`, `Bas 2`, `Alto 1 + Eşlik`, `Alto 2 - Tek`, `Tenor 1 - Piyano`, `Soprano 2` (labels: Soprano, Alto, Tenor, Bas). Not `Bas - Hızlı`. Use SQL `CASE` with `like` patterns on `voice_part`-matching prefixes (`'Bas 1'`, `'Bas 1 %'` etc.).
3. `assignment_parts.section integer` null, check `section is null or section in (1, 2)`. Null = the whole part (today's meaning). The primary key stays `(assignment_id, voice_part)`: one row per part, either whole or one section.
4. `users.handles_reports integer not null default 0` (boolean). Migration sets it to 1 for prod user `513103a7-f9b8-4ea0-a064-bf59aa4900b3` (Mert Temiz) with `UPDATE … WHERE id = …` (no-op elsewhere). Seed (`scripts/seed.ts`) marks one local board user.
5. New table `issue_reports`: `id` uuid pk, `number` integer unique ≥1 (Sorun #12), `reporter_id` → users (restrict), `title` 3–120 trimmed, `body` 1–4000, `status` in `new | in_progress | done | wontfix`, `reply` ≤2000 null, `page` ≤300 null (path the reporter came from), `device` ≤300 null (UA summary + standalone flag + build id), `created_at`, `updated_at`, `closed_at` null (`(status in ('done','wontfix')) = (closed_at is not null)`), index on `(reporter_id, created_at)` and `(status, created_at)`.
6. New table `issue_report_images`: `id` uuid pk, `report_id` → issue_reports (cascade), `storage_key` unique (`reports/<uuid>.<jpg|png|webp>`), `content_type` in `image/jpeg | image/png | image/webp`, `size_bytes` 1–2 000 000, `created_at`. At most 3 per report (app rule). Deleting a row must queue its blob for deletion through the existing `storage_deletions` mechanism (follow `piece_audio_queue_on_delete`; if `storage_deletions.area` has a CHECK that can't take a new value without a rebuild, reuse an existing area and document why).

Run: `npm run db:generate` (or hand-written SQL + snapshot via drizzle-kit), `db:migrate`, `db:check`, `db:reset` locally. Update any e2e that asserts the migration count.

## A. Sub-parts ("alt partisyon")

Labels: `Soprano 1`, `Alto 2`, `Tenor 1`, `Bas 2`; a helper `partLabel(part, section)` in `src/lib/labels.ts`.

- **Profil:** a control "Alt partisyonun" with `1`, `2`, `Bilmiyorum` (null), shown only when the user has a voice part. Server action authorizes the session user, validates with zod, ignores it without a voice part.
- **Home prompt:** a small card on the home page while `voice_part` is set and `voice_section` is null: "Alt partisyonunu seç: Bas 1 mi Bas 2 mi?" with the two buttons inline (one tap saves) and a link to Profil. Not for the conductor.
- **Managers:** the member form (`/uyeler/[id]`, `/uyeler/yeni`) gets the same field; clearing/changing the voice part clears it. Member CSV/Excel import: no change.
- **Badge:** where the user's own `VoicePartBadge` shows (header chip, profil), show `Bas 2` when set.
- **Rehearsal audio upload/edit (managers):** a select "Alt partisyon: Tümü / 1 / 2" next to the part (only when a part is chosen). Stored in `piece_audio.section`.
- **Which audio is "mine":** wherever the app picks the singer's part audio (piece hero audio, homework "Partisyonumu aç", the play-along `Partisyon` button, repertoire "Partisyonum" play, `audio counts as Partisyonum` logic from 01abf3d), order: same part and same section → same part and section null → same part, other section (fallback, so a Bas 2 still hears something if only Bas 1 exists) → existing fallbacks (MIDI). With section null on the user: section null first, then section 1, then 2. In the piece audio list, rows of the user's own section sort first.
- **Homework targeting:** in the assignment form, each part chip can be narrowed: whole part (default) / `1` / `2`. Stored in `assignment_parts.section`. Eligibility everywhere (`isEligible`/`isExpected` in `src/lib/homework/eligibility.ts` and every SQL that joins `assignment_parts` — `src/lib/homework/queries.ts`, `recordings.ts`, `src/lib/review/queries.ts`, `src/lib/push/morning.ts`, `src/lib/push/triggers.ts`, `src/app/(portal)/odevler/actions.ts`): part matches **and** (`ap.section is null` or `ap.section = u.voice_section`). A singer with no section is **not** eligible for a section-only homework; the form shows a note under the chips: "Tenor'da 3 kişi alt partisyon seçmemiş; bu ödevi görmeyecekler." (count of active singers of that part with null section). Homework cards/detail show `Tenor 1` instead of `Tenor` when narrowed. Editing an assignment's sections follows the same rules the current part editing does.
- Attendance, rehearsals, reports: unchanged.
- e2e: new suite `e2e/phase15-a-sections.mjs` (profile save + home prompt, manager edit + clear on part change, audio pick per section incl. fallback, section-only homework visible to Bas 1 not Bas 2 nor unset, the form note count, push audience for the narrowed homework). Existing suites that touch assignments/audio must stay green.

## B. Issue reports ("Sorun bildir")

- **Link:** `/sorun-bildir`, behind login like every portal page (shareable as `portal.koroarkhe.com/sorun-bildir`). Entry points: Profil page row "Sorun bildir", the desktop sidebar footer, and the `Kayıt şu an açılamıyor…` style error messages may stay as they are (no link needed).
- **Form (everyone signed in):** `Başlık` (3–120), `Ne oldu?` (1–4000, placeholder "Ne yapmaya çalışıyordun, ne oldu?"), `Ekran görüntüsü (isteğe bağlı, en fazla 3)`. Images are resized in the browser to max 1600 px on the long side and re-encoded as JPEG ≈0.8 (keep PNG only if re-encode fails); server accepts `image/jpeg|png|webp` ≤ 2 MB each, sniffs magic bytes, refuses others. The client also sends `page` (the `?from=` path or `document.referrer` path) and `device` (short UA summary, standalone yes/no, build id). Submit → "Teşekkürler, bildirimin iletildi (Sorun #12)." Rate limit: 10 reports per user per day via `consumeAttempt`.
- **Reporter view:** `/sorun-bildir` also lists "Bildirimlerim": number, title, status chip (`Yeni`, `İnceleniyor`, `Çözüldü`, `Yapılmayacak`), the handler's reply when set. Reporter sees only their own; can't edit after sending.
- **Handler view:** `/sorunlar` (only `handles_reports = 1`; everyone else gets the same 404 as an unknown page): list with filters Açık (new+in_progress) / Kapalı / Tümü, newest first; detail `/sorunlar/[numara]` with reporter name + part, page, device, time, images (served by an authorized route, `private, no-store`), status select and reply textarea (one save). A nav entry "Sorunlar" with an open-count badge, visible only to the handler.
- **Image route:** `/api/dosya/sorun/[id]` → 404 unless the viewer is the reporter of that report or a handler. Images are stored in Vercel Blob under `reports/`.
- **Push:** new report → the handler gets "Yeni sorun bildirimi" / `#12 · <title> — <reporter>` (url `/sorunlar/12`, group `sistem`). Status change or reply → the reporter gets "Sorun #12 güncellendi" / new status (+ first 80 chars of reply), group `null` (always delivered; it's their own report). Use the existing `enqueue`/trigger patterns and add kinds to `src/lib/push/copy.ts`.
- **Retention:** images of reports closed for 90 days are deleted by the existing daily sweep (rows deleted → blob deletion queued). Report text stays.
- **Storage quota:** images count toward the storage total the quota meters use (follow how `piece_audio`/`recordings` sizes are summed). Uploads are refused when uploads are stopped at 95% (same message as other uploads).
- e2e: new suite `e2e/phase15-b-reports.mjs` (member files a report with 2 images, sees it in Bildirimlerim; another member can't see it nor fetch its image; non-handler board/conductor get 404 on `/sorunlar`; handler sees list + detail + images, sets İnceleniyor + reply, reporter sees reply; push rows for both directions; >3 images or a non-image refused; rate limit; sweep deletes images of a report closed 91 days ago).

## Non-goals

MIDI per section, attendance per section, member-list section column/filter, a UI to change the report handler (set via DB; document in README).
