# Phase 7 implementation notes

## Backend (arkhe-backend)

Date: 2026-10-21. Implements `backend.md` as amended by `po-decisions.md` (D1–D16) and `db.md`. The page UI is not built here: `src/app/(portal)/yedek/page.tsx` is a placeholder (heading + `maxDuration = 60`) for the UI engineer.

### What was built

- **Migration `0007_phase7_backup`**: `backup_runs` (3 indexes, 8 CHECKs, exactly `db.md` §1.1), and the `app_settings` rebuild with `created_at` and the `backup_recipients` CHECK. One hand edit, as `db.md` §3.1 asks: the copy statement selects `"updated_at"` twice, so `created_at` is backfilled from `updated_at`. Applied to `data/arkhe.db` with `npm run db:migrate` (backup → migrate → `db:check` = `migrations=8/8`). A second `drizzle-kit generate` reports "No schema changes".
- **Dependency**: `nodemailer` `10.1.7` exact (MIT-0, ships its own types, so no `@types`). `npm audit` lists nothing for nodemailer.
- **Backup module** `src/lib/backup/`:
  - pure (no `server-only`; `config`, `constants`, `crypto`, `dump` are also loaded by `scripts/`): `constants.ts`, `config.ts` (`cronSecret`, `passphraseState`, `backupPassphrase`, `smtpConfig`, `backupSetup`, `missingBackupVars`), `crypto.ts` (`ARKHE-BK1` format, scrypt 2^17/8/1, header as AAD), `dump.ts` (`dumpDatabase(client)`), `schedule.ts` (`previousMonth`, `nextMonth`, `reportMonthOf`, `monthBounds`, `monthLabel`, `nextSendAt`, `SEND_WINDOW_TEXT`), `messages.ts` (`RUN_ERRORS` fixed map, `BackupError`, `errorKey`, `describeError`), `email.ts` (`monthlyEmail`, `changeNoticeEmail`, `attachmentNames`).
  - server-only: `mail.ts` (outbox `.eml` outside production, Gmail/SMTP with short timeouts in production), `recipients.ts`, `reports.ts` (4 CSVs + body numbers), `run.ts` (`runMonthlyBackup`, claim/finish SQL from `db.md` §1.3/§1.4, `isCovered`, `cooldownLeft`, `isRunningFresh`), `queries.ts` (`loadBackupPage`, `backupBannerState`).
- **Finance split (D11)**: `src/lib/finance/queries-internal.ts` (`server-only`) holds `ledgerRowsBetween`, `loadDuesMatrix`, `monthTotals` and the shared column/alias definitions. `queries.ts` keeps the guarded exports (`csvEntries`, `duesMatrix`, `monthSummary`) as `await requireManager(); return internal(...)`, and re-exports the dues types. Grep: only `src/lib/finance/queries.ts` and `src/lib/backup/reports.ts` import `queries-internal`.
- **Shared CSV builders**: `src/lib/finance/csv.ts` (`LEDGER_HEADER`, `ledgerRows`, `DUES_HEADER`, `duesRows`), `src/lib/homework/csv.ts` (`HOMEWORK_HEADER`, `homeworkCsv`). Both finance CSV routes now call them.
- **Homework**: `homeworkDueBetween(from, to, at)` in `src/lib/homework/queries.ts` (4 flat queries, never reads feedback). `HOMEWORK_STATE_LABELS` in `src/lib/labels.ts`, now also used by `/odevler/matris`.
- **Time**: `formatMonthYear(at)` ("Ekim 2026") and `formatAuditDateTime(at)` ("21 Eki 2026 14:12") in `src/lib/time.ts`.
- **Permissions**: `canManageBackup(role)` (conductor only).
- **Cron route** `src/app/api/cron/aylik-yedek/route.ts`: GET only, `runtime = "nodejs"`, `maxDuration = 60`, `connection()` first, `no-store` on every response, 503 `{}` when the secret is unusable, 401 `{}` on a wrong bearer (SHA-256 digests + `timingSafeEqual`, no DB access before), `?bugun=` only outside production, `{"status"}` with 200/200/500.
- **`vercel.json`**: one cron, `0 5 * * *`.
- **Server actions** `src/app/(portal)/yedek/actions.ts`: `saveBackupRecipients(prev, formData)` and `sendBackupNow()`; nothing else is exported.
- **Boot warning**: `bootWarnings()` adds `Monthly backup email is not fully configured: <names>` in production (names only). `envProblems()` is unchanged, so nothing new can stop the server.
- **e2e `cleanup()`**: deletes all `backup_runs` and the `backup_recipients` row.
- **Scripts**: `scripts/db-backup.ts` is now a thin wrapper over `dumpDatabase` (output unchanged). New `scripts/db-decrypt.ts`, `scripts/db-restore.ts`; npm scripts `db:decrypt`, `db:restore` load no env file. `e2e` loads `.env.development` before `.env`.
- **Config files**: `.env.development` (exactly the two dev keys plus a header comment), `.gitignore` (`!.env.development`, `/data/outbox/`), `.env.example` (the 7 keys, `SMTP_*` commented, the two dev values set), README section `Aylık yedek e-postası` plus two command-table rows.

