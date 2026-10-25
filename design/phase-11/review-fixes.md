# Phase 11 review fixes

Author: backend (arkhe-backend). Date: 2026-10-24. Replies to `review.md` (UI/UX and backend/security), as triaged by the tech lead.

## UI/UX

- **P2-1 fixed.** The automatic group (`src/components/midi/auto-group.tsx`, new) is rendered inside `Nota ve otomatik MIDI`, after the score row and before the convert form: job status, draft card, then the published automatic file. `MidiEditor` now holds manual files only, with its own `MIDI` heading under `MIDI dosyaları`. e2e: `phase11-b` "review P2-1" checks the automatic group sits in the score section, before the manual upload form.
- **P2-2 fixed.** While a job is queued or running, the convert form stays mounted but its fields are a disabled `<fieldset>` and the button reads `Çeviri sürüyor…`. The form stays mounted (instead of unmounting) so the `Çeviri başladı.` toast still shows. `Değiştir` and `Sil` on the score are disabled, with `Çeviri sürerken nota değiştirilemez.` shown inline and linked by `aria-describedby`. The server checks are unchanged. e2e: "review P2-2".
- **P2-3 fixed.** A `succeeded` job's status is shown only while a draft exists (`AutoGroup`). Queued, running and failed are shown as before. e2e: "review P2-3".
- **P2-4 rejected (tech lead).** The user wants the screen kept on while the player is open, also when paused, so the wake lock stays as the tech lead's hotfix wrote it.
- **P2-5 fixed, spec amended.** `Yayınla` always confirms: title `Yayınlansın mı?`, text `Koristler hemen görür ve bildirim alır.`, plus `Önceki otomatik MIDI silinip yerine bu gelecek.` when a published automatic file is being replaced. `po-spec.md` §3 and AC 19 are marked "(amended review-fixes)". e2e: "review P2-5".
- **P3-1 fixed.** The live region is a visually hidden span holding only the state (`Sırada…`, `Çevriliyor…`, `Taslak hazır`, or the failure). The visible line keeps the minutes and is `aria-hidden`.
- **P3-2 fixed.** `visibilitychange` runs the poll at once when the tab becomes visible.
- **P3-3 partly.** The draft's `Dinle` player is no longer `compact`, so the track chips show directly. The repeated inner `Sesler` label in compact mode was left alone (not on the fix list).
- **P3-4 fixed.** Deleting the published automatic file has its own confirm: `Otomatik MIDI silinsin mi?`, `Koristler artık göremez. Notadan yeniden çevirebilirsin.` No Drive sentence.
- **P3-6 fixed.** Error text in the score section uses `text-absent-ink` throughout.
- **P3-7 fixed, spec amended.** `dispatch_auth` reads: `GitHub bağlantısı reddedildi; erişim anahtarının süresi dolmuş olabilir. Portalı kuran kişiye haber ver.` The README keeps the renewal steps.
- **P3-8 fixed.** The automatic file's title is short: `4 ses + piyano`, `2 ses` or `Piyano` (`autoTitle` in `midi-list.tsx`). The track names are in the player and on the draft card.
- **P3-5 and P3-9:** player work, not on this list; the tech lead's player hotfixes are kept untouched.

## Backend/security

- **P2-1 fixed.**
  - New script: `npm run db:drop-drafts` (`scripts/db-drop-drafts.ts`). It uses the same env pattern as `db:check` (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, local file by default). It deletes `midi_files` rows with `status = 'draft'`; the 0010 trigger queues their files. On a pre-Phase-11 schema it says so and does nothing.
  - README → Deploy → Rollback (step 9) gets a bullet: run it before promoting any deployment older than Phase 11.
  - Go-live checklist `po-spec.md` §9 gets item 0.
