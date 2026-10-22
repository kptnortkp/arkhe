# Phase 9 review fixes

## Backend (arkhe-backend)

Date: 2026-10-21. This covers `review-backend.md` P2-1, P2-2 and the cheap P3s, UX P2-4 (the query side) and tech lead decision TL1. `npm run lint` and `npm run typecheck` are clean, and `db:check` passes on the dev DB (`migrations=12/12`).

### Migration 0011 (additive)

`drizzle/0011_phase9_review.sql` is one statement:

```sql
ALTER TABLE `storage_events` ADD `area` text CONSTRAINT "storage_events_area_check" CHECK(area is null or area in ('recording', 'midi'));
```

- **Why a migration:** P2-2 needs MIDI deliveries kept apart from recording deliveries. A new `kind` value would mean editing the 0010 CHECK, which in SQLite is a table rebuild. An additive nullable column avoids that.
- **The CHECK was added to the generated SQL by hand.** It is a column-level CHECK, so no rebuild is needed. `schema.ts` has the column (`area`, enum `STORAGE_AREAS`), and a comment there points at the CHECK.
- **Old rows have `area = null`** and are read as `recording`. That is the pessimistic choice.
- **The dev DB is migrated.** I also deleted the one leftover row the reviewer couldn't remove (`c21d7bcf…`), so `db:check` is green.

### P2-1: a "missing" mark never deletes a file

- **Single transaction.** `markRecordingMissing(id, storageKey)` (`src/lib/storage/files.ts`) runs one `writeTx`:
  - it marks the row `missing`;
  - the 0010 trigger queues the key;
  - the same transaction closes that queue row: `state='done'`, `attempts+1`, `not_before=null`.

  If the object was only unreachable (wrong store, a bad 404) and comes back, we never delete it. It then sits unreferenced in the store, outside the meter.
- **Second look before marking.** Once the 10-minute grace has passed, `GET /api/dosya/kayit/[id]` reads the object a second time before marking. A store error on either read answers 503 and marks nothing.
- **Verified:**
  1. Move the file aside and age the take past the grace: GET answers 410, and the queue row is `done` straight away.
  2. Put the file back and run a sweep: the file survives.
- **README note for the tech lead:** connecting a different Blob store to a deployment that shares the database marks takes as `missing`. Since this fix, the files themselves stay untouched.

### P2-2: per-user caps and MIDI kept apart

**Caps.** The constants are in `src/lib/storage/limits.ts`. Rate-limit keys start with `listen:` or `midi`, so the existing e2e cleanups (`key like 'listen:%'`, `'midi%'`) still clear them.

| Key | Limit | Window | 429 `error` (code `rate`) |
|---|---|---|---|
| `listen:<viewer>` | 300 | 1 h | `Çok sık dinleme isteği. Biraz sonra tekrar dene.` |
| `listen:file:<viewer>:<recordingId>` | 10 | 1 h | `Bu kaydı son bir saatte çok sık açtın. Biraz sonra tekrar dene.` |
| `listen:day:<viewer>` | conductor 300 / effective assistant 120 / anyone else 40 | 24 h | `Son 24 saatteki dinleme sınırına ulaştın. Birkaç saat sonra tekrar dene.` |
| `midi:<viewer>` | 600 | 1 h | `Çok sık dinleme isteği. Biraz sonra tekrar dene.` |
| `midi:day:<viewer>` | 300 | 24 h | `Son 24 saatteki MIDI sınırına ulaştın. Birkaç saat sonra tekrar dene.` |

Worst case at these limits: a member who isn't an assistant can add about 40 × 4 MB × 2 = 320 MB a day to the transfer meter. That takes about 31 days to reach 10 GB, so one member alone can't stop playback inside the 30-day window.

**MIDI is kept apart.**
- `logDelivery(area, bytes)` writes `area='midi'` or `area='recording'`.
- `usage()` gains `recordingReads` and `recordingTransferBytes`, and `playbackPausedFor()` uses only those.
- The meters on the Depolama page still show every delivery (`reads`, `transferBytes`), because that is what Blob bills. AC43's SQL comparison is unchanged.
- Verified: 10,000 MIDI-only gets put the reads meter at 100% while recording playback still answers 200. 10,000 `area = null` gets still stop playback with a 503.