### Contract for the UI engineer

- `loadBackupPage(): Promise<BackupPage>` from `@/lib/backup/queries` calls `requireManager()` itself. Shape (exported types `BackupPage`, `BackupRun`, `RunStatus`, `PreviousMonthState`, `SendState`):
  - `canEdit` (conductor), `recipients: string[]`, `audit: { name: string | null; at: Date } | null`
  - `setup: { mail: "ok" | "dev" | "missing"; passphrase: "ok" | "missing" | "invalid"; cronSecret: boolean; recipients: number }`. `passphrase` is a state, not a boolean, so the Kurulum row can show UX's reason line for `invalid` (`Çok kısa ya da deneme şifresi; yenisini gir.`).
  - `previous: { month, monthLabel } & ({ state: "sent"; at; recipientCount } | { state: "pending" } | { state: "running" } | { state: "failed"; error: string | null; stale: boolean })`. `stale: true` with `error: null` is an unreaped `Yarıda kaldı`.
  - `nextSend: { at: Date; kind: "gönderim" | "deneme" }` from `nextSendAt()`; render the Istanbul date plus `SEND_WINDOW_TEXT` from `@/lib/backup/schedule`.
  - `send: { kind: "ready" } | { kind: "no-recipients" } | { kind: "running" } | { kind: "cooldown"; minutesLeft }` for the disabled button and its hint.
  - `runs: BackupRun[]` (max 12, newest first; `status` is `running | sent | failed | stale`, `monthLabel` precomputed, `actorName` null for cron or deleted users) and `moreRuns` for the footnote.
- `backupBannerState(user)`: `null | { kind: "setup" } | { kind: "failed" | "overdue"; month; monthLabel }`. Returns null for members before any query; `setup` only for the conductor.
- `saveBackupRecipients`: form field name `recipients` (repeated). Errors as `ui.md` §3: `error` for list-level and role, `fieldErrors["recipients.<i>"]` with `i` = index in the submitted list. Success returns `{ success: "Alıcılar kaydedildi.", values: { recipients: "<canonical comma list>" } }`. **New:** when the change notice fails, it also returns `warning: "Bilgi e-postası gönderilemedi. Eski ve yeni alıcılara sen haber ver."` (added `warning?: string` to `FormState`); show it as a second (warning) toast. The save stands.
- `sendBackupNow()`: `{ success: "Gönderildi: <n> adres." }` or `{ error }` with the AC 17/40 texts. It works with `useRunAction`.
- Run-log times: `formatAuditDateTime`; month labels: `formatMonthYear` / `monthLabel`. `formatBytes` is still yours (`ui.md` §1).
- The page must keep `export const maxDuration = 60`.

### Deviations from the plan, and why

