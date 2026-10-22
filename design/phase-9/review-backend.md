# Phase 9 review: backend, security and DB (arkhe-backend)

Date: 2026-10-21. Under the lighter process I cover both backend/security and DB. I read `po-decisions.md`, `po-spec.md`, `implementation-notes.md` and `db.md`, then the code listed in the brief. I tested every claim over HTTP against the dev server (127.0.0.1:3100), using temporary sessions in `data/arkhe.db` and a scratch harness in the scratchpad. The migration ran on scratch copies. I didn't edit anything under `src/`.

**Result: 0 P1, 2 P2, 11 P3.** Nothing lets a role read or hear what it shouldn't. Both P2s are about losing availability, not about leaking data.

## 0. What I proved holds (no finding)

**Visibility matrix over HTTP.** `GET /api/dosya/kayit/<id>` returns status and body bytes as follows:

| Viewer → recording | Result |
|---|---|
| owner (Melis, D) | 200 48044; `?indir=1` 200 + `attachment; filename="…"` |
| other alto (korist) | 404, 0 bytes |
| assistant Soprano+Alto | 200; `?indir=1` **404** (D44) |
| assistant on a tenor (out of scope) | 404 |
| assistant on E · Ayşe (commented, D43) | 404; the owner on the same take gets 200 |
| board (yk) | 404 (D45) |
| conductor | 200; `?indir=1` 200 |
| logged out | 401, empty |
| audio-deleted take (E · korist) | owner/conductor 410; assistant and yk 404 |
| replaced take | owner 410, assistant 404 |
| unknown id | 404 |

Authorization always comes before existence, and the rate-limit row is only written after the access check passes.

**Delivery headers.** A polyglot (an `ftyp M4A` box followed by `<html><script>…<svg onload>`) uploads as `audio/mp4`. It is served back with these headers, so it can't render as a document:
- `Content-Type: audio/mp4`
- `nosniff`
- `Content-Security-Policy: default-src 'none'; sandbox`
- `CORP: same-origin`
- `Content-Disposition: inline`

The download name is `Sicut-Cervus-Emre-Aksoy.m4a`. `asciiSlug` allows only `[A-Za-z0-9-]` and the extension comes from a fixed map, so no header injection is possible.

**Proxy matcher.** `//`, a trailing `/`, `%30` in the id and `/_next/../api/dosya` all either get a 308 or keep the sandbox CSP. `/api/%64osya` is a 404 page with the page CSP and no file.

**Upload route.** Each case behaves as follows:

| Case | Result |
|---|---|
| No `Origin` | 403 `origin` |
| Foreign `Origin` | 403 `origin` |
| korist on F, conductor | 403 `forbidden` |
| 4,194,400 bytes | 413 |
| Chunked, no `Content-Length`, 6 MB | 413; `readCapped` stops at the cap |
| Replay of the same `X-Upload-Id` | 200, same take |
| 3 parallel requests with one `X-Upload-Id` | one 201 and two 200; one row, one file |
| 4 parallel uploads at 3/5 | exactly two 201 and two 409 `limit` |

In the last case the refused puts' files were deleted at once (queue `done`), so no orphans.

