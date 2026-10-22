# Phase 9 UX: recordings, assistant review, MIDI

Author: arkhe-ux-designer. Date: 2026-10-21. Inputs: `po-spec.md` (D1–D30, AC 1–59), `phase-4/ux.md` and the live `/odevler`, `/odevler/[id]`, `/repertuvar/[id]`, `/repertuvar/[id]/duzenle` screens (375 px and 1280 px, light and dark, logged in as korist@ and sef@), `phase-8/po-decisions.md` D22/D31 (nav), `src/components/homework/*`, `src/components/repertoire/part-button.tsx`, `globals.css`. No `ui.md`/`db.md`/`backend.md` in this folder yet.

Mocks, made by injecting HTML into the real app shell using only the existing CSS variables, live in the scratchpad `p9ux/`:
- `mock-recorder-375-{light,dark}-part{1..3}.png`: the 11 recorder states
- `mock-review-375-{light,dark}-part{1..3}.png` and `mock-review-1280-light.png`: the queues and the review pages
- `mock-admin-375-{light,dark}-part{1..3}.png` and `mock-admin-1280-dark.png`: assistants, the storage gauge, the MIDI player and the MIDI editor
- `cur-*.png`: today's screens

All mocks have 0 px horizontal overflow at 375.

Base rules are the same as Phase 4:
- At 375: `px-4`, 343 px of content, page `pb-28`.
- Targets ≥ 44 px.
- From `md`: `max-w-3xl`.
- Reuse `FilterChip`, `PartDot`, `VoicePartBadge`, `DeadlineChip`, `ConfirmDialog`, `Sheet` (bottom sheet below `md`, `Dialog sm:max-w-sm` from `md`), `forms/field.tsx`, `Textarea` with a counter from 800, and sonner toasts.
- Icons come from `lucide-react`, which is already a dependency.
- **No new tokens** (§13).

## 0. Replies

**@po (§7.3 and the points where I propose a change):**

1. **Recorder at 375: one card, one obvious button per state.** The detail's steps become two:
   - `Partisyonunu dinle`
   - `Kaydını yap`

   Step 3 (`Gönderdiysen işaretle`) goes, because sending **is** submitting (D1). The recorder is a state machine inside step 2 (§2). In every state there is exactly one primary (filled) button: `Kayda başla` → `Durdur` → `Gönder` → (sent: none; `Değiştir` is outline). The full card for the idle state is 520 px tall, so step 1 and the start button are both above the fold on an iPhone SE-height screen (667) after the header.
2. **Count-in: yes, a silent 3-second `Hazırlan… 3 · 2 · 1`** after the permission is granted and before `MediaRecorder.start()`, with `Vazgeç`.
   - Why:
     - The tap noise and the "phone is still moving to the music stand" second don't end up in the take.
     - The singer gets a breath before the first bar.
     - The level meter already runs during the countdown, so "is the mic hearing me?" is answered before anything is recorded.
   - It is visual only, with no beep: a beep needs Web Audio output and would bleed into headphones/MIDI.
   - It is not configurable. It costs 3 s, and it saves the most common re-take.
3. **Transparency text without a wall of words (D11).** Visible: one line with a `Lock` icon, `Kaydını şef ve dinleme asistanı Demo Asistan dinler.` Under it, a `details` disclosure **`Kimler görür, ne zaman silinir?`** holds the rest of D11. The full D11 sentences stay in the DOM, so AC 7 and AC 21 can still read them. Exact copy is in §2.10.
4. **Queue/review loop.** Accepted as specified: save stays on the page and shows its confirmation, and `Sonraki` sits in a footer row with the position (`2 / 12 · Dinlenecek`).
   - I considered a combined `Kaydet ve sonraki` and rejected it:
     - The assistant wants to see that the note was saved.
     - The conductor wants to see the deletion date.
     - Two save buttons confuse.

     So the loop is 2 taps per item.
   - **Addition:** leaving with an unsaved, changed textarea (via `Sonraki`, `BackLink` or the tab bar) asks `Notun kaydedilmedi. Kaydetmeden geçilsin mi?` with `Kal` / `Geç`. This is a client dirty check.
   - **Addition:** the queue has a primary **`Dinlemeye başla (n)`** that opens the first item, and the home cards link straight to the first item. So the loop starts in one tap.
