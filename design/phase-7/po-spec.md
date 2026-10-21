# Phase 7 spec: data safety (monthly reports and encrypted backup by email)

Author: PO. Date: 2026-10-21. **Amended 2026-10-21 by `po-decisions.md` (D1–D16) and by `review-po.md` §2 (AC 7, 8, 19)**: changed ACs carry `(amended Dn)`. AC numbers 1–39 are unchanged and AC 40 is new.

Inputs: the tech lead's roadmap brief of 2026-10-21 (facts on Turso, Vercel Hobby cron and Gmail SMTP), `design/STATUS.md`, `design/phase-6/review-po.md` (go-live preconditions, deferred backlog), `README.md` (backup and restore sections), and the current code (`scripts/db-backup.ts`, `scripts/db-check.ts`, `src/app/(portal)/raporlar/csv/route.ts`, `src/app/(portal)/finans/rapor/csv/route.ts`, `src/app/(portal)/finans/aidat/csv/route.ts`, `src/lib/homework/queries.ts` `homeworkMatrix`, `src/db/schema.ts` `app_settings`). Team plans: `ux.md`, `ui.md`, `db.md`, `backend.md`.

Fixed constraints (not up for discussion):
1. **The portal is live** since 2026-10-19 with real choir data (37 users) on Vercel Hobby (iad1) and the Turso free plan (Stockholm). Every change must be safe to deploy on top of real data: the migration is backward-compatible (AC 35), and `db:migrate` takes its backup first.
2. **Zero budget.** Gmail SMTP through a choir Gmail account with an App Password, `nodemailer` 10.1.7 (MIT-0, exact pin), `node:crypto` and `node:zlib`. No paid service. No new account other than the choir Gmail (a free fallback SMTP account only if Gmail refuses, D12).
3. **Secrets never in chat or in the repo.** The user types `SMTP_USER`, `SMTP_PASS`, `BACKUP_PASSPHRASE` and `CRON_SECRET` into the Vercel dashboard (Production only) themselves. The only committed values are the two public dev values in `.env.development` (D9), which production refuses.
4. **e2e only.** Every AC below is checked in one of these ways:
   - `npm run e2e` (dev server, file outbox)
   - `npm run e2e:prod` (production build, no SMTP)
   - a script
   - a gate the reviewer does by hand and records

## 1. Problem

The choir's whole memory now lives in one Turso free database: who came to which rehearsal, who sent which recording, who paid which dues, every receipt in the ledger. Today the only safety nets are:
- **Turso point-in-time restore, which reaches back only 1 day.** A wrong bulk delete noticed on Monday, or an account problem, loses everything. The free plan has no SLA.
- **`npm run db:backup`, which runs only when someone remembers** to run it on the laptop with a Turso token. In a volunteer choir, nobody remembers in December.

The board also has no paper trail outside the app. The treasurer hands over to a new board in autumn. When the auditors (denetçiler) ask "what was collected in March", someone has to log in, find the right report and export three CSVs.

What we want:
- On the 1st of every month, without anyone doing anything, the board's mailboxes receive last month's reports as CSV and an encrypted, restorable copy of the whole database.
- If it fails, a manager sees it in the app within two days.

## 2. Users and roles

| Role | What Phase 7 gives them |
|---|---|
| Şef (conductor) | Sets the 1–5 recipient addresses and sees the setup status, the run log and the warning banner. Can press `Şimdi gönder` to send right away (for example, to test after setup). Is the only role that can change where the backup goes, because the backup holds every member's data. |
| Yönetim kurulu (board) | Receives the email if their address is on the list. Sees the `Yedekleme` page read-only (recipients, setup status, run log) and the warning banner when a run failed or is overdue. |
| Korist (member) | Nothing changes. No access to `Yedekleme` and no banner. Their data is now safer. |
| The user (deployer, Mert) | Creates the choir Gmail App Password and the passphrase, enters the env vars in Vercel, and keeps the passphrase somewhere other than Vercel. Has a README section with every step, and a decrypt + restore path that works on a plain laptop. |
| Vercel Cron (machine) | Calls the cron route once a day with `Authorization: Bearer <CRON_SECRET>`. |

## 3. Key product decisions

- **P1. Which month.** The email covers the **previous calendar month in Europe/Istanbul**: from the 1st at 00:00 to the next 1st at 00:00, Istanbul time. The database backup is a snapshot taken at send time, not "as of month end".
- **P2. When.** Vercel Cron calls the route **every day at 05:00 UTC** (08:00–09:00 Istanbul, since Hobby fires anywhere within the hour).
  - The route sends only when the previous month isn't covered yet (see P3). In steady state that means the 1st.
  - If the 1st fails (a Gmail hiccup, Turso down), the next day's call retries by itself. Nobody needs to notice a single failure for it to heal.
  - It also means **the first automatic send is the morning after the recipients are first saved** (D1).
  - A month that is still uncovered when the next month starts is abandoned (D7).
  - One daily call that usually does one indexed read is far inside the free limits.
- **P3. "Covered" and idempotency.**
  - A month M is *covered* when any run for M has status `sent`, automatic or manual.
  - The run for M is claimed in the database *before* anything is sent, so overlapping calls send at most one email.
  - A run stuck in `running` for more than 10 minutes (the function was killed) counts as failed and doesn't block a retry.
  - Delivery is at-least-once: a rare duplicate email is accepted (D7).
- **P4. Monthly, not weekly.** The user asked for monthly, and I keep it.
  - Every email puts another copy of the members' data in more mailboxes. Weekly would mean four times the copies for little gain at our write volume.
  - For the moments that matter, the şef presses `Şimdi gönder`, and the README makes `db:backup` mandatory before every migration.
  - Weekly is recorded as an option in §7, not built.
