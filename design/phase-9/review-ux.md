# Phase 9 review: UX, UI quality, accessibility, Turkish copy

Reviewer: arkhe-ux-designer. Date: 2026-10-21. Under the lighter process I am one of the two reviewers. Inputs: `ux.md`, `po-decisions.md` (D31–D63), and `implementation-notes.md` (the UI section: deviations and what was not built).

## How I checked

- Dev server 127.0.0.1:3100, Playwright with real Chrome.
- Widths: 375 px phone context (DPR 2, touch) and 1280 px desktop, light and dark via `colorScheme`.
- Logins: korist@, asistan@, sef@, yk@.
- Microphone: Chrome's fake-media flags plus `e2e/media.mjs` `fakeMic()`. `getUserMedia` hangs on this Mac, the same as the UI engineer saw.
- Microphone errors: an injected `getUserMedia` that throws `NotAllowedError`, `NotFoundError` or `NotReadableError`, with iPhone and Android user agents. "Unsupported" was tested with `MediaRecorder` removed.
- Screenshots: `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/p9review-ux/`. That folder has about 150 PNGs, and the scripts are in `scripts/`.
- Horizontal overflow was 0 px on every screen at both widths.

**Flows exercised:**
- **Homework detail (singer):** the two-step card, `MIDI'yi çal` (compact player) and the full recorder.
  - States reached: idle → countdown → recording → recorded → uploading → sent → `Değiştir` → `Vazgeç` → `Sil` (confirm) → idle.
  - Also checked: the fallback disclosure open; a wrong file type picked, previewed and refused by the server; the locked/gone state on E.
  - Run 3 times: 375 light, 375 dark, 1280 light.
- **Microphone problems:** denied (iOS plus `Tekrar dene`; Android), not found, busy, unsupported.
- **Piece page:** `Partisyonumu çal (Alto)`, the Tutti row player, tempo chips, voice toggles, `Yalnız Alto`, and `?cal=1`.
- **Assistant:** home card, `/odevler` pill, the queue (both chips) and the review page.
  - Note: typed, then `Sonraki`, which raised the dirty guard. Then `Kal` → `Kaydet` → `Güncelle` state → `Notu sil` (confirm).
- **Conductor:** home card, `/odevler` header and `Ayarlar` menu, the queue (3 chips) and the review page.
  - Comment: `Yoruma ekle` → `Yorumu gönder` (success box) → `Yorumu sil` (confirm).
  - Also checked: the roster, `/odevler/asistanlar` and its add sheet, `/odevler/depolama`, and the piece edit page.
  - MIDI on the edit page: a `…-Tenor.mid` was uploaded with the name guess and then deleted; a non-MIDI file was refused.
- **Board:** `/odevler` header and `Ayarlar` (2 items), `/odevler/depolama` without `Yer aç`, the roster sheet, and `Teslimi kaldır` on a row with a take.
- **Badges:** the conductor's `Ödevler` shows `1` (assistant-noted), and the singer's shows `4` (homework).

**Cleanup:**
- My 3 test takes on korist@/A were each deleted through `Sil` in the UI. Their 3 withdrawn `recordings` rows and the 4 `done` `storage_deletions` rows (3 takes plus the test MIDI) were then removed, so korist@'s 5-upload counter is back to 0.
- The test MIDI was deleted in the UI.
- My note and comment were deleted in the UI. Ayşe's D submission has `feedback` null and `delete_on` back to upload + 120.
- `db:check`: `orphaned rows=0, quick_check=ok`.
- Left behind: the anonymous `storage_events` `put`/`get` counters (no keys, no user), which feed the `Yükleme`/`Okuma` meters.

**Not tested here:**
- Real iOS and Android permission sheets. The go-live check in ux §2.3 still stands.
- The 10-minute auto-stop and the last-minute amber state (`data-max-ms` hook).
- The quota-paused and storage-fault states. The e2e covers these.

## Summary

| Rank | Count |
|---|---|
| P1 | 1 |
| P2 | 9 |
| P3 | 14 |

Overall, the singer flow is good. There is one primary per state, the count-in works, and the mic-denied help is concrete and platform-specific in plain Turkish. The upload, replace and delete loop is clear, and the conductor and assistant loops are a tap or two per item. Both themes hold, including the coral `Durdur` with dark ink in dark mode.

The one blocker is the manager roster at 375 px.

