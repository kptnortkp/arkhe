# Phase 9 PO decisions

Author: PO. Date: 2026-10-21. Settles every "@po" point in `ux.md`, `ui.md`, `backend.md` and `db.md`, and the disagreements between them. Spec decisions are D1–D30; these continue at D31. Where this file is silent, the role file that owns the topic stands (ux: copy, flows and visuals; ui: components, a11y and e2e mechanics; db: schema, queries and seed; backend: routes, actions, adapter and security). This file overrides all of them. Changed ACs in `po-spec.md` are marked `(amended Dn)`. AC numbers are unchanged (1–59).

**File check (tech lead's request):** `ui.md` is intact. It has 474 lines, sections 1–11 in order, a complete §11 Replies, no conflict markers, and no duplicated or cut paragraphs. The only stale line is its header ("ux.md, db.md and backend.md don't exist yet"). The other three files are now in, and I reconcile against them below.

**Migration order:** `0008` (Phase 8) is in the repo, `0009` is Phase 8b and `0010` is Phase 9. Phase 9 builds on top of 8b, so 8b's `serverActions.bodySizeLimit: "1100kb"` will exist when Phase 9 is built (D32).

## 1. Decisions

### Transport and platform

**D31. `/api/dosya/` comes out of the proxy matcher** (ui facts, backend §9). Agreed by both.
- Why: the proxy overwrites every matched response's CSP, which would wipe the `default-src 'none'; sandbox` header (AC 3). It also buffers each 4 MB body in memory for nothing.
- The routes check the session themselves, as every `/api/` route already does.

**D32. MIDI upload is a server action, not a route handler** (backend §4 over ui §3).
- `uploadMidi` uses `FormData`, `useActionState` and `revalidatePath`, and relies on 8b's `bodySizeLimit: "1100kb"`.
- Why:
  - A 1 MB file needs no progress bar.
  - Next's built-in Origin check and the edit page's existing form pattern come for free.
  - 1,048,577 bytes plus multipart still reaches our code, so AC 49 gets our Turkish message.
- If 8b's line is somehow missing when Phase 9 is built, Phase 9 adds the same line. It does not raise the limit further.

**D33. Recording upload: a raw-body route handler with XHR progress** (backend §3, ui §3). Agreed.
- `POST /api/dosya/kayit?odev=<id>`, with metadata in headers and `uploadId` reused for `Tekrar dene`.
- Why XHR: `fetch` reports no upload progress in Safari.
- For e2e: `page.request.post` sends no `Origin`. Uploads made through `page.request` must set `Origin: BASE`; AC 6's cross-origin test omits it or sends a foreign one.

**D34. MediaRecorder type order** (ui §2.2, amends D6). The order is `audio/mp4;codecs=mp4a.40.2`, then `audio/webm;codecs=opus`, then `audio/mp4`, then `audio/ogg;codecs=opus`.
- Why: bare `audio/mp4` on Chrome may be Opus-in-MP4, which older iPhones can't play.
- With this order, iPhones and AAC-capable Chrome give MP4/AAC, and everything else gives WebM/Opus.

**D35. Duration is display data only** (ui §2.5, backend §3.4). Agreed.
- Recordings send the recorder's own clock.
- Picked files use `loadedmetadata`, with the seek fallback.
- The server clamps the value to 0–600,000 ms and never uses it for limits. Unknown shows `—`.

**D36. `@tonejs/midi@2.0.28` (MIT, pinned) parses MIDI; the synth is ours** (backend §11 over ui §7.2).
- Why:
  - Tempo maps, running status, velocity-0 note-offs and overlapping notes are where hand-written parsers go wrong.
  - The library costs about 6 KB gz more than ui's own parser.
  - The whole chunk is about 15 KB gz, against the 60 KB budget.
- ui's player API doesn't change. The fallback, if the library ever has to go, is `midi-file` plus a tempo map (backend §11).

**D37. Other backend platform choices are accepted as written.**
- `@vercel/blob@2.8.2`, pinned. Its licence is Apache-2.0, which is free and permissive and meets "MIT or similar".
- The adapter returns `null` when nothing is configured.
- Sniffing is our own code, with the stricter second-frame/DocType/packet rules.
- 1 GB is counted as 10⁹ bytes, and the uploads guard checks the projected total.
- The rate limits of backend §12.
- Test-hook cookies `arkhe_e2e_storage_fault` and `arkhe_e2e_recorder_limit`, under the D21 predicate.
- The logging rules of backend §14.

### Recorder behaviour

**D38. A picked file goes to preview before upload** (ui §2.1 over ux §2.2). Picking shows the file's player with `Gönder` / `Başka dosya seç`; nothing uploads until `Gönder`.
- Why: Voice Memos lists look like "Yeni Kayıt 14, 15, 16". A wrong pick would cost one of the 5 uploads (D48) and a Blob operation, and the conductor would get last week's take. One extra tap is worth it.
- The client-side 4 MB and empty-file checks of ux §2.2 still run at pick time, before preview.
- (amends AC 9)

**D39. A silent 3-second count-in** (ux §0.2): `Hazırlan… 3 · 2 · 1` with `Vazgeç`. The level meter runs during it.
- Why: it keeps the tap noise out of the take and answers "does the mic hear me?" before anything is recorded.
- It is not configurable. e2e waits for it (AC 7).

**D40. Keeping an unsent take** (ui §2.6 over ux's link interception).
- The take lives in ui's module-level `Map`, so in-app navigation (e.g. `Esere git`, then back) brings it back with `Gönderilmemiş bir kaydın var.` The Map is cleared after a successful send, by `Yeniden kaydet`, and at logout.
- **No interception of the tab bar, sidebar or BackLink for the recorder.** The take isn't lost there, so a warning saying "çıkarsan kayıt silinir" would be false.
- `beforeunload` covers reload, closing the tab and leaving the site.
- While recording, `visibilitychange` (screen lock or a call) stops the recorder and keeps the chunks: `Ekran kilitlendiği ya da başka uygulamaya geçtiğin için kayıt durdu. Kaydın burada: dinle, gönder ya da yeniden kaydet.`
- An interruption from the device (track `ended`, `onerror`) shows `Kayıt yarıda kesildi; kaydedilen kısım duruyor.`
- Wake Lock: best effort, re-acquired on return.

**D41. Dirty-text guard on the review page** (ux §0.4, ui §5.2). If the textarea differs from the saved text, `Sonraki` and the BackLink open a confirm dialog with `Kal` / `Geç`. The title is `Notun kaydedilmedi. Kaydetmeden geçilsin mi?` for an assistant and `Yorumun gönderilmedi. Yine de sonrakine geçilsin mi?` for the conductor.
- The tab bar isn't intercepted.
- Why: losing a typed comment in a 40-take loop is the one thing that would make the conductor go back to email.

**D42. The 5-upload count includes withdrawn and deleted takes** (db §13.4, backend). Agreed. It counts uploads, not current recordings.
- The recorder says `<n>/5 yükleme` once n ≥ 3.
- The preview of the 5th says `Bu son yükleme hakkın.`
- (amends AC 14)

### Review rules

**D43. An assistant's access ends with the conductor's comment** (backend §16.5). From then on `/api/dosya/kayit/<id>` answers 404 for them. Their review page shows only their read-only note and `Şef yorumunu gönderdi.`, with no player. If the conductor deletes the comment, access returns along with the queue item.
- Why: data minimisation. Their review job is done, and a singer's voice shouldn't stay reachable for 90 more days by people who no longer review it.
- (amends AC 3, AC 25)

**D44. Only the owner and the conductor can download** (`?indir=1`). Assistants get 404 on `?indir=1` and see no `İndir`.
- Why: it makes the intended use clear. It's friction, not a wall.
- (amends AC 3)

**D45. The board still reads comment text in the manager views** (backend §16.6): Phase 4 behaviour is unchanged. The board never sees assistant notes, their counts or their authors.
- Why: D3 takes away the board's pen, not its eyes. The board already reads every feedback text today and gets it in the encrypted backup, so hiding it now would protect nothing.
- (AC 30's board clause covers assistant notes only)

**D46. The comment lock is any feedback, legacy board notes included** (backend §16.8).
- Why: it is one rule, the same as Phase 4's undo lock. A conductor who wants to unlock a singer deletes the old note.

**D47. Withdrawing and unmarking** (backend §7.3, db §13.2–3).
- The singer's `Sil`, and the fallback `Geri al` while a take exists, withdraw the take. They are the same action: the audio is deleted and the submission is cleared.
- **Exception:** if the submission is a manager's manual mark (`method = 'manual'`), `Sil` removes only the take, and the mark stays. The mark existed before the take and isn't the singer's to undo by deleting audio.
- A manager's `Teslim edilmedi` is refused while a live take exists: `Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil.` Once the audio is gone it's allowed, and the take leaves the slot.
- (amends AC 12, AC 36)

**D48. The conductor's `Kaydı sil` keeps the submission** (ux §0.7).
- `submitted_at` and `method` stay. The audio shows `Ses dosyası silindi (<tarih>). Yorumlar duruyor.`, the same state as retention, so there is no new state.
- Confirm: title `"{Ad Soyad}" kaydı silinsin mi?`, body `Ses dosyası hemen silinir. Teslim, notlar ve yorum kalır.`, buttons `Vazgeç` / `Sil`.
- Why: the singer did hand it in. Deleting it (e.g. a wrong file, or freeing space) mustn't turn them into "Gecikti".
- (amends AC 40)

**D49. Stale-take refusals**, as in backend §7. The forms carry the `recordingId` that was on screen. If the singer replaced the take in between:
  - an assistant's save gets `Kayıt bu arada değişti. Yeni kaydı dinleyip notunu kaydet.`
  - the conductor's send gets `Korist bu arada kaydını değiştirdi. Yeni kaydı dinleyip yorumunu gönder.`
  - Nothing is written.
- Why: a comment must be about the take the singer will associate it with.

**D50. `Portalda kayıt yok` lists only homework due in the last 30 days** (db §5.7).
- Takes with live audio are always listed, whatever their age.
- Why: otherwise every historical Phase 4 submission without a comment floods the conductor's default chip on day one, and the chip never empties. Older submissions stay reachable from the homework's roster.
- (amends AC 27)

**D51. `Yorumlananlar` shows the newest 100** (ui §5.1 over ux's 60 days). Under the chips it says `Son 100 kayıt gösteriliyor.`, but only when the list is cut.
- Why: a count cap is bounded whatever the term's volume, and it is deterministic for e2e. 60 days in a heavy term is 300+ rows on a phone. Older comments are reachable from each homework's roster.

**D52. The comment stays at 1000 characters** (ui §5.2).
- Why:
  - The Phase 4 CHECK `submissions_feedback_length` enforces 1000, and changing it means a table rebuild, which constraint 1 forbids.
  - A phone comment over 1000 characters is a lecture, not feedback.
- `Yoruma ekle` is disabled, with `Yorum 1000 karakteri geçer.`, when the result would be longer. When it succeeds, the live region says `Not yoruma eklendi.`

### Retention, cron and data

**D53. The cron response stays exactly `{ status }`** (backend §8.4; amends D18).
- `e2e/phase7-a-cron.mjs:186` asserts the keys are exactly `["status"]`, and I won't edit a Phase 7 check for this.
- The sweep runs after the backup step, isolated and with a deadline. Its result goes into a `storage_sweeps` row and the log. AC 41 reads it there and on `/odevler/depolama`.
- (amends D18, AC 41)

**D54. Store `delete_on`; compute it in Istanbul days** (db §13.9 for storage, backend §8.2 for semantics).
- `delete_on` is set in the same transaction as each event:
  - upload: upload day + 120
  - first comment: comment day + 90
  - comment deleted: back to upload day + 120
- Editing the comment doesn't change it. The sweep is `delete_on <= today`.
- Why: the date the page promises is the date that's stored, and if the policy changes later, existing promises stay as shown. Backend's worked example is the reason for using Istanbul days.

**D55. Queue triggers use a plain `INSERT`, not `INSERT OR IGNORE`** (db §3 over backend).
- Why: `OR IGNORE` also swallows CHECK failures, which would orphan a file silently. Duplicates can't happen (fresh UUID keys, final audio deletion).

**D56. A missing object: 410 and mark it `missing`, after a 10-minute grace** (db §10 over backend §5.1, with a guard).
- If `get` returns `null` and the take was uploaded more than 10 minutes ago, the row is marked `audio_deleted_at = now`, `deleted_reason = 'missing'`, and the route answers 410. The UI then shows the normal "silindi" state.
- Within 10 minutes of the upload, the route answers 503 `storage` and marks nothing.
- Why:
  - The real case is a restore into a fresh store, where the file is gone for good. A permanent 503 would keep offering a player that never works, and the storage meter would count bytes that don't exist.
  - The grace window covers any read-after-write lag right after an upload.
- Authorization still comes before existence (404 first).

**D57. Seed** (db §11).
- E · Ayşe Öztürk gains a conductor comment. korist@'s E audio is deleted with reason `conductor`, not `retention`; db's reason is right (a retention delete before its own `delete_on` is inconsistent).
- `asistan@` is special-cased exactly like `yeni@` in `seed.ts` (the `choir` filter) and `finance-fixture.mjs` (the dues roster).
- **Tech lead:** before the first full run, grep Phase 1–8 e2e for hard-coded active-member totals (the Üyeler count, roll-call totals, dues rosters). Treat any you find like `yeni@`: exclude him by email in the fixture, never by changing the expected number.
- The expected counts in db §11 (asistan@ `Dinlenecek` 3; sef@ `Yorum bekleyen` 17, badge 1, `Yorumlananlar` 2) go into the fixture's header comment and are what the ACs compare against.

**D58. README backup wording** (db §13.8). Next to "audio isn't included" it says: `Şifreli yedek, asistan notlarını ve şefin yorumlarını da içerir; ses ve MIDI dosyalarını içermez.` The README also gets the KVKK line from spec risk 7.
- The email sentence of D22 is unchanged. The email goes to the backup recipients, who already receive all feedback in the dump.

### Navigation and screens

**D59. The piece page's main button plays the portal MIDI** (ux §0.6; amends D24).
- When a portal MIDI exists for my part, the hero button is `Partisyonumu çal (Alto)` and plays inline. The Drive part link stays in its row under `PARTİSYON KAYDI`. With no portal MIDI for my part, the hero is Phase 3's Drive button, unchanged.
- The home `Çalışılan eserler` rows link to `/repertuvar/<id>?cal=1`, which opens the player ready to start on tap.
- Why: this is the user's MIDI request in one tap. Today the same button opens a `.mid` file that iOS can't play.
- Phase 3 AC 4's `Partisyonum` check applies only when no portal MIDI exists for the part. Any edited Phase 3 check goes on the D30 list.
- (amends AC 50, AC 53)

**D60. The `/odevler` header** (ux §3). Per role:
- Conductor: `Dinleme` with a count pill (the `Yorum bekleyen` n), `Teslim matrisi`, and an `Ayarlar` menu holding `Asistanlar`, `Depolama` and `Kayıt e-postası…`.
- Board: `Teslim matrisi` and `Ayarlar` (`Kayıt e-postası…`, `Depolama`).
- Assistant: `Dinleme` with a count pill.

Why: five buttons don't fit at 375 px, and the settings are weekly-at-most actions. The pill replaces the spec's `Dinleme (<n>)`. (amends AC 22)

**D61. The homework detail has two steps** (ux §0.1): `Partisyonunu dinle` and `Kaydını yap`. Step 3 (`Gönderdiysen işaretle`) goes, because sending is submitting (D1), and `Teslim ettim` lives in the fallback.
- The queue gets a primary `Dinlemeye başla (<n>)`, and the home cards link straight to the first item.
- The Phase 4 "steps 1–3 visible" check goes on the D30 list (ui §9.4 is that list; the tech lead copies it into `review-fixes.md` and adds this row).

**D62. Tap targets** (AC 57). ux §2.10 gives the `Kimler görür, ne zaman silinir?` summary `min-h-8`. It must be `min-h-11` (44 px), like every other target.

### Copy

**D63. Final copy changes** (ux §0.5, backend §16.9, ui new strings). Everything not listed stays as written in `ux.md` §12 and the spec.

| Where | Final |
|---|---|
| Conductor's comment field | label `Yorumun`, help `Gönderdiğin an {Ad Soyad} görür. Asistan notları ona gitmez.` (replaces `Korist'e yorumun`) |
| Conductor chip | `Asistan notlu` (replaces `Asistan notu olanlar`); the others stay `Yorum bekleyen` · `Yorumlananlar` |
| Header link | `Dinleme` + count pill (replaces `Dinleme (<n>)`) |
| 4 MB | `Dosya en fazla 4 MB olabilir. Daha kısa bir kayıt seç ya da burada Kayda başla ile kaydet.` |
| Wrong type | `Bu dosya bir ses kaydı değil ya da türü desteklenmiyor. Telefonunun ses kaydedicisinden bir kayıt seç (m4a, mp3, wav…).` |
| Empty file | `Bu dosya boş. Başka bir kayıt seç.` |
| Empty take (server) | `Kayıt boş görünüyor. Yeniden kaydet.` |
| Mic denied | title `Mikrofon izni verilmedi.` + platform steps (ux §2.3); the AC 17 sentence is the accessible description |
| Mic not found / busy | `Mikrofon bulunamadı.` / `Mikrofon şu an kullanılıyor.` with ux §2.3 bodies |
| No recorder | `Bu tarayıcı kayıt yapamıyor; Dosya yükle'yi kullan.` + `Bağlantıyı WhatsApp ya da Instagram içinden açtıysan Safari'de ya da Chrome'da aç.` |
| Offline / network | `İnternet bağlantın yok gibi görünüyor. Kaydın kaybolmadı: bağlanınca tekrar dene ya da Kaydı indir ile telefonuna kaydet.` (ux wording; ui's variant dropped) |
| Interrupted / screen lock / unsent | D40 sentences; `Gönderilmemiş bir kaydın var.` |
| Upload count | `<n>/5 yükleme`, `Bu son yükleme hakkın.` |
| iOS autoplay | `Kayıt hazır; oynatmak için dokun.` |
| Silence / clipping hints | ui §2.3 sentences as written |
| Rate limits | `Çok sık yükleme yaptın. Biraz sonra tekrar dene.` / `Çok sık dinleme isteği. Biraz sonra tekrar dene.` |
| Stale take | D49 sentences |
| Manager unmark | `Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil.` |
| Note empty | `Notunu yaz.` |
| Assistants | `Bu kişi asistan olamaz.`, `Bu kişi zaten asistan.`, `Asistan bulunamadı.`; empty `Henüz dinleme asistanı yok. Asistanlar senin seçtiğin partisyonlardaki kayıtları dinleyip sana not yazar.` |
| Not found | `Kayıt bulunamadı.`, `Dosya bulunamadı.` |
| MIDI | `Bu MIDI dosyası çalınamıyor.`; toasts `Dosya yüklendi.` / `Dosya silindi.` |
| Toasts | `Kaydın gönderildi.`, `Kaydın değiştirildi.`, `Kaydın silindi.`, `Notun kaydedildi.`, `Notun silindi.` (backend's `Not silindi.` dropped), `Yorum gönderildi.` / `Yorum güncellendi.` / `Yorum silindi.` |
| Empty queues | `Yorum bekleyen kayıt yok.`, `Dinlenecek kayıt yok.` |
| Comment cap | `Yorum 1000 karakteri geçer.`, live `Not yoruma eklendi.` |
| Review guard | D41 sentences |
| Conductor `Kaydı sil` | D48 confirm |
| Generic | **keep Phase 4's** `Bir şeyler ters gitti, tekrar dene.` (ux's `Bir sorun oldu. Tekrar dene.` dropped: one voice across the app) |
| Transparency | ux §2.10 as written (one visible line plus the `details`); the D11 sentences stay in the DOM for AC 7/21 |

## 2. Agreements recorded without change

- The schema of db §2 (`recordings` with `replaced_at`, `replaces_id`, `commented_at`, `delete_on`, `deleted_reason`; `assistant_notes` PK (assignment, singer, assistant) with a non-cascading `recording_id`; `listening_assistants` with one row per part; `midi_files.voice_part` null = Tutti; `storage_deletions`, `storage_events`, `storage_sweeps`). The four triggers, the hold row instead of an `uploading` state, and the `db:check` additions.
- `saveFeedback` is conductor-only and sets or clears `commented_at`/`delete_on` in the same `writeTx`.
- The role-shaped query functions and DTOs (ui §5.1, backend §6). The assistant's types have no field for other people's notes or the comment text.
- The cleanup order around `seedHomework` (db §12.1, ui §9.2). One uploads root per database (`data/uploads-e2e-prod/` for `e2e:prod`).
- The recording suites launch their own Chrome with the D27 flags (ui §9.1).
- The level meter (`AnalyserNode`, `aria-hidden`, two announced hints). `role="timer"` plus one polite region. The recorder is not lazy-loaded (it is the page's main action and iOS needs the gesture); the MIDI player is.
- `Accept-Ranges: none` and `Cross-Origin-Resource-Policy: same-origin` on file responses.
- Backlog only: early deletion of a leaver's audio (backend §16.12).

## 3. Nothing cut

Every AC from 1 to 59 stays. The amended ones are 3, 6, 7, 9, 12, 14, 22, 25, 27, 28, 36, 40, 41, 49, 50, 53, 55 and 57. In the spec body, D6, D17, D18 and D24 are amended too.