### UX P2-4: counting and sorting rows with audio (`src/lib/review/queries.ts`)

- **`hasAudio`.** `QueueRowBase.hasAudio` is a new boolean: a current take whose audio is still live.
- **Queue order (`compareQueue`).** Inside each homework group, rows with audio come first. Rows marked `Portalda kayıt yok` or with deleted audio come last. Groups are unchanged.
- **Walk order (`compareWalk`).** Every row with audio, in queue order, then the rest. `nextAfter` walks in this order. It finds the current row by its (homework, singer) identity, and falls back to key order when the row has just left the list.
- **`firstToReview(rows)`.** The first row with audio, else the first row.
- **`reviewKey(review)`.** The review page's own key, including `hasAudio`. `nextReviewHref` uses it.
- **`conductorCounts()` has a new shape:** `{ waiting, noAudio, total, noted }`.
  - `waiting`: waiting rows with live audio. **This changed: it used to be every waiting row.**
  - `noAudio`: waiting submissions with no audio in the portal.
  - `total`: every waiting row, which is the length of the `Yorum bekleyen` list.
  - `noted`: unchanged.
  - The `/odevler` pill uses `.waiting`, so it now shows the audio-only number.

### TL1 (D54 amendment): deleting a comment

When the conductor deletes or clears the comment on a take, `delete_on` goes back to `max(Istanbul upload day + 120, Istanbul tomorrow)` (`saveFeedback`, `src/app/(portal)/odevler/actions.ts`). So deleting a comment in order to rewrite it can never lose the audio to the next morning's sweep. A fresh take still gets upload day + 120.

Verified: a take uploaded 130 days ago, commented, then the comment cleared, gets `delete_on` = tomorrow.

### P3s done

| # | Fix | Where |
|---|---|---|
| P3-1 | Each sweep chunk's timeout is now `min(10 s, deadline − now − 1 s)`, and the sweep stops when less than 1 s would be left. The expire step is skipped when the sweep starts later than `deadline − 5 s`. | `ledger.ts drainQueue`, `sweep.ts` |
| P3-2 | The 95% guard is re-checked after `holdKey` with `uploadsPausedAfterHold()`, which doesn't count the held file twice. This applies to both recording and MIDI uploads. Verified with 20 KB of headroom and 4 parallel 16 KB uploads: exactly one 201 and three 503 `quota`. | `api/dosya/kayit/route.ts`, `midi-actions.ts`, `quota.ts` |
| P3-3 | The Blob driver returns `size: null` when the store omits `Content-Length`. The routes fall back to the DB size, and `fileHeaders` leaves the header out when the size is unknown, instead of sending 0. | `blob.ts`, `driver.ts`, `http.ts`, both GET routes |
| P3-4 | `releasePutFailure(key, kind)`: after a `fault` or `auth` failure the key is released and drained inline, as before. After any other failure (a timeout, an outage) the key stays queued for 15 minutes (`LATE_COMMIT_SECONDS`), and the daily sweep deletes it after any late commit has landed. | `ledger.ts`, the upload route, `midi-actions.ts` |
| P3-5 | The sweep's `prune()` also deletes `login_attempts` rows older than 2 days. No throttle window is longer than 24 h. | `sweep.ts` |
| P3-6 | `saveFeedback`, `saveAssistantNote` and `deleteAssistantNote` catch a `writeTx` failure. They log only `{ name, code }` (`errorTag`, new in `src/lib/review/log.ts`) and return `Bir şeyler ters gitti, tekrar dene.`, keeping the form values. | the actions |
| P3-7 | New `db:check` invariant: `live storage keys already deleted` (a `done` queue row whose key a live recording or a MIDI row still uses). | `scripts/db-check.ts` |
| P3-8 | These writes now go through `writeTx`: `holdKey`, `releaseKey`, the chunk updates in `deleteChunk`, expire, prune, the sweeps insert, `deleteRecordingAsConductor` and `markRecordingMissing`. | as listed |

### Verification