---

## P1

### P1-1. The roster hides singers' names once they have a take (conductor and board, 375 px)
`src/components/homework/roster.tsx:170–231`.

Each row is a `flex` of two siblings:
- the sheet `button`: name + state chip + note icon
- the `Kayıt · 0:03 ›` link (conductor) or span (board)

The chip, the icon and the take cell are all `shrink-0`, so only the `truncate` name shrinks. At 375 px the name is cut to one glyph or a few letters plus an ellipsis: `I`, `ı`, `N` for the conductor, and `De…`, `Ay…`, `M…`, `Na…` for the board.

These are exactly the rows that matter this phase. The conductor can't tell whose take he is opening, and the board can't tell who submitted. Screenshots: `roster-zoom-sef-375.png`, `roster-zoom-yk-375.png`, `sef-roster-375-light.png`. At 1280 the names show in full.

The conductor row is also split into two tap targets with a vertical divider:
- left: the Phase 4 sheet
- right: the review page

ux §5 asked for one row link.

**Fix:**
- Move the take info onto the name's second line, inside the existing `span.min-w-0.flex-1`. Use `<span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums"><AudioLines className="size-3.5"/>Kayıt · 0:03</span>`, next to the `şef işaretledi` line, which already lives there.
- Conductor, row with a take or a submission: make the whole `li` content one `Link` to `/odevler/<id>/dinle/<userId>`, with a trailing `ChevronRight`, as ux §5 specifies. The manual-mark toggle is then reached on the review page or for rows without a submission. If the Phase 4 sheet must stay reachable for these rows, keep the right cell icon-only: `size-11`, `ChevronRight`, `aria-label="{Ad}: kaydı dinle"`. No text, about 44 px instead of about 120 px.
- Board: the plain-text take line goes to the second line as above. The row stays one sheet button.
- Acceptance: at 375 px, `Nazlı Koç` with `Geç teslim 20 Eki` and a take shows the full name. Add this to the layout probe in `e2e/media.mjs` `layoutIssues`, for example "no `truncate` element narrower than 64 px".

---

## P2

### P2-1. The dirty-text guard makes the data-losing choice the primary button
`src/components/review/review-guard.tsx:24–28`.

`Geç` is `variant: "default"` (filled indigo/gold), and `Kal` is the outline cancel. The body reads `Yazdıkların kaybolur.` A tired conductor 30 takes into the loop taps the big button and loses the comment. D41 says that is the one thing that would send him back to email. Screenshot: `asistan-dirty-375-light.png`.

**Fix:**
- Make `Kal` the filled primary.
- Make `Geç` `variant="outline"` with `text-absent-ink`. That matches the MIDI delete dialog, where `Sil` is soft-destructive and `Vazgeç` is outline.
- Initial focus goes on `Kal`.
- Copy is unchanged.

### P2-2. A refused file leaves `Gönder` as the primary, which sends the same bad file again
`recorder.tsx:332–337` (the `type`/`size`/`empty` cases return to `preview`) and `previewView()` at `:696–730`.

After `Bu dosya bir ses kaydı değil ya da türü desteklenmiyor…`, the card still shows a full-width filled `Gönder`, with `Başka dosya seç` as outline. Retrying can only fail again. Screenshots: `rec-11-wrongtype-375-{light,dark}.png`.

**Fix:** when `inlineError` comes from a `type`/`size`/`empty` refusal:
- hide `Gönder`
- render `Başka dosya seç` (or `Yeniden kaydet` for a recorded take) as the primary `h-14`
- keep the player, so the singer can hear what they picked

As an optional extra in the same place: if `fileDuration()` returned `null` *and* `<audio>` fired `error`, show the same box at pick time instead of a `Kaydın hazır` preview with `0:00 / —`.

### P2-3. The board is offered `Teslimi kaldır` on a row with a live take, which always fails
`roster.tsx:265`. D47 refuses this server-side. Tapping it shows the error toast `Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil.`, but the board cannot delete takes (D48 is conductor-only), so the action is a dead end for them. Screenshots: `yk-sheet-375-light.png`, `yk-unmark-refused.png`.

**Fix:** in the sheet, when `row.take && !row.take.audioDeleted`:
- render the button `disabled`
- show the help line `text-xs text-muted-foreground` **`Portalda kaydı olduğu için teslim kaldırılamaz. Gerekirse şefe haber ver.`**
- conductor: show **`Portalda kaydı olduğu için teslim kaldırılamaz; önce kaydı sil.`** with a link **`Kayda git`** → the review page