- **P2-2 fixed** in `.github/workflows/omr.yml`:
  - (a) The PDF page count is its own step, `python omr/pages.py input.pdf failure.json`, with no secret; pypdf runs only there. `portal.py fetch` is standard library only and checks only type and size.
  - (b) `portal.py` is copied with `sudo install -o root -m 0444` to `/opt/arkhe/portal.py` right after checkout, before any untrusted code runs. Its sha256 becomes a step output, which later steps can't change.
  - (c) Every secret-bearing step (running, fetch, result, fail) checks that hash with `sha256sum -c` and then runs `/usr/bin/python3 -I -S /opt/arkhe/portal.py …`: the system interpreter, isolated, no site-packages. The secret is in the `env:` of exactly those four steps.
  - (d) `omr/requirements.txt` now carries sha256 hashes from PyPI for every pinned release, and the install is `pip install --require-hashes`. Checked locally: `pip download --require-hashes` for manylinux x86_64 / cp312 fetched all 26 wheels.
  - Residual risk: runner steps have passwordless sudo, so a fully compromised step could still tamper with later ones. These measures stop the realistic paths (`.pth` files, a modified `portal.py`, a malicious PDF reaching pypdf next to the secret).
  - The static check in `phase11-b` (AC 26) was extended: hashes, `--require-hashes`, the four pinned isolated invocations, the secret only in step `env:`, and `failure() || cancelled()`.
- **P3-1 done.**
  - `api/omr/` is excluded from the proxy matcher, so there is no CSP or nonce and no proxy body buffering.
  - POST without `Content-Length` answers 411 in `authenticate()`. Next's server may add a length to a chunked body before the route sees it, so in dev a chunked POST ends at the signature check (401). The 411 is defence in depth, and the body is capped in any case.
- **P3-2 done.** The score route keeps `fileHeaders`' `default-src 'none'; sandbox`; the e2e asserts that value. Checked in headed Chrome: the built-in viewer renders.
- **P3-3 done.** New portal-side kind `storage_full`, with the copy `Dosya alanı dolu olduğu için sonuç kaydedilemedi. Yer açılınca yeniden dene.` A result that arrives while uploads are paused fails the job in the route (507 `storage_full`, logged), so the workflow's later failure post gets 409 and can't overwrite it.
  - Migration 0014 isn't live anywhere yet, so I edited its `omr_jobs` CHECK (and the 0014 snapshot) in place rather than adding a migration.
  - The local `data/arkhe.db` got the same `omr_jobs` table rebuilt by hand. `db:check` passes at 15/15 and `drizzle-kit generate` reports no changes.
  - Transient storage errors still answer 503, so the workflow retries.
  - e2e: "review P3 … storage_full".
- **P3-4 fixed.** In `src/lib/omr/midi.ts`: a track-name meta longer than 160 bytes is refused without decoding; Latin-1 decoding uses `TextDecoder("latin1")`; the end tick is a loop. No array spreads remain.
- **P3-5 fixed.** `portal.py fail` reads `failure.json` as untrusted data: any parse error means `output_invalid`; it must be a dict with a known kind, and the numbers must be real integers 0–40. Tested with a JSON list and with `1e999`. Requests go through an opener that refuses redirects, so the `X-Arkhe-*` headers never reach another host. Retries happen only on 500/502/503/504.
- **P3-6 fixed.** `if: failure() || cancelled()`.
- **P3-7 checked.** On 2026-10-24, the GitHub API showed `actions/checkout` tag `v7.0.1` → commit `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-python` `v7.1.0` → `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`, and `actions/cache` `v6.1.0` → `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`. All are lightweight tags on commits and match the workflow. Re-check on the tag pages at go-live if you want a second look.
- **P3-8 noted** for the Turso rehearsal: `sqlite_sequence` for `storage_events` may drop to `max(id)`. That is not data loss.
- **P3-9 fixed.** `convert.py` takes every `out/*.mxl` (Audiveris' `.mvt1`, `.mvt2` …), sorts them by movement number and joins them into one MIDI. Later movements are shifted after the earlier ones, tracks are merged by name, and the measure count is summed. The layout check applies per movement. The workflow passes all files and logs the count. Checked locally: the same movement twice gives 186 measures and 222 s.

## Not done (skipped per the tech lead)

UI P3-3 (inner `Sesler`), P3-5 (player rebuild path) and P3-9 (synth by ear); backend P3-8 is a note only.

## Test round

- Full `npm run e2e` 1746/1746 (started 22:18 Istanbul) and `npm run e2e:prod` 80/80; lint and typecheck clean. Details are in `e2e-results.txt`.
- I fixed three older tests, because their failures were real bugs in the tests and not flakes:
  - **phase10-a/b (AC50, AC39, AC44):** they send at real time to people with `Gece sessiz` on, so they fail after 22:00 Istanbul. The tests now turn `gece` off for those recipients.
  - **phase7-a AC32:** it now also expects the new dev OMR secret in `.env.development`.
  - **phase7-b AC17:** it now waits for base-ui to move focus into the dialog, which happens asynchronously.
