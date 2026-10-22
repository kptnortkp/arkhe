# Phase 9 implementation notes

## Backend (arkhe-backend)

Date: 2026-10-21. Scope: the server side of recordings, the assistant review flow, MIDI, storage and retention. The UI engineer builds the pages on top of these contracts. Spec order on conflict: `po-decisions.md` (D31–D63) → `po-spec.md` → `backend.md` / `db.md` → `ui.md` contracts.

### 1. What was built

- **Migration `drizzle/0010_phase9_media.sql`**, generated fresh with drizzle-kit from the DBA's schema. Then the four hand-written triggers of db.md §3 were appended.
  - Its CREATE part is byte-identical to the DBA's tested scratch file. It has 7 `CREATE TABLE`, 16 indexes and 4 triggers. A grep for `ALTER|DROP|__new_` finds nothing.
  - It is applied to `data/arkhe.db`, and `db:check` reports `migrations=11/11, quick_check=ok`.
  - `scripts/db-check.ts` gained the four Phase 9 invariants (db.md §10).
  - The schema's file constants (`RECORDING_TYPES`, `RECORDING_EXTENSIONS`, `RECORDING_MAX_BYTES`, `MIDI_MAX_BYTES`) moved to the isomorphic `src/lib/storage/limits.ts`, and `schema.ts` imports and re-exports them, like `lib/finance/categories`. A regenerate after the move reports "No schema changes".
- **Storage adapter (`src/lib/storage/`):**
  - `driver.ts`: `storage()` returns the request's driver with the fault wrapper, or `null` when nothing is configured. `storageConfigured()` is the same check without the cookie. The `StorageError` message is built from `op` and `kind` only.
  - `local.ts`: `data/uploads/` for `data/arkhe.db`, and `<dir>/uploads-<name>/` for any other file DB (so `e2e:prod` gets `data/uploads-e2e-prod/`). A put writes a `wx` temp file and then `link()`s it, so a key is never overwritten.
  - `blob.ts`: a private Vercel Blob store (`@vercel/blob` 2.8.2, loaded lazily). Errors are mapped with `instanceof`, because class names don't survive minification.
  - `root.mjs` (+ `.d.mts`): the pure root and key-path rule shared by the driver, `scripts/` and `e2e/`.
  - `sniff.ts`: the stricter rules of backend §3.3 for ftyp, MPEG with a second frame, ADTS with a second frame, WebM DocType, Ogg Opus/Vorbis, WAV `fmt `, and the MIDI chunk walk.
  - `hooks.ts`: the D21/D37 cookies `arkhe_e2e_storage_fault` and `arkhe_e2e_recorder_limit`. They are read only when `NODE_ENV !== "production"` and the DB URL (default `file:data/arkhe.db`) is `file:`.
- **Ledger (`ledger.ts`), the db.md §4.1 protocol:**
  1. Before a put, one batch writes the `put` event and a hold row with `not_before = now + 1 h`.
  2. The write transaction deletes the hold (it asserts exactly one row) and inserts the live row.
  3. Any failure releases the hold (`not_before = null`) and drains inline.

  `drainKeys()` never throws, and `drainQueue()` is the sweep's chunked drain.
- **Quota (`quota.ts`)**: one aggregate gives the four meters. `uploadsPausedFor()` checks the projected value (D20). `playbackPausedFor()` stops at 100% of the transfer or read count. `logDelivery()` counts only successful deliveries.
- **Sweep (`sweep.ts`)**: expire (`delete_on <= today`, or the early-clean cut of comment day + 30 ≤ today), then drain, prune and record a `storage_sweeps` row. It never throws.
- **Cron**: `src/app/api/cron/aylik-yedek/route.ts` runs the sweep **after** the backup step, isolated, with the deadline at the start + 55 s. The reply is unchanged, exactly `{ status }` (D53). `?bugun=` (dev only) also feeds the sweep's `today`.
- **Routes**, all under `/api/dosya/`, which is now out of the proxy matcher (D31):
  - `POST /api/dosya/kayit?odev=<id>` (§3 below)
  - `GET /api/dosya/kayit/<id>`
  - `GET /api/dosya/midi/<id>`
- **Visibility**: `src/lib/review/access.ts` holds the pure rules, and every route, query and action decides with them:
  - `canListen`: D43, an assistant loses the audio once the conductor has commented
  - `canDownload`: D44
  - `reviewRole`
  - `assistsFor`: in scope, never one's own take
  - `effectiveScope`: D9
  - `canWriteFeedback`, `canManageAssistants`, `canEarlyClean`

  These live here and not in `src/lib/permissions.ts`, which is outside my authorized files.
