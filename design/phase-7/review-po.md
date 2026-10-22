# Phase 7 PO review: data safety (monthly reports and encrypted backup by email)

Author: arkhe-po. Date: 2026-10-21.

Checked against `po-spec.md` (AC 1–40, as amended by `po-decisions.md` D1–D16), using:
- `implementation-notes.md`, including its deviations
- the four reviews `review-ux/ui/db/backend.md`
- `review-fixes.md`
- `e2e-results.txt`
- the README section `Aylık yedek e-postası`

I also ran my own read-only checks on the running dev app and the working tree; no data was created:
- `GET /api/cron/aylik-yedek` with no header and with `Bearer wrong` → `401 {}`, `cache-control: no-store`
- `/yedek` without a session → 307 to `/giris`
- `vercel.json` contents
- the AC 33 secret grep over the whole tree, untracked files included
- the D11 import grep for `queries-internal`
- the order of checks in `run.ts` (passphrase → SMTP → build → size guard → `sendMail`)
- the 18 MB constant

## Verdict: **ACCEPTED**

Phase 7 meets every acceptance criterion that can be checked before deploy. Three of them are amended below (AC 7, AC 8, AC 16/17 copy). AC 39 is the post-deploy gate. It doesn't block code acceptance, but it blocks calling the phase "live".

Final runs:
- `npm run e2e`: **657/657**
- `npm run e2e:prod`: **44/44**, with three extra production servers covering the missing, short and dev-value env sets
- `npm run lint` and `npm run typecheck` are clean
- `next build` (inside e2e:prod) shows `ƒ /yedek` and `ƒ /api/cron/aylik-yedek`

Team review: **0 P1, 13 P2** (ux 5, ui 5, backend 2, db 1). All 13 are fixed, plus most P3s. The fixes that changed behaviour have tests: the pending dialog, focus after a send, the banner edge cases, and the short-secret 503. The one fix that needs a failing DB write to reproduce (a delivered email recorded as `failed`) was reproduced by hand with a temporary trigger.

Constraints:
- **Zero budget holds.** The only new runtime dependency is `nodemailer` 10.1.7 (MIT-0, zero dependencies, exact pin). Gmail is free. The fallback providers are free plans, documented only as a fallback.
- **No secret is in the repo.** My grep finds only the two public dev values, and production refuses both (proven in prod-e2e).
- **The live database is safe to migrate.** The DBA drilled 0007 on a restore of the real pre-migration backup: row counts identical, schema byte-identical to dev, atomic on Turso, and old code works against the new table.

**For the choir:** from the first morning after the şef saves the board's addresses, the choir's records leave Turso every month, encrypted, without anyone remembering anything. If that ever stops, the şef and the board see a red box on the home page within two days. A 1-day point-in-time restore is no longer our only safety net.

**There are no must-fix items.** The go-live steps in §4 are for the user.

## 1. AC-by-AC

