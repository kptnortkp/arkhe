# Phase 9: backend and security plan (arkhe-backend)

Author: arkhe-backend. Date: 2026-10-21. Inputs: `po-spec.md` (D1–D30, AC 1–59, §7 q1 is mine), `design/phase-4/po-spec.md`, `CLAUDE.md`, `AGENTS.md`, `design/TEAM.md`, `design/phase-8b/backend.md` (fault-hook pattern, `bodySizeLimit`). `db.md`, `ux.md` and `ui.md` didn't exist yet, so §15 is the **data I need** from @dba, not a schema.

Code read: `src/lib/{api,permissions,validation,time,env}.ts`, `src/lib/auth/{dal,session,rate-limit}.ts`, `src/db/{client,index,write-tx}.ts`, `src/db/schema.ts` (`users`, `submissions`, `assignments`, `pieces`, `app_settings`, `login_attempts`), `src/lib/homework/{eligibility,queries}.ts`, `src/app/(portal)/odevler/actions.ts`, `src/app/(portal)/repertuvar/actions.ts` (`deletePiece`), `src/app/api/cron/aylik-yedek/route.ts`, `src/lib/backup/{run,constants,email}.ts`, `src/proxy.ts`, `next.config.ts`, `vercel.json`, `e2e/phase7-a-cron.mjs` (response-shape asserts), `e2e/prod.mjs` (DB path).

Next docs read (16.4.2, `node_modules/next/dist/docs/`): `05-config/01-next-config-js/serverActions.md` (`bodySizeLimit`, Origin check), `.../proxyClientMaxBodySize.md`, `04-functions/after.md`.

Vercel docs fetched 2026-10-21 (markdown, kept in my scratchpad): `vercel-blob/private-storage` (updated 2026-09-15), `vercel-blob/server-upload`, `vercel-blob/using-blob-sdk` (2026-08-26), `vercel-blob/usage-and-pricing` (2026-09-23), `functions/limitations` (2026-08-24). Package checks: `npm view` plus the `@vercel/blob@2.8.2` tarball (`dist/index.js` `get()`, error classes); `@tonejs/midi@2.0.28` bundled with esbuild and gzipped to measure it.

`src/` is untouched. Nothing was written to `data/arkhe.db`, no e2e was run, no git.

---

## 0. Decisions in one table

| Topic | Decision |
|---|---|
| Recording upload | **Route handler** `POST /api/dosya/kayit?odev=<assignmentId>` with the **raw file as the body** (no multipart) and metadata in headers. 4,194,304 bytes plus headers stays well under Vercel's 4.5 MB function payload limit. Not a server action: their default limit is 1 MB, and raising it to about 4.2 MB for this one upload would raise it for every action in the app (§3). |
| MIDI upload | **Server action** with `FormData` on `/repertuvar/<id>/duzenle` (`useActionState`, `FormState`). 1,048,576 bytes plus multipart overhead fits `serverActions.bodySizeLimit: "1100kb"`, the value Phase 8b already chose. If 8b hasn't landed, Phase 9 adds the same line (§4). |
| Proxy | `/api/dosya/` comes **out of the proxy matcher**. The proxy holds every request body in memory (default cap 10 MB, and past the cap it **silently cuts the body off**), and it stamps the page CSP onto responses. The file routes need neither (§9). |
| Adapter | `src/lib/storage/` with one `StorageDriver` interface (`put`/`get`/`delete`) and two drivers: `local` (when the DB URL is `file:`) and `blob` (`@vercel/blob@2.8.2`, private store). It returns `null` when nothing is configured, which is the "not configured" state (§2). |
| Package | `@vercel/blob` **2.8.2** (published 2026-10-14), **Apache-2.0** (permissive and free, which meets "MIT or similar"), Node ≥ 20. Private storage needs ≥ 2.3. Blob runs on all plans, Hobby included. Pin the exact version and import it only from `server-only` code. |
| Sniffing | **Our own code** (`src/lib/storage/sniff.ts`, pure, about 150 lines), stricter than "first bytes": raw MPEG and ADTS need a second valid frame, WebM needs the `webm` DocType, Ogg needs an `OpusHead`/`vorbis` packet, MIDI needs a full chunk walk (§3.3). The stored type always comes from the sniffer. |
| Duration | Agree with the PO. The client reports it in `X-Recording-Duration-Ms`, the server clamps it to 0–600,000 and **never** uses it for limits. It is nullable: Chrome's WebM reports `Infinity` on `loadedmetadata`, so recordings send the recorder's own elapsed time (§3.2). |
| Delivery | `GET /api/dosya/kayit/<id>` and `GET /api/dosya/midi/<id>`. **Authorization comes before existence**: no access → 404, and only a viewer who is allowed sees 410 (§5). |
| Visibility | One pure module, `src/lib/review/access.ts`. The route, the pages, the actions and the queries all call it. Assistant and singer reads use separate query functions with explicit column lists, so feedback and notes can't be selected by accident (§6). |
| Comment | The conductor's comment **is** `submissions.feedback`. `saveFeedback` becomes conductor-only, runs in one `writeTx` and sets or clears `recordings.commented_at`. The form carries the `recordingId` that was on screen (§7). |
| Deletion | A **storage ledger plus queue**. Every key that leaves the "live" state is queued in the same statement or batch. @dba: I recommend triggers so FK cascades are covered too. Deletes happen inline on a best-effort basis and the daily sweep retries (§8). |
| Cron | The sweep runs **after** the backup step in the same request, inside its own `try/catch`, with a deadline. **The response stays byte-identical to Phase 7**. Phase 7 e2e asserts `Object.keys(body) == ["status"]` (`e2e/phase7-a-cron.mjs:186`). The sweep's result goes to a `storage_sweeps` row and the log (§8.4). |
| Retention dates | Counted in **Istanbul calendar days**: the audio goes on the morning of `commentDay + 90` (or `uploadDay + 120`), the same date the UI shows (§8.2). |
| Quota | Our own counters: a ledger for the bytes still stored, and a `storage_events` log for put/get (§10). Limits are decimal and pessimistic (1 GB = 10⁹ B). Uploads check the **projected** total (`used + this file`). |
| MIDI parser | **`@tonejs/midi@2.0.28`** (MIT; its dependencies `midi-file` and `array-flatten` are MIT too). Measured with esbuild: 32.6 KB minified, **9.5 KB gzipped**. The parser plus a hand-written oscillator synth come to roughly 15 KB gz, well under the 60 KB budget (§11). |
| Rate limits | `consumeAttempt` (the existing `login_attempts` table): 20 recording uploads/h per user, 300 recording fetches/h per user, 600 MIDI fetches/h per user, 30 MIDI uploads/h per manager (§12). |
| Test hooks | `arkhe_e2e_storage_fault=put|get|delete` and `arkhe_e2e_recorder_limit=<1–600>` cookies are read only when `NODE_ENV !== "production"` **and** the DB URL (with the same `file:data/arkhe.db` default as `src/db/client.ts`) is `file:`. The server reads the recorder limit and passes it down as a prop; the client never decides it (§13). |
| Logs | Only counts, byte sizes, types, durations in ms, driver, error `name`/`kind`. Never user ids, emails, names, titles, file names, note or comment text, IPs or storage keys (§14). |

---

## 1. Module layout