- **Queries**:
  - `src/lib/review/queries.ts`: queues, badge, counts, review pages, `Sonraki`
  - `src/lib/review/scope.ts`: `loadScope`, `listenersFor`
  - `src/lib/review/assistants.ts`
  - `src/lib/review/notes.ts`
  - `src/lib/homework/recordings.ts`: `loadSlot`, `myRecorder`, `rosterTakes`, `liveTakeCount`
  - `src/lib/homework/withdraw.ts`
  - `src/lib/storage/gauge.ts`
  - `src/lib/storage/files.ts`: the **only** `storage_key` readers
  - `src/lib/repertoire-midi.ts`
- **Actions**: listed in §4 with their exact names.
- **Seed** (`scripts/media-fixture.mjs`, called at the end of `seedHomework`):
  - `asistan@arkhe.local` as Demo Asistan, member, tenor, `joined_at = T − 1 h`, assisting Soprano + Alto
  - 7 recordings (6 WAV files on disk) and one note
  - E · Ayşe's conductor comment (added in `homework-fixture.mjs` as a normal fixture row)
  - Ave Verum Corpus' Tutti (4 named tracks) and Alto MIDI

  The expected counts are in the fixture's header comment: asistan@ `Dinlenecek` 3 and `Not yazdıklarım` 1; sef@ `Yorum bekleyen` 17, `Asistan notlu` and badge 1, `Yorumlananlar` 2. asistan@ is special-cased like `yeni@` in `seed.ts` (`choir`) and `finance-fixture.mjs` (dues roster).
- **e2e cleanup** (`e2e/lib.mjs`, appended in the db.md §12.1 order):
  1. `clearE2eMedia` deletes notes, takes, appointments and MIDI rows that point at `@e2e.test` users, right before those users are deleted.
  2. `seedHomework` (which ends with `seedMedia` and a reconcile)
  3. The storage bookkeeping tables are wiped.
  4. `reconcileLocalUploads`

  The reconcile deletes every file under `<root>/recordings|midi` that no live row references. A `.tmp-*` leftover goes too.
- **Config**:
  - `next.config.ts`: `Permissions-Policy` gets `microphone=(self)`.
  - `src/proxy.ts`: `media-src 'self' blob:`, and `api/dosya/` is out of the matcher. The page CSP is built in the proxy, not in `next.config.ts`, so D23's `media-src` change lives there.
  - `package.json`: `@vercel/blob` 2.8.2 and `@tonejs/midi` 2.0.28, both exact pins.
  - `.gitignore`: `data/uploads*/`.
  - `README.md`: the file store, env vars, the dashboard-operations warning, the D22/D58 backup sentences, the KVKK line and the e2e reset note.

### 2. Verified (scratch harness over HTTP, 185 checks, all green)

The harness is `scratchpad/backend9/verify.mjs`. It creates sessions directly in the DB and calls every action through a temporary dev-only route, which is now **deleted**.

- **Seed counts** match db.md §11 / D57 exactly: 3 / 1 / 17 / 1 / 1 / 2, and home counts `{waiting: 17, noted: 1}`.
- **Real bytes**, each stored with the detected type and the matching key extension:
  - `afconvert` m4a (`M4A ` brand) and ADTS `.aac`
  - Chrome MediaRecorder WebM/Opus and bare `audio/mp4` (Chrome gives `isom`/`iso6`)
  - WAV
  - generated MP3 (ID3 + Layer III frames) and Ogg Opus
  - generated MIDI

  PNG-as-m4a, text sent as `audio/mp4` and pseudo-random binary are refused with 415.
- **Upload limits and refusals:**
  - Size: 4,194,305 bytes gets 413 and 4,194,304 bytes is accepted (15 ms locally). An empty body gets 400 `empty`.
  - Origin: none or a foreign one gets 403 `origin`.
  - Who: logged out and inactive get 401; korist on F and the conductor get 403.
  - Idempotency: a replay with the same `X-Upload-Id` gets 200 with the same take and no second row. Another user's id gets 409.
  - Cap: the 6th upload gets 409 `limit`, deleted takes included.
  - Lock: after a comment, upload, `Sil` and `Geri al` all answer `Şef yorum yazdı; kaydını artık değiştiremezsin.`
