# Phase 7 backend review

Reviewer: arkhe-backend (as reviewer, read-only on `src/`). Date: 2026-10-21.
Read: `po-spec.md`, `po-decisions.md`, `implementation-notes.md`, `backend.md`, `db.md`, and all Phase 7 server code listed in the brief.

**Result: 0 P1, 2 P2, 9 P3.** Nothing here blocks acceptance. Authorization, secret handling, the crypto format, the claim and production's refusal of the dev values all hold up, both in the code and against the running dev server. P2-1 was reproduced: a finish write that fails after the email has left marks the run `failed`.

## 1. What I checked and how

### Authorization on every entry point (run against 127.0.0.1:3100)
For these probes I inserted throwaway sessions for sef@, yk@ and korist@ directly in `sessions`, then deleted them. Server actions were called directly with `Next-Action` ids from the dev manifest, the way a crafted request would call them.

| Entry point | no session | korist@ (member) | yk@ (board) | sef@ (conductor) |
|---|---|---|---|---|
| `saveBackupRecipients` | `Bu ayarı yalnızca koro şefi değiştirebilir.` | same | same | allowed |
| `sendBackupNow` | `Bu işlemi yalnızca koro şefi yapabilir.` | same | same | allowed |
| `GET /yedek` | 307 → `/giris` | `NEXT_REDIRECT;replace;/` (HTTP 200 because of streaming with `loading.tsx`, same as the other manager pages); the body contains no recipient address, `Kurulum` or `Geçmiş` | page | page |
| `GET /api/cron/aylik-yedek` | no header → 401 `{}`; `Bearer wrong` → 401; `POST` → 405; `HEAD` → 401 | n/a (bearer only) | n/a | n/a |
| `/finans/rapor/csv`, `/finans/aidat/csv` (builders moved) | 401 | 403 | (e2e) | (e2e) |
| Home banner | n/a | `backupBannerState` returns null before any query (`queries.ts:155`) | failed/overdue only | adds `setup` |

- None of the refused calls wrote a row or consumed a throttle attempt, because the role check comes before parsing and before `consumeAttempt` (`actions.ts:55-56`, `134-135`).
- `getSessionUser` filters on `users.is_active` and reads the role fresh from the DB on every call. A demoted or deactivated conductor therefore loses both actions at once.

### D11: who imports `queries-internal`
```
$ grep -rn "queries-internal" src scripts e2e
src/lib/backup/reports.ts:7:  import { ledgerRowsBetween, loadDuesMatrix, monthTotals } from "@/lib/finance/queries-internal";
src/lib/finance/queries.ts:36: } from "./queries-internal";
src/lib/finance/queries.ts:38: export type { DuesCell, DuesMemberRow, DuesPeriod } from "./queries-internal";
```
- Only the two allowed modules import it, and it starts with `import "server-only"`.
- `csvEntries` (`queries.ts:434`), `duesMatrix` (`:487`) and `monthSummary` (`:69`) still call `requireManager()` first.
- The only `"use server"` file in Phase 7 is `yedek/actions.ts`, and it exports exactly two functions. Both check `canManageBackup` first.
- `runMonthlyBackup` has exactly two callers: the cron route after `bearerMatches` (`route.ts:43`) and `sendBackupNow` after the role check (`actions.ts:144`).
- `buildReports`, `loadRecipients`, `homeworkDueBetween` and the `run.ts` helpers are unguarded. They live only in `server-only` or non-action modules, which is the existing project pattern.

### AC 33 grep (secrets in the repo)
- `SMTP_PASS=` appears only commented out in `.env.example:35`.
- `BACKUP_PASSPHRASE=` and `CRON_SECRET=` hold only the two dev values, in `.env.example`, `.env.development` and the e2e/design files.
- No `[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}` pattern in any env file.
- `.env.development` contains exactly the header comment and the two keys.
- `.gitignore`: line 34 `.env*`, line 37 `!.env.development`, `/data/` (which covers `data/outbox/`).