- **`backend9/verify.mjs`:** 184 passed, 1 failed. The failure is `seed: conductor home counts`, which compares against the old `{"waiting":17,"noted":1}` shape. The new seed value is `{"waiting":6,"noAudio":13,"total":19,"noted":1}`. To run the script I added a temporary harness route, `src/app/api/dosya/zz-test-actions`, and deleted it afterwards.
- **`be9rev/scripts/up.mjs`:** noorigin and foreign answer 403. Replay answers 201 then 200. Over-size and chunked uploads answer 413. With `parallel-same 3` you get one 201 and two 200. With `parallel 4` at 3/5 uploads you get two 201 and two 409. No pending orphans.
- **Fix probe `scratchpad/fix9/probe.mjs`:** 18/18 pass. It covers P2-1, the file cap, the daily cap, MIDI `area`, MIDI-only meters, legacy rows, TL1, the queue order and the counts.

### For the tech lead: e2e assertions these changes may move (I didn't run e2e)

- Anything asserting `conductorCounts().waiting`, the `/odevler` `Dinleme` pill, or `Dinlemeye başla (n)` equal to the full waiting list. These are now audio-only numbers.
- Anything asserting queue row order inside a homework when it mixes rows with audio and rows without. Rows without audio now come last.
- P3-9 (e2e-owned, not changed): `e2e/lib.mjs:162-167` should delete only `state = 'done' or not_before is null or not_before <= unixepoch()` rows from `storage_deletions`, or run the reconcile before the wipe. Note also that put failures other than `fault`/`auth` now leave a pending row with `not_before` = now + 15 min.

### Backlog (skipped as risky or out of my files)

- **P3-10:** `sameOrigin` trusts `X-Forwarded-Host` (`src/lib/api.ts`, outside my files). Gate it on `TRUST_PROXY_HEADERS === "1"`.
- **Sniff:** require a known major brand plus a following box for `ftyp` files.
- **"Playback resumes on …" line on Depolama:** the date the oldest counted recording event leaves the 30-day window. This needs a small query helper plus UI.
- **Optional second-miss rule for P2-1:** a second miss at least 10 minutes later before marking. The same-request double read plus the closed queue row cover the data-loss risk.

## UI (arkhe-frontend)

Date: 2026-10-21. `npm run lint` and `npm run typecheck` are clean. e2e: `phase9-*` 250/250 and `phase4` 111/111 pass. Screenshots (375 and 1280, light and dark) are in `scratchpad/p9fix/`.

### UX P1: roster names at 375 px (`src/components/homework/roster.tsx`)
- A row with a take now has the full-width name on line 1. Line 2 holds the state chip plus `Kayıt · 0:03`. Rows without a take keep the one-line layout.
- Conductor: the sheet button stays (it still opens the Phase 4 sheet). The review link is a 44 px chevron-only cell, `aria-label="{Ad}: kaydı dinle"`, `data-testid=roster-listen`.
- Board: the take line is plain text, and there is no link.
- The row's accessible name is its visible text plus a sr-only `, yorum yaz` / `, teslimi işaretle`. The old `aria-label` failed axe `label-content-name-mismatch`.
- Probe: `layoutIssues` (`e2e/media.mjs`) now fails on any `.truncate` element narrower than 64 px whose text overflows. The phase9-b AC57 loop runs it on `/odevler/D` for sef@ and yk@ at 375.

### UX P2
1. **Guard dialog.** `Kal` is the filled primary and gets focus. `Geç` is outline with `text-absent-ink`. `ConfirmDialog` gains `cancelVariant` and a per-action `className`.
2. **Server refusal.** After a `type`/`size`/`empty` refusal, `Gönder` is hidden. `Başka dosya seç` (or `Yeniden kaydet`) becomes the focused `h-14` primary. The player stays.
3. **`Teslimi kaldır` with a live take** is disabled for both roles, with a help line:
   - board: `…Gerekirse şefe haber ver.`
   - conductor: `…; önce kaydı sil.`, and the sheet link reads `Kayda git`.
