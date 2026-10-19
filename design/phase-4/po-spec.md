# Phase 4 — Kayıt ödevleri (PO spec)

Author: arkhe-po. Inputs: `PLAN_INPUT.md` (Faz 4); Phase 3 `po-decisions.md` §3.5/§4 (piece FK, `barFrom`/`barTo`, `/repertuvar/[id]?partisyon=…`, `deletePiece` FK message); Phase 2 `po-decisions.md` D14–D16 (roster: `member`+`board`, `joined_at`/`left_at`, part required); `src/db/schema.ts`; `src/components/shell/nav-items.ts`; `src/lib/links.ts` (`resolveMyPart`).

@ux, @ui, @dba, @backend: reply in your own files. **Proposal** marks my default. Open questions are in §10.

## 1. Problem

Every week the conductor says "altolar, Ave Verum 12–34'ü kaydedip atın, cumaya kadar". It's said once at the end of rehearsal, half the section forgets the bars, the mails arrive with subjects like "kayıt" or "Yeni kayıt 14", and on Thursday night the conductor scrolls the inbox to work out who sent what. Nobody knows who is late until the next rehearsal.

Phase 4 gives:
1. One place where the homework is written down: piece, bars, parts, deadline, what to focus on, with a one-tap link to my part file.
2. A prepared email (mailto) with a subject the conductor can search and sort, and a `Teslim ettim` tap so the choir knows who is done. The recording itself still goes by email from the singer's own phone. **We send nothing and store no audio** (zero budget).
3. A colour that tells a singer at a glance how urgent it is, and a matrix that tells the conductor who is missing, plus a short private note back to each singer.

## 2. Users and roles

| Role | In this phase they… |
|---|---|
| Korist (and YK as a singer) | Sees homework for their part, opens the part file, sends the recording with the prepared mail, taps `Teslim ettim` (and `Geri al`), reads the conductor's note. |
| Şef / YK (managers) | Create, edit, delete homework; see the submission matrix; mark someone as submitted on their behalf; write a feedback note per singer; set the choir's recording email. |

Authorization: reading homework = any logged-in user; submit/undo = only the user themself and only if eligible (§3.4); every other write needs `isManager`, checked on the server. Feedback text is readable only by its recipient and managers (server-side filter, not hidden UI).

## 3. Domain

### 3.1 Assignment fields
| Field | UI label | Rules |
|---|---|---|
| `pieceId` | Eser | required; picker lists non-archived pieces (search as on `/repertuvar`). FK `restrict`. Archiving a piece later does not touch its homework. |
| `barFrom`, `barTo` | Ölçüler (`Başlangıç`, `Bitiş`) | optional integers 1–9999, **both or neither**, `barFrom ≤ barTo`. Shown as `Ölçü 12–34`; same number → `Ölçü 12`; empty → `Tüm eser`. Errors: `Ölçüleri başlangıç ve bitiş olarak gir (ör. 12–34).`, `Bitiş ölçüsü başlangıçtan küçük olamaz.` |
| parts | Partisyonlar | ≥ 1 of Soprano/Alto/Tenor/Bas, checkboxes, **default all four**. A `Tutti` shortcut toggles all. Error `En az bir partisyon seç.` |
| `dueAt` | Son tarih | required. Date (default today + 7) + time (default `23:59`), entered and shown in Europe/Istanbul, stored as a UTC timestamp. Must be in the future on create (`Son tarih geçmişte olamaz.`); on edit any value is allowed. |
| `description` | Açıklama | optional, ≤ 1000, plain text, line breaks kept (e.g. "Metronom 60, 20. ölçüde nefes yok, kulaklıkla MIDI'yi dinleyerek söyle."). |
| `createdBy`, `createdAt`, `updatedAt` | — | `createdAt` is also the "given at" moment for eligibility (§3.4). |

Display title everywhere: `{Eser adı} · {Ölçü 12–34 | Tüm eser}`; parts as voice-part dots/chips (`Tutti` when all four).

### 3.2 Recording email (setting)
- One choir-wide value, `Kayıt e-postası`, stored in the DB (new `app_settings` key/value table, key `recording_email`), **not** an env var: the board changes it without a deploy.
- Edited by managers from `/odevler` (`Kayıt e-postası` row in the manager header/menu, small dialog). Validation: trimmed, lower-cased, ≤ 254, simple `x@y.z` shape → `Geçerli bir e-posta adresi gir.` Empty is allowed (clears it).
- Not set → members see `Kayıt e-postası henüz ayarlanmadı. Kaydını şefe nasıl ileteceğini sor.` instead of the mail button; `Teslim ettim` still works. Managers see a warning banner with `Ayarla`.
- Seed: `kayit@arkhe.local`.

