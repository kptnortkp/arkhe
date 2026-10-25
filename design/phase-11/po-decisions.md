# Phase 11 PO decisions

Author: PO. Date: 2026-10-24. The decisions behind `po-spec.md`. Numbering continues from Phase 10 (D64–D90; no team-reply decisions were added there). Under the fast process there is no separate role-plan round: where the build team's `contract.md` disagrees with a decision below, the tech lead settles it and records it here with the next free number after the highest in `design/phase-*/po-decisions.md` (Phase 12 uses D119–D132), marking the changed AC `(amended Dn)`. Where this file is silent, the role that owns the topic decides.

**Changes from the user's request** (all explained below):
- D96: the manager tells the converter the score's layout; part names aren't recognised automatically.
- D97: one multi-track MIDI per conversion, no per-part emphasis files.
- D113 (user, 2026-10-24): no bar loop and no measure timings at all.
- D114 (user, 2026-10-24): an immediate push to the choir when an automatic MIDI is published.
- D115: the `repertuvar` push group becomes on by default and is relabelled. This changes Phase 10's D72 default.

## Ordering and platform

**D91. Phase 11 builds on the live Phase 7–10 code; its migration is `0014`.**
- Turso shows 14/14 since 2026-10-22, so no ordering wait. After this phase it must show 15/15.
- The Gmail backup go-live is unrelated and stays the user's open item.

**D92. GitHub Actions is the OMR worker.**
- Audiveris is a ~200 MB Java app that needs a minute or more per page. It can't run in a Vercel function (60 s, 250 MB bundle) or in the browser.
- Rejected: Render/Fly free tiers (sleep, memory limits, another account to run), the conductor's laptop (not always on), paid OMR APIs (budget).
- Actions on the private repo gives 2,000 free minutes a month, runs only when asked, and the user already owns the repo. One conversion costs roughly 4–10 minutes, most of it installing Audiveris (cached after the first run).
- The workflow and converter live in the same repo (`.github/workflows/omr.yml`, `omr/`). Vercel ignores them; pushing them is still a production deploy and needs the user's go.

**D93. AGPL: Audiveris is used as an unmodified tool.**
- The workflow downloads the official release and runs it in CI on our own files. We don't modify, redistribute or host it for others, and the portal never exposes Audiveris itself; members get MIDI files, which are our data, not the program. No AGPL obligation is triggered. If we ever patch Audiveris, the patch is published in the repo.
- `music21` (BSD-3) and `mido` (MIT) are permissive.

## The score PDF

**D94. One PDF per piece, ≤ 4 MB, visible to every signed-in active user.**
- Stored in the existing private Blob store under a new storage area `score`, key `scores/<uuid>.pdf`, using the Phase 9 ledger (hold → put → commit, queued deletes, sweep).
- Uploaded through a route handler, like recordings, because server actions are capped at `1100kb` and Vercel bodies at 4.5 MB. 4,194,304 bytes is the limit already used for recordings.
- Sniffed by bytes (`%PDF-` near the start, `%%EOF` near the end); the browser's type and name are never trusted. Encrypted or broken PDFs are accepted for viewing; the converter reports `pdf_unreadable` if it can't read them.
- Members see it because the user asked for it and the score is not private within the choir. It opens in the browser's own PDF viewer (new tab), not in a frame, so the CSP stays as it is; the file response carries `Content-Security-Policy: sandbox` and `nosniff`.
- Deliveries count as transfer (area `score`), never toward the recording playback stop, with the MIDI per-viewer caps.
- Why one per piece: a choir works from one edition at a time. Old editions belong on Drive (the piece's links).

**D95. Migration rules for the new area.**
- `midi_files` and `recordings` are never rebuilt (their 0010 triggers would be lost). New columns on them are `ALTER TABLE … ADD COLUMN` only.
- `storage_deletions` (area and key CHECKs) and `storage_events` (hand-written area CHECK in 0011) don't accept `score` today. The DBA picks the safest path; a rebuild of those two tables is acceptable only if the same migration drops and recreates every trigger whose body names them (the 0010 queue triggers), and `db:check` proves the trigger list is unchanged. The migration is rehearsed on a copy of the Turso dump before go-live, as in Phase 10.
- The score's own row (table or columns, DBA's choice) cascades with the piece, and its delete queues the key, like `midi_files`.

## The conversion