- **Visibility matrix (AC 3, 20, 24, 25, 30):**
  - korist, sef and asistan get 200 with every D16 header and the exact bytes. yk, another alto and a tenor-only assistant get 404 with an empty body. Logged out and inactive get 401.
  - `?indir=1` gives the owner and sef `attachment; filename="Ave-Verum-Corpus-Demo-Korist.wav"`, and asistan 404.
  - Removed assistant: 404 at once. Re-appointed: 200.
  - The assistant's own take: 200 as owner, never in his queue even with all parts, and his review is null.
  - A singer moved to another part leaves his queue, and the audio and review go 404.
  - After the comment: assistant 404 (owner still 200), and his review has `recording: null`, his own note, and no comment text. After the comment is deleted: 200 again.
  - Each assistant's review data holds only his own note; sef's holds both. korist and yk get no review.
  - HTML of `/`, `/odevler`, `/odevler/<A>` and `/repertuvar` for korist, asistan and yk contains no storage key, no `data/uploads`, no Blob host and no note marker. `/data/uploads/<key>` and `/uploads/<key>` answer 404.
- **Writes:**
  - Notes: empty is refused with `Notunu yaz.` and 1001 characters with the length message. A stale `recordingId` gets the D49 sentence.
  - Replace: the old file is gone at once, `submitted_at` is unchanged, there is exactly one current take, the old take answers 410 to the owner and 404 to assistants, the item comes back as `retake`, and both notes show `previousTake`.
  - Stale comment: refused with the D49 sentence, and nothing is written. The board gets `Geri bildirimi yalnızca şef yazar.`
  - Comment lifecycle: sending sets `delete_on` to today + 90 (Istanbul), an edit keeps it, and deleting the comment sets it back to upload day + 120.
- **Delete paths:**
  - The singer's `Sil` removes the file and the self submission.
  - D47 manual mark: a take attaches without changing `method`/`marked_by`, and `Sil` keeps the mark.
  - Manager unmark: refused with a live take, allowed once the audio is gone, and the take then leaves the slot.
  - Conductor `Kaydı sil`: the submission stays, and the route answers 410. The board is refused.
  - `deleteAssignment`, `deleteMidi` and `deletePiece` remove the rows and the files.
- **Faults and missing files:**
  - `put` fault: 503 `storage`, no row, no hold left behind.
  - `get` fault: 503 with the D21 sentence.
  - `delete` fault: the action still succeeds, the file stays queued with `last_error = 'fault'`, and the next cron sweep removes it.
  - A missing file older than 10 minutes gets 410 and is marked `missing`. A fresher one gets 503 and stays unmarked.
- **Cron and early clean:**
  - The cron reply's keys are exactly `["status"]`, with and without the `delete` fault.
  - Retention: the 121-day take and the one commented 91 days ago go; the 119-day take stays until `?bugun=<its delete_on>`. Comments stay.
  - Every run writes a `storage_sweeps` row.
  - Early clean deletes the take commented 31 days ago and keeps the one from 29 days ago, with reason `early`. The comment stays, and the board is refused.
- **Quota:** at 95% storage, recording uploads get 503 `quota` and MIDI gets `Dosya alanı dolu; yeni dosya yüklenemiyor.` At 100% transfer, recording playback gets 503 while MIDI still plays.
- **MIDI**:
  - korist is refused.
  - The `Alto önde · Alto` title.
  - A replayed `uploadId` is a no-op.
  - Content: `MThx…` and 1,048,577 bytes are refused with our own messages (so the 1100 kb body limit holds).
  - Label: 61 characters is refused.
  - Count: the 21st file is refused.
  - The route sends `private, max-age=604800, immutable` and `Ave-Verum-Corpus-Alto.mid`, and answers 401 when logged out.
- **Cleanup** leaves exactly the 6 seeded WAVs and 2 MIDIs.
- `npm run lint` and `npm run typecheck` are clean.
- **Targeted e2e**: phase3, phase4 and phase7; see §6.

### 3. Contracts for the UI engineer

**Upload**: `POST /api/dosya/kayit?odev=<assignmentId>`.
- Body: the raw blob. Never multipart.
- Headers:
  - `X-Upload-Id`: a UUID made once per take and reused for `Tekrar dene`
  - `X-Recording-Duration-Ms`: optional. Use the recorder clock for recordings, `loadedmetadata` for files.
  - A browser XHR sends `Origin` itself. `page.request` must set `Origin: BASE`.