### P2-4. `Yorum bekleyen` counts submissions with no recording as "kayıt"
These places:
- `review/home-card.tsx:19` (`19 kayıt yorum bekliyor`)
- the `/odevler` pill `Dinleme 19`
- the queue's `Dinlemeye başla (19)`

The queue on a fresh seed is 19 rows, and 12 of them are `Portalda kayıt yok` (`sef-queue-1280-light.png`). The conductor reads "19 recordings to listen to". `Dinlemeye başla` then walks him through 12 pages with no audio before he finishes the real ones, and the `Ödevler` tab badge says `1` at the same time. "Kayıt" in this app means an audio recording.

**Fix:**
- Home card body: **`{n} kayıt dinlenmeyi bekliyor · {k} asistan notlu`**, where n counts only rows with live audio. When manual or email submissions also wait, add a second line: `text-xs text-muted-foreground` **`{m} teslimde portalda kayıt yok.`**
- Queue: inside each homework group, sort rows with audio first and `Portalda kayıt yok` rows last.
- `Dinlemeye başla ({n})` and `Sonraki` walk audio rows first. The pill keeps the full number, which is the D60 contract, or switches to n; PO's call.
- No schema change. It is a sort key and a count in `src/lib/review/queries.ts`.

### P2-5. `Alto'suz` builds a wrong Turkish word for every part
`src/components/midi/midi-player.tsx:231`: `{VOICE_PART_LABELS[myPart]}'suz (sen söyle)`.
- Voice-part names are common nouns, so they take no apostrophe.
- The suffix follows vowel harmony.
- So the generated `Bas'suz` is wrong twice; the correct word is `Bassız`.

**Fix:** use a map in `src/lib/labels.ts`:

| Part | Chip text |
|---|---|
| Soprano | `Sopranosuz` |
| Alto | `Altosuz` |
| Tenor | `Tenorsuz` |
| Bas | `Bassız` |

The chip reads **`Altosuz (sen söyle)`**. `Yalnız Alto` is correct as is.

### P2-6. The recording ring cuts through the status row
`recorder.tsx:976` puts `ring-2 ring-absent ring-offset-4 ring-offset-card` on a root with no padding. The ring is drawn 4 px outside the content, so it runs into the card's inner gutter, and its rounded corners clip:
- the red dot of `Kaydediliyor`
- the last letter of `10:00'da kendiliğinden durur`

Seen at 375 in both themes (`rec-03-recording-375-dark.png`).

**Fix:**
- While recording, give the root `p-3` and drop the offset: `recording && "p-3 ring-2 ring-absent"`, with `rounded-2xl` already on the root.
- Shorten the right-hand label to **`10:00'da durur`**, so the row never wraps at 343 px.

### P2-7. The microphone steps are `aria-hidden`, so VoiceOver users get only the generic sentence
`recorder.tsx:538`: `<div className="space-y-1.5" aria-hidden>{steps[os]}</div>`. A screen-reader user hears the title and `DENIED_A11Y` ("Tarayıcı ayarlarından izin ver…"). They never hear the concrete `aA → Web Sitesi Ayarları → Mikrofon → İzin Ver` steps, which are the useful part. Hiding visible instructions from assistive technology also fails WCAG 1.3.1.

**Fix:**
- Remove `aria-hidden` from the steps.
- Keep the AC 17 sentence in the DOM as the sr-only text, but don't wire it as `aria-describedby` of the alert. Otherwise the alert reads the same thing twice.

The live region also still says `Kayıt 3 saniye sonra başlıyor.` after the error, because `startRecording()` announces before permission is known; see P3-3.

### P2-8. Singers see three words for the conductor's feedback
On one screen the singer reads:
- `Şefin notu` (card title, `odevler/[id]/page.tsx:227`)
- `Şefin yorumu gelince burada görünür; Ödevler'de "Yeni not" işareti çıkar.` (`recorder.tsx:868`)
- `Şef yorum yazdı; kaydın artık değişmez. … şefin notu kalır.` (`:860`)

Assistants write `Not`, which never reaches the singer, and the conductor writes `Yorumun`. Mixing `not` and `yorum` makes a non-technical singer wonder whether these are two different things. That is the very confusion D11 tries to prevent ("asistan notları sana gelmez").

