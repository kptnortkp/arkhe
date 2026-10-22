# Phase 9 spec: recordings in the portal, assistant review, MIDI files

Author: PO. Date: 2026-10-21. Status: amended after team feedback; every open point is settled in `po-decisions.md` (D31–D63), and changed ACs and decisions are marked `(amended Dn)`. AC numbers are unchanged (1–59).

Inputs: the user's three requests of 2026-10-21 (translated in the tech lead's brief) and the tech lead's answers already given to the user; `design/STATUS.md`; `design/phase-4/po-spec.md`, `po-decisions.md` and `review-po.md` (the homework module this phase extends); `design/phase-8/po-decisions.md` D22, D31, D40 and `design/phase-8b/po-decisions.md` (nav and migration order); `design/phase-8b/po-spec.md` (format). Code spot-checked: `src/db/schema.ts` (`assignments`, `assignment_parts`, `submissions` with `feedback`/`feedback_by`/`feedback_at`/`feedback_seen_at`, `pieces`, `piece_links`, `app_settings`), `src/lib/homework/eligibility.ts`, `queries.ts`, `mail.ts`, `csv.ts`, `src/app/(portal)/odevler/actions.ts` (`submitAssignment`, `undoSubmission`, `setSubmissionFor`, `saveFeedback`, `markFeedbackSeen`), `src/app/(portal)/repertuvar/[id]/page.tsx`, `src/components/shell/nav-items.ts`, `src/proxy.ts` (nonce CSP), `next.config.ts` (`Permissions-Policy`), `src/lib/api.ts` (`sameOrigin`), `src/app/api/cron/aylik-yedek/route.ts`, `src/lib/backup/email.ts`, `vercel.json`. Vercel docs read on 2026-10-21: `vercel-blob/private-storage` (last updated 2026-09-15), `vercel-blob/usage-and-pricing`, `vercel-blob/client-upload`, `functions/limitations`, `plans/hobby`.

Fixed constraints (not up for discussion):
1. **The portal is live** (37 users). The Phase 9 migration is `drizzle/0010_…`, after Phase 8's `0008` and 8b's `0009`. It is **additive only**: new tables and indexes, no change to existing columns or CHECKs. Like 8 and 8b, it is not deployed before Phase 7 is live.
2. **Zero budget.** Vercel Blob Hobby (free) for files. Over the free limit Blob is blocked for 30 days and nothing is billed; the portal must never get there by accident (D19–D21). Libraries must be free/open-source (MIT or similar) and justified in `backend.md`/`ui.md`.
3. **Recordings are private personal data.** They are never reachable by a public or guessable URL. Every read goes through our own authorized route (D5).
4. **The rule "only the conductor sees assistant notes; the singer sees only the conductor's comment" is enforced on the server**: in every page, action, route and query. Hiding UI is never the check.
5. **e2e only.** Every AC is checked by `npm run e2e` (Playwright, real Chrome, dev server), by `npm run e2e:prod`, or by a script. "Arrange" means the test writes DB state or files directly. The production Blob adapter can't run in e2e (no emulator); its checks are a short go-live list (§9), not ACs.
6. **Phone first, no admin burden.** A singer records on an iPhone in four taps. The conductor reviews 40 recordings on a phone without opening email.

## 1. Problem

Today (Phase 4) the conductor gives homework in the portal, but the recording travels outside it: the singer records a voice memo, mails it to the recording inbox with the prepared subject, and taps `Teslim ettim`. Then:

- **The conductor listens to 30–40 mails a week alone.** The section leaders could help, but they don't have the inbox, and forwarding singers' voices around WhatsApp is exactly what nobody wants.
- **"Teslim ettim" doesn't prove anything.** People tap it and forget to attach the file; the mail app on a phone can't attach a file from a `mailto:` link at all, so the flow is "record, open Voice Memos, share, paste the subject". Many give up.
- **Feedback is scattered.** Some notes arrive by WhatsApp, some in the portal, some from board members who aren't the conductor.
- **MIDI part files live on Google Drive.** Opening a `.mid` on an iPhone does nothing: neither Safari nor the Files app plays MIDI. So singers ask for MP3s, which somebody has to export.

The user asked three things (2026-10-21): upload MIDI part files to the portal; record and upload homework inside the portal, still free; and a review chain where assistants appointed by the conductor listen and comment first, only the conductor sees their comments, and the singer sees only the conductor's comment.

## 2. Users and roles

No new role. "Assistant" is an assignment the conductor gives to a user (D9).

| Who | In this phase they… |
|---|---|
| Korist (and a board member as a singer) | Record or upload their homework in the portal, listen to it, replace or delete it until the conductor has commented, read the conductor's comment, see when the audio will be deleted. Play and download MIDI files of any piece. |
| Dinleme asistanı (a `member` or `board` user appointed by the conductor, optionally for some voice parts) | Sees a queue of recordings in their scope, listens, writes one private note per recording. Never sees other assistants' notes or the conductor's comment. |
| Şef (conductor) | Appoints and removes assistants. Listens to every recording, reads all assistant notes, writes the comment the singer sees (with or without assistant notes). Can download a recording, delete one, and free space early. |
| Yönetim kurulu (board) | Keeps everything from Phase 4 **except writing feedback** (D3) and **listening to other people's recordings** (D4). Uploads and deletes MIDI files (repertoire is managers' work). Sees the storage gauge. |
| Machine (daily cron) | Deletes audio whose retention has ended and processes the deletion queue (D16). |

## 3. Key product decisions

### Fit with the Phase 4 submission/feedback model

- **D1. A recording is a submission.** Uploading the first recording for an assignment creates or updates the existing `submissions` row with `submitted_at = upload time` and `method = 'self'` (no new method value, so no CHECK change). The recording itself is a new row in a new table, one **current** recording per (assignment, singer). Everything that reads submissions today (badge, list states, roster counts, matrix, monthly CSV, late flag) keeps working unchanged.
  - **On time stays on time.** `submitted_at` is the time of the **first** upload. A replacement doesn't move it; the recording shows its own `Değiştirildi · <tarih>`. A singer who uploads on time and improves the take on Saturday isn't punished.
  - **Late** = first upload after `due_at`, exactly as Phase 4 computes it.

- **D2. The conductor's comment is `submissions.feedback`.** No second comment field. The conductor's `Yorumu gönder` writes `feedback`, `feedback_by`, `feedback_at` as `saveFeedback` does today, so the singer's `Şefin notu` block, the `Yeni not` dot and `markFeedbackSeen` all work as they are. Saving **is** publishing: there is no draft state the singer can't see. The conductor can still edit (a changed text revives `Yeni not`, Phase 4 D10) or delete it.

- **D3. The board no longer writes feedback.** The user's rule is that the singer hears from the conductor. Two voices on the same take (a board member's note, then the conductor's) is what made feedback scattered.
  - `saveFeedback` refuses non-conductors with `Geri bildirimi yalnızca şef yazar.` The board's `Not` button in the roster disappears.
  - Existing board-written notes stay visible to their singer, with the `Geri bildirim` heading (Phase 4 D9). Only a conductor can edit or delete them.
  - The board keeps creating, editing and deleting homework, the matrix, the roster and the manual mark.

- **D4. Who can listen to a recording: the singer, the conductor, and assistants in scope. Nobody else.** Not the board (unless appointed assistant), not other singers. This matches what the user described and what a singer would expect when their voice is concerned.

- **D5. The existing manual "teslim" methods stay as a fallback, behind one disclosure.** The recorder is the main path. Under it, a collapsed `Başka yolla gönderdim` section holds the Phase 4 mail block (when `Kayıt e-postası` is set) and `Teslim ettim` / `Geri al`. Reasons to keep it: a phone too old for recording, a file over 4 MB, uploads paused by the quota guard (D20). When uploads are paused, the disclosure opens by default.
  - The list row and the home card stop offering an inline `Teslim ettim`. They show `Kaydını yap`, a link to `/odevler/<id>#kayit`. One obvious action, and it's the one we want.
  - The manager's manual mark (WhatsApp case) is unchanged.
  - A submission without a portal recording shows in the conductor's review list as `Portalda kayıt yok`; the conductor can still comment on it. Assistants never see it (nothing to listen to).

### Recording and uploading