### 3.3 The prepared mail
- Button `Kaydı e-postayla gönder` = `<a href="mailto:{email}?subject={s}&body={b}">` (RFC 6068, `encodeURIComponent`, no `target`).
- Subject (stable, sortable, searchable): `Arkhe ödev · {Eser adı} · {Ölçü 12–34|Tüm eser} · {Partisyon} · {Ad Soyad}`. `{Partisyon}` = the singer's part label (`Alto`); a manager/no-part user gets no button.
- Body: `Merhaba,\n\nödev kaydım ekte.\n\nEser: …\nÖlçüler: …\nSon tarih: 24 Ekim Cuma 23:59\n\n{Ad Soyad}`.
- mailto can't attach files. Under the button: `Kaydını e-postaya eklemeyi unutma. Dosya büyükse Drive'a koyup bağlantısını yapıştır.` Plus **`Konuyu kopyala`** (clipboard, toast `Konu kopyalandı.`) for singers who share straight from the voice-memo app, and the email address shown as text.

### 3.4 Who sees and who is expected
- **Eligible** for an assignment = active user, role `member` or `board`, `voicePart` in the assignment's parts. Only eligible users have `Teslim ettim`.
- **Expected** = eligible **and** `joinedAt ≤ assignment.createdAt`. Expected people are the denominator and show as `Bekleniyor`/`Gecikti` in the matrix.
- Someone who **joins after** the homework was given sees it (it's still useful practice), with the hint `Sen katılmadan önce verildi; istersen teslim edebilirsin.`, no red/overdue state, not in the matrix unless they submit (then counted in both numerator and denominator, like Phase 2 D13).
- **Left** members (`left_at` set) disappear from open matrices; past submissions stay in the data, and in the matrix they show only if they had submitted, with `Ayrıldı`.
- **Part changes:** eligibility uses the *current* part. A submission is never deleted by a part change; a submitter whose part is no longer in the assignment stays listed under their new part.
- Conductor and users without a part are never eligible; they see all homework read-only.
- Members' list shows only homework for their part; any detail URL is readable by everyone (no submit button when not eligible: `Bu ödev senin partisyonun için değil.`).

### 3.5 Deadline colour (Europe/Istanbul, computed on render against server `now`)
`remaining = dueAt − now`, applied only while **not submitted** by the viewer:

| Condition | Tone (token) | Badge copy |
|---|---|---|
| `remaining > 72 h` | green (`success`) | `{d} gün kaldı` (d = floor(remaining / 24 h)) |
| `24 h < remaining ≤ 72 h` | amber (`gold`) | `{d} gün kaldı` |
| `0 < remaining ≤ 24 h` | red (`destructive`) | `{h} saat kaldı` (h = ceil hours); under 1 h `1 saatten az kaldı` |
| `remaining ≤ 0` | red (`destructive`) | `Gecikti · {d} gün` (d ≥ 1 = floor(−remaining / 24 h)); first day `Gecikti` |
| submitted on time | neutral + check | `Teslim edildi · 22 Eki` |
| submitted after `dueAt` | neutral + check | `Geç teslim · 26 Eki` |

The absolute deadline is always shown next to the badge (`Son tarih: 24 Eki Cum 23:59`). Colour is never the only cue (text + icon). Managers' list rows use the deadline tone (no personal state) plus `{n}/{m} teslim`. A new joiner (§3.4) never gets red.

### 3.6 Submission states
- `Bekleniyor` → tap **`Teslim ettim`** → `Teslim edildi` (stores `submittedAt`, `method = self`). One tap, no dialog; idempotent on double tap.
- **`Geri al`** (undo) is allowed any time while the manager has written **no feedback** for that singer; afterwards it's hidden and the server rejects with `Şef geri bildirim yazdı; teslimi geri alamazsın.` Undo clears `submittedAt`.
- **Late:** `Teslim ettim` stays available after the deadline forever; the record is flagged late (`submittedAt > dueAt`, computed, not stored).
- **Manager mark:** in the matrix a manager can toggle `Teslim edildi` / `Teslim edilmedi` for any eligible singer (`method = manual`, `markedBy`), for "sent it by WhatsApp" or "mailed but forgot to tap". A singer's own undo does not undo a manual mark? **Proposal:** it does (last write wins, it's their record); the matrix shows `şef işaretledi` for manual ones.
- One record per (assignment, singer). Re-recording = send another mail; the app keeps the latest submit time.

### 3.7 Feedback note
- Per (assignment, singer), ≤ 1000 chars, plain text, written by any manager, editable/clearable; stores `feedbackBy`, `feedbackAt`. Allowed whether or not the singer has submitted ("kaydın gelmedi" is feedback too).
- Visible **only** to that singer and to managers. Singer sees it on the assignment detail as `Şefin notu` (author name + date) and on the list as a `Yeni not` dot until they open the detail (`feedbackSeenAt`).
- No general "note to the whole part" in this phase: the conductor edits `Açıklama` for that.

## 4. Screens / IA (proposal; @ux owns details)

Nav: add **`Ödevler`** → `/odevler`, icon `Mic` (lucide), between `Repertuvar` and `Üyeler`. Mobile tab bar becomes 4 tabs for members (Ana sayfa · Çalışmalar · Repertuvar · Ödevler) and 5 for managers (+ Üyeler); 5 is the phone maximum, @ui: verify 375 px labels fit. The tab shows a small count badge = my homework that is `Bekleniyor`/`Gecikti` (expected, not submitted, due within the `Güncel` window); managers get no badge.

- **`/odevler`** (`?liste=guncel|gecmis`, default `guncel`). `Güncel` = `dueAt ≥ now − 7 days`, sorted by `dueAt` asc; `Geçmiş` = older, desc. Members: rows for their part only, sorted with unsubmitted first; row = title, part chips, deadline badge + absolute date, `Yeni not` dot, inline `Teslim ettim` on unsubmitted rows. Managers: all homework, row with `{n}/{m} teslim` and per-part mini counts `S 5/8 · A 6/9 …`; header has `Ödev ver`, `Teslim matrisi`, `Kayıt e-postası`. Empty: `Şu an ödev yok.` (managers: + `Ödev ver`).
- **`/odevler/[id]`** — everyone: title, parts, deadline badge, description, `Partisyonum` (reuse Phase 3 `resolveMyPart`, same rules incl. hidden for no-part users) and `Esere git` → `/repertuvar/[pieceId]?partisyon={my part as bas/alto/…, or tumu}`. Eligible singer: §3.3 mail block, `Teslim ettim` / state + `Geri al`, `Şefin notu`. Managers additionally: the **per-assignment matrix**: grouped S/A/T/B, part header `Alto · 6/9`, rows name + state (`Teslim edildi 22 Eki` / `Geç teslim` / `Bekleniyor` / `Gecikti`, `şef işaretledi` tag) + a `Not` button opening a sheet with the feedback textarea and the submit toggle. Filter chips `Tümü` · `Teslim etmeyenler`. Menu: `Düzenle`, `Sil`.
- **`/odevler/matris`** (managers): rows = expected singers grouped by part, columns = the last 8 assignments by `dueAt` (header: short piece name + date), cells ✓ (on time) / `G` (late) / ✗ (overdue, missing) / · (pending, not yet due) / blank (not eligible). Sticky name column; the grid scrolls horizontally **inside its container** (page itself must not). Each cell links to the assignment. Last column `{n}/{m}` per singer.
- **`/odevler/yeni`** (also `?eser={pieceId}` prefilled from a new `Ödev ver` item in the piece detail menu) and **`/odevler/[id]/duzenle`**: §3.1 form. After create → `/odevler/[id]`, toast `Ödev verildi.`
- **Delete:** AlertDialog `"{başlık}" silinsin mi?` / `{n} teslim kaydı ve notlar da silinir. Bu işlem geri alınamaz.` / `Vazgeç` · `Sil`; toast `Ödev silindi.`
- **Home:** card `Ödevlerim`: the most urgent unsubmitted homework (deadline badge, `Teslim ettim`), `+{n} ödev daha`; hidden when none. Managers: `Ödevler` card with the nearest open homework and `{n}/{m} teslim`.
- **Repertuvar detail:** a `Ödevler` line listing open homework on this piece (links). `deletePiece` maps the FK error to `Bu esere bağlı ödevler var. Silmek yerine arşivle.`

## 5. User stories

Singers
- **M1** On Monday I open the app and see "Ave Verum · Ölçü 12–34 · Alto · 4 gün kaldı" in green, with what to focus on.
- **M2** I tap `Partisyonum`, sing along with the alto MIDI/MP3, record a voice memo.
- **M3** I tap `Kaydı e-postayla gönder`; my mail app opens with the address and subject filled; I attach the memo and send. Or I share from the voice-memo app and paste the copied subject.
- **M4** I tap `Teslim ettim`; the row turns to `Teslim edildi`. If I tapped by mistake, `Geri al`.
- **M5** On Thursday night an unsubmitted homework is red with `5 saat kaldı`; on Saturday it says `Gecikti` and I can still submit (late).
- **M6** I see `Yeni not`, open it and read the conductor's note only I can see.

Managers
- **C1** After rehearsal I give homework in under a minute from the piece page: bars, parts, Friday 23:59, two lines of focus.
- **C2** On Friday I open the homework and see per part who hasn't submitted; I mark the one who sent it by WhatsApp.
- **C3** Listening to the mails, I write a short note per singer.
- **C4** Before the term meeting I open `Teslim matrisi` and see who regularly skips homework.
- **C5** When the recording inbox changes, a board member updates `Kayıt e-postası` without asking a developer.

## 6. Data (for @dba; proposal)
- `assignments`: `id`, `piece_id` → `pieces` **on delete restrict**, `bar_from`/`bar_to` int null (CHECK both-or-neither, `1 ≤ from ≤ to ≤ 9999`), `description` (≤ 1000), `due_at` timestamp not null, `created_by` → users (set null), `created_at`, `updated_at`. Index `due_at`, `piece_id`.
- `assignment_parts`: PK (`assignment_id` cascade, `voice_part` CHECK enum). ≥ 1 enforced in the action.
- `submissions`: PK (`assignment_id` cascade, `user_id` → users), `submitted_at` null, `method` (`self|manual`) null, `marked_by` null; `feedback` (≤ 1000) null, `feedback_by`, `feedback_at`, `feedback_seen_at`. CHECK `(submitted_at is null) = (method is null)`. A row may exist with feedback only. Index `user_id`.
- `app_settings`: `key` PK (CHECK in `('recording_email')`), `value`, `updated_at`, `updated_by`.
- Eligibility/expected computed in queries (§3.4), never stored. Migration `0003_phase4_homework` (number per dba).
- Seed (relative to reset time): recording email; assignments on seeded pieces: **A** Ave Verum 12–34, all parts, due +5 d (green); **B** Aman Gülüm, S+A, due +2 d (amber); **C** Bogoroditse Devo 1–16, all, due +5 h (red); **D** all parts, due −2 d, `korist@` not submitted (overdue), some others submitted, one late, one manual; **E** due −10 d (Geçmiş), `korist@` submitted with feedback `Girişler çok iyi, 20. ölçüde nefesi erken alıyorsun.`; **F** Tenor+Bas only (not `korist@`'s part). One seeded member with `joined_at` after D's `created_at`. The seed file documents expected matrix counts.

## 7. Acceptance criteria (e2e-verifiable)

Tests don't open a mail client: they assert `href` attributes and our UI. Times are relative to seed/test time.

Member (`korist@`, alto)
1. `Ödevler` is in the mobile tab bar (375 px) and sidebar; its badge equals the number of seeded unsubmitted homework for alto in `Güncel` (A, B, C, D = 4).
2. `/odevler` shows A, B, C, D and not F; E appears only under `Geçmiş`. Rows show `Tüm eser` / `Ölçü 12–34` correctly.
3. Deadline badges: A green `5 gün kaldı`, B amber `2 gün kaldı`, C red `5 saat kaldı`, D red `Gecikti · 2 gün`; each badge exposes its tone via a stable hook (`data-tone="green|amber|red|done"`). A test-created homework due in exactly +72 h −1 min is amber and +72 h +1 min is green; +23 h is red.
4. On A's detail, the mail button's `href` starts with `mailto:kayit@arkhe.local?subject=` and its decoded subject equals `Arkhe ödev · Ave Verum Corpus · Ölçü 12–34 · Alto · {korist's name}`; the body contains `Son tarih:`. `Konuyu kopyala` shows `Konu kopyalandı.`
5. `Partisyonum` on A points to the same alto Drive URL as on `/repertuvar` (Phase 3 AC4); `Esere git` href is `/repertuvar/{id}?partisyon=alto`.
6. `Teslim ettim` on A turns it into `Teslim edildi · {today}` (tone `done`), the tab badge drops by 1, and the state survives reload. `Geri al` restores `Bekleniyor` and the green badge.
7. `Teslim ettim` on D shows `Geç teslim · {today}`; managers' matrix shows it as late.
8. On E, `Şefin notu` shows the seeded feedback; the `Yeni not` dot shows on E's row before opening and is gone after. `Geri al` is not shown on E, and calling the undo action returns `Şef geri bildirim yazdı; teslimi geri alamazsın.`
9. On F, there is no `Teslim ettim` and the page says `Bu ödev senin partisyonun için değil.`; calling the submit action for F returns `Bu işlem için yetkin yok.`
10. As `korist@`, no `Ödev ver`, edit, delete, matrix or feedback controls; `/odevler/yeni`, `/odevler/[id]/duzenle`, `/odevler/matris` redirect away; every manager action returns `Bu işlem için yetkin yok.` and changes nothing. Other singers' feedback never appears in `korist@`'s HTML.
11. The seeded new joiner sees D with `Sen katılmadan önce verildi; istersen teslim edebilirsin.` and no red badge; D's matrix doesn't list them.
12. With the recording email cleared, A's detail shows `Kayıt e-postası henüz ayarlanmadı…` and no mailto link; `Teslim ettim` still works.

Manager (`sef@` / `yk@`)
13. From a piece's `Ödev ver`, a manager creates homework (bars 5–20, parts Alto+Tenor, due +3 d 21:00, description) and lands on its detail with `Ödev verildi.`; it shows `Ölçü 5–20`, Alto and Tenor chips, `Son tarih` in tr-TR Istanbul time.
14. Validation: bars `20`–`5` → `Bitiş ölçüsü başlangıçtan küçük olamaz.`; only `Başlangıç` → `Ölçüleri başlangıç ve bitiş olarak gir (ör. 12–34).`; no part → `En az bir partisyon seç.`; past date → `Son tarih geçmişte olamaz.`
15. D's detail matrix shows per-part counts matching the seed doc, states `Teslim edildi` / `Geç teslim` / `Gecikti` / `şef işaretledi`; `Teslim etmeyenler` filters to the missing ones.
16. Marking a missing singer as submitted shows `şef işaretledi`, raises the count, and that singer sees `Teslim edildi` on their side.
17. Writing a note for `korist@` on A: `korist@` sees it under `Şefin notu` with the `Yeni not` dot; `Geri al` is then hidden for them.
18. `/odevler/matris` lists expected singers by part with the last ≤ 8 assignments as columns and the right cell symbols for the seeded data; the page has no horizontal scroll at 375 px (only the grid container scrolls).
19. Editing A's due date to −1 d turns members' unsubmitted A red `Gecikti`. Deleting A asks the confirm with the submission count and removes it from the list and matrix.
20. `Kayıt e-postası` accepts `kayit@koro.org` (the mailto updates) and rejects `kayit@` with `Geçerli bir e-posta adresi gir.`
21. Deleting a piece with homework (from its edit page) shows `Bu esere bağlı ödevler var. Silmek yerine arşivle.` and deletes nothing; the piece detail lists its open homework.
22. Home: `korist@` sees `Ödevlerim` with the most urgent unsubmitted homework (C) and a working `Teslim ettim`; managers see the `Ödevler` card with `{n}/{m} teslim`.

Quality
23. All new screens: no page-level horizontal scroll at 375 px in light and dark; buttons/rows ≥ 44 px; badges carry text, not only colour.
24. `npm run lint`, `npm run typecheck`, `npm run e2e` pass.

## 8. Out of scope (Phase 4)
- Sending email/SMS/push/WhatsApp reminders; reading the inbox; any file upload, audio storage or in-app recorder/player.
- Recurring/weekly templates, duplicating homework, attaching extra links to homework (use the piece's links or `Açıklama`).
- Grades/scores, a singer's own note on submission, threaded comments, a note to a whole part.
- CSV of the matrix, homework in Phase 2 reports or warnings, linking homework to a specific rehearsal.
- Per-assignment recording email; several inboxes.

## 9. Risks
- Singers tap `Teslim ettim` without sending: social, the conductor sees the inbox; manual mark covers the reverse.
- mailto on desktops without a mail client does nothing visible: the address + `Konuyu kopyala` are always shown as text.
- Large WhatsApp/voice-memo files exceed mail limits (Gmail 25 MB): the Drive hint covers it.
- Tab bar with 5 items at 375 px is tight (@ui).

## 10. Open questions (settle in po-decisions.md)
1. Undo after a **manual** mark: may the singer undo it (my lean: yes, their record) or is it locked like feedback?
2. Tab badge: worth a per-request count query in the layout? My lean: yes, it's the main nudge.
3. `Güncel` window of 7 days after due: right for weekly homework? @ux.
4. Should YK be able to write feedback, or only the conductor (plan says "şef")? My lean: both managers, author name shown.
5. `Mic` icon and `Ödevler` label vs `Kayıtlar`. @ux.
6. Matrix column count 8 on phones vs desktop. @ui.