`writeTx` runs as `BEGIN IMMEDIATE` (libsql's default `"write"` mode), so the in-transaction re-check is serialized. For the same reason the comment lock, the stale-take checks (D49) and the D47 unmark refusal hold under races.

**D56 grace.** A missing file younger than 10 minutes gets 503 `storage` and nothing is marked. Older, it gets 410 and the row is marked `missing` (but see P2-1).

**Assistant note privacy.** I grepped the full HTML+RSC stream for the seeded note (`Girişte tempo…`), the E comment (`nefesi bölme`) and `recordings/`:
- Ayşe's `/`, `/odevler` and `/odevler/D`: 0 hits.
- yk's `/odevler`, `/odevler/D`, `/odevler/matris` and the review URL: 0 hits.
- The assistant's queue, `notlarim` and the E review: 0 hits. On the E review there is no comment text and no player.
- The note appears only on the assistant's own D review and the conductor's.

**Logs.** Every Phase 9 `console.*` carries only event, driver, kind, name, bytes, type and counts. There are no ids, keys, names or text (but see P3-6 for unhandled errors).

**Migration on the live data:**
- `data/backups/2026-10-21T11-18-03-962Z.sql` (migrations 0000–0006) went through `db:restore` to a scratch file, then `drizzle-kit migrate` (0007→0010). Result: `migrations=11/11, quick_check=ok`, no orphans.
- I then dumped it with `dumpDatabase`, restored again and re-checked: 40 tables, 78 indexes/triggers/views, all four 0010 triggers present, `db:check` ok, users 24 and submissions 20 unchanged.
- The restore loads data before triggers, so it never queues keys.

**Retention maths.** I checked these in Istanbul days:
- `delete_on` = Istanbul upload day + 120, or comment day + 90.
- The sweep uses `delete_on <= today(Istanbul)`.
- Early clean uses `commented_at < start of Istanbul day (today − 29)`, which is the same as "comment day + 30 ≤ today".
- The CHECK `delete_on > date(uploaded_at,'unixepoch')` uses the UTC date, which is never later than the Istanbul day, so it can't fire wrongly.

**Cron isolation.** The sweep runs after `runMonthlyBackup` in its own step and never throws. Its result goes to `storage_sweeps` and the log, never to the reply. A failing sweep can't fail or skip the backup (but see P3-1 for the deadline).

## P2

### P2-1. A "missing" mark is irreversible and queues a real deletion
- **Where:**
  - `src/lib/storage/files.ts:72-76` (`markRecordingMissing`)
  - `src/app/api/dosya/kayit/[id]/route.ts:58-66`
  - the trigger `drizzle/0010_phase9_media.sql:139-141`
  - `recordings_audio_final` (`:145-147`)
- **Scenario:** Any viewer's first play after the grace window, on a store that returns 404, marks the take `missing`. The trigger then queues its key `pending`, and `recordings_audio_final` makes the mark permanent. If the file actually exists, the next sweep deletes it. This happens when:
  - the wrong Blob store is connected (for example a preview or new store against the production Turso DB),
  - the store is reconnected after a swap,
  - a local `data/uploads` is resolved from a different cwd, or
  - a single bad 404 comes from the CDN.

  The comment says "deleting it is free", but that is only true when the file really is gone.
- **Proof (dev):**
  1. I uploaded a take and moved its file aside. GET → 503 (grace).
  2. I set `uploaded_at -= 700`. GET → 410; the row became `missing` and the queue row `pending`.
  3. I put the file back. It was still queued for deletion, and `update … set audio_deleted_at = null` aborts with `recordings_audio_final`.
- **Fix:** Mark the row and close its queue row in one transaction. We have just seen the object absent, so nothing needs deleting, and a file that comes back is never removed by us:
  ```ts
  await writeTx(async (tx) => {
    const n = await tx.run(sql`update recordings set audio_deleted_at = ${t}, deleted_reason = 'missing'
      where id = ${id} and audio_deleted_at is null`);
    if (n.rowsAffected) await tx.run(sql`update storage_deletions
      set state = 'done', done_at = ${t}, attempts = 1, last_attempt_at = ${t}, not_before = null
      where storage_key = ${key} and state = 'pending'`);
  });
  ```
  - Optionally also require a second miss ≥ 10 minutes after the first (store the first miss in memory or in a small column) before marking.
  - Document in the README that connecting a different Blob store to a deployment that shares the database will mark takes as missing.

### P2-2. One member (or a client loop) can stop recording playback for the whole choir for up to 30 days
- **Where:**
  - `src/lib/storage/quota.ts:80-85` (`playbackPausedFor`)
  - `src/app/api/dosya/kayit/[id]/route.ts:39-41`
  - `src/app/api/dosya/midi/[id]/route.ts:26,47`
  - `src/lib/storage/limits.ts:35-37`
- **Scenario:** The guard counts the whole choir against `READ_LIMIT = 10,000` and `TRANSFER_LIMIT = 10 GB`. Transfer is counted as 2 × bytes over a rolling 30 days. The per-user limits are 300 listens/h and 600 MIDI fetches/h.
  - Transfer: one member replaying their own 4 MB take at the allowed rate adds 300 × 4 MB × 2 = 2.4 GB/h, which reaches 10 GB in about 4 hours.
  - Reads: 900 requests/h reaches 10,000 in about 11 hours.
  - MIDI deliveries also write `get` events (I saw rows `get 125/404` from MIDI fetches), so a MIDI loop stops recording playback even though MIDI itself keeps playing (D20).
  - No lever resets the meters. Events only roll off after 30 days (pruned at 40).
- **Proof:** The arithmetic above, plus the code path: every successful delivery runs `logDelivery` → a `storage_events(kind='get')` row → `usage().reads/transferBytes`. I didn't burn the meters on the shared dev DB.
- **Fix:**
  - Make the per-user budget a small fraction of the monthly one. Add daily caps next to the hourly ones, for example `consumeAttempt("listen-day:"+id, 150, 86_400_000)` and `("midi-day:"+id, 200, 86_400_000)`.
  - Add a per-file key, for example `listen:<viewer>:<recordingId>` at 10/h. Replays are served from the client's `blob:` URL anyway.
  - Don't let MIDI `get` events count toward the stop for recordings: either use a separate `kind = 'midi_get'`, or filter `bytes > MIDI_MAX_BYTES` out of nothing. Simplest is to log MIDI with its own kind and include it only in the transfer meter.
  - Give the conductor's Depolama page an explanation line that says when playback resumes (the date the oldest counted event leaves the window).

## P3

### P3-1. The sweep can overrun the cron's `maxDuration`
- **Where:** `src/lib/storage/ledger.ts:113-118`; `src/app/api/cron/aylik-yedek/route.ts:11,60`.
- **Scenario:** `drainQueue` checks `deadline − 2 s` before each chunk but gives every chunk a fixed 10 s timeout.
  - A chunk started at 53 s ends at 63 s, past the 60 s `maxDuration`. Vercel kills the function, the reply becomes a 504, and the `storage_sweeps` row is never written (AC 41: Depolama shows a stale "son temizlik").
  - The backup is already committed, so this is cosmetic, but the cron shows as failed.
- **Fix:** `deleteChunk(rows.slice(i, i + CHUNK), Math.max(1_000, Math.min(10_000, deadline - Date.now() - 1_000)))`. Also skip `expire` when `Date.now() > deadline - 5_000` (it would run on the next day).

### P3-2. The 95% upload guard is checked before the hold, so parallel uploads overshoot it
- **Where:** `src/app/api/dosya/kayit/route.ts:159-160`, then `:176`. Also `src/app/(portal)/repertuvar/midi-actions.ts:78`.
- **Scenario:** `uploadsPaused()` runs before the body is read and before `holdKey`. All uploads in flight during a deadline rush pass the same reading. The overshoot is N × 4 MB, not the "2 × 4 MB" of backend.md §10: twelve parallel uploads at 94.9% eat the whole 50 MB margin.
- **Fix:** Keep the cheap pre-check, then re-check after `holdKey`. Holds are part of `storedBytes`, so each later request sees the earlier ones:
  ```ts
  await holdKey(key, "recording", bytes.byteLength);
  if (await uploadsPaused(0)) { await releaseKey(key); await drainKeys([key]); return fail(503, MSG.quota, "quota"); }
  ```

### P3-3. A Blob response without `Content-Length` is served as `Content-Length: 0`
- **Where:** `src/lib/storage/blob.ts:57`; `src/app/api/dosya/kayit/[id]/route.ts:67-76`; `src/app/api/dosya/midi/[id]/route.ts:47-58`.
- **Scenario:** `@vercel/blob@2.8.2` `get()` sets `size: contentLength ? parseInt(...) : 0` (`node_modules/@vercel/blob/dist/index.js:204`). Any CDN response without the header (chunked, compressed) gives `Content-Length: 0` with a body, so the player gets nothing or an error. `logDelivery` then counts 1 byte.
- **Fix:** In the driver, `size: result.blob.size || null`. In the routes, use `size = object.size ?? rec.sizeBytes` (the DB size is exact for our own puts). Omit the header only if both are unknown.

### P3-4. A put that times out can leave an orphan file
- **Where:** `src/app/api/dosya/kayit/route.ts:180-188`; the same in `midi-actions.ts:85-93`.
- **Scenario:** `AbortSignal.timeout(20_000)` aborts our side only, and Blob may still commit the object. We release the hold and delete at once. If the delete reaches Blob before the delayed commit, the queue row is `done` and the object stays forever. Nothing references it, and the storage meter no longer counts it.
- **Fix:** On a put failure, keep the key queued but delay it: `releaseKey(key, { notBefore: now + 15 min })` and skip the inline `drainKeys`. The daily sweep then deletes it well after any late commit. Keep the inline drain only for `fault`/`auth` kinds, where the put surely didn't land.

### P3-5. Media rate-limit rows are never pruned
- **Where:** `src/lib/auth/rate-limit.ts:66-69`; `src/lib/storage/sweep.ts:39-48`.
- **Scenario:** Every listen, MIDI fetch and upload inserts a `login_attempts` row. backend.md §12 says `forgetLoginAttempts` prunes them after 24 h, but that only runs on a successful login, and sessions last 90 days. The table grows with every media request and goes into every monthly dump.
- **Fix:** Add `db.run(sql\`delete from login_attempts where attempted_at < ${at - 86_400}\`)` to `prune()` in the sweep.

### P3-6. Unhandled DB errors in the note and comment actions log the text
- **Where:** `src/app/(portal)/odevler/dinle/actions.ts:56-89`; `src/app/(portal)/odevler/actions.ts:365-408`.
- **Scenario:** drizzle 0.45 wraps failures in `DrizzleQueryError("Failed query: … params: …")` (`node_modules/drizzle-orm/errors.js:10-13`). If `writeTx` gives up (SQLITE_BUSY after 6 retries locally, or a Turso hiccup), Next logs the error unhandled. The params include the assistant's private note or the conductor's comment and the user ids. That breaks backend.md §14 "never note or comment text".
- **Fix:** Wrap both `writeTx` calls in `try/catch`, log `{ name, code }` only, and return `{ error: MSG.generic, values }`.

### P3-7. `db:check` doesn't see a live row whose file was already deleted
- **Where:** `scripts/db-check.ts:63-90`.
- **Scenario:** Invariant 4 looks only at `pending` rows. A `done` row whose key is still referenced by a live recording or MIDI row means the audio is gone while the UI still offers the player, and nothing flags it. A wrong hold release or a manual SQL fix can cause this.
- **Fix:** Add a check, expected count 0, problem `live storage keys already deleted`:
  ```sql
  select count(*) from storage_deletions d where d.state = 'done' and (exists (select 1 from recordings r where r.storage_key = d.storage_key and r.audio_deleted_at is null) or exists (select 1 from midi_files m where m.storage_key = d.storage_key))
  ```

### P3-8. Single-statement writes outside `writeTx` fail with SQLITE_BUSY on the local driver
- **Where:**
  - `src/app/(portal)/odevler/kayit-actions.ts:37-40`
  - `src/lib/storage/files.ts:73-75`
  - `src/lib/storage/sweep.ts:29-35`
  - `src/lib/storage/ledger.ts:24,38`
- **Scenario:** On the local file DB, a concurrent writer makes these throw at once, without retry. For example, the conductor's `Kaydı sil` while an upload commits gives a 500. Turso is unaffected, so this hits only dev and `e2e:prod`, where it causes flakes.
- **Fix:** Run them through `writeTx`. P2-1's fix already does this for the missing mark.

### P3-9. e2e cleanup wipes upload holds before the file reconcile
- **Where:** `e2e/lib.mjs:162-167`; `scripts/media-fixture.mjs:251-276`.
- **Scenario:** `delete from storage_deletions` runs first, and then `reconcileLocalUploads` no longer sees an in-flight hold (`not_before > unixepoch()`). It deletes the just-put file, and the upload then fails with `upload hold missing` (500). This happens only when the dev server handles an upload during another suite's cleanup, which is the parallel-run flake the implementation notes describe.
- **Fix:** Delete only `state = 'done' or not_before is null or not_before <= unixepoch()` rows, or run the reconcile before the wipe.

### P3-10. `sameOrigin` trusts a client-sent `X-Forwarded-Host`
- **Where:** `src/lib/api.ts:23`.
- **Proof:** `Origin: https://evil.example` plus `X-Forwarded-Host: evil.example` got 201 on dev.
- **Impact:** None from a browser. The custom `X-Upload-Id` forces a CORS preflight that fails, the session cookie is `SameSite=Lax`, and Vercel overwrites `x-forwarded-host`. This is a pre-existing helper.
- **Fix:** Read `x-forwarded-host` only when `TRUST_PROXY_HEADERS === "1"` (the same rule as `clientIp()`), else `host`.

### P3-11. Deleting the comment on an old take deletes its audio the next morning
- **Where:** `src/app/(portal)/odevler/actions.ts:399-405`.
- **Scenario:** Take uploaded on day 0, commented on day 95 (`delete_on` = day 185).
  - On day 130 the conductor deletes the comment to rewrite it.
  - `delete_on` goes back to day 120, which is already in the past.
  - The 05:00 UTC sweep removes the audio before the conductor types the new comment the next day.

  This is D54 as written, but it is surprising and silent.
- **Fix (PO call):** Keep D54, but when `uploadDay + 120 <= today` use `today + 7` so that a delete-to-rewrite never loses the audio overnight. Alternatively, say in the delete confirm: `Yorum silinirse kayıt yarın sabah silinir.`

### Note: the sniff accepts any payload after an `ftyp` box
- **Where:** `src/lib/storage/sniff.ts:15-19`.
- **What I saw:** 112 bytes of HTML after a 20-byte `ftyp` box were stored as `audio/mp4`. Delivery makes this harmless (see §0). It lets a member store up to 5 × 4 MB of arbitrary bytes per slot, and only the existing caps bound that.
- **Optional fix:** Require a known major brand (`M4A `, `mp42`, `isom`, `iso2`–`iso6`, `mp41`, `dash`, `3gp4`–`3gp6`) and a following `moov`, `mdat`, `free` or `wide` box header within the first 1 KB.

## Cleanup and one leftover

- I deleted my temporary sessions, my upload rows and their submissions, queue rows, storage events, rate-limit rows and files.
- `data/uploads/recordings` again holds exactly the six seed WAVs.
- **One row is left**, because the permission system blocked my last write to `data/arkhe.db`. It is recording `c21d7bcf-b4b8-4507-ae95-bb03fdcd2227` (emre.aksoy, homework C), marked `missing`, with no file and no submission.
  - Because of it, `npm run db:check` currently reports `current recordings without a submission`.
  - The next e2e `cleanup()` or `npm run seed` removes it: C is a fixture homework, so the reseed's cascade deletes it.
  - Or remove it directly with `delete from recordings where id = 'c21d7bcf-b4b8-4507-ae95-bb03fdcd2227';`. Its audio is already marked deleted, so no trigger fires.
- The scratch DBs and scripts are under `scratchpad/be9rev/` only.