**Fix:** for the singer, the conductor's text is always **yorum**:
- card eyebrow **`Şefin yorumu`** (keep `Geri bildirim` for legacy board notes)
- list tag **`Yeni yorum`** (`homework-rows.tsx:19`)
- sent-state hint **`Şefin yorumu gelince burada görünür; Ödevler'de “Yeni yorum” işareti çıkar.`**, with typographic quotes
- locked line **`… Ses dosyası 19 Oca 2027'de silinir; şefin yorumu kalır.`**

`Not` stays for assistants only. This touches Phase 4 copy, so the Phase 4 e2e strings go on the D30 list.

### P2-9. The roster sheet's button label for the conductor says `Not yaz`
`roster.tsx:174` gives the conductor's sheet button `aria-label` `{Ad}: {durum}. Not yaz`. For the conductor it is `Yorum` now (D63), and the sheet's primary path is `Dinle ve yorum yaz`.

**Fix:** use `aria-label` **`{Ad}: {durum}. Yorum yaz`**, which goes away anyway if P1-1 turns the conductor row into one link.

---

## P3

1. **`Kayda başla` sits below the fold on the bare detail URL.**
   - At 375×812 the button's top is at about 812 px, under the tab bar. On an iPhone SE (667 px) it is a full screen further down.
   - The `#kayit` deep link from the list and the home card fixes this, so it only hits people who open the bare URL (push or WhatsApp links).
   - **Fix:** in the header meta row, when unsubmitted, add an `a href="#kayit"` text link **`Kaydını yap ↓`** (`min-h-11 text-primary`). Alternatively, make shared links use `#kayit`.
2. **The headphone hint shows when the browser can't record.** `Kulaklık takarsan MIDI'yi dinlerken kayıt yapabilirsin.` (`recorder.tsx:433`) appears above `Bu tarayıcı kayıt yapamıyor`. Render it only when `supported`.
3. **Live region order.** `Kayıt 3 saniye sonra başlıyor.` is announced at the tap, before permission. Announce it when `rec.phase` becomes `countdown`. On `onProblem`, set `announce` to the mic title.
4. **`3/5 yükleme` is cryptic, and it shows with no current take.** After two deletions, the idle card says `3/5 yükleme` (`unsupported` and replace screenshots).
   - **Fix:** use **`5 yükleme hakkından {n} tanesini kullandın.`**
   - With no live take, add: **`Silinen kayıtlar da sayılır.`**
5. **The mic-problem box says `Dosya yükle'yi kullan` when uploads are paused.** `recorder.tsx:578` renders without the `blocked` check that the button has. Hide the line when `blocked`, or use **`Ya da telefonundaki ses kaydediciyle kaydet ve şefe başka yolla gönder.`**
6. **The failed view always says `Yeniden kaydet`** (`:795–803`), even for a picked file. Use `Başka dosya seç` when `local.source === "file"`, as in the preview.
7. **Double play controls in the MIDI player.** When open, the trigger itself turns into `Duraklat`, and the panel has its own pause button. This happens on the homework, the hero and each row (`rec-01-midi-375-light.png`, `midi-hero-375-light.png`, `midi-tutti-375-dark.png`). Two identical controls stacked 60 px apart.
   - **Fix:** once the panel is open, the trigger becomes a collapse control. Use **`Kapat`** with a `ChevronUp` icon (outline), or for the row button just `Çal`/`Kapat`. Play/pause lives only in the panel.
8. **The MIDI row meta repeats the label.** It shows `MIDI · Tutti` / `Tutti`, and `MIDI · Alto` / `Alto` (`midi-list.tsx`). ux §9.1 asked for **`Tutti · 4 ses`** once parsed; until the first play, show nothing. Multi-file upload and the `· MIDI` breakdown are acknowledged as unbuilt; fine.
9. **`Yalnız Alto` / `Altosuz` give no state.** After a tap, only the four chips show the result. Give them `aria-pressed` and `bg-primary/12` while the mute set equals that preset.
10. **The piece-page hint names a section that doesn't exist.** `repertuvar/[id]/page.tsx:142` says `"Partisyon kaydı" altında`, but the eyebrow is `PARTİSYON KAYITLARI`.
    - **Fix:** use **`Drive'daki partisyon kaydı aşağıda, “Partisyon kayıtları” bölümünde.`**, with typographic quotes.
    - Same quote fix in `midi-editor.tsx` (`Boş bırakırsan “MIDI · Tenor” yazar.`).