- **P5. Who edits recipients.** **Only the conductor.** The board sees everything read-only, and members are redirected to `/` like on every other manager page (amended D2). Changing recipients sends a notice to the old and the new list (AC 14), so a hijacked conductor session can't redirect the backups silently.
- **P6. What is encrypted.**
  - The **database backup** is gzip-compressed, then encrypted with AES-256-GCM. The key comes from scrypt over `BACKUP_PASSPHRASE` with a random salt per file.
  - The **CSV reports are not encrypted.** They exist so a board member can open them on a phone. They hold names, part, attendance numbers, homework status and dues amounts, never emails, phones, password hashes or notes. The UI says so next to the recipients.
- **P7. Manual trigger.** `Şimdi gönder` (conductor only) sends the same email as the automatic run: the previous calendar month's reports plus a fresh backup, to the saved recipients.
  - It covers the month if it succeeds.
  - It has a 10-minute cooldown after a `sent` run, and a limit of 6 tries per hour (AC 40).
- **P8. Mail transport.**
  - In production, mail goes through SMTP: by default Gmail at `smtp.gmail.com:465` with TLS, using `SMTP_USER`/`SMTP_PASS`. The optional `SMTP_HOST`/`SMTP_PORT` exist only as a free fallback if Gmail refuses (D12).
  - **Outside production, mail is always written to a file outbox** (`data/outbox/<timestamp>-<slug>.eml`, git-ignored) and never sent, whatever the SMTP vars say.
- **P9. Missing configuration never crashes the app.**
  - The portal boots and works without any of the new env vars. Only the backup run fails, with a clear Turkish message in the run log.
  - The setup status on the page shows which piece is missing.
  - A missing variable adds one boot warning that names it (never its value).
- **P10. Where it lives.** A new manager page **`/yedek`**, titled `Yedekleme`, reached from the manager links on `/profil` and from the banner. It is not a tab-bar or sidebar item, and it has a `Profil` back link (D14).

## 4. User stories and acceptance criteria

Numbering is global so that e2e test names can reference "AC n".
- "e2e" means `npm run e2e` against the dev server at 127.0.0.1:3100, with the file outbox and the dev values from `.env.development`.
- "prod-e2e" means `npm run e2e:prod`: the production build on 127.0.0.1:3101 (and 3102 for alternative env sets), no SMTP configured.
- "gate" means a check the reviewer does by hand or by script and records in `review-*.md`.

e2e may arrange database state directly, for example by inserting run rows or backdating timestamps, and must clean up after itself. Content tests use **January 2025** as the fixture month (D16), so seed data anchored to "now" can't change the expected numbers.

Test hook: the cron route accepts `?bugun=YYYY-MM-DD` to pretend "today" is that Istanbul date, **only when `NODE_ENV !== "production"`**. In production the parameter is ignored (AC 30). The hook affects only the choice of report month, the dues "as of" date and `nextSendAt`. Run timestamps, staleness, the cooldown and file names always use the real clock.

### S1. The monthly email arrives by itself (board, şef)
*As a board member I want last month's reports and a backup in my inbox on the 1st without anyone remembering to do it, so the choir's records survive whatever happens to the app.*

1. **Schedule:** `vercel.json` declares exactly one cron, `{"path": "/api/cron/aylik-yedek", "schedule": "0 5 * * *"}`. (e2e: read and assert the file.)
2. **Route protection** (amended D9, D16). `GET /api/cron/aylik-yedek`:
   - without an `Authorization` header, or with a wrong bearer value, returns **401** with body `{}`. It sends nothing, logs no run and does no DB read.
   - returns **503** with body `{}` for every request when `CRON_SECRET` is unusable: unset, or in production shorter than 32 characters or equal to the dev value `dev-only-cron-secret`. The route is never "open because unconfigured".
   - compares the secret in constant time (SHA-256 digests + `timingSafeEqual`).
   - is never cached (`Cache-Control: no-store`) and runs on the Node.js runtime.
   - answers `{"status": "sent" | "skipped" | "failed"}` and nothing else: no addresses, counts or error text. `sent` and `skipped` are **200**, `failed` is **500**, so the Vercel dashboard marks the call red.
   - with no recipients saved, answers `skipped` and logs no run.
   
   (e2e:
   - no header → 401, and `Bearer wrong` → 401; the outbox and the run count are unchanged
   - a valid call returns JSON whose only key is `status`, with `no-store`
   - no recipients → `skipped`
   
   prod-e2e: `CRON_SECRET` unset → 503; the dev value → 503.)
3. **Sends for the previous month:** called with the right secret and `?bugun=2026-11-01`, with recipients saved, the route:
   - returns `{"status":"sent"}`
   - writes exactly one `.eml` to the outbox
   - logs one run with trigger `cron`, report month `2026-10` and status `sent`
   
   (e2e.)
4. **Idempotent:**
   - Calling it again with `?bugun=2026-11-02` (month 2026-10 already covered) returns `{"status":"skipped"}`, writes no `.eml` and logs **no** run row.
   - Two **concurrent** calls with `?bugun=2026-12-01` produce exactly one `.eml` and one `sent` run for `2026-11`. The other call returns `skipped`.
   
   (e2e: `Promise.all` of two requests.)
5. **Self-healing retry, abandoned month** (amended D7):
   - When the run for month M failed (e2e arranges a `failed` row for `2026-09` and no `sent` row), the next call with `?bugun=2026-10-02` sends for `2026-09`.
   - A `running` row older than 10 minutes doesn't block the retry (it is reaped to `failed` with `Gönderim yarıda kaldı (10 dakika içinde tamamlanmadı).`). One younger than 10 minutes does block it (`skipped`). Use different months for the two cases.
   - **Abandoned month:** with a `failed` row for `2026-10` and nothing else, a call with `?bugun=2026-12-01` sends for `2026-11` only, and `2026-10` stays uncovered.
   
   (e2e.)