```
src/lib/storage/
  types.ts        isomorphic: STORED_TYPES, ext map, size limits (RECORDING_MAX_BYTES = 4_194_304, MIDI_MAX_BYTES = 1_048_576), quota limits
  sniff.ts        isomorphic, pure: sniffAudio(bytes) → StoredAudioType | null, checkMidi(bytes) → boolean
  config.ts       pure: isLocalDb(env), blobConfigured(env), uploadsRoot(env)   (no server-only, so scripts/e2e reuse it)
  driver.ts       server-only: StorageDriver interface, StorageError, storage() (driver selection + fault wrapper)
  local.ts        server-only: local driver (node:fs/promises)
  blob.ts         server-only: Blob driver (lazy `await import("@vercel/blob")`)
  keys.ts         server-only: newKey(kind, ext), KEY_RE, assertKey()
  ledger.ts       server-only: enqueueDeletion (for paths a trigger doesn't cover), drainKeys(keys, budgetMs)
  quota.ts        server-only: usage() → four meters, uploadsPaused(incomingBytes), playbackPaused(), logEvent()
  sweep.ts        server-only: runStorageSweep({ today, deadline, reason }) → SweepResult; never throws
  fault.ts        server-only: storageFault(op), recorderLimitSeconds()
src/lib/review/
  access.ts       pure: effectiveAssistant(), covers(), canListen(), canReview(), canDownload()
  queries.ts      server-only: conductorQueue, assistantQueue, reviewForConductor, reviewForAssistant, reviewBadgeCount, nextItem, listenersFor (transparency names)
src/lib/media/
  midi-queries.ts server-only: midiForPiece(pieceId, part), midiForHomework(assignment, part)
  filename.ts     pure: asciiFilename(parts[], ext)   (Turkish transliteration, see §5.3)
src/app/api/dosya/kayit/route.ts          POST upload (recordings)
src/app/api/dosya/kayit/[id]/route.ts     GET delivery (recordings)
src/app/api/dosya/midi/[id]/route.ts      GET delivery (MIDI)
src/app/(portal)/odevler/actions.ts       changed: saveFeedback, undoSubmission, setSubmissionFor, deleteAssignment (§7.3)
src/app/(portal)/odevler/kayit-actions.ts "use server": deleteMyRecording, deleteRecordingAsConductor
src/app/(portal)/odevler/dinle/actions.ts "use server": saveAssistantNote, deleteAssistantNote
src/app/(portal)/odevler/asistanlar/actions.ts "use server": addAssistant, updateAssistant, removeAssistant
src/app/(portal)/odevler/depolama/actions.ts   "use server": earlyClean
src/app/(portal)/repertuvar/midi-actions.ts    "use server": uploadMidi, deleteMidi
src/app/(portal)/repertuvar/actions.ts         changed: deletePiece (MIDI rows go with the piece, queued)
src/app/api/cron/aylik-yedek/route.ts          changed: the sweep step after the backup (§8.4)
src/lib/permissions.ts                         + isConductor, canWriteFeedback, canManageAssistants, canEarlyClean
```

Rule for the `"use server"` files: every export is an action that checks the session itself. Helpers stay in `src/lib/**` (an exported helper in a `"use server"` file becomes a public endpoint).

---

## 2. Storage adapter

### 2.1 Interface

```ts
// src/lib/storage/driver.ts
export type StoredType =
  | "audio/mp4" | "audio/mpeg" | "audio/aac" | "audio/webm" | "audio/ogg" | "audio/wav" | "audio/midi";

export interface StorageDriver {
  readonly name: "local" | "blob";
  /** Never overwrites; keys are fresh UUIDs. Throws StorageError("put", …). */
  put(key: string, bytes: Uint8Array, type: StoredType, signal: AbortSignal): Promise<void>;
  /** null = the object is missing. Throws StorageError("get", …) for anything else. */
  get(key: string, signal: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  /** Missing keys aren't errors (Blob's del() doesn't throw for them; local ignores ENOENT). */
  delete(keys: readonly string[], signal: AbortSignal): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    readonly op: "put" | "get" | "delete",
    readonly kind: "unavailable" | "suspended" | "rate_limited" | "auth" | "fault" | "unknown",
    options?: { cause?: unknown },
  ) { super(`storage ${op} failed: ${kind}`, options); }
}

/** null = not configured (production with a remote DB and no Blob credentials). */
export function storage(): StorageDriver | null;
```

Every call site passes `AbortSignal.timeout(ms)`: put 20 s, get 15 s, delete 5 s inline and 10 s per sweep chunk. The SDK retries internally (`async-retry`), so a dead store must not hang a request until `maxDuration`.

### 2.2 Driver selection (`config.ts`, pure)

- `dbUrl(env) = env.DATABASE_URL ?? "file:data/arkhe.db"`, the **same default as `src/db/client.ts`**. A plain `env.DATABASE_URL?.startsWith("file:")` is `false` in a dev shell without the variable and would quietly turn the hooks off (`e2e/lib.mjs:9` uses the same default).
- `isLocalDb(env) = dbUrl(env).startsWith("file:")` → **local driver**.
- Otherwise `blobConfigured(env) = Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN)` → **Blob driver**. Don't test `VERCEL_OIDC_TOKEN`: on Vercel the SDK gets it through `@vercel/oidc` from the request context, so it may not be in `process.env` at boot. `BLOB_STORE_ID` is what Vercel adds when the store is connected. The SDK then resolves credentials in this order: explicit `token`, OIDC + store id, `BLOB_READ_WRITE_TOKEN` (Render fallback).
- Neither → `storage()` returns `null`. Upload answers 503 `Kayıt yükleme henüz açılmadı.`, delivery answers 503 `Kayıt şu an açılamıyor. Biraz sonra tekrar dene.`, `/odevler/depolama` shows `Dosya deposu bağlı değil.`. `bootWarnings()` adds `File storage is not configured (BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN); uploads are off.` (variable names only). `envProblems()` stays unchanged: no fail-fast (D15).

### 2.3 Local driver

- Root `uploadsRoot(env)`:
  - `<cwd>/data/uploads` for the default `file:data/arkhe.db`.
  - For any other `file:` DB, `<db dir>/uploads-<db basename without extension>`. `e2e:prod` uses `data/e2e-prod.db` → `data/uploads-e2e-prod/`, so a prod run's cleanup can never wipe dev files, and nobody can forget to set an env var.
- `put`: `assertKey(key)`, `mkdir -p` the kind folder, write `<key>.tmp-<random>` with flag `wx`, then `rename` onto the key (atomic; a crash never leaves a half file under a real key). If the target already exists, fail (`link`+`unlink` or a pre-check; keys are fresh UUIDs, so this only catches bugs).
- `get`: `stat` + `fs.createReadStream` → `Readable.toWeb`. ENOENT → `null`.
- `delete`: `unlink` per key, ENOENT ignored.
- `assertKey`: `KEY_RE = /^(recordings\/[0-9a-f-]{36}\.(m4a|mp3|aac|webm|ogg|wav)|midi\/[0-9a-f-]{36}\.mid)$/`. On top of that, `path.resolve(root, key)` must start with `root + path.sep`. Keys only ever come from `newKey()` (`crypto.randomUUID()`) and from our own DB, never from a request.
- `data/uploads/` isn't under `public/`, so Next never serves it (AC 2). The `.gitignore` already has `/data/`.
- `npm run db:reset` and the e2e cleanup: a small `scripts/clear-uploads.mjs` removes **only** `recordings/` and `midi/` under the resolved root. It runs the same `assert-local-db` guard and never touches other `data/` files. db:reset uses it after the `rm` of `arkhe.db*`.

### 2.4 Blob driver

```ts
const { put, get, del, BlobError, BlobStoreSuspendedError, BlobServiceRateLimited,
        BlobServiceNotAvailable, BlobAccessError, BlobStoreNotFoundError } = await import("@vercel/blob");
put(key, bytes, { access: "private", contentType: type, addRandomSuffix: false, allowOverwrite: false, abortSignal });
get(key, { access: "private", abortSignal });   // 200 → { statusCode, stream, blob }, 404 → null, other → throws BlobError
del([...keys], { abortSignal });                // void; missing keys don't throw; deletes are free
```