11. **The `Partisyonumu aç` accessible name doubles the part.** It reads `Partisyonumu aç (Alto) (Alto): Ave Verum Corpus, yeni sekmede açılır`, from `part-button.tsx:66–69`, which appends `({part})` after a text that already has it. For `hero || asLink`, the sr-only text should be just **`: {title}, yeni sekmede açılır`**. This is pre-existing from Phase 3, made visible again by the text-link variant.
12. **The review footer loses its meaning after a save.** `2 / 3 · Dinlenecek` becomes `2 kayıt · Dinlenecek` once the item leaves the list (`odevler/[id]/dinle/[userId]/page.tsx:187`). Use **`{n} kayıt kaldı · Dinlenecek`**, or for 0, the existing `Bu listede başka kayıt yok.`
13. **Small copy and visual items:**
    - Depolama cards print the percentage twice (`%0` top right and `· %0` in the bottom line, `meter.tsx:48` and `:68`). Drop the bottom one.
    - Unknown duration renders as `— · 21 Eki 23:16` in the queue. Omit the duration when null.
    - `Yükle` on the MIDI editor is enabled before a file is chosen. Make it `disabled` until a file is chosen.
    - The asistan sheet autofocuses `İsim ara`. On a phone the keyboard covers the part chips and `Ekle`. Don't autofocus below `md`.
    - `Eklendi` stays after `Yorumu sil` empties the box. Reset `added` when the comment is deleted.
    - The `MIDI dosyaları` section sits after `Toplu bağlantı ekle`. ux §9.3 put it after the link list and before `Bağlantı ekle`. Acceptable; move it if cheap.
14. **Latin titles uppercased with Turkish rules.** Eyebrows render `SİCUT CERVUS` (dotted İ) because the page is `lang="tr"` with `uppercase`. Wrap the piece title in the eyebrow in `<span lang="la">`, or use `lang="und"` for titles. This is a pre-existing pattern, now more visible on the review page.

---

## What is good (keep)

- **One primary per state, as designed.**
  - `Kayda başla` → `Durdur` (coral, dark ink in dark mode, readable) → `Gönder` → sent, with `Değiştir` outline and `Sil` ghost.
  - The silent count-in with a grey meter answers "does the mic hear me?" before the take.
- **Microphone help copy is plain and platform-correct.**
  - iPhone: `aA → Web Sitesi Ayarları → Mikrofon → İzin Ver`, the home-screen-app line, and `Sayfayı yenile` after a second failure.
  - Android: the left-icon path.
  - `Başka bir telefon mu?` for the rest.
  - The `nomic`, `busy` and `unsupported` texts are clear, with an always-present `Dosya yükle` escape.
  - Still verify the iOS 18 menu names on a real phone (ux §2.3).
- **Transparency:** `Kaydını şef ve dinleme asistanı Demo Asistan dinler.` plus a 44 px `Kimler görür, ne zaman silinir?` (D62 met).
- **Review loops:**
  - Assistant: save stays on the page with `Notun kaydedildi.` and `Güncelle` / `Notu sil`.
  - Conductor: `Yoruma ekle` → `Eklendi`, the `Yorum gönderildi. Bu kayıt 19 Oca 2027 tarihinde silinecek.` box, and `Güncelle` / `Yorumu sil`.
  - Both: a sticky `bg-background` player.
- **Settings and storage:**
  - The `/odevler` header with the `Ayarlar` menu works at 375: three items for the conductor, two for the board.
  - The Depolama meters have state words (`Sorun yok`) beside the colour.
  - The board sees no `Yer aç`.
- **MIDI:** the name guess (`AveVerum-Tenor.mid` → Tenor chip, with `Partisyonu dosya adından tahmin ettik; yanlışsa değiştir.`), the per-file error `Bu bir MIDI dosyası değil (.mid).`, and the delete confirm `Dosya portaldan silinir. Drive'daki asıl dosyan etkilenmez.`
- **Tap targets:** every recorder, player and chip target I measured is ≥ 44 px (radios 44×56, voice chips 44×84+, `Başa dön` 44×44).
- **No new tokens needed.** All fixes above use existing classes. I propose no token changes.