| AC | Result | Evidence |
|---|---|---|
| 1 Schedule | PASS | e2e: `vercel.json` has exactly one cron, `/api/cron/aylik-yedek` at `0 5 * * *`. I read the file myself. |
| 2 Route protection | PASS | e2e: no header / `Bearer wrong` → 401 `{}`, `no-store`, nothing sent and no row; no recipients → 200 `{"status":"skipped"}` only, no row. prod-e2e: unset → 503, a 31-character secret → 503 even with the matching bearer, the dev value → 503, a 64-hex secret counts as set, and a failed run → 500 `{"status":"failed"}`. Backend review: constant-time digest compare, no DB access before auth, `POST` → 405. My curl: 401 `{}` with `no-store`. |
| 3 Previous month | PASS | e2e: `?bugun=2026-11-01` → `sent`, one `.eml`, one run `cron/2026-10/sent`. |
| 4 Idempotent | PASS | e2e: a repeat → `skipped`, no `.eml`, no row; two concurrent calls → `sent,skipped`, one `.eml`, one run. DBA: 12 concurrent clients, exactly one claim. |
| 5 Retry, abandoned month (D7) | PASS | e2e: a failed `2026-09` is retried; an 11-minute-old `running` row is reaped with the stale message and the month resent; a 2-minute-old one blocks (`skipped`); a failed `2026-10` alone with `?bugun=2026-12-01` sends `2026-11` only. |
| 6 Istanbul boundary | PASS | e2e: precondition that January 2025 is free of other data; 31 Jan 23:30 counts and 1 Feb 00:30 doesn't (`Geldi/Beklenen 2/2`). |
| 7 Envelope | PASS, **amended** | e2e: From `Arkhe Portal <outbox@arkhe.local>`, one message to both recipients, Subject decodes exactly with no `@` or `₺`. **Amendment (decision 3 below):** the display name may be unquoted. |
| 8 Body | PASS, **amended** | e2e: every line is present; the backup name pattern; no manual paragraph on an automatic send; no QP escapes left and one paragraph per line; five attachments; no demo or fixture address anywhere; empty month prints zeros and `—`. ux review: amounts via the app formatter (`₺8.250,00`), plural tone. After X P3-2 the restore sentence reads `Gerekirse dosyayı portalı kuran kişi açar; …` (better Turkish, accepted). **Amendment (decision 1 below):** for an empty month the attendance CSV lists members at 0/0 and is not header-only. |
| 9 Attendance CSV | PASS | e2e: the header equals `/raporlar/csv` byte for byte (BOM included); the boundary counts are right. |
| 10 Homework CSV | PASS | e2e: the columns; exactly three rows `Zamanında, Geç, Gecikti`; singers the assignment isn't for are not listed. The deviation is accepted: `Son tarih`/`Teslim tarihi` use `formatAuditDateTime`, which includes the year, because auditors read the file outside its month. **Test gap (backlog 4):** the cell values of `Ödev`/`Teslim tarihi`, the sort and the absence of feedback are checked by code reading only (`homeworkDueBetween` never selects `feedback`, backend review). |
| 11 Finance CSV | PASS | e2e: byte-identical to `/finans/rapor/csv` for January 2025. Implementation notes: 7 route responses are byte-identical before and after the builder move. |
| 12 Dues CSV | PASS | e2e: the rows equal `/finans/aidat/csv` with the period prepended (3 rows); header-only for an empty month. |
| 13 Size guard (gate) | PASS | Code: `MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024`, checked before `sendMail`; the message is the D4 text. A dev send is 94 KB. |
| 14 Recipients | PASS | e2e: first save → toast, normalised inputs, audit line, no notice; a change → one notice to old and new, not logged as a run; an identical save → nothing (now waits for the action response, U P2-4); empty / `x@` / six addresses / yk@ each refused with the right message, value unchanged. Row 1 is now described by the list error. prod-e2e: without SMTP, the change is kept and the warning shown. Change-notice body after X P3-3/4: `Güncel alıcı listesi:` and `Listeyi buradan görebilirsiniz:` (accepted). |
| 15 Access (D2) | PASS | e2e: korist@ ends on `/` with no heading and no `/profil` link; sef@ and yk@ get the page and the link. Backend review: no recipient address, Kurulum or Geçmiş in the member's response body. |
| 16 Page layout | PASS, **copy amended** | e2e ×4 (sef@/yk@, light/dark): no horizontal scroll with a 48-character address; four Kurulum rows with no secret value; the README line and passphrase reminder; role controls; every control 44 px; axe clean, including on the open dialog. Durum: not configured, pending, running, sent with `Sonraki gönderim … sabah 08:00–09:00 arası`, and failed with the retry line. The `Profil` back link is present. **Accepted review changes:** a şef-only `Alıcı ekle` link in Durum for the first run (X P2-1); the board's empty list reads `Henüz alıcı yok.` (X P2-2); the board's hint ends `bu yüzden listede yalnızca yönetimdeki kişiler olmalı.` (X P2-3). |
| 17 Şimdi gönder | PASS, **copy amended** | e2e: dirty warning; the dialog names the count, month and addresses with focus on `Vazgeç`; while pending, both buttons are disabled, `Gönderiliyor…` shows, Escape is ignored and focus is kept; toast `Gönderildi: 2 adres.`; one `.eml` with the manual subject and paragraph; `Elle · Demo Şef` row first; focus lands on the result line; the button is disabled during the cooldown; a direct call in the cooldown → message, no `.eml` and no row; yk@ refused; a running send → Durum says so and a direct call is refused. **Accepted change (X P2-4):** right after a send, one line, `Gönderildi: n adres. <m> dakika sonra yeniden gönderebilirsin.`, instead of three messages; the cooldown verb is `gönderebilirsin` everywhere. |
| 18 Manual covers month | PASS | e2e: after the manual send, the cron for `2026-09` is `skipped`. |
| 19 Run log | PASS | e2e: one row per status, newest first, with labels `Gönderiliyor, Gönderilemedi, Yarıda kaldı, Gönderildi`; the unreaped stale row explains itself; `… · Otomatik` and `184 KB · 3 adres`; a 200-character unbroken error wraps inside the viewport; 15 runs → 12 plus the footnote; both empty states (the one with recipients names `22 Eki 2026` from `nextSendAt`, D1). The wording for an older stale row is in decision 2 below. |
| 20 Banner | PASS | e2e: (b) for sef@ and yk@ (today is the 21st); (a) above the hero for both; (a) from an unreaped stale cron run; no banner from a failed *manual* run or from an older month's failure; no banner with recipients created this month; gone after a covering `sent` row; korist@ never; 44 px link; axe clean in both themes. Rule (b) now reports itself as SKIPPED on days 1–2 instead of passing silently (U P2-5). The banner query starts early and runs as one statement (U P2-2). |
| 21 Not configured | PASS | e2e: sef@ sees the `<aside>` with no role, between greeting and hero; yk@ and korist@ don't; gone after saving. |
| 22 Missing SMTP | PASS | prod-e2e: Kurulum `E-posta hesabı` shows `Eksik`; a manual send logs `E-posta hesabı ayarlanmamış (SMTP_USER, SMTP_PASS). README: "Aylık yedek e-postası".`; `/` still loads. |
| 23 Missing passphrase | PASS | prod-e2e: unset → the AC 23 message. Code: the passphrase check runs first (`run.ts:168`), before SMTP (`:170`). |
| 24 Mapped errors, no leak | PASS | prod-e2e: 4 failed rows, none holding a secret value (the dev run had 0 failed rows to check, so prod is the real evidence). Backend review: six fixed constants, `describeError` redaction, `command` is always a fixed verb. B P2-2 fixed: the redaction now also covers the space-stripped App Password and the normalised passphrase. B P3-4: an overall 45 s send budget keeps a trickling server inside `maxDuration`. |
| 25 Dev values refused | PASS | prod-e2e: the dev `CRON_SECRET` → 503; the dev passphrase → the AC 23 message; Kurulum marks both `Eksik` with the reason. e2e AC32: `.env.development` holds exactly the two values plus a comment. |
| 26 No partial sends (gate) | PASS | Code: passphrase → SMTP config → build → size guard, and `sendMail` is the last statement in the `try`. After B P2-1, a delivered email can never be recorded `failed`: at worst it stays `running` and is reaped (at-least-once, D7). |
| 27 One dump format | PASS | The Phase 6 AC39 test is still green inside 657/657. Implementation notes: the `db:backup` output is identical apart from session rows written in between. `db:backup` now writes with `wx`/0600. |
| 28 Encryption format | PASS | e2e: two manual sends (the first backdated past the cooldown, D3, cooldown untouched); both start with `ARKHE-BK1` and differ; no member email in the bytes. Backend review: the header is the AAD, salt and IV are fresh per file, the tag is checked before gunzip. After B P3-3, decrypt accepts only the known parameter set (log2N 14–18, r 8, p 1). |
| 29 Scripts | PASS | e2e: wrong passphrase and one flipped byte → exit 1, the message, no file; a second decrypt refuses to overwrite; `db:restore` refuses an existing target, `libsql://` and an encrypted input. After D P2-1, `db:restore` also refuses a dump that doesn't end in `COMMIT;`, restores nothing from 0 tables, and fails on any orphan row, removing the partial file in every case (drilled by the fixer). Neither script loads an env file (`package.json`, backend review). |
| 30 Restore drill | PASS | e2e: decrypt with the dev passphrase → `db:restore` into `data/` → `db:check` `migrations=8/8`; the counts match the live DB at send time (`users 27, attendance 209, submissions 22, finance_entries 49`); files removed. prod-e2e: `?bugun=2020-01-01` is ignored (no `2019-12` run). |
| 31 README (gate) | PASS | I read `Aylık yedek e-postası` end to end. It covers what is sent and the retry/abandon rule, setup steps 1–7 (Gmail App Password, passphrase in two places, the loss and rotation note, `openssl rand -hex 32`, Production-only and typed by hand, first send, restore drill), the decrypt and restore commands with cleanup, the migrate-forward note, the real-incident pointer, Turso's 1-day PITR, the cron window, the unencrypted-CSV note, and "Gmail girişi reddedilirse" with Brevo/Yandex as the last step and the third-party and free-terms warning. A volunteer can follow it. |
| 32 Env files | PASS | e2e ×4: `.env.example` lists the seven keys with `SMTP_*` commented out; `.env.development` is exact; `.gitignore` has `!.env.development` and `/data/outbox/`; the e2e script loads `.env.development` first. |
| 33 No secret (gate) | PASS | My grep over the working tree (excluding `node_modules`, `.next`, `data`, `design`): no `SMTP_PASS=` value; no quoted 4×4 app-password pattern; `BACKUP_PASSPHRASE=`/`CRON_SECRET=` only with the `dev-only-` values. The backend review's grep agrees. |
| 34 Free tier, duration (gate) | PASS | `backend.md` §12: about 120 reads a month for skipped calls, at most 50 k per send, fewer than 10 writes a month. Measured dev send: **191 ms**, 94 KB. `maxDuration = 60` on the route and on `yedek/page.tsx` (backend review). |
| 35 Migration safety | PASS | The DBA drill (see verdict). e2e: `db:check` `migrations=8/8` on the restored copy. |
| 36 No regression | PASS | 657/657, with all Phase 1–6 suites green. The finance CSV routes are byte-identical. Nonce CSP on `/yedek` ×4; `no-store` on the cron route; the prod CSP walk has 0 violations. U P2-1's `ConfirmDialog` change touches 9 other callers, and their phase suites pass in the full run. |
| 37 Final runs | PASS | 657/657, 44/44, lint and typecheck clean, `ƒ` for both new routes in the build table. |
| 38 Team review | PASS | Four reviews, 0 P1, 13 P2, all fixed (`review-fixes.md`). The D11 grep is recorded in `review-backend.md`, and I re-ran it: only `finance/queries.ts` and `backup/reports.ts` import `queries-internal`. The only `"use server"` file exports exactly two actions, both checking `canManageBackup` first. |
| 39 First real run | — | Post-deploy gate for the user (§4, steps 9–11). |
| 40 Throttles | PASS | e2e: the 11th recipient change in a day → `Alıcılar bugün çok sık değişti.`, nothing written; the 7th manual send in an hour → `Çok fazla deneme.`, no run row. |