- **D6. Record in the browser, or upload a file from the phone.**
  - **Record:** `MediaRecorder` at **48 kbps mono** (`audioBitsPerSecond: 48000`). The recorder picks the first supported type in this order: `audio/mp4;codecs=mp4a.40.2`, `audio/webm;codecs=opus`, `audio/mp4`, `audio/ogg;codecs=opus` (amended D34). iPhone Safari gives `audio/mp4` AAC; Chrome on Android/desktop usually gives WebM/Opus. The file is stored as recorded (no server transcoding; we have no CPU budget for it).
  - **Upload:** `Dosya yükle` accepts a voice-memo file: `.m4a`/`.mp4` (iPhone Voice Memos), `.mp3`, `.aac`, `.webm`, `.ogg`/`.opus`, `.wav` (some Android recorders; WAV is large, so the size limit decides).
  - The server **checks the file's first bytes** (`ftyp` box; `ID3` or an MPEG frame sync; ADTS sync; EBML `1A 45 DF A3`; `OggS`; `RIFF…WAVE`) and stores the detected type. The browser's `Content-Type` and file name are never trusted.

- **D7. Limits: 10 minutes when recording, 4 MB per file.**
  - **10:00** is a hard stop in the recorder (a whole piece fits; homework is usually 1–3 minutes). At 48 kbps that is about 3.6 MB.
  - **4 MB (4,194,304 bytes)** for any file, recorded or uploaded. Why not 8 MB: a Vercel Function accepts at most **4.5 MB** of request body and returns at most 4.5 MB (`functions/limitations`). With 4 MB, upload and delivery both go through our own route handler (server upload) and the same code runs locally and in production. 8 MB would need Blob client uploads, whose completion callback can't reach `localhost` and would make the dev/e2e path differ from production. A 4-minute iPhone voice memo (~64 kbps AAC, ~2 MB) fits easily; a long WAV doesn't, and the message says what to do.
  - **At most 5 uploads per (assignment, singer)**, counting replacements: `Bu ödeve en fazla 5 kez kayıt yükleyebilirsin.` This protects the 2,000 monthly upload operations from an endless "one more take" loop.

- **D8. Replace, delete and listen.**
  - The singer can **listen to their own recording** any time, before and after sending, until the audio is deleted.
  - Before sending, a fresh recording lives only in the browser: `Dinle`, `Gönder`, `Yeniden kaydet`. Nothing is uploaded until `Gönder`.
  - **One rule for changes:** `Şef yorum yazana kadar kaydını değiştirebilirsin.` Before or after the deadline, the singer can `Değiştir` (record or upload a new one; the old file is deleted) or `Sil` (the submission returns to `Bekleniyor`/`Gecikti` like Phase 4's `Geri al`), until the conductor has written a comment. After that the server refuses: `Şef yorum yazdı; kaydını artık değiştiremezsin.` This is Phase 4's feedback lock applied to audio.
  - If assistants had already written notes on the replaced take, the notes stay and the conductor sees them tagged `Önceki kayda yazıldı`. Assistants see the item back in their queue as `Yeni kayıt`.
  - **Late uploads** are allowed, as Phase 4 allows late submits, until the conductor has commented.

### Assistants

- **D9. An assistant is an appointment by the conductor, optionally per voice part.**
  - Managed on a new conductor-only page `/odevler/asistanlar`: `Asistan ekle` (pick an active `member` or `board` user), a scope of `Tüm partisyonlar` or one or more of Soprano/Alto/Tenor/Bas, `Düzenle`, `Kaldır`. No other step: no invite, no acceptance.
  - The scope uses the singer's **current** voice part (as Phase 4 eligibility does).
  - **An assistant never reviews their own recording**: it isn't in their queue and the server refuses it.
  - Removing an assistant ends their access at once. Their notes stay, shown to the conductor with their name.
  - A user who becomes `conductor`, or leaves the choir, stops being an assistant automatically (the appointment is ignored, not deleted).
  - The board can't appoint. The user said "assistants the conductor appoints".

- **D10. Assistant notes are private to the conductor.**
  - One note per (recording slot, assistant): plain text, 1–1000 characters, editable and deletable by its author until the conductor comments.
  - **Assistants don't see each other's notes, and don't see the conductor's comment.** Each one listens fresh; that is the point of several ears.
  - **No assistant note after the conductor has commented.** The item leaves the assistant's queue, their own note becomes read-only, and the server refuses a new or changed note: `Şef yorumunu gönderdi; artık not eklenemez.` If the conductor later deletes the comment, the item returns to the queues.
  - The singer never sees assistant notes, their count, or their authors.

- **D11. Transparency for the singer.** Above the recorder: `Kaydını şef ve şefin atadığı dinleme asistanları dinler: <ad>, <ad>. Asistanların notlarını yalnızca şef görür; sana şefin yorumu gelir. Ses dosyası, şef yorumundan 90 gün sonra silinir.` The names are the assistants whose scope covers the singer's part. With none: `Kaydını yalnızca şef dinler.` and the same retention sentence. A singer should know who can hear their voice (it's personal data, KVKK).

### Conductor review

- **D12. The conductor can comment without any assistant note.** Assistants are help, not a gate. A week without assistant notes must not stall feedback.

- **D13. Review screens.**
  - **Queue `/odevler/dinle`** (conductor and assistants): grouped by assignment (newest due first), each row the singer's name, part dot, duration, upload date, `Geç` tag when late.
    - Conductor chips: `Yorum bekleyen` (default; every submission with a recording or `Portalda kayıt yok`, without a conductor comment), `Asistan notu olanlar` (those with ≥ 1 assistant note), `Yorumlananlar`. Each waiting row shows `<n> asistan notu`.
    - Assistant chips: `Dinlenecek` (default; recordings in scope without my note, or with a newer recording than my note) and `Not yazdıklarım`.
  - **Review page `/odevler/<id>/dinle/<userId>`**: the player, the singer's name and part, `Teslim: <tarih>` (and `Geç teslim`), `Değiştirildi · <tarih>` if any.
    - **Assistant:** `Notun` textarea (`Bu notu yalnızca şef görür.`), `Kaydet`, `Notu sil`.
    - **Conductor:** every assistant note (author, date, `Önceki kayda yazıldı` when it applies) with a `Yoruma ekle` button that appends the note text to the comment box; the comment box `Korist'e yorumun` with `Yorumu gönder` (then `Güncelle`), `Yorumu sil`; `İndir` (the audio file); `Kaydı sil` (confirm). After sending: `Bu kayıt <tarih> tarihinde silinecek.`
    - Both: `Sonraki` goes to the next item of the same queue and chip, so 40 recordings are a loop, not 40 back-and-forths.
  - **Roster** on `/odevler/<id>` (managers): a submitted row with a recording gets a `Kayıt` tag with its duration. For the conductor the row links to the review page, and the roster `Not` sheet is replaced by that link. For the board it's not a link (D4).

- **D14. Badges and counts.**
  - **Conductor:** a count on the `Ödevler` tab and sidebar entry = recordings **with at least one assistant note and no conductor comment** ("assistant comments waiting", as asked). New hook `data-review-badge={n}`, same visuals as the homework badge, `9+` above 9, accessible text `, <n> kayıt asistan notuyla bekliyor`. `data-nav-badge` stays homework-only, so the Phase 4 test "the conductor has no badge" still holds. The conductor's home card `Dinleme`: `<n> kayıt yorum bekliyor · <k> asistan notlu`, link to the queue.
  - **Assistant:** no tab badge (the tab already carries their homework badge). Home card `Dinleme kuyruğun: <n> kayıt` (hidden at 0) and a `Dinleme (<n>)` link in the `/odevler` header.
  - **Singer:** the existing `Yeni not` dot is the notification. No email, push or SMS.

### Storage, privacy and cost

- **D15. One storage adapter, two drivers.**
  - **Local driver** when `DATABASE_URL` starts with `file:` (dev, e2e, `e2e:prod`): files under `data/uploads/` (inside the already git-ignored `data/`). `npm run db:reset` and the e2e cleanup remove `data/uploads/` contents they own, never anything else under `data/`.
  - **Blob driver** otherwise: a **private** Vercel Blob store (`access: 'private'`, `@vercel/blob` ≥ 2.3), authenticated by the OIDC token and `BLOB_STORE_ID` that Vercel adds when the store is connected (or `BLOB_READ_WRITE_TOKEN` on the Render fallback). Pathnames are `recordings/<uuid>.<ext>` and `midi/<uuid>.mid`: no names, no assignment titles, nothing personal in a pathname.
  - **Not configured in production** (no Blob credentials): the app still boots (no fail-fast; the rest of the portal must not go down for this). Uploads show `Kayıt yükleme henüz açılmadı.` and the fallback opens; managers see `Dosya deposu bağlı değil.` on `/odevler/depolama`.
  - All Blob calls go through the adapter, so e2e can swap in faults (D21).