4. **Audio-first counts.**
   - Home card: `{n} kayıt dinlenmeyi bekliyor · {k} asistan notlu`, plus `{m} teslimde portalda kayıt yok.` underneath. `Dinlemeye başla` uses `firstToReview`.
   - Queue page: the `Yorum bekleyen` chip uses `counts.total`. `Dinlemeye başla` starts at `firstToReview` and shows `({counts.waiting})` (for other chips, the number of audio rows).
   - Review page: the `n / total` position uses the `compareWalk` order and `reviewKey`.
   - The backend added no separate group for rows without a recording, so the queue keeps its `Portalda kayıt yok` tag sorted last.
5. **`…suz` labels.** `Sopranosuz`, `Altosuz`, `Tenorsuz`, `Bassız`. The map lives in `midi-player.tsx`, because `src/lib/labels.ts` was outside my files; move it there if you like.
6. **Recording ring.** It is now `p-3 ring-2 ring-absent` with no offset, and the label reads `10:00'da durur`. The `Durdur` hover is now `hover:brightness-95` instead of `/90`, because the lighter hover failed axe contrast in light mode.
7. **Microphone steps** are no longer `aria-hidden`. The alert has no `aria-describedby`, and the AC 17 sentence stays as sr-only text.
8. **Singer copy.**
   - `Şefin yorumu` (the eyebrow) and `Yeni yorum` (the list tag).
   - Sent hint: `…“Yeni yorum” işareti çıkar.`
   - Locked line: `…tarihinde silinir; şefin yorumu kalır.`
   - The phase4 and phase9-b e2e strings are updated.
9. **Roster** now says `yorum yaz` for the conductor.

**Also:** `midi-player.tsx` shows the server's `error` (for example the 429 caps) instead of `Bu MIDI dosyası çalınamıyor`. The audio player already did this.

### UX P3s done
- **1:** `Kaydını yap ↓` (`#kayit`) in the detail header while unsubmitted.
- **2:** the headphone hint only shows when the browser can record.
- **3:** the countdown is announced when the countdown actually starts, and mic problems announce their title.
- **4:** `5 yükleme hakkından {n} tanesini kullandın.`, plus `Silinen kayıtlar da sayılır.` when there is no live take.
- **5:** the blocked mic box uses the `…şefe başka yolla gönder.` line.
- **6:** the failed view says `Başka dosya seç` for a picked file.
- **7:** once the MIDI panel is open, its trigger becomes `Kapat` (ChevronUp) and collapses the panel. Play/pause lives only in the panel.
- **9:** `Yalnız X` / `Xsuz` have `aria-pressed` and `bg-primary/12`.
- **10:** typographic quotes and the `“Partisyon kayıtları” bölümünde` hint.
- **11:** no doubled part in the `Partisyonumu aç` name.
- **12:** `{n} kayıt kaldı`.
- **13:** the percentage shows once in the meter; a null duration is omitted in the queue; `Eklendi` resets after `Yorumu sil`.

### Skipped
- **P3-8:** the MIDI row meta, `Tutti · 4 ses`. It needs the parsed track count before the first play.
- **P3-13:**
  - The `Yükle` disabled state: the form already refuses with `Bir MIDI dosyası seç.`, which explains more than a disabled button.
  - The asistan sheet autofocus.
  - Moving the MIDI section.
- **P3-14:** `lang="la"` for titles. This is a cross-phase pattern.

### e2e added
- **phase9-a:**
  - a refused file: Gönder is gone, and Başka dosya seç is the focused primary;
  - the mic steps are not hidden from screen readers;
  - the per-file listen cap: the 11th GET is a 429 with `Bu kaydı son bir saatte çok sık açtın…`, and the player shows it;
  - the new count line.
- **phase9-b:**
  - the guard dialog focuses `Kal`;
  - the home card counts audio-only plus the no-recording line (sum = list length);
  - audio-first order inside each group;
  - `Dinlemeye başla` opens the first row with audio;
  - TL1: a cleared comment on a 130-day-old take gets `delete_on` = tomorrow;
  - the roster truncation probe for sef@ and yk@;
  - yk@ has no `roster-listen` link.
- **phase9-c:** the meter value is `<used> / <limit>`.
- **phase9-d:** an open row trigger is `Kapat` and collapses the panel.