## 2. Decisions on the open items

1. **AC 8: the attendance CSV for an empty month keeps its 0/0 rows (AC amended).**
   - ux, ui and backend all recommend this. It is the same file `/raporlar/csv` gives for an empty period, and AC 9 asks the two to match.
   - A treasurer comparing the mailed file with the in-app export must never see two different answers for the same month.
   - A list of every member at `0/0` also reads correctly: "no rehearsals this month".
   - New wording for AC 8's zero-data bullet: *"The homework, ledger and dues CSVs are header-only; the attendance CSV lists current members with `Geldi 0`, `Beklenen 0` and an empty `Yüzde`, exactly as `/raporlar/csv` does for an empty period. The attachment list is always the same five files."* The e2e already asserts this. `po-spec.md` is updated.
2. **UI P3-2: stale-row wording for an older, abandoned month.**
   - **Decision:** the retry sentence is shown only when the row's month is the current target (the previous calendar month). For any older month the row reads only `Gönderim yarıda kaldı.` Under D7, an older month will never be retried, and the app must not promise what it won't do.
   - **Not blocking:** it needs a function killed past the stale threshold *and* a month rollover with no send since, so it is rare in practice. It is also harmless: the banner and Durum already tell the truth about the current month.
   - It is **backlog item 1**: one condition in `run-log.tsx` plus one e2e check. I'd like it in the first small release.
   - AC 19 is amended with the rule.