**D96. The manager tells the converter the layout.** *(A change: the request assumed the pipeline names tracks by part on its own.)*
- The prototype ran Audiveris without OCR languages, so part names on the score are not read. Guessing S/A/T/B from clefs and ranges is fragile; the manager knows the layout at a glance.
- Options: `satb` (four staves), `kadin_erkek` (two staves, named Kadın/Erkek), `sa_tb` (two staves, two voices each, split into four tracks), `auto` (MusicXML names if they match a voice, else `Ses 1…n`). Plus `Altta piyano eşliği var` and an optional tempo.
- A count that doesn't match fails with `layout_mismatch` and both numbers, so the fix is obvious: pick another layout and retry.
- Kadın/Erkek staves are **not** split even when they have two voices: in that writing two voices are divisi of the same section, and the player's mapping (D106) handles them as one track.

**D97. One multi-track tutti MIDI per conversion.** *(A change: per-part emphasis files were optional in the request.)*
- The player's `Yalnız`, `önde` and `sen söyle` presets give every singer their emphasis from one file, so extra files would only fill the list and the store.
- Tracks: one per voice (GM 52, velocity 96), piano merged into one `Piyano` track (GM 0, velocity 64), UTF-8 names. ≤ 16 tracks, ≤ 1 MB.
- The published file is a Tutti row marked automatic (D116 keeps it in its own group). Per-part manual files still win the hero (D117).

**D98. Portal ↔ workflow trust: one HMAC shared secret, nothing secret in the dispatch.**
- Dispatch inputs: `job_id`, `layout`, `piano`, `tempo`. The portal's URL is the repo variable `PORTAL_URL`, never an input, so a dispatch can't redirect the workflow.
- Every request from the workflow carries `X-Arkhe-Timestamp` (unix seconds) and `X-Arkhe-Signature = hex(HMAC-SHA256(secret, "<timestamp>.<METHOD>.<path>.<sha256(body)>"))`, compared in constant time; ±5 minutes.
- Replay protection is the job's state machine: the PDF is served only to a `queued`/`running` job; `running` is accepted once; a result or failure only while not final. A replayed result gets 409.
- The secret is `OMR_CALLBACK_SECRET` in both GitHub (repo secret) and Vercel (Production). Outside production a fixed development secret from `.env.development` is used, so e2e signs real requests against the real endpoints.
- Suggested paths: `GET /api/omr/<jobId>/nota`, `POST /api/omr/<jobId>/durum`, `POST /api/omr/<jobId>/sonuc`. The proxy must not redirect them to login.

**D99. The GitHub token is a fine-grained PAT on one repo with Actions read/write only.**
- Created by the user as `kptnortkp`, stored only as the Vercel env `GITHUB_OMR_TOKEN` (Production). Never in chat, files, logs or error messages; GitHub error bodies are not logged either, only the status code.
- One year expiry; the date goes into STATUS, and `dispatch_auth` tells managers what happened when it lapses.
- Never the company account, `gh` or the machine's global git config.

