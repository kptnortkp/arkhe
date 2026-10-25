# Phase 11 spec: score PDF and automatic MIDI (OMR via GitHub Actions)

Author: PO. Date: 2026-10-24. Status: **draft for the build team.** Decisions are in `po-decisions.md` (D91–D118; the user's choices of 2026-10-24 are D113–D118); the spec refers to them as `(Dn)`. Amendments are made in place and marked `(amended Dn)`; ACs are never renumbered.

**Process (fast loop, see STATUS / memory):** no separate role plans. Backend + DB and UI work in parallel against a short `contract.md`; targeted e2e suites during the build, one full `npm run e2e` at the end; two reviewers (security + DB; UI + copy); the tech lead accepts. The real GitHub workflow is verified once by hand at go-live (§9).

Inputs:
- **The user's request of 2026-10-24** ("Faz 11'i planla, github actions ile"): a manager uploads a piece's PDF score; Audiveris in GitHub Actions turns it into MusicXML; music21 splits it into parts and writes MIDI; the result comes back to the portal as a draft; a manager listens and approves; then members see it. While listening to e.g. Bas, a singer can switch the piano and the other voices on and off. Members can also open the PDF itself ("PDF'i de ekleyebilir miyiz").
- **Code read:** `src/db/schema.ts` (`pieces`, `midi_files` and its 0010 trigger comment, `storage_deletions`, `storage_events` with the hand-written 0011 area CHECK), `src/app/(portal)/repertuvar/midi-actions.ts`, `src/lib/repertoire-midi.ts` (`midiForPiece`, `midiForPart`, `midiForExactPart`, `midiCount`), `src/lib/storage/*` (`limits.ts`, `quota.ts`, `ledger.ts`, `sniff.ts`, `sweep.ts`, `files.ts`), `src/app/api/dosya/midi/[id]/route.ts`, `src/components/midi/midi-player.tsx` (`partOf`, presets, `Sesler`), `synth.ts` (`peak = 0.2 + 0.8 * velocity`), `src/lib/push/morning.ts` (the repertoire line counts `midi_files.created_at`), `src/lib/push/groups.ts`, `vercel.json` (one cron, `arn1`), `next.config.ts` (server action body limit `1100kb`), `src/proxy.ts` (CSP).
- **The working prototype** (scratchpad `omr/`, 2026-10-23): Audiveris **5.11.0** batch export of the Cumhuriyet Güneşi PDF (4 pages, 93 bars, 2/4, Kadın / Erkek / piano), music21 8.3.0 + mido 1.3.3. Lessons: Audiveris ran with **no OCR languages**, so part names are not read; `fix.py` needed **piece-specific hand fixes** (misread rhythms, a lost sharp, an empty bar, wrong clef); mido wrote `Kadin` because its default meta charset is Latin-1.

Fixed constraints (not up for discussion):
1. **Zero budget.** GitHub Actions free minutes on the private repo `kptnortkp/arkhe` (2,000 min/month, spending limit $0), Vercel Hobby (60 s functions, no new cron), Turso free, Vercel Blob free (the existing private Stockholm store). No paid OMR or hosting.
2. **AGPL.** Audiveris runs unmodified as a build tool inside CI. We don't distribute it, modify it or offer it as a network service (D93).
3. **Git identity.** Only the personal account `kptnortkp`. The user creates the token and the secrets in the browser; no token is ever pasted into chat, files or logs.
4. **OMR is imperfect.** Every result is a draft. Members never see a draft (D103).
5. **Authorize on the server** everywhere, including the two machine endpoints (HMAC, D98).
6. **e2e only, no real GitHub in e2e.** Outside production a dispatch is a file in `data/omr-outbox/`, and the tests play the workflow's part by calling the real callback endpoints with a correct signature (D105).
7. **Migration `0014` is additive** for every live table with triggers: `midi_files` and `recordings` are never rebuilt (D95).

## 1. Problem

The choir learns from MIDI part files. Today someone with MuseScore skills has to type in or convert each score by hand, so most pieces never get a MIDI, or only a single tutti file where you can't hear your own line. The conductor already has the PDF. If the portal could turn that PDF into a MIDI with one track per voice, every singer could practise at home with "Yalnız Bas", "Bas önde" or "Bassız (sen söyle)", slow it to %75, and switch the piano off. And the PDF itself is one tap away on the piece page instead of somewhere on Drive.

## 2. Users and roles

| Role | In this phase |
|---|---|
| **Manager** (conductor or board) | Uploads, replaces and deletes a piece's PDF; starts a conversion; sees job status and drafts; listens to a draft; publishes or deletes it. |
| **Member** (korist) | Opens and downloads the PDF; plays published MIDI with the improved player (track names, Kadın/Erkek presets, `önde`, piano quieter). Gets a push when an automatic MIDI is published (if `Repertuvar` notifications are on). Never sees drafts or job status. |
| **The workflow** (GitHub Actions) | Fetches the PDF, runs Audiveris + the converter, reports `running`, then a result or a failure. Talks to the portal only through HMAC-signed requests. |

## 3. Flow and copy

Everything in backticks is the exact Turkish text.

**Piece page `/repertuvar/<id>`, all signed-in active users** (when the piece has a PDF): a row in the files area, above `MIDI`:
- `Nota (PDF)` · `{boyut} · {tarih}` with buttons `Aç` (opens inline in a new tab) and `İndir`.

**Editor `/repertuvar/<id>/duzenle`, managers**, a new section `Nota ve otomatik MIDI` above the MIDI editor:
- No PDF yet: file input `PDF seç`, help `En fazla 4 MB, 20 sayfa. Taranmış notada 300 dpi siyah-beyaz en iyi sonucu verir.`, button `Yükle`. Success `Nota yüklendi.`
- With a PDF: `Nota (PDF) · {boyut} · {tarih}` and `Aç`, `Değiştir`, `Sil` (confirm `Nota silinsin mi? Otomatik MIDI'ler kalır.`).
- Errors: `Bu dosya PDF değil.` · `PDF en fazla 4 MB olabilir.` · `Çeviri sürerken nota değiştirilemez.` · the existing quota and storage messages.
- **Convert** (only with a PDF and when configured):
  - `Satır düzeni` (radio, required): `Soprano, Alto, Tenor, Bas ayrı satırlarda` · `Kadın ve Erkek (iki satır)` · `SA ve TB (iki satır, her satırda iki ses)` · `Bilmiyorum (otomatik)`.
  - Checkbox `Altta piyano eşliği var` (on by default).
  - `Tempo (♩ =)` optional number 40–220, help `Boş bırakırsan notadaki tempo, o da yoksa 100.`
  - Button `MIDI'ye çevir`. Help: `Genelde 3–8 dakika sürer. Sayfadan çıkabilirsin. Sonuç burada taslak olarak görünür; sen yayınlayana kadar koristler görmez.`
- **Job status line** (`data-omr-state`):
  - queued: `Sırada…` · running: `Çevriliyor… ({dk} dk)` · succeeded: `Taslak hazır` · failed: `Çeviri başarısız: {sebep}` + button `Yeniden dene` (same PDF, same options).
  - Managers who started it see `{ad} başlattı · {saat}`.
- **Failure reasons** (D102, fixed list; the workflow's free text is never shown):
  - `pdf_unreadable`: `PDF okunamadı. Taranmış bir notaysa daha net bir tarama dene.`
  - `too_many_pages`: `PDF en fazla 20 sayfa olabilir.`
  - `no_music`: `Notada portek bulunamadı.`
  - `layout_mismatch`: `Seçilen düzene uymadı: {beklenen} ses satırı bekleniyordu, {bulunan} bulundu. Düzeni değiştirip yeniden dene.`
  - `output_invalid`: `Çeviri sonucu kullanılamadı. Yeniden dene; olmazsa MIDI'yi elle yükle.`
  - `not_started`: `GitHub işi başlamadı. Biraz sonra yeniden dene.`
  - `timeout`: `Çeviri 45 dakikada bitmedi. Yeniden dene.`
  - `dispatch_auth` (amended review-fixes): `GitHub bağlantısı reddedildi; erişim anahtarının süresi dolmuş olabilir. Portalı kuran kişiye haber ver.`
  - `storage_full` (added review-fixes, portal-side; the result arrived while uploads are paused): `Dosya alanı dolu olduğu için sonuç kaydedilemedi. Yer açılınca yeniden dene.`
  - `dispatch_failed`: `GitHub'a ulaşılamadı. Biraz sonra yeniden dene.`
  - anything else: `Çeviri başarısız oldu. Yeniden dene.`
- **Limits:** `Bu eserde zaten bir çeviri sürüyor.` · `Bugün en fazla 10 çeviri başlatabilirsin.` · `Bu ay için otomatik çeviri sınırı doldu (40). Elle MIDI yükleyebilirsin.`
- **Not configured** (production without the env vars, D105): `Otomatik çeviri kurulmadı. Nota yükleyebilir ve MIDI'yi elle ekleyebilirsin.` PDF upload still works.
- **Draft card** (`data-midi-draft`), managers only, inside the MIDI editor list:
  - Title `Taslak · otomatik çeviri`, line `{n} ses: {adlar} · {ölçü} ölçü · {süre}` (e.g. `3 ses: Kadın, Erkek, Piyano · 93 ölçü · 2:41`).
  - Warning `Otomatik çeviride yanlış nota olabilir. Notayla karşılaştırarak dinle.` with the PDF `Aç` link next to it.
  - `Dinle` opens the normal player. Buttons `Yayınla` and `Sil`.
  - `Yayınla` always confirms (amended review-fixes): title `Yayınlansın mı?`, text `Koristler hemen görür ve bildirim alır.`, plus `Önceki otomatik MIDI silinip yerine bu gelecek.` when a published automatic MIDI already exists.
  - Success `Yayınlandı; koristler artık görüyor.` / `Taslak silindi.`
  - A published automatic file shows `Otomatik · {ad} yayınladı · {tarih}` in the editor list.
- **Two groups, manual and automatic** (D116), on the piece page and in the editor:
  - `MIDI` (manual uploads, exactly as today; the upload form and the `20` cap belong to this group only).
  - `Otomatik oluşturulan` (`data-testid="midi-auto"`): the published automatic file with a small badge `Otomatik` and the line `Nota PDF'inden otomatik oluşturuldu · {tarih}`; in the editor also the draft card and the job status. Members see this group only when a published automatic file exists.
  - Help under the editor's manual group: `Otomatik oluşturulan MIDI elle eklediklerini etkilemez.`

**Player** (`MidiPlayer`, everyone):
- Track chips show proper Turkish names (`Kadın`, `Bas`, `Piyano`).
- Presets under `Sesler`: `Yalnız {ses}` · `{ses} önde` · `{sesSuz} (sen söyle)` (`Sopranosuz`, `Altosuz`, `Tenorsuz`, `Bassız`; for a Kadın/Erkek file the preset names stay the viewer's part, e.g. a soprano sees `Yalnız Soprano` acting on the `Kadın` track).

**Push on publish** (D104 amended by D114, D115), Phase 10 format:

| Kind | When | Who | Title | Body | Morning line | Link | Tag |
|---|---|---|---|---|---|---|---|
| `midi_published` | At once (via `after()`) when a manager publishes an automatic MIDI; held to the morning digest inside 22:00–08:00 for people with `Gece sessiz` on | Every active user with the `repertuvar` group on, minus the publisher | `Yeni MIDI` | `{eser}: çalışma MIDI'si hazır. Kendi sesini seçip dinleyebilirsin.` | `Yeni MIDI: {eser}` | `/repertuvar/{id}` | `midi-{pieceId}` |

Group label becomes `Repertuvar ve yeni MIDI'ler`, **on by default** (D115). Expiry 3 days. Dedupe key `midi_published-{midiId}`.

## 4. Pipeline contract (what the workflow must do)

- Trigger: `workflow_dispatch` only, on `kptnortkp/arkhe`, file `.github/workflows/omr.yml`, inputs `job_id` (uuid), `layout` (`satb` | `kadin_erkek` | `sa_tb` | `auto`), `piano` (`true`/`false`), `tempo` (empty or 40–220). Nothing secret in inputs (D98).
- Steps (sketch; the tech lead owns the file):
  1. Report `running` (with `GITHUB_RUN_ID`).
  2. Fetch the PDF from the portal with a signed GET; refuse non-PDF or > 4 MB.
  3. Install Audiveris **5.11.0** (pinned `.deb` from the official GitHub release, sha256-checked, cached by version; it bundles its Java runtime) and run `audiveris -batch -export -output out/ input.pdf`. Page limit 20 (`too_many_pages`).
  4. Run `omr/convert.py` (adapted from the prototype's `tomidi.py` / `inspect.py`; Python 3.12, `music21` and `mido` pinned in `omr/requirements.txt`):
     - **Vocal staves vs piano:** with `piano=true`, the bottom brace-joined staff pair (or the bottom two staves) is the piano; all other staves are vocal.
     - **Naming by layout:** `satb` needs 4 vocal staves → `Soprano`, `Alto`, `Tenor`, `Bas`. `kadin_erkek` needs 2 → `Kadın`, `Erkek`. `sa_tb` needs 2 and **splits each staff's two voices** (upper/lower, by voice number; a bar with one voice gives that line to both) → `Soprano`, `Alto`, `Tenor`, `Bas`. `auto` names staves from the MusicXML part names when they match a voice, else `Ses 1…n`. A wrong count fails with `layout_mismatch` and the two numbers.
     - Piano staves become **one** track `Piyano`, GM program 0, velocity 64. Voices: GM program 52 (Choir Aahs), velocity 96, one channel each, drums never used.
     - Track names written as **UTF-8** (`mido.MidiFile(charset="utf-8")`).
     - Tempo: the input, else the first metronome mark, else 100. Ties merged; repeats not expanded.
     - Output: **one** type-1 multi-track MIDI ≤ 1 MB with ≤ 16 tracks, plus a summary `{ tracks: [{ name, parts }], measures, durationSec }`. No measure timings (D113).
  5. Post the result (or a failure kind) to the portal, signed. On any failed step an `if: failure()` step posts the kind it knows, else `output_invalid`.
- Hardening: `permissions: contents: read`, `timeout-minutes: 30`, `concurrency: omr-${{ inputs.job_id }}`, third-party actions pinned by commit SHA, no `set -x`, secrets only via `env:`, **no artifacts uploaded** (the PDF stays in Blob only).

## 5. User stories and acceptance criteria

`(e2e)` = proved by Playwright in `e2e/phase11-*.mjs`. `(manual)` = the go-live check in §9. `(static)` = an e2e step that reads a repo file.

### S1. Platform and security

*As the tech lead I want this to add no risk to live data or to the existing media.*

1. **Additive migration** `drizzle/0014_phase11_score_omr.sql` (D95).
   - `midi_files` and `recordings` are not rebuilt; after `db:migrate` the three 0010 queue triggers (`recordings_queue_on_audio_delete`, `recordings_queue_on_delete`, `midi_files_queue_on_delete`) and `recordings_audio_final` still exist, and deleting a MIDI row still queues its key.
   - If `storage_deletions` / `storage_events` must be rebuilt to accept the `score` area, the migration drops and recreates any trigger that names them in the same file, and `db:check` shows `migrations=15/15` with the trigger count unchanged.
   - Existing MIDI rows read as published. (e2e + `db:check`.)
2. **Authorization.** Every score, job and draft action, and the draft list, checks `assertManager()` on the server. A member's direct server-action call or route request (upload, delete, convert, retry, publish, reject, draft download) is refused with no change. Inactive users get nothing. (e2e.)
3. **Machine endpoints (HMAC, D98).** The PDF fetch, status and result endpoints:
   - answer **401** without a signature, with a wrong one, or with a timestamp more than 5 minutes off;
   - answer **404** for an unknown job and **409** for a job not in the expected state (e.g. a result for a `succeeded`, `failed` or timed-out job), changing nothing;
   - replaying an accepted result returns 409 and adds no second draft;
   - work without a session cookie (the proxy lets them through) and never set one;
   - log only the job id, state and error kind: never the signature, secret, token or file bytes. (e2e; log check by review.)
4. **Size and type checks on returned files.** The result body is refused (413) above 2 MB before parsing; the MIDI must pass `checkMidi`, be ≤ 1 MB, have 1–16 tracks with notes, track names 1–40 chars; `measures` an integer 1–2,000. Unknown summary keys are ignored and not stored. (amended D113) Anything else marks the job `failed / output_invalid` and stores nothing. (e2e with crafted bodies.)

### S2. The score PDF

*As a singer I want the score one tap away. As a manager I want to put it there once.*

5. **Upload** (D94). A manager uploads a PDF on `/duzenle`. It's sniffed (`%PDF-` within the first 1,024 bytes and `%%EOF` within the last 1,024), ≤ 4,194,304 bytes, one per piece; `Değiştir` replaces it and queues the old key; `Sil` removes it. A renamed PNG gets `Bu dosya PDF değil.`; a 4 MB + 1 byte file `PDF en fazla 4 MB olabilir.` without being buffered. Uploads count against the Phase 9 upload pause (95%) and a 30/hour per-manager rate. (e2e.)
6. **Members open it.** korist@ sees `Nota (PDF)` on the piece page; `Aç` returns `application/pdf`, `Content-Disposition: inline` with a Turkish-safe filename (`<Eser>-nota.pdf`), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private`; `İndir` returns `attachment`. Signed-out requests get 401. Deliveries count as transfer (area `score`), never toward the recording playback stop, with per-viewer caps like MIDI. A piece without a PDF shows no row. (e2e.)
7. **Storage bookkeeping.** The stored-bytes meter includes the PDF; replacing, deleting the PDF or deleting the piece queues the key in `storage_deletions` (area `score`), and the next sweep deletes it. (e2e, local driver.)
8. **Locked while converting.** While the piece has a `queued` or `running` job, `Değiştir` and `Sil` are refused with `Çeviri sürerken nota değiştirilemez.` (server-side). (e2e.)

### S3. Starting a conversion and following it

*As a manager I want to press one button and come back later to a draft.*

9. **Start** (D96). With a PDF and the feature configured, `MIDI'ye çevir` with a layout creates a job `queued` and dispatches it. Outside production the dispatch writes `data/omr-outbox/<jobId>.json` with exactly `{ ref, inputs: { job_id, layout, piano, tempo } }` and no URL, token or secret. The status line shows `Sırada…`. A missing layout is refused with a field error. (e2e.)
10. **Dispatch errors** (D100). The fault hook makes the GitHub call answer 401/403/404 → job `failed / dispatch_auth`; 5xx or a 10 s timeout → `failed / dispatch_failed`. The page shows the §3 reason and `Yeniden dene`. Nothing else is left behind. (e2e, fault cookie.)
11. **Limits** (D101). A second start on the same piece while one is active is refused (`Bu eserde zaten bir çeviri sürüyor.`, also for two parallel submits). The 11th start by one manager in an Istanbul day and the 41st choir-wide in 30 days are refused with the §3 copy; failed `dispatch_*` jobs don't count. (e2e with arranged rows.)
12. **Running.** A signed `running` status sets the state and the start time; the line reads `Çevriliyor… (0 dk)`. The run id is stored only if it's digits; the editor links `GitHub'da gör` to `https://github.com/kptnortkp/arkhe/actions/runs/<id>` (built by the portal, never taken from the body). (e2e.)
13. **Polling.** While the job is `queued` or `running`, the editor refreshes the status every 10 s (visible tab only) and stops once it's final; leaving and coming back shows the current state. No polling on member pages. (e2e: state change appears without reload.)
14. **Timeouts without a cron** (D100). Read-time checks: `queued` for > 20 min → `failed / not_started`; not final 45 min after dispatch → `failed / timeout`. A late result for a timed-out job gets 409. (e2e with the clock hook.)
15. **Failure callback.** A signed failure with a known kind shows its §3 reason; `layout_mismatch` shows the two numbers from the body (integers 0–40 only); an unknown kind shows the generic reason. `Yeniden dene` starts a new job with the same options. (e2e.)
16. **Not configured** (D105). In production mode without `GITHUB_OMR_TOKEN` or `OMR_CALLBACK_SECRET`, the convert form is replaced by the §3 notice, the machine endpoints answer 503, and PDF upload plus manual MIDI upload work as before. The `data/omr-outbox/` path is refused in production. (e2e:prod.)

### S4. Drafts and publishing

*As the conductor I want nothing wrong to reach the choir. As a singer I only want what was approved.*

17. **A result becomes a draft.** A valid signed result creates one draft MIDI on the piece, stores its track list and measure count, and sets the job `succeeded`. The status line reads `Taslak hazır` and the draft card shows the §3 summary, e.g. `3 ses: Kadın, Erkek, Piyano · 93 ölçü · 2:41`. Automatic files never count toward the manual 20-files cap (amended D116). A piece holds at most one automatic draft: a newer result replaces an undecided older draft (its key queued). (e2e.)
18. **Drafts are invisible to members everywhere** (D103). For korist@: not in the piece page list or hero, not in homework `MIDI'yi çal`, `/api/dosya/midi/<draftId>` → 404, not in `midiCount`, and not in the Phase 10 morning repertoire line. A manager can play and download the draft. (e2e, each surface.)
19. **Publish** (D103). Any manager taps `Yayınla`: the draft becomes a normal MIDI file (label `Otomatik`, Tutti), visible to members at once. Every publish asks the §3 confirm first (amended review-fixes); if a previously published automatic file exists on the piece, it's deleted in the same transaction (its key queued). Manual uploads are never touched. The editor shows `Otomatik · {ad} yayınladı · {tarih}`. Members are told by the push in AC 31; the Phase 10 morning repertoire line does **not** count automatic files, so nobody hears about it twice. (amended D114) (e2e.)
20. **Delete a draft.** `Sil` removes the draft row and queues its key. Publishing or deleting twice (two tabs) gives `Dosya bulunamadı.` the second time, with no error. (e2e.)
21. **`Partisyonumu çal` precedence** (D107, amended D117).
    - Hero: (1) a manual file for my exact part; else (2) the published automatic file if it has a track for my part (directly or via `Kadın`/`Erkek`), opened with `{ses} önde`; else no hero.
    - Homework `MIDI'yi çal`: (1) manual exact part; (2) automatic with my track, `{ses} önde`; (3) manual Tutti; (4) the automatic file without emphasis.
    - e2e arranges each case on one piece by adding and deleting files and checks which `midiId` opens and the `data-level` of my track. (e2e.)

### S5. Player improvements

*As a bass I want to hear my line, then the piano off, then the tenors off.*

22. **Turkish track names.** A MIDI whose track names are UTF-8 (`Kadın`, `Bas`, `Piyano`, `Kadınlar`) shows them correctly in `Sesler`; a Latin-1 name from an older file still shows as before (decode UTF-8 when the bytes are valid UTF-8, else keep Latin-1). (e2e with fixture files.)
23. **Kadın / Erkek mapping** (D106). `Kadın`/`Kadin`/`Kadınlar`/`Women` map to soprano + alto; `Erkek`/`Erkekler`/`Men` to tenor + bass. A soprano on a `Kadın, Erkek, Piyano` file sees `Yalnız Soprano` (only Kadın on), `Soprano önde`, `Sopranosuz (sen söyle)` (Kadın off). When a file has both `Soprano` and `Kadın` tracks, the exact one wins. Existing four-track behaviour is unchanged (Phase 9 player e2e passes unedited). (e2e.)
24. **Per-track level** (D106).
    - A track named `Piyano`/`Piano`/`Pf`/`Klavye` starts at 50% (`data-level="50"`); others at 100%.
    - `{ses} önde` sets my track(s) to 100% and every other unmuted track to 30%; `Yalnız` and `sen söyle` work as today; tapping a chip still toggles on/off, keeping its level.
    - The synth's loudness follows velocity without the 0.2 floor (velocity 64 is clearly quieter than 96). (e2e for `data-level`; the curve by listening at review.)
25. ~~Bar loop~~ **Removed (amended D113).** Homework covers the whole piece; no bar loop and no measure map in this phase.

### S6. The workflow and the go-live

26. **Workflow file is safe** (static). `.github/workflows/omr.yml` triggers only on `workflow_dispatch`; has `permissions: contents: read`, `timeout-minutes` ≤ 30, a `concurrency` group per job id; pins Audiveris to `5.11.0` with a sha256 check; pins every `uses:` to a 40-char SHA; contains no `set -x`, no `upload-artifact`, and no secret in `run:` text other than through `env:`. `omr/requirements.txt` pins exact versions. (static.)
27. **Converter contract** (manual, before go-live, by the tech lead): `omr/convert.py` run locally on the prototype's `score.mxl` with `kadin_erkek` + piano gives tracks `Kadın`, `Erkek`, `Piyano` in UTF-8, 93 measures, programs 52/52/0; with `satb` it fails `layout_mismatch 4/2`. A committed 2-staff S/A + T/B MusicXML fixture with `sa_tb` gives four tracks. Output recorded in `design/phase-11/converter-check.txt`.
28. **Real run** (manual, go-live §9): the Cumhuriyet Güneşi PDF on production goes `Sırada…` → `Çevriliyor…` → `Taslak hazır` in under 15 minutes, the draft plays with three named tracks, and the Actions run used under 15 billable minutes.

### S7. Quality and the test round

29. **Phone, themes, accessibility.** At 375 px in light and dark: the score row, the convert form, status line, draft card and player presets fit without horizontal scroll; tap targets ≥ 44 px; the status line is `aria-live="polite"`; radios have a legend; Turkish copy exactly as §3. (e2e screenshots + axe on `/duzenle` and the piece page.)
30. **Test round.** New suites `e2e/phase11-a-score.mjs`, `phase11-b-omr.mjs`, `phase11-c-player.mjs` pass; Phase 9 `phase9-c-storage` and `phase9-d-midi` and Phase 10 `phase10-b-triggers` pass, edited only where they assert the old `repertuvar` default or label (D115); one full `npm run e2e` and `npm run e2e:prod` at the end; `npm run lint` and `npm run typecheck` clean. Results in `design/phase-11/e2e-results.txt`.

### S8. Telling the choir (added D114)

*As a singer I want to know when there's a new MIDI for a piece, without being woken up.*

31. **Push on publish** (D114, D115). With korist@ and yk@ subscribed (`push.invalid/ok`), sef@ publishes an automatic draft at simulated 14:00:
    - exactly one outbox file per device of korist@ and yk@, kind `midi_published`, title `Yeni MIDI`, body with the piece title only (no names, no file details), url `/repertuvar/<id>`, tag `midi-<pieceId>`; sef@ (the publisher) gets nothing; the publish response doesn't wait for the send (Phase 10 AC 8 fault hook);
    - a user who never touched the switch receives it (default on); a user with `Repertuvar ve yeni MIDI'ler` off gets nothing; an inactive user gets nothing;
    - at simulated 23:30 a publish is held for people with `Gece sessiz` on and arrives in their next morning notification as `Yeni MIDI: {eser}`; people with it off get it at once;
    - the next morning run's repertoire line does not mention that file; a manual MIDI upload on another piece still does;
    - deleting a draft, or a failed/timed-out job, sends nothing.

    (e2e: Phase 10 push outbox and clock hook.)

### S9. Automatic MIDI stays out of the way (added D116)

*As a manager I want to keep adding my own MIDI files whatever the robot did.*

32. **Manual uploads are independent** (D116). On a piece with 19 manual files plus a published automatic file and a draft, a manager can still upload a 20th manual file; the 21st manual one gets `MSG.midiTooMany`. The editor's `full` state and the server's count (both the pre-check and the in-transaction recount in `uploadMidi`) count manual files only. Publishing, replacing or deleting the automatic file never changes, relabels or deletes a manual file, and a manual Tutti file can exist next to the automatic one. Storage meters still count every file. (e2e.)
33. **Separate, labelled groups** (D116). korist@ on the piece page sees manual files under `MIDI` and the published automatic file under `Otomatik oluşturulan` with the `Otomatik` badge (text, not colour only), never mixed; with only an automatic file, only that group shows; with neither, neither. The part filter (`?partisyon=`) never hides the automatic file, since it carries every part. The editor shows the same two groups, with drafts and job status only in the automatic one. (e2e + 375 px screenshot.)

## 6. Out of scope (explicitly)

- Editing notes, fixing OMR errors in the portal, renaming or reordering tracks of a draft (reject and re-run with another layout, or upload a fixed MIDI by hand).
- Per-part "emphasis" MIDI files from the pipeline (the player's `önde` does it, D97).
- Storing or offering MusicXML / `.omr` files; MuseScore export; lyrics; OCR of titles and part names.
- Divisi splitting beyond two voices per staff; SSAATTBB naming (use `Bilmiyorum (otomatik)`).
- Repeats and D.S./coda expansion in MIDI.
- A push to the manager when a job finishes (D104). The publish push is in scope (AC 31).
- Bar-range loops for homework and storing measure timings (D113).
- A cancel button for a running job; an admin page for jobs or GitHub minutes.
- Viewing the PDF inside the portal page (it opens in the browser's own viewer).
- Backing up Blob files (PDF/MIDI) in the monthly email; the Drive original remains the source.

## 7. Questions for the build team

1. **@dba:** drafts as a `status` column on `midi_files` (ALTER ADD, default `published`) plus `auto_meta` (tracks JSON, measures, publisher, published_at) vs a separate table. My preference is the column (no copy on publish, trigger keeps working) with one helper that every member query uses. And: the safest way to admit area `score` given the CHECKs on `storage_deletions` and `storage_events` (D95).
2. **@backend:** signature format and the three endpoint paths (D98 suggests `/api/omr/<jobId>/nota`, `/durum`, `/sonuc`); the PDF upload as a route handler like recordings (server actions are capped at `1100kb`); the GitHub dispatch call with a 10 s timeout.
3. **@ui:** the draft card and status inside the existing MIDI editor at 375 px; how `önde` sits next to the two existing presets without wrapping into three lines.

## 8. Open risks

1. **OMR quality.** The prototype needed hand fixes in 6 places for one clean, engraved 4-page score. Scanned or handwritten scores will be worse. Mitigation: mandatory approval, the warning on the draft card, manual MIDI upload stays. If most drafts get deleted after a month, we stop promoting the feature rather than tune it.
2. **Layout guessing.** Without OCR the converter relies on the manager's layout choice and staff counts; scores that change the number of staves mid-piece (e.g. bars 25–37 in Cumhuriyet Güneşi had one vocal staff) will mislabel or fail. Mitigation: `layout_mismatch` with numbers, the counts are taken per system so a short section with fewer staves doesn't fail the whole piece, and a wrong draft is simply deleted. Smarter staff matching is backlog.
3. **Audiveris on Linux runners.** The `.deb` asset name and runtime needs (headless AWT) must be confirmed at build time; fallback is building from the pinned source tag with JDK 21 (slower first run, cached).
4. **GitHub limits.** 2,000 min/month; the choir cap (40 jobs/30 days × ≤ 15 min) stays below it. The account's Actions spending limit must stay $0 so an overrun fails instead of billing.
5. **Token expiry.** A fine-grained PAT expires (max 1 year). The portal shows `dispatch_auth`; README carries the renewal steps and the date.
6. **Blob quota.** PDFs share the 1 GB store with recordings. At ~1 MB × 60 pieces this is ~6%; the existing 80/95% alerts apply.
7. **iPhone standalone PWA and PDFs.** Opening a PDF from the home-screen app may open a viewer without an obvious way back. Mitigation: `Aç` opens a new tab (Safari), checked on a real iPhone at go-live.

## 9. Go-live checklist (the user, in the browser; never paste tokens into chat)

0. (amended review-fixes) Code rollback after this phase: before promoting any deployment older than Phase 11, run `npm run db:drop-drafts` against production (README Rollback), or drafts become visible to members.
1. Approve the commit and the push (push = production deploy). Before it: `db:check` on Turso shows 14/14; `db:migrate` takes it to **15/15** (rehearse on a copy first, as in Phase 10).
2. **Fine-grained PAT** (github.com, signed in as `kptnortkp`): Settings → Developer settings → Personal access tokens → Fine-grained → `Generate new token`. Name `arkhe-portal-omr`; Resource owner `kptnortkp`; Expiration 1 year (note the date in STATUS); Repository access `Only select repositories` → `arkhe`; Permissions → Repository → **Actions: Read and write** (Metadata: read is added automatically). Nothing else.
3. **Callback secret:** in your own terminal `openssl rand -base64 48`. Put the same value in two places: GitHub repo → Settings → Secrets and variables → Actions → `New repository secret` **`OMR_CALLBACK_SECRET`**; and Vercel → Project → Settings → Environment Variables **`OMR_CALLBACK_SECRET`** (Production only).
4. GitHub repo → Settings → Secrets and variables → Actions → Variables: **`PORTAL_URL`** = the production URL (https, no trailing slash).
5. Vercel env (Production only): **`GITHUB_OMR_TOKEN`** (the PAT), **`GITHUB_OMR_REPO`** = `kptnortkp/arkhe`, **`GITHUB_OMR_WORKFLOW`** = `omr.yml`, **`GITHUB_OMR_REF`** = the default branch name. Redeploy.
6. GitHub → Settings → Billing → confirm the Actions spending limit is **$0**.
7. Run AC 28 with the Cumhuriyet Güneşi PDF (`Kadın ve Erkek`, piano on); listen; publish or delete. Check the run's minutes on the Actions usage page; record both in STATUS.
8. On a real iPhone (home-screen app): open a piece's `Nota (PDF)` and come back (risk 7).

## 10. Priorities if time runs short

Cut in this order (amended D113): AC 21 (hero for automatic files) → `{ses} önde` in AC 24 (keep the piano level) → AC 13 polling (a reload is acceptable). Never cut: AC 1–4, 8, 14, 17–20, 26, 31–33.

## Frontend notes (player, 2026-10-24)

- Each preset sets a complete, known mix so its `aria-pressed` state is unambiguous: `Yalnız` and `sen söyle` also reset levels to the start levels (piano 50, others 100); `{ses} önde` turns every track on (mine 100, others 30) rather than only re-levelling the unmuted ones. A chip tap afterwards still toggles one track and keeps its level (e.g. `Bas önde`, then piano off).
- Levels are shown as text on the chip (`Piyano %50`), so they aren't colour-only. On a 375 px screen the three presets wrap to two lines.
- Synth: `peak = 0.04 + 0.96 × velocity²` (velocity 64 is about 6 dB under 96), master gain 0.25 → 0.35 to keep the overall loudness. To be judged by ear at review.
- Hero/homework with emphasis (AC 21): `MidiButton` and `MidiPlayer` take `emphasize`; it applies `{ses} önde` on load when the file has a track for the viewer's part and at least one other track.