3. **AC 7: `From` with or without quotes. Accepted (AC amended).**
   - nodemailer writes `Arkhe Portal <outbox@arkhe.local>`. A display name without specials needs no quotes in RFC 5322, and every mail client shows the same "Arkhe Portal".
   - A deployer-supplied `SMTP_FROM` with a quoted name is accepted as is.
   - AC 7 now reads "display name `Arkhe Portal`, quoted or not". The e2e already accepts both.

## 3. Deviations accepted during implementation

- The mail transport lives in `src/lib/backup/mail.ts`, not `src/lib/mail/send.ts`: nothing else sends mail.
- The `;` in the recipients CHECK is written as `char(59)`. The DBA verified it is semantically identical, and the comment explains why.
- `setup.passphrase` is `ok | missing | invalid`, which drives the reason line. Still no value or length leaves the server.
- The homework CSV dates include the year (see AC 10).
- `SMTP_FROM` accepts a quoted display name. `SMTP_USER`/`SMTP_FROM` validation stays loose, because it is deployer-only input (B P3-7, backlog).
- The cron route answers `500 {"status":"failed"}` when the DB is down before the claim. Nothing leaks, and Vercel shows the call red.
- A partial RCPT rejection records the accepted count. Which addresses were rejected is not stored, because AC 24 forbids logging addresses.