- **Mail transport lives in `src/lib/backup/mail.ts`**, not `src/lib/mail/send.ts`: the tech lead scoped the backup module to `src/lib/backup/*`, and nothing else sends mail.
- **The `;` in the recipients CHECK is written as `char(59)`** (`'*[ <>"' || char(9, 10, 13, 59) || ']*'`). drizzle-kit cut the CHECK text at the literal `;`, which produced broken SQL. The constraint is semantically identical to `db.md` §2.1; verified on a copy that it rejects 6 addresses, uppercase, `;`, a leading/trailing/double comma, a missing `@` and a space.
- **`setup.passphrase` is `"ok" | "missing" | "invalid"`**, not a boolean (UX §3 needs the reason line). Still no value or length leaves the server.
- **Builder names**: `ledgerRows`/`duesRows` return rows; the routes still call `csvDocument`. That keeps the route code nearly unchanged, and the byte comparison passed.
- **Homework CSV dates** use `formatAuditDateTime` ("9 Eki 2026 21:27"), not `formatShortDateTime`: auditors read the file outside its month, so the year matters.
- **Homework CSV row inclusion**: expected singers, plus anyone in the assignment's parts who submitted. A singer outside the parts is never listed (AC 10).
- **`maxmem` for scrypt** is computed (`128·N·r·p + 64 MiB`) instead of a flat 256 MiB.
- **`SMTP_FROM`** accepts a quoted display name (`"Arkhe Korosu" <koro@gmail.com>`), which the plan's regex refused; CR/LF, `<>` inside the name and a bare `"` are still refused.
- **The cron route catches a throw before the claim** (for example the DB down) and answers `500 {"status":"failed"}`, so Vercel shows it red without leaking anything.

### How it was verified

- `npm run lint`, `npm run typecheck`: clean.
- **Finance CSV byte equality**: captured 7 responses as yk@ before any change (`/finans/rapor/csv` default, 2026, 2026-10, 2025-01; `/finans/aidat/csv` for all 3 periods). After the refactor: all 7 bodies byte-identical, and headers identical apart from `Date`.
- **`db:backup`**: output identical to the old script's dump, apart from `sessions` rows written in between.
- **Migration**: applied to a scratch copy first (`foreign_key_check` empty, `integrity_check ok`, both settings kept with `created_at = updated_at`), then `npm run db:migrate` on `data/arkhe.db`.
- **Cron**, with the dev bearer:
  - wrong bearer → 401 `{}`, `no-store`
  - no recipients → `skipped`, no row
  - with 2 recipients, `?bugun=2026-11-01` → `sent`, one `.eml` with 5 attachments (devam, odev, finans, aidat, `.sql.gz.enc` starting `ARKHE-BK1`), subject RFC 2047 `Arkhe aylık rapor ve yedek · Ekim 2026`; the whole run took ~230 ms on dev
  - `?bugun=2026-11-02` → `skipped`
  - two concurrent `?bugun=2026-12-01` → one `sent`, one `skipped`, one `.eml`
  - a `failed` 2026-09 row → retried and `sent`; a 11-minute-old `running` 2026-08 → reaped with the stale message, then `sent`; a 2-minute-old `running` 2026-07 → `skipped`
- **Attachment content**: the finance attachment for 2026-10 is byte-identical to `/finans/rapor/csv?from=2026-10-01&to=2026-10-31`; the attendance header equals `/raporlar/csv`'s.
- **Restore drill** on that attachment: wrong passphrase → exit 1, `Wrong passphrase or damaged file.`, no file; one flipped byte → the same; piped passphrase → `Decrypted: data/backups/…sql` (mode 0600); a second run → `Output file exists: …`; `db:restore` refusals (encrypted input, `libsql://`, existing file) each with their message; restore into `data/drill.db` → `db:check` `migrations=8/8, quick_check=ok`; `users`/`attendance`/`submissions`/`finance_entries` counts equal the live DB.
- **Actions** (called directly as a crafted request would, via a temporary hidden form on the placeholder page, since reverted):
  - sef@: no recipients → `Önce en az bir alıcı kaydet.`; empty → `En az bir adres gir.`; `x@` → `fieldErrors["recipients.1"]`; 6 → `En fazla beş adres ekleyebilirsin.`; `"  P7A@E2E.test "` + duplicates → saved as `p7a@e2e.test,p7b@e2e.test` with no notice; identical save → no write; change → one `alici-degisti.eml` to the union of old and new; send → `Gönderildi: 3 adres.` and a manual `(elle gönderildi)` email; again → `Az önce gönderildi. 10 dakika sonra yeniden deneyebilirsin.`
  - yk@ save/send and korist@ send → refused with the role messages; korist@ on `/yedek` ends on `/`
  - cron `?bugun=2026-10-01` after the manual September send → `skipped` (AC 18)