5. **Copy changes** (final wording is yours):
   - **`Korist'e yorumun` → label `Yorumun`** with help `Gönderdiğin an {Ad Soyad} görür. Asistan notları ona gitmez.` In Turkish the apostrophe belongs only to proper nouns, so "Korist'e" is wrong, and putting the name in the label needs vowel-harmony suffixes (`Ayşe'ye`, `Barış'a`). The help line names the person with no suffix.
   - **`Asistan notu olanlar` → `Asistan notlu`.** The three conductor chips are 142 + 128 + 116 px. They wrap onto two lines at 375 either way, but the short label keeps the first two on line one.
   - **`Dinleme (<n>)` → a `Dinleme` button with a count pill** (same visual as `FilterChip`'s count). Same information, no parentheses.
   - **The 4 MB error:** `Dosya en fazla 4 MB olabilir. Daha kısa bir kayıt seç ya da burada Kayda başla ile kaydet.` "Sıkıştırılmış kaliteyi seç" sends a non-technical singer into iOS Settings. The in-portal recorder is always small (48 kbps), so point there.
   - **The unsupported-type error:** `Bu dosya bir ses kaydı değil ya da türü desteklenmiyor. Telefonunun ses kaydedicisinden bir kayıt seç (m4a, mp3, wav…).` "webm, ogg" means nothing to singers. The server's list doesn't change.
   - **The microphone denial (AC 17):** the PO sentence stays as the first line, but the steps below it are concrete per platform (§2.3). "Tarayıcı ayarlarından izin ver" alone isn't enough for a 55-year-old alto.
6. **Disagree, gently: `Partisyonumu` on the piece page (D24).** When the portal has a MIDI file for my part, the hero button becomes **`Partisyonumu çal (Alto)`** and plays inline. The Drive link stays, in its row under `PARTİSYON KAYDI`.
   - Today on an iPhone the hero opens a Drive `.mid` that iOS can't play. Finding and hearing my part must be one tap: that's the core action of this phase.
   - With no portal MIDI for my part, the hero is Phase 3's Drive button, unchanged, so nobody is forced to migrate.
   - The same rule applies on the home `Çalışılan eserler` rows (`Partisyonum` → plays inline is too much for a row, so there it links to `/repertuvar/<id>?cal=1`, which opens the player and starts after the user's tap; autoplay is blocked anyway).
7. **Needs your decision: what the conductor's `Kaydı sil` does to the submission.** My proposal: the submission stays (`submitted_at` and `method` are unchanged), and the audio shows `Ses dosyası silindi (<tarih>). Yorumlar duruyor.`. It's the same as retention, so one state, not a new one.
   - The singer's own `Sil` is different. It withdraws the submission (D8), because it's their choice.
   - Confirm copy: title `"{Ad Soyad}" kaydı silinsin mi?` (no possessive suffix, which would vary by name), body `Ses dosyası hemen silinir. Teslim, notlar ve yorum kalır.`, buttons `Vazgeç` / `Sil`.
8. **Needs your decision: `Yorumlananlar` grows forever.** I propose it shows comments from the last 60 days, with the line `Son 60 gün` under the chips. Older ones are reachable from the homework's roster. No paging.

**@ui:**
- **Level meter:** an `AnalyserNode` on the same `MediaStream` (Web Audio, no library), 32 bars, ~15 fps. Details are in §2.4. If it costs more than ~1 KB of code, keep only the "too loud / no sound" text lines and drop the bars. The lines matter more than the bars.
- **Upload progress needs `XMLHttpRequest`** (`xhr.upload.onprogress`). `fetch` has no upload progress in Safari.
- **`beforeunload` doesn't fire on client-side navigation.** While an unsent take exists (states 6–8 in §2), intercept the shell's `Link` clicks (tab bar, sidebar, `BackLink`) with `ConfirmDialog`: `Kaydın gönderilmedi. Çıkarsan kayıt silinir.`, with `Kal` / `Çık`.
- **`visibilitychange` while recording** (iOS locks the screen, or a call comes in): stop the recorder and keep what was recorded. On return, show state 6 with the notice `Ekran kilitlendiği ya da başka uygulamaya geçtiğin için kayıt durdu. Kaydın burada: dinle, gönder ya da yeniden kaydet.`

## 1. Homework detail `/odevler/[id]`: the singer card

The header, description, feedback placement and roster are as in Phase 4, with the changes in §5. The card is `section#kayit.scroll-mt-20 rounded-2xl border bg-card p-4 space-y-5`, with title h2 `Ödevini teslim et`.

**Step 1 `Partisyonunu dinle`** (`stepNumber` badge as today):
- With a portal MIDI for my part (else Tutti): full-width `Button variant="outline" h-12 rounded-2xl`, `Play` icon, **`MIDI'yi çal`**. It opens the MIDI player (§9) inline under the button, in compact mode.
- Under it is the Drive part button as a text link, `min-h-11 text-sm text-primary`: `Partisyonumu aç (Alto) ↗`.
- Without a portal MIDI, Phase 3's `PartButton` stays full width as today.
- Measured: the two buttons side by side wrap at 343 (`mock-recorder`, state 1, shows "MIDI'yi / çal" breaking), so they **stack**.

**Step 2 `Kaydını yap`**, with the recorder states below. Under the recorder, still inside the card:
- the transparency line (§2.10)
- the fallback disclosure (§2.11)

When submitted, the card title becomes **`Teslimin`**, the step numbers disappear, and the card shows the sent state (§2.9).

## 2. The recorder (client component `Recorder`, `data-state` on the root)

Every state lives in step 2. The states are listed in their mock order; the copy is exact.

| # | `data-state` | What the singer sees |
|---|---|---|
| 1 | `idle` | hint, `Kayda başla`, `Dosya yükle`, permission hint |
| 2 | `denied` / `nomic` / `busy` / `unsupported` | an explanation and a recovery path |
| 3 | `countdown` | `Hazırlan…` 3-2-1 |
| 4 | `recording` | timer, meter, `Durdur` |
| 5 | `recording` + `data-last-minute` | the timer in amber, the stop warning |
| 6 | `recorded` | the take's player, `Gönder`, `Yeniden kaydet` |
| 7 | `uploading` | progress, `Vazgeç` |
| 8 | `failed` | the error, `Tekrar dene`, `Kaydı indir`, fallback opened |
| 9 | `sent` | `Kaydın gönderildi …`, player, `Değiştir`, `Sil` |
| 10 | `locked` | the comment exists: player, deletion date, no changes |
| 11 | `gone` | the audio has been deleted |

### 2.1 Idle (state 1)
- `text-xs text-muted-foreground`: **`Kulaklık takarsan MIDI'yi dinlerken kayıt yapabilirsin.`**
- Primary `Button h-14 w-full rounded-2xl text-[17px]`, `Mic` icon: **`Kayda başla`**.
- `Button variant="outline" h-12 w-full rounded-2xl`, `Upload` icon: **`Dosya yükle`**. It's a `label` for a hidden `input type="file" accept="audio/*,.m4a,.mp3,.aac,.wav,.ogg,.opus,.webm"`.
- When `navigator.permissions.query({name:"microphone"})` isn't `granted` (or the API is missing): `text-xs text-muted-foreground` **`Telefon mikrofon izni isteyecek; İzin Ver'e dokun.`**
- Under `Dosya yükle`, a `details` with summary `text-xs text-primary min-h-11` **`Telefonumdaki bir kaydı nasıl yüklerim?`**. Its body (`text-xs`, `ol`):
  - iPhone: **`Ses Kayıtları'nda kaydı aç → Paylaş → Dosyalar'a Kaydet. Sonra burada Dosya yükle → Göz At.`**
  - Android: **`Ses kaydedicide kaydı seç → Paylaş yerine burada Dosya yükle'ye dokun ve kaydı seç.`**
- From `md`: the buttons are `md:max-w-sm`, not full width.

### 2.2 Choosing a file
Picking a file **uploads at once** (AC 9; picking is already the deliberate act), going straight to state 7. Before uploading, the client checks:
- size > 4,194,304 → the error from §0.5, shown inline in a `late` box; no request
- an empty file → `Bu dosya boş. Başka bir kayıt seç.`

Server refusals show in the same box, with `Başka dosya seç` (outline).

### 2.3 Permission refused and other mic problems (state 2)
Box: `rounded-2xl border border-late/40 bg-late/10 p-3 space-y-2`, title in `font-medium text-late-ink`. Then `Tekrar dene` (primary `h-12 w-full`, which calls `getUserMedia` again), then `Dosya yükle` (outline), then `text-xs` **`Ya da telefonundaki ses kaydediciyle kaydet, sonra Dosya yükle'yi kullan.`**

| Error | Title | Body |
|---|---|---|
| `NotAllowedError` | **`Mikrofon izni verilmedi.`** | The platform steps below. The PO sentence of AC 17 is the accessible description (`sr-only` + `aria-describedby`), so the AC text is present. |
| `NotFoundError` | **`Mikrofon bulunamadı.`** | `Bu cihazda mikrofon görünmüyor. Kulaklık taktıysan çıkarıp tekrar dene ya da Dosya yükle'yi kullan.` |
| `NotReadableError` | **`Mikrofon şu an kullanılıyor.`** | `Başka bir uygulama (ör. telefon görüşmesi) mikrofonu kullanıyor. Onu kapatıp Tekrar dene'ye dokun.` |
| no `MediaRecorder`/`getUserMedia` | (no box; `Kayda başla` is not rendered) | `text-sm` **`Bu tarayıcı kayıt yapamıyor; Dosya yükle'yi kullan.`** + `text-xs` **`Bağlantıyı WhatsApp ya da Instagram içinden açtıysan Safari'de ya da Chrome'da aç.`** |

Platform steps for `NotAllowedError`: show the user's platform (UA sniff: iOS, Android, other), with a `details` **`Başka bir telefon mu?`** for the rest.
- **iPhone (Safari):** `İzin vermek için iPhone'da:`
  1. `Adres çubuğundaki aA simgesine dokun.`
  2. `Web Sitesi Ayarları → Mikrofon → İzin Ver.`
  3. `Aşağıdaki Tekrar dene'ye dokun.`

  Then `text-xs`: `Ana ekrana eklediğin uygulamadan açtıysan: Ayarlar → Uygulamalar → Safari → Mikrofon → Sor. Sonra uygulamayı kapatıp yeniden aç.`
- **Android (Chrome):**
  1. `Adres çubuğunun solundaki simgeye dokun.`
  2. `İzinler → Mikrofon → İzin ver.`
  3. `Tekrar dene'ye dokun.`
- **Computer:** `Adres çubuğundaki kilit simgesine tıkla, Mikrofon'u İzin ver yap ve Tekrar dene'ye tıkla.`
- If `Tekrar dene` fails again on iOS: an extra line, `Değişiklik görünmüyorsa sayfayı yenile.`, with a `Sayfayı yenile` ghost button.
- **@tech lead go-live check §9.2:** verify these iOS 18 menu names on the real iPhone (`aA`, `Web Sitesi Ayarları`, `Ayarlar → Uygulamalar → Safari`). iOS 17 has `Ayarlar → Safari`. Correct the copy if they differ.

### 2.4 Countdown and recording (states 3–5)
**Countdown.**
- `text-sm text-muted-foreground` `Hazırlan…`
- the digit `font-heading text-6xl tabular-nums`
- the meter, in grey
- `Button variant="ghost" h-12 w-full` **`Vazgeç`** (back to idle)
- Screen-reader announcement: `Kayıt 3 saniye sonra başlıyor.`

**Recording.** The card gets `ring-2 ring-absent`, top to bottom:
- **Status row:** `flex justify-between`. On the left, `size-2.5 rounded-full bg-absent motion-safe:animate-pulse` plus `text-sm font-medium text-absent-ink` **`Kaydediliyor`**. On the right, `text-xs text-muted-foreground` **`10:00'da kendiliğinden durur`**.
- **Timer:** `font-heading text-5xl tabular-nums text-center` `1:07`, followed by `text-lg text-muted-foreground` `/ 10:00`.
- **Level meter:** `h-12 flex items-end gap-[3px]` with 32 bars `flex-1 rounded-sm bg-primary`, a rolling history of RMS, oldest on the left at 35% opacity, `aria-hidden`. With `prefers-reduced-motion`: one horizontal bar `h-2 rounded-full bg-muted` with a `bg-primary` fill.
- **Meter lines** (`role="status"`, in a `late` box):
  - a peak ≥ −1 dBFS for 0.5 s: **`Ses çok yüksek; telefonu biraz uzaklaştır.`**
  - RMS < −55 dBFS for 5 s: **`Ses gelmiyor. Mikrofonun kapalı ya da kapalı bir kılıfın içinde olabilir.`**

  Each line hides 3 s after the condition ends.
- **Stop:** `Button h-14 w-full rounded-2xl bg-absent text-absent-foreground` (dark: `--absent-foreground` = background, checked in the mock), `Square` icon (filled): **`Durdur`**, `aria-label="Kaydı durdur"`.
- **Last minute (from 9:00):** the timer is `text-late-ink`, with a line `text-sm text-late-ink text-center` **`1 dakikadan az kaldı.`**
- **Screen-reader announcements** (`aria-live="polite"`, AC 57):
  - `Kayıt başladı.`
  - at 9:00, `1 dakika kaldı.`
  - at stop, `Kayıt durdu, 1:32.`

  Never every second.
- **At 10:00** the recorder stops by itself. State 6 then shows the notice `text-sm` **`Kayıt 10 dakikada durdu.`** (AC 16).
- No pause button: MediaRecorder pause on iOS is unreliable, and homework takes are short.

### 2.5 Recorded, not sent (state 6)
- `font-medium` **`Kaydın hazır · 1:32`**, then `text-xs text-muted-foreground` **`Henüz gönderilmedi. Dinleyip beğendiysen gönder.`**
- An `AudioPlayer` (§2.12) on the in-memory blob, with a play button `aria-label="Kaydını dinle"` and the label `Dinle` for AC 7.
- Primary `h-14 w-full rounded-2xl`, `Send` icon: **`Gönder`**.
- `Button variant="outline" h-12 w-full`, `RotateCcw` icon: **`Yeniden kaydet`**. It opens `ConfirmDialog`: title **`Baştan kaydedilsin mi?`**, body **`Şu anki kayıt silinir.`**, buttons **`Vazgeç`** / **`Baştan kaydet`**. Confirming goes straight to the countdown.
- A file-picked take never shows this state, because it uploads at once (§2.2).

### 2.6 Uploading (state 7)
- `font-medium tabular-nums` **`Gönderiliyor… %62`**, then `h-2 rounded-full bg-muted` with a `bg-primary` fill (`role="progressbar"`, `aria-valuenow`). At 100%, while the server works: **`Kaydediliyor…`**.
- `text-xs text-muted-foreground` **`Sayfadan çıkma. Bağlantın yavaşsa bir dakika sürebilir.`**
- `Button variant="ghost" h-12 w-full` **`Vazgeç`** aborts the XHR and returns to state 6, with the take kept.
- On success: the toast **`Kaydın gönderildi.`**, state 9, and the header `DeadlineChip` updates to `Teslim edildi · <tarih>` / `Geç teslim · <tarih>` (`router.refresh()`).

### 2.7 Failed (state 8)
- An `absent` box (`bg-absent/10 border-absent/40`, text `text-absent-ink`) with the server's or the client's message:
  - storage put fault (D21): **`Kayıt şu an yüklenemedi. Kaydın kaybolmadı: tekrar dene ya da Kaydı indir ile telefonuna kaydet.`**
  - `navigator.onLine === false` or a network error: **`İnternet bağlantın yok gibi görünüyor. Kaydın kaybolmadı: bağlanınca tekrar dene ya da Kaydı indir ile telefonuna kaydet.`**
  - quota guard (D20): the PO message as written
  - comment lock (D8), the 5-upload limit, 4 MB, type: the server's text, with no `Tekrar dene`
- The take's player.
- Primary **`Tekrar dene`** (`RefreshCw`), hidden for the non-retryable errors above.
- Outline **`Kaydı indir`** (`Download`). It's a client download with the file name `Ave-Verum-Corpus-Olcu-12-34-Demo-Korist.m4a` (or `.webm`), ASCII-folded.
- Under it, `text-xs`: **`iPhone'da açılan ekranda Paylaş → Dosyalar'a Kaydet'i seç. Sonra şefe başka yolla gönder.`**
- The fallback disclosure (§2.11) opens automatically.

### 2.8 Quota guard active (D20, AC 45)
- Known on page load: above `Kayda başla`, a `late` box: **`Kayıt alanı şu an dolu; yükleme geçici olarak kapalı. Kaydedip telefonuna indirebilir, sonra şefe başka yolla gönderebilirsin.`**
- Recording still works. In state 6, `Gönder` is replaced by a primary **`Kaydı indir`**.
- `Dosya yükle` is hidden.
- The fallback is open.
- Storage not configured (D15): the same layout, with **`Kayıt yükleme henüz açılmadı.`**

### 2.9 Sent (state 9)
- Row: `CircleCheck text-present-ink` + `font-medium` **`Kaydın gönderildi · 21 Eki 21:14 · 1:32`**. When replaced, `text-xs text-muted-foreground` **`Değiştirildi · 22 Eki 18:05`** under it.
- An `AudioPlayer` fetching `/api/dosya/kayit/<id>` on the first tap only (D16, AC 10).
- `text-xs text-muted-foreground`: **`Şefin yorumu gelince burada görünür; Ödevler'de "Yeni not" işareti çıkar.`**
- Row `grid grid-cols-2 gap-2`:
  - `Button variant="outline" h-12` **`Değiştir`**. It swaps the sent block for state 1, with the line `text-xs` **`Yeni kaydı gönderince eskisi silinir.`** and a ghost **`Vazgeç`** that returns to state 9. The old recording stays until the new upload succeeds.
  - `Button variant="ghost" h-12 text-absent-ink` **`Sil`**. It opens the confirm `Kaydın silinsin mi?` / `Teslimin de geri alınır.` / `Vazgeç` / `Sil`, then the toast **`Kaydın silindi.`**
- `text-xs text-muted-foreground`: **`Şef yorum yazana kadar kaydını değiştirebilirsin.`**
- Uploads left (D7), when ≤ 2 remain: `text-xs` **`Bu ödeve 2 kez daha kayıt yükleyebilirsin.`** At 0, `Değiştir` is hidden (AC 14) and the line reads **`Bu ödeve 5 kez kayıt yükledin; artık değiştiremezsin.`**
- **Submitted through the fallback, no recording:** the row is `CircleCheck` + **`Teslim ettin · 21 Eki 21:14`**, plus `text-xs` **`Portala kayıt yüklemedin. İstersen şimdi yükleyebilirsin.`** Under it are the idle recorder buttons (AC 36), and the Phase 4 `Geri al` sits in the disclosure.

### 2.10 Transparency (D11)
At the bottom of the card, above the disclosure: `flex gap-2`, `Lock size-4 text-muted-foreground mt-0.5`, `text-xs text-muted-foreground`.

The visible line:
- one assistant: **`Kaydını şef ve dinleme asistanı Demo Asistan dinler.`**
- several: **`Kaydını şef ve dinleme asistanları Ayşe Öztürk, Demo Asistan dinler.`** (all names, alphabetical, `font-medium text-foreground`)
- none: **`Kaydını yalnızca şef dinler.`**

`details` summary, `text-xs font-medium text-primary min-h-8`: **`Kimler görür, ne zaman silinir?`**. Its body (`text-xs space-y-1`):
- `Asistanların notlarını yalnızca şef görür; sana şefin yorumu gelir.`
- `Ses dosyası, şef yorumundan 90 gün sonra silinir. Yorum gelmezse yüklendikten 120 gün sonra silinir.`
- `Yorumlar ve notlar silinmez.`

The block is shown in states 1, 6 and 9. It is hidden in 10 and 11, where the deletion line replaces it.

### 2.11 Fallback `Başka yolla gönderdim` (D5)
`details` at the bottom of the card, `border-t pt-1`. Summary `min-h-12 flex justify-between font-medium text-sm` **`Başka yolla gönderdim`** + `ChevronDown` (rotating). It's open by default in states 8 and 2.8.

Body (`space-y-3 pb-2`):
- `text-xs text-muted-foreground` **`Kaydını e-postayla ya da elden şefe ilettiysen burada işaretle.`**
- the Phase 4 mail block (outline, not primary, so it doesn't compete), or the Phase 4 no-email hint
- `SubmitToggle` (`Teslim ettim` / `Geri al`) as today

### 2.12 `AudioPlayer` (shared by states 6–10 and the review page)
- `flex items-center gap-3 rounded-2xl bg-muted p-2 pr-3`
- Play/pause: `size-11 rounded-full bg-primary text-primary-foreground`, `Play`/`Pause` icons, `aria-label` = `Kaydını dinle` / `Kaydı dinle` (review) / `Duraklat`.
- Seek: native `input type="range"`, `h-11` hit area, `h-1.5` track styled with `accent-primary`, `aria-label="Konum"`.
- Time: `text-xs tabular-nums text-muted-foreground` `0:42 / 1:32`.
- Loading after the tap: a spinner in the button, `aria-busy`.
- Get error: under the player, `text-xs text-absent-ink` **`Kayıt şu an açılamıyor. Biraz sonra tekrar dene.`**
- Transfer guard: the button is disabled, with **`Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).`**
- A WebM file on Safari < 17, after an `error` event on `<audio>`: **`Bu kayıt bu tarayıcıda çalmıyor.`** For the conductor, add `İndir ile bilgisayarda dinleyebilirsin.`

### 2.13 Locked and gone (states 10, 11)
- **Locked** (the conductor commented): the `Şefin notu` card sits above the singer card (Phase 4 rule). The singer card shows the sent row and the player, then `text-xs text-muted-foreground` **`Şef yorum yazdı; kaydın artık değişmez. Ses dosyası 21 Oca 2027'de silinir, şefin notu kalır.`** There's no `Değiştir`/`Sil` and no disclosure.
- **Gone:** the sent row stays (date, duration). In place of the player: `rounded-2xl border border-dashed p-4 flex gap-3`, `AudioLines text-muted-foreground`, `text-sm text-muted-foreground` **`Ses dosyası silindi (1 Ara 2026). Yorumlar duruyor.`**

## 3. `/odevler` list and home `Ödevlerim`

- **Unsubmitted singer row:** the right-hand control becomes `Link`, styled `Button variant="outline" h-11 rounded-full px-3 w-[124px]`, `Mic` icon: **`Kaydını yap`**, `href="/odevler/<id>#kayit"`, `aria-label="Kaydını yap: {başlık}"`. The row's text column width (179 px) is unchanged. The `Teslim edildi` toast and `Geri al` on rows go away.
- **Submitted row with a portal recording:** line 2 gets `· Kayıt 1:32` (`AudioLines size-3.5`).
- **Header entry points** (`flex flex-wrap gap-2` under the h1, all `h-11 rounded-full`):
  - **Conductor:** `Headphones` **`Dinleme`** + count pill (`Yorum bekleyen` n) · `Grid3x3` **`Teslim matrisi`** · `Settings2` **`Ayarlar`**, a DropdownMenu with:
    - `Kayıt e-postası…` (opens the existing dialog)
    - `Dinleme asistanları` → `/odevler/asistanlar`
    - `Depolama` → `/odevler/depolama`
  - **Board:** `Teslim matrisi` · `Ayarlar` (`Kayıt e-postası…`, `Depolama`). A board member who is an assistant also gets `Dinleme` first.
  - **Assistant (member):** under the subline, `Headphones` **`Dinleme`** + count pill (`Dinlenecek` n), outline. Hidden when n = 0 and `Not yazdıklarım` is empty.
  - At 375: `Dinleme 12` (≈132) + `Teslim matrisi` (≈150) fit on line 1 and `Ayarlar` (≈108) wraps, which is fine. The `Kayıtlar şu adrese gidiyor:` line stays under the row.
- **Storage banner for managers** (D19), above the chips:
  - ≥ 80%: `rounded-2xl border border-late/40 bg-late/10 p-4 flex gap-3`, `TriangleAlert text-late-ink`, **`Kayıt alanı %82 dolu. Depolama sayfasına bak.`** + `Link` **`Depolama`** (`text-primary font-medium min-h-11`).
  - ≥ 95%: `border-absent/40 bg-absent/10`, `CircleAlert text-absent-ink`, **`Kayıt alanı dolu; yeni kayıt alınmıyor.`** + the same link.

## 4. Home cards

The order follows Phase 8 D22: hero → `Yönetim Kurulu` (managers) → **`Dinleme`** (conductor/assistant) → `Ödevlerim`. Rationale: the conductor's weekly job is right after the board.

- **Conductor `Dinleme`** (`Card`):
  - h2 **`Dinleme`**, right link **`Kuyruk`** → `/odevler/dinle`
  - body `text-sm tabular-nums`: **`12 kayıt yorum bekliyor · 3 asistan notlu`**
  - primary `Button h-12 w-full rounded-2xl`, `Play` icon: **`Dinlemeye başla`**. It goes to the first item of `Asistan notlu` when k > 0, else of `Yorum bekleyen` (one tap into the loop).
  - At 0: `text-sm text-muted-foreground` **`Yorum bekleyen kayıt yok.`** with no button. The card stays, because it's the conductor's weekly job.
- **Assistant:** the same card, body **`Dinleme kuyruğun: 4 kayıt`**, button `Dinlemeye başla`. Hidden at 0 (D14).
- **Storage banner** (managers, ≥ 80%) above the cards, same as §3.
- **`Ödevlerim`:** the row's button is `Kaydını yap` (§3). After returning from a send, the card shows the next one (server render).

## 5. Roster on `/odevler/[id]` (managers)

- **A submitted row with a recording:** after the state chip, `inline-flex gap-1 text-xs text-muted-foreground tabular-nums` with `AudioLines size-3.5` **`Kayıt · 1:32`**. The audio-deleted case shows **`Kayıt silindi`**.
- **Conductor:** the row is a `Link` → `/odevler/<id>/dinle/<userId>` (`ChevronRight`). The `MessageSquareText` note icon stays as an indicator (`text-primary` when a comment exists) and isn't a separate control. Rows without a recording and without a submission keep the Phase 4 sheet, minus the `Not` part: only the manual mark toggle. A manual or fallback submission links to the review page too (`Portalda kayıt yok`), so the conductor can comment (D5).
- **Board:** rows open the sheet with only the manual mark toggle. No note field (D3). `Kayıt · 1:32` is plain text.
- Existing board-written notes: the sheet shows them read-only, `text-sm bg-muted rounded-xl p-3`, with `Geri bildirim · {Ad} · {tarih}` and `text-xs` **`Bu notu yalnızca şef değiştirebilir.`**
- The homework delete confirm body (AC 40): **`12 teslim kaydı, 9 ses kaydı ve notlar da silinir. Bu işlem geri alınamaz.`** With k = 0, keep the Phase 4 body.

## 6. Queue `/odevler/dinle`

Mocks: `mock-review-375-*-part1`.

- `BackLink` **`Ödevler`**, h1 **`Dinleme`** (`text-4xl`), and a sub line in `text-sm text-muted-foreground`:
  - conductor: **`Koristlere yorumunu buradan yaz.`**
  - assistant: **`Soprano ve Alto kayıtları · notlarını yalnızca şef görür.`** (`Tüm partisyonların kayıtları · …` for all parts)
- Chips `nav aria-label="Dinleme listesi" flex flex-wrap gap-2` (`?liste=`):
  - conductor: **`Yorum bekleyen {n}`** · **`Asistan notlu {k}`** · **`Yorumlananlar`**, plus the line `Son 60 gün` under it when that chip is active (§0.8)
  - assistant: **`Dinlenecek {n}`** · **`Not yazdıklarım {m}`**
- **Groups** per homework, newest due first:
  - header `flex justify-between items-baseline`: h2 `text-[17px] font-medium` **`Ave Verum Corpus · Ölçü 12–34`** and `text-xs text-muted-foreground` **`Son tarih 26 Eki`**
  - then `ul.divide-y.rounded-2xl.border.bg-card`
- **Row** = `Link min-h-16 px-4 py-2.5 flex items-center gap-3`:
  - line 1: `PartDot` + name `font-medium truncate`
  - line 2: `text-xs text-muted-foreground tabular-nums flex flex-wrap gap-1.5` **`1:32 · 21 Eki 21:14`**, followed by tags (`rounded-full px-2.5 py-0.5 text-xs font-medium`):
    - `Geç`: `bg-late/18 text-late-ink`
    - `Yeni kayıt`: `bg-primary/12 text-primary` (assistant view only, D8)
    - conductor: `MessageSquareText` **`2 asistan notu`**, `bg-primary/12 text-primary` (none: no tag)
    - conductor, no portal file: in place of the duration, a dashed muted tag **`Portalda kayıt yok`**
    - audio deleted (Yorumlananlar): **`Ses silindi`** muted
  - `ChevronRight` on the right
  - `aria-label="{Ad}, {Partisyon}, 1 dakika 32 saniye, 21 Ekim. 2 asistan notu"`
- Under the list, `sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] md:static` primary `h-12 w-full md:w-auto rounded-2xl`, `Play` icon: **`Dinlemeye başla (3)`**. It opens the first row. Hidden when the list is empty.
- **Empty states** (dashed card, `Headphones` icon):

  | Chip | Copy |
  |---|---|
  | Yorum bekleyen | **`Yorum bekleyen kayıt yok.`** / `Koristler kayıt gönderince burada görünür.` |
  | Asistan notlu | **`Asistan notu bekleyen kayıt yok.`** |
  | Yorumlananlar | **`Son 60 günde yorum yazmadın.`** |
  | Dinlenecek | **`Dinlenecek kayıt yok.`** / `Yeni kayıt gelince burada görünür.` |
  | Not yazdıklarım | **`Henüz not yazmadın.`** |
  | Conductor with no assistants | above the list, `text-xs text-muted-foreground`: `Henüz dinleme asistanı yok.` + link `Asistan ekle` |

- **Loading** (`loading.tsx`): 2 group headers `h-4 w-1/2` + 3 rows `h-4 w-1/3` / `h-3 w-1/4` each.

## 7. Review page `/odevler/<id>/dinle/<userId>`

Mocks: `mock-review-375-*-part1..3`, desktop `mock-review-1280-light`. Single column `max-w-2xl` on every width. A two-column desktop layout was tried and didn't help: the page is read top to bottom, and the conductor reviews on the phone.

**Header (both roles):**
- `BackLink` **`Dinleme`** (keeps `?liste=`)
- eyebrow **`AVE VERUM CORPUS · ÖLÇÜ 12–34`** (the whole eyebrow links to the homework for the conductor)
- h1 the singer's name, `text-3xl`
- meta row `flex flex-wrap gap-x-3 gap-y-1 text-sm`:
  - `VoicePartBadge`
  - **`Teslim: 21 Eki 21:14`**
  - `Geç teslim` chip (`late` soft) when late
  - `text-muted-foreground` **`Değiştirildi · 22 Eki`**

**Player:** `AudioPlayer` (§2.12), wrapped in `sticky top-16 z-10 bg-background py-1`, so it stays reachable while typing a note with the keyboard up.
- Conductor only, a row below: `Button variant="ghost" h-11`, `Download` icon, **`İndir`** (`?indir=1`), and on the right `Button variant="ghost" h-11 text-absent-ink` **`Kaydı sil`** (confirm §0.7).
- `Portalda kayıt yok`: in place of the player, a dashed box `text-sm` **`Bu teslimde portala yüklenmiş kayıt yok (e-posta ya da elden). Yorumunu yine de yazabilirsin.`**
- Gone: the §2.13 box.

**Assistant body:**
- `Card` with `Label` **`Notun`**.
- `Textarea rows=4`, placeholder `ör. Girişte tempo kaçıyor, 12. ölçüde nefes erken.`, help `text-xs` **`Bu notu yalnızca şef görür. Korist görmez.`**, counter.
- Primary `h-12 w-full md:w-auto` **`Kaydet`** → toast **`Notun kaydedildi.`** (once a note exists, the button reads `Güncelle`).
- Ghost destructive **`Notu sil`** (once a note exists) → the confirm `Notun silinsin mi?` / `Vazgeç` / `Sil`, then the toast **`Notun silindi.`**
- Error **`Not en fazla 1000 karakter olabilir.`**
- When the old note belongs to a replaced take: the tag `Önceki kayda yazıldı` (`late` soft) above the textarea, and the help `text-xs` **`Kayıt değişti. Yeni kaydı dinleyip notunu güncelle.`** The tag goes away once the note is saved after the replacement.
- **After the conductor commented:** the card shows `present` soft box **`Şef yorumunu gönderdi.`**, the note as read-only text (`bg-muted rounded-xl p-3`) and `text-xs` **`Notun artık değişmez.`** No buttons. (Only reachable from `Not yazdıklarım`.)

**Conductor body:**
1. h2 **`Asistan notları`** + count (`text-muted-foreground`), with `text-xs` **`Koriste gitmez; yalnızca sen görürsün.`** under it.
2. Each note: `rounded-2xl border bg-muted/60 p-3 space-y-1.5`, with:
   - the line `font-medium text-sm` name + `text-xs text-muted-foreground` date + `Önceki kayda yazıldı` tag
   - the body `text-sm whitespace-pre-line`
   - `Button variant="ghost" h-11 px-2 text-primary`, `Plus` icon: **`Yoruma ekle`**

   Tapping it appends the text to `Yorumun` (with `\n\n` when the box isn't empty), moves the caret to the end, scrolls the box into view, and turns the button into `Check` **`Eklendi`** (disabled for this visit).
3. With no notes: `text-sm text-muted-foreground` **`Bu kayda asistan notu yok.`**
4. `Card`, `Label` **`Yorumun`**, `Textarea rows=5`, help `text-xs` **`Gönderdiğin an Demo Korist görür. Asistan notları ona gitmez.`**, counter. Primary `h-12 w-full md:w-auto` **`Yorumu gönder`** → toast **`Yorum gönderildi.`**
   - After sending, above the box, a `present` soft box: **`Yorum gönderildi. Bu kayıt 21 Oca 2027 tarihinde silinecek.`**
   - Buttons: outline **`Güncelle`** → toast `Yorum güncellendi.` · ghost destructive **`Yorumu sil`**, with the confirm `Yorum silinsin mi?` / `Demo Korist artık bu yorumu görmez ve kaydını yeniden değiştirebilir.` / `Vazgeç` / `Sil`, then the toast `Yorum silindi.`
   - An existing Phase 4 board note (`Geri bildirim`) prefills the box, with a muted line `Bu not Demo Yönetim tarafından yazıldı.`

**Footer (both):** `flex items-center gap-3 border-t pt-3`. `text-xs text-muted-foreground tabular-nums` **`2 / 12 · Dinlenecek`**, then right `Button variant="outline" h-12 rounded-2xl px-5` **`Sonraki`** + `ChevronRight`. At the end: the button is replaced by `text-sm` **`Bu listede başka kayıt yok.`** + `Link` **`Listeye dön`**. The dirty-state guard is in §0.4.

## 8. `/odevler/asistanlar` (conductor)

Mock: `mock-admin-375-*-part1`.

- **Header:** `BackLink` **`Ödevler`**, h1 **`Dinleme asistanları`**, sub `text-sm text-muted-foreground` **`Kayıtları senden önce dinleyip sana not bırakırlar. Notlarını yalnızca sen görürsün; koriste senin yorumun gider.`** Under it, primary `h-11 rounded-full px-4`, `Plus` icon: **`Asistan ekle`**.
- **List** `ul.divide-y.rounded-2xl.border.bg-card`, rows `min-h-16 px-4 py-2.5 flex items-center gap-3`:
  - name `font-medium`
  - `text-xs text-muted-foreground` **`Tenor · Korist`** (part · role label)
  - the scope line `text-sm flex flex-wrap gap-x-3`, with `PartDot` + `Soprano`, `PartDot` + `Alto`, or **`Tüm partisyonlar`**
  - on the right, a `size-11` `MoreHorizontal` menu: **`Düzenle`**, **`Kaldır`** (destructive)
- **Ignored appointments** (D9: left the choir or became conductor): the row at `opacity-60`, with the sub line **`Ayrıldı · etkin değil`** / **`Şef oldu · etkin değil`**. The menu has only `Kaldır`.
- **Add and edit sheet** (`SheetTitle` **`Asistan ekle`** / **`Asistanı düzenle`**):
  1. **`Kim?`** A field-looking `button h-14 rounded-xl border` showing the chosen person (name + `Alto · Yönetim kurulu`) or the placeholder **`Kişi seç`**. It opens a nested list: `Input` **`İsim ara`**, then rows `min-h-12` grouped by part with eyebrow headers (`SOPRANO` …), listing only active `member`/`board` users who aren't assistants already, sorted by name. On edit, the person is fixed and shown as text.
  2. **`Hangi partisyonları dinlesin?`** `fieldset` with toggle chips `min-h-11 rounded-full`: **`Tüm partisyonlar`** · `Soprano` · `Alto` · `Tenor` · `Bas` (with dots).
     - `Tüm partisyonlar` is exclusive: picking it clears the four, and picking a part clears it.
     - **Default: the chosen person's own part** (a section leader listens to their own section). A person without a part defaults to `Tüm partisyonlar`.
  3. `text-xs text-muted-foreground`: **`Kendi kaydını hiçbir zaman dinlemez. Koristler, kaydını kimlerin dinlediğini görür.`**
  4. Buttons **`Ekle`** / **`Kaydet`** (primary `h-12 w-full`), **`Vazgeç`** (ghost).
  - Errors: **`Bir kişi seç.`** · **`En az bir partisyon seç.`**
  - Toasts: **`Ayşe Öztürk dinleme asistanı oldu.`** · **`Kaydedildi.`**
- **Remove:** `ConfirmDialog` title **`"Ayşe Öztürk" kaldırılsın mı?`**, body (PO) **`Ayşe Öztürk artık kayıt dinleyemeyecek. Yazdığı notlar şefte kalır.`**, buttons **`Vazgeç`** / **`Kaldır`**. Toast **`Ayşe Öztürk kaldırıldı.`**
- **Empty:** dashed card, `Headphones` icon, **`Henüz asistan yok.`** / `Asistan atamazsan bütün kayıtları sen dinlersin.` + primary **`Asistan ekle`**.

## 9. MIDI

### 9.1 Piece detail `/repertuvar/[id]`
Mock: `mock-admin-375-*-part2`.
- **Hero** (§0.6): with a portal MIDI for my part, primary `h-14 w-full rounded-full`, `Play` icon, **`Partisyonumu çal (Alto)`**. It expands the player under the hero, preferring my part's file, else Tutti with my part's track. `text-xs text-muted-foreground` under it: **`Drive'daki partisyon kaydı aşağıda, "Partisyon kaydı" altında.`**
- **Section** eyebrow **`MIDI`**, placed **first** among the link groups (above `NOTA`). It follows `?partisyon=` like the others: Tutti plus my part, or all with `tumu`.
- **Rows** in `ul.divide-y.rounded-2xl.border.bg-card`, `li px-4 py-2.5 space-y-2.5`. Top line `flex items-center gap-3`:
  - `FileMusic size-5 text-muted-foreground`
  - label `font-medium` (`MIDI · Tutti` / `MIDI · Alto` / the custom `Alto önde`)
  - `text-xs text-muted-foreground` meta: **`Tutti · 4 ses`** (from the parsed tracks, after the first play) or just the part
  - `Button variant="outline" h-11 rounded-full px-3.5`, `Play` icon, **`Çal`** (`Pause`/**`Duraklat`** while it's this row's player)
  - `size-11` ghost `Download` icon (`aria-label="İndir: MIDI · Tutti"`)
- The open player renders inside the `li` below the top line.
- **No MIDI for the filter:** the section isn't rendered (same as empty link groups today).

### 9.2 Player (`MidiPlayer`, `data-state="idle|loading|playing|paused|error"`)
Panel `rounded-2xl bg-muted p-3 space-y-3`:
1. **Controls row:**
   - play/pause `size-12 rounded-full bg-primary text-primary-foreground`, `aria-label` `Çal` / `Duraklat`
   - `size-11` ghost `RotateCcw` (`aria-label="Başa dön"`)
   - right: `text-sm tabular-nums` **`0:12 / 2:45`**
2. **Seek:** native range, `h-11` hit area, `aria-label="Konum"`, `aria-valuetext="0:12 / 2:45"`.
3. **Tempo:** `role="radiogroup" aria-label="Hız"`, a label `text-xs text-muted-foreground` **`Hız`** and three chips `min-h-11 min-w-14 rounded-full`: **`%50`** · **`%75`** · **`%100`** (active: `bg-primary text-primary-foreground`). The position text shows score time, not wall time, so `%50` makes it advance at half speed (AC 51).
4. **Voices** (only when > 1 track has notes): label **`Sesler`**, then toggle chips (`role="checkbox"`, `aria-checked`, `data-muted`), `min-h-11 rounded-full border px-3 text-sm`:
   - on: `bg-secondary` + `Check`
   - muted: `text-muted-foreground line-through` + `Circle`

   A `PartDot` appears when the track name matches `Soprano|Alto|Tenor|Bas(s)?` (case- and Turkish-insensitive). Otherwise the chip shows the file's track name, else **`Kanal 3`**.
   - **Quick chips** (only when one track matches my part): ghost `text-primary min-h-11` **`Yalnız Alto`** (mutes the others) · **`Alto'suz (sen söyle)`** (mutes mine). This is the two things singers actually do with a Tutti file, without four taps.
5. **Hint:** `text-xs text-muted-foreground`, `BellOff size-3.5`, **`Ses gelmiyorsa telefonun sessiz modunu kapat.`**

States:
- **Loading** (chunk + file): the play button shows a spinner, and the position reads **`Yükleniyor…`**.
- **Error:** `text-sm text-absent-ink` **`MIDI dosyası açılamadı. İndir ile telefonuna kaydedebilirsin.`**
- **One player at a time:** starting another stops the first, and that row's button goes back to `Çal`. The panel stays open, paused, with the position kept.
- **Compact mode** (homework step 1): rows 1–3 shown; `Sesler` sits behind a `details` **`Sesler`**.

### 9.3 Edit page `/repertuvar/[id]/duzenle`: `MIDI dosyaları`
Mock: `mock-admin-*-part2..3`. Placed after `Bağlantılar` and before `Bağlantı ekle`, with the same section style: h2 `text-2xl` **`MIDI dosyaları`** + count.
- **List rows** `min-h-15 px-4 flex items-center gap-3`:
  - `FileMusic`
  - label `font-medium`
  - `text-xs text-muted-foreground` **`Alto · 41 KB`**
  - `MoreHorizontal` menu: **`Çal`** (opens the player under the row, so a manager can check the upload), **`İndir`**, **`Sil`** (destructive)
- **Delete:** `ConfirmDialog` title **`"Alto önde" silinsin mi?`**, body **`Dosya portaldan silinir. Drive'daki asıl dosyan etkilenmez.`**, buttons `Vazgeç` / `Sil`. Toast **`MIDI dosyası silindi.`**
- **`MIDI ekle` card** (`rounded-2xl border bg-card p-4 space-y-4`, h3 `MIDI ekle`):
  - **Drop zone** `rounded-2xl border border-dashed p-4 text-center`: outline `h-11` `Upload` **`Dosya seç (.mid)`** (`input type="file" accept=".mid,.midi,audio/midi" multiple`) and `text-xs` **`Birden çok dosya seçebilirsin. Her biri en fazla 1 MB.`**
  - **Per chosen file**, a block:
    - `text-sm font-medium` file name + `text-xs` size
    - `Partisyon` toggle chips (`Tutti` · S · A · T · B, single choice), **pre-selected from the file name**: `sop|soprano` → S, `alt|alto` → A, `ten|tenor` → T, `bas|bass` → B, else Tutti. Under them, `text-xs` **`Partisyonu dosya adından tahmin ettik; yanlışsa değiştir.`**
    - `Input` **`Etiket`** (optional), placeholder `ör. Alto önde`, help **`Boş bırakırsan "MIDI · Alto" yazar.`**
    - ghost `X` **`Çıkar`**
  - **Submit:** primary `h-12` **`Yükle`** / **`3 dosyayı yükle`**. Files upload one after another, each showing `Yükleniyor… 2/3`. Toast **`3 MIDI dosyası eklendi.`**
  - **Errors** per file block, `text-sm text-absent-ink`, with the PO copy (`Bu bir MIDI dosyası değil (.mid).` · `MIDI dosyası en fazla 1 MB olabilir.` · `Bir esere en fazla 20 MIDI dosyası eklenebilir.` · `Etiket en fazla 60 karakter olabilir.` · `Dosya alanı dolu; yeni dosya yüklenemiyor.`). The good files still upload.
  - **@ui:** multiple selection is the one addition (the conductor has Tutti + 4 parts per piece, so it's 5 forms otherwise). If it's costly, ship single-file with the same block and keep the name guess.

### 9.4 Homework step 1
§1. The `MIDI'yi çal` button plays my part's file, else Tutti (AC 53). The player opens in compact mode under it. The recorder hint about headphones is in §2.1.

## 10. `/odevler/depolama` (managers)

Mock: `mock-admin-375-*-part1..2`.
- `BackLink` **`Ödevler`**, h1 **`Depolama`**, sub **`Ücretsiz dosya alanının ne kadarını kullanıyoruz.`**
- **Banner** at ≥ 80% / ≥ 95% (same as §3), plus for the conductor: **`Yorumlanmış eski kayıtları silerek yer açabilirsin.`** (links to `#yer-ac`).
- **Not configured:** in place of the meters, a muted card **`Dosya deposu bağlı değil.`** / `Kayıt yükleme ve MIDI kapalı. Teknik sorumluya haber ver.`
- **Four meter cards** (`grid gap-3 md:grid-cols-2`), each `Card p-4 space-y-2.5`:
  - Top: `flex justify-between`. On the left, name `font-medium` (**`Depolama`** · **`Yükleme`** · **`Aktarım`** · **`Okuma`**) with the help `text-xs text-muted-foreground` (**`Saklanan kayıtlar ve MIDI dosyaları`** · **`Son 30 gün`** · **`Son 30 gün, tahmini`** · **`Son 30 gün`**). On the right, `font-heading text-xl tabular-nums` **`%82`**.
  - Bar: `role="meter" aria-valuemin=0 aria-valuemax=100 aria-valuenow=82 aria-valuetext="820 MB / 1 GB, yüzde 82"`, `h-2.5 rounded-full bg-muted`, fill `bg-primary` (< 80), `bg-late` (80–94), `bg-absent` (≥ 95).
  - Bottom: `flex justify-between text-sm tabular-nums`, **`820 MB / 1 GB`** and a state word (the non-colour cue): **`Sorun yok`** (`text-muted-foreground`) · **`Dolmak üzere`** (`text-late-ink font-medium`) · **`Dolu: yükleme kapalı`** / **`Dolu: dinleme kapalı`** (`text-absent-ink font-medium`).
  - The `Depolama` card adds `text-xs text-muted-foreground` **`Kayıtlar 802 MB (468 dosya) · MIDI 18 MB (64 dosya)`**.
  - Number formats are tr-TR (`Intl.NumberFormat("tr-TR")`): `1,2 GB`, `2.000 işlem`, `%82`. MB/GB are base-1000 (as Vercel counts).
- **Lines below** (`text-sm text-muted-foreground space-y-1`), the PO's D19 sentences:
  - `Kayıtlar şef yorumundan 90 gün sonra, yorumsuz kayıtlar yüklendikten 120 gün sonra kendiliğinden silinir.`
  - `Son temizlik: 21 Eki 08:00 · 3 dosya silindi` (none yet: **`Henüz temizlik yapılmadı.`**)
  - `text-xs`: `Sayılar portalın kendi kayıtlarından hesaplanır; Vercel panelindeki değerlerle küçük farklar olabilir.`
- **Conductor only: `section#yer-ac`** card, h2 **`Yer aç`**, body `text-sm` **`Yorumu 30 günden eski olan kayıtların ses dosyalarını şimdi sil: 14 kayıt, 22 MB. Yorumlar ve notlar kalır.`**, then `Button variant="outline" h-12 w-full md:w-auto text-absent-ink` **`Şimdi sil`**.
  - The PO's single sentence is too long for a 343 px button. The accessible name is the PO string (AC 48) via `aria-label`.
  - n = 0: the button is disabled, and the body reads **`Yorumu 30 günden eski kayıt yok.`**
  - Confirm: **`14 kaydın ses dosyası silinsin mi?`** / **`Koristler bu kayıtları artık dinleyemez. Yorumlar ve notlar kalır. Bu işlem geri alınamaz.`** / `Vazgeç` / `Sil`. Toast **`14 ses dosyası silindi.`**

## 11. Badges

- **Conductor's `Ödevler` tab and sidebar entry:** `data-review-badge={n}`, with the same visual as the homework badge (Phase 4 §1: `bg-primary text-primary-foreground ring-2 ring-background`, `9+`) and the accessible text `, {n} kayıt asistan notuyla bekliyor`. The conductor has no homework badge, so there's never two on one icon.
- **A board member who is an assistant** keeps only the homework badge (D14).
- **No new tab.** The manager bar stays `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim` (Phase 8 D22). Note: the live dev server still shows `Üyeler` as the fifth tab, since Phase 8 is mid-change.

## 12. Errors and toasts (summary)

| Where | Copy |
|---|---|
| Upload ok | toast `Kaydın gönderildi.` |
| Replace ok | toast `Kaydın değiştirildi.` |
| Singer delete | toast `Kaydın silindi.` |
| Comment lock | `Şef yorum yazdı; kaydını artık değiştiremezsin.` |
| 5 uploads | `Bu ödeve en fazla 5 kez kayıt yükleyebilirsin.` |
| Not my part | `Bu işlem için yetkin yok.` |
| Upload put fault | §2.7 |
| Offline | §2.7 |
| Note saved / deleted | `Notun kaydedildi.` / `Notun silindi.` |
| Note after comment | `Şef yorumunu gönderdi; artık not eklenemez.` |
| Comment sent / updated / deleted | `Yorum gönderildi.` / `Yorum güncellendi.` / `Yorum silindi.` |
| Board writing feedback | `Geri bildirimi yalnızca şef yazar.` |
| Playback | `Kayıt şu an açılamıyor. Biraz sonra tekrar dene.` |
| Transfer guard | `Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).` |
| Generic | `Bir sorun oldu. Tekrar dene.` |

Inline errors go in the recorder box. Server-action errors use `toast.error`, as in Phase 4 §9.

## 13. Light and dark, tokens

**No new tokens.** Every state maps to an existing pair:

| Use | Classes | Light / dark check (mocks) |
|---|---|---|
| Recording ring, dot, `Durdur` | `ring-absent`, `bg-absent text-absent-foreground` | light: white on coral; dark: `--absent-foreground` = background, dark ink on coral, readable (`mock-recorder-375-dark-part2`) |
| Level bars, progress, play buttons | `bg-primary` | indigo / gold |
| Warnings (permission, too loud, 80%) | `bg-late/10 border-late/40 text-late-ink` | Phase 4 banner pair |
| Failure, 95% | `bg-absent/10 border-absent/40 text-absent-ink` | soft, never solid with white text (Phase 4 §10 dark issue avoided) |
| Success boxes (`Yorum gönderildi`) | `bg-present/10 border-present/40 text-present-ink` | — |
| `Yeni kayıt`, `n asistan notu` tags | `bg-primary/12 text-primary` | — |
| `Önceki kayda yazıldı`, `Geç` | `bg-late/18 text-late-ink` | — |
| Assistant note cards | `bg-muted/60 border` | — |
| Meter fills | `bg-primary` / `bg-late` / `bg-absent` + a state word | — |

- Sticky player and sticky `Dinlemeye başla` use `bg-background`, not transparent, so the content doesn't show through.
- The `Şefin notu` card keeps Phase 4's `border-gold bg-gold/10`.

## 14. Accessibility checklist (AC 57)

- Recorder root: `role="group" aria-labelledby` the step title. State changes announce through one `aria-live="polite"` region (`Kayıt başladı.`, `1 dakika kaldı.`, `Kayıt durdu, 1:32.`, `Gönderiliyor.`, `Kaydın gönderildi.`, and the errors). The countdown digit is `aria-hidden`.
- Accessible names: `Kaydı durdur`, `Kaydını dinle`, `Kaydı dinle` (review), `Başa dön`, `Konum`, `İndir: {etiket}`, `Kaydını yap: {başlık}`.
- After an action, focus moves:
  - `Durdur` → the player's play button
  - `Gönder` success → the sent row heading
  - errors → the error box (`tabIndex=-1`)
  - `Yoruma ekle` → the textarea
- Every coloured state has a word or an icon next to it: the meters, the tags, and the recording state (`Kaydediliyor`).
- `prefers-reduced-motion`: no pulse, a single-bar meter, no animated countdown scale.

## 15. Notes for the e2e (for whoever writes `phase9-*.mjs`)

Test hooks the design adds: `data-state` on `Recorder`, `AudioPlayer` and `MidiPlayer`; `data-review-badge`; `data-muted` on voice chips; `role="meter"` on the gauges.

Copy that matters for the ACs:
- `Kaydın gönderildi · <tarih> <saat> · 0:0x` is one text node line (AC 7).
- The AC 17 sentence is in the DOM as the `sr-only` description.
- The D11 sentences are in the DOM inside the `details`.
- The early-clean button's accessible name is the PO string (AC 48).