## 4. Go-live steps (only the user can do these)

Do them in this order, on one evening. None of them needs a card or a paid plan.

1. **Commit now, push in step 7. Both are yours.**
   - Review the diff, then commit with your personal repo-local identity.
   - **Push only in step 7**: Vercel deploys on push, the new code needs migration 0007 (step 2), and the env vars (step 6) must be in place before that deploy.
   - `.env.development` is meant to be committed (D9). No `.env` is committed.
2. **Back up and migrate Turso** from the laptop:
   - Create a short-lived Turso token.
   - In one shell, `read -rs DATABASE_AUTH_TOKEN` and export it together with `DATABASE_URL`.
   - Run `npm run db:migrate`. It takes a backup first, then migrates, then runs `db:check`, which must show `migrations=8/8`.
   - Keep the backup file it wrote on the laptop.
   - The migration is safe while the old code is still live (DBA drill).
3. **Create the Gmail App Password** on the choir Gmail account (README step 1): 2-Step Verification on, App password `Arkhe Portal`.
4. **Generate the passphrase** with `openssl rand -base64 24`.
   - Store it in **two places outside Vercel**, for example your password manager and a sealed paper copy with the board president.
   - Without it, every backup is useless.
5. **Generate `CRON_SECRET`** with `openssl rand -hex 32` (64 characters). Anything under 32 characters is refused in production.
6. **Set the Vercel env vars**: `SMTP_USER`, `SMTP_PASS`, `BACKUP_PASSPHRASE`, `CRON_SECRET`, and optionally `SMTP_FROM`.
   - Mark them Sensitive/Secret and **Production only**.
   - Type or paste them only into the Vercel dashboard: never into chat, a file or a commit.
   - Don't set `SMTP_HOST`/`SMTP_PORT` unless Gmail refuses.
7. **Push to deploy** (step 1). Then check:
   - Vercel → Settings → Cron Jobs lists `/api/cron/aylik-yedek` daily at 05:00 UTC.
   - `curl -i https://arkhe-beta.vercel.app/api/cron/aylik-yedek` answers **401** `{}`. A 503 would mean `CRON_SECRET` is missing or too short.
8. **Save the recipients on `/yedek`** as the şef:
   - Use 1–5 board addresses: the şef, the board president and the treasurer.
   - Kurulum must show four `Tamam`.
9. **First real email (September 2026):** press `Şimdi gönder`.
   - Check that it reaches every recipient, look in spam once and mark it "not spam".
   - Open one CSV on a phone and check that Turkish characters and `₺` amounts are right.
   - If you don't press it, the cron sends September by itself the next morning between 08:00 and 09:00 (D1).
   - If Geçmiş shows `Gmail girişi reddedildi`, follow "Gmail girişi reddedilirse" in the README.
10. **Restore drill (AC 39)** on that attachment, on the laptop:
    - `npm run db:decrypt`, then `npm run db:restore` into `data/`, then `DATABASE_URL=file:… npm run db:check` → `migrations=8/8`.
    - Then delete the `.sql` and the restored DB.
    - This also proves your stored passphrase matches Vercel's.