### Secrets and production refusal (code review)
- `config.ts:9-14`: `CRON_SECRET` counts as missing when it is empty, or in production when it is under 32 characters or equals the dev value.
- `config.ts:22-28`: the passphrase is trimmed and NFC-normalised before the length check and before the dev-value comparison.
- `config.ts:46`: SMTP is never used outside production, and production never uses the outbox.
- `next build`/`next start` don't load `.env.development`.
- The scripts load no env file: `package.json` has no `--env-file` on `db:decrypt`/`db:restore`.
- `setup` exposes only states and booleans.
- `describeError` logs `name`/`code`/`responseCode`/`command` plus a message capped at 500 characters, with secrets and every address redacted. I checked `smtp-connection/index.js:908-935` in nodemailer 10.1.7: `command` is always a fixed verb (`AUTH PLAIN`, `RCPT TO`, ...), never an address. Gmail's response text is appended to `message`, and the address regex covers it.
- The cron route's own catch logs only `name`/`code`.

### Crypto
- The 41-byte header (`ARKHE-BK1`, KDF id, log2N/r/p, 16-byte salt, 12-byte IV) is the AAD.
- Every file gets a fresh random salt, so every file gets a fresh key. The random 12-byte IV therefore never repeats under one key: the nonce-uniqueness concern doesn't apply.
- The tag is checked in `final()` before any plaintext is used or gunzipped. gunzip is capped at 1 GiB.
- The KDF params are capped on decrypt, but the cap is loose (P3-3).

### Claim, idempotency, at-least-once
- The cron claim (`run.ts:47-50`) checks "no sent and no running row" and the manual claim (`:54-59`) checks "no running row and no cooldown". Each runs in one write batch after the reap, with the partial unique index `backup_runs_running_idx` as a backstop.
- Vercel's occasional duplicate cron delivery and two concurrent calls both resolve to one claim.
- A function killed past `maxDuration` leaves the row `running`. The row is reaped after 600 s, and the next day retries (D7).
- The exception is P2-1: when the finish write fails, the run is marked `failed`, not left `running`.

### Header injection and wrong-address risks
- `to` is always an array of strings that each passed `RECORDING_EMAIL_RE` (`^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$`), once on save and again in `splitRecipients` on read. The DB CHECK also refuses space, `<>"`, tab, CR, LF and `;`. None of these can split a header or form an address group.
- The subject holds only the month label (plus the fixed manual suffix). The actor's name appears only in the plain-text body.
- Attachment names are built from the month and the Istanbul date/time only.
- `disableFileAccess`/`disableUrlAccess` are set on every message.
- Data can only go to an address the conductor saved, and every change of that list emails the old and the new addresses. The remaining risk is a typo, which nothing confirms (P3-8).

### Timezone (Europe/Istanbul)
- `monthBounds` uses `istanbulToUtc` for the instant bounds (attendance, homework) and plain days for the ledger (`occurred_on`).
- The report month comes from `istanbulDateOf`. Attachment stamps use `istanbulDateOf`/`istanbulTimeOf`. The banner's `firstOfThisMonth` is `istanbulToUtc`.
- `nextSendAt` anchors on 05:00 UTC, the cron's fixed instant, so it is correct across the Istanbul date line.
- No timezone bugs found. One cosmetic issue is listed as P3-6.

### SMTP timeouts vs `maxDuration`
- nodemailer 10's `connectionTimeout` (10 s) covers DNS, connect and greeting together (`smtp-connection/index.js:216-224, 400-406`).
- `socketTimeout` (20 s) is an idle timer per stage. A hung server therefore fails within roughly 10–30 s, inside 60 s, as AC 24 requires.
- A server that trickles responses could still exceed 60 s (P3-4).
- `maxDuration = 60` is set on `route.ts:10` and `yedek/page.tsx:14`. `node_modules/next/dist/docs/.../maxDuration.md` confirms that a page-level `maxDuration` applies to the page's server actions.

## 2. Findings

### P1
None.

### P2

**P2-1. A delivered email is recorded as `failed` when the finish write fails.** `src/lib/backup/run.ts:176-177` (inside the `try`) and `:98-109`.
- **Scenario:** `sendMail` succeeds, then `finish(id, "sent")` throws (a Turso blip, `SQLITE_BUSY`, or the retention `delete` in the same batch failing). The `catch` at `:180` then:
  - logs `backup run failed`
  - writes `failed` with `Beklenmeyen bir hata oldu…`
  - returns `failed`, so the cron answers 500 and a manual send shows `Gönderilemedi`