- Success: 201 for a new take, 200 for a replay of an id that already landed. The JSON is `UploadResult` from `src/lib/storage/limits.ts`:

  ```ts
  { id, uploadedAt /* ISO */, durationMs, sizeBytes, contentType, replaced, late, uploadsUsed }
  ```
- Failure: `{ error /* Turkish, show as is */, code: UploadCode }`, always `no-store`. Act on `code`:

  | `code` | Status | Meaning |
  |---|---|---|
  | `origin` | 403 | No or foreign `Origin` |
  | `auth` | 401 | Not signed in |
  | `bad_request` | 400 | Missing or invalid `X-Upload-Id` |
  | `not_found` | 404 | No such homework |
  | `forbidden` | 403 | Not responsible for the homework |
  | `locked` | 409 | The comment lock |
  | `limit` | 409 | 5 uploads used |
  | `conflict` | 409 | Another user's upload id |
  | `rate` | 429 | Too many uploads |
  | `empty` | 400 | Empty take |
  | `type` | 415 | Not a supported audio file |
  | `size` | 413 | Over 4 MB |
  | `quota` | 503 | Uploads paused (D20) |
  | `storage` | 503 / 500 | The put failed: keep the take, offer `Tekrar dene` and `Kaydı indir` |
  | `disabled` | 503 | No store configured |

  Vercel's own 413 is HTML, so map **any** 413 to the 4 MB message.

**Playback**: `GET /api/dosya/kayit/<id>` (`?indir=1` to download, owner and conductor only) and `GET /api/dosya/midi/<id>` (`?indir=1`).
- Statuses: 401 and 404 have empty bodies. 410 means the audio is gone, so refresh to show the deleted state. 503 `{ code: "quota" }` is the D20 playback sentence. Any other 503 or 429 means `Kayıt şu an açılamıyor…` or the `error` text.
- Fetch on tap, play from a `blob:` URL. The route sends `Accept-Ranges: none`.

**Server actions** (`FormState`; run them with `useRunAction` / `useActionState`):

| File | Action | Inputs |
|---|---|---|
| `odevler/actions.ts` | `saveFeedback(assignmentId, userId, prev, fd)` | **Changed.** Fields `feedback` and the new hidden `recordingId`: the current take's id, or `""` for `Portalda kayıt yok`. A member gets `FORBIDDEN`, the board gets `Geri bildirimi yalnızca şef yazar.` Toasts: `Yorum gönderildi.` / `Yorum güncellendi.` / `Yorum silindi.` |
| `odevler/actions.ts` | `undoSubmission(id)` | With a take this is the same as `Sil` (D47). |
| `odevler/actions.ts` | `setSubmissionFor(a, u, false)` | Refused with the D47 sentence while a live take exists. |
| `odevler/actions.ts` | `deleteAssignment` | Cascades the takes and notes and deletes their files. |
| `odevler/kayit-actions.ts` | `deleteMyRecording(assignmentId)` | The singer's `Sil`. Toast `Kaydın silindi.` |
| `odevler/kayit-actions.ts` | `deleteRecordingAsConductor(recordingId)` | D48. Toast `Ses dosyası silindi.` |
| `odevler/dinle/actions.ts` | `saveAssistantNote(assignmentId, singerId, prev, fd)` | Fields `note` and `recordingId` (the take on screen, required). The field error is on `note`. |
| `odevler/dinle/actions.ts` | `deleteAssistantNote(assignmentId, singerId)` | |
| `odevler/asistanlar/actions.ts` | `addAssistant(prev, fd)` | `userId`, `scope=all` or `parts[]`. The field error is on `parts`. |
| `odevler/asistanlar/actions.ts` | `updateAssistant(userId, prev, fd)` | Same scope fields. |
| `odevler/asistanlar/actions.ts` | `removeAssistant(userId)` | |
| `odevler/depolama/actions.ts` | `earlyClean()` | Returns `"<n> kayıt silindi."` |
| `repertuvar/midi-actions.ts` | `uploadMidi(pieceId, prev, fd)` | `file`, `part` (`tutti`, `soprano`, `alto`, `tenor`, `bass`; default `tutti`), `label`, and `uploadId` (one UUID per form mount; rotate it after a success). Field errors are on `file` and `label`. |
| `repertuvar/midi-actions.ts` | `deleteMidi(midiId)` | |

