# Phase 16 spec: announcements ("Duyurular")

Author: PO (main session). Date: 2026-11-07. Status: **build** (after Phase 15 is live).

User request (2026-11-07): "Duyuru bildirimi göndermek istiyorum böyle bir özellik geliştir. Örneğin duyuru: yarın fotoğraf çekimi yapılacaktır. Lütfen arkhe tişörtlerinizle çalışmaya geliniz". The user is away and said not to ask; decisions below are the PO's.

## Who

- **Write, edit, delete:** managers (conductor, board). Server-side check in every action.
- **Read:** every active member the announcement is addressed to.

## Data (migration 0020)

- `announcements`: `id` uuid, `title` 3–80 (trimmed), `body` 1–1000, `audience` in `all | parts | board`, `important` boolean, `created_by` → users (restrict), `created_at`, `updated_at`, `show_until` (Istanbul day `YYYY-MM-DD`, default today + 7, max today + 60), `deleted_at` null (soft delete, hidden everywhere).
- `announcement_parts` (`announcement_id`, `voice_part`) for `audience = 'parts'` (1–4 rows; whole parts only, no sub-parts).
- `announcement_reads` (`announcement_id`, `user_id`, `read_at`), pk both: "Tamam" on the home card.
- Audience rule: `all` = every active user; `parts` = active singers whose `voice_part` is listed, plus all managers (they always see what they sent); `board` = conductor + board.

## UI

- **Compose** `/duyurular/yeni` (managers): Başlık, Duyuru metni (textarea, 1000 chars with a counter), Kime: `Herkes` (default) / `Partisyonlar` (chips S/A/T/B) / `Sadece YK`, `Önemli` checkbox (help: "Gece sessiz saatlerinde de hemen gider; ana sayfada kırmızı görünür."), `Ana sayfada şu tarihe kadar göster` (date, default +7 days). Preview of the push text. Submit "Duyuruyu gönder" → confirm dialog "N kişiye bildirim gidecek." → sent.
- **List** `/duyurular` (everyone): newest first, only those addressed to the viewer and not deleted; each shows title, body (line breaks kept, links auto-linked safely), sender name + role, time, "Önemli" chip. Managers see "Düzenle" / "Sil" and the audience + "Okuyan: 12/37". Entry points: home card link "Tüm duyurular", Profil row, desktop sidebar item "Duyurular" (mobile bottom bar stays as is).
- **Home card** (top of the home page, above the hero): active (`show_until >= today`) unread announcements addressed to the viewer, newest first, max 3 (+ "N duyuru daha" link). Each: title, body clamped to 4 lines with "Devamı", "Tamam" (marks read, card leaves). Important ones use the absent/red tokens.
- **Edit** `/duyurular/[id]/duzenle`: title, body, show_until, important; audience not editable after sending. Editing does not resend the push; an optional checkbox "Değişikliği tekrar bildir" sends "Duyuru güncellendi".
- **Delete:** soft delete with confirm; disappears from list and home.

## Push

- New kind `announcement`: title = the announcement title (≤40, cut with …), body = first 120 chars of the text, url `/duyurular#<id>`, dedupe `duyuru-<id>` (update: `duyuru-<id>-<n>`).
- Group `calisma` ("Çalışma ve konser duyuruları", on by default) for normal ones; **important** ones use group `null` (always delivered) and `urgent = true` so quiet hours don't hold them.
- Recipients = the audience minus the sender. Use the existing `enqueue`/`notify` path and `after()` like other triggers; add the kind to `src/lib/push/copy.ts`.

## Limits

- Rate limit 20 announcements per manager per day.
- Body rendered as plain text (no HTML); URLs become links with `rel="noopener noreferrer" target="_blank"` only for http(s).

## e2e `e2e/phase16-announcements.mjs`

Manager sends to all → every active member has a push row and sees the home card; "Tamam" hides it for that user only; parts audience reaches only those parts (+ managers); board audience; korist gets 404/redirect on `/duyurular/yeni` and actions refuse non-managers; important uses group null + urgent; edit without resend sends nothing, with resend sends the update; delete hides; show_until in the past hides the home card but keeps it in the list; Okuyan count; rate limit.

## Non-goals

Scheduling for later, attachments/images, comments/reactions, email.