- **Loader and banner** (temporary JSON dump, reverted), checked in 7 states: setup, overdue, created this month (no banner), failed cron for M, stale running for M, sent + cooldown (`minutesLeft: 9`, `nextSend` = 1 Kas 05:00 UTC `gönderim`), and 15 rows (12 + `moreRuns`).
- **Config in production mode** (tsx): the dev values count as missing/invalid; a 9-character `CRON_SECRET` → null; App Password spaces stripped; a malformed `SMTP_FROM` → default plus one warning; `SMTP_*` ignored outside production; boot warning names the four variables.
- **SMTP error mapping** against real nodemailer errors: refused connection → `ESOCKET` → `connection`; a fake server answering `535` → `EAUTH` → `auth`; the logged message has the address replaced by `[redacted]`.
- **e2e** (existing suites; phase-7 suites are the UI engineer's): the first full run gave 520/521, with `phase4` AC10 getting two empty action responses right after I edited `config.ts` mid-run (a dev recompile). `npm run e2e -- phase4` alone → 112/112, and a second full run with no edits in between → **521/521**, including `phase5-finance`, `phase6-c-finance` (CSV routes) and `phase6-b-security` (`db:backup`).
- All test rows, outbox files, decrypted dumps, the drill DB and the two debug sessions were removed afterwards.

## UI (arkhe-ui)

Date: 2026-10-21. Implements `ui.md` as overruled by `ux.md` and `po-decisions.md` (D1, D2, D14). No backend logic changed.

### What was built

- **`/yedek`** (`src/app/(portal)/yedek/page.tsx`, keeps `maxDuration = 60`): `Profil` back link (44 px), title, lead, then Durum, Kurulum, Alıcılar, Şimdi gönder (conductor only, not rendered for the board) and Geçmiş. One `loadBackupPage()` call. `loading.tsx` is a skeleton in the `finans/loading.tsx` style.
- **Components** in `src/components/backup/`:
  - `status-card.tsx`: every UX §2.1 state. The next-date text always comes from `nextSend` + `SEND_WINDOW_TEXT` (`nextSendText()`, shared with the Geçmiş empty state). A stale previous month with no stored error reads `Gönderim yarıda kaldı.`
  - `setup-list.tsx`: four rows, `Tamam`/`Eksik` as text + icon, `data-ok`, mono variable names, dev outbox note, the `invalid` passphrase reason line, the README line and the passphrase reminder. Nothing about a secret's value or length is rendered.
  - `recipients-form.tsx` (client): 1–5 controlled rows, `noValidate`, `submitWithoutReset`. Field errors `recipients.<i>` are mapped onto the row keys that were submitted, so removing a row drops its error. `En az bir adres gir.` marks row 1 `aria-invalid`, so `useFocusError` focuses it. On success the rows are replaced by `values.recipients` (the canonical list). The success toast is followed by `toast.warning(state.warning)`. Focus moves to the new row on `Adres ekle`, and on remove to the previous row (or the new first row).
  - `recipients-list.tsx`: the board's read-only list.
  - `send-now.tsx` (client): disabled with its hint for `no-recipients`, `running` and `cooldown`. `ConfirmDialog` uses `variant: "default"`, lists the saved addresses, shows the dirty warning, and stays open while pending. The polite live region keeps the last result.
  - `run-log.tsx`: month + chip, then date · trigger, then size · `n adres`, then the error. `Gönderilemedi` chip, and the `Yarıda kaldı` text from D14. The footnote is shown when `moreRuns`.
  - `backup-banner.tsx` (async server): (a) uses absent tokens and (b) uses late tokens, both `role="alert"`; the not-configured box is a plain `<aside aria-label="Aylık yedek">`. It sits between the greeting and the hero in `src/app/(portal)/page.tsx`.
- **`/profil`**: third manager link `Yedekleme` · `Aylık rapor ve yedek e-postası` (`DatabaseBackup` icon).
- **`formatBytes`** in `src/lib/format.ts`.
- **`ConfirmDialog`**: `Vazgeç` is now also disabled while `pending`, as AC 17 asks ("both buttons disabled"). This affects every confirm dialog, which is the same intent everywhere.

### Small decisions

- **The run-log time is `started_at`**, the same column the list is sorted by. The Durum `sent` line uses the covering run's `finished_at`, as UX §2.1 says.
- **The dirty check reads the editor's inputs when `Şimdi gönder` is clicked**: trimmed, lower-cased and de-duplicated, as the server does. This avoids lifting the form state into a provider that would wrap server sections. One function in `send-now.tsx`.
- **The Durum card shows `Henüz ayarlanmadı.` whenever there are no recipients.** That is the only state where no run can exist, so it wins over `pending`.
- **The cooldown hint is the AC 17 sentence** (`… yeniden deneyebilirsin.`), not UX's `gönderebilirsin`, so the disabled hint and the server refusal read the same.

### Tests

- `e2e/mail.mjs` (not a phase file):
  - outbox snapshot/diff/remove
  - `resetBackup` (runs, setting, `backup-%` attempts)
  - `setRecipients` (with `createdAt` for AC 20(b))
  - `insertRun`, `cron()`
  - a small MIME reader: RFC 2047 Q/B words, folded headers, multipart and single-part, base64 and QP, `filename`/`filename*`
  - `csvRows`
- `e2e/phase7-a-cron.mjs` (39 checks): AC 1–12, 24, 32, 34, 36.
  - January 2025 fixtures: 3 sopranos who joined 2024; rehearsals at 10 Jan, 31 Jan 23:30 and 1 Feb 00:30 Istanbul; an assignment created 5 Jan and due 20 Jan with on-time, late and missing singers; donation, venue, a voided catering entry and a transfer; and the dues period `E2E Ocak 2025`.
  - A precondition fails loudly if any non-E2E data is in January 2025, or anyone joined before 5 Jan 2025.
  - Expected values: `Çalışma: 2 · Ortalama devam: %50`, `Ödev: 1 · Zamanında teslim: %33`, `₺12.500,00 / ₺3.200,00 / ₺9.300,00`.
- `e2e/phase7-b-page.mjs` (77 checks, 375×812): AC 14–21, 36, 40.
  - Direct action calls use multipart (`_1_recipients` + root `"0"` = `[{}, "$K1"]`) for `saveBackupRecipients`, and `[]` for `sendBackupNow`.
  - The throttles are arranged by inserting `login_attempts` rows.
  - axe runs on `/yedek` (sef@/yk@ × light/dark) and on the banner, failing on serious or critical.
- `e2e/phase7-c-restore.mjs` (11 checks): AC 28–30 (with the 35 migration count).
  - Two UI sends, with the first run backdated 12 minutes between them (D3).
  - Wrong passphrase, flipped byte, `Output file exists`, the three `db:restore` refusals, then the drill into `data/e2e-p7/drill-*.db`, `db:check` and the four row counts.
  - Everything under `data/e2e-p7/` and the decrypted `.sql` files is removed in `finally`.
- `e2e/prod.mjs` (+16 checks): AC 37 (build table), then three extra servers on 3102.
  - Server B: no `CRON_SECRET`, a random passphrase. Covers AC 2 (503), the P9 boot warning, AC 14 prod (warning toast, value kept) and AC 22.
  - Server C: both dev values. Covers AC 25 (503 on the cron, the AC 23 message on a send, the Kurulum reason).
  - Server D: a random 64-hex secret, no passphrase. Covers AC 23 and AC 30 (`?bugun=2020-01-01` creates no `2019-12` run).
  - Also checks AC 24 (no secret in any error) and that production never writes to `data/outbox/`.
- `run.mjs` needed no change: its `^phase\d+-` pattern picks up the new files, and `mail.mjs` doesn't match it.

### Findings for the team (not changed by me)

- **AC 8 vs. the attendance CSV for an empty month.** The spec says "each CSV header-only". `buildReports` reuses `attendanceStats`, which lists every current member with zeros, exactly as `/raporlar/csv` does for an empty period, so the attendance file is not header-only. The test asserts that homework, ledger and dues are header-only and that every attendance row is `0/0`. Consistency with `/raporlar/csv` (AC 9) seems right to me. @po to confirm, or @backend to filter out rows with `expected = 0`.
- **AC 7 `From`.** nodemailer writes `Arkhe Portal <outbox@arkhe.local>` without the quotes. The two forms are equivalent in RFC 5322, and the test accepts both.

### Verification

- `npm run lint`, `npm run typecheck`: clean. `npm run e2e`: 648/648. `npm run e2e:prod`: 44/44. Details are in `e2e-results.txt`.
- Screenshots at 375 px in light and dark: `/yedek` as sef@ and yk@ (failed + stale + sent runs, a 40-character address), the failure, overdue and not-configured banners on `/`, and `/yedek` at 1280 px dark. No horizontal scroll, 0 console errors, 0 CSP violations. The audit line in the arranged screenshots reads `silinmiş üye`, because that fixture writes no `updated_by`; real saves show the conductor's name, as asserted in AC 14.