**Reads (all server-only):**
- **Recorder** (`@/lib/homework/recordings`):
  - `myRecorder(assignmentId, userId)` returns:

    ```ts
    { take, uploadsUsed, uploadsLeft, locked, canUpload, canDelete }
    ```
    `take` has `replacedEarlier` (for `Değiştirildi`), `audioDeletedAt`, `deletedReason` and `deleteOn` (`YYYY-MM-DD`).
  - `recorderMaxMs()` (`@/lib/storage/hooks`) gives the `data-max-ms` prop.
  - `uploadsPaused` comes from `storageWarning()` (`@/lib/storage/quota`).
- **Transparency**: `listenersFor({ id, voicePart })` (`@/lib/review/scope`) gives names only.
- **Roster**: `rosterTakes(assignmentId)` returns a `Map<userId, { id, durationMs, audioDeleted }>`.
- **Delete confirm**: `liveTakeCount(assignmentId)` gives `<k> ses kaydı`.
- **Queue** (`@/lib/review/queries`):
  - `conductorQueue(chip)` returns `{ rows, truncated }`. Show `Son 100 kayıt gösteriliyor.` only when `truncated`.
  - `assistantQueue(viewer, scope, chip)`.
  - `groupQueue(rows)`.
  - Chips are parsed with `conductorChip()` / `assistantChip()` from `?filtre=`. The values are `bekleyen | asistan-notlu | yorumlanan` and `dinlenecek | notlarim`.
  - `loadScope(user.id)` gives the scope. `canSeeQueue(viewer, scope)` (`@/lib/review/access`) is the page gate: redirect to `/odevler` otherwise.
- **Review page**:
  - `reviewFor(viewer, scope, assignmentId, userId)` returns a `ConductorReview`, an `AssistantReview`, or `null`, which means `notFound()`.
  - `nextReviewHref(viewer, scope, review, filtre)` gives the next href or `null` (`Bu listede başka kayıt yok.`).
  - Branch on `review.kind`. The assistant type has no comment text and no other notes. `recording: null` there means "no player" (D43).
- **Badges and home**:
  - `reviewBadgeCount()` is for the layout, **only when the role is the conductor**.
  - `conductorCounts()` gives `{ waiting, noted }`.
  - `assistantQueueCount(viewer, scope)` is for the assistant's home card and pill.
- **Assistants page**: `assistantList()` and `assistantCandidates()` (`@/lib/review/assistants`).
- **Storage page**:
  - `storageGauge(user)` (`@/lib/storage/gauge`) returns:

    ```ts
    { configured, meters /* key, used, limit, pct, state: "ok" | "warn" | "full" */,
      uploadsPaused, playbackPaused, lastSweep, earlyClean /* null for the board */ }
    ```
  - `storageWarning()` gives the banner's `{ pct, warn, full, uploadsPaused }`.
  - Limits and copy: `src/lib/storage/limits.ts` and `messages.ts` (`MSG`). Both are isomorphic.
- **MIDI** (`@/lib/repertoire-midi`):
  - `midiForPiece(pieceId, part | "all" | null)` returns rows with a ready `title`.
  - `midiForPart(pieceId, part)` prefers the part's own file and falls back to Tutti.
  - `midiForExactPart(pieceId, part)` decides the D59 hero button.
  - `midiCount(pieceId)` is for the 20 cap.

### 4. Decisions inside my scope

- **Order on the recording route**: 404 for no access comes before `?indir` (404), before 410, before the quota 503, the rate limit and the storage 503.
- **Assistants only reach the current take.** An old take answers 404 to them and 410 to the owner and the conductor.
- **The assistant review page needs a current take on a submitted slot.** Otherwise it is 404, which covers `Portalda kayıt yok`.
- **The conductor review page** is open for any singer who is responsible for the homework or holds a submission row. That is Phase 4's `targetAllowed`.
- **`Sonraki` walks by sort key**: due date descending, homework, S/A/T/B, name, id. It works even when the current item has just left the list.
- **`Yorumlananlar`** requires a submitted row, so Phase 4's "Kaydın gelmedi" note on a non-submission isn't listed. The list is ordered by `feedback_at` desc and limited to 100 (D51).
- **`saveFeedback`'s "first comment"** is the move from null to text. A legacy board note never gives a take a `commented_at`, because the lock prevents a take under it.
- **Unmarking a take without audio** sets `replaced_at` and clears `commented_at`. That keeps db:check invariant 1.
- **MIDI**:
  - A missing file answers 410, without marking anything (MIDI rows have no deleted state).
  - An empty file gets `Bu bir MIDI dosyası değil (.mid).`
  - Archived pieces accept uploads.