- **D16. Private delivery through one authorized route.**
  - `GET /api/dosya/kayit/<id>` and `GET /api/dosya/midi/<id>` read the file through the adapter and stream it back. Recordings: allowed for the singer, the conductor, and an assistant whose scope covers the singer; everybody else gets **404** (not 403: we don't confirm that a recording exists). Logged out: 401. Audio already deleted: 410. MIDI: any logged-in active user.
  - Headers: the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store` for recordings, `private, max-age=604800, immutable` for MIDI (a file never changes under its id). `?indir=1` adds `Content-Disposition: attachment` with a clean file name (`Ave-Verum-Corpus-Alto.mid`; recordings `<Eser>-<Ad-Soyad>.<ext>`).
  - **Fetch on tap, then play from memory.** The player downloads the file only when `Dinle`/`Çal` is tapped, with one `fetch`, and plays it from a `blob:` object URL. No preload. One request per listen means no HTTP `Range` handling (iPhone Safari insists on `Range` for streamed `<audio>`), and no bytes are spent on pages nobody plays.
  - **Transfer cost of private delivery** (Vercel docs): our function fetches the blob from the store (Blob Data Transfer, plus Fast Origin Transfer on a CDN cache miss), then answers the browser (Fast Data Transfer plus Fast Origin Transfer). So a 1.1 MB listen costs about 1.1 MB of Blob Data Transfer (10 GB/month free), up to 2.2 MB of Fast Origin Transfer (10 GB/month free, shared with the whole project) and 1.1 MB of Fast Data Transfer (100 GB free). Uploads through our function cost Fast Data Transfer only. Public storage would be about 3× cheaper per byte but means public URLs, which constraint 3 forbids. At our volumes (§4) private delivery uses about a tenth of the free transfer.

- **D17. Retention: audio is deleted, words are kept.**
  - A recording's audio is deleted **90 days after the conductor's first comment** on it. Editing the comment doesn't move the date; deleting the comment clears it. Dates are Istanbul days and stored as `delete_on` (amended D54).
  - A recording that never gets a conductor comment is deleted **120 days after its upload** (about a term), so forgotten takes don't fill the store.
  - A replaced recording's old file, a deleted recording, the recordings of a deleted assignment, and the MIDI files of a deleted piece are deleted **at once**, through a deletion queue (D18).
  - What stays forever: the recording row's metadata (duration, size, type, upload and deletion dates), the submission, every assistant note and the conductor's comment. Where the audio was, the UI says `Ses dosyası silindi (<tarih>). Yorumlar duruyor.`
  - The conductor can download a recording before it goes (`İndir`), for the choir archive.

- **D18. The deletion job reuses the Phase 7 daily cron.** Vercel Hobby crons run once a day; we already have one at 05:00 UTC (`/api/cron/aylik-yedek`). No second cron, no `vercel.json` change.
  - The same invocation runs a storage sweep **as an independent step**: it runs whether the backup step sends, skips or fails, and a sweep failure never fails or delays the backup. The backup step's behaviour and response stay exactly as in Phase 7, byte for byte (`{ status }` only); the sweep's result goes into a `storage_sweeps` row and the log (amended D53).
  - The sweep marks expired recordings and processes the queue: delete the file through the adapter (Blob deletes are free), then mark the row done. A failed delete stays queued and is retried the next day. An action that enqueues also tries the delete right away, best effort.
  - Every DB delete of a file-bearing row enqueues its file **in the same transaction**, so no path leaves an orphan file.

- **D19. Storage gauge for managers: `/odevler/depolama` (Depolama).**
  - Four meters, each `<used> / <limit> · %<n>`:
    - `Depolama`: bytes currently stored (recordings + MIDI, from our DB) / 1 GB
    - `Yükleme (son 30 gün)`: uploads / 2.000 işlem
    - `Aktarım (son 30 gün, tahmini)`: 2 × bytes delivered by our route / 10 GB (×2 because Fast Origin Transfer may count both legs; deliberately pessimistic)
    - `Okuma (son 30 gün)`: deliveries / 10.000 işlem
  - Our own counters, not the Vercel API: listing the store costs an advanced operation, and Hobby's usage cycle date isn't exposed. A rolling 30 days is close enough when the numbers stay far from the limit. The page says: `Sayılar portalın kendi kayıtlarından hesaplanır; Vercel panelindeki değerlerle küçük farklar olabilir.`
  - **Warning at 80%** on any meter: a banner on `/odevler` and on the home page for managers, `Kayıt alanı %<n> dolu. Depolama sayfasına bak.`, and the meter turns amber (with text, not colour only).
  - Under the meters: `Kayıtlar şef yorumundan 90 gün sonra, yorumsuz kayıtlar yüklendikten 120 gün sonra kendiliğinden silinir.` and the last sweep: `Son temizlik: <tarih> · <n> dosya silindi`.
  - **Conductor only:** `Yorumlanmış kayıtlardan 30 günden eskileri şimdi sil (<n> kayıt, <MB>)` with a confirm. It's the one emergency lever in a heavy term; it doesn't touch comments.

- **D20. The quota guard: we stop before Vercel stops us.** Being blocked by Blob for 30 days would also kill MIDI and every listen. So:
  - At **≥ 95%** of `Depolama` or `Yükleme`, new uploads (recordings and MIDI) are refused on the server: `Kayıt alanı şu an dolu; yükleme geçici olarak kapalı. Kaydın kaybolmadı: Kaydı indir ile telefonuna kaydet, sonra şefe başka yolla gönder.` The fallback disclosure (D5) opens. Listening continues.
  - At **≥ 100%** of the (pessimistic) `Aktarım` or `Okuma` estimate, recording playback is refused too: `Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).` MIDI keeps playing from the browser cache where it can.
  - Managers' banner turns red: `Kayıt alanı dolu; yeni kayıt alınmıyor.`

- **D21. When Blob fails anyway: a Turkish message, no data loss.**
  - **Upload order:** the file is written to storage first, the DB row second. If storage fails, nothing is written and the singer gets `Kayıt şu an yüklenemedi. Kaydın kaybolmadı: tekrar dene ya da Kaydı indir ile telefonuna kaydet.` The recording stays in the page with `Tekrar dene` and `Kaydı indir` (a client-side download of the in-memory file). If the DB write fails after storage succeeded, the stored file is enqueued for deletion.
  - **Before upload** the in-memory recording is also protected from accidents: leaving the page while a recording exists asks for confirmation (`beforeunload`), and the screen is kept awake while recording (Wake Lock API where supported).
  - **Playback failure:** `Kayıt şu an açılamıyor. Biraz sonra tekrar dene.`
  - **e2e fault hook:** the cookie `arkhe_e2e_storage_fault=put|get|delete`, honoured only when `NODE_ENV !== "production"` **and** `DATABASE_URL` starts with `file:` (the Phase 8b pattern).

- **D22. Backups don't include audio.** The Phase 7 monthly email holds the DB (encrypted) and CSVs; it does not and will not carry audio files. With a 90-day retention, audio is working material, not the archive; the comments are the archive, and they are in the DB dump. The email gets one new line before `Raporlar şifresizdir…`: `Ses kayıtları ve MIDI dosyaları bu yedeğe dahil değildir; kayıtlar 90 gün sonra zaten silinir.` The README gets the same in its backup section, plus: "MIDI files exist only in the portal's file store; keep the originals on Drive."

- **D23. CSP and browser permissions.**
  - `Permissions-Policy` today sends `microphone=()`, which **blocks recording outright**. It becomes `microphone=(self)`; everything else stays.
  - CSP: `media-src 'self' blob:` (playback from object URLs). No other directive changes: no CDN, no soundfont host, no `unsafe-eval` in production, `connect-src 'self'` already covers the fetch.
  - Uploads go to a route handler, so it needs the `sameOrigin` check (`src/lib/api.ts`). @backend: remember the Safari `Origin` lesson from the invite fix; the upload is a same-origin `fetch`, which always sends `Origin`.

### MIDI

- **D24. MIDI files per piece and per voice part, on `/repertuvar`.**
  - Managers upload on `/repertuvar/<id>/duzenle` in a new `MIDI dosyaları` section, next to the Drive links: file (`.mid`/`.midi`), `Partisyon` (`Tutti`, Soprano, Alto, Tenor, Bas; default Tutti), optional `Etiket` (1–60 characters, e.g. `Alto önde`, `Alto 2`). Several files per part are allowed (divisi, "predominant" mixes), at most **20 per piece**.
  - **Limit 1 MB**; the server checks the `MThd` header and refuses anything else: `Bu bir MIDI dosyası değil (.mid).`, `MIDI dosyası en fazla 1 MB olabilir.`
  - Delete: `Sil` with confirm. Deleting the piece deletes its MIDI files (queued). Archiving keeps them.
  - The piece detail shows a `MIDI` section that follows the existing part filter (`?partisyon=`, default my part): Tutti files and my part's files. Each row: label (default `MIDI · Alto` / `MIDI · Tutti`), `Çal`, `İndir`.
  - The Drive links stay as they are; nobody is forced to migrate. When a portal MIDI exists for my part, the piece's main button becomes `Partisyonumu çal (Alto)` and plays inline; otherwise Phase 3's `Partisyonum` Drive button is unchanged (amended D59).

- **D25. In-browser playback, not download-only.** Download-only would leave every iPhone user where they are today: iOS can't play `.mid`. So the portal plays MIDI itself.
  - **How:** parse with `@tonejs/midi` (MIT, small) or our own parser, and play with a **hand-written Web Audio synth** (oscillator + envelope per note). No soundfont, so **no CDN and no CSP change**; it sounds like a simple keyboard, which is enough to learn notes. `html-midi-player` / `@magenta/music` is out (megabytes, TensorFlow), and so is Tone.js (large for what we use; worklet/blob-script needs that would touch the CSP).
  - **Bundle:** the player code is loaded with a dynamic `import()` on the first `Çal` tap and is **≤ 60 KB gzipped**; it's not in the initial JS of any page.
  - **Controls:** `Çal`/`Duraklat`, `Başa dön`, a position slider with `0:12 / 2:45`, tempo chips `%50 · %75 · %100` (default `%100`), and, when the file has more than one track with notes, a checkbox per track (named from the file, else `Kanal <n>`), all on by default, so a singer can mute the others or sing against them. One player plays at a time.
  - iPhone's silent switch mutes Web Audio: the player shows `Ses gelmiyorsa telefonun sessiz modunu kapat.`
  - **Homework link-up:** on `/odevler/<id>`, step 1 `Partisyonunu dinle` gets a `MIDI'yi çal` button when the piece has a MIDI file for my part (else a Tutti file). It plays inline with the same player. The recorder's hint: `Kulaklık takarsan MIDI'yi dinlerken kayıt yapabilirsin.`

