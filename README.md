# Arkhe Portal

Member portal for Arkhe Mülkiye Çoksesli Korosu. Plan: `PLAN_INPUT.md`. Team docs: `design/`.

## Local development

```bash
npm install
npm run db:reset   # creates data/arkhe.db, migrates and seeds demo data (dev server stopped)
npm run dev        # http://127.0.0.1:3100
```

Demo logins (local only; refused by a production build): `sef@arkhe.local`, `yk@arkhe.local`, `korist@arkhe.local`, password `arkhe-demo-2026`.

| Command                                              | What it does                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run e2e`                                        | End-to-end suite in real Chrome against the running dev server (resets its own data).               |
| `npm run e2e:prod`                                   | Production smoke: builds, starts a throwaway prod server on 3101 with its own DB, tests, cleans up. |
| `npm run lint`, `npm run typecheck`, `npm run build` | Must stay clean.                                                                                    |
| `npm run db:migrate`                                 | `db:backup` → `drizzle-kit migrate` → `db:check`.                                                   |
| `npm run db:backup`                                  | Plain-SQL dump to `data/backups/<UTC timestamp>.sql`.                                               |
| `npm run db:check`                                   | Foreign keys, orphans, `migrations=N/N`, `quick_check` (file DBs), no demo accounts (remote DBs).   |
| `npm run create-admin -- "Ad Soyad" email`           | Creates or promotes a conductor and prints a one-time password link (24 h).                         |
| `npm run db:decrypt -- <file.sql.gz.enc>`            | Decrypts a monthly backup attachment to `data/backups/<name>.sql` (prompts for the passphrase).     |
| `npm run db:restore -- <file.sql> <target.db>`       | Restores a plain-SQL dump into a new local SQLite file; refuses to overwrite anything.              |

Environment variables: see `.env.example`.

---

## Deploy (Vercel Hobby + Turso)

Everything here is free. No step needs a card or a paid plan; if a provider asks for one, stop and pick the fallback host below.

**Golden rules**

- The Turso URL and token live **only in your shell session** while you run a maintenance command, and in the host's dashboard. **Never put them in `.env`**: `npm run dev`, `seed` and `e2e` read `.env`.
- Never type the token on a command line (it lands in shell history). Start every laptop session like this and end it with `unset`:
  ```bash
  read -rs DATABASE_AUTH_TOKEN   # paste the token; nothing is echoed
  export DATABASE_AUTH_TOKEN DATABASE_URL=libsql://arkhe-<org>.turso.io
  # … npm run db:migrate / db:check / db:backup / create-admin …
  unset DATABASE_AUTH_TOKEN DATABASE_URL
  ```
- **Migrate first, then deploy code.** Every migration must be expand-only (add tables, columns, indexes; never drop or rename in the same release), so the previous deployment keeps working on the new schema and a rollback stays safe.
- Backups contain password hashes and members' personal data. Keep them on the laptop under `data/backups/` (git-ignored). Never commit, upload or share them.
- If a token leaks: `turso db tokens invalidate arkhe` (rotates every token of the database), create new ones, update the host's variables and redeploy.

### Checklist

1. **Create the database (Turso, free).**
   - Sign up at turso.tech with the choir's account; install the Turso CLI.
   - `turso db create arkhe`
   - `turso db show arkhe --url` gives `libsql://arkhe-<org>.turso.io`.
   - Two tokens, never the same one for both:
     - for the host: `turso db tokens create arkhe` (goes only into Vercel's dashboard);
     - for the laptop: `turso db tokens create arkhe --expiration 7d`, created fresh for each maintenance session.
2. **Migrate** from the laptop, in a session started as in the golden rules:
   ```bash
   npm run db:migrate
   ```
   This runs `db:backup` (an empty file on a fresh DB, that's fine), then `drizzle-kit migrate`, then `db:check`.
3. **Verify:** `npm run db:check`. Expect `foreign_keys=1, orphaned rows=0, migrations=N/N` and no `demo accounts present`.
4. **Create the first admin** (the conductor) with a real email:
   ```bash
   APP_URL=https://<your-domain> npm run create-admin -- "Ad Soyad" sef@example.org
   ```
   It prints a `/davet/<token>` link valid for 24 hours. Open it after step 6 and set the password. `@arkhe.local` emails are refused. Everyone else is invited from `Üyeler` → `Üye ekle` in the app.
5. **Import into Vercel Hobby.**
   - vercel.com → Add New → Project → import the repository (framework: Next.js; build command `npm run build`, defaults otherwise). Node ≥ 20.9 (`engines` in `package.json`).
   - Settings → Environment Variables. Tick **Production only**, never Preview or Development: a preview of an unreviewed branch must not reach the members' database. Preview deployments then fail the boot check (`DATABASE_URL is required in production.`); that is intended.
     - `APP_URL` = `https://<project>.vercel.app` or your domain (origin only, no trailing path)
     - `DATABASE_URL` = `libsql://arkhe-<org>.turso.io`
     - `DATABASE_AUTH_TOKEN` = the host token from step 1
     - `TRUST_PROXY_HEADERS` = `1` exactly (Vercel overwrites the forwarded-IP headers, so per-IP login limits are safe to turn on; any other value stops the server)
6. **Deploy and check health.** Deploy, then open `https://<your-domain>/api/saglik`: it must show `{"ok":true}`. If every page fails (`FUNCTION_INVOCATION_FAILED` or a 500) right after a deploy, an env variable is wrong: Vercel → the project → Logs, search `Invalid environment`; the lines below it name each variable. Fix it and redeploy. Then open the invite link from step 4 and log in.
7. **Install on a phone and run the manual checks** below (`Post-deploy manual checklist`).
8. **Backups.**
   - Run `npm run db:backup` (in a maintenance session) before every migration (`db:migrate` does it for you) and on the 1st of every month. Files land in `data/backups/<UTC timestamp>.sql`; it prints a row count per table. The dump is read in one transaction, so it is consistent even while the choir uses the app.
   - A second, independent copy with the Turso CLI: `turso db shell arkhe .dump > data/backups/<date>-turso.sql`.
   - `db:backup` and `db:check` work against `libsql://` URLs exactly as against local files.
   - **Restore drill** (once before go-live, then after every migration that changes tables):
     1. `sqlite3 /tmp/arkhe-restore.db < data/backups/<file>.sql`
     2. `DATABASE_URL=file:/tmp/arkhe-restore.db npm run db:check` must pass with `migrations=N/N`.
     3. `rm -f /tmp/arkhe-restore.db /tmp/arkhe-restore.db-wal /tmp/arkhe-restore.db-shm`
   - **Restore to Turso (real incident).** First choice, only if the free plan offers it at that time: point-in-time restore into a new database (`turso db create arkhe-restore-<yyyymmdd> --from-db arkhe --timestamp <UTC time before the incident>`); it loses less than the last backup. Otherwise, from a backup:
     1. Create a **new** DB from the dump, never on top of the broken one: `turso db create arkhe-restore-<yyyymmdd> --from-dump data/backups/<file>.sql`. (Without that option: `turso db create arkhe-restore-<yyyymmdd>` then `turso db shell arkhe-restore-<yyyymmdd> < data/backups/<file>.sql`.)
     2. `turso db show arkhe-restore-<yyyymmdd> --url`, `turso db tokens create arkhe-restore-<yyyymmdd>` (host) and a 7-day one for the laptop.
     3. In a maintenance session pointed at the new DB: `npm run db:check`.
     4. Vercel → Settings → Environment Variables: point `DATABASE_URL` and `DATABASE_AUTH_TOKEN` at the new DB, then **Redeploy** the current production deployment, and open `/api/saglik`.
     5. Keep the old DB until the choir confirms the data, then `turso db destroy <old>`. If the free plan's database limit blocks step 1, destroy the broken DB first, but only after the restore drill passed on that backup.

     Data written between the backup and the incident is lost; that is why a backup runs before every migration.
9. **Rollback.**
   - **Code:** Vercel → Deployments → the previous good deployment → "Promote to Production". Safe because migrations are expand-only, and **only while the database URL is unchanged**: a deployment keeps the environment it was built with.
   - **Schema or data:** there are no down-migrations. Restore the backup `db:migrate` wrote just before the migration (steps above). Then, in Vercel → Deployments, open the deployment whose code matches that schema and use **Redeploy** (not Promote), so it is rebuilt with the new `DATABASE_URL`/`DATABASE_AUTH_TOKEN`. **Never Promote a deployment created before a database switch.**
   - **Service worker kill switch:** if a bad `public/sw.js` ever pins phones to broken assets, set `const KILL = true;` in `public/sw.js` and deploy. On the next visit each phone installs it, deletes every cache, unregisters the worker and reloads. Later, set `KILL = false`, bump `VERSION` and deploy again to bring offline support back. Bump `VERSION` on every change to `sw.js`.

### Free-tier limits that matter

Re-read both providers' current free-plan terms and limits **before go-live**; they change.

- **Vercel Hobby** is for personal, **non-commercial** use. A volunteer choir's internal tool is non-commercial in our reading, but that is not certain. It also caps function invocations, execution time and bandwidth per month; a 30–60 member choir is far below them. If the terms don't fit, use the fallback host.
- **Turso free** caps the number of databases, total storage and monthly row reads/writes. Our data is a few MB; a restore needs one extra database for a while (step 8).
- Neither needs a card. Never upgrade; this project has zero budget.

### Fallback host: Render free web service

Same build as the production smoke test (`next build` + `next start`), Turso unchanged.

- render.com → New → Web Service → the repository, runtime Node, instance type **Free**.
- Build command: `npm ci && npm run build`
- Start command: `npx next start -H 0.0.0.0 -p $PORT` (`npm start` binds `127.0.0.1:3100` and would be unreachable).
- Environment: `APP_URL=https://<name>.onrender.com`, `DATABASE_URL=libsql://…`, `DATABASE_AUTH_TOKEN=…` (the host token). **Leave `TRUST_PROXY_HEADERS` unset**: Render's proxy appends to `X-Forwarded-For`, so the first hop can be forged. The server logs `TRUST_PROXY_HEADERS is not set; per-IP login limits are off.` once; that's expected: each account then has only its own limit (30 wrong passwords per 15 minutes), which also means no stranger can lock an account out with a few guesses.
- A `file:` database is refused at boot there (ephemeral disk).
- **Cold start:** a free instance sleeps after about 15 minutes idle; the first request then takes up to about a minute. Open the portal a few minutes before a rehearsal's check-in, or point a free uptime pinger at `/api/saglik`.
- Steps 1–4 and 6–9 above are the same; in step 9, "Promote" becomes Render's "Rollback" to a previous deploy. A Render rollback also reuses that deploy's old environment: after a database switch, change the variables and use **Manual Deploy** instead.
- If an env variable is wrong, the deploy fails to start; Render → the service → Logs shows `Invalid environment:` and the variables.
- Recheck Render's free-plan terms before go-live.

---

## Aylık yedek e-postası

On the 1st of every month (Vercel Cron, daily at 05:00 UTC = 08:00–09:00 Istanbul) the portal emails the previous Istanbul month's reports and an encrypted copy of the whole database to the 1–5 addresses the conductor saves on `/yedek`:

- `arkhe-devam-YYYY-MM.csv`, `arkhe-odev-YYYY-MM.csv`, `arkhe-finans-YYYY-MM.csv`, `arkhe-aidat-YYYY-MM.csv`: plain CSVs (names, attendance, homework and dues; no emails or phones).
- `arkhe-yedek-YYYY-MM-DD-HHmm.sql.gz.enc`: the same dump as `db:backup`, gzipped and encrypted with AES-256-GCM; the key comes from scrypt over `BACKUP_PASSPHRASE`.

The cron runs every day; it sends only while the previous month has no successful send, so a failed 1st retries itself the next morning. A month that is still unsent when the next month starts is abandoned; its CSVs can still be exported from `/raporlar` and `/finans/rapor`. In dev (`npm run dev`) nothing is sent: every email is written to `data/outbox/*.eml`.

### Setup (once, by the deployer)

1. **Gmail.** Create (or reuse) a choir Gmail account. Turn on 2-Step Verification, then Google Account → Security → App passwords → create one named `Arkhe Portal`. Changing the Google password revokes it.
2. **Passphrase.** Generate one of at least 16 characters: `openssl rand -base64 24`.
3. **Store the passphrase outside Vercel, in two places** (for example the conductor's password manager and a sealed paper copy with the board president). Without it every backup is useless. If it is lost, the live data is unaffected: set a new one, redeploy and press `Şimdi gönder`. Rotating it doesn't re-encrypt old backups, so keep the old one with its date.
4. **Cron secret.** `openssl rand -hex 32`. Production refuses anything shorter than 32 characters and the dev value.
5. **Vercel → Settings → Environment Variables, Production only, typed by hand** (never paste them into chat, a file or a commit), then redeploy:
   - `SMTP_USER` = the choir Gmail address
   - `SMTP_PASS` = the App Password (spaces are ignored)
   - `SMTP_FROM` (optional) = e.g. `"Arkhe Korosu" <koro@gmail.com>`; default `"Arkhe Portal" <SMTP_USER>`
   - `BACKUP_PASSPHRASE` = the passphrase from step 2
   - `CRON_SECRET` = the value from step 4 (Vercel sends it as `Authorization: Bearer …`)
6. **First send.** As the conductor, open `/yedek`, save the recipients and press `Şimdi gönder`. Check that the email arrives (look in spam once and mark it "not spam") and that Kurulum shows four `Tamam`.
7. **Restore drill on that first email** (below), then delete the local copies.

The portal starts without any of these variables; a missing one only fails the send, shows `Eksik` under Kurulum and logs one boot warning with the variable names.

### Decrypt and restore (laptop)

Save the `.sql.gz.enc` attachment, then:

```bash
npm run db:decrypt -- ~/Downloads/arkhe-yedek-2026-11-01-0802.sql.gz.enc   # prompts "Backup passphrase:"
npm run db:restore -- data/backups/arkhe-yedek-2026-11-01-0802.sql data/restore-drill.db
DATABASE_URL=file:$PWD/data/restore-drill.db npm run db:check                  # migrations=N/N
rm -f data/restore-drill.db data/restore-drill.db-wal data/restore-drill.db-shm data/backups/arkhe-yedek-*.sql
```

- Neither script reads `.env` or `.env.development`. The passphrase comes from a `BACKUP_PASSPHRASE` set in your shell, or from the prompt (no echo).
- A wrong passphrase or a damaged file prints `Wrong passphrase or damaged file.` and writes nothing. The decrypted `.sql` is written with owner-only permissions and holds password hashes and member data: delete it after use.
- An older backup restored next to newer code shows `migrations missing` in `db:check`; run `DATABASE_URL=file:<target> npx drizzle-kit migrate` on the restored file.
- **Real incident:** decrypt, then follow "Restore to Turso" above with the `.sql` file.

### Notes

- **Turso's free point-in-time restore reaches back 1 day only.** For anything noticed later, the monthly email is the backup.
- Vercel Hobby cron fires once a day somewhere between 08:00 and 09:00 Istanbul and runs only on the production deployment. Gmail's daily sending limit (~500) is far above our use.
- The CSVs are not encrypted. Add only board members' addresses; every recipient change emails the old and the new list.

### Gmail girişi reddedilirse

The run log on `/yedek` shows `Gmail girişi reddedildi. Uygulama şifresini kontrol et.`

1. Sign in to the choir Gmail in a browser, open Security → Recent security activity and confirm the sign-in ("Yes, it was me"). Press `Şimdi gönder` again.
2. Revoke the App Password, create a new one, update `SMTP_PASS` in Vercel and redeploy.
3. Only then, a free fallback provider with no code change: set `SMTP_HOST` and `SMTP_PORT` (465 uses TLS, any other port STARTTLS) and that provider's `SMTP_USER`/`SMTP_PASS`. Options: **Brevo's free plan** (`smtp-relay.brevo.com`, port `587`) or a free **Yandex** mailbox with an app password (`smtp.yandex.com`, port `465`). The provider then carries the plain CSVs and the encrypted backup, so the board should agree first. Free plan only, never enter a card; check the provider's current free terms at setup time.

---

## Post-deploy manual checklist (real phones)

Do these once on the deployed site, on one iPhone (Safari) and one Android phone (Chrome), in light and dark mode. Tick each.

**Install and offline**

- [ ] `Profil` shows `Telefonuna ekle`. Android: `Ana ekrana ekle` installs the app. iOS: Safari Share → "Ana Ekrana Ekle". The icon looks right on the home screen; the app opens without browser chrome and the card is gone.
- [ ] Airplane mode, then open a page from the installed app: `Bağlantı yok` with `Tekrar dene`, readable in both themes. Back online, `Tekrar dene` returns to the portal.
- [ ] Log out, go offline, open the app: the offline page appears, never a previously visited portal page.

**Repertoire**

- [ ] A real public Google Drive PDF previews inside a piece's detail, and the `Drive'da aç` link opens it.
- [ ] A real YouTube video previews (youtube-nocookie) and plays.

**Attendance**

- [ ] Live screen (`Canlı ekran`) on a laptop or tablet: the QR scans from a phone camera app and lands on check-in; typing the code also works. The screen stays awake during the rehearsal.

**Homework**

- [ ] The recording mail button opens the phone's mail app with the recording address and a subject with Turkish characters (`ş ğ ı İ ö ü ç`) intact, on iOS and Android.

**Finance**

- [ ] Decimal amount input: iPhone with English region, `150.5` echoes ₺150,50; Turkish region, `150,5` echoes ₺150,50; the same on Android.
- [ ] `Muhasebe CSV` and the dues CSV open in Turkish Excel and in LibreOffice with the right columns, `ş/ğ/ı/İ` intact, amounts summable.
- [ ] Dark mode: the solid overdue badge (`Gecikti`) is readable, and a negative `Toplam` in `text-absent-ink` on the stage tile is readable in both themes.

**Accounts and security**

- [ ] `korist@arkhe.local` / `arkhe-demo-2026` gets `E-posta ya da şifre hatalı.` (demo accounts never work in production).
- [ ] An invite link from `Üyeler` sets a password and logs the new member in; the link can't be reused.
- [ ] In the browser's developer tools on a laptop, a page load shows no `Content-Security-Policy` errors in the console.