11. **Tell the tech lead the date** steps 9–10 passed, so `STATUS.md` records Phase 7 as live.
12. **On 1 November**, check that the automatic October email arrived and that no banner is on the home page. After that, the only routine is to keep the emails.

## 5. Consolidated backlog (after go-live; replaces the list in `phase-6/review-po.md`)

Phase 8 adds items 17–27 in `design/phase-8/review-po.md` §5. Together they are the single backlog.

Ordered by value to the choir. Items 1–5 are a good first small release, once the choir has used the portal for a few weeks. Nothing else should be built until someone asks for it.

1. **Stale-row wording for an older month** (UI P3-2, decision 2): the retry sentence only for the current target month, plus one e2e check.
2. **Choir photo is public by URL** (Phase 6 backend P3-6). Move it to `src/assets/` or remove it unless the board has confirmed consent.
3. **`Tekrar dene` resumes the same page** (Phase 6 ux P3-6 / ui P3-13), plus a copy check.
4. **Phase 7 test gaps** (U P3-7.3 rest, P3-7.4, P3-7.7):
   - the leak check on the empty-month email
   - the AC 10 `Ödev`/`Teslim tarihi` cells, the sort and the absence of feedback
   - the AC 24 dev message wording
5. **Disabled period trash gives no feedback on touch** (Phase 6 ux P3-3), and **the replay message lists unpaid periods** (Phase 6 backend P3-2).
6. **Recipient confirmation** (B P3-8): echo the saved list in the success toast, and add a README line to check the choir Gmail for bounces once. Bigger mechanisms only if a typo ever costs us an email.
7. **Async scrypt** in the run and the script (B P3-2). Today it blocks the event loop for about 0.5 s once a month; harmless at our scale.
8. **Deployer-input validation:** `SMTP_USER`/`SMTP_FROM` (B P3-7); dev values with a remote `DATABASE_URL` and `SQLITE_BUSY` on concurrent saves (B P3-9 rest); `APP_URL` must be `https` when `VERCEL`/`RENDER` is set (Phase 6 backend P3-9).
9. **Free-tier protection:** stop growing `login_attempts` once a login is blocked, prune on every attempt, add a README line on watching Turso usage, and key IPv6 per-IP buckets by /64 (Phase 6 backend P3-7/8). Phase 7's throttles also write to `login_attempts`, which makes pruning a little more relevant.
10. **Service worker hardening** (the Phase 6 list): `isCacheable` refuses redirected, HTML and RSC responses; `waitUntil` for cache writes; navigation preload; the kill switch reloads tabs and needs a README note; re-registration after a kill; the content-type audit.
11. **Brand polish** (Phase 6): the 16 px `icon.svg`, a lockup `density` prop, the offline monogram cut, housekeeping.
12. **DB:** restore `sqlite_sequence`; `db:check` compares the last migration's identity, not just the count (Phase 6 db P3-1/P3-4).
13. **`/profil` `InstallCard` hydration warning at the mobile viewport** (U P3-8; predates Phase 7).
14. **Test harness:** the Phase 4 AC10 flake during a Turbopack recompile.
15. **Out of scope by decision, revisit only on request:**
    - the passphrase id (D13)
    - re-sending an abandoned month or choosing the month (D7)
    - a weekly backup-only email (P4)
    - a dynamic `/profil` hint
16. **Deferred by earlier phases, still open**:
    - Phase 6 `po-decisions` §5: the ` (kendisi)` suffix, a `removeWaiver` audit trail, `CSPProvider`/zod `jitless`, COEP/CORP, HSTS preload, a rate limit on `/api/saglik`
    - Phase 5: #6, ux P3-3/7/8/9/10, ui P3-5…10, and `po-decisions` §4 (dues table view, sponsor picker, treasurer role, un-void, charts)
    - Phases 2–4: the late-poll flicker, lost sectional ticks, the wake-lock indicator, freezing reports at close, the optimistic-lock `version` column, and the Phase 3 polish list

## 6. Process note

Phase 7 is **accepted**. It becomes **live** when the user completes §4 steps 1–10 and the tech lead records the date in `STATUS.md`.

Phase 8 (the board kanban, and budget plan vs actual) may start its spec now. Its build should not be deployed before Phase 7 is live, so that the first production migration after go-live has a monthly backup behind it.
