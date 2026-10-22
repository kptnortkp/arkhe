# Phase 9 UI engineering plan

Author: UI engineer. Date: 2026-10-21. Reads: `po-spec.md` (59 ACs, D1–D30). `ux.md`, `db.md` and `backend.md` don't exist yet; where I depend on them I say so and will reconcile when they land. Also read: `design/TEAM.md`, Phase 8 `po-decisions.md` D22/D31 (bar and `data-board-badge`), Phase 8b `ui.md`/`po-decisions.md` (runner regex), Next 16 docs `02-guides/lazy-loading.md`, `03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`, `serverActions.md`; and the current `src/proxy.ts`, `next.config.ts`, `src/lib/api.ts`, `public/sw.js`, `src/components/shell/{nav-items.ts,app-nav.tsx}`, `src/components/homework/{singer-steps,roster}.tsx`, `src/app/(portal)/odevler/[id]/page.tsx`, `src/components/{use-run-action.ts,confirm-dialog.tsx}`, `src/components/forms/choice-group.tsx`, `src/lib/format.ts`, `scripts/homework-fixture.mjs`, `e2e/{run,lib,phase4-homework,phase6-b-security,phase7-a-cron,prod}.mjs`.

Facts I checked (each one changes the plan or a test):
- **The proxy runs on `/api/*` and overwrites `Content-Security-Policy`.** `src/proxy.ts:52` sets the page CSP on every matched response, and the matcher includes `/api/`. So the D16 `default-src 'none'; sandbox` header from the file route would be replaced by the page policy, and AC 3 fails. The proxy also buffers every request body (`proxyClientMaxBodySize`, default 10 MB), so each 4 MB upload is copied in memory once more for nothing. **Fix (@backend):** add `api/dosya/` to the matcher's negative lookahead. The route checks the session itself (as every `/api/` route already does: `PUBLIC_PREFIXES` lets `/api/` through without a redirect).
- **Server actions cap the request body at 1 MB** (`serverActions.md`). A 1 MB MIDI file plus multipart overhead is over it and dies in Next before our `MIDI dosyası en fazla 1 MB olabilir.` can answer. So **MIDI uploads go through a route handler too**, with the same upload client as recordings (§3). No `bodySizeLimit` change.
- **`fetch()` can't report upload progress** (streaming request bodies are Chrome-only, need HTTP/2 and still give no progress events). The upload uses `XMLHttpRequest` and `xhr.upload.onprogress` (§3).
- **`page.request.post` sends no `Origin` header.** `sameOrigin()` (`src/lib/api.ts:22`) refuses a missing `Origin`, so every e2e upload made with `page.request` must set `Origin: BASE` explicitly; the AC 6 cross-origin test simply omits it or sends `https://evil.test`. A real browser `XMLHttpRequest`/`fetch` POST always sends `Origin`, same-origin included.
- **`e2e/run.mjs` launches one shared Chrome without args** and passes it to every file (`run.mjs:12`, `lib.mjs:39`). Media flags must be set at launch, so the recording suites launch their own browser (§9.1).
- **`seedHomework` deletes and re-inserts the fixture submissions and assignments** (`scripts/homework-fixture.mjs:126-128`) on every `cleanup()`. Any Phase 9 row that references them with `restrict` breaks every e2e run; with `cascade` the seeded recordings vanish and their files are orphaned. The media fixture must clear its rows and files **before** `seedHomework` and re-seed **after** it (§9.2, @dba).
- **The service worker never caches `/api/`, pages or RSC** (`public/sw.js:1`, and `isCacheable` refuses `private`/`no-store`). Recordings and MIDI never land in Cache Storage. The lazily loaded MIDI chunk is under `/_next/static/` and gets the cache-first treatment, which is what we want.
- **Chrome ≥ 126 supports `audio/mp4` in `MediaRecorder`.** With D6's order, desktop/Android Chrome will produce MP4, not WebM. That is good (iPhones play it, which removes risk §8.2), but `audio/mp4` without a codec may give **Opus in MP4**, which older Safari doesn't play. See §2.2 for the order I propose.
- **MediaRecorder output has no usable duration in its header** (Chrome's WebM and fragmented MP4 report `duration = Infinity` until fully played). The UI never reads duration from the media element for display; it uses the recorder clock or the stored value (§2.5).
- Phase 6 checks need **no change** for D23: `phase6-b-security.mjs` checks the nonce, not `media-src`, and `prod.mjs:466` checks only that `Permissions-Policy` contains `camera=()`.
- Existing helpers to reuse: `formatDuration(sec)` (`m:ss`) and `formatBytes` (KB/MB) in `src/lib/format.ts`; `FilterChip`, `ConfirmDialog`, `useRunAction`, `ChoiceGroup`, `PartDot`. `formatBytes` has no GB branch; the gauge needs one (§6).

**No new dependency. No new shadcn component.** I use `button`, `label`, `textarea`, `input`, `sheet`, `select`, `alert-dialog` (via `ConfirmDialog`), `badge`, `separator`, `sonner`. The MIDI parser and synth are our own code (§7.2), not `@tonejs/midi`.

---

## 1. Files (frontend side; @backend owns `src/lib/media/*`, the route handlers and the actions)

| File | Kind | Content |
|---|---|---|
| `src/components/recording/recorder.tsx` | Client | the singer's state machine (§2): record, upload a file, preview, send, replace, delete |
| `src/components/recording/use-media-recorder.ts` | Client hook | mime negotiation, `getUserMedia`, `MediaRecorder`, level meter, wake lock, clock, stop reasons |
| `src/components/recording/upload.ts` | Client | `uploadBlob()` over XHR with progress, abort and timeout; shared by recordings and MIDI |
| `src/components/recording/recording-player.tsx` | Client | fetch on tap, plays from a `blob:` URL, own controls (§4) |
| `src/components/recording/media-bus.ts` | Client | "one thing plays at a time" across recording players and MIDI |
| `src/components/recording/listeners-note.tsx` | Server | the D11 transparency text |
| `src/components/recording/fallback-details.tsx` | Server | `<details id="baska-yolla">` around the existing `SingerSteps` mail block and `SubmitToggle` (D5) |
| `src/components/recording/recording-status.tsx` | Server | `Ses dosyası silindi (<tarih>). Yorumlar duruyor.` and the deletion-date line |
| `src/components/review/queue.tsx` | Server | `/odevler/dinle` groups and rows, role-shaped (§5.1) |
| `src/components/review/assistant-note.tsx` | Client | `Notun` form, `Kaydet`, `Notu sil`, read-only after the comment |
| `src/components/review/conductor-review.tsx` | Client | assistant notes with `Yoruma ekle`, `Korist'e yorumun`, `Yorumu gönder`/`Güncelle`/`Yorumu sil`, dirty guard on `Sonraki` |
| `src/components/review/recording-admin.tsx` | Client | `İndir` link and `Kaydı sil` with confirm (conductor) |
| `src/components/review/assistant-list.tsx` | Server | `/odevler/asistanlar` rows |
| `src/components/review/assistant-sheet.tsx` | Client | `Asistan ekle` / `Düzenle` sheet: user select, scope checkboxes |
| `src/components/review/remove-assistant.tsx` | Client | `Kaldır` plus `ConfirmDialog` |
| `src/components/storage/meter.tsx` | Server | one `role="meter"` bar with text value and state |
| `src/components/storage/storage-banner.tsx` | Server | the 80% / 95% banner on `/odevler` and home (managers) |
| `src/components/storage/early-clean.tsx` | Client | conductor's early clean with confirm |
| `src/components/midi/midi-button.tsx` | Client, tiny | `Çal` / `MIDI'yi çal`; creates the `AudioContext` in the tap, then `import()`s the player |
| `src/components/midi/midi-player.tsx` | Client, **lazy chunk** | controls, track toggles, scheduler glue (§7) |
| `src/components/midi/smf.ts` | lazy chunk | Standard MIDI File parser (format 0/1, PPQ) |
| `src/components/midi/synth.ts` | lazy chunk | Web Audio voice, lookahead scheduler |
| `src/components/midi/midi-list.tsx` | Server | piece-detail `MIDI` section, follows `?partisyon=` |
| `src/components/midi/midi-editor.tsx` | Client | edit-page `MIDI dosyaları`: upload form, list, `Sil` |
| `src/components/shell/nav-items.ts`, `app-nav.tsx` | edit | `reviewBadge` and `data-review-badge` (§8) |
| `src/components/homework/singer-steps.tsx` | edit | step 1 gets the `MIDI'yi çal` slot; step 2 becomes the recorder; mail + toggle move into `FallbackDetails` |
| `src/components/homework/roster.tsx` | edit | `Kayıt · 0:05` tag; conductor link beside the row button; board loses the note form (§5.4) |
| `src/components/homework/homework-rows.tsx`, `home-cards.tsx` | edit | inline `Teslim ettim` → `Kaydını yap` link (D5, AC 34) |
| `src/app/(portal)/odevler/[id]/page.tsx` | edit | recorder section `id="kayit"`, transparency, fallback, status |
| `src/app/(portal)/odevler/dinle/page.tsx` | new, Server | queue, `?filtre=` chips |
| `src/app/(portal)/odevler/[id]/dinle/[userId]/page.tsx` | new, Server | review page |
| `src/app/(portal)/odevler/asistanlar/page.tsx` | new, Server | appointments |
| `src/app/(portal)/odevler/depolama/page.tsx` | new, Server | gauge |
| `src/app/(portal)/odevler/dinle/loading.tsx` | new | skeleton (title, chips, 6 rows) |
| `src/app/(portal)/repertuvar/[id]/page.tsx`, `[id]/duzenle/page.tsx` | edit | `MidiList`, `MidiEditor` |
| `src/app/(portal)/page.tsx` | edit | `Dinleme` cards (conductor/assistant), storage banner |
| `src/proxy.ts` | edit (backend) | matcher skips `api/dosya/`; `media-src 'self' blob:` |
| `next.config.ts` | edit (backend) | `microphone=(self)` |

Routing: `/odevler/dinle`, `/odevler/asistanlar`, `/odevler/depolama` are static segments and win over `/odevler/[id]`; `[id]` already `notFound()`s a non-UUID. `/odevler/[id]/dinle/[userId]` validates both UUIDs the same way.

---

## 2. The recorder (`/odevler/<id>#kayit`)

### 2.1 State machine

One client island, `Recorder`, with these states (`data-state` on the root, for e2e):

| `data-state` | Shown | Next |
|---|---|---|
| `idle` | transparency (server, above), `Kayda başla`, `Dosya yükle`, the headphone hint | `requesting` / `preview` (file) |
| `requesting` | `Mikrofon açılıyor…` (button disabled, focus stays on it) | `recording` / `idle` + error |
| `recording` | red dot, timer `0:07 / 10:00`, level meter, `Durdur` (accessible name `Kaydı durdur`) | `preview` |
| `preview` | take length, `Dinle` (`Kaydını dinle`), `Gönder`, `Yeniden kaydet` (or `Başka dosya seç` for a file) | `uploading` / `recording` |
| `uploading` | `role="progressbar"` with `Gönderiliyor · %45`, `Vazgeç` (aborts, keeps the take) | `sent` / `failed` |
| `failed` | the D21 message, `Tekrar dene`, `Kaydı indir`, `Yeniden kaydet` | `uploading` |
| `sent` | server-rendered `Kaydın gönderildi · <tarih> <saat> · 0:05`, `Değiştir`, `Sil` (when allowed), the player | `idle`-like replace flow |
| `locked` | sent, no `Değiştir`/`Sil`, `Şef yorum yazdı; kaydını artık değiştiremezsin.` as muted text | — |
| `unsupported` | no `Kayda başla`; `Bu tarayıcı kayıt yapamıyor; Dosya yükle'yi kullan.` | `preview` (file) |

- `sent`/`locked` come from the server props after `router.refresh()`; the client never invents "sent". The server decides `canChange` (D8 lock, 5-upload cap) and `uploadsPaused` (D20) and passes them down; the client only hides buttons.
- **A picked file goes through `preview` too**, not straight to upload. Same three actions, so a wrong file from the Files app costs nothing. It's one extra tap for the upload path only; the record path stays at four taps (`Kaydını yap` → `Kayda başla` → `Durdur` → `Gönder`). @ux: tell me if you want the file path to upload immediately; AC 9 works either way.
- `Değiştir` opens the same `idle` controls inline above the current recording (the current one stays playable until the new one is sent). `Vazgeç` returns to `sent`.
- The 5-upload cap: when `uploadsLeft === 0`, `Değiştir` is hidden (AC 14); when `uploadsLeft === 1` the preview shows `Bu son yükleme hakkın.` (new copy, @po).

### 2.2 MediaRecorder: mime negotiation and bitrate

```ts
const TYPES = [
  "audio/mp4;codecs=mp4a.40.2", // Safari (all), Chrome ≥ 126 where AAC encoding exists
  "audio/webm;codecs=opus",     // Chrome/Firefox without AAC
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
const rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 48_000 });
```
- **Counter-proposal to D6's order:** `audio/webm;codecs=opus` before bare `audio/mp4`. Bare `audio/mp4` on Chrome can mean Opus-in-MP4, which iOS < 17 Safari can't play; WebM/Opus has the same problem but at least the conductor's `İndir` file opens in any desktop player. Safari answers `true` for `mp4a.40.2`, so iPhones are unaffected. In practice: Safari → MP4/AAC, Chrome on Mac/Windows/Android → MP4/AAC, Chromium without proprietary codecs → WebM/Opus.
- The blob's type is `rec.mimeType` after `start()` (Safari reports `audio/mp4` even when we asked with a codec). The server sniffs anyway (D6).
- `audioBitsPerSecond` is a request; Safari's AAC encoder may round it up. AC 7's 5–80 KB window for 5 s covers 16–128 kbps.
- `getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`. **Singers, not speech:** noise suppression eats sustained vowels and AGC pumps on crescendos. Browsers that ignore a constraint just record with their defaults; no `exact`, so nothing fails.
- `rec.start(1000)`: a chunk every second, so an interrupted recording (§2.4) still has everything up to the last second.
- On stop: `stream.getTracks().forEach((t) => t.stop())` and `audioCtx.close()`, so the iPhone's orange microphone dot goes away immediately. That matters for trust.

### 2.3 Level meter (in; costs no library)

- `AudioContext` is created **synchronously inside the `Kayda başla` click** (iOS starts a context created outside a gesture suspended), then `createMediaStreamSource(stream) → AnalyserNode (fftSize 1024)`, not connected to the destination (no feedback).
- A `requestAnimationFrame` loop reads `getFloatTimeDomainData`, computes RMS → dBFS, maps −60…0 dB to 0…1 and writes `transform: scaleX(v)` to a ref. No React state per frame. Under `prefers-reduced-motion` it updates at 4 Hz without easing.
- The meter is `aria-hidden` (a moving bar is noise for a screen reader). Two derived, announced hints instead (new copy, @po/@ux):
  - silence for 3 s after start: `Mikrofondan ses gelmiyor. Doğru mikrofon seçili mi?`
  - peaks ≥ 0.99 in more than 2% of frames over 2 s: `Ses çok yüksek; telefonu biraz uzaklaştır.`
- e2e hook: the root gets `data-level="ok|silent"` once the first second has been measured (the fake device plays a tone, so `ok`).

### 2.4 Clock, the 10-minute stop, interruptions, wake lock

- The clock is `performance.now()` since the `start` event, rendered every 250 ms. **The stored duration is this clock** (ms, sent with the upload), not the media element's duration (§2.5).
- Hard stop at `maxMs` (default 600 000). AC 16's hook: the page passes `maxMs` from the server, which reads a cookie `arkhe_e2e_record_limit=<seconds>` only under the same predicate as D21's fault cookie (`NODE_ENV !== "production"` and a `file:` DB). The client has no hook of its own, so e2e:prod proves it's ignored by checking the rendered `data-max-ms="600000"`. Auto-stop shows `Kayıt 10 dakikada durdu.`.
- **Interruptions** (an incoming call on iOS, Bluetooth headset unplugged, the OS revoking the mic): the track's `ended` event or `rec.onerror` stops the recorder and keeps the chunks: `preview` with `Kayıt yarıda kesildi; kaydedilen kısım duruyor.` (new copy, @po). Nothing is thrown away silently.
- **Wake lock:** `navigator.wakeLock?.request("screen")` in the start click; re-requested on `visibilitychange → visible` while recording; released on stop. Failure is ignored (Safari < 16.4, Low Power Mode). `Permissions-Policy` doesn't list `screen-wake-lock`, whose default allowlist is `self`, so nothing to change.
- **iOS audio session** (Safari 17+, feature-detected): `navigator.audioSession.type = "play-and-record"` while recording, `"auto"` after. Without it, playing the MIDI into headphones while recording (D25 hint) can switch the route to the earpiece on some iPhones. Manual check in §9 of the spec.

### 2.5 Duration of a picked file

- `preview` for a file creates an object URL and an `<audio preload="metadata">`; on `loadedmetadata`, if `duration` is finite, that's it.
- If it's `Infinity`/`NaN` (WebM from Android recorders): set `currentTime = 1e9`, read `duration` on `durationchange`, reset to 0. Give up after 3 s and send no duration header.
- The server clamps 0–600 s and never trusts it for limits (@backend, §7 q1). The UI shows `—` where the duration is unknown.

### 2.6 Keeping the take safe (D21)

- The take is a `Blob` held in a **module-level `Map<assignmentId, Take>`**, not only in component state. In-app navigation (tapping `Esere git` to check the score, then back) unmounts the page but not the module, so the recorder comes back in `preview` with `Gönderilmemiş bir kaydın var.` (new copy). Cleared on successful send, `Yeniden kaydet`, and logout (the user menu's logout calls `clearTakes()`; on a shared phone the next person must not find a take).
- `beforeunload` is registered only while `recording`, `preview`, `uploading` or `failed`. Next `<Link>` navigation doesn't fire it, which is fine because of the Map.
- **Not doing:** IndexedDB persistence across reloads. iOS evicts it under pressure anyway, and a stored voice on a shared phone after logout is a KVKK problem. `Kaydı indir` is the escape.
- `Kaydı indir`: `<a download="<Eser>-<Ad-Soyad>.<ext>" href={objectURL}>`, ext from the mime (`m4a` for `audio/mp4`, `webm`, `ogg`, `mp3`, `wav`). Same ASCII-safe name rule as D16; the server sends the slug in the page props so client and server agree. On iOS Safari a blob download opens the share sheet ("Save to Files"), which is exactly what the D20 message tells the singer to do.
- Root attribute `data-take-bytes={blob.size}` so AC 47 compares the download's length.
- Offline: if `navigator.onLine === false` at `Gönder`, don't start; show `İnternet bağlantın yok. Kaydın kaybolmadı; bağlanınca Tekrar dene'ye dokun.` (new copy).

### 2.7 Errors from `getUserMedia`

| `DOMException.name` | Copy |
|---|---|
| `NotAllowedError`, `SecurityError` | `Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver ya da telefonundaki ses kaydediciyle kaydedip Dosya yükle'yi kullan.` (D-spec, AC 17) |
| `NotFoundError`, `OverconstrainedError` | `Mikrofon bulunamadı. Dosya yükle'yi kullanabilirsin.` (new) |
| `NotReadableError`, `AbortError` | `Mikrofon başka bir uygulamada açık. O uygulamayı kapatıp tekrar dene.` (new) |

`unsupported` = `typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia` (also covers plain-HTTP LAN testing, where `mediaDevices` is undefined).

### 2.8 Layout at 375 px

Server parts above the island: step 1 `Partisyonunu dinle` (Drive button + `MIDI'yi çal`), then step 2 `Kaydını gönder` with the transparency text as one muted paragraph (`text-sm text-muted-foreground`, names in `font-medium`), then the recorder, then `FallbackDetails`. The big record button is a full-width `h-14 rounded-2xl` primary button; while recording it becomes `variant="destructive"` with a square icon and keeps the **same DOM element** (label and `aria-label` change), so focus never jumps. `Dosya yükle` is an outline `h-12` button that clicks a visually hidden `<input type="file" accept="audio/*,.m4a,.mp3,.aac,.webm,.ogg,.opus,.wav">` (the native file button is `h-6` in our `Input`). @ux owns spacing and the visual of the `recording` state.

---

## 3. Upload client (`upload.ts`)

```ts
export function uploadBlob(url: string, body: Blob, opts: {
  headers?: Record<string, string>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;            // default 60 000
}): Promise<{ status: number; data: UploadResult | UploadError }>;
```
- XHR, `xhr.upload.onprogress` → fraction (throttled to whole percents), `xhr.timeout`, `signal` → `xhr.abort()`. `withCredentials` isn't needed (same origin sends the cookie).
- **Raw body, not multipart:** `xhr.send(blob)` with metadata in the URL and headers. No boundary overhead, no `formData()` parse of 4 MB on the server, and the server reads exactly the bytes it sniffs. (@backend: this answers your §7 q1 as "raw body" from my side; tell me if you prefer otherwise.)
- Client pre-checks: `blob.size > 4_194_304` (recordings) / `> 1_048_576` (MIDI) → show the server's message without sending. The server still checks.
- Progress UI: `role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow` with visible `Gönderiliyor · %45`. Announced once at start (`Gönderiliyor`) and at the end, not every percent.

### 3.1 Contracts I need (@backend confirm names)

```
POST /api/dosya/kayit?odev=<assignmentId>
  body: audio bytes; headers: X-Arkhe-Duration-Ms: <int> (optional)
  201 { id, durationMs: number|null, sizeBytes, mime, uploadedAt: ISO }
  4xx/5xx { error: string /* Turkish, shown as is */, code: UploadCode }

POST /api/dosya/midi?eser=<pieceId>&partisyon=tutti|soprano|alto|tenor|bass&etiket=<urlencoded, optional>
  body: .mid bytes → 201 { id } | { error, code }

type UploadCode = "origin" | "auth" | "forbidden" | "locked" | "limit"
                | "type" | "size" | "quota" | "storage" | "disabled";
```
The client acts on `code`, never on the text:
- `quota`, `disabled` → keep the take, show the message, `router.refresh()` so the server re-renders `FallbackDetails` with `open` (D5/D20); `Kaydı indir` highlighted.
- `storage` (put fault, Blob down) → `failed` state with `Tekrar dene`.
- `locked`, `limit`, `forbidden` → message, `router.refresh()` (the server then hides the controls).
- `type`, `size` → message; stays in `preview` with `Yeniden kaydet`/`Başka dosya seç`.
- After 201 → `router.refresh()`; the badge, header chip, roster and list all update from the server.

Delete my recording, delete a MIDI file, notes, comment, assistants, early clean: **server actions** returning the existing `FormState` (`{ error } | { success }`), run through `useRunAction`. Only the two uploads are route handlers.

---

## 4. Recording player (`RecordingPlayer`)

- Props: `{ id: string; durationMs: number | null; label: string }`. No URL prop: the component builds `/api/dosya/kayit/<id>` itself, so no other URL can reach the page (AC 2).
- Before the tap: a `Dinle` button and the stored duration. **No `<audio src>`, no preload, no request** (AC 10).
- On tap: `media-bus.claim(this)`, `fetch(url, { cache: "no-store" })`. On 200 → `URL.createObjectURL(blob)` → `audio.src = …; audio.play()`. The object URL is kept for the component's life (a second play doesn't refetch: AC 10's "exactly once") and revoked on unmount.
- Errors: 410 → server re-render shows the deleted state (`router.refresh()`); 503 with the quota code → `Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).`; anything else → `Kayıt şu an açılamıyor. Biraz sonra tekrar dene.` with `Tekrar dene`.
- **iOS gesture caveat:** `play()` after an awaited `fetch` may be refused (`NotAllowedError`) because the tap's activation has expired. Then the controls stay ready, the button shows `Oynat`, focus moves to it and an sr-only line says `Kayıt hazır; oynatmak için dokun.` One extra tap in the worst case, never a dead button. Spec §9 manual check.
- **Own controls, not `controls`:** play/pause (44 px), a range input `0…durationSec` (from the DB/recorder clock, because the element's duration is often `Infinity`), `0:12 / 0:45` text. Seeking a blob URL works without `Range`. `aria-label="Kaydını dinle"` / `"Kaydı duraklat"`; slider `aria-valuetext="0:12 / 0:45"`. The `<audio>` element stays in the DOM, hidden, for AC 10's `currentTime`/`src` evaluation.
- `data-state="idle|loading|playing|paused|error"` on the root.
- `media-bus.ts`: a module-level `current` with `pause()`; a recording player and the MIDI player register with it, so starting one pauses the other. Recording **while** a MIDI plays is allowed (headphones); the recorder doesn't claim the bus.

---

## 5. Review UI

### 5.1 Queue `/odevler/dinle` (Server)

- Header: `Dinleme` (h1), chips with `FilterChip` and `?filtre=`: conductor `bekleyen` (default) · `asistan-notlu` · `yorumlanan`; assistant `dinlenecek` (default) · `notlarim`. Counts on chips.
- Groups per assignment (`<section aria-labelledby>`), h2 `Ave Verum Corpus · Ölçü 12–34` with the due date. Rows: `<Link>` 44 px+ with name, `PartDot`, duration, upload date, `Geç` tag (`bg-late/18 text-late-ink`, text, not colour only), conductor rows `2 asistan notu` or `Portalda kayıt yok`, assistant rows `Yeni kayıt` when re-taken.
- `prefetch={false}` on rows: 40 visible rows would otherwise fire 40 RSC prefetches of review pages. The review page's `Sonraki` keeps the default prefetch, which is the one that pays off.
- Each row links to `/odevler/<a>/dinle/<u>?filtre=<chip>`, so `Sonraki` knows which list it walks.
- **`Yorumlananlar` grows forever.** I'd cap it at the newest 100 with `Son 100 kayıt gösteriliyor.` (@po: agree?). The other chips are naturally small.
- Empty states (new copy, @ux): `Yorum bekleyen kayıt yok.`, `Dinlenecek kayıt yok.`

**Role-shaped data, so a leak can't be written by accident** (@backend): two query functions with two return types, and the assistant's has no field for other people's notes.

```ts
type QueueRowBase = { assignmentId: string; userId: string; name: string; part: VoicePart | null;
                      durationMs: number | null; uploadedAt: Date | null; late: boolean };
type ConductorQueueRow = QueueRowBase & { noRecording: boolean; noteCount: number; commented: boolean };
type AssistantQueueRow = QueueRowBase & { retake: boolean; myNoteAt: Date | null };
type QueueGroup<R> = { assignmentId: string; title: string; dueAt: Date; rows: R[] };
```

### 5.2 Review page `/odevler/<a>/dinle/<u>` (Server)

Top: back link `Dinleme` (keeps `?filtre=`), singer name + `PartDot`, `Teslim: <tarih>` (`Geç teslim`), `Değiştirildi · <tarih>`, then `RecordingPlayer` or the deleted-state line, or `Portalda kayıt yok` (conductor only; assistants 404 on it).

**Assistant** (`AssistantNote`): `<Label htmlFor="note">Notun</Label>`, `Textarea id="note" maxLength={1000}` with hint `Bu notu yalnızca şef görür.` and a counter from 800 chars (Phase 4 pattern), `Kaydet` (`h-12`), `Notu sil` (ghost destructive, only when a note exists). After the conductor comments: the note as read-only text and `Şef yorumunu gönderdi.`; no form. An `Önceki kayda yazıldı` tag on his note when it predates the current take.

**Conductor** (`ConductorReview`):
- `Asistan notları (<n>)`: a list of cards (author, date, `Önceki kayda yazıldı` tag, text with `whitespace-pre-line`), each with `Yoruma ekle`.
- `Yoruma ekle` appends `text` to the textarea (separated by a blank line when it isn't empty), focuses the textarea with the caret at the end, and announces `Not yoruma eklendi.` in a polite live region. When the result would pass 1000 characters, the button is disabled with `Yorum 1000 karakteri geçer.` (new copy; @po: the Phase 4 limit of 1000 stays for the comment?).
- `<Label htmlFor="comment">Korist'e yorumun</Label>`, `Textarea id="comment"`, `Yorumu gönder` → `Güncelle` once saved, `Yorumu sil` (confirm). After save: `Yorum gönderildi.` toast and `Bu kayıt <tarih> tarihinde silinecek.` (server re-render).
- `Sonraki` (primary after a save, outline before) or `Bu listede başka kayıt yok.` When the textarea differs from the saved text, `Sonraki` opens a `ConfirmDialog`: `Yorumun gönderilmedi.` / `Yine de sonrakine geçilsin mi?` / `Geç` (new copy, @po/@ux). Cheap, and it saves the conductor's typing in a 40-take loop.
- `RecordingAdmin`: `İndir` = `<a href="/api/dosya/kayit/<id>?indir=1">` (no `download` attr needed; the route sends `Content-Disposition`), `Kaydı sil` (destructive, confirm `Kayıt silinsin mi?` / `Ses dosyası silinir; yorumlar ve notlar kalır.`, @po copy).

Data:
```ts
type ReviewBase = { assignment: { id; title; dueAt }; singer: { id; name; part };
  recording: { id; durationMs; uploadedAt; replacedAt; deletedAt; deleteAfter } | null;
  submittedAt: Date | null; late: boolean; nextHref: string | null };
type AssistantReview = ReviewBase & { myNote: { text; at; previousTake: boolean } | null; commented: boolean };
type ConductorReview = ReviewBase & { notes: { id; author; at; text; previousTake: boolean }[];
  comment: { text; at; byName } | null };
```
`AssistantReview.commented` is a boolean, never the text (AC 24).

### 5.3 Appointments `/odevler/asistanlar` (Server, conductor only)

- List rows: name, own `PartDot`, scope text (`Tüm partisyonlar` or `Soprano, Alto`), `Düzenle`, `Kaldır`. Header button `Asistan ekle`.
- `AssistantSheet` (shadcn `Sheet`, `side="bottom"` under `md`, `right` above): `Kişi` with shadcn `Select` grouped by voice part (only the eligible list the server passes: active `member`/`board`, not already assistants; on edit the person is fixed text), then a fieldset `Hangi partisyonlar?` with a `Tüm partisyonlar` checkbox and four part checkboxes (part dot + label, 44 px chips like `ChoiceGroup` but `type="checkbox"`). With `Tüm partisyonlar` on, the four are disabled and visually checked. Error `En az bir partisyon seç.` under the fieldset with `aria-describedby`, focus moved to the first checkbox.
- `Kaldır` → `ConfirmDialog` with `<ad> artık kayıt dinleyemeyecek. Yazdığı notlar şefte kalır.`
- Empty: `Henüz dinleme asistanı yok. Asistanlar senin seçtiğin partisyonlardaki kayıtları dinleyip sana not yazar.` (new copy, @ux).

### 5.4 Roster on `/odevler/<id>` (edit)

The row today is one `<button>` that opens the sheet (`roster.tsx`). A link can't nest inside it, so:
- A submitted row with a recording gets a sibling element on the right: **conductor** `<Link href="/odevler/<a>/dinle/<u>">Kayıt · 0:05</Link>` (44 px, `aria-label="Demo Korist'in kaydını dinle"`); **board** a plain `<span>Kayıt · 0:05</span>`. AC 33.
- The sheet keeps the manual-mark controls for both roles (Phase 4 AC 16 unchanged). Its note form is replaced: conductor sees `Dinle ve yorum yaz` (link to the review page; works for `Portalda kayıt yok` too), board sees nothing (D3).
- `data-testid="roster-recording"` on the tag.

### 5.5 Home cards and the `/odevler` header

- Conductor home: `Dinleme` card `<n> kayıt yorum bekliyor · <k> asistan notlu` → `/odevler/dinle` (`data-testid="home-review"`).
- Assistant home: `Dinleme kuyruğun: <n> kayıt`, hidden at 0 (`data-testid="home-review"`).
- `/odevler` header links (44 px, outline chips): conductor `Dinleme`, `Asistanlar`, `Depolama`; board `Depolama`; assistant `Dinleme (<n>)`.

---

## 6. Storage gauge `/odevler/depolama`

- Four `Meter`s: `<div role="meter" aria-valuemin=0 aria-valuemax=100 aria-valuenow={pct} aria-valuetext="460 MB / 1 GB, yüzde 46" aria-labelledby>` with a visible label and `460 MB / 1 GB · %46`. Not the native `<meter>` (no reliable styling in Safari, and its colour logic is the browser's).
- States: `< 80` `bg-primary`; `≥ 80` `bg-late` plus the word `Uyarı` before the value; `≥ 95` (storage/upload) or `≥ 100` (transfer/reads) `bg-destructive` plus `Dolu`. Text carries the state, colour only repeats it.
- Percent via `new Intl.NumberFormat("tr-TR", { style: "percent" })`, which already prints `%46`. A new `formatStorage(bytes)` in `src/lib/format.ts` adds the GB branch (`1 GB`, `0,9 GB`); `formatBytes` stays as is for 8b.
- `StorageBanner` (Server) on `/odevler` and home for managers only: amber `Kayıt alanı %81 dolu. Depolama sayfasına bak.` with a link, red `Kayıt alanı dolu; yeni kayıt alınmıyor.` `role="status"` (not `alert`: it's there on every load).
- `EarlyClean` (conductor): the button text from the spec, `ConfirmDialog`, `useRunAction`. Hidden at 0 recordings.
- Data: `{ meters: { key: "storage"|"uploads"|"transfer"|"reads"; used: number; limit: number; pct: number }[]; lastSweep: { at: Date; deleted: number } | null; earlyClean: { count: number; bytes: number } | null }` (`earlyClean` null for the board).

---

## 7. MIDI

### 7.1 Loading on demand

- `MidiButton` (in the page bundle, < 2 KB): on tap, **synchronously** `ctx ??= new AudioContext(); ctx.resume()` (the tap is the only gesture iOS accepts), then `const { MidiPlayer } = await import("./midi-player")` and renders it inline under the row with the context passed in. A plain `import()` in the handler, not `next/dynamic` rendered up front, so there is provably no chunk request before the tap (AC 51). The module and the parsed file are cached in module scope: a second `Çal` neither re-imports nor refetches.
- The file: one `fetch("/api/dosya/midi/<id>")` (the browser cache then serves repeats for 7 days per D16).
- Budget: parser ~3 KB, synth/scheduler ~3 KB, UI ~4 KB gzipped, so ~10 KB against the 60 KB ceiling. lucide icons used inside the chunk are already in the shared chunk. A marker string `"arkhe-midi-player"` in the module lets the AC 52 script find the chunk in `.next/static/chunks/`.

### 7.2 Why our own parser instead of `@tonejs/midi`

We need: header (format 0/1, PPQ division), tempo meta events, track-name meta, note on/off with running status, and channel 10 skipped. That's ~120 lines of TypeScript. `@tonejs/midi` (MIT) is fine but brings `midi-file` and a richer object model we'd mostly discard, and it's one more dependency to audit. If the tech lead prefers the library, the chunk still fits the budget; the player API doesn't change. SMPTE time division and format 2 are refused with `Bu MIDI dosyası çalınamıyor; İndir ile açmayı dene.` (new copy).

### 7.3 Synth and scheduler

- Voice: `OscillatorNode` (`triangle`) → `GainNode` envelope (attack 10 ms, decay to 0.7 over 100 ms, release 80 ms) → per-track `GainNode` (mute = `gain 0`, ramped 20 ms to avoid clicks) → master `GainNode` (0.25) → `DynamicsCompressorNode` → destination. Velocity scales the note gain. Pitch `440 · 2^((n − 69)/12)`. Up to 32 simultaneous voices; the oldest is released first.
- **Lookahead scheduler**: a 25 ms `setInterval` schedules notes whose start falls within the next 150 ms of `ctx.currentTime`. Pause stops the timer and releases sounding voices; play resumes from the saved song position. Tempo chips (`%50 · %75 · %100`) change a factor and reschedule from the current position. Seek = pause + set position + play if playing.
- iOS 17+: `navigator.audioSession.type = "playback"` while the MIDI plays and nothing is recording, so the silent switch doesn't mute it; restored to `"auto"` on pause. The `Ses gelmiyorsa telefonun sessiz modunu kapat.` hint stays for older iOS. `visibilitychange → hidden` pauses (no audio from a locked phone in the pocket).

### 7.4 Player UI

```
[▶ Çal / ❚❚ Duraklat] [⟲ Başa dön]   0:12 / 2:45
[──────●──────────────] (range, aria-valuetext "0:12 / 2:45")
Tempo: (%50) (%75) (%100)            ← radio chips, ChoiceGroup look
Sesler: [✓ Soprano] [✓ Alto] [✓ Tenor] [✓ Bas]   ← only when ≥ 2 tracks have notes
Ses gelmiyorsa telefonun sessiz modunu kapat.
```
- Root: `data-midi-player data-state="loading|playing|paused|ended|error" data-audio-state={ctx.state} data-position-ms`. Track toggles: `<input type="checkbox">` chips with `data-track={name} data-muted`. A track named Soprano/Alto/Tenor/Bas/Bass gets its `PartDot` token colour; others `Kanal <n>`.
- Position text updates at 4 Hz; it is **not** a live region. `aria-live="polite"` only for state changes (`Çalıyor`, `Duraklatıldı`, `Bitti`).
- Keyboard: all native controls. Space on the focused play button toggles; no global shortcuts (they'd fight the textarea on review pages).

### 7.5 Lists and the editor

- `MidiList` (piece detail, Server): section `MIDI`, rows filtered like the existing part filter: label (`Alto önde · Alto` or `MIDI · Alto`), `Çal` (`MidiButton`), `İndir` (`<a href="/api/dosya/midi/<id>?indir=1">`). Only ids reach the client.
- `MidiEditor` (edit page, Client): hidden native file input behind a `Dosya seç (.mid)` button (`accept=".mid,.midi,audio/midi,audio/x-midi"`), the picked file name, `Partisyon` as `ChoiceGroup` (Tutti default), `Etiket` `Input` (`maxLength={60}`, counter at 50), `Yükle` with progress (same `uploadBlob`). The list below with `Sil` per row and `ConfirmDialog` `"<etiket>" silinsin mi?`. At 20 files the form is replaced by `Bir esere en fazla 20 MIDI dosyası eklenebilir.`
- Homework step 1: `MIDI'yi çal` (`MidiButton` with `hero`) next to the Drive button when the server finds a file for my part, else Tutti, else nothing.

---

## 8. Badges (`data-review-badge`)

- `NavItem` gets `reviewBadge?: boolean` on `/odevler`. The layout passes `review: number` (conductor only; 0 for everyone else, computed on the server, so the attribute never renders for others).
- Phase 8 is generalising `Badge` for `data-board-badge` right now; I'll reuse whatever shape it lands with (an `attr`/`kind` prop). The review badge uses identical visuals, `9+`, and sr text `, <n> kayıt asistan notuyla bekliyor`.
- On the `Ödevler` item: the homework badge when `homework > 0`, else the review badge. The conductor has no voice part, so in practice the conductor gets only the review badge and nobody else gets it; the rule just avoids two dots on one icon if that ever changes. `data-nav-badge` stays homework-only (Phase 4 AC 1, Phase 8 D31).

---

## 9. E2e plan

### 9.1 Launching Chrome with a fake microphone

Per-file launch args are possible: a suite's default export gets the shared `browser` but may launch its own. I propose a small change in `e2e/lib.mjs`:
```js
export async function launch(args = []) {
  return chromium.launch({ channel: "chrome", args });
}
```
and in a new helper `e2e/media.mjs` (not matched by the runner's `^phase` pattern):
```js
export async function launchWithMic() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arkhe-mic-"));
  const wav = path.join(dir, "tone.wav");
  await writeFile(wav, wavBytes({ seconds: 4, hz: 440, rate: 48000 }));
  const browser = await launch([
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
  ]);
  return { browser, close: async () => { await browser.close(); await rm(dir, { recursive: true }); } };
}
```
- Contexts in that browser are created with `newPage(browser, { context: { permissions: ["microphone"] } })`; `watchCsp`/`watchConsole` stay on, so a CSP violation while recording fails the run (AC 5).
- The WAV is 16-bit PCM mono (what Chrome's fake capture reads); Chrome loops it, so any take length works.
- **Microphone denied** (AC 17): an `addInitScript` that makes `navigator.mediaDevices.getUserMedia` reject with `new DOMException("", "NotAllowedError")`. Deterministic, unlike trying to deny a permission that `--use-fake-ui-for-media-stream` auto-accepts. **No MediaRecorder:** `addInitScript(() => { delete window.MediaRecorder; })`.
- The `Permissions-Policy` change is proved for free: with `microphone=()` still in place, `getUserMedia` rejects even with the fake device, and AC 7 fails.
- The 8b runner regex (`/^phase\d+[a-z]?-/`) also matches `phase9-*`; nothing else needed in `run.mjs`.

### 9.2 Fixtures generated in code (`e2e/media.mjs`, plus `scripts/media-fixture.mjs` for the seed)

| Generator | Use |
|---|---|
| `wavBytes({ seconds, hz, rate })` | fake mic, `Dosya yükle` (AC 9), seed audio (D26) |
| `wavOfSize(n)` | a valid RIFF/WAVE header with a data chunk padded to exactly `n` bytes: 4,194,304 accepted, 4,194,305 refused (AC 6) |
| `mp3Bytes({ frames })` | MPEG-1 Layer III frames (`FF FB 90 64` header, zero payload) with an `ID3` tag: passes the sniff, decodes as silence |
| `browserAudio(page, mime)` | a **real** playable MP4/AAC or WebM/Opus made inside Chrome: `OscillatorNode → MediaStreamDestination → MediaRecorder`, returned as bytes. Real m4a without committing a binary or a muxer |
| `midiBytes({ ppq, bpm, tracks: [{ name, notes: [[pitch, startTick, durTicks, vel]] }] })` | SMF format 1 writer (~40 lines); seed `Ave Verum Corpus` Tutti (4 named tracks) and Alto (D26) |
| `notAudio` | PNG signature renamed `.m4a`; text sent as `audio/mp4`; `notMidi` (`MThx…`); `midiOfSize(1_048_577)` |

`scripts/media-fixture.mjs` exports `wavBytes`, `midiBytes`, `clearMedia(db)` and `seedMedia(db, now)`, imported by the seed and by `e2e/lib.mjs` (same pattern as `homework-fixture.mjs`).

**Cleanup order** (`lib.mjs cleanup()`), because `seedHomework` deletes the fixture submissions and assignments (`homework-fixture.mjs:126-128`):
1. `clearMedia(db)`: delete e2e and seeded media rows (notes → recordings → upload/delivery log → MIDI of `E2E%` and seeded pieces → assistants of `@e2e.test` users and the seeded one → finished queue rows) **before** `seedFinance`/`seedHomework`/the `@e2e.test` user delete.
2. the existing steps,
3. `seedMedia(db, now)` after `seedHomework`, writing its WAV/MIDI files,
4. remove files under `data/uploads/{recordings,midi}/` that no live row or pending queue row references. Never anything outside `data/uploads/`. AC 1's directory listing runs after this.

@dba: this means either `restrict` FKs from the new tables with `clearMedia` first, or `cascade` plus the queue trigger; please write the order you choose into `db.md` so `clearMedia` matches it.

### 9.3 Suites

**`e2e/phase9-a-record.mjs`** (own browser via `launchWithMic()`; S1, S2, S6)
- AC 7: korist@ phone on A: `data-state=idle`, transparency names `Demo Asistan`, a `page.on("request")` log shows no `/api/dosya/` request; `Kayda başla` → `data-state=recording`, timer text matches `/^0:0\d \/ 10:00$/`, `data-level=ok`; wait 5 s; `Kaydı durdur` → `preview`, still no upload request; `Gönder` with `page.route("**/api/dosya/kayit**")` delaying 800 ms → `[role=progressbar]` visible → `Kaydın gönderildi · <bugün>`. Row: size 5–80 KB, mime starts `audio/mp4` or `audio/webm`, key `recordings/<uuid>.(m4a|webm)` and the file exists.
- AC 8: chip `data-tone=done`, `data-nav-badge` 4 → 3, roster `roster-recording` `Kayıt · 0:0x` as sef@, matrix `done`, `method = 'self'`.
- AC 10: `Dinle` → exactly one request to `/api/dosya/kayit/<id>`, `audio.src` starts `blob:`, `currentTime > 0` after 1 s.
- AC 11, 12, 13 (lock via direct calls with `Origin: BASE`), 14 (arranged 5 uploads), 15, 16 (cookie `arkhe_e2e_record_limit=3` → stops by itself, `Kayıt 10 dakikada durdu.`), 17 (init scripts).
- AC 9: `setInputFiles` with `wavBytes(3)`, then `browserAudio(page, "audio/mp4")` as `ses.m4a` and `mp3Bytes`; stored mime = detected.
- AC 6: `page.request.post` with and without `Origin`, PNG-as-m4a, text-as-mp4, `wavOfSize(4_194_305)` refused / `wavOfSize(4_194_304)` accepted (and timed for AC 58: < 5 s); row and file counts before/after.
- AC 47: cookie `arkhe_e2e_storage_fault=put` → message, no row; `page.waitForEvent("download")` on `Kaydı indir`, size equals `data-take-bytes`; clear cookie, `Tekrar dene` → sent. `get` fault → `Kayıt şu an açılamıyor…`.
- AC 34, 35, 36 and the D30 edits below.
- AC 57 for recorder states: axe at 375 px light and dark in `idle`, `recording`, `preview`, `sent`, `locked`; `scrollWidth <= innerWidth`; buttons ≥ 44 px.

**`e2e/phase9-b-review.mjs`** (shared browser; S3–S5, AC 2–3, 24, 30)
- **Visibility matrix** (AC 3, 18, 19, 20, 29, 30, 33), one table driving one loop: users `sef`, `yk`, `korist` (owner), `asistan` (Soprano+Alto), `alto2@e2e.test` (member), `tenorAsst@e2e.test` (assistant, Tenor), `inactive@e2e.test`, logged out; resources `/api/dosya/kayit/<alto rec>`, `/odevler/<A>/dinle/<korist>`, `/odevler/dinle`, `/odevler/asistanlar`, `/odevler/depolama`, `/api/dosya/kayit/<asistan's own tenor rec>`. Expected: status (200/404/401/410) for the API with headers (`content-type`, `nosniff`, `private, no-store`, sandbox CSP, i.e. the proxy matcher fix), page status 200/404 or final URL `/odevler` for redirects. Then the dynamic rows: remove asistan → 404 at once; move a soprano to tenor → 404; widen asistan to all parts → his own still 404; make him `conductor` → conductor views.
- **Leak grep** (AC 2, 24, 30): unique markers `E2E-NOTE-A-<uuid>`, `E2E-NOTE-B-<uuid>`, `E2E-COMMENT-<uuid>`; for each role fetch HTML (`page.request.get`) and RSC (`headers: { RSC: "1" }`) of `/`, `/odevler`, `/odevler/<A>`, the queue, the review page, `/repertuvar/<ave>`; assert absent/present per role, plus no `data/uploads`, `blob.vercel-storage.com` or `recordings/` key in any of them.
- AC 22 queue count = SQL count of the same rule; AC 23 note flow + `Sonraki`; AC 25 lock both ways; AC 26 re-take; AC 27 badge at 1280 and 375 (both nav copies), `9+` arranged, no `data-review-badge` for korist/yk/asistan, still no `data-nav-badge` for sef; AC 28 `Yoruma ekle`, deletion date `formatShortDate`(today + 90, Istanbul) computed in the test; AC 31, 32 (yk's `saveFeedback` via `callAction` refused; arranged board note still shown), AC 33 `Sonraki` to the end.
- AC 57 for queue/review (both roles), `/odevler/asistanlar`: axe, 375 px, light and dark.

**`e2e/phase9-c-storage.mjs`** (shared browser; S7, S8)
- Retention through the cron: arranged dates **in the past** (comment 91 days ago; uploads 121 and 119 days ago), then `cron("?bugun=<a day whose month is already covered>")` from `e2e/mail.mjs` so the backup step deterministically skips and only the sweep acts (and once with the backup step sending, AC 41). Assert file gone, `deleted_at` set, notes and comment kept, 410, UI line. Dates are never on the exact boundary. @backend: the sweep should take its "now" from the real clock, not from `?bugun=`, so these arranged-in-the-past tests don't depend on the day param; if you'd rather honour `?bugun=` for the sweep too, say so and I'll arrange relative to it.
- AC 40 every delete path with a directory listing; `delete` fault → queued, next cron removes it.
- AC 43–46: arranged metadata-only rows (no files) summing 81% / 95% of 1 GB, and 1,900 upload log rows; meters' `aria-valuenow` and text vs SQL; banners for managers only; korist upload refused with `code: quota`, fallback `details[open]`, `Kaydı indir` present; MIDI upload refused; listening still works; transfer 100% → playback refused, MIDI plays. @backend: the adapter's delete of a missing file must count as success (arranged rows have no files).
- AC 48 early clean; AC 58 timings with 200 recordings / 400 notes (`page.goto` < 1 s, loose); AC 42 email line and decrypted dump rows (Phase 7 helpers).
- AC 57 for `/odevler/depolama`.

**`e2e/phase9-d-midi.mjs`** (shared browser; the shared browser plays Web Audio fine headless)
- AC 49 upload and validation (`setInputFiles` with `midiBytes`, `notMidi`, `midiOfSize`, 21st file, 61-char label), AC 4 route headers and `Content-Disposition`.
- AC 50 part filter.
- AC 51: request log shows no chunk containing `arkhe-midi-player` and no `/api/dosya/midi/` before `Çal`; after: one chunk request, one file request; `data-audio-state=running`, `data-state=playing`, position text past `0:01`; four `data-track` checkboxes checked; `Duraklat` holds the position; `Başa dön` → `0:00`; `%50` advances ~half as fast (±30%); unchecking Alto → `data-muted=true` and still playing; a second file's `Çal` makes the first `paused`. No console errors (the collector).
- AC 53 homework link-up, AC 54 delete paths; AC 57 piece detail with an open player and the edit section.

**`e2e/prod.mjs` additions** (AC 52, 59): the bundle script (find the chunk by marker, `zlib.gzipSync(...).length <= 60 * 1024`, and assert no `<script src>` in the initial HTML of `/repertuvar/<id>` and `/odevler/<id>` points at it); the record-limit cookie ignored (`data-max-ms="600000"`); the fault cookie ignored; `asistan@arkhe.local` refused; `Permissions-Policy` contains `microphone=(self)`; CSP `media-src 'self' blob:`, no `unsafe-eval`.

### 9.4 D30: Phase 4 checks that change (to list in `review-fixes.md`)

| Where | Today | Change |
|---|---|---|
| `phase4-homework.mjs:120-126` (AC 22) | home card has `[data-testid=submit-row]` | expects `[data-testid=record-link]` with `href="/odevler/<D>#kayit"` |
| `:384-393` (AC 6, list half) | list `submit-row` + toast `Geri al` | removed; replaced by AC 34's `Kaydını yap` link check |
| `:188-199` (AC 4), `:318-327` (AC 12) | mail link visible on the detail | first `openFallback(page)` (clicks `summary` `Başka yolla gönderdim`), then the same asserts |
| `:365`, `:397`, `:434`, `:449` (AC 6, 7, 11, 17) | `Teslim ettim` visible on the detail | `openFallback(page)` first; same asserts |
| `:451-458`, `:478-486` (AC 17 conductor note) | roster row → sheet `#feedback` `Notu kaydet` | sheet link `Dinle ve yorum yaz` → review page `#comment`, `Yorumu gönder` / `Yorumu sil`, toasts `Yorum gönderildi.` / the delete toast |
| `:471-476` (AC 17 board note) | yk writes a note on B | arranged in the DB (`feedback_by` = yk), then the `Geri bildirim` heading check stays |
| `:302` (AC 10 `saveFeedback` refusal list) | refuses a member | unchanged; Phase 9 adds the board refusal (AC 32) in `phase9-b` |

Phase 6 security checks: no change (see the facts list). Phase 8's bar checks: no change (no new tab, D28).

---

## 10. Accessibility and performance checklist

- Recording state: one polite live region in the recorder announcing only `Kayıt başladı`, `Son bir dakika` (at 9:00), `Kayıt durdu, 0:42`, `Kayıt 10 dakikada durdu.`, `Gönderiliyor`, `Kaydın gönderildi`. The visible timer is `role="timer"` (implicitly `aria-live="off"`), never announced per second. A red dot plus the word `Kaydediliyor` (text, not colour only).
- Accessible names: `Kayda başla`, `Kaydı durdur`, `Kaydını dinle`, `Kaydı duraklat`, `Kaydı gönder`, `Kaydı indir`; MIDI `Çal: Alto önde`, `Duraklat`, `Başa dön`.
- Focus: after `Durdur` → `Gönder`; after send → the `Kaydın gönderildi` status heading (`tabIndex={-1}`); after an error → the error text (`useFocusError` pattern); dialogs via `ConfirmDialog`.
- Targets ≥ 44 px everywhere, including the hidden-file-input buttons, roster `Kayıt` link, chips and track toggles. 375 px without horizontal scroll: long piece titles `break-words`, the player time text `tabular-nums`.
- Tokens only: `bg-destructive` (recording, full), `bg-late`/`text-late-ink` (warning, `Geç`), `bg-present` (sent), `PartDot` colours; meters and banners checked for contrast in both themes in my review.
- No JS on queue pages beyond chips (links). The recorder ships only on `/odevler/<id>` (it's the main action there, so not lazy; ~8 KB gz). The MIDI chunk only on tap. No preload of audio anywhere. `prefetch={false}` on queue rows.
- Memory: object URLs revoked on unmount and on replace; `AudioContext` closed after recording; the MIDI context is shared and suspended when paused.

---

## 11. Replies

**@po (§7 q4):**
- **MIDI player and recorder on demand:** agree for the MIDI player: a plain `import()` in the `Çal` handler (§7.1), ~10 KB gz, provably no request before the tap. For the recorder I disagree with lazy loading: it's the primary action of `/odevler/<id>`, only that route ships it (~8 KB gz), and loading it after the tap would put a network round trip between the tap and `getUserMedia`/`AudioContext` creation, which iOS needs inside the gesture.
- **Level meter:** in. `AnalyserNode` + one `requestAnimationFrame` loop, no library, `aria-hidden`, plus two announced hints (silence, clipping) that are the actually useful part for a singer (§2.3). New copy for you to settle.
- **`aria-live` for the timer:** `role="timer"` (not announced), one polite region for start, `Son bir dakika`, stop and auto-stop only (§10). That matches AC 57.
- **Wake Lock:** in, best effort, re-acquired after `visibilitychange`; no permission change needed (§2.4).
- **D6 type order:** please put `audio/webm;codecs=opus` before bare `audio/mp4` (§2.2) to avoid Opus-in-MP4 from Chrome.
- **Duration:** the recorder clock for recordings, `loadedmetadata` with the seek fallback for files, `—` when unknown (§2.5). The UI never trusts the media element's duration.
- **A picked file goes to `preview` before upload** (§2.1). Recording stays four taps.
- **New copy to settle** (all marked "new" above): last-upload warning, interrupted recording, unsent take on return, offline, three `getUserMedia` errors, silence/clipping hints, iOS `Kayıt hazır; oynatmak için dokun.`, unplayable MIDI, unsent comment on `Sonraki`, `Kaydı sil` confirm, comment over 1000 after `Yoruma ekle`, empty queue/assistant states.
- **`Yorumlananlar`**: cap at 100 newest? (§5.1)
- **Comment limit:** confirm it stays 1000 (Phase 4) now that notes can be appended into it.
- **D30:** my list of the Phase 4 checks that change is §9.4; the tech lead can copy it into `review-fixes.md`.

**@backend:**
- Proxy matcher must skip `api/dosya/` (CSP overwrite and 4 MB body buffering, facts list).
- Raw-body uploads with `X-Arkhe-Duration-Ms`, error `code`s per §3.1; MIDI upload as a route handler (server actions' 1 MB cap).
- The record-limit cookie `arkhe_e2e_record_limit` read in the page under the D21 predicate, passed as `maxMs`.
- Two role-shaped query functions and DTOs (§5.1, §5.2); the assistant's types have no field for others' notes or the comment text.
- Adapter delete of a missing file = success; sweep "now" from the real clock (§9.3).

**@dba:** cleanup order versus `seedHomework` (§9.2); document the seeded queue counts the tests compare against (D26).

**@ux:** I need from you the `recording` state's visual, the position of the transparency text, whether a picked file previews, the empty states, and the review page's order on 375 px (player → notes → comment → `Sonraki`, as I assumed). The component split above works for any order.