6. **Month boundary in Istanbul time** (amended D16): a closed rehearsal starting **2025-01-31 23:30 Istanbul** (20:30 UTC) is counted in the January 2025 report. One starting **2025-02-01 00:30 Istanbul** (2025-01-31 21:30 UTC) is not. (e2e: create both with attendance and close them, send with `?bugun=2025-02-01`, then assert the attendance CSV and the `Çalışma:` count. A precondition fails loudly if any non-E2E data is dated in January 2025.)

### S2. What the email contains (board, auditors)
*As the treasurer I want the month's ledger, dues status and attendance as files I can open in Excel on my phone, and a one-glance summary in the body.*

7. **Envelope:**
   - From: `SMTP_FROM` if it is set and well-formed, else display name `Arkhe Portal` with `SMTP_USER`. In the outbox: `Arkhe Portal <outbox@arkhe.local>`. The display name may be quoted or not; both are equivalent in RFC 5322 (amended in review-po, decision 3).
   - To: all saved recipients, in one message, passed as an array.
   - Subject (automatic): `Arkhe aylık rapor ve yedek · Ocak 2025`.
   - Subject (manual): `Arkhe aylık rapor ve yedek · Ocak 2025 (elle gönderildi)`.
   - The month label comes from the shared `formatMonthYear` (`tr-TR`, Europe/Istanbul).
   - No member name, email or amount in the subject.
   
   (e2e: parse the `.eml` headers. The `Subject` is RFC 2047-encoded and decodes to the exact Turkish string, with no `@` and no `₺`.)
8. **Body** (amended D5, D6, D14): plain text, UTF-8, Turkish, plural address. **One paragraph per line, no hard wraps inside a sentence**, and a blank line between blocks. Template, kept in one place (`src/lib/backup/email.ts`):
   ```
   Merhaba,

   Arkhe Portal'ın Ocak 2025 raporları ve koronun tüm kayıtlarının şifreli yedeği ekte.

   Çalışma: 2 · Ortalama devam: %78
   Ödev: 1 · Zamanında teslim: %33
   Gelir: ₺12.500,00 · Gider: ₺3.200,00 · Net: ₺9.300,00

   Ekler:
   - arkhe-devam-2025-01.csv: kişi bazında devam
   - arkhe-odev-2025-01.csv: ödev teslimleri
   - arkhe-finans-2025-01.csv: kasa hareketleri
   - arkhe-aidat-2025-01.csv: aidat durumu (gönderim günü itibarıyla)
   - arkhe-yedek-2026-10-21-1412.sql.gz.enc: şifreli yedek

   CSV dosyaları telefonda ya da Excel'de açılır.

   Yedek dosyasını açmanız gerekmez; bu e-postayı silmeden saklayın. Portalda bir sorun olursa koronun kayıtları bu dosyadan geri getirilir. Dosya şifrelidir ve şifresi bu e-postada yoktur. Açma adımları portalı kuranlarda, README'nin "Aylık yedek e-postası" bölümünde.

   Raporlar şifresizdir; bu e-postayı koro yönetimi dışında kimseye iletmeyin.

   Bu e-posta her ayın 1'inde kendiliğinden gönderilir. Alıcıları koro şefi buradan değiştirir:
   <APP_URL>/yedek
   ```
   - **Manual sends** add one paragraph after `Merhaba,`: `Bu e-postayı <ad> portaldan elle gönderdi (<tarih saat>).`
   - **Zero data still prints every line**: `Çalışma: 0 · Ortalama devam: —`, `Ödev: 0 · Zamanında teslim: —`, `Gelir: ₺0,00 · Gider: ₺0,00 · Net: ₺0,00`. The homework, ledger and dues CSVs are header-only; the attendance CSV lists current members with `Geldi 0`, `Beklenen 0` and an empty `Yüzde`, exactly as `/raporlar/csv` does for an empty period (amended in review-po, decision 1). The attachment list is always the same five files.
   - **Amounts** come from the app's formatters (`formatKurus`/`formatNet`). Voided rows, transfers and openings are excluded, as on `/finans`.
   - **`Ortalama devam`** = `round(mean(percent))` over the members with a non-null `percent` for the month, or `—` when there are none (D6).
   - **`Zamanında teslim`** = on-time submissions / expected submissions for assignments due in the month. Late does not count as on time. `—` when nothing was expected.
   - **The backup file name** uses the real Istanbul send time `YYYY-MM-DD-HHmm`. All file names are ASCII.
   
   (e2e: decode the body and assert:
   - the month line and the five attachment lines
   - `<APP_URL>/yedek`
   - the three summary lines against the numbers expected from the January 2025 fixtures, formatted by the app formatter
   
   A second send for an empty month (`?bugun=2024-02-01`) asserts the zero lines and five attachments, each CSV header-only. The decoded text of every part contains no fixture or demo email address.)