### Seed and demo

- **D26. A fourth demo login and seed data that doesn't move Phase 4 counts.**
  - New demo user `asistan@arkhe.local`, "Demo Asistan", `member`, tenor, password `arkhe-demo-2026`, appointed assistant for **Soprano + Alto**. So korist@'s (alto) recordings are in scope, a tenor's aren't, and his own aren't. The production demo refusal (domain `@arkhe.local`) already covers him; e2e:prod checks it. TEAM.md's login list gets the line.
  - Recordings and notes are seeded **only on submissions that already exist in the Phase 4 fixture** (no new assignments, no new submissions), so every Phase 1–8 count, badge and matrix stays the same. @dba picks them and documents the expected queue counts in the seed file. At least: one alto recording with a Demo Asistan note and no conductor comment; one alto recording with no note; one tenor recording; one recording with a conductor comment (deletion date in the future); and korist@'s E with its audio already deleted (feedback kept).
  - Seed audio is generated in code (short WAV tones; D6 accepts WAV), so no binary fixtures are committed. Seed MIDI is generated in code too: `Ave Verum Corpus` gets a Tutti file with four named tracks and an Alto file.

- **D27. Recording in e2e.** Chrome runs with `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and `--use-file-for-fake-audio-capture=<tmp>/tone.wav` (the WAV is generated by the test into the OS temp dir), and the context grants `microphone`. So `Kayda başla` → wait → `Durdur` → `Gönder` runs for real through MediaRecorder, the route, the local driver and the DB. iPhone Safari is a manual check (§9).

### Navigation

- **D28. No new nav entry.** Everything lives under `Ödevler` and `Repertuvar`. The bottom bar stays as Phase 8 left it (managers: `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim`; members: four tabs). Entry points: the `/odevler` header (`Dinleme`, `Asistanlar`, `Depolama` per role), the home cards (D14), and the piece pages.

- **D29. Page access (server-side).**

  | Page | Conductor | Board | Assistant | Member |
  |---|---|---|---|---|
  | `/odevler/dinle` | yes | redirect `/odevler` | yes | redirect `/odevler` |
  | `/odevler/<id>/dinle/<userId>` | yes | 404 | only in scope, not own | 404 |
  | `/odevler/asistanlar` | yes | redirect | redirect | redirect |
  | `/odevler/depolama` | yes (with early clean) | yes (read only) | redirect | redirect |

  A board member who is also an appointed assistant gets the assistant column for the review pages.

- **D30. Phase 4 tests change only where this spec changes behaviour.** Known places: the inline list/home `Teslim ettim` (now `Kaydını yap`; AC 6 second half and AC 22 of Phase 4), the mail block inside the disclosure (AC 4, 12), and the board writing a note (AC 17 second half, now refused). Each edited check is listed in `review-fixes.md` with the reason. Phase 6's `Permissions-Policy` and CSP checks are updated for D23 only.

## 4. Monthly quota math (~40 singers)

Assumptions, deliberately on the heavy side: 40 singers, 4 homework a month, 75% send through the portal → **120 recordings/month**; average take 3 min at 48 kbps ≈ **1.1 MB**; 30% re-takes; each recording fully listened to 4 times (singer, one or two assistants, conductor); MIDI: 60 pieces × 5 files × 60 KB, each singer plays a MIDI 25 times a month.

| Resource (Hobby, free) | Use per month | Share |
|---|---|---|
| Blob storage, 1 GB | recordings live ≈ 2 weeks to the comment + 90 days ≈ 3.5 months → 120 × 3.5 × 1.1 MB ≈ **460 MB**; MIDI ≈ 18 MB | **≈ 48%** |
| Advanced operations (uploads), 2,000 | 120 × 1.3 ≈ 156 + ~20 MIDI | **≈ 9%** |
| Simple operations (reads on cache miss), 10,000 | 480 listens + up to 1,000 MIDI fetches (fewer, browser cache) | **≤ 15%** |
| Blob Data Transfer, 10 GB | 480 × 1.1 MB ≈ 530 MB + MIDI 60 MB | **≈ 6%** |
| Fast Origin Transfer, 10 GB (shared with the app) | ≤ 2 × 590 MB ≈ 1.2 GB | **≤ 12%** |
| Fast Data Transfer, 100 GB | uploads 170 MB + responses 590 MB | **< 1%** |

Worst case: all 40 singers every week with 4-minute takes → 160 recordings/month × 1.45 MB × 3.5 months ≈ **810 MB (81%)**. That is exactly why the 80% warning, the 95% guard, the 120-day rule for uncommented takes and the conductor's early-clean button exist. Storage is the only limit that can realistically be reached; uploads and transfer stay below 15%.

## 5. User stories and acceptance criteria

Copy in backticks is the exact Turkish UI text; @ux may polish it and I settle the final wording in `po-decisions.md`. The e2e notes say how each AC is checked.

**Seed and fixtures.** The seed adds what D26 says. Each e2e test arranges its own state on top: `E2E` homework, extra assistants and singers under `@e2e.test`, recordings written straight into `data/uploads/` plus rows, deletion dates in the past. Audio and MIDI fixtures are generated in code; nothing binary is committed. Every suite's `cleanup()` removes its own rows **and** files.

### S1. Storage, privacy and delivery (D15, D16, D23)

*As a singer I want my voice reachable only by the people who review it.*

1. **Local driver in dev and e2e.**
   - With a `file:` database, an uploaded recording lands as one file under `data/uploads/recordings/` whose name is a UUID with the detected extension (no person or piece name in the path), and the DB row holds that key, the size, the detected type and the duration.
   - `npm run db:reset` and the e2e cleanup leave `data/uploads/` without seeded/test leftovers and don't touch anything else in `data/`.

   (e2e: upload, inspect the directory and the row; run cleanup and list the directory.)
2. **No public URL, ever.**
   - No page HTML, RSC payload or JSON for any user contains a storage key, a `blob.vercel-storage.com` host, or a `data/uploads` path. Players reference only `/api/dosya/kayit/<id>` and `/api/dosya/midi/<id>`.
   - `data/uploads/` isn't served by Next (`/data/uploads/...` and `/uploads/...` return 404).

   (e2e: grep the HTML and RSC of the queue, review, homework and piece pages for each role; fetch the paths.)
3. **Recording route authorization** (D4, D16). For one seeded alto recording:
   - korist@ (owner), sef@, and asistan@ get **200** with the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` and the sandbox CSP.
   - yk@ (board, not an assistant), another alto member, and an assistant whose scope is only Tenor get **404**, with no body hint.
   - A logged-out request gets **401**.
   - When asistan@ is the owner of a tenor recording, he gets 200 only as its owner; when he's removed as assistant, the alto recording turns to 404 for him at once.
   - After sef@ comments, asistan@ gets **404** (amended D43); after the comment is deleted, 200 again.
   - `?indir=1` gives 200 with `Content-Disposition: attachment` to the owner and sef@, and **404** to asistan@ (amended D44).
   - After the audio is deleted (D17) the owner and sef@ get **410**. A take whose file is missing from the store and that was uploaded more than 10 minutes ago (arranged: row without a file) gets 410 and is marked `missing`; one uploaded under 10 minutes ago gets 503 and stays unmarked (amended D56).

   (e2e: `page.request` per user with status and headers.)