- **Consequences:** the board sees a red Durum card and a failure banner for a month whose email arrived. With no `sent` row there is no cooldown either, so the conductor is invited to press `Şimdi gönder` again and send a duplicate right away. This contradicts D7, which says the row "stays `running`, gets reaped".
- **Proof:** I added a temporary trigger that aborts only `status='sent'` updates for `report_month='2031-06'` and called the cron with `?bugun=2031-07-01`:
  - the response was `{"status":"failed"}` with HTTP 500
  - the run was stored as `failed|Beklenmeyen bir hata oldu…`
  - the outbox **did** gain `…-aylik-yedek.eml`

  I dropped the trigger and removed the row and the `.eml` afterwards.
- **Fix:** move the post-send bookkeeping out of the `try`, and run retention as a separate statement whose failure is only logged:
  ```ts
  try { /* build, encrypt, size guard */ await sendMail(...); }
  catch (e) { /* log, finish failed, return failed */ }
  try { await finish(id, "sent", size, null); }
  catch (e) { console.error("backup sent but not recorded", describeError(e, [])); } // row reaped as stale; D7
  return { result: "sent", recipients: to.length };
  ```

**P2-2. The change-notice error log can miss the App Password in the form nodemailer actually used.** `src/app/(portal)/yedek/actions.ts:121-126`.
- **Scenario:** `SMTP_PASS` was pasted with Google's spaces (`abcd efgh ijkl mnop`). The transport authenticates with the stripped form (`config.ts:49`), but this redaction list holds only the raw value with spaces. Any error text that echoes the credential in its used form would reach the log unredacted. `run.ts:187` handles this correctly with `smtp.pass`. Today nodemailer doesn't echo the password, so this is defence in depth, but AC 24 requires "every secret".
- **Fix:** add a single helper next to `describeError`, for example `redactionSecrets(env)` in `config.ts`, returning:
  - the raw `SMTP_PASS`
  - the stripped `SMTP_PASS`
  - `SMTP_USER`
  - `BACKUP_PASSPHRASE`, raw and normalised
  - `cronSecret(env)`

  Use it in `run.ts:184-191` and `actions.ts:121-126`, so the two lists can't drift apart.

### P3

**P3-1. A rejected RCPT is still logged as a full `sent`.** `src/lib/backup/mail.ts:53`.
- nodemailer resolves when at least one recipient was accepted. `info.rejected` is ignored, so `recipient_count` and `Gönderildi: n adres.` overstate the delivery.
- **Fix:** capture `const info = await transport.sendMail(...)`. If `info.rejected.length`, log `backup mail rejected for <n> recipients` (the count only).
- Optionally, treat "all rejected" as `failed`; nodemailer already throws in that case.

**P3-2. `scryptSync` blocks the event loop on a request path.** `src/lib/backup/crypto.ts:20`.
- N = 2^17 with r = 8 uses 128 MiB and takes about 0.3–1 s. With Fluid compute, other requests on the same instance stall for that long.
- **Fix:** use the async `scrypt` (it runs on the libuv pool) and make `encryptBackup`/`decryptBackup` async. The scripts already `await`.

**P3-3. The decrypt cap still lets a crafted header ask for about 2 GiB.** `src/lib/backup/crypto.ts:57`, with `maxmem` at `:24`.
- log2N ≤ 20, r ≤ 16 and p ≤ 4 give 128·2^20·16 = 2 GiB, and 4× the CPU. Only local `db:decrypt` is exposed, but nothing ever writes other parameters.
- **Fix:** accept exactly `kdf === 1 && log2n === 17 && r === 8 && p === 1` until a format v2 exists, or at most log2n ≤ 18 and r = 8, p = 1.
- **Related:** a damaged header byte prints `Unsupported backup format.` or `Not an Arkhe backup file.`, not AC 29's `Wrong passphrase or damaged file.` The exit code is still 1 and no file is written. Consider mapping both to the AC text.