**D100. Job states and time limits, with no new cron.**
- `queued` → `running` → `succeeded` | `failed` (with an error kind). `queued` may go straight to `failed`.
- The dispatch call has a 10 s timeout; 401/403/404 → `dispatch_auth`, anything else → `dispatch_failed`. The job row is written before the call, so a crash leaves a `queued` job that times out instead of a ghost run.
- Time limits are checked when jobs are read (the editor, a new start, a callback): `queued` > 20 min → `not_started`; not final 45 min after dispatch → `timeout`. The workflow's own `timeout-minutes: 30` stops it earlier.
- Why no cron: Hobby has one, and a stale job only matters to the manager looking at it.
- Jobs are kept (they're tiny) and cascade with the piece; the editor shows only the latest per piece.

**D101. Limits.**
- One `queued`/`running` job per piece (enforced in the database, so parallel submits can't both win).
- 10 starts per manager per Istanbul day; 40 per 30 days for the choir. Jobs that failed at dispatch don't count.
- 20 pages, enforced by the workflow (`too_many_pages`).
- Why 40: a choir adds maybe 10–15 pieces a term; 40 × ≤ 15 min leaves the free 2,000 minutes with room for retries.

**D102. Failure reasons come from a fixed list.**
- The workflow sends a `kind` (and for `layout_mismatch` two integers). The portal shows its own Turkish sentence. Free text from the workflow is never stored or shown; details live in the GitHub run log, which only the user can open.

**D111. The PDF can't be replaced or deleted while a job is active.**
- Simpler than discarding results for a superseded PDF, and a stuck job frees itself within 45 minutes.

## Drafts and publishing

**D103. Drafts live with the MIDI files, invisible to members; any manager publishes.**
- Recommendation to the DBA: a `status` column on `midi_files` (`draft` | `published`, default `published` via ADD COLUMN) plus metadata for automatic files (job, tracks JSON, measure count, publisher, published time). Publishing is an update, not a copy, and the 0010 delete trigger keeps working for drafts and published files alike. The DBA may choose a separate table if it's safer; the ACs don't change.
- Every member-facing read (piece list, hero, homework, delivery route, counts, the morning repertoire line) goes through one filter. AC 18 tests each surface.
- **Who publishes:** any manager, like budget approval (D79). In Arkhe the person preparing MIDI is often a board member, not the conductor; the conductor can still delete anything. The publisher's name is shown.
- Publishing replaces the piece's previous published automatic file (one `Otomatik` file per piece); manual uploads are never touched.
- Delete is a hard delete; the trigger queues the file.
- ~~Drafts count toward the 20-files-per-piece cap.~~ Amended by D116: automatic files have their own limit (one published, one draft).

**D104. No push to the manager when a job finishes.** *(Amended by D114: the publish push to the choir is now in scope.)*
- No push to the manager when a job finishes: the editor shows the status, and the job is quick enough to wait for. Backlog if managers ask.

**D105. Outside production: an outbox; in production without setup: "kurulmadı".**
- Outside production a dispatch writes `data/omr-outbox/<jobId>.json` and makes no network call; e2e reads it and plays the workflow through the signed endpoints, with fixture MIDI and summaries. A fault cookie (as in Phase 9) simulates GitHub's 401/5xx/timeout.
- In production the outbox is refused. Missing `GITHUB_OMR_TOKEN`, `GITHUB_OMR_REPO`, `GITHUB_OMR_WORKFLOW`, `GITHUB_OMR_REF` or `OMR_CALLBACK_SECRET` puts the feature in the "kurulmadı" state (like `/yedek`): no convert form, machine endpoints 503, PDF and manual MIDI unaffected. Nothing fails at boot.

## Player

**D106. Player fixes.**
- Track names are decoded as UTF-8 when their bytes are valid UTF-8 (`@tonejs/midi` reads them as Latin-1), else left as they are.
- `partOf` becomes a set: `Kadın`-like names → soprano + alto, `Erkek`-like → tenor + bass. A track with exactly my part wins over a combined one. Presets act on all of "my" tracks.
- Per-track level instead of only mute: piano-like names start at 50%; `{ses} önde` puts mine at 100% and the rest at 30%. Chips still toggle on/off. No sliders (too fiddly on a phone; three presets cover rehearsal practice).
- The synth drops the `0.2 + 0.8 × velocity` floor so velocity differences are audible; exact curve is the UI engineer's call, judged by ear at review.

**D107. The hero uses the automatic file when there is no exact part file.**
- If the published automatic file has a track for my part, `Partisyonumu çal` plays it with `önde` already applied. That is the whole point for a bass on a SATB + piano piece.

**D108. ~~The bar loop is a stretch goal.~~ Superseded by D113.**

## Workflow and testing

**D109. Workflow hardening.** Only `workflow_dispatch`; `permissions: contents: read`; `timeout-minutes: 30`; per-job concurrency; Audiveris 5.11.0 pinned with sha256; actions pinned by SHA; Python deps pinned; no `set -x`; secrets only via `env:`; no artifacts (the PDF must not sit in GitHub for 90 days). Checked statically by AC 26.

**D110. What e2e proves and what it can't.**
- e2e proves the portal side end to end: uploads, authorization, HMAC, states, limits, drafts, publishing, the player (suites `phase11-a/b/c`).
- The converter is checked locally against the prototype's MusicXML and a small S/A + T/B fixture (AC 27), and the real workflow once on production (AC 28). A failed real run blocks go-live of the convert button only; the PDF and player parts can ship.

**D112. Out of scope is the spec's §6.** In particular no in-portal note editing: OMR errors are fixed by deleting the draft and uploading a hand-fixed MIDI (the conductor's MuseScore route stays).

## The user's choices (2026-10-24)

The coordinator relayed the user's answers to the four open questions. Kept as proposed: any manager publishes (D103), and the manager picks the layout (D96).

**D113. No bar loop and no measure timings in Phase 11.** The user: "ödev tüm eser olacak" (homework covers the whole piece).
- Spec AC 25 is removed (the number stays). The converter returns only `tracks`, `measures` (the count, shown on the draft card) and `durationSec`; nothing is stored per measure. `assignments.bar_from/bar_to` are left as they are.
- Saves about an hour of player work and one e2e fixture.

**D114. Publishing an automatic MIDI pushes to the choir at once.**
- New kind `midi_published` in the existing `repertuvar` group, created by the publish action with Phase 10's write-then-`after()` path (D68): one notifications row per recipient, never slowing the publish.
- Recipients: every active user with the group on, minus the publisher. Managers are included, since a board member who sings practises too.
- Quiet hours apply as for every non-urgent kind (D71): inside 22:00–08:00 the item is held and goes out in the morning notification as the line `Yeni MIDI: {eser}`. Expiry 3 days; dedupe key `midi_published-{midiId}`; tag `midi-{pieceId}`, so a re-publish replaces the old notification on the phone.
- Payload: the piece title only and the link `/repertuvar/{id}`. No publisher name, no file details (D82).
- **No double report:** the Phase 10 morning repertoire line stops counting automatic MIDI files (`status`/automatic flag excluded in `morning.ts`). Manual MIDI uploads and links stay in that line, as D77 set.
- Only publishing sends. Drafts, deletions, failed jobs and manual uploads send nothing now.
- Why immediate here when D77 made repertoire news a morning line: D77 guarded against bursts from bulk link pastes. A publish is one deliberate act per piece, a few times a term, and it's exactly the moment singers want to hear about.

**D115. The `repertuvar` group becomes on by default and is relabelled `Repertuvar ve yeni MIDI'ler`.** *(A change to Phase 10 D72, where it was off.)*
- With the old default almost nobody would get the push the user asked for. A new switch with its own default would need new values in the `notification_prefs` and `notifications` key CHECKs, which means rebuilding two Phase 10 tables. That cost isn't worth it for one kind.
- The cost of turning the default on is small: the repertoire digest adds at most one line to the single morning notification (D70), never an extra buzz, and it no longer carries automatic MIDIs (D114). People who already set the switch keep their choice; only people with no row get the new default (the "no row means default" rule from D72, with no data migration).
- Phase 10 e2e that assert the old default or label are updated in this phase (spec AC 30). If people complain about the morning line, we drop links from it before touching the MIDI push.

## The user's choices, round 2 (2026-10-24)

The user: "Bir notayı ekledim, MIDI otomatik oluştu. Bu benim başka bir MIDI eklememin önüne geçmesin. Otomatik oluşturulan MIDI'ler 'created by automation' gibi ayrı dursun."

**D116. Automatic MIDI is a separate kind of file, never in the way of manual ones.**
- The only per-piece rule in the manual flow today is `MIDI_MAX_PER_PIECE = 20` (`uploadMidi` checks it twice: before the put and again inside the transaction; `MidiEditor` hides the form at the cap). All three count **manual files only**. There is no Tutti or per-part uniqueness rule today, and none is added.
- Automatic files have their own limit: at most one published and one draft per piece. A newer result replaces an undecided draft; publishing replaces the previous published automatic file (D103).
- Shown in their own group `Otomatik oluşturulan` with the badge `Otomatik`, on the piece page and in the editor; the manual `MIDI` group looks exactly as today. Every member query in `repertoire-midi.ts` returns the automatic flag so the page can split the groups; `midiCount` stays "published files of both kinds" for anything that only asks whether a piece has MIDI.
- Storage meters and the quota pause still count all files: the Blob store doesn't care who made them.
- Why: the user's request, and it keeps the robot's output honest. A singer should know which file a person checked note by note and which one a program read.

**D117. Hero and homework precedence: a manual file for my exact part wins; otherwise the automatic file with my part emphasised.**
- Hero: manual exact part → automatic with my track (`önde`) → no hero.
- Homework `MIDI'yi çal`: manual exact part → automatic with my track (`önde`) → manual Tutti → automatic without emphasis.
- Why: a hand-made part file is deliberate and checked, so it beats OCR. The automatic multi-track file with my line in front beats a manual Tutti, where I can't pick my line out.

**D118. The part filter never hides the automatic file.** It holds every part, so `?partisyon=bass` still shows it (with the hero logic above), just as Tutti files show today.