4. **MIDI route.** Any logged-in active user gets 200 with `Cache-Control: private, max-age=604800, immutable`; logged out 401; `?indir=1` adds `Content-Disposition: attachment; filename="Ave-Verum-Corpus-Alto.mid"` (ASCII-safe, D16).

   (e2e: fetch as korist@ and logged out.)
5. **Permissions-Policy and CSP** (D23).
   - Every page sends `Permissions-Policy` with `microphone=(self)` and still `camera=()` and `geolocation=()`.
   - The page CSP's `media-src` is `'self' blob:`; no other directive changed (compare with the Phase 6 expectation), production `script-src` still has no `unsafe-eval`.
   - No CSP violation is reported while recording, playing a recording and playing a MIDI file.

   (e2e: headers; the existing `cspViolations` collector during S2/S9 flows; e2e:prod for `unsafe-eval`.)
6. **Upload hygiene** (D6, D7).
   - The upload route refuses a cross-origin request (no or foreign `Origin`) with 403 and writes nothing.
   - A file whose bytes aren't one of the D6 audio formats (e.g. a PNG renamed `.m4a`, or text with `Content-Type: audio/mp4`) is refused: `Bu dosya bir ses kaydı değil ya da türü desteklenmiyor. Telefonunun ses kaydedicisinden bir kayıt seç (m4a, mp3, wav…).` (amended D63)
   - A 4,194,305-byte file is refused: `Dosya en fazla 4 MB olabilir. Daha kısa bir kayıt seç ya da burada Kayda başla ile kaydet.` (amended D63); 4,194,304 bytes is accepted.
   - Every `page.request` upload in e2e sets `Origin: BASE` explicitly (amended D33).
   - The stored type is the detected one, whatever the request claimed.

   (e2e: `page.request.post` with generated bodies; row and directory counts before/after.)

### S2. The singer records and sends (D1, D6–D8, D11)

*As an alto I want to sing my 16 bars into my phone and be done, without mail apps.*

7. **Recorder states on `/odevler/<id>#kayit`** (korist@ on A).
   - Before: the two steps `Partisyonunu dinle` and `Kaydını yap` (no step 3, amended D61), the transparency line naming `Demo Asistan` (full D11 sentences in the `Kimler görür, ne zaman silinir?` disclosure), `Kayda başla` and `Dosya yükle`. No upload request has been made.
   - `Kayda başla` (fake mic) shows the silent count-in `Hazırlan… 3 · 2 · 1` with `Vazgeç`, then a running timer `0:0x / 10:00` and `Durdur` (amended D39).
   - `Durdur` shows `Dinle`, `Gönder`, `Yeniden kaydet`; still no upload request.
   - `Gönder` shows progress, then `Kaydın gönderildi · <bugün> <saat> · 0:0x` with `Dinle`, `Değiştir`, `Sil`.
   - The row's size is consistent with 48 kbps (a 5-second take is between 5 KB and 80 KB).

   (e2e: fake audio device; network listener for upload requests; DB row.)
8. **A recording is a submission** (D1).
   - After AC 7, A shows `Teslim edildi · <bugün>` (`data-tone="done"`), korist@'s `data-nav-badge` drops by 1, and A moves to `TESLİM ETTİKLERİM`.
   - The manager roster shows korist@ as submitted with a `Kayıt` tag and the duration; the matrix cell is `done`.
   - `submissions.method` is `self`.

   (e2e.)
9. **Upload a file instead** (amended D38). `Dosya yükle` with a generated 3-second WAV first shows the preview (player, `Gönder`, `Başka dosya seç`) with no upload request; `Gönder` then shows the same `Kaydın gönderildi` state. A second test does the same with a generated minimal valid MP3 or Ogg file. The detected type is stored. An empty file shows `Bu dosya boş. Başka bir kayıt seç.` without a request.

   (e2e: `setInputFiles` with Buffers.)