- **Rate limits** follow backend §12: 20 uploads/h, 300 listens/h, 600 MIDI fetches/h and 30 MIDI uploads/h per user. A refused attempt still counts.
- **The seed's keys** are cleared from the queue before and after the fixture re-inserts them. A key may be queued only once, which is the plain-INSERT trigger rule of D55.

### 5. For the tech lead (outside my authorized files)

1. **AC 42 / D22 email line.** `Ses kayıtları ve MIDI dosyaları bu yedeğe dahil değildir; kayıtlar 90 gün sonra zaten silinir.` still has to go into `src/lib/backup/email.ts`, before `Raporlar şifresizdir…`. I was authorized only for the sweep step in `src/lib/backup/*`. The README already has it.
2. **`bootWarnings`** (`src/lib/env.ts`) should get the storage line of backend §2.2. Its condition is `!isLocalDb && !blobConfigured`.
3. **8b former-member undo reference list** (db.md §10): add `recordings.user_id`, `assistant_notes.singer_id/assistant_id`, `listening_assistants.user_id/created_by` and `midi_files.created_by` in `src/lib/import/undo.ts`.
4. **`e2e/prod.mjs`** deletes `data/e2e-prod.db*` at the start but not `data/uploads-e2e-prod/`. The seed's reconcile cleans it anyway, so this is only tidiness.
5. **Phase 4 e2e checks that now fail by design** (D30, ui.md §9.4): the conductor's note toast is now `Yorum gönderildi.` / `Yorum silindi.` (`phase4-homework.mjs:456`, `:481`), and yk writing a note on B (`:471`) is refused (D3). The UI engineer edits these together with the roster sheet.

### 6. Targeted e2e (phase3, phase4, phase7)

Each suite ran with no other e2e run in parallel. The shared `cleanup()` and the UI engineer's 8b loop wipe each other's arranged rows, and one early phase4 run timed out at `14/22` for exactly that reason.

- **phase3**: 101/101.
- **phase7**: 136/136. This includes the cron reply shape, `{status}` only.
- **phase4 as committed**: passes up to `:456`, then stops on the D30 toast change. `Not kaydedildi.` is now `Yorum gönderildi.` (D63).
- **phase4 with only the D30 edits applied**: 112/112. Those edits are the two toasts (`:456`, `:481`), and yk's note on B arranged in the DB instead of written (`:471`, D3). It was a scratch copy; `e2e/` is untouched.
  - AC 10 still holds: a member calling `saveFeedback` gets `Bu işlem için yetkin yok.`
  - AC 8 still holds: `Geri al` under a note keeps Phase 4's `Şef geri bildirim yazdı; teslimi geri alamazsın.`, even with the seeded take in korist's E slot.
- **Before the runs** I grepped the Phase 1–8 suites for hard-coded active-member totals. The roster totals (`13/22`, `15/23`) count *expected* singers, and asistan@ joined T − 1 h, so he isn't expected anywhere. No other totals were found. He is excluded by email in `seed.ts` and `finance-fixture.mjs`, like `yeni@`.

### 7. Notes for the recorder

In headless Chrome, `MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2")` was true, but the recorder produced **0 bytes** from an oscillator stream. Bare `audio/mp4` and WebM/Opus produced real files, and the server accepts both.

If a stop yields an empty blob, fall back to the next type. The server answers an empty body with `400 { code: "empty" }`, `Kayıt boş görünüyor. Yeniden kaydet.`

## UI (arkhe-ui-engineer)

Date: 2026-10-21. Built on §3 above; po-decisions D31–D63 win. No backend logic changed.

### 1. What was built