**P3-4. There is no overall deadline on the SMTP send.** `src/lib/backup/mail.ts:38-56`.
- Each stage resets the 20 s idle timer, so a slow-dripping server can run past 60 s. Vercel then kills the function, and the row is reaped later (accepted by D7).
- **Fix:** race `transport.sendMail` against a timer for whatever is left of a budget of about 45 s from the run's start. On expiry, call `transport.close()` and throw `{ code: "ETIMEDOUT" }`, so it maps to `connection` and the row is finished as `failed` instead of being left `running`.

**P3-5. A lost claim race is reported as a cooldown.** `src/lib/backup/run.ts:66-69` and `:128-135`.
- When the manual claim loses to `SQLITE_BUSY`/`SQLITE_CONSTRAINT` while no fresh run exists and there is no cooldown, the user reads `Az önce gönderildi. 1 dakika sonra…`.
- **Fix:** if `cooldownLeft()` is 0, return `refusal: "running"` (the generic "try again in a few minutes" text).

**P3-6. `nextSendAt` names tomorrow during today's window.** `src/lib/backup/schedule.ts:48-51`.
- Between 05:00 and 06:00 UTC, before Vercel has fired, `Sonraki deneme` names tomorrow, though today's call may still come. On the last day of a month, `deneme` names the 1st, which targets a different month.
- **Fix:** keep today while `now < 06:00 UTC` (the end of the window). The second case is cosmetic only.

**P3-7. `SMTP_USER` is not validated, and `SMTP_FROM`'s unquoted display name accepts `,`, `@` and `:`.** `src/lib/backup/config.ts:40, 47, 55`.
- `SMTP_FROM='a@x.org, Arkhe <koro@gmail.com>'` passes the check and becomes a two-address `From`. Only the deployer sets these variables, so this is not exploitable, but a typo produces a confusing From and envelope.
- **Fix:** require `BARE_ADDRESS.test(user)`, or treat SMTP as `missing`. Restrict the unquoted name to `[^"<>\r\n,;:@]`.

**P3-8. Nothing confirms that a new recipient address is real.** `src/app/(portal)/yedek/actions.ts:69-102`.
- A typo receives the change notice, which lists every board address, and every monthly email after it. Bounces land in the choir Gmail, which nobody reads.
- **Fix (backlog):** show the saved list back in the success toast. Optionally, mention bounces in README step 6 ("check the choir Gmail's inbox for delivery failures once"). No new mechanism is proposed for this phase.

**P3-9. Small hardening items.**
- `src/lib/backup/mail.ts:33`: outbox `.eml` files are written 0644 and carry the plain CSVs. Use `{ flag: "wx", mode: 0o600 }`, as `db:decrypt` does.
- `src/lib/backup/config.ts:26`: outside production the public dev passphrase is accepted even when `DATABASE_URL` is remote. A `next dev` pointed at Turso would write real data, encrypted with a public passphrase, to `data/outbox/`. Consider treating the dev values as invalid whenever `DATABASE_URL` doesn't start with `file:`.
- `src/app/(portal)/yedek/actions.ts:89`: the deferred transaction can throw `SQLITE_BUSY` if two saves collide. That leaves a generic error page, and the save is retryable. Acceptable with one conductor. Optionally, catch it and return `{ error: "Kaydedilemedi, yeniden dene." }`.

## 3. Replies

- **@ui (attendance CSV for an empty month):** I agree it should stay consistent with `/raporlar/csv` (AC 9). Filtering out the zero rows would make the two exports disagree for the same period. @po, I suggest amending AC 8's "header-only" wording to except the attendance file. No code change.
- **@tech lead:** P2-1 is the only finding that changes behaviour a user would notice. It is a small, contained edit to `run.ts`. P2-2 is a two-line helper.

## 4. Cleanup
- The three review sessions are deleted.
- The `2031-06` run row, its `.eml` and the temporary trigger are removed.
- No `backup-%` attempts were created.
- The `sef@arkhe.local` recipient row and the `2026-09` manual run seen in the DB during the review were created by another agent at 12:00 UTC. I left them alone.