10. **Listen to my own recording.** `Dinle` fetches `/api/dosya/kayit/<id>` exactly once and plays (the `<audio>` element's `currentTime` advances, its `src` starts with `blob:`). Before tapping, the page made no request to `/api/dosya/`.

    (e2e: request listener; evaluate the audio element.)
11. **Replace keeps the on-time date** (D1, D8).
    - On D (overdue), korist@ uploads → `Geç teslim · <bugün>`.
    - On A (before due), korist@ uploads, then `Değiştir` with a new take: the page shows `Değiştirildi · <bugün>`, `submitted_at` is unchanged, the old file is gone from `data/uploads/`, and there is still exactly one current recording.
    - Arranged: A's due moved into the past after the first upload; a replacement then still shows `Teslim edildi` (on time), not late.

    (e2e: DB and directory.)
12. **Delete returns the homework to open.** `Sil` (confirm `Kaydın silinsin mi?` / `Teslimin de geri alınır.`) removes the file, clears the submission (`Bekleniyor`, green badge back), and the badge count returns. The fallback `Geri al` while a take exists does exactly the same. On a submission that is a manager's manual mark, `Sil` removes only the take and the `şef işaretledi` submission stays (amended D47).

    (e2e.)
13. **The comment lock** (D8). Arranged: sef@ comments on korist@'s recording on A.
    - korist@ sees no `Değiştir`/`Sil`.
    - Calling the upload route, the replace and the delete action as korist@ returns `Şef yorum yazdı; kaydını artık değiştiremezsin.` and changes no row or file.

    (e2e: UI and direct calls.)
14. **Five uploads at most** (D7). Arranged: 5 uploads counted on (A, korist@). The 6th upload is refused with `Bu ödeve en fazla 5 kez kayıt yükleyebilirsin.`, and the recorder hides `Değiştir`. Withdrawn and deleted takes count. From the 3rd upload the recorder shows `<n>/5 yükleme`, and the 5th preview says `Bu son yükleme hakkın.` (amended D42).

    (e2e.)
15. **Not mine, not allowed.** korist@ uploading to F (Tenor+Bas) gets `Bu işlem için yetkin yok.`; the conductor (no part) has no recorder on any homework; an inactive user's session can't upload. Nothing is written.

    (e2e: direct route calls.)
16. **The 10-minute stop.** With the recorder's clock sped up through a dev-only test hook (or a 10-second limit injected by the same hook), recording stops by itself and shows `Kayıt 10 dakikada durdu.` with `Dinle`/`Gönder`.

    (e2e: the hook is honoured only outside production with a `file:` DB, like D21's cookie.)
17. **Microphone refused or unsupported.**
    - With the microphone permission denied, `Kayda başla` shows `Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver ya da telefonundaki ses kaydediciyle kaydedip Dosya yükle'yi kullan.` and `Dosya yükle` still works.
    - With `MediaRecorder` undefined (init script), `Kayda başla` isn't shown and the hint `Bu tarayıcı kayıt yapamıyor; Dosya yükle'yi kullan.` is.

    (e2e: a context without the permission; `addInitScript`.)

### S3. Appointing assistants (D9, D11)

*As the conductor I want my section leaders to help me listen, without giving them the inbox.*

18. **Conductor-only page.** `/odevler/asistanlar` renders for sef@ and redirects yk@, korist@ and asistan@ to `/odevler`. Its actions refuse non-conductors with `Bu işlem için yetkin yok.` and write nothing. It lists the seeded `Demo Asistan · Soprano, Alto`.

    (e2e: navigation and direct action calls.)
19. **Add, scope, remove.**
    - sef@ adds an `@e2e.test` member with `Tüm partisyonlar` → listed as `Tüm partisyonlar`. Editing to Bas only → `Bas`. No part selected and `Tüm partisyonlar` off → `En az bir partisyon seç.`
    - The picker lists only active `member` and `board` users (not the conductor, not inactive users), and not users who already are assistants.
    - `Kaldır` (confirm `<ad> artık kayıt dinleyemeyecek. Yazdığı notlar şefte kalır.`) ends access: their queue page redirects and their review URLs return 404.

    (e2e.)
20. **Scope follows the current part, never oneself.**
    - A soprano singer moved to tenor drops out of asistan@'s queue and his review URL for them turns 404.
    - asistan@'s own tenor recording (arranged) never appears in his queue, and his review URL for it is 404, even when the conductor widens his scope to `Tüm partisyonlar`.
    - An assistant who is made `conductor`, or deactivated, loses the assistant views (as a conductor they get the conductor's).

    (e2e: arrange part/role changes in the DB.)
21. **The singer sees who can listen** (D11). korist@ (alto) sees `Demo Asistan` in the transparency text; a tenor singer sees `Kaydını yalnızca şef dinler.` plus the retention sentence; after asistan@ is removed, korist@ sees the `yalnızca şef` text.

    (e2e.)

### S4. Assistant review (D10, D13, D14)

*As an alto section leader I want a list of takes to listen to, and a box for what I heard.*

22. **The queue.** asistan@'s `/odevler/dinle` (`Dinlenecek`) lists exactly the seeded soprano/alto recordings without his note, grouped by homework, each with name, part, duration and upload date, and `Geç` where late. It lists no tenor or bass recording, no `Portalda kayıt yok` row, nothing with a conductor comment. His home card says `Dinleme kuyruğun: <n> kayıt` with the same n, and the `/odevler` header shows `Dinleme` with a count pill of n (amended D60). On the seed n = 3 (D57).

    (e2e: compare with a SQL count of the same rule.)
23. **Write a note.** On the review page asistan@ plays the recording, writes `Girişte tempo kaçıyor, 12. ölçüde nefes erken.` and taps `Kaydet` → `Notun kaydedildi.`; the item moves to `Not yazdıklarım`; `Sonraki` opens the next `Dinlenecek` item. Editing and `Notu sil` work. Over 1000 characters: `Not en fazla 1000 karakter olabilir.`

    (e2e.)
24. **Assistants don't see each other** (D10). Arranged: a second assistant (`@e2e.test`, all parts) with a note on the same recording.
    - asistan@'s review page HTML and RSC contain neither the other note's text nor its author, nor a count of other notes; the same in reverse.
    - Neither page contains the conductor's comment text after sef@ comments (the assistant sees only `Şef yorumunu gönderdi.`).

    (e2e: HTML/RSC grep with unique marker strings.)
25. **No assistant note after the conductor's comment.** After sef@ comments, the item leaves asistan@'s `Dinlenecek`; his review page shows his note read-only and `Şef yorumunu gönderdi.`, with no player, and the audio route is 404 for him (amended D43); the save and delete note actions return `Şef yorumunu gönderdi; artık not eklenemez.` and change nothing. After sef@ deletes the comment, the item is back in `Dinlenecek` and editing works again.

    (e2e: UI and direct calls.)
26. **A re-take reopens the item.** korist@ replaces a recording that asistan@ already noted: the item reappears in asistan@'s `Dinlenecek` with `Yeni kayıt`, his old note is shown to him and to sef@ with `Önceki kayda yazıldı`.

    (e2e.)

### S5. Conductor review and the comment (D2, D3, D12–D14)

*As the conductor I want to read my assistants' impressions, listen myself, and send one clear comment.*

27. **The conductor's queue and badge.**
    - sef@'s `/odevler/dinle` `Yorum bekleyen` lists every submission without a conductor comment that has a live recording (any age), plus `Portalda kayıt yok` submissions on homework due in the last 30 days only (amended D50); `Asistan notlu` only those with ≥ 1 note, each with `<n> asistan notu`; `Yorumlananlar` the newest 100 commented ones, with `Son 100 kayıt gösteriliyor.` only when cut (amended D51, D63). On the seed: 17, 1 and 2 (D57). A `Portalda kayıt yok` submission on homework due 31 days ago (arranged) isn't listed.
    - The `Ödevler` tab and sidebar carry `data-review-badge` equal to the `Asistan notlu` count (seed: 1), `9+` above 9 (arranged), accessible text `, <n> kayıt asistan notuyla bekliyor`. sef@ still has no `data-nav-badge`; korist@, yk@ and asistan@ have no `data-review-badge`.
    - The home card `Dinleme` shows the two counts and links to the queue.

    (e2e: at 375 px and 1280 px.)
28. **All notes, then the comment.**
    - On a recording with two assistant notes, sef@ sees both, with author and date.
    - `Yoruma ekle` on one appends its text to the `Yorumun` field (help `Gönderdiğin an {Ad Soyad} görür. Asistan notları ona gitmez.`); when the result would pass 1000 characters the button is disabled with `Yorum 1000 karakteri geçer.` (amended D52, D63).
    - With unsent text in the field, `Sonraki` asks `Yorumun gönderilmedi. Yine de sonrakine geçilsin mi?` (`Kal` / `Geç`) (amended D41).
    - `Yorumu gönder` → `Yorum gönderildi.`; the item leaves `Yorum bekleyen`, the badge drops by 1, the page shows `Bu kayıt <bugün + 90 gün> tarihinde silinecek.`
    - korist@ then sees `Yeni not` on the row and `Şefin notu` with the text and `Demo Şef · <tarih>` (Phase 4 D9) on the detail.

    (e2e: the deletion date computed in the test with tr-TR Intl, Istanbul.)
29. **No assistant note needed** (D12). sef@ comments on a recording with zero notes, and on a `Portalda kayıt yok` submission; both reach the singer.

    (e2e.)
30. **The singer never sees assistant notes** (constraint 4). With unique marker texts in two assistant notes on korist@'s recording, korist@'s HTML and RSC of `/odevler`, the homework detail, the home page and `/api/dosya/kayit/<id>`'s headers contain neither marker nor any author name or count. Calling the review page or any note-reading action as korist@ gives 404 / `Bu işlem için yetkin yok.` The same holds for yk@ (board).

    (e2e: marker grep across roles, the Phase 4 AC 10 pattern.)
31. **Editing and deleting the comment.** Editing the text revives `Yeni not` for korist@ (Phase 4 D10) and keeps the deletion date. `Yorumu sil` clears it, removes the deletion date (the 120-day rule applies again), unlocks the singer's `Değiştir`/`Sil`, and returns the item to the queues.

    (e2e: DB dates.)
32. **The board can't comment any more** (D3). yk@ sees no `Not` control in the roster; calling `saveFeedback` as yk@ returns `Geri bildirimi yalnızca şef yazar.` and writes nothing. A board note that already existed (arranged) is still shown to its singer under `Geri bildirim`, and sef@ can edit or delete it; yk@ can't.

    (e2e.)
33. **Roster link-up.** On `/odevler/<id>`, a submitted row with a recording shows `Kayıt · 0:0x`. For sef@ it links to `/odevler/<id>/dinle/<userId>`; for yk@ it's plain text, and `/odevler/<id>/dinle/<userId>` is 404 for yk@. `Sonraki` on the conductor's review page walks the chip's order to the end, then shows `Bu listede başka kayıt yok.`

    (e2e.)

### S6. Phase 4 paths that change (D5)

34. **The list and home use `Kaydını yap`.** korist@'s unsubmitted rows on `/odevler` and the `Ödevlerim` card show `Kaydını yap` linking to `/odevler/<id>#kayit` instead of an inline `Teslim ettim`.

    (e2e.)
35. **The fallback disclosure.** On A's detail, `Başka yolla gönderdim` is collapsed by default; opened, it shows the Phase 4 mail link (same `href` rules as Phase 4 AC 4) and `Teslim ettim`, which works as before (`method = self`, no recording, roster shows no `Kayıt` tag, the conductor's queue shows `Portalda kayıt yok`). With `Kayıt e-postası` cleared, the disclosure has `Teslim ettim` and the Phase 4 no-email hint, no `mailto:`.

    (e2e.)
36. **Manual mark unchanged.** A manager's mark on a singer without a recording still shows `şef işaretledi`. That singer can still record afterwards: the recording attaches to the existing submission, whose `submitted_at`, `method = manual` and `marked_by` stay as they were (D1: the first submission time counts). The roster then shows both `şef işaretledi` and `Kayıt`. While that take exists, the manager's `Teslim edilmedi` is refused with `Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil.`; after the audio is gone it works (amended D47).

    (e2e.)
37. **Phase 4 regressions are explicit** (D30). Every Phase 4 check edited for this phase is listed in `design/phase-9/review-fixes.md` with the AC it belongs to and the reason; all other Phase 1–8 checks pass unchanged.

    (review of the diff of `e2e/phase4-homework.mjs`.)

### S7. Retention, deletion and backup (D17, D18, D22)

*As the treasurer of a zero-budget choir I want old audio to vanish by itself, and the feedback to stay.*

38. **90 days after the comment.** Arranged: a commented recording with its deletion date yesterday. Calling the daily cron route (with the dev `CRON_SECRET`) deletes the file from `data/uploads/`, sets the row's deletion date, keeps the submission, the conductor's comment and all assistant notes. korist@'s detail then shows `Ses dosyası silindi (<tarih>). Yorumlar duruyor.` and no `Dinle`; sef@'s review page the same, with the notes; the route answers 410.

    (e2e.)
39. **120 days without a comment.** Arranged: an uncommented recording uploaded 121 days ago and another 119 days ago: the sweep deletes the first only.

    (e2e: dates relative to now, never exactly on the boundary.)
40. **Every delete path empties the store.** Each of these leaves no file behind after the action (and at the latest after one sweep): replacing a recording, the singer's `Sil`, the conductor's `Kaydı sil` (confirm `"{Ad Soyad}" kaydı silinsin mi?` / `Ses dosyası hemen silinir. Teslim, notlar ve yorum kalır.`; the submission stays submitted, amended D48), deleting the homework (the delete confirm now says `<n> teslim kaydı, <k> ses kaydı ve notlar da silinir.`), deleting a MIDI file, deleting a piece with MIDI files. Arranged with the `delete` fault: the file stays queued, the action still succeeds for the user, and the next sweep removes it.

    (e2e: directory listing; fault cookie.)
41. **The sweep never hurts the backup** (amended D53). With the `delete` fault on, the cron call still runs the backup step exactly as in Phase 7: the response keys are exactly `["status"]` and the `backup_runs` row is unchanged. With the backup step skipping (month covered), the sweep still runs. Each run writes a `storage_sweeps` row, and the `/odevler/depolama` line `Son temizlik: <tarih> · <n> dosya silindi` reflects the latest one.

    (e2e: Phase 7 cron helpers.)
42. **The backup email says audio isn't in it** (D22). The generated monthly email text contains `Ses kayıtları ve MIDI dosyaları bu yedeğe dahil değildir; kayıtlar 90 gün sonra zaten silinir.`; the encrypted dump still holds the assistant-note and recording-metadata rows (decrypt in the test as Phase 7 does). The README's backup section has the same sentence.

    (e2e with the file outbox; grep README.)

### S8. Storage gauge and quota guard (D19–D21)

43. **Gauge access and numbers.** `/odevler/depolama` renders for sef@ and yk@ and redirects korist@ and asistan@. The four meters show values that match SQL over our tables (stored bytes of live recordings + MIDI; uploads, deliveries and 2 × delivered bytes in the last 30 × 24 h) in the format `<used> / <limit> · %<n>`, with the D19 explanation lines.

    (e2e: compare with SQL.)
44. **80% warning.** Arranged rows whose sizes total 81% of 1 GB (metadata only, small real files or none): the `Depolama` meter shows the warning state with text, and managers see `Kayıt alanı %81 dolu. Depolama sayfasına bak.` on `/odevler` and home; korist@ doesn't.

    (e2e.)
45. **95% guard.** At 95% storage (arranged), korist@'s upload is refused on the server with the D20 message, the fallback disclosure is open, the in-page recording offers `Kaydı indir`, and nothing is written. A MIDI upload by sef@ is refused with `Dosya alanı dolu; yeni dosya yüklenemiyor.` Listening still works. The same with 95% of the upload count (arranged delivery/upload log rows).

    (e2e.)
46. **Transfer guard.** At 100% of the `Aktarım` estimate (arranged), recording playback is refused with `Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).`; MIDI still plays.

    (e2e.)
47. **Blob failures lose nothing** (D21). With `arkhe_e2e_storage_fault=put`, korist@'s `Gönder` shows `Kayıt şu an yüklenemedi. Kaydın kaybolmadı: tekrar dene ya da Kaydı indir ile telefonuna kaydet.`, no row is written, `Kaydı indir` downloads a file with the same byte length as the take, and `Tekrar dene` after clearing the cookie succeeds. With `get`, `Dinle` shows `Kayıt şu an açılamıyor. Biraz sonra tekrar dene.`. In `e2e:prod` the cookie is ignored.

    (e2e: download event; e2e:prod.)
48. **Early clean** (conductor). On `/odevler/depolama`, sef@ sees `Yorumlanmış kayıtlardan 30 günden eskileri şimdi sil (<n> kayıt, <MB>)`; yk@ doesn't, and the action refuses yk@. After the confirm, exactly the arranged commented recordings older than 30 days since their comment lose their audio; younger ones and uncommented ones keep theirs; comments and notes stay.

    (e2e.)

### S9. MIDI (D24, D25)

*As a tenor on an iPhone I want to hear my line without asking anybody for an MP3.*

49. **Upload on the edit page** (a server action under 8b's `bodySizeLimit: "1100kb"`, amended D32). sef@ and yk@ see `MIDI dosyaları` on `/repertuvar/<id>/duzenle`; korist@ can't reach the page (existing rule) and the upload/delete actions refuse him. Uploading a generated MIDI with `Partisyon` Alto and `Etiket` `Alto önde` lists it as `Alto önde · Alto`; a file whose first bytes aren't `MThd` → `Bu bir MIDI dosyası değil (.mid).`; 1,048,577 bytes → `MIDI dosyası en fazla 1 MB olabilir.`; a 21st file → `Bir esere en fazla 20 MIDI dosyası eklenebilir.`; an `Etiket` of 61 characters → `Etiket en fazla 60 karakter olabilir.`

    (e2e.)
50. **The piece detail follows the part filter.** korist@ (alto) on `Ave Verum Corpus` sees the seeded `MIDI · Tutti` and `MIDI · Alto` rows, not a tenor file (arranged); with `?partisyon=tumu` all of them; each row has `Çal` and `İndir` (AC 4's download). The main part button reads `Partisyonumu çal (Alto)` and plays the Alto file inline, and the Drive part link is still listed under `PARTİSYON KAYDI`. For a tenor with no tenor MIDI (arranged), the main button is Phase 3's Drive `Partisyonum`. `/repertuvar/<id>?cal=1` opens the player ready to start on tap (amended D59).

    (e2e.)
51. **Playback.** Tapping `Çal` on the Tutti file:
    - loads the player chunk only then (no request for it before the tap),
    - fetches the file once,
    - starts playback: the player exposes `data-state="playing"` and its position text advances past `0:01`,
    - lists four track checkboxes named `Soprano`, `Alto`, `Tenor`, `Bas`, all checked,
    - `Duraklat` → `data-state="paused"`, the position holds; `Başa dön` → `0:00`,
    - `%50` makes the position advance at half speed (loose timing),
    - unchecking `Alto` keeps playing (the track's `data-muted="true"`),
    - starting another file's `Çal` stops the first.

    The `Ses gelmiyorsa telefonun sessiz modunu kapat.` hint is visible.

    (e2e: Chrome plays Web Audio headless; assert data attributes and request log.)
52. **Bundle budget.** The player chunk is ≤ 60 KB gzipped and isn't referenced by the initial HTML/JS of `/repertuvar/<id>` or `/odevler/<id>`.

    (script on the `next build` output, run by e2e:prod.)
53. **Homework link-up** (amended D59, D61). On A (Ave Verum Corpus), korist@'s step 1 `Partisyonunu dinle` shows `MIDI'yi çal`, with the Drive part as the text link `Partisyonumu aç (Alto) ↗` under it, which plays the Alto file inline; on a homework whose piece has only a Tutti file it plays the Tutti one; with no MIDI file the button isn't there.

    (e2e.)
54. **Delete.** `Sil` on a MIDI file (confirm `"<etiket>" silinsin mi?`) removes the row and the file; the detail no longer lists it. Deleting an `E2E` piece with MIDI files is allowed (no FK refusal: the files go with it, queued), whereas Phase 4's homework refusal on pieces stays.

    (e2e.)

### S10. Migration, quality and the test round

55. **Additive migration.**
    - `drizzle/0010_phase9_media.sql` (the name may differ) only creates tables, indexes and triggers on the new tables (four triggers, plain `INSERT` into the queue, amended D55); no `ALTER`, `DROP` or `__new_` rebuild of an existing table.
    - `npm run db:migrate` on a copy of a Phase 8b database succeeds and `db:check` passes.

    (script: grep the SQL; migrate a snapshot.)
56. **Constraints back the rules** (@dba designs): one current recording per (assignment, singer); recording size 1–4,194,304 and MIDI 1–1,048,576; a known stored type; note text 1–1000 after trim; one note per (recording slot, assistant); an assistant row only for an existing user, scope parts from the enum; MIDI label 1–60 or null; deletion-queue rows with a key and a state; FKs `restrict` to `users`, `cascade` from `assignments`/`pieces` only where the deletion queue still receives the key (via the action or a trigger, @dba's call). An invalid direct write fails at the DB.

    (e2e: a few direct inserts that must throw.)
57. **Phone, themes, accessibility.** At 375 px, in light and dark: the homework detail in every recorder state, `/odevler/dinle` (both roles), a review page (both roles), `/odevler/asistanlar`, `/odevler/depolama`, the piece detail with an open MIDI player and the edit page's MIDI section: no page-level horizontal scroll, targets ≥ 44 px (including the `Kimler görür, ne zaman silinir?` summary, amended D62). The recording timer is announced politely (not every second: at start, stop and the last minute), buttons have accessible names (`Kaydı durdur`, `Kaydını dinle`), meters use `role="meter"` (or progressbar) with a text value, and colours come from tokens only.

    (e2e + axe-core + grep for raw hex.)
58. **Performance at our scale.** On the dev server with 200 arranged recordings and 400 notes: the conductor's queue, an assistant's queue and `/odevler/depolama` answer in under 1 s; an upload of a 4 MB file completes in under 5 s locally.

    (e2e timing, loose.)
59. **Test round.**
    - `npm run e2e` is green with new files `e2e/phase9-a-record.mjs`, `e2e/phase9-b-review.mjs`, `e2e/phase9-c-storage.mjs`, `e2e/phase9-d-midi.mjs` (names may differ), launched with the D27 Chrome flags where they record.
    - `npm run e2e:prod` is green, including: the fault cookie and the recorder test hook are ignored, `asistan@arkhe.local` is refused in production, the bundle budget (AC 52).
    - `npm run lint` and `npm run typecheck` are clean.
    - The README has: the storage adapter and env vars (create a **private** Blob store, connect it to the project; Render fallback uses `BLOB_READ_WRITE_TOKEN`), the D22 backup sentence, "browsing the Blob store in the Vercel dashboard costs operations", and that `db:reset`/e2e wipe local uploads.
    - Results saved to `design/phase-9/e2e-results.txt`.

## 6. Out of scope (explicitly)

- **Review features:** grades or scores, time-stamped comments on the waveform, voice replies, assistant-to-assistant discussion, assistants seeing the conductor's comment, singers seeing assistant notes, a note to a whole part, reminders by email/push/WhatsApp.
- **Audio processing:** server transcoding, normalising loudness, trimming, noise reduction, waveforms, mixing a take with the MIDI.
- **Storage:** backing up audio anywhere, archiving to Drive, per-user quotas, Blob client uploads (files > 4 MB), the Vercel usage API.
- **MIDI:** soundfonts and realistic instruments, per-track volume, looping a bar range, metronome, bar numbers, sheet music rendering, converting MIDI to MP3, MusicXML. Moving the Drive part links into the portal.
- **Recording for things other than homework** (auditions, concert archives).
- **Changes to the homework CSV** in the monthly email (the `Durum`/`Teslim tarihi` columns already cover it).
- The Phase 7 backlog (`phase-7/review-po.md` §5) stays there.

## 7. Open questions for the team

All answered; see `po-decisions.md` D31–D63.

1. **@backend:**
   - Confirm server upload through a route handler for ≤ 4 MB on Vercel (body limit 4.5 MB), including multipart overhead; if the overhead is a problem, send the raw body with the metadata in headers.
   - The magic-byte sniffing per D6 (own code, no library), and how to get a duration: the client reports it after `loadedmetadata`, the server stores it clamped (0–600 s) and never trusts it for limits. Agree?
   - The fault hook and the 10-minute test hook (AC 16, AC 47) and how the sweep plugs into the cron route without changing the Phase 7 response (D18).
   - `@vercel/blob` version and OIDC on Hobby: confirm `get(..., { access: 'private' })` streams fine for 4 MB responses and returns a status we can map to D21.
2. **@dba:**
   - Tables for recordings (current + history with deletion dates, or current only plus a counter for D7's 5 uploads), assistant notes (keyed so a replaced take keeps its old notes, D8), assistants with scope, MIDI files, the deletion queue, and the usage log (D19).
   - Whether the deletion queue is filled by actions only or by `AFTER DELETE` triggers (safer for cascades from `assignments`/`pieces`).
   - The seed choice of D26 and the documented queue counts.
3. **@ux:** the recorder's states on a 375 px screen (one big button, the timer, the three post-recording actions), the queue/review loop with `Sonraki`, and where the transparency text sits without becoming a wall of words.
4. **@ui:** the MIDI player and recorder as client components loaded on demand; the level meter while recording (nice to have; cut it if it costs a library); `aria-live` behaviour of the timer; Wake Lock.

## 8. Open risks

1. **iPhone Safari recording quirks.** MediaRecorder exists since iOS 14.3, but an incoming call or locking the screen can stop it, and the `audio/mp4` output of some iOS versions has odd durations. Mitigation: Wake Lock, the in-memory take with `Kaydı indir`, the upload fallback, and a manual iPhone check (§9). If iOS recording proves unreliable, `Dosya yükle` with Voice Memos is the documented path.
2. **WebM/Opus playback on old iPhones.** A take recorded in Chrome on Android (WebM/Opus) may not play in Safari on iOS < 17 for the conductor. Most phones are newer; the conductor's `İndir` is the escape. Server transcoding is out of scope (no CPU budget).
3. **Storage in a heavy term** (§4 worst case 81%). Mitigations: warning, guard, 120-day rule, early clean. If it still fills, the decision for later is a shorter retention (e.g. 60 days), not a paid plan.
4. **Our counters drift from Vercel's.** Dashboard browsing, failed uploads and the CDN behaviour count on Vercel's side but not ours. The thresholds (80/95/100% of a pessimistic estimate) leave room; the README warns about dashboard browsing.
5. **Assistants become a social problem** ("why did she get to hear me?"). The transparency text names them, and the conductor owns the list. Not a software problem beyond that.
6. **Singers keep using `Teslim ettim` without a recording.** The fallback is a click deeper and the conductor's queue shows `Portalda kayıt yok`, so it's visible. Acceptable.
7. **Personal data (KVKK).** Voice is personal data. We store it privately, show who can hear it, delete it on a schedule, and never put it in backups or email. The README adds one line for the board: "Kayıtlar yalnızca ödev geri bildirimi için tutulur ve 90 gün sonra silinir."
8. **Web Audio and the iPhone silent switch** mute MIDI playback; recordings (`<audio>`) aren't affected. The hint covers it.

## 9. Go-live checks (manual, tech lead; not e2e)

1. Create a **private** Blob store in the Vercel dashboard (region closest to `arn1` if offered), connect it to the project for Production only, deploy.
2. On the live site, on a real iPhone (Safari) and an Android phone (Chrome): record 20 s, listen, send; the conductor plays both on an iPhone; replace one; delete one; play and download a MIDI file; check the silent-switch hint.
3. Upload a 3.9 MB voice memo from the iPhone Files app.
4. In the Vercel dashboard (once, sparingly), confirm the files are under the private store with UUID names and the usage numbers roughly match `/odevler/depolama`.
5. Next morning, confirm the cron log shows the sweep ran and the backup step behaved as in Phase 7.

## 10. Priorities if time runs short

Must, in order:
1. AC 1–3, 5, 6, 55, 56: private storage, authorization, headers, a safe migration
2. AC 7, 8, 10–13, 15: recording, submission, own playback, replace/delete and the comment lock
3. AC 18, 22–25, 27, 28, 30: assistants, their private notes, the conductor's comment, the leak checks
4. AC 38–40, 43, 45, 47: retention, no orphans, gauge, guard, no data loss
5. AC 49–51: MIDI upload, list and playback
6. AC 32, 34, 35, 37, 57, 59: the Phase 4 changes, phone/a11y and the test round

Should: AC 4, 9, 14, 16, 17, 19–21, 26, 29, 31, 33, 36, 41, 42, 44, 46, 48, 52–54, 58.

Could: none. Anything cut gets an entry in `po-decisions.md`; the phase can't be accepted with a Must missing.