9. **Attendance CSV** `arkhe-devam-YYYY-MM.csv`: the same columns, separator, BOM and formatting as `/raporlar/csv` (reuse `attendanceCsv`), for closed rehearsals starting in the month (AC 6 boundaries). (e2e: the header row equals the `/raporlar/csv` header, and a fixture member's `Geldi`/`Beklenen` match.)
10. **Homework CSV** `arkhe-odev-YYYY-MM.csv` (new; no such export exists yet; amended D16):
    - one row per expected singer per assignment **due in the month**
    - columns `Ödev` (the bar range, `barsLabel`), `Eser` (the piece title), `Son tarih`, `Ad soyad`, `Partisyon`, `Durum`, `Teslim tarihi`
    - `Durum` uses the shared `HOMEWORK_STATE_LABELS` (`Zamanında`, `Geç`, `Gecikti`, `Bekleniyor`), the same map as the matrix
    - singers the assignment isn't for are not listed; feedback is never included
    - sorted by due date, then name (`tr` collation)
    - same CSV conventions as `src/lib/csv.ts`
    
    (e2e: a fixture assignment due in January 2025 with one on-time, one late and one missing singer gives exactly three rows with the right `Durum`.)
11. **Finance CSV** `arkhe-finans-YYYY-MM.csv`: exactly what `/finans/rapor/csv?from=<1st>&to=<last day>` returns for that month, from the same shared builder. (e2e: byte-compare the attachment with the route's response for 2025-01-01..2025-01-31, fetched as yk@.)
12. **Dues CSV** `arkhe-aidat-YYYY-MM.csv`:
    - the `/finans/aidat/csv` columns with a leading `Dönem` column
    - one block per dues period **overlapping** the month, ordered by start date, with status as of send time
    - no overlapping period → header only
    
    (e2e: with one fixture period overlapping January 2025, the rows equal that period's `/finans/aidat/csv` rows with the period name prepended.)
13. **Size guard** (amended D4): if the attachments together exceed **18 MB raw**, nothing is sent and the run is logged `failed` with `Ekler 18 MB sınırını aşıyor. Portalı kuran kişiye haber ver.` Gmail's limit is 25 MB after base64, which inflates by 4/3. `size_bytes` is recorded on that failed row. (Gate: code review; our real size is a few hundred KB.)

### S3. Recipients and the Yedekleme page (şef, board)
*As the şef I want to set once who receives the monthly mail, from my phone, and see at a glance whether it's working.*

14. **Recipients setting** (amended D8, D14, D15). Stored in `app_settings` under the new key `backup_recipients`, as a canonical comma-separated list (`db.md` §2) with a DB CHECK. A `created_at` column is set on first save and never updated. Rules:
    - 1 to 5 addresses: trimmed and lower-cased; empty rows and duplicates dropped silently, keeping the first occurrence.
    - each must match the Phase 4 recording-email rule
    - only the conductor can save. The server action refuses everyone else with `Bu ayarı yalnızca koro şefi değiştirebilir.` before it parses anything.
    - after saving: toast `Alıcılar kaydedildi.`, the inputs re-render the normalised list, and the Phase 6 audit line `Son değişiklik: <ad> · <tarih>` appears (from `updated_at`/`updated_by`)
    - errors: `En az bir adres gir.` and `En fazla beş adres ekleyebilirsin.` (list-level); `Geçerli bir e-posta adresi gir: <adres>` under the offending row with `aria-invalid`
    - **Change notice:** when the canonical list changes (not on the first save, not on an identical save), one plain-text email goes to the union of the old and the new addresses after the save commits. Its subject is `Arkhe yedek alıcıları değişti`, and its body follows `ux.md` §10.3:
      - who changed it and when
      - the new list
      - `Listeden çıkarıldıysanız aylık e-posta artık size gelmeyecek.`
      - `Bu değişiklikten haberiniz yoksa koro şefine hemen haber verin.`
      - `<APP_URL>/yedek`
      
      It is not logged as a backup run.
    - **If the notice fails**, the save stands. The UI shows the success toast plus the warning `Bilgi e-postası gönderilemedi. Eski ve yeni alıcılara sen haber ver.`
    
    (e2e:
    - sef@ saves two addresses, one with spaces and capitals → toast, normalised inputs, audit line, and **no** notice `.eml`
    - changing to a third address → exactly one notice `.eml` whose `To` holds all three
    - saving the same list again → no `.eml`
    - empty and invalid input each give the right message
    - 6 addresses and a save as yk@, both via a direct server action call → refused, value unchanged
    
    prod-e2e: with no SMTP, changing the list keeps the new value and shows the warning.)
15. **Access** (amended D2):
    - `/yedek` renders for conductor and board.
    - A member is redirected to `/` by `requireManager()`, like on every other manager page.
    - On `/profil`, managers see a third manager link `Yedekleme` with the hint `Aylık rapor ve yedek e-postası`.
    
    (e2e: korist@ opening `/yedek` ends on `/` with no `Yedekleme` heading, and `/profil` has no `a[href="/yedek"]`. yk@ and sef@ get the page and the link.)
16. **Page layout at 375 px** (amended D1, D14). Visuals follow `ux.md` §1–§5. Content top to bottom:
    1. A `Profil` back link (44 px). Title `Yedekleme`. Lead: `Her ayın 1'inde, geçen ayın raporları ve koronun tüm kayıtlarının şifreli yedeği aşağıdaki adreslere e-postayla gider.`
    2. **Durum** card with the states of `ux.md` §2.1, always naming the month. Examples:
       - `Eylül 2026 raporu gönderildi.`, then `1 Eki 2026 08:02 · 3 adres`
       - `Eylül 2026 raporu henüz gönderilmedi.`
       - `Eylül 2026 raporu şu an gönderiliyor.`
       - `Eylül 2026 raporu gönderilemedi.`, then the error line, then `Her sabah kendiliğinden yeniden deneniyor.`
       - `Henüz ayarlanmadı.`
       
       The next-date line comes **only** from `nextSendAt()`: `Sonraki gönderim: <tarih>, sabah 08:00–09:00 arası` when the month is covered, `Sonraki deneme: …` otherwise.
    3. **Kurulum** checklist: four rows, each with a `Tamam` or `Eksik` badge (text plus icon), an explanation line and the variable names in mono (`ux.md` §3).
       - `E-posta hesabı`. In dev it reads `Tamam`, and the explanation says `deneme ortamı, e-posta gönderilmez, dosyaya yazılır`.
       - `Yedek şifresi`
       - `Zamanlayıcı anahtarı`
       - `Alıcılar` (`3 adres` / `Eksik`)
       
       **No secret value, length or mask is ever rendered.** Under the list:
       - `Eksik ayarları portalı kuran kişi Vercel'de girer. Adımlar README'de: "Aylık yedek e-postası".`
       - the passphrase reminder (conductor and board): `Yedek şifresini Vercel dışında iki yerde sakla (ör. şefin şifre yöneticisi ve kapalı zarfta bir kâğıt). Şifre kaybolursa hiçbir yedek açılamaz.`
    4. **Alıcılar** (`ux.md` §4). Both roles see the hint `Raporlarda isimler, devam, ödev ve aidat bilgisi şifresiz gider; yalnızca yönetimdeki kişilerin adreslerini ekle.`
       - Conductor: the editable list, then `Kaydet`, then the audit line and `Listeyi değiştirdiğinde eski ve yeni adreslere bilgi e-postası gider.`
         - 1–5 `type="email"` inputs, with `autocomplete="off"` and a remove button per row; there is no remove button when only one row is left.
         - `Adres ekle` is replaced by `En fazla beş adres.` at five rows.
         - every control is a 44 px target
       - Board: the read-only list, then `Alıcıları yalnızca koro şefi değiştirebilir.` and the audit line. With no recipients: `Henüz alıcı yok. Alıcıları koro şefi ekler.`
    5. **Şimdi gönder** (conductor only; not rendered for the board): the hint `<Ay Yıl> raporlarını ve bugünkü yedeği hemen gönderir. Kurulumdan sonra bir kez dene ve e-postanın geldiğini kontrol et.` and the button `Şimdi gönder`. Below it, a polite live region keeps the last result.
    6. **Geçmiş:** the run log (AC 19).
    
    (e2e at 375×812, in light and dark, as sef@ and yk@:
    - no horizontal scroll, even with a 48-character recipient
    - all four Kurulum rows present
    - sef@ sees the inputs and both buttons
    - yk@ sees no input, no `Kaydet` and no `Şimdi gönder`, and does see the read-only note
    - axe reports no serious or critical violations)
17. **Şimdi gönder** (amended D8, D14):
    - **Confirm first.** The existing `ConfirmDialog`, with `variant: "default"`:
      - title `Rapor ve yedek gönderilsin mi?`
      - body `<n> adrese <Ay Yıl> raporları ve şifreli yedek gönderilecek.`, followed by the saved addresses, one per line
      - if the form has unsaved edits: `Kaydedilmemiş değişiklikler gönderime dahil değil.`
      - buttons `Vazgeç` / `Gönder`
      
      While the send is pending, the dialog stays open, both buttons are disabled, and `Gönder` reads `Gönderiliyor…`.
    - **Success:** toast `Gönderildi: <n> adres.`. A new run row appears with trigger `Elle · <şef adı>`, and Durum updates.
    - **Failure:** toast `Gönderilemedi. Ayrıntı aşağıda, Geçmiş'te.` and a `failed` run row.
    - **Refusals** leave no run row and show an error toast:
      - Cooldown: within 10 minutes of the last `sent` run → `Az önce gönderildi. <n> dakika sonra yeniden deneyebilirsin.` The button is also rendered **disabled** during the cooldown, with that sentence as its hint.
      - A run for the same month is `running` → `Şu anda bir gönderim sürüyor. Birkaç dakika sonra yeniden dene.`
      - No saved recipients → the button is disabled with the hint `Önce en az bir alıcı kaydet.`, and the server refuses with the same text.
      - Anyone but the conductor → `Bu işlemi yalnızca koro şefi yapabilir.`
    
    (e2e:
    - sef@ sends → toast, one `.eml` with the `(elle gönderildi)` subject, and the run row
    - immediately after, the button is disabled with the cooldown hint, and a direct action call gives the cooldown message with no `.eml`
    - a direct action call as yk@ is refused, with no `.eml`)
18. **The manual run covers the month:** after a successful `Şimdi gönder`, the automatic run for the same month is `skipped`. (e2e: sef@ sends manually on the real date, so the month is the previous calendar month. Then the cron call with `?bugun=<1st of the current Istanbul month>` returns `skipped` and writes no `.eml`.)

### S4. Run log and warning banner (so a silent failure gets noticed)
*As the şef I want to know within a couple of days if the monthly mail didn't go, without checking a page every month.*

19. **Run log (`Geçmiş`)** on `/yedek` (amended D1, D14): the last **12** runs, newest first, laid out per `ux.md` §6. Each row:
    - line 1: the report month (`Eylül 2026`) and the status chip:
      - `Gönderildi` (present tokens)
      - `Gönderilemedi` (absent tokens)
      - `Gönderiliyor` (muted; a `running` row ≤ 10 min old)
      - `Yarıda kaldı` (absent tokens; a `running` row > 10 min old, derived at read time)
    - line 2: date and time (`tr-TR`, Istanbul) and the trigger, e.g. `1 Eki 2026 08:02 · Otomatik` or `21 Eki 2026 14:12 · Elle · Demo Şef`
    - line 3: the attachment size and recipient count, e.g. `184 KB · 3 adres`. Size is whole KB under 1 MB (minimum 1 KB), else `1,2 MB`. This line is omitted when there's no size.
    - line 4, failures only: the stored Turkish error, wrapped, never truncated off-screen. An unreaped `Yarıda kaldı` row shows `Gönderim yarıda kaldı. Her sabah kendiliğinden yeniden deneniyor.` when its month is the current target (the previous calendar month), and only `Gönderim yarıda kaldı.` for any older month, which will never be retried (D7; amended in review-po, decision 2, built from the backlog).
    
    Empty states:
    - with recipients: `Henüz gönderim yok. İlk otomatik gönderim: <nextSendAt tarihi>, sabah 08:00–09:00 arası.`
    - without recipients: `Henüz gönderim yok. Alıcılar kaydedilince her ay kendiliğinden gönderilir.`
    
    With 12 rows shown and more existing, a footnote reads `Son 12 gönderim gösteriliyor.`. Runs older than 24 months are deleted when a run finishes.
    
    (e2e:
    - arrange one row per status, using different months for the two `running` rows → labels via `data-status`, order, and a 200-character error fully inside the viewport
    - both empty states
    - 15 rows → 12 shown, plus the footnote)
20. **Warning banner** on the home page `/` (amended D7, D14, D15), for managers only. It sits between the greeting and the stage hero, with `role="alert"` and the link `Yedeklemeye git` → `/yedek` (44 px). M is the previous calendar month. It shows when **either**:
    - **(a)** the most recent automatic run is for M and is `failed` or stale `running`, and M is not covered. Absent tokens, with the text `Aylık yedek gönderilemedi (Eylül 2026).` and `Her sabah yeniden deneniyor. Nedenini Yedekleme sayfasında görebilirsin.`
    - **(b)** the recipients' `created_at` is before the 1st of the current month (Istanbul), M is not covered, and today (Istanbul) is the **3rd or later**. Late tokens, with the text `Eylül 2026 raporu ve yedeği henüz gönderilmedi.`
    
    (a) wins when both match. The banner disappears as soon as M is covered. Failures for older, abandoned months never raise it (D7).
    
    (e2e: arrange each case, backdating `created_at` and never `updated_at`, and check sef@ and yk@. korist@ never sees it. After a covering `sent` row it's gone. A failed row for an older month alone shows no (a) banner.)
21. **Not configured yet** (amended D14): while no recipients are saved, the conductor (only) sees a quiet box on `/`: `Aylık yedek henüz ayarlanmadı.` with the line `Koronun kayıtları her ay yönetimin e-postasına yedeklensin.` and the link `Ayarla` → `/yedek`. It is a plain `<aside aria-label="Aylık yedek">` with no live role. (e2e: with no recipients, sef@ sees it and yk@ and korist@ don't. After saving, it's gone.)

### S5. Failure handling and secrets
*As the deployer I want a missing or wrong setting to show up as a clear Turkish message in the app, never as a crash or a leaked secret.*

22. **Missing SMTP in production:** with `SMTP_USER` or `SMTP_PASS` unset, a run (cron or manual) is logged `failed` with `E-posta hesabı ayarlanmamış (SMTP_USER, SMTP_PASS). README: "Aylık yedek e-postası".` The app keeps working, and the Kurulum row shows `Eksik`. (prod-e2e: start with a valid passphrase and no SMTP vars, log in as the prod-e2e conductor, save a recipient, press `Şimdi gönder` → that message in Geçmiş; `/` still loads.)
23. **Missing or invalid passphrase** (amended D14): when `BACKUP_PASSPHRASE` is unset, shorter than 16 characters after trimming, or the dev value in production:
    - the run is logged `failed` with `Yedek şifresi ayarlanmamış ya da geçersiz (BACKUP_PASSPHRASE). README: "Aylık yedek e-postası".`
    - **no email is sent at all**: reports never go without the backup, and the backup never goes unencrypted
    - this check comes first, so it takes precedence over AC 22
    
    (prod-e2e: start without it and without SMTP; the same flow as AC 22 gives this message.)
24. **Send errors are mapped, secrets never leak** (amended D14). The stored error is always one of a fixed set of constants (`src/lib/backup/messages.ts`), never `err.message`:
    - Gmail auth failure → `Gmail girişi reddedildi. Uygulama şifresini kontrol et.`
    - connection or timeout → `E-posta sunucusuna bağlanılamadı. Yarın sabah kendiliğinden yeniden denenecek.`
    - anything else → `Beklenmeyen bir hata oldu. Portalı kuran kişiye haber ver; ayrıntı sunucu kayıtlarında.`
    
    The server log (English, `console.error`) gets only `name`, `code`, `responseCode`, `command` and a message in which every secret and every recipient address is replaced by `[redacted]`. The error object is never logged whole. SMTP timeouts are short enough (connect 10 s, socket 20 s) that a hung server fails the run inside `maxDuration`. (Gate: backend code review of the mapping and the redaction. e2e/prod-e2e: no `failed` row they produce contains any secret value in use.)
25. **Dev values refused in production** (amended D9):
    - `.env.development` (committed, loaded only by `next dev`) holds exactly `CRON_SECRET=dev-only-cron-secret` and `BACKUP_PASSPHRASE=dev-only-backup-passphrase`, with a header comment that production refuses both.
    - In production those exact values count as missing: the cron gets AC 2's 503, and a run gets AC 23's message.
    - A `CRON_SECRET` under 32 characters also counts as missing in production.
    
    (prod-e2e: start with both dev values → the cron answers 503, and a manual run fails with the AC 23 message.)
26. **No partial sends:** the passphrase and SMTP config are checked, then the backup is built and encrypted and every CSV is built, all **before** the SMTP connection opens. Any failure before that point sends nothing. (Gate: code review; covered indirectly by AC 23.)
40. **Throttles** (new, D8). Both use the existing `consumeAttempt` (the `login_attempts` table):
    - Recipient changes: at most **10 per conductor per day**. Beyond that, the save is refused with `Alıcılar bugün çok sık değişti. Yarın yeniden dene.` and nothing is written. Identical saves and first saves don't count.
    - Manual sends: at most **6 per conductor per hour**, cooldown refusals included. Beyond that: `Çok fazla deneme. Bir saat sonra yeniden dene.`, with no run row.
    
    (e2e: arrange the attempt rows for sef@ up to the limit, then assert each message and that nothing changed.)

### S6. Encrypted backup and the restore drill (the deployer)
*As the deployer I want to turn the attachment from any monthly email back into a working database on my laptop, with one command and the passphrase.*

27. **One dump format:** the email backup and `npm run db:backup` use the same dump code, extracted to `src/lib/backup/dump.ts`: one read transaction, every non-engine table (including `backup_runs` and `__drizzle_migrations`), and indexes after the data. The output of `db:backup` is unchanged. (e2e: the existing Phase 6 AC39 test stays green.)
28. **Encryption format** (amended D3):
    - The `.sql.gz.enc` file is: the magic `ARKHE-BK1`, the KDF id and the scrypt parameters (N = 2^17, r = 8, p = 1), a random 16-byte salt and a random 12-byte IV, then the AES-256-GCM ciphertext of the gzipped dump and the 16-byte auth tag.
    - The whole header is authenticated as AAD.
    - Two runs on the same data give different files.
    - Only `node:crypto` and `node:zlib`; no new dependency besides `nodemailer`.
    
    (e2e:
    - make two manual sends; **between them, backdate the first run's `started_at`/`finished_at` by 11–15 minutes in the DB, to step past the AC 17 cooldown. The cooldown itself must not be changed for this test.**
    - both attachments start with `ARKHE-BK1` and differ
    - neither contains a fixture member's email as bytes)
29. **Decrypt and restore scripts** (amended D9, D16). English output, local only, and **neither ever loads an env file**:
    - `npm run db:decrypt -- <file.sql.gz.enc>`:
      - reads the passphrase from a `BACKUP_PASSPHRASE` set in the shell; otherwise prompts `Backup passphrase: ` without echo, or reads one line from stdin when it isn't a TTY
      - writes `data/backups/<name>.sql` with mode 0600, only after the full decrypt succeeds, and prints `Decrypted: <path>`
      - refuses an existing output with `Output file exists: <path>`
    - A wrong passphrase or a modified file gives exit code 1, `Wrong passphrase or damaged file.`, and **no output file**.
    - `npm run db:restore -- <file.sql> <target.db>` restores into a **new local file** with `@libsql/client` `executeMultiple` (no `sqlite3` CLI needed). It refuses:
      - an existing target: `Refusing to restore over an existing file.`
      - a non-local target: `Restore target must be a local file path.`
      - an encrypted input: `This file is encrypted; run npm run db:decrypt first.`
      
      On any error it removes the partial file.
    
    (e2e:
    - wrong passphrase → exit 1, the message, no file
    - one byte flipped in the ciphertext → the same
    - each `db:restore` refusal message)
30. **Restore drill (e2e, end to end)** (amended D16):
    - The e2e takes the `.enc` attachment from an outbox `.eml` produced by `Şimdi gönder`.
    - It runs `db:decrypt` with the dev passphrase in the env, then `db:restore` into a fresh temp file **under `data/`**.
    - Then `DATABASE_URL=file:<temp> npm run db:check` exits 0 with `migrations=N/N`.
    - The row counts of `users`, `attendance`, `submissions` and `finance_entries` equal the live dev DB's at send time. `backup_runs` is not compared.
    - The temp DB with its `-wal`/`-shm` files, and the `.sql`, are removed.
    
    Also: the `?bugun=` hook is ignored in production. (prod-e2e: a cron call with a valid secret and `?bugun=2020-01-01` produces no run for `2019-12`.)

### S7. Ops documentation (the deployer, the next board)
*As whoever inherits this in two years I want one README section that tells me how it works and how to get the data back.*

31. **README section `Aylık yedek e-postası`** (amended D7, D12), as numbered steps a volunteer can follow:
    1. Create (or reuse) a choir Gmail account. Turn on 2-Step Verification and create an App Password (Google Account → Security → App passwords) named `Arkhe Portal`. Changing the Google password revokes it.
    2. Generate a passphrase of at least 16 characters (suggest `openssl rand -base64 24`).
    3. **Store the passphrase outside Vercel**, in two places (for example the şef's password manager and a sealed paper copy with the board president). Without it, every backup is useless. If it is lost, the live data is unaffected: set a new one, redeploy and press `Şimdi gönder`. Rotating it doesn't re-encrypt old backups, so keep the old one with its date.
    4. Generate `CRON_SECRET` with `openssl rand -hex 32`. Production refuses anything under 32 characters.
    5. Enter `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM`, `BACKUP_PASSPHRASE` and `CRON_SECRET` in Vercel → Settings → Environment Variables, **Production only**, typed by hand. Never paste them into chat, a file or a commit. Then redeploy.
    6. On `/yedek`, save the recipients and press `Şimdi gönder`. Confirm the email arrives (check spam once and mark it "not spam"), and that Kurulum shows four `Tamam`.
    7. Run the restore drill on that first email's attachment (`db:decrypt` → `db:restore` → `db:check`), then delete the local copies.
    8. Restoring to Turso in a real incident: decrypt, then follow the existing "Restore to Turso" steps with the `.sql` file.
    
    It also needs these notes:
    - **"Gmail girişi reddedilirse":**
      1. confirm the sign-in in Gmail's security activity
      2. recreate the App Password
      3. only then, a free fallback via `SMTP_HOST`/`SMTP_PORT`: the Brevo free plan or a free Yandex mailbox, with one line saying the provider then carries the plain CSVs and the encrypted backup
    - Turso free point-in-time restore reaches back **1 day** only, so for anything noticed later the monthly email is the backup.
    - Vercel Hobby cron fires between 08:00 and 09:00 Istanbul and runs only on the production deployment.
    - A month that failed every day is abandoned on the next 1st. Its CSVs can be exported from `/raporlar` and `/finans/rapor`.
    - Gmail's daily limit (~500) is far above our use.
    - In dev, mail goes to the outbox at `data/outbox/`.
    
    (Gate: the PO reads it end to end.)
32. **Env files** (amended D9, D12):
    - `.env.example` lists `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT`, `BACKUP_PASSPHRASE` and `CRON_SECRET`, with one comment line each. All `SMTP_*` are commented out (dev uses the outbox regardless). It notes that the dev values live in `.env.development` and are refused in production.
    - `.env.development` is as in AC 25.
    - `.gitignore` has `!.env.development` and a `/data/outbox/` line.
    - The `e2e` script loads `.env.development` before `.env`.
    
    (e2e: grep the four files.)
33. **No secret in the repo** (amended D9):
    - `git grep` finds no value for `SMTP_PASS=`
    - no 16-character app-password pattern (`[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}`)
    - no `BACKUP_PASSPHRASE=` or `CRON_SECRET=` with anything but the two dev values
    - `.env.development` contains exactly those two keys
    
    (Gate: the reviewer runs it.)

### S8. Free-tier and live-data safety
34. **Free-tier budget:** a skipped cron call does at most a few indexed reads, and a send reads every table once (one dump). The backend states the expected monthly row reads and writes in `backend.md` (done: about 120 reads a month for skipped calls, at most 50 k per send, fewer than 10 writes a month). The run logs `backup run <status> in <ms> ms, <bytes> bytes`, and the measured dev duration goes into `e2e-results.txt`. It must be far below 60 s (`maxDuration = 60` on the cron route **and** on `/yedek/page.tsx`). (Gate.)
35. **Live migration safety** (amended D15). Migration `0007_phase7_backup` is expand-only (the new `backup_runs` table) **plus a lossless, backward-compatible rebuild of `app_settings`**, which:
    - widens the key CHECK
    - adds `created_at`, backfilled from `updated_at`
    
    Old code keeps working against the new table. The migration applies atomically on a production-shaped copy, and `db:check` passes afterwards. The README deploy order is unchanged: `db:migrate` (with its backup) before deploying the code. (e2e: the migration count in `db:check`. Gate: the DBA confirms it on a copy.)
36. **No regression:** the full existing suite stays green, including:
    - the CSV routes, whose output is byte-identical after the builders move
    - the Phase 6 security headers on the new page and route (nonce CSP on `/yedek`, `no-store` on the cron route)
    - 0 CSP violations on `/yedek` and on `/` with a banner
    
    (e2e.)

### S9. Test round and acceptance
37. `npm run e2e` and `npm run e2e:prod` are fully green. `npm run lint`, `npm run typecheck` and `npm run build` are clean, and the build table shows `/api/cron/aylik-yedek` and `/yedek` as dynamic. Results go to `design/phase-7/e2e-results.txt`. New dev tests run at 375×812.
38. Team review (`review-ux/ui/db/backend.md`), with every P1 and P2 fixed before the PO review. `review-backend.md` records the grep showing that only `src/lib/finance/queries.ts` and `src/lib/backup/*` import the unguarded finance internals (D11).
39. **First real run** (post-deploy gate, the user): after the deploy, README steps 5–7 are done once on the live site.
    - Kurulum shows four `Tamam`.
    - A manual send reaches every recipient.
    - The restore drill passes on that attachment.
    
    The tech lead records the date in `STATUS.md`. This is the only AC that runs against production. It doesn't block code acceptance, but it blocks calling the phase "live".

## 5. Out of scope (explicitly)

- **Weekly or daily backup emails** (P4). An option for later, see §7.
- Uploading backups to Google Drive, S3/R2, GitHub or any other storage. Email is the storage.
- Restoring from the app UI, or any "download backup" button in the app. Restore is a laptop task, done with the README.
- HTML email, charts or logos in the email.
- Choosing the report month for `Şimdi gönder`, custom date ranges, or re-sending an abandoned month from the UI (D7).
- Encrypting the CSV reports, or a per-recipient choice of attachments.
- Emailing members (reminders, receipts, homework notices). This phase sends only to the configured officers.
- A general `Ayarlar` page. `Yedekleme` stays its own page.
- **The passphrase id** (D13) and a dynamic `/profil` hint (D14): backlog.
- Changing the Phase 6 deferred backlog; those items stay where they are.

## 6. Next phases (not specified now)

- **Phase 8:** a board kanban page (yönetim işleri), and budget plan vs actual.
- **Phase 9:** audio recording upload, the assistant → conductor → singer review flow, and MIDI files.

## 7. Open risks (after decisions)

1. **Gmail may refuse SMTP from Vercel IPs.** README step 6 surfaces it on day one, and the fallback chain is in AC 31 (D12).
2. **Passphrase loss is the single point of failure.** The mitigations are README step 3, the Kurulum reminder, and the restore drill on the first email (AC 39).
3. **The recipients' mailboxes become a long-lived store of member data** (the encrypted backup and the plain CSVs). Acceptable for 1–5 board addresses. The controls are the hint text, the change notice (AC 14) and the throttles (AC 40). KVKK: these are the same officers who already see this data in the app.
4. **At-least-once delivery** can, rarely, send a duplicate email (D7). Accepted.
5. **Weekly later?** If the board asks, the cheapest version is a weekly backup-only email (no CSVs) on Mondays. The run table supports it with an expand-only column (`db.md` §6).

## 8. Priorities if time runs short

Must, in order:
1. AC 2–5 and 22–26: a safe, idempotent cron and failure handling
2. AC 27–30: the encrypted backup and the restore drill
3. AC 7–12: the email content
4. AC 14–17 and 19–20: recipients, the page, the run log, the banner
5. AC 31–33 and 35–38: docs, secrets, migration, tests

Should: AC 6, 13, 18, 21, 34 and 40. Could: none. Anything cut gets an entry in `po-decisions.md`. The phase can't be accepted with a Must missing.
