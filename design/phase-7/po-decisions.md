# Phase 7 PO decisions

Author: PO. Date: 2026-10-21. Reads: `po-spec.md`, `ux.md`, `ui.md`, `db.md`, `backend.md`. Every disagreement and every question addressed to me is settled here. Where an AC changes, `po-spec.md` is amended in place and marks the change `(amended Dn)`. **AC numbers are unchanged (1–39); one AC is added (40).**

The rule I applied throughout: a volunteer choir, phones first, nobody does admin. When two options are equally safe, I took the one that needs fewer explanations to a board member.

## 1. Decisions

### D1. First automatic send: the morning after setup (UX option A)
- **Decision:** the cron sends **any** uncovered previous month. On the live site that means September 2026 goes out the first morning after the şef saves the recipients.
- **Why:** an early real-world send is the best test we can get, and an extra backup never hurts. README step 6 asks for a manual send right after setup anyway. If the şef does it, September is covered and the cron skips. If they forget, the cron covers it.
- **One helper for every "next send" text.** `nextSendAt(covered, now)` in `src/lib/backup/schedule.ts` (backend §9.3, UX §2.2) feeds the Durum card, the Geçmiş empty state and anything else that names a date. Nothing hard-codes `1 Kas`.
  - covered → `Sonraki gönderim: <1st of next month>, sabah 08:00–09:00 arası`
  - not covered → `Sonraki deneme: <next morning>, sabah 08:00–09:00 arası`
- **Banner rule (b) is unchanged.** It still never warns about a month that started before the recipients were first saved. Sending is not the same as nagging.
- Amended: AC 16, AC 19.

### D2. Members are redirected to `/`, not 404'd (AC 15)
- **Decision:** `/yedek` uses `requireManager()` like every other manager page, so a member ends up on `/`.
- **Why:** my "same 404 as other manager pages" was simply wrong about the current code. Consistency wins; an odd one out would confuse the next developer, not protect anyone. The server check is what protects the data.
- Amended: P5, AC 15.

### D3. Cooldown stays; e2e backdates the first run (AC 17 vs AC 28)
- **Decision:** the 10-minute cooldown after a `sent` run is product behaviour and stays. To get two different attachments, the AC 28 e2e moves the first run's `started_at`/`finished_at` back 11–15 minutes in the DB between the two sends.
- **Why:** the spec already allows arranging DB state. The AC now says this out loud so nobody "fixes" the cooldown to make a test pass.
- Amended: AC 28.

### D4. Size guard: 18 MB raw (AC 13)
- **Decision:** accepted. Base64 inflates attachments by 4/3, so 20 MB raw would exceed Gmail's 25 MB.
- Copy: `Ekler 18 MB sınırını aşıyor. Portalı kuran kişiye haber ver.`
- Amended: AC 13.

### D5. Money format: the app's formatter (AC 8)
- **Decision:** the email uses `formatKurus`/`formatNet`, which renders `₺12.500,00`. My example was hand-typed and wrong. The e2e asserts the formatter's output, not a typed string.
- Amended: AC 8.

### D6. `Ortalama devam` in the email body (AC 8)
- **Decision:** accept backend's reading: `round(mean(percent))` over all members whose `percent` is not null for the month; `—` when there are none. It is the formula `/raporlar` uses per part, applied to everyone.
- **Why:** the şef reads it the same way as the report page. A total-weighted average would be "more correct" for a statistician and different from what the şef sees in the app, so it would generate questions.
- `Zamanında teslim`: on-time submissions / expected submissions for assignments due in the month; late is not on time; `—` when nothing was expected.
- Amended: AC 8.

### D7. A month that keeps failing is abandoned at month end; duplicates are possible
- **Abandoned month.** If every daily try in November fails, on 1 December the target becomes November and October is never emailed. **Accepted.**
  - The data isn't lost: it is in the live DB and in every later backup, and the October CSVs can still be exported from `/raporlar` and `/finans/rapor`.
  - Banner (a) only looks at the current target month (backend §9.2). Otherwise one old failure would keep the banner up forever and the board would learn to ignore it. A banner that never goes away is worse than none.
  - The README notes how to export an abandoned month by hand.