- **Recorder** (`src/components/recording/`):
  - `recorder.tsx`: the state machine. `data-state` is one of `idle`, `unsupported`, `denied`/`nomic`/`busy`, `countdown`, `recording`, `recorded`, `uploading`, `failed`, `sent`, `locked`, `gone`. Root also carries `data-max-ms`, `data-level` and `data-take-bytes`.
  - `use-media-recorder.ts`: the D34 order; a 700 ms probe per type during the silent 3 s count-in (D39); 48 kbps mono; `start(1000)`; the hard stop; wake lock; `visibilitychange` and track `ended` keep the chunks (D40); the level meter (`AnalyserNode`, 32 bars, `aria-hidden`) and the two hints.
    - Headless Chrome's AAC encoder sometimes probes fine, then fires `EncodingError` before its first chunk. The recorder then marks the type broken and restarts the same take with the next type. An empty final blob gives `Kayıt boş görünüyor. Yeniden kaydet.`, and the next take uses the next type.
  - `take-store.ts`: a module-level `Map`, keyed by user and homework. It is cleared on send, on `Yeniden kaydet`, and on logout through the new `shell/logout-form.tsx`, used by the sidebar and Profil.
  - `upload.ts`: raw-body XHR with progress and abort. Any 413 maps to the 4 MB message.
  - `audio-player.tsx`: fetches on the first tap and plays from a `blob:` URL. Shows `Kayıt hazır; oynatmak için dokun.` when iOS refuses `play()`. 410 triggers a refresh. Distinguishes the playback quota from other errors.
  - `media-bus.ts`: one player at a time.
  - `listeners-note.tsx`: the D11 line and disclosure, with a 44 px summary (D62), plus `FallbackDetails` (`#baska-yolla`).
- **Homework detail**:
  - Two steps (D61): `MIDI'yi çal` with the Drive part as a text link (`PartButton asLink`), or the Phase 3 hero.
  - When submitted, the card is titled `Teslimin`.
  - The fallback holds `MailBlock` (what is left of `singer-steps.tsx`) and `SubmitToggle`. It opens by default when uploads are paused, and is hidden once locked.
- **List and home**:
  - Rows and the home card show the `Kaydını yap` link (`data-testid=record-link`). `SubmitRowButton` is removed.
  - Home `Dinleme` card (`review/home-card.tsx`). Home piece rows link to `?cal=1` when a portal MIDI exists for my part (D59).
- **`/odevler` header** (D60):
  - `Dinleme` with a count pill (`review/listen-link.tsx`) for the conductor and assistants.
  - `Ayarlar` menu (`homework/homework-settings.tsx`). `RecordingEmailDialog` can now be controlled.
  - Storage banner for managers.
- **Review**:
  - `/odevler/dinle` with `loading.tsx`, using `review/queue.tsx`.
  - `/odevler/[id]/dinle/[userId]`, using `review/review-forms.tsx` and `review/review-guard.tsx`. `Sonraki`, the BackLink and the eyebrow link are guarded (D41, `Kal`/`Geç`). `ConfirmDialog` got a `cancelLabel` prop.
  - Roster: a sibling `Kayıt · 0:05` element, a link for the conductor and a plain span for the board. The board's sheet has the mark plus a read-only old note.
  - The conductor keeps the Phase 4 sheet note form, now with the hidden `recordingId`, plus a `Dinle ve yorum yaz` link.
  - The homework delete confirm counts takes.
- **`/odevler/asistanlar`**: `review/assistant-sheet.tsx`, with a searchable radio list grouped by part and exclusive `Tüm partisyonlar` chips. The default scope is the person's own part.
- **`/odevler/depolama`**: `storage/meter.tsx` (`role=meter`, a state word, decimal units), `storage-banner.tsx` and `early-clean.tsx`. The button's accessible name is the PO string.
- **MIDI** (`src/components/midi/`):
  - `midi-button.tsx` creates the `AudioContext` inside the tap and runs `import("./midi-player")`.
  - `midi-player.tsx` is the lazy chunk, carrying the `arkhe-midi-player` marker. It uses `@tonejs/midi` with `synth.ts` (triangle voices, lookahead scheduler over score time). It has tempo radios, track checkboxes with `data-muted`, `Yalnız Alto` / `Alto'suz`, and compact mode in the homework.
  - `midi-list.tsx` serves the piece page; `midi-editor.tsx` the edit page, with a single-file form, the name guess, and an `uploadId` that rotates after success.
  - Production chunk: **12.6 KB gz**.
- **Badge**: the layout passes `review` (`reviewBadgeCount()`, conductor only). The Ödevler entry shows the homework badge, else `data-review-badge` with `, <n> kayıt asistan notuyla bekliyor`.

### 2. Deviations (decide or keep)

- **Fake microphone.** Chrome 155 on macOS lists the D27 fake devices, but its `getUserMedia` never settles, with any flag combination (tried: fake UI, auto-accept, audio in process, no sandbox, headed).
  - `e2e/media.mjs` `fakeMic()` therefore swaps `getUserMedia` for a stream that loops the test's generated WAV through Web Audio. MediaRecorder, XHR, the route, the local driver and the DB all run for real. The D27 flags stay on the launch.