- Verified in `dist/index.js`: `get()` returns `null` on 404 and **throws `BlobError("Failed to fetch blob: <status>")` for any other non-OK status**. So in D21 terms: `null` → missing object, thrown error → `StorageError("get", kind)`. A 4 MB stream passes through unchanged and fits Vercel's 4.5 MB response limit. We don't send `ifNoneMatch` (recordings are `no-store`; MIDI relies on browser caching through our own `Cache-Control`).
- Mapping errors to `kind`: `BlobStoreSuspendedError` → `suspended` (this is what Hobby's over-limit block looks like), `BlobServiceRateLimited` → `rate_limited`, `BlobServiceNotAvailable` / `AbortError` / a network `TypeError` → `unavailable`, `BlobAccessError` / `BlobStoreNotFoundError` → `auth` (misconfiguration), anything else → `unknown`. Every kind reaches the user as the same D21 sentence; the kind exists only for the log.
- Default `cacheControlMaxAge` (1 month) stays. It's the CDN cache **between our function and the store**, and with unique keys a longer cache only saves simple operations and Fast Origin Transfer. After a delete, the CDN may keep serving for up to 60 s, which doesn't matter because the DB row is the gate (§5).
- Pathnames are `recordings/<uuid>.<ext>` and `midi/<uuid>.mid`: nothing personal, and no assignment or piece id either.

### 2.5 Fault wrapper (D21, AC 40/41/47)

`storage()` wraps the driver. Before each op, `storageFault(op)` reads the `arkhe_e2e_storage_fault` cookie **only if** `process.env.NODE_ENV !== "production" && isLocalDb(process.env)` (the 8b pattern; in a production build the first test is inlined to `false` and the branch is dead). If the cookie value equals the op, it throws `StorageError(op, "fault")`. `cookies()` works in route handlers and actions; the cron route reads the e2e test's `Cookie` header the same way, which AC 41 needs. Allowed values: `put|get|delete`; anything else is ignored.

---

## 3. Recording upload: `POST /api/dosya/kayit?odev=<assignmentId>`

`runtime = "nodejs"`, `maxDuration = 30`. Not in the proxy matcher (§9).

### 3.1 Request

| Part | Value | Rule |
|---|---|---|
| Query `odev` | assignment UUID | `z.uuid()`, else 404 `Ödev bulunamadı.` |
| Header `Origin` | same origin | `sameOrigin(request)` from `src/lib/api.ts`, else **403** `Bu işlem için yetkin yok.` before the body is read (AC 6). A same-origin `fetch` POST always sends `Origin`, Safari included. The invite-form `Origin: null` problem came from a form navigation under `no-referrer`, which this isn't. |
| Header `X-Upload-Id` | UUID made by the client once per take | Required. It becomes `recordings.id` (idempotency, §3.5). A custom header also forces a CORS preflight on any cross-origin attempt, which is a second CSRF wall next to `SameSite=Lax`. |
| Header `X-Recording-Duration-Ms` | integer | Optional. Clamped to 0–600,000, non-numbers → null. Display only. |
| Header `Content-Length` | | If present and > 4,194,304 → **413** before reading. If missing (chunked), the streaming cap below decides. |
| Body | raw bytes | `application/octet-stream`; the claimed `Content-Type` is ignored. |

Why raw and not multipart: no `request.formData()` (it buffers and parses the whole part tree), no boundary overhead, and the 4,194,304-byte AC boundary is exact. 4,194,304 B plus about 1 KB of headers is far below the 4.5 MB payload limit (even counted as 4,500,000 decimal bytes). Over that limit, Vercel answers 413 `FUNCTION_PAYLOAD_TOO_LARGE` (HTML) before our code runs; the client maps **any** 413 to the 4 MB message.

### 3.2 Steps

1. `sameOrigin` → 403. `getSessionUser()` → 401 `{ error: "Giriş yapmalısın." }` (an inactive user or a refused demo email has no session user, so AC 15 "inactive can't upload" is covered).
2. Validate `odev` and `X-Upload-Id`.
3. `consumeAttempt("upload:" + user.id, 20, 3_600_000)` → 429 `Çok sık yükleme yaptın. Biraz sonra tekrar dene.`
4. **Idempotent replay**: a `recordings` row with `id = X-Upload-Id` already exists → if it belongs to (`user.id`, `odev`), answer 200 with that row, without reading the body or calling put. If it belongs to anybody else → 409 `Kayıt bu arada değişti. Sayfayı yenileyip tekrar dene.` (generic, no hint).
5. **Pre-checks** (cheap, before reading 4 MB or spending an operation):
   - `storage()` → if `null`, 503 `Kayıt yükleme henüz açılmadı.`
   - The assignment exists and has parts → else 404. `loadViewer(user.id)` + `isEligible(viewer, parts)` → else 403 `Bu işlem için yetkin yok.` (the conductor and users without a part fail here).
   - Submission `feedback is not null` → 409 `Şef yorum yazdı; kaydını artık değiştiremezsin.` (any feedback, legacy board notes included; see @po §16).
   - Uploads counted for (assignment, user) ≥ 5 → 409 `Bu ödeve en fazla 5 kez kayıt yükleyebilirsin.`
   - `uploadsPaused(contentLength ?? RECORDING_MAX_BYTES)` → 503 with the D20 message and `{ code: "quota" }`.
6. **Read the body with a cap**: `request.body.getReader()`, append chunks to an array, `reader.cancel()` and 413 `Dosya en fazla 4 MB olabilir. Daha kısa bir kayıt yap ya da ses kaydedicide sıkıştırılmış kaliteyi seç.` once the total passes 4,194,304. Total 0 → 400 `Kayıt boş görünüyor. Yeniden kaydet.` (new copy).
7. `sniffAudio(bytes)` → null → 415 `Bu dosya türü desteklenmiyor. m4a, mp3, aac, webm, ogg ya da wav yükle.`
8. `logEvent("put", size)` (**before** put: a failed put still costs Vercel an operation, so it counts toward `Yükleme`). Then `key = newKey("recordings", ext)` and `driver.put(key, bytes, type, timeout 20 s)`. A `StorageError` → 503 `Kayıt şu an yüklenemedi. Kaydın kaybolmadı: tekrar dene ya da Kaydı indir ile telefonuna kaydet.` with `{ code: "storage" }`. Nothing is written to the DB except the event row (AC 47 "no row is written" means `recordings` and `submissions`).
9. **`writeTx`**, re-checking everything from step 5 inside the transaction (TOCTOU: a part change, the conductor's comment, a 5th upload in another tab, assignment deletion):
   1. The assignment exists; the viewer is eligible; feedback is null; the slot count is < 5.
   2. The current recording of (assignment, user), if any → `replaced_at = now`, `audio_deleted_at = now`, `deleted_reason = 'replaced'` (its key is queued by trigger or in the same tx, §8.1).
   3. Insert the new row `{ id: uploadId, assignmentId, userId, storageKey: key, contentType, sizeBytes, durationMs, uploadedAt: now }`.
   4. Submission upsert, **exactly like `submitAssignment`**: `insert … values (submitted_at = now, method = 'self') on conflict do update set submitted_at = now, method = 'self', marked_by = null where submitted_at is null`. A manual mark or an earlier first submit stays as it is (D1, AC 11 and AC 36).
   5. The ledger row for `key` goes from `uploading` to `live` if @dba keeps that state (§15). Otherwise the insert in 9.3 is the ledger row.
   - Any failure in 9 (refusal or DB error) → the transaction rolls back, `key` is queued for deletion (`enqueueDeletion([key])` in its own write) and drained inline. A refusal answers with its own message; a DB error answers 500 `Kayıt şu an yüklenemedi. …` (same D21 sentence). If the enqueue itself fails, log `storage orphan risk` (no key) and rely on the ledger's `uploading` sweep (§8.3).
10. After commit: `drainKeys([oldKey], 3_000)` best-effort (the queue keeps it on failure, AC 40), `revalidatePath("/", "layout")` (the badges live in the layout), then 201 `{ id, uploadedAt, durationMs, replaced: boolean, late: boolean }`.

Responses are always JSON with `Cache-Control: no-store`, `{ error, code? }` on failure. The `code` values `quota | storage | lock | limit` let the client open the fallback disclosure (D5/D20) without parsing Turkish.

### 3.3 Sniffing rules (`sniff.ts`)

| Detected | Rule (byte offsets from 0) | Stored type | Ext |
|---|---|---|---|
| ISO BMFF (iPhone Voice Memos, Safari MediaRecorder) | bytes 4–7 = `ftyp`, box size (BE u32 at 0) in 8–1024 and ≤ file size. Any major brand (`M4A `, `mp42`, `isom`, `iso5`, `3gp4`…); a brand allow-list would refuse valid phone files. | `audio/mp4` | `m4a` |
| MP3 | `ID3` + version byte < 0xFF + syncsafe size bytes < 0x80 → skip 10 + size (+10 with the footer flag); then, within the next 4 KB (padding), the first **MPEG Layer III frame**: 11-bit sync, version ≠ reserved, layer bits `01`, bitrate index ∉ {0, 15}, sample-rate index ≠ 3, **and** a second frame header at `offset + frameLength` (unless that is exactly EOF). Without `ID3`, the same two-frame test at 0. | `audio/mpeg` | `mp3` |
| AAC (ADTS) | sync `0xFFF`, layer `00`, sampling index < 13, frame length ≥ 7, **and** a second ADTS header at `+frameLength` (unless EOF). Also after an ID3 tag. | `audio/aac` | `aac` |
| WebM | `1A 45 DF A3` and DocType element `42 82` = `webm` within the first 64 bytes (Matroska `matroska` is refused: it isn't a voice-memo format and adds video risk). | `audio/webm` | `webm` |
| Ogg | `OggS`, version byte 0, header-type BOS flag; the first packet (at `27 + 1 + segmentCount`) starts with `OpusHead` or `\x01vorbis`. | `audio/ogg` | `ogg` |
| WAV | `RIFF` at 0, `WAVE` at 8, a `fmt ` chunk within the first 128 bytes. | `audio/wav` | `wav` |
| MIDI (`checkMidi`) | `MThd`, length `00 00 00 06`, format ≤ 2, ntrks 1–128, division ≠ 0 and **PPQ only** (top bit 0; SMPTE files are refused with the same message, our player can't time them); then walk the chunks: each 8-byte header's length must fit the file, at least one `MTrk`, nothing past EOF. | `audio/midi` | `mid` |

Notes:
- The raw MPEG frame sync is only 11 bits, so without the second-frame test random binary passes about once in 2,000 files. The extra check is about 20 lines.
- A PNG renamed `.m4a`, or text with `Content-Type: audio/mp4`, fails every rule (AC 6). Polyglots (a valid header followed by HTML) are harmless because of how we serve them (§5.2: our stored type, `nosniff`, sandbox CSP).
- An MP4 with a video track passes the `ftyp` rule. I accept that: it's bounded at 4 MB, served as `audio/mp4`, and detecting it means parsing `moov/trak/hdlr`. Not worth it.

### 3.4 Duration

Agree with @po §7.1, with one fix for @ui: for **recordings** the client sends the recorder's own elapsed milliseconds, because Chrome's MediaRecorder WebM has no duration in its header (`audio.duration` is `Infinity` until the whole file has played). For **uploaded files** it sends `audio.duration` after `loadedmetadata` if it's finite, otherwise nothing. The server stores `clamp(round(ms), 0, 600_000)` or null, and nothing (limits, quota, sorting) depends on it. AC 7's "5-second take is 5–80 KB" is checked on `size_bytes`, which is ours.

### 3.5 Idempotency and replays

- A double-tap on `Gönder` or a network retry sends the same `X-Upload-Id`. The second request ends at step 4 (200, same body), or, if it races the first, its insert fails on the primary key inside the tx → its key is queued and it answers 200 with the winner's row. One put may be wasted; there's never a second recording.
- A replayed request from another origin → 403 (`Origin`). A replay with a stolen cookie is just an upload by that user and is bounded by the rate limit, the 5-per-slot cap and the quota guard.

---

## 4. MIDI upload and delete (server actions)

`src/app/(portal)/repertuvar/midi-actions.ts`:

| Action | Input | Authorization | Validation and errors | Side effects |
|---|---|---|---|---|
| `uploadMidi(pieceId, prev, formData)` | `file` (File), `part` (`tutti|soprano|alto|tenor|bass`, default `tutti`), `label` (optional), `uploadId` (UUID per form mount) | `assertManager()` (conductor + board, D24) | piece exists (archived allowed: archiving keeps files, so adding one is harmless) else `Eser bulunamadı.`; `file.size === 0` or > 1,048,576 → `MIDI dosyası en fazla 1 MB olabilir.` (checked **before** `arrayBuffer()`); `checkMidi` → `Bu bir MIDI dosyası değil (.mid).`; `label` through `optionalLine(60)` → `Etiket en fazla 60 karakter olabilir.`; count for the piece ≥ 20 → `Bir esere en fazla 20 MIDI dosyası eklenebilir.`; `uploadsPaused(size)` → `Dosya alanı dolu; yeni dosya yüklenemiyor.`; `consumeAttempt("midi-upload:"+id, 30, 1 h)` → `Çok sık yükleme yaptın. Biraz sonra tekrar dene.` | `logEvent("put")` → put `midi/<uuid>.mid` → `writeTx`: re-check the count < 20 and that the piece exists, insert the row with `id = uploadId` (`onConflictDoNothing`, so a replayed submit is a no-op success). On a tx failure the key is queued. `revalidatePath("/repertuvar/"+pieceId)`. `Dosya yüklendi.` |
| `deleteMidi(midiId)` | UUID | `assertManager()` | missing → `Dosya bulunamadı.` (a repeated delete answers the same, which is idempotent in effect) | `writeTx`: delete the row → key queued. `drainKeys` inline. `Dosya silindi.` |
| `deletePiece(id)` (changed) | | unchanged (`assertManager`) | the Phase 4 homework refusal stays first | in the same tx: MIDI rows deleted (or via FK cascade + trigger, @dba), keys queued; `drainKeys` after commit (AC 54). |

Body size: `experimental.serverActions.bodySizeLimit: "1100kb"` (Phase 8b §0). A 1,048,577-byte file plus about 300 B of multipart still reaches the action, so AC 49 gets our Turkish message, not a framework error. Server actions are POSTs to the page path and so go through the proxy (it buffers up to 10 MB, which is fine here).

Why not the upload route for MIDI as well: the edit page is a normal form with `useActionState`, Next's built-in Origin check and `revalidatePath`. The route's only advantage, a body over 1 MB, isn't needed.

---

## 5. Delivery routes

`runtime = "nodejs"`, `dynamic` by nature (cookies). Not in the proxy matcher.

### 5.1 `GET /api/dosya/kayit/<id>`

1. `getSessionUser()` → none → **401**, empty body.
2. `id` not a UUID → 404.
3. Load the recording: `{ id, assignmentId, userId, storageKey, contentType, sizeBytes, audioDeletedAt, replacedAt }`, the singer `{ role, voicePart, isActive }`, the submission `{ feedback is not null }`, and the viewer's appointment.
4. `canListen(viewer, appointment, singer, recording, commented)` (§6) false → **404**, empty body, `Cache-Control: no-store`. The same answer for "doesn't exist", so existence never leaks.
5. `?indir=1` and `!canDownload(...)` → 404 (owner and conductor only, @po §16).
6. `audioDeletedAt` set → **410**, empty body (only after step 4).
7. `playbackPaused()` → **503** `{ error: "Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).", code: "quota" }`.
8. `consumeAttempt("listen:"+viewer.id, 300, 1 h)` → 429 `Çok sık dinleme isteği. Biraz sonra tekrar dene.`
9. `storage()` null → 503 `{ error: "Kayıt şu an açılamıyor. Biraz sonra tekrar dene.", code: "storage" }`.
10. `driver.get(key, 15 s)`:
    - `null` → re-read the row. If the audio was deleted meanwhile (the sweep raced us) → 410. Otherwise log `storage object missing` (kind only, no ids) → 503 `storage`.
    - A thrown `StorageError` → 503 `storage` (AC 47 `get` fault).
11. `logEvent("get", sizeBytes)`, then 200 with the body.

Headers on every 200:
```
Content-Type: <recordings.content_type>        (from our DB; never the store's header)
Content-Length: <size>
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
Cross-Origin-Resource-Policy: same-origin
Cache-Control: private, no-store
Accept-Ranges: none
Content-Disposition: inline   |   attachment; filename="<Eser>-<Ad-Soyad>.<ext>"   (with ?indir=1)
```
Errors also carry `Cache-Control: no-store` and `nosniff`. The 404/401/410 bodies are empty (AC 3 "no body hint").

### 5.2 `GET /api/dosya/midi/<id>`

1. Session → 401. 2. UUID → 404. 3. Row missing → 404. 4. `consumeAttempt("midi:"+viewer.id, 600, 1 h)` → 429. 5. **No transfer guard** (AC 46: MIDI still plays; a whole month of MIDI is about 60 MB). 6. get → same mapping as above. 7. `logEvent("get", size)`.

Headers: `Content-Type: audio/midi`, `nosniff`, the same sandbox CSP, CORP `same-origin`, `Cache-Control: private, max-age=604800, immutable`, and `Content-Disposition: attachment; filename="Ave-Verum-Corpus-Alto.mid"` with `?indir=1` (AC 4). A deleted MIDI may live on for up to 7 days in a browser cache that already had it. It's repertoire, not personal data, so that's acceptable.

### 5.3 File names (`filename.ts`)

ASCII only, so the AC 4 string is exact and no `filename*` is needed: transliterate `çÇğĞıİöÖşŞüÜ` → `cCgGiIoOsSuU`, NFKD and strip combining marks, replace every run of `[^A-Za-z0-9]` with `-`, trim `-`, cap at 80 characters, fall back to `kayit`/`midi`. Recording: `<piece title>-<singer name>.<ext>`. MIDI: `<piece title>-<label or part label>.mid`. Never put this name in a log.

### 5.4 Why no `Range`

D16's fetch-on-tap plus a `blob:` object URL means one full GET per listen. iOS Safari's `Range` probing only applies when `<audio src>` points at our URL, which we never do. `Accept-Ranges: none` says so explicitly.

---

## 6. Visibility rules (one module: `src/lib/review/access.ts`)

```ts
type Viewer = { id: string; role: Role };                     // from getSessionUser(): active by construction
type Appointment = { allParts: boolean; parts: VoicePart[] } | null;
type SingerRef = { id: string; role: Role; voicePart: VoicePart | null };

/** D9: conductor role or a leaver ignores the row; it is not deleted. */
export function effectiveAssistant(v: Viewer, a: Appointment) {
  return a !== null && (v.role === "member" || v.role === "board") ? a : null;
}
export function covers(a: NonNullable<Appointment>, s: SingerRef) {
  return s.voicePart !== null && (a.allParts || a.parts.includes(s.voicePart));
}
/** Audio bytes. Owner, conductor, or an in-scope assistant who isn't the singer and before the comment. */
export function canListen(v: Viewer, a: Appointment, s: SingerRef, commented: boolean) {
  if (v.id === s.id) return true;
  if (v.role === "conductor") return true;
  const eff = effectiveAssistant(v, a);
  return eff !== null && !commented && covers(eff, s);
}
export function canDownload(v: Viewer, s: SingerRef) { return v.id === s.id || v.role === "conductor"; }
/** The review page /odevler/<id>/dinle/<userId>. */
export function canReview(v: Viewer, a: Appointment, s: SingerRef) {
  if (v.role === "conductor") return v.id !== s.id;
  const eff = effectiveAssistant(v, a);
  return eff !== null && v.id !== s.id && covers(eff, s);
}
```

"Active" needs no check of its own: `getSessionUser()` only returns active users, and the schema's `users_left_matches_active` CHECK ties `is_active` to `left_at is null`. Every rule reads the singer's **current** `voice_part` (AC 20).

| Who | Audio of X | Review page of X | Assistant notes on X | Conductor comment on X |
|---|---|---|---|---|
| X (the singer) | yes, `İndir` too | 404 | **never**: no text, count or author (no query on the singer's paths touches the notes table) | yes (`Şefin notu` / `Geri bildirim`, Phase 4) |
| Conductor | yes, `İndir` too | yes | all, with author and `Önceki kayda yazıldı` | yes, edits and deletes it |
| Assistant in scope, ≠ X | yes until the conductor comments, then 404 (@po §16); no `İndir` | yes; after the comment: their own note read-only, no player | **only their own** | **never**: only `commented: boolean` → `Şef yorumunu gönderdi.` |
| Assistant out of scope / removed / now conductor | 404 | 404 (a conductor gets the conductor's view) | — | — |
| Board (not an assistant) | 404 | 404 | never | Phase 4 manager views keep feedback **text** visible to managers? See @po §16 item 6. |
| Other members | 404 | 404 | never | never |

Query discipline (`src/lib/review/queries.ts`), which AC 24/30 test with marker greps:
- `reviewForAssistant(viewer, assignmentId, singerId)` selects the recording fields, the singer's name and part, `submissions.submitted_at`, **`submissions.feedback is not null` as `commented`**, and `assistant_notes … where assistant_id = viewer.id`. It never selects `feedback`, `feedback_by` or other assistants' notes. Its return type has no field that could hold them.
- `reviewForConductor(...)` selects everything. It's called only after `viewer.role === "conductor"`.
- The singer's homework queries (`src/lib/homework/queries.ts`) stay as they are. The transparency text uses `listenersFor(singer)`, which returns only names of effective assistants covering the singer's part.
- Client components get picked fields, never whole rows (RSC payloads count as "the page").
- `/odevler/dinle` for an assistant: `Dinlenecek` = current recordings, audio present, singer in scope and ≠ viewer, feedback null, and no note by me **or** my note's `recording_id` ≠ the current recording id (`Yeni kayıt`). `Not yazdıklarım` = my notes on slots without a comment. `Portalda kayıt yok` rows never appear (AC 22).
- The conductor's chips per D13. `reviewBadgeCount()` = submissions with `submitted_at` not null, `feedback` null and ≥ 1 note (one aggregate with `exists`). The layout calls it **only** when `role === "conductor"`.
- `nextItem(chip, currentKey)` orders by `(assignments.due_at desc, part order S/A/T/B, users.name collate, users.id)` and returns the first item with a key greater than the current one. After a save the current item may have left the list, so the next item is found by **sort key**, not by index (AC 33 `Bu listede başka kayıt yok.`).

---

## 7. Server actions (changed and new)

Common to all of them: `assertUser()`/`assertManager()` first. IDs go through `z.uuid()`. Text goes through `optionalText(1000)` plus CRLF→LF. Writes that depend on reads run in `writeTx`. `revalidatePath("/", "layout")` after every write that can move a badge. `FORBIDDEN = "Bu işlem için yetkin yok."`

### 7.1 Assistants (`odevler/asistanlar/actions.ts`, conductor only)

| Action | Input | Rule | Errors | Effect |
|---|---|---|---|---|
| `addAssistant(prev, fd)` | `userId`, `scope = all | parts`, `parts[]` | `actor.role === "conductor"` (`canManageAssistants`) | the target must be active, `member|board`, ≠ actor → `Bu kişi asistan olamaz.`; already an assistant → `Bu kişi zaten asistan.`; scope `parts` with none → `En az bir partisyon seç.` | Insert the appointment (+ parts). Idempotent: the PK is the user id. |
| `updateAssistant(userId, prev, fd)` | same scope fields | conductor | not an assistant → `Asistan bulunamadı.` | Replace the scope in one tx. |
| `removeAssistant(userId)` | | conductor | — | Delete the appointment. Notes stay (FK on `assistant_id` is `restrict` to users, not to the appointment). Access ends immediately because every request re-reads the appointment. |

### 7.2 Assistant notes (`odevler/dinle/actions.ts`)

| Action | Input | Rule (all re-checked inside `writeTx`) | Errors | Effect |
|---|---|---|---|---|
| `saveAssistantNote(assignmentId, singerId, prev, fd)` | `note` (1–1000 after trim), `recordingId` (the one on screen) | `canReview(viewer, appointment, singer)`; a current recording exists, audio not deleted; **`recordingId` equals the current id**; submission `feedback is null` | not allowed → `FORBIDDEN` (AC 30: same for korist@ and yk@); empty → `Notunu yaz.`; > 1000 → `Not en fazla 1000 karakter olabilir.`; stale → `Kayıt bu arada değişti. Yeni kaydı dinleyip notunu kaydet.`; commented → `Şef yorumunu gönderdi; artık not eklenemez.` | Upsert on (`assignment_id`, `singer_id`, `assistant_id`), set `recording_id = current`, `updated_at`. Re-saving the same text is a no-op. `Notun kaydedildi.` |
| `deleteAssistantNote(assignmentId, singerId)` | | same, but no recording needed | commented → the same lock message | Delete own note only (`where assistant_id = actor.id`). `Not silindi.` |

### 7.3 Conductor and singer (changes in `odevler/actions.ts` + new `kayit-actions.ts`)

| Action | Change | Errors | Effect |
|---|---|---|---|
| `saveFeedback(assignmentId, userId, prev, fd)` | `canWriteFeedback(actor.role)` (= conductor). New hidden field `recordingId` (empty when `Portalda kayıt yok`). Wrapped in `writeTx`. | non-conductor → `Geri bildirimi yalnızca şef yazar.` (AC 32, nothing written); `recordingId` ≠ current recording id, or one is empty and the other isn't → `Korist bu arada kaydını değiştirdi. Yeni kaydı dinleyip yorumunu gönder.` | As today, plus: **null → text**: the current recording's `commented_at = now` (sets the deletion date, D17). **Text → other text**: `commented_at` unchanged, `feedbackSeenAt = null` (Phase 4 D10). **Text → empty**: `commented_at = null` (the 120-day rule applies again), the item returns to the queues, and the singer is unlocked (AC 31). |
| `undoSubmission(id)` (`Geri al` in the disclosure) | If a current recording exists, it does the same as `deleteMyRecording` in the same tx. A submission must never be removed with a live recording left under it. | `Şef yorum yazdı; kaydını artık değiştiremezsin.` when feedback exists and there is a recording; Phase 4's `FEEDBACK_LOCK` copy otherwise | Like today, plus the recording handling. |
| `deleteMyRecording(assignmentId)` | new | not owner / nothing there → `Kayıt bulunamadı.`; feedback present → the lock message (AC 13) | `writeTx`: current recording → `audio_deleted_at = now, replaced_at = now, deleted_reason = 'withdrawn'` (key queued); delete the submission if `feedback is null` (it is, given the lock). `drainKeys`. `Kaydın silindi.` The 5-per-slot counter **still counts** the withdrawn upload (D7 counts uploads). |
| `deleteRecordingAsConductor(recordingId)` | new | non-conductor → `FORBIDDEN` | Audio removed, `deleted_reason = 'conductor'`. **The submission and the comment stay** (D17: words are kept). `drainKeys`. |
| `setSubmissionFor(a, u, false)` | refused when a current recording with audio exists | `Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil.` (new copy, @po) | Otherwise unchanged. Marking `true` is unchanged. |
| `submitAssignment` | unchanged (a no-op when a recording already made the submission) | | |
| `deleteAssignment(id)` | in the same tx, recordings and notes go with it; keys are queued (trigger or explicit insert-select before the delete, §8.1) | | `drainKeys` after commit. The confirm copy's `<k> ses kaydı` = count of rows with audio present. |
| `earlyClean()` (`depolama/actions.ts`) | conductor only (`canEarlyClean`) | yk@ → `FORBIDDEN` (AC 48) | `runStorageSweep({ reason: "early", today, deadline: now + 20 s })`: expires recordings whose comment day + 30 ≤ today, then drains. Comments and notes stay. `<n> kayıt silindi.` |

---

## 8. Retention, deletion queue, sweep, cron

### 8.1 Invariant

> A storage key is either **live** (exactly one live row references it: a recording with `audio_deleted_at is null`, or a MIDI row), or it is **in the deletion queue** until the driver confirms the delete.

Every transition out of "live" queues the key **in the same statement or batch**:
- `recordings.audio_deleted_at` null → not null (replace, withdraw, conductor delete, retention, early clean).
- Delete of a `recordings` row (cascade from `assignments`) or a `midi_files` row (direct, or cascade from `pieces`).
- A put whose DB transaction never committed (§3.2 step 9).

@dba, my recommendation: **`AFTER UPDATE OF audio_deleted_at` and `AFTER DELETE` triggers** on `recordings` and `midi_files` that `insert into storage_deletions(key, size_bytes, requested_at)` (guarded by `old.audio_deleted_at is null` for recordings). SQLite runs FK cascade deletes as child-row deletes, so the child's `AFTER DELETE` trigger fires. Please confirm it on a scratch DB. Triggers cover every current and future code path, a raw `delete from assignments` included. The only explicit enqueue left in app code is the "put landed, tx didn't" case. If you prefer action-only enqueues, list every path from §7 in `db.md` and I'll do the insert-selects.

### 8.2 Retention rules (D17) in Istanbul days

The audio is deleted on Istanbul **day D**, and the UI shows the same D:
- Commented: `D = istanbulDateOf(commented_at) + 90 days`.
- Never commented: `D = istanbulDateOf(uploaded_at) + 120 days`.
- Early clean: `istanbulDateOf(commented_at) + 30 ≤ today`.

In SQL terms, with `today = istanbulDateOf(now)`:
- `cut90 = istanbulToUtc(addDays(today, -89))` → expire if `commented_at < cut90`.
- `cut120 = istanbulToUtc(addDays(today, -119))` → expire if `commented_at is null and uploaded_at < cut120`.

A worked example: commented 2026-10-21 at 14:00, so D = 2027-01-19. On 2027-01-19, `today − 89` = 2026-10-22 00:00 Istanbul > the comment time → expired at that morning's 08:00 sweep. With a plain `commented_at + 90 × 24 h` the 08:00 sweep would miss it by 6 hours and delete it on 2027-01-20, one day after the date the page promised. AC 28's test computes `today + 90` the same way (`Intl` tr-TR, Istanbul). Turkey has had no DST since 2016, but the helpers in `src/lib/time.ts` handle offsets anyway.

`commented_at` lives on the recording and is the **first** conductor comment: editing doesn't move it, deleting the comment clears it (§7.3). `submissions.feedback_at` can't be used because Phase 4 moves it on every edit.

### 8.3 `runStorageSweep({ today, deadline, reason })` (`sweep.ts`, never throws)

1. **Expire** (one write batch, no interactive tx): `update recordings set audio_deleted_at = :now, deleted_reason = 'retention' where audio_deleted_at is null and ((commented_at is not null and commented_at < :cut90) or (commented_at is null and uploaded_at < :cut120))`. For `reason = "early"`, the condition is `commented_at < :cut30` and the reason `early`. The trigger queues the keys. Idempotent.
2. **Stale uploads**: ledger rows still `uploading` after 1 h (a crash between put and commit) → queued. This only applies if @dba keeps an `uploading` state (§15).
3. **Drain**: `select … from storage_deletions where done_at is null order by requested_at limit 500`, in chunks of 50: `driver.delete(keys, 10 s)`. On success, `done_at = now`. On failure, `attempts + 1, last_error = kind` and the row stays (AC 40: retried the next day). Stop when `Date.now() > deadline - 2 s`.
4. **Prune**: `storage_events` older than 40 days; done queue rows older than 30 days; `storage_sweeps` beyond the last 60. Login-attempt rows are already pruned by Phase 1.
5. **Record**: insert `storage_sweeps { started_at, finished_at, reason, expired, deleted, failed, status: ok|partial|failed }`. `/odevler/depolama` shows the newest one as `Son temizlik: <tarih> · <deleted> dosya silindi` (AC 41).
6. Log `storage sweep {reason, expired, deleted, failed, ms}`.

Any exception inside a step is caught. The step is recorded as failed and the next step still runs where that makes sense (a failed expire doesn't stop the drain). A duplicate cron delivery or a parallel early clean is harmless: every write is guarded by `is null`, and Blob `del` is idempotent.

`drainKeys(keys, budgetMs)` (inline, after actions) is step 3 restricted to the given keys, with a `budgetMs` abort. It never fails the action.

### 8.4 Cron integration (D18): isolated, response unchanged

```ts
export async function GET(request: Request) {
  await connection();
  const started = Date.now();
  // secret / bearer checks exactly as today → 503 / 401 (the sweep doesn't run either)
  const today = testToday(url) ?? istanbulDateOf(new Date());
  let code = 500;
  let status: RunResult = "failed";
  try {
    const { result } = await runMonthlyBackup({ trigger: "cron", today });
    code = result === "failed" ? 500 : 200;
    status = result;
  } catch (e) {
    console.error("backup cron failed before the run was claimed", { name: …, code: … });
  }
  // Independent step: runs whatever the backup did, never changes the reply.
  await runStorageSweep({ today, deadline: started + 55_000, reason: "cron" });
  return reply(code, status);
}
```

- **Sequential, backup first.** Running both in parallel isn't safe. The backup's `claim()` maps `SQLITE_BUSY` to "not claimed", and on the local driver a concurrent sweep write could make the backup **skip** its day. Running the sweep first would delay the backup. Afterwards it can't affect the backup at all.
- `maxDuration` stays 60 and `STALE_SECONDS` stays 600: no change to Phase 7. On the one day a month the backup sends (up to about 45 s), the sweep may get only a few seconds and does at least the expire step. Anything left waits for the next day. The other 29 days the backup skips in milliseconds.
- `after()` (Next 16) would also work, but the test would then have to poll for the sweep. The sequential version is deterministic and still keeps the backup's own work out of the sweep's way.
- **Response**: still `{ status }` only. **@po: I disagree with "added to the response as a new key"**. `e2e/phase7-a-cron.mjs:186` asserts `Object.keys(body)` is exactly `["status"]` (AC 2/36), so a new key means editing a Phase 7 check that D30 doesn't list. The sweep is observable through `storage_sweeps`, which `/odevler/depolama` and the e2e read.
- `?bugun=` (dev-only) feeds the sweep's `today` too, so e2e can test the day boundaries without arranging timestamps to the hour.

---

## 9. Proxy, CSP and Permissions-Policy (D23)

- `src/proxy.ts` CSP: `"media-src 'self'"` → `"media-src 'self' blob:"`. Nothing else changes: `connect-src 'self'` covers the fetch, the player chunk comes from `/_next/static` under `'strict-dynamic'`, there's no worklet (so `worker-src` is unchanged), and production `script-src` still has no `unsafe-eval` (AC 5).
- `next.config.ts` `Permissions-Policy`: `microphone=()` → `microphone=(self)`, the rest unchanged. `screen-wake-lock` defaults to `self` for the top-level document, so no entry is needed for Wake Lock.
- Proxy matcher: add `api/dosya/` to the negative lookahead: `"/((?!_next/static|_next/image|brand/|icons/|api/dosya/|sw\\.js$|offline\\.html$|[^/]+\\.(?:svg|png|ico|webmanifest)$).*)"`. Three reasons:
  1. The proxy holds the whole request body in memory, and past `proxyClientMaxBodySize` (10 MB) it **truncates without an error**. Our streaming cap would then see a short body and might accept a corrupt file. Below 10 MB it's only a wasted copy, but nothing guarantees a future default.
  2. The proxy sets the page CSP on the response. Our route sets its own `sandbox` CSP, and two writers for one header is a bug waiting to happen.
  3. `/api/` is already a public prefix in the proxy, so it adds nothing there.
  `next.config.ts` `headers()` still apply to `/api/dosya/*` (nosniff, DENY, Permissions-Policy, HSTS).
- @ui: the D16 sandbox CSP has `default-src 'none'`, so **opening** `/api/dosya/kayit/<id>` as a top-level tab won't play in Chrome's media viewer. It doesn't matter for us: the player fetches into a `blob:` and downloads are `attachment`. I'm keeping the exact D16 string because AC 3 checks it.

---

## 10. Quota counters and the guard (D19, D20)

| Meter | Our number | Limit (decimal, pessimistic) | Source |
|---|---|---|---|
| `Depolama` | Bytes **still in the store** = recordings with audio present + MIDI rows + queue rows not yet done. A queued file still occupies Vercel storage until the delete succeeds. | 1,000,000,000 B | `sum(size_bytes)` over the three |
| `Yükleme (son 30 gün)` | `storage_events` `kind = 'put'`, `at > now − 30 × 24 h` (failed puts included) | 2,000 | count |
| `Aktarım (son 30 gün, tahmini)` | `2 × sum(bytes)` of `kind = 'get'` over the same window | 10,000,000,000 B | sum |
| `Okuma (son 30 gün)` | count of `kind = 'get'` | 10,000 | count |

- `uploadsPaused(incoming)` is true when `(stored + incoming) / 1e9 ≥ 0.95` or `(puts + 1) / 2000 ≥ 0.95`. That uses the **projected** value, so a 4 MB file at 94.9% can't push the store to 95.3%. `playbackPaused()` is true when `transfer ≥ 100%` or `reads ≥ 100%`. Warnings appear at ≥ 80% on any meter.
- Race: two uploads that both pass at 94.9% add at most 2 × 4 MB to a margin of 50 MB. That's acceptable, so there's no lock.
- Rolling 30 × 24 h windows are instants, so no timezone question. Displayed dates use `Intl` tr-TR, Istanbul.
- Cost: three indexed aggregates per upload or listen, at fewer than 2,000 events a month. A cached snapshot isn't worth it. The layout banner for managers uses the same `usage()`, wrapped in React `cache()` per request.
- Our counts drift from Vercel's (dashboard browsing, CDN hits). Uploads and transfer are counted pessimistically. Storage is exact for our own bytes.

---

## 11. MIDI player choice (D25)

- **`@tonejs/midi@2.0.28`**, MIT. Dependencies `midi-file@1.2.4` (MIT) and `array-flatten` (MIT). Measured on 2026-10-21 (esbuild `--bundle --minify`, gzip -9): **32,583 B minified, 9,525 B gzipped**. `midi-file` alone is 3.1 KB gz. Last published in 2022: no activity, but the SMF format hasn't changed since 1996 and the package is widely used. Pin the exact version.
- Why not our own parser: the tricky parts are running status, the tempo map (ticks → seconds across `FF 51` changes), note-on velocity 0 as note-off, and overlapping same-pitch notes. `@tonejs/midi` gives us tracks with `{ name, channel, notes: [{ midi, time, duration, velocity }] }` already in seconds. About 6 KB gz extra buys a lot of correctness. Fallback if it ever has to go: `midi-file` plus about 80 lines of tempo map.
- Synth: hand-written. Per note, an `OscillatorNode` (`triangle`) into a `GainNode` with a short attack/release envelope. A look-ahead scheduler (a 25 ms timer scheduling a 100 ms window) handles pause, seek, the tempo chips (scale times by 1/rate) and per-track mute without rebuilding. Skip channel 10 (percussion). No soundfont, no worklet, no CSP change. Estimate: parser plus synth plus UI is about 15 KB gz, against a budget of 60 (AC 52).
- Loading: `await import("@/components/midi/player")` on the first `Çal` tap. The file comes from `fetch("/api/dosya/midi/<id>")` (the browser's HTTP cache honours `max-age=604800, immutable`).
- **Untrusted input on the client**: the server has already walked the chunks (§3.3). The player caps notes at 200,000, tracks at 64 and duration at 30 minutes, and refuses beyond that with `Bu MIDI dosyası çalınamıyor.` (new copy, @po/@ux). Parsing sits in `try/catch`. The worst a crafted file can do is make one tab work hard; it runs no code.

---

## 12. Rate limits

| Key (`consumeAttempt`) | Max | Window | Why |
|---|---|---|---|
| `upload:<userId>` | 20 | 1 h | A loop bug or stolen session can't burn the 2,000 operations. 5 per slot is the product rule; this is the safety net. |
| `listen:<userId>` | 300 | 1 h | The conductor reviewing 40 takes with replays is about 100. |
| `midi:<userId>` | 600 | 1 h | Mostly served from the browser cache; this only catches loops. |
| `midi-upload:<userId>` | 30 | 1 h | Managers only. |

No limit on note, comment, assistant or early-clean actions: they're role-gated, bounded, and one row per slot. These keys live in `login_attempts`, which `forgetLoginAttempts` already prunes after 24 h. A refused request has already inserted its attempt row, which is acceptable here: the limit then stays strict.

---

## 13. Test hooks

| Hook | Read where | Guard | Effect |
|---|---|---|---|
| `arkhe_e2e_storage_fault=put|get|delete` (cookie) | `storage()` wrapper on every op, in routes, actions and the cron | `NODE_ENV !== "production" && isLocalDb(env)` | throws `StorageError(op, "fault")` |
| `arkhe_e2e_recorder_limit=<1–600>` (cookie) | the server page of `/odevler/<id>` → `recorderLimitSeconds()` → prop `maxSeconds` | same | the recorder stops at that many seconds and shows `Kayıt 10 dakikada durdu.` (AC 16; the copy stays the same) |
| `?bugun=YYYY-MM-DD` | the existing cron route | `NODE_ENV !== "production"` (unchanged) | also feeds the sweep's `today` |

`e2e:prod` sets both cookies and asserts they do nothing (AC 47, AC 59). Chrome flags per D27 are e2e-only.

---

## 14. Logging (no personal data)

Allowed: the event (`recording upload`, `recording upload refused`, `storage put failed`, `storage get failed`, `storage object missing`, `storage sweep`), `driver`, `op`, `kind`, error `name`/`code`, `bytes`, `type`, `durationMs`, `ms`, and counts.

Never: user ids, names, emails, piece or assignment titles, file names (`Content-Disposition`), storage keys or Blob URLs (a URL plus a leaked token is a file), note or comment text, IPs, request URLs with query strings, and the `cause` chain of a `BlobError` (its message can include the URL). `StorageError.message` is built only from `op` and `kind`. Refusals (403/404/409/415) aren't logged at all, so the logs can't show "who tried to listen to whom".

---

## 15. Data I need from @dba (shape is yours)

1. **`recordings`**: `id` (uuid, client-made per take), `assignment_id` → assignments **cascade**, `user_id` → users restrict, `storage_key` unique not null, `content_type` CHECK in the six audio types, `size_bytes` 1–4,194,304, `duration_ms` null or 0–600,000, `uploaded_at`, `replaced_at` null, `commented_at` null, `audio_deleted_at` null, `deleted_reason` null or in (`replaced`, `withdrawn`, `conductor`, `retention`, `early`) with CHECK `(audio_deleted_at is null) = (deleted_reason is null)`. **A partial unique index on (`assignment_id`, `user_id`) where `replaced_at is null`** = one current recording (AC 56). Rows are never deleted except by cascade, so the 5-upload count is `count(*)` per slot (I need an index on `(assignment_id, user_id)`). Indexes for the sweep: `(audio_deleted_at, commented_at)` and `(audio_deleted_at, uploaded_at)`, or one partial index `where audio_deleted_at is null`.
2. **`assistant_notes`**: (`assignment_id` cascade, `singer_id` → users restrict, `assistant_id` → users restrict) PK. `recording_id` → recordings, which **must not cascade-delete the note** when a recording row goes. Recording rows only go with their assignment, so `cascade` there is fine. `body` CHECK `length(trim(body)) between 1 and 1000`, `created_at`, `updated_at`. Index `(assistant_id)` for `Not yazdıklarım`.
3. **`listening_assistants`**: `user_id` PK → users restrict, `all_parts` bool, plus a parts child table (or a CHECKed column) with the voice-part enum and a CHECK "all_parts or ≥ 1 part" (the ≥ 1 part rule may live in the action if a CHECK can't express it). `created_by`, `created_at`, `updated_at`.
4. **`midi_files`**: `id`, `piece_id` → pieces **cascade** (D24: the files go with the piece, queued), `part` CHECK in `tutti|soprano|alto|tenor|bass`, `label` null or 1–60, `storage_key` unique, `size_bytes` 1–1,048,576, `created_by`, `created_at`. Index `(piece_id)`.
5. **`storage_deletions`** (the queue): `key` PK (a key is queued once; `insert or ignore`), `size_bytes`, `requested_at`, `done_at` null, `attempts` default 0, `last_error` null or in the `kind` list. Index `where done_at is null`.
6. **`storage_events`**: `id`, `kind` in (`put`, `get`), `bytes`, `at`. No user id (§14). Index `(kind, at)`.
7. **`storage_sweeps`**: `id`, `reason` in (`cron`, `early`), `started_at`, `finished_at`, `expired`, `deleted`, `failed`, `status` in (`ok`, `partial`, `failed`).
8. The triggers of §8.1, or your alternative.
9. Optional: an `uploading` state for keys between put and commit (closes the crash-between-put-and-commit orphan, §8.3 step 2). Without it, the rare orphan costs at most 4 MB and is logged. I'm fine either way, but tell me which.
10. Seed (D26): please document the expected queue counts per role in the seed file. I need at least one recording whose `commented_at` gives a deletion date in the future, and korist@'s E with `audio_deleted_at` set and `deleted_reason = 'retention'`. Seed files go through the local driver into `data/uploads/` with real UUID keys.

Migration `0010_…` is additive only (constraint 1): new tables, indexes and triggers on **new** tables, nothing touching existing ones.

---

## 16. Replies

**@po** (answers to §7.1, then points where I propose a change):

1. **Server upload ≤ 4 MB**: confirmed, through a route handler with a **raw body** (headers carry the metadata), not multipart and not a server action (§3.1). 4,194,304 B plus headers is far below the 4.5 MB function payload limit. Above it Vercel returns its own 413, which the client maps to the 4 MB copy.
2. **Sniffing in our own code**: agree, with stricter rules than "first bytes" (§3.3). **Duration**: agree (client-reported, clamped 0–600 s, nullable, never trusted), with the WebM fix in §3.4.
3. **Hooks**: as in §13. The sweep plugs into the cron route **after** the backup, isolated, with a deadline (§8.4). **Disagree** with adding a response key: Phase 7's AC 2/36 test asserts the keys are exactly `["status"]`. The sweep result lives in `storage_sweeps` and the log, and AC 41 can read it there and on `/odevler/depolama`. Please change the D18 sentence to "the response stays exactly as in Phase 7".
4. **`@vercel/blob`**: 2.8.2 (2026-10-14), Apache-2.0 (permissive and free; I read "MIT or similar" as including it). Private storage needs ≥ 2.3. Blob is "available on all plans", Hobby included, and Hobby is blocked, never billed, over its limits. Auth is OIDC + `BLOB_STORE_ID` on Vercel (the SDK refreshes the token from the request context) or `BLOB_READ_WRITE_TOKEN` elsewhere. `get(key, { access: "private" })` returns a `ReadableStream` that we pass straight through (4 MB < the 4.5 MB response limit). It returns `null` on 404 and throws `BlobError` on any other status, which maps cleanly onto D21 (§2.4).
5. **Assistant access after the comment** (new, data minimisation): once the conductor has commented, an assistant's `/api/dosya/kayit/<id>` answers 404 and their review page shows only their read-only note and `Şef yorumunu gönderdi.`, without the player. They're done, and the singer's voice shouldn't stay reachable for 90 more days by people who no longer review it. If you want them to keep listening, it's one line in `canListen`.
6. **Feedback text on the board's views.** Phase 4 lets managers read every feedback text, so yk@ still sees the conductor's comments in the roster. D4 only takes away audio. Please confirm the board keeps **reading** comments (my default: yes, unchanged Phase 4 behaviour). Assistant notes stay conductor-only either way (constraint 4).
7. **`İndir` for recordings**: owner and conductor only (`?indir=1` → 404 for assistants). It's friction, not a hard wall: an assistant who can listen can capture the audio. It still makes the intended use clear.
8. **The comment lock is any feedback**, including legacy board notes (Phase 4 rows). That matches Phase 4's `undoSubmission` lock and keeps one rule. A conductor who wants to unlock deletes the old note.
9. **New copy** for @ux to polish:
   - `Kayıt boş görünüyor. Yeniden kaydet.`
   - `Çok sık yükleme yaptın. Biraz sonra tekrar dene.`
   - `Çok sık dinleme isteği. Biraz sonra tekrar dene.`
   - `Kayıt bu arada değişti. Yeni kaydı dinleyip notunu kaydet.` (assistant)
   - `Korist bu arada kaydını değiştirdi. Yeni kaydı dinleyip yorumunu gönder.` (conductor)
   - `Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil.` (manager unmark with a recording)
   - `Notunu yaz.`
   - `Bu kişi asistan olamaz.`, `Bu kişi zaten asistan.`, `Asistan bulunamadı.`
   - `Kayıt bulunamadı.`, `Dosya bulunamadı.`
   - `Bu MIDI dosyası çalınamıyor.`
   - `Dosya yüklendi.`, `Dosya silindi.`, `Kaydın silindi.`, `Notun kaydedildi.`, `Not silindi.`
10. **Retention dates are Istanbul days** (§8.2). "Deleted on D" is the same D the page shows, and the 08:00 sweep deletes on that morning.
11. **1 GB means 10⁹ bytes** (pessimistic), and the uploads guard looks at the projected value. The storage meter includes queued, not-yet-deleted bytes (§10).
12. **Future, not this phase**: deleting a leaver's audio early (KVKK). Today the 90/120-day rules cover it within a term. I'm only noting it for the backlog.

**@dba**: §15 is what I need. My preference is triggers for the queue (§8.1). Please verify that a cascade from `assignments`/`pieces` fires the child's `AFTER DELETE` trigger in libSQL; AC 40/54 check it end to end. Keep `recordings` rows forever (history plus the 5-upload count), and don't cascade notes off recordings.

**@ui**:
- The upload is `fetch("/api/dosya/kayit?odev=<id>", { method: "POST", body: blob, headers: { "X-Upload-Id": uploadId, "X-Recording-Duration-Ms": ms } })`. Make `uploadId` once per take and reuse it for `Tekrar dene`. Map 413 (ours or Vercel's) → the 4 MB copy, `code: "quota"|"storage"` → open the fallback and keep `Kaydı indir`, 409 → show `error`.
- For playback, the statuses map like this: 410 → `Ses dosyası silindi…`, 503 `quota` → the D20 sentence, anything else → `Kayıt şu an açılamıyor…`.
- Duration: recorder elapsed ms for recordings (§3.4).
- The recorder limit arrives as a server prop.
- Player caps per §11. Note the sandbox CSP point in §9.

**@ux**: the copy list is in @po item 9. A singer's `Sil` keeps counting toward the 5 uploads (D7), so the recorder should say `<n>/5` once n ≥ 3, or the 6th refusal will come as a surprise.

---

## 17. Env, README, boot

- New env (all optional): `BLOB_STORE_ID` (Vercel adds it on connect, together with OIDC), `BLOB_READ_WRITE_TOKEN` (Render / outside Vercel). Nothing new is required for dev or e2e.
- `bootWarnings`: the storage line from §2.2.
- README:
  - Creating a **private** Blob store and connecting it (Production only).
  - The Render fallback token.
  - "Browsing the Blob store in the Vercel dashboard costs operations."
  - Local uploads in `data/uploads/` (`data/uploads-e2e-prod/` for `e2e:prod`), which `db:reset`/e2e wipe.
  - The D22 backup sentence, and the KVKK line from risk 7.
- `package.json`: `"@vercel/blob": "2.8.2"`, `"@tonejs/midi": "2.0.28"` (exact pins, like `nodemailer`).