- **At-least-once delivery.** If the email left but the finish write failed, the row stays `running`, gets reaped after 10 minutes and the next day sends again. **Accepted.** A second copy of a backup is harmless; a missing one isn't.
- Amended: AC 5, AC 20.

### D8. New Turkish copy (throttles, failed change notice, send already running)
All accepted. Final strings:

| Situation | Copy | Where |
|---|---|---|
| More than 10 recipient changes per conductor per day | `Alıcılar bugün çok sık değişti. Yarın yeniden dene.` | form error, nothing saved |
| More than 6 manual sends per conductor per hour | `Çok fazla deneme. Bir saat sonra yeniden dene.` | error toast, no run row |
| Save worked, change notice could not be sent | success toast `Alıcılar kaydedildi.` plus a warning toast `Bilgi e-postası gönderilemedi. Eski ve yeni alıcılara sen haber ver.` | the save stands |
| Manual send while a run for the same month is `running` | `Şu anda bir gönderim sürüyor. Birkaç dakika sonra yeniden dene.` | error toast, no run row |

- The throttles use `consumeAttempt` (the `login_attempts` table), with no new table. They exist because a stuck finger or a hijacked session hammering Gmail with failing logins is how a Google account gets locked.
- The change-notice failure must not roll back the save: a broken SMTP must never block fixing the recipient list.
- Amended: AC 14, AC 17. New: **AC 40** (throttles).

### D9. `.env.development` with the two dev values: accepted, with conditions
- **Decision:** commit `.env.development` containing **only** `CRON_SECRET=dev-only-cron-secret` and `BACKUP_PASSPHRASE=dev-only-backup-passphrase`, with a one-line header comment that production refuses both. Add `!.env.development` to `.gitignore`. The `e2e` script loads it before `.env`.
- **Why it's safe:**
  - The values are public on purpose and protect nothing: a dev server on 127.0.0.1 with seed data.
  - `next build` and `next start` never load `.env.development`, so Vercel never sees the file.
  - If someone copies the values into Vercel, production treats them as **missing** (AC 25): 503 on the cron, a failed run with the passphrase message, `Eksik` under Kurulum. A copied dev passphrase can therefore never encrypt a real backup.
  - On top of that, a `CRON_SECRET` shorter than 32 characters counts as missing in production (backend @po 5), so a hand-typed `arkhe2026` also fails closed.
- **Conditions:**
  1. No other key ever goes into `.env.development`. AC 33's grep enforces it.
  2. prod-e2e proves the refusal (AC 25).
  3. `db:decrypt` and `db:restore` never load any env file (backend §6.4). Otherwise the dev passphrase would be tried on a real backup.
- Amended: AC 2, AC 25, AC 29, AC 32, AC 33.

### D10. `maxDuration = 60` on `/yedek/page.tsx`: accepted
- `Şimdi gönder` is a server action, and a server action inherits the page's limit (`maxDuration.md`). Without it, a real Gmail send plus scrypt could hit the default limit with the row stuck in `running`.
- 60 s stays far below the 600 s stale threshold and Hobby's 300 s maximum. The constants live together in `src/lib/backup/constants.ts` with the comment that `STALE_SECONDS` must stay larger than `maxDuration`.

### D11. Finance query split: accepted, with guard rails
The problem is real. `requireManager()` redirects when there's no session, so the cron would silently answer 307 and send nothing. The fix is safe **only if** the unguarded functions can't be reached without authorization. Conditions:
1. The internals (`ledgerRowsBetween`, `loadDuesMatrix`, `monthTotals`) live in a separate module, `src/lib/finance/queries-internal.ts`, with `import "server-only"`. The guarded exports in `queries.ts` become `await requireManager(); return internal(...)`.
2. Only `src/lib/finance/queries.ts` and `src/lib/backup/*` may import that module. `review-backend.md` records the grep proving it.
3. **Nothing unguarded is ever exported from a `"use server"` file.** Every export of a `"use server"` module becomes a public endpoint. The only server actions are `saveBackupRecipients` and `sendBackupNow`, and both check `canManageBackup` first.
4. `runMonthlyBackup` has exactly two callers: the cron route (after the bearer check) and `sendBackupNow` (after the role check).
5. The CSV builders are moved into `src/lib/{finance,homework}/csv.ts`, and the existing CSV routes keep their guards. AC 11's byte equality proves the builders didn't change.