- **The player chunk in dev.** Turbopack dev puts every async chunk in the page's script tags, so the "no chunk before the tap" check runs in `e2e:prod`, where it passes (0 → 1 request). Dev checks only that there is no MIDI fetch and no player before the tap.
- **Not built (nice-to-haves from ux):**
  - multi-file MIDI upload (ux §9.3 allows single-file)
  - the `· Kayıt 1:32` suffix on singer list rows
  - the `Kayıtlar … · MIDI …` breakdown under the Depolama meter
  - the single-bar meter for reduced motion (the bars are hidden; the hints remain)
- **`?cal=1`** shows the hero with `Çalmak için yukarıdaki düğmeye dokun.` instead of a pre-rendered player shell, because the chunk must not load before the tap.
- **Redirects and `notFound()`.** Under the `/odevler` and `/repertuvar` loading boundaries these stream, giving a 200 status and then a client redirect or the 404 page. The tests wait for the URL or match `Sayfa bulunamadı`. The server-side checks are unchanged.

### 3. Tests

- **New suites:**
  - `phase9-a-record.mjs`: 70 checks. Own Chrome; AC 1, 6–17, 34–36, 47, 57, 58 (upload).
  - `phase9-b-review.mjs`: 88 checks. AC 2, 3, 18–33, 57; includes the visibility matrix and the marker leak greps.
  - `phase9-c-storage.mjs`: 43 checks. AC 38–48, 42 (README), 57, 58.
  - `phase9-d-midi.mjs`: 39 checks. AC 4, 49–54, 57.
  - Total: 240/240.
- **Helpers:** `e2e/media.mjs` has the generated WAV, MP3, PNG and MIDI fixtures, arranged takes, notes, comments and assistants, `go()` (waits for hydration and for the end of loading skeletons), axe, and the 44 px and overflow probe.
- **`prod.mjs`:** gained the Phase 9 block:
  - bundle ≤ 60 KB gz, not in the initial HTML, loaded on the tap
  - `microphone=(self)` and `media-src 'self' blob:`
  - the recorder and fault cookies ignored
  - `asistan@` refused

  `removeDb()` also deletes `data/uploads-e2e-prod/`. Result: 63/63.
- **D30 edits to `phase4-homework.mjs`** (for `review-fixes.md`):
  - AC 22: the home card expects `record-link` → `/odevler/<D>#kayit`.
  - AC 4: open the fallback before the mailto, and check for two steps (D61).
  - AC 12, 6, 7, 11, 16, 17: `openFallback()` before `Teslim ettim` / `Geri al`. Role queries skip a collapsed `<details>`.
  - AC 6, list half: replaced by the `Kaydını yap` link check. There are 111 checks instead of 112, because two checks became one.
  - AC 17:
    - the conductor's toasts are `Yorum gönderildi.` / `Yorum silindi.` (`:456`, `:481`)
    - the board note on B is arranged in the DB (D3, `:471`)
  - AC 20:
    - the email dialog opens from `Ayarlar` → `Kayıt e-postası…` (D60)
    - the new-address mailto is checked on C, because B's old board note locks B (D46)
- **Phase 5 AC 13:** `scripts/finance-fixture.mjs` waives `asistan@`'s current period (`Demo hesap`) when he exists, and the expected 18 is unchanged.
- **Phase 7:**
  - `phase7-a-cron.mjs` lists the AC 42 line and checks that it comes right before `Raporlar şifresizdir…`.
  - `phase7-c-restore.mjs` checks that the decrypted dump holds the `assistant_notes` and `recordings` rows.
  - Phase 8-c needed no change, because it checks the line after `Gelir:`.
- **Targeted runs:**

  | Suite | Result |
  |---|---|
  | phase3 | 101/101 (one earlier run had the known flaky focus check) |
  | phase4 | 111/111 |
  | phase5 | 118/118 |
  | phase7 | 138/138 |
  | phase8-c | 10/10 |
  | phase9 | 240/240 |
  | `e2e:prod` | 63/63 |

  `npm run lint` and `npm run typecheck` are clean.
- **Screenshots:** `scratchpad/p9shots/` at 375 px light and dark and at 1280 px, covering the recorder states, queue, review, asistanlar, depolama, piece with player, MIDI editor and home.