### D12. Optional `SMTP_HOST` / `SMTP_PORT`: accepted, documented as a fallback only
- Defaults stay `smtp.gmail.com` / `465`. The two variables are commented out in `.env.example`.
- The README describes them under "Gmail girişi reddedilirse", after the two Gmail remedies (confirm the sign-in, then recreate the App Password).
- Fallbacks named: Brevo's free plan and a free Yandex mailbox.
- **Conditions:**
  - zero budget holds: free plan only, never enter a card
  - the README says in one line that a third-party provider would carry the plain CSVs and the encrypted backup, so the board decides knowingly
  - the user checks the provider's current free terms at setup time
- Amended: P8, AC 31, AC 32.

### D13. Passphrase id: not in Phase 7 (out of scope, backlog)
- It's a clever idea, but it adds a scrypt per run, a line of UI to explain to a board member, and a CLI flag.
- The restore drill on the first real email (AC 39) already proves that the stored passphrase matches Vercel's, and that is the moment it matters.
- Revisit it if a passphrase rotation ever confuses someone.

### D14. UX copy and visual decisions
**Accepted as written in `ux.md`:**
- Lead copy: `Her ayın 1'inde, geçen ayın raporları ve koronun tüm kayıtlarının şifreli yedeği aşağıdaki adreslere e-postayla gider.`
- The Durum card states and texts (UX §2.1), with the failure split into headline, error and `Her sabah kendiliğinden yeniden deneniyor.`
- Times read `sabah 08:00–09:00 arası`, not `08:00 civarı`.
- Kurulum explanations, mono variable names, and `Eksik` with a reason line (UX §3).
- **The passphrase reminder under Kurulum, shown to conductor and board:** `Yedek şifresini Vercel dışında iki yerde sakla (ör. şefin şifre yöneticisi ve kapalı zarfta bir kâğıt). Şifre kaybolursa hiçbir yedek açılamaz.`
- `Eksik ayarları portalı kuran kişi Vercel'de girer. Adımlar README'de: "Aylık yedek e-postası".`
- The recipients hint, shown to the board too: `Raporlarda isimler, devam, ödev ve aidat bilgisi şifresiz gider; yalnızca yönetimdeki kişilerin adreslerini ekle.`
- The notice line under the form: `Listeyi değiştirdiğinde eski ve yeni adreslere bilgi e-postası gider.`
- **Status chip `Başarısız` becomes `Gönderilemedi`**, the same word as the Durum card and the banner. `ui.md`'s `Başarısız` is overruled.
- Run-log rows start with the **month** (UX §6), then date and trigger, then `184 KB · 3 adres`. `ui.md`'s date-first order and `alıcı` are overruled; the month is what the board looks for.
- The confirm dialog lists the saved addresses, uses `variant: "default"`, stays open while pending, and warns `Kaydedilmemiş değişiklikler gönderime dahil değil.` when the form is dirty.
- The button is shown **disabled during the cooldown** with the hint text. The server check stays the authority.
- `Şimdi gönder` hint names the month: `Eylül 2026 raporlarını ve bugünkü yedeği hemen gönderir. Kurulumdan sonra bir kez dene ve e-postanın geldiğini kontrol et.`
- **Emails use the plural** (`saklayın`, `iletmeyin`, `haber verin`), because they go to a group. That includes the change notice: my `Bu değişikliği sen yapmadıysan…` becomes `Bu değişiklikten haberiniz yoksa koro şefine hemen haber verin.`
- Email body per UX §10.1. One paragraph per line with no hard wraps, `kişi bazında`, `aidat durumu (gönderim günü itibarıyla)`, and the restore pointer to "portalı kuranlar" plus the README section name.
- The README section is named `Aylık yedek e-postası` everywhere (page, errors, email).
- Error strings per UX §7 (final versions in the amended AC 13, 23 and 24).
- Banner colours: (a) failure uses `absent` and (b) overdue uses `late`, as in UX §8. `ui.md`'s single `late` style is overruled: a failure and a delay are different messages. (b) drops `ayının`.

**Where `ux.md` and `ui.md` disagreed, I picked:**
- **Back link:** a `Profil` back link at the top of `/yedek` (`ui.md`). The page has no tab or sidebar item, so on mobile nothing in the bar is highlighted. One 44 px link costs nothing.
- **Not-configured banner (AC 21):** no live role, a plain `<aside aria-label="Aylık yedek">` (`ui.md`). A standing to-do must never be announced.
- **Banner placement:** between the greeting and the stage hero (both agreed). That is the "above the first card" of AC 20.
- **Result live region** under `Şimdi gönder` (`ui.md` §4): accepted. A failure deserves a note that outlasts a toast.
- **Stale run text:** `Yarıda kaldı` is derived, not stored (`db.md`). When a later claim reaps the row it stores the error `Gönderim yarıda kaldı (10 dakika içinde tamamlanmadı).` and then shows as `Gönderilemedi`. A still-unreaped stale row shows `Yarıda kaldı` with the line `Gönderim yarıda kaldı. Her sabah kendiliğinden yeniden deneniyor.`
- The UX P3 idea of a dynamic `/profil` hint when the banner is active: **not built.** The home banner is enough.

### D15. `created_at` on `app_settings` and the rebuild: accepted
- Banner rule (b) needs "first saved", and `updated_at` moves on every edit. Worse, `updated_at` is exactly what a hijacked session would bump to silence the warning.
- `created_at` is set on first insert, never updated, and backfilled from `updated_at` for the two existing rows.
- **AC 35 wording:** "expand-only, plus a lossless, backward-compatible rebuild of `app_settings` to widen its key CHECK". SQLite can't alter a CHECK, and `0005` did the same. The DBA verified it on a copy.
- The AC 20 e2e backdates `created_at`, never `updated_at`.
- The recipients value is canonical comma-separated with the DBA's CHECK, and is passed to nodemailer as an array, never as a string.
- Amended: AC 14, AC 20, AC 35.

### D16. Smaller items settled
- **Fixture month for content tests (AC 6, 8–12):** January 2025 (`?bugun=2025-02-01`), as `ui.md` proposes. Seed data is anchored to "now", so October 2026 would force the test to re-implement the report formulas. The boundary rehearsals are at 2025-01-31 23:30 and 2025-02-01 00:30 Istanbul, and they are **closed** (only closed, not cancelled rehearsals count).
- **Cron response codes:** `sent`/`skipped` → 200, `failed` → **500** with the same `{"status":"failed"}` body, so Vercel's dashboard shows the run red. Vercel doesn't retry crons, so this has no side effect.
- **Cron with no recipients saved:** `skipped`, no run row. The AC 21 banner covers that state.
- **Homework CSV columns:** `Ödev` = the bar range (`barsLabel`), `Eser` = the piece title, so the two columns don't repeat each other. The state labels move to `HOMEWORK_STATE_LABELS` in `src/lib/labels.ts`, shared with the matrix.
- **The run calls `autoCloseStale()`** before the attendance stats, as opening `/raporlar` does. Same side effect, accepted.
- **scrypt N = 2^17, r = 8, p = 1**, with the parameters in the file header and authenticated as AAD; accepted.
- **`db:decrypt` refuses to overwrite** an existing output (`Output file exists: <path>`) and writes with mode 0600. `db:restore` refuses an encrypted input (`This file is encrypted; run npm run db:decrypt first.`).
- **The restore-drill temp DB lives under `data/`** (git-ignored), not `/tmp`, so the README path and the e2e path are the same. `backup_runs` is excluded from the row-count comparison, because the dump holds the run as `running`.
- **nodemailer licence is MIT-0**, which is even more permissive than MIT. Pin `10.1.7` exactly.
- **`SMTP_PASS` whitespace is stripped** (Google shows App Passwords with spaces); accepted.
- **Boot warning** naming the missing backup variables (names only, never values); accepted. The boot itself never fails on them (P9).

## 2. Out of scope added by these decisions
- The passphrase id (D13).
- Re-sending an abandoned month from the UI, or choosing the month for `Şimdi gönder` (D7). The CSVs for any month stay exportable from `/raporlar` and `/finans/rapor`.
- A dynamic `/profil` hint (D14).

## 3. AC numbering
- **Unchanged:** AC 1–39 keep their numbers. Amended in place: 2, 5, 6, 8, 10, 13, 14, 15, 16, 17, 19, 20, 21, 23, 24, 25, 28, 29, 30, 31, 32, 33, 35.
- **New:** AC 40 (throttles), under S5. It is a Should.
