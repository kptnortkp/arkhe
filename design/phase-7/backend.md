# Phase 7: backend and security plan (arkhe-backend)

Author: arkhe-backend. Date: 2026-10-21. Inputs: `po-spec.md` (AC 1–39), `ux.md`, `ui.md`, `db.md`, `CLAUDE.md`, `AGENTS.md`, `design/phase-6/backend.md`. Code read: `src/proxy.ts`, `next.config.ts`, `src/instrumentation.ts`, `src/lib/{env,boot-check,api,csv,permissions,validation,money,time}.ts`, `src/lib/auth/{dal,session,rate-limit}.ts`, `src/app/api/saglik/route.ts`, `src/app/(portal)/raporlar/{page.tsx,csv/route.ts}`, `src/app/(portal)/finans/{rapor,aidat}/csv/route.ts`, `src/lib/attendance/{csv,stats,period,close,roster}.ts`, `src/lib/finance/{queries,dates}.ts`, `src/lib/homework/{queries,mail}.ts`, `src/app/(portal)/odevler/actions.ts` (`setRecordingEmail`), `scripts/db-backup.ts`, `src/db/{client,index}.ts`, `e2e/prod.mjs`. Next docs read: `03-file-conventions/{route,proxy}.md`, `02-route-segment-config/{index,runtime,maxDuration}.md`. nodemailer 10.1.7 tarball unpacked in the scratchpad (types, error codes, licence). `src/` is untouched. This is a plan.

---

## 0. Decisions in one table

| Topic | Decision |
|---|---|
| Cron route | `src/app/api/cron/aylik-yedek/route.ts`, `GET` only, `runtime = "nodejs"`, `maxDuration = 60`, `await connection()` first, `Cache-Control: no-store` on every response. Bearer compared as SHA-256 digests with `timingSafeEqual`. |
| Proxy | No change. `/api/` is already a public prefix, so no redirect. The proxy adds a CSP header and an `x-nonce` request header, which are harmless on JSON and don't touch `Authorization` (§2.3). |
| Claim / idempotency | Exactly the DBA's SQL (`db.md` §1.3, §1.4): reap + conditional insert in one `db.batch`, a partial unique index as the backstop, finish + prune in one batch. |
| Guarded finance queries | `csvEntries`, `duesMatrix` and `monthSummary` call `requireManager()`, which **redirects** (a 307 to `/giris`) when there is no session cookie, as in a cron call. So split each into an unguarded internal + the guarded export (§5.1). This is the one thing that would silently break the cron if missed. |
| CSV builders | Move the row mapping out of the three CSV routes into `src/lib/{finance,attendance,homework}/csv.ts`. Routes and the email both call them, so AC 11's byte equality holds by construction. |
| Encryption | gzip → AES-256-GCM. Key = scrypt(passphrase, 16-byte salt), N = 2^17, r = 8, p = 1 (128 MiB, 153 ms measured on M5, est. 0.3–0.7 s on Vercel). 41-byte header `ARKHE-BK1` + params + salt + IV, authenticated as AAD; 16-byte tag at the end (§6). |
| Mail | nodemailer **10.1.7** (pin exact; licence **MIT-0**, ships its own types, zero dependencies, npm provenance). Production: Gmail SMTP 465 with short timeouts. Otherwise: `streamTransport` + `buffer` → `data/outbox/*.eml`, never SMTP (§7). |
| Config | `src/lib/backup/config.ts`, pure (no `server-only`). Never part of the boot check (P9). Missing vars only fail a run and show as `Eksik`. The dev values count as missing in production (AC 25). |
| Dev env | Agree with @ui: commit `.env.development` with the two dev values (§3.3). |
| Size guard | **18 MB raw** instead of 20 MB (@po, §8). |
| `db:decrypt` | Reads no `.env` file, ever (§6.4). Otherwise the dev passphrase would be tried on a real backup. |
| Throttles | Reuse `consumeAttempt` (the `login_attempts` table, as check-in does): recipient changes 10/day per conductor, manual sends 6/hour. No new table. |

---

## 1. Replies

**@po**
1. **AC 13, the size limit.** Gmail's 25 MB is measured on the encoded message, and base64 grows attachments by 4/3. 20 MB raw ≈ 26.7 MB encoded, which Gmail rejects. Use **18 MB raw** (≈ 24 MB encoded plus the headers). Copy: `Ekler 18 MB sınırını aşıyor. Portalı kuran kişiye haber ver.` (UX's wording). Our real size is a few hundred KB, so this is a correctness fix, not a practical limit.
2. **AC 15, 404.** Agree with @ui: `requireManager()` redirects members to `/`, the same as every other manager page. Keep that and fix the AC text.
3. **AC 8 money format.** Agree with @ux: `formatKurus`/`formatNet` give `₺12.500,00`. The body uses the app formatter.
4. **AC 8 `Ortalama devam` "same formula as `/raporlar`".** `/raporlar` shows only per-part averages (`page.tsx:29-34`, mean of the members' non-null `percent`, rounded). For the email I use the same formula over all members: `round(mean(percent))` over members with `percent !== null`, `—` when none. Please accept that reading.
5. **AC 2, CRON_SECRET strength.** Besides "unset" and "the dev value", treat a `CRON_SECRET` **shorter than 32 characters** in production as missing (503, Kurulum `Eksik`). README step 4 makes 64 hex chars, so a real setup never hits it. It stops a hand-typed `arkhe2026`.
6. **AC 2 response codes.** `sent` and `skipped` → 200, `failed` → **500** (body still just `{"status":"failed"}`). That way the Vercel dashboard marks the cron invocation red. Vercel doesn't retry crons, so there's no side effect.
7. **The first automatic send (UX's option A vs B).** Backend is fine with either. With (A), the cron sends September the morning after the recipients are first saved. `nextSendAt()` (§9.3) implements both rules, so the PO's choice is one `if`.
8. **A month that keeps failing is abandoned at month end.** If the cron fails every day of November (SMTP broken), on 1 Dec the target becomes November and October is never emailed. The data is still in the DB, and the backup is a snapshot anyway. I think that's right, but it should be in `po-decisions.md`.
9. **Duplicate emails are possible, by design.** If the email went out but the finish write failed (Turso blip, function killed), the row stays `running`, gets reaped, and the next day sends again. That is at-least-once delivery, which is the right side for a backup (agree with `db.md` §1.3).
10. **New copy needed** (beyond `db.md`'s `Şu anda bir gönderim sürüyor. Birkaç dakika sonra yeniden dene.`):
    - recipients saved but the change notice failed: `Alıcılar kaydedildi, ancak değişiklik bildirimi gönderilemedi.` (toast, success style plus the warning). The save stays; see §8.1.
    - manual-send throttle (6/hour): `Çok fazla deneme. Bir saat sonra yeniden dene.`
    - recipient-change throttle (10/day): `Alıcılar bugün çok sık değişti. Yarın yeniden dene.`
11. **Constraint 2, "no new account".** I propose an optional `SMTP_HOST` / `SMTP_PORT` (defaults `smtp.gmail.com` / `465`). It costs nothing and is unused by default. It only matters if Gmail blocks Vercel (§11.1), and then the user can switch providers with no code change. Please allow it in `.env.example` and the README as "only if Gmail fails".
12. **nodemailer licence.** The current npm licence field is **MIT-0** (MIT without the attribution clause), not MIT. That's even more permissive, so the zero-budget/open-source rule holds. Please say "MIT-0" in the spec.

**@ux**
- I'll use the README name `Aylık yedek e-postası` everywhere (errors, page, email).
- I'll use your §7 strings, unless the PO overrides them in `po-decisions.md`. They're in one map, `src/lib/backup/messages.ts`.
- `nextSendAt()` follows your §2.2 rule exactly. It returns `{ at, kind: "gönderim" | "deneme" }`.
- One-paragraph-per-line body: agreed. nodemailer picks quoted-printable for long UTF-8 lines by itself.

**@ui**
1. **`.env.development`: agreed.** It also needs `!.env.development` in `.gitignore`. The current `.env*` rule would otherwise hide it, and only `!.env.example` is excepted. AC 33's grep allows the dev values. The `e2e` script change you propose is right.
2. **`maxDuration = 60` on `yedek/page.tsx`: agreed.** The docs (`maxDuration.md`, "Server Actions") are explicit that the action inherits the page's limit.
3. The `BackupPage` shape: agreed, with three changes:
   - `setup.cronSecret` and `setup.passphrase` are booleans computed by `backupSetup()` (§3.1), never a value or a length.
   - Add `setup.recipients: number`.
   - Add `previous.monthLabel` and `nextSend: { at: Date; kind }` so the page doesn't recompute the rules.
4. Action signatures: `saveBackupRecipients(prev: FormState, fd: FormData): Promise<FormState>` and `sendBackupNow(): Promise<FormState>`. The field-error key is `recipients.<i>`, where `i` is the index in the submitted list (before empties are dropped). That's your contract.
5. `formatMonthYear` in `src/lib/time.ts`: agreed. The subject, the body and the page all use it.
6. AC 28, two sends differing: backdate the first row as you and the DBA describe. The cooldown stays.

**@dba**
- I take `db.md` §1.3/§1.4 verbatim: the reap + claim batch, the finish + prune batch, the `status = 'running'` guard, the comma-separated recipients, and `created_at` for rule (b).
- Drizzle's `db.batch()` takes no mode and runs libsql's default `deferred`. That's still atomic here, because the first statement (the reap `UPDATE`) takes the write lock before the `INSERT … NOT EXISTS` reads. I'll keep that order and comment it.
- The 600 s stale threshold, the 10-minute cooldown and `maxDuration` live in `src/lib/backup/constants.ts`. `STALE_SECONDS` must stay > `maxDuration` (comment there).
- Agree that the dump includes `backup_runs` and needs no special case. The attachment's dump is taken **after** the claim, so it holds its own `running` row. That's fine, as you say.
- `db:restore`: agree with `db.md` §5 in full. I add only the encrypted-input refusal message, which you already have.

---

## 2. Cron route `/api/cron/aylik-yedek`

### 2.1 File and segment config

`src/app/api/cron/aylik-yedek/route.ts`:

```ts
export const runtime = "nodejs";   // explicit for AC 2; cacheComponents is off, so allowed
export const maxDuration = 60;

export async function GET(request: Request) {
  await connection();               // as /api/saglik: never prerendered
  const secret = cronSecret(process.env);           // null when unset, short, or the dev value in prod
  if (!secret) return status(503);                  // never "open because unconfigured"
  if (!bearerMatches(request.headers.get("authorization"), secret)) return status(401);
  const today = testToday(new URL(request.url)) ?? istanbulDateOf(new Date());
  const result = await runMonthlyBackup({ trigger: "cron", today });
  return status(result === "failed" ? 500 : 200, result);
}
```

- `status(code, s?)` returns `Response.json(s ? { status: s } : {}, { status: code, headers: { "Cache-Control": "no-store" } })`. 401 and 503 have the body `{}`: no details (AC 2).
- No other method is exported, so `POST` and the others get Next's 405.
- The route never reads cookies. It doesn't use `managerOrError`.

### 2.2 Bearer check (constant time)

```ts
function bearerMatches(header: string | null, secret: string) {
  const a = createHash("sha256").update(header ?? "").digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
```

Hashing first makes both buffers 32 bytes. `timingSafeEqual` throws on unequal lengths, and a raw length check would leak the secret's length. Vercel sends exactly `Authorization: Bearer <CRON_SECRET>` when an env var of that name exists.

### 2.3 How it sits with `proxy.ts`, CSP and `/api/saglik` (§7 Q4)

- `PUBLIC_PREFIXES` contains `/api/`, so a cookieless request is never redirected. Vercel's cron does not follow redirects, so a redirect would make the run silently "succeed" as a 307.
- The matcher still runs the proxy for this path. It sets the `Content-Security-Policy` response header and overwrites the `x-nonce`/CSP **request** headers. It copies all other request headers, `Authorization` included. A CSP header on a JSON response is harmless. AC 36 asks for `no-store`, which the route sets itself.
- `next.config.ts` adds HSTS, `nosniff` and the rest to every path, the cron route included. Nothing breaks for the cron.
- Same pattern as `/api/saglik`: `connection()`, fixed bodies, reasons only in the server log. The difference is that `/api/saglik` is open, and this route is closed before any DB access. A wrong or missing bearer costs no DB read, so unauthenticated hammering costs us only CPU, and it never touches Turso.
- `trailingSlash` is not set, so `/api/cron/aylik-yedek` is the exact path `vercel.json` uses.

### 2.4 The `?bugun=` test hook (AC 30, §7 Q6)

```ts
function testToday(url: URL) {
  if (process.env.NODE_ENV === "production") return null;
  const v = url.searchParams.get("bugun");
  return v && isRealDay(v) ? v : null;
}
```

- Next inlines `process.env.NODE_ENV` at build time, so in a production build this function is `return null`, and the branch is dead code. A custom flag would be weaker.
- `isRealDay` is the existing helper from `src/lib/finance/schemas.ts`. An invalid value is ignored, not a 400, so the response shape stays `{status}` only.
- The hook changes only the report-month choice, the dues "as of" date and `nextSendAt` in tests. `started_at`, the 10-minute staleness, the cooldown and the backup file name always use the real clock.

### 2.5 `vercel.json` (new file, AC 1)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/aylik-yedek", "schedule": "0 5 * * *" }]
}
```

Hobby allows daily crons, fired anywhere in the hour (05:00–05:59 UTC = 08:00–08:59 Istanbul; Turkey has no DST). Crons run only on the production deployment. `$schema` doesn't affect AC 1's "exactly one cron" assertion.

---

## 3. Configuration (`src/lib/backup/config.ts`, pure)

### 3.1 API

```ts
type Env = Record<string, string | undefined>;
const DEV_PASSPHRASE = "dev-only-backup-passphrase";
const DEV_CRON_SECRET = "dev-only-cron-secret";

export function cronSecret(env: Env): string | null;        // null: unset, < 32 chars in prod, or dev value in prod
export function backupPassphrase(env: Env): string | null;  // trimmed; null: unset, < 16 chars, or dev value in prod
export function smtpConfig(env: Env):
  | { mode: "outbox" }
  | { mode: "smtp"; host: string; port: number; user: string; pass: string; from: string }
  | { mode: "missing" };
export function backupSetup(env: Env): { mail: "ok" | "dev" | "missing"; passphrase: boolean; cronSecret: boolean };
```

- "Production" means `env.NODE_ENV === "production"`. Vercel previews are production builds too, so they'd also refuse the dev values. Crons never run there anyway.
- `smtpConfig`:
  - outside production it is always `{ mode: "outbox" }` (P8), whatever `SMTP_*` say.
  - in production it is `missing` unless both `SMTP_USER` and `SMTP_PASS` are non-empty.
  - `SMTP_PASS` has all whitespace removed. Google shows App Passwords as `abcd efgh ijkl mnop`, and a pasted copy keeps the spaces.
  - `SMTP_FROM` is used only if it has no CR/LF and matches `^[^"<>\r\n]{1,64} <[^\s@<>]+@[^\s@<>]+>$` or a bare address. Otherwise it is ignored with a one-time `console.warn("SMTP_FROM is malformed; using SMTP_USER")`, and the default is `"Arkhe Portal" <SMTP_USER>`.
  - `SMTP_HOST`/`SMTP_PORT` are optional (@po 11). `secure` is `port === 465`; otherwise STARTTLS with `requireTLS: true`.
- The passphrase is trimmed and NFC-normalised, both here and in `db:decrypt`. Leading or trailing whitespace is never intended, and a stray newline from a paste is the likely failure.
- `backupSetup` feeds the Kurulum rows. It returns booleans only. No value, length or prefix of a secret ever reaches a component.

### 3.2 Boot behaviour (P9)

- `envProblems()` (Phase 6, fail-fast) is **not** extended. A missing backup var never stops the server.
- `bootWarnings()` gets one line in production when something is missing: `Monthly backup email is not fully configured: SMTP_USER, CRON_SECRET` (names only, never values). The deployer sees it in the Vercel log on the first request.

### 3.3 Dev and e2e

- `.env.development` (committed): `CRON_SECRET=dev-only-cron-secret` and `BACKUP_PASSPHRASE=dev-only-backup-passphrase`, with a one-line comment that production refuses both. Plus `!.env.development` in `.gitignore`.
- `.env.example` (AC 32):
  - the five spec keys, plus commented `SMTP_HOST`/`SMTP_PORT`
  - `SMTP_*` commented out
  - a note that the two dev values live in `.env.development` and are refused in production. The spec asks for them in `.env.example`, so set them there too. Harmless, and AC 32's grep passes either way.
- `.gitignore`: `/data/` already covers `data/outbox/`. Add an explicit `/data/outbox/` line anyway, because AC 32 greps for it.

---

## 4. The run (`src/lib/backup/run.ts`, server-only)

```ts
export type RunResult = "sent" | "skipped" | "failed";
export async function runMonthlyBackup(opts:
  | { trigger: "cron"; today: string }
  | { trigger: "manual"; today: string; actor: { id: string; name: string } }
): Promise<{ result: RunResult; recipients?: number; refusal?: "running" | "cooldown"; minutesLeft?: number }>;
```

Order. Every step before 7 opens no network connection except the DB's (AC 26):

1. `month = previousMonth(today.slice(0, 7))`. Then `[from, to)` as instants: `istanbulToUtc(`${month}-01`)` and `istanbulToUtc(`${nextMonth}-01`)`. As days: `${month}-01` … the last day (for the ledger, whose `occurred_on` is a plain date).
2. **Cron only, fast path:** if covered → `skipped` (one indexed read).
3. Read the recipients (`getBackupRecipients()`). If there are none → cron `skipped`; manual is refused before this point (§8.2). No row in either case.
4. **Claim** (`db.md` §1.3 / §1.4 SQL, `recipient_count` = list length). 0 rows, `SQLITE_BUSY` or a unique violation → `skipped` (cron), or a refusal with the reason (manual).
5. From here everything is in `try { … } catch (e) { fail(e) }`, and the row is always finished.
   - a. `backupPassphrase()` null → throw `BackupError("passphrase")`. This is checked first: AC 23 takes precedence over AC 22.
   - b. `smtpConfig()` is `missing` → throw `BackupError("smtp")`.
6. Build, in this order:
   - `autoCloseStale()`, as `/raporlar` does before its stats. It closes forgotten rehearsals, the same side effect as opening the report page.
   - the dump: `dumpDatabase(db.$client)`, one read transaction (§6.1)
   - the four CSVs and the summary numbers (§5)
   - `gzip` → `encrypt`
   - the size guard: the sum of the five `Buffer.byteLength` values > 18 × 1024 × 1024 → `BackupError("size")`, and `size_bytes` is recorded too (`db.md` §1.1).
7. Send (§7). This is the only step that opens SMTP.
8. Finish: `status = 'sent'`, `size_bytes`, then prune (the `db.md` §1.3 finish batch).
9. `fail(e)`:
   - log `console.error("backup run failed", describe(e))`, where `describe` keeps only `name`, `code`, `responseCode` and `command`, plus the `message` with every secret value and every recipient address replaced by `[redacted]`.
   - store `messageFor(e)` from the fixed map (§7.3), never `e.message`.
   - finish as `failed` and return `failed`.
10. Revalidation: the manual action calls `revalidatePath("/yedek")` and `revalidatePath("/")`. The cron doesn't need to, because all pages are dynamic (`connection()` in the root layout).

`today` for manual runs is `istanbulDateOf(new Date())`. There is no hook in the action.

---

## 5. Report content (reuse, not copies)

### 5.1 Unguarded internals for the backup (required)

`requireManager()` inside `src/lib/finance/queries.ts` calls `redirect("/giris")` when there is no session. In a route handler that throws `NEXT_REDIRECT`, so the cron would answer a 307 and send nothing. Split each function the backup needs:

| Guarded export (unchanged callers) | New internal, same file, same query | Used by |
|---|---|---|
| `csvEntries(from, to)` | `ledgerRowsBetween(from, to)` | finance CSV route via `csvEntries`; backup directly |
| `duesMatrix(today)` (the `cache`d one) | `loadDuesMatrix(today)` | dues CSV route, `/finans/aidat`; backup directly |
| `monthSummary(month)` | `monthTotals(month)` | finance page; backup body line |

- The guarded export becomes `await requireManager(); return internal(...)`.
- The internals get a JSDoc line: `Unguarded: callers must authorize first (backup run only).`
- They're only imported from `src/lib/backup/*`. Review checks that with grep (`review-backend.md`).
- `attendanceStats`, `autoCloseStale`, `loadRosterUsers` and the homework queries have no guard already, so nothing to split there.

### 5.2 Shared CSV builders

| File | Exports | Route change |
|---|---|---|
| `src/lib/attendance/csv.ts` (exists) | `attendanceCsv(rows)`, unchanged | none |
| `src/lib/finance/csv.ts` (new, plain module) | `LEDGER_HEADER`, `ledgerCsv(rows)` (moved verbatim from `finans/rapor/csv/route.ts`); `DUES_HEADER`, `duesRows(members, periodId)` (moved from `finans/aidat/csv/route.ts`, incl. the `collator` sort) | routes call them; their responses are byte-identical to today's |
| `src/lib/homework/csv.ts` (new) | `HOMEWORK_HEADER`, `homeworkCsv(rows)` | none (new export) |

Attachments (AC 9–12):
- **devam:** `attendanceStats({ from, to })`, `members.sort(collator)`, `attendanceCsv`. The boundary is `startsAt >= from && < to`, both Istanbul midnights (AC 6).
  - Note for AC 6's e2e: only **closed, not cancelled** rehearsals count (`stats.ts:36-45`), so the fixture must close them.
- **ödev:** new `homeworkDueBetween(from, to, at)` in `homework/queries.ts`. Four flat queries, not `rosterFor` per assignment (N+1):
  - assignments with `dueAt ∈ [from, to)`, joined to `pieces`
  - `partsOf(ids)`
  - `loadRoster()`
  - `submissions` (`assignmentId`, `userId`, `submittedAt`) for those ids. **Never `feedback`.**
  
  Row inclusion is `rosterFor`'s rule: expected, or submitted and eligible. State is `submittedAt > dueAt ? late : done`, else `dueAt <= at ? missing : pending`. Labels come from one shared map: move the matrix page's `CELL` labels (`Zamanında`, `Geç`, `Gecikti`, `Bekleniyor`) into `src/lib/labels.ts` as `HOMEWORK_STATE_LABELS`, so the matrix, the detail page and the CSV can't drift. Sort by `dueAt`, then `collator` on the name.

  Columns:
  - `Ödev` = `barsLabel(...)` + the piece title, exactly as the matrix header shows it
  - `Eser` = the piece title
  - `Son tarih` = `formatShortDateTime(dueAt)` (Istanbul)
  - `Ad soyad`, `Partisyon`, `Durum`
  - `Teslim tarihi` = `formatShortDateTime(submittedAt)` or empty
  
  @po: if `Ödev` and `Eser` would duplicate each other, make `Ödev` the bar range only (`barsLabel`). My preference.
- **finans:** `ledgerCsv(await ledgerRowsBetween(firstDay, lastDay))`, the same inclusive `from`/`to` as the route with `?from=&to=`.
- **aidat:**
  - load `loadDuesMatrix(today)`, where `today` is the run's date, so "status as of send time"
  - periods with `startsOn <= lastDay && endsOn >= firstDay`, ordered by `startsOn`
  - for each, `duesRows` with the period `name` prepended under the header `["Dönem", ...DUES_HEADER]`
  - no overlap → header only

  The `csvDocument` BOM, `;` and CRLF come for free.

### 5.3 Body numbers (AC 8)

- `Çalışma: <stats.rehearsalCount> · Ortalama devam: %<n>` (or `—`; formula in @po 4)
- `Ödev: <assignments due in M> · Zamanında teslim: %<round(100 · done / expected)>`
  - only rows with `expected = true` count; `late` is not on time
  - `—` when the denominator is 0
- `Gelir: <formatKurus(income)> · Gider: <formatKurus(expense)> · Net: <formatNet(net)>`, from `monthTotals(month)`: voided rows, transfers and openings are excluded, exactly as `/finans`.
- The subject and the body month label come from `formatMonthYear(istanbulToUtc(`${month}-01`))`.
- The body text is in `src/lib/backup/email.ts` (`monthlyEmail(...)` → `{ subject, text }`), so the e2e and the code read one template. Each paragraph is one line (@ux).

---

## 6. Dump, encryption and the scripts

### 6.1 Shared dump (AC 27)

`src/lib/backup/dump.ts` holds the body of `scripts/db-backup.ts` as it is today: the same SQL, ordering, skip list and literal encoding.

```ts
export async function dumpDatabase(client: Client): Promise<{ sql: string; tables: number; extras: number; counts: [string, number][] }>;
```

- No `server-only` and no `@/` imports, so `tsx` can load it from `scripts/`. It takes the `Client`. It never creates one.
- `scripts/db-backup.ts` becomes ~15 lines: `createClient(env)`, `dumpDatabase`, write `data/backups/<iso>.sql`, print the same two lines. Its output is unchanged, so the Phase 6 AC 39 test stays green.
- The app passes `db.$client` (drizzle's libsql handle). On Turso, `transaction("read")` works over the same client the script already uses in production.

### 6.2 File format `.sql.gz.enc` (AC 28)

| Offset | Bytes | Field |
|---|---|---|
| 0 | 9 | magic `ARKHE-BK1` (ASCII; the digit is the format version) |
| 9 | 1 | KDF id, `0x01` = scrypt |
| 10 | 1 | log2 N (`17`) |
| 11 | 1 | r (`8`) |
| 12 | 1 | p (`1`) |
| 13 | 16 | salt (`randomBytes(16)`, new per file) |
| 29 | 12 | IV (`randomBytes(12)`, new per file) |
| 41 | n | AES-256-GCM ciphertext of `gzip(dump, level 9)` |
| 41 + n | 16 | GCM auth tag |

- Key = `scrypt(passphrase.normalize("NFC") as UTF-8, salt, 32, { N: 2**17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })`.
  - Node's default `maxmem` is 32 MiB. Without the override, N = 2^17 throws.
- Bytes 0–40 (the whole header) are passed as **AAD**, so changing a parameter, the salt or the IV fails authentication just like a changed ciphertext byte.
- Salt and IV are fresh per file, so two runs on the same data differ (AC 28) even with identical dumps.
- **scrypt choice (§7 Q5).** Measured on this M5:
  - 2^15: 39 ms
  - 2^16: 76 ms
  - 2^17: 153 ms

  A Vercel vCPU is roughly 2–4× slower, so 2^17 is ~0.3–0.7 s, under the 1 s target. 128 MiB fits easily in Hobby's default 2 GB. 2^17/8/1 is the OWASP-recommended scrypt setting; 2^15 would be 4× cheaper to brute-force for no real gain. The parameters live in the header, so they can be raised later without breaking old files.
- Gzip shrinks our dump about 6× (seed dump: 267 KB → 43 KB).
- Everything is in memory: `gzipSync`/`createCipheriv` on Buffers. The dump is a few MB at most, so streams would add code for nothing.

`src/lib/backup/crypto.ts` (pure, `node:crypto` + `node:zlib` only):

```ts
export const MAGIC = "ARKHE-BK1";
export function encryptBackup(plain: Buffer, passphrase: string): Buffer;  // gzip inside
export function decryptBackup(file: Buffer, passphrase: string): Buffer;   // gunzip inside; throws BadBackup
```

`decryptBackup` checks, in order:
- the length is ≥ 41 + 16 + 1
- the magic matches (else `"Not an Arkhe backup file."`)
- the KDF id is 1
- `14 ≤ log2N ≤ 20`, `1 ≤ r ≤ 16`, `1 ≤ p ≤ 4` (else `"Unsupported backup format."`). The caps stop a crafted file from asking for 64 GiB of scrypt memory.

Then scrypt → `setAAD` → `setAuthTag` → `update`/`final`. Any GCM failure gives `"Wrong passphrase or damaged file."`. `gunzipSync` runs with `maxOutputLength: 1 GiB`.

### 6.3 Backup file name

`arkhe-yedek-${YYYY-MM-DD}-${HHmm}.sql.gz.enc`, from the **real** Istanbul send time (`istanbulDateOf`, `istanbulTimeOf` without the colon). The CSV names are `arkhe-<kind>-${month}.csv`. All names are ASCII, so no RFC 2231 encoding is needed.

### 6.4 `db:decrypt` (AC 29)

- `package.json`: `"db:decrypt": "tsx scripts/db-decrypt.ts"`, deliberately **without** `--env-file`. With `.env` or `.env.development` loaded, the dev passphrase would be tried first on a real backup and fail with a confusing "wrong passphrase". The passphrase comes from a real `BACKUP_PASSPHRASE` in the shell, or else a prompt.
- **Prompt without echo:**
  - if `process.stdin.isTTY`: raw mode; read until Enter; handle Backspace and Ctrl-C (exit 130); print nothing per keystroke.
  - if not a TTY: read one line from stdin, so `… < pass.txt` works.
  - Prompt text: `Backup passphrase: `.
- Output path: `data/backups/<basename without .gz.enc>` (e.g. `arkhe-yedek-2026-11-01-0800.sql`).
  - `basename()` only, so `../` in the input name can't escape.
  - If the name doesn't end in `.sql.gz.enc`, the output is `<basename>.sql`.
- It writes **only after** the full decrypt and gunzip succeed. It uses `writeFileSync(out, buf, { flag: "wx", mode: 0o600 })`. An existing output gives `Output file exists: <path>` and exit 1. The file holds password hashes and PII, so it gets owner-only permissions.
- Errors print one line and exit 1. On any failure there is no output file (AC 29). It prints `Decrypted: <path>` on success.

### 6.5 `db:restore`

- As specified in `db.md` §5: `"db:restore": "tsx scripts/db-restore.ts"`, also no env file.
- Messages are exactly AC 29's `Refusing to restore over an existing file.` / `Restore target must be a local file path.`

---

## 7. Mail module (`src/lib/mail/send.ts`, server-only)

### 7.1 Transport

```ts
export type Outgoing = { to: string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] };
export async function sendMail(msg: Outgoing, slug: string): Promise<void>;
```

- **Outbox** (`smtpConfig().mode === "outbox"`):
  - transport: `nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" })`
  - `from`: `"Arkhe Portal" <outbox@arkhe.local>`
  - `info.message` (a Buffer) goes to `path.join(process.cwd(), "data/outbox", `${stamp}-${slug}.eml`)` with `mkdir -p` and `flag: "wx"`.
  - `stamp` = `new Date().toISOString().replace(/[:.]/g, "-")` plus 4 random hex characters, so two sends in the same millisecond can't collide.
  - `slug` ∈ `aylik-yedek` | `alici-degisti`.
  - This branch is unreachable in production (`smtpConfig` returns `smtp` or `missing` there). Vercel's filesystem is read-only anyway.
- **SMTP:**
  ```ts
  nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, dnsTimeout: 5_000,
    disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false,
  })
  ```
  - nodemailer's defaults (2 min connect, 10 min socket) would outlive `maxDuration = 60`, and the function would die with the row still `running`. With these timeouts, the worst case is about 35 s plus the build.
  - `disableFileAccess`/`disableUrlAccess`: attachments are Buffers. Turning off `path:`/`href:` attachment loading means no code path can ever make nodemailer read a server file or fetch a URL.
  - Always `transport.close()` in `finally`.
- One message, `to: string[]` (never a joined string), no `cc`/`bcc`. The subject is fixed text plus a month label. nodemailer RFC 2047-encodes it (AC 7). Attachment `contentType` is `text/csv; charset=utf-8` and `application/octet-stream`.
- No `verify()` before sending: it would be an extra SMTP round trip, and `sendMail` reports the same errors.

### 7.2 What goes to the log

- Only `describe(e)` (§4 step 9).
- nodemailer errors carry `code` (`EAUTH`, `ETIMEDOUT`, …), `responseCode`, `command` and `response`.
  - `response` is Gmail's text (e.g. `535-5.7.8 Username and Password not accepted`). It never contains the password, but it goes through the same redaction.
  - The error object's `envelope`/`rejected` fields hold recipients, so the object is **never** logged whole.

### 7.3 Error → stored message (AC 22–24; UX §7 wording, single map `src/lib/backup/messages.ts`)

| Condition | Key |
|---|---|
| `BackupError("passphrase")` | `passphrase` |
| `BackupError("smtp")` | `smtp` |
| `BackupError("size")` | `size` |
| `code ∈ {EAUTH, ENOAUTH}` or `responseCode ∈ {530, 534, 535}` | `auth` |
| `code ∈ {ECONNECTION, ETIMEDOUT, ESOCKET, EDNS, ETLS, ECONNREFUSED, ECONNRESET, ENOTFOUND, EAI_AGAIN}` | `connection` |
| anything else (DB error during the build, a bug) | `unexpected` |

The stored text is always one of six constants, so AC 24's "no secret in `error`" holds by construction. The e2e check is a regression guard.

---

## 8. Server actions (`src/app/(portal)/yedek/actions.ts`, `"use server"`)

Add `canManageBackup(role) => role === "conductor"` to `src/lib/permissions.ts`. Both actions use it. The page and banner use `isManager` for viewing.

### 8.1 `saveBackupRecipients(prev: FormState, fd: FormData): Promise<FormState>`

1. `const user = await assertUser()`. If `!user || !canManageBackup(user.role)` → `{ error: "Bu ayarı yalnızca koro şefi değiştirebilir." }`. This happens before parsing, so nothing leaks to a board session.
2. **Input size:**
   - `raw = fd.getAll("recipients")`
   - if `raw.length > 10` or any entry is not a string or longer than 254 → `{ error: "En fazla beş adres ekleyebilirsin." }` (or the per-row invalid message for the long one)
   - The request body is bounded by Next's 1 MB server action limit anyway.
3. Normalise each entry: `trim().toLowerCase()`. Keep the submitted index for the field errors.
   - **Validate first**: every non-empty entry failing `RECORDING_EMAIL_RE` → `fieldErrors["recipients.<i>"] = ["Geçerli bir e-posta adresi gir: <addr>"]`, with `<addr>` cut to 64 chars. React escapes it.
   - Then drop empties and dedupe, keeping the first occurrence.
   - 0 left → `En az bir adres gir.`; more than 5 → `En fazla beş adres ekleyebilirsin.`
   - Echo `values` for the form (UI contract).
4. `canonical = list.join(",")`.
5. Transaction (`db.md` §2.2): read the old value, upsert `value`, `updated_at = now()`, `updated_by = user.id` (never `created_at`).
   - If `old === canonical` → no write, no notice, return `{ success: "Alıcılar kaydedildi." }` (idempotent).
6. If `old` existed and differs:
   - **throttle first.** Before the write: `consumeAttempt(`backup-recipients:${user.id}`, 10, 24 h)`. If blocked → `{ error: "Alıcılar bugün çok sık değişti. Yarın yeniden dene." }` and no write.
   - after the commit, send the **change notice** (§8.3), awaited with the short SMTP timeouts.
   - If the notice fails: the save stands. Log it via `describe`, revalidate, and return `{ success: "Alıcılar kaydedildi.", error: "Değişiklik bildirimi gönderilemedi." }`. @ui: render that as a success toast plus a warning; final copy is in @po 10. Rolling back would let a broken SMTP block a fix to the recipient list.
7. `revalidatePath("/yedek")` and `revalidatePath("/")` (banner 21).

Concurrency: two conductor tabs → the transaction serialises them. Each notice names the list it replaced. The last write wins, which is fine for a settings field.

### 8.2 `sendBackupNow(): Promise<FormState>`

1. `assertUser` + `canManageBackup` → else `{ error: "Bu işlemi yalnızca koro şefi yapabilir." }`.
2. No recipients → `{ error: "Önce en az bir alıcı kaydet." }` (the button is disabled too, but the server decides).
3. `consumeAttempt(`backup-send:${user.id}`, 6, 1 h)` → `Çok fazla deneme. Bir saat sonra yeniden dene.` This stops a stuck finger or a hijacked session from hammering Gmail with failing logins, which is how an account gets locked.
4. `runMonthlyBackup({ trigger: "manual", today: istanbulDateOf(new Date()), actor })`. The cooldown and running checks are inside the atomic claim (`db.md` §1.4), so a double tap can't slip between the check and the insert. Results:
   - `refusal: "cooldown"` → `Az önce gönderildi. <n> dakika sonra yeniden deneyebilirsin.` (n ≥ 1), no row
   - `refusal: "running"` → `Şu anda bir gönderim sürüyor. Birkaç dakika sonra yeniden dene.`, no row
   - `sent` → `{ success: "Gönderildi: <n> adres." }`
   - `failed` → `{ error: "Gönderilemedi. Ayrıntı aşağıda, Geçmiş'te." }`
5. Revalidate `/yedek` and `/`.

- `maxDuration = 60` is exported by `src/app/(portal)/yedek/page.tsx`, so the action gets the same limit as the cron.
- CSRF: server actions get Next's Origin/Host check, and the session cookie is `SameSite=Lax`. There are no ids in either action, so no IDOR surface.

### 8.3 Change notice (AC 14)

- Sent to the union of old and new, deduped. Subject: `Arkhe yedek alıcıları değişti`.
- Plural tone (@ux). Each paragraph is one line:
  ```
  Merhaba,

  Arkhe Portal'da aylık rapor ve yedek e-postasının alıcıları değişti.

  Değiştiren: <ad soyad>
  Zaman: <formatDateTime(now)> (Türkiye saati)

  Yeni alıcılar:
  - a@x.org
  - b@y.org

  Bu değişikliği sen yapmadıysan koro şefine hemen haber ver.

  <APP_URL>/yedek
  ```
  The `sen` line is the PO's fixed sentence. @ux, adjust it to the plural if you like.
- No run row. The name is already `cleanLine`'d at write time, and it's in the body only, never in a header.

---

## 9. Read models for the page and the banner (`src/lib/backup/queries.ts`, server-only)

### 9.1 `loadBackupPage(user)` → the `BackupPage` shape (@ui)

- `requireManager()` inside.
- Queries:
  - recipients + audit (one `app_settings` row joined to `users`)
  - 12 runs with the actor name (`db.md` §1.2 query)
  - previous-month state: the latest row for M, plus covered or not
- `status: "stale"` is computed in SQL: `case when status = 'running' and started_at <= unixepoch() - 600 then 'stale' else status end`.
- `canEdit = canManageBackup(user.role)`.

### 9.2 `backupBannerState(user)`

- Returns `null` for members **before any query**.
- Conductor and board:
  1. Read recipients (`created_at`). None → `{ kind: "setup" }` for the conductor, `null` for the board.
  2. `M` = the previous month. Covered → `null`.
  3. (a) the latest cron row (`db.md` §1.2): `failed`, or stale `running`, **and** `report_month = M` → `{ kind: "failed", month }`.
     - The AC says "its month is still not covered". Since we only reach this step when M isn't covered, I limit (a) to rows for M. A failure for an older, abandoned month (@po 8) would otherwise keep the banner up forever.
  4. (b) `created_at < istanbulToUtc(`${currentMonth}-01`)` **and** `today.slice(8) >= "03"` → `{ kind: "overdue", month }`.
- At most four indexed reads on the home page, managers only.

### 9.3 `nextSendAt(covered, now)`

- The UX §2.2 rule, in `src/lib/backup/schedule.ts` (pure).
- Next 05:00 UTC strictly after `now`; if covered, the 1st of the next month at 05:00 UTC.
- If the PO picks option (B), add `&& month started after created_at`.

---

## 10. Security review of the plan

| Threat | Where | Mitigation |
|---|---|---|
| Unauthenticated trigger of the cron | route | Bearer ≥ 32 chars; constant-time digest compare; 503 when unconfigured; no DB access before auth. |
| Leaked `CRON_SECRET` / replay of the cron call | route | Damage is bounded by idempotency: at most one email per month (plus failed rows). Rotate the secret in Vercel. No body, no ids, nothing else replayable. |
| Cron call cached or prerendered | route | `connection()`, `no-store`, reads the request headers. The build table must show `ƒ` (AC 37). |
| `?bugun=` enabled in production | route | `NODE_ENV` inlined at build → dead code. The prod-e2e asserts it (AC 30). |
| Board/member changes recipients or sends | actions | `canManageBackup` server-side in both actions, before parsing. E2e calls the actions directly as yk@ (AC 14, 17). |
| Hijacked conductor session redirects backups | actions | Change notice to old + new lists (AC 14); 10 changes/day; `created_at` keeps banner (b) honest. |
| Email header injection | mail | `RECORDING_EMAIL_RE` (no space, `<>`, `,`, CR/LF) + the DB CHECK; recipients passed as an array; subject fixed; names only in the body; `SMTP_FROM` validated. |
| nodemailer reading files/URLs | mail | `disableFileAccess`, `disableUrlAccess`; Buffer attachments only. |
| Secrets in logs or the DB | run | Stored errors come from a fixed map; logs keep only `code`/`responseCode`/`command` and a redacted message; the error object is never logged whole; Kurulum gets booleans only. |
| Unencrypted backup or partial send | run | The passphrase is checked first; the whole build happens before the SMTP connection opens; any throw before `sendMail` sends nothing (AC 23, 26). |
| Concurrent runs / double tap | run | Atomic claim with the partial unique index (DBA); the cooldown sits inside the claim. |
| Function killed mid-run | run | Short SMTP timeouts keep us under 60 s; a stale `running` is reaped after 600 s; at-least-once retry. |
| Gmail lockout from repeated failing logins | actions | Manual sends limited to 6/hour; the cron makes at most one attempt/day. |
| Crafted backup file (scrypt memory bomb, path traversal) | scripts | Param caps; `basename` output; `wx`; GCM auth before gunzip; `maxOutputLength`. |
| Restore over the live DB | scripts | Local path only, `O_EXCL` create, no `.env` read (`db.md` §5). |
| Passphrase brute force on a leaked attachment | crypto | scrypt 2^17 per guess; ≥ 16-char passphrase (README suggests 24 random base64 chars ≈ 144 bits). |
| Supply chain (nodemailer) | deps | Exact pin `10.1.7`, npm provenance present, zero dependencies; `npm audit signatures` at install. |
| CSV formula injection | CSV | The existing `csvCell` prefix applies to the new homework CSV too. |
| Input size | actions | ≤ 10 raw fields × 254 chars; Next's 1 MB action body limit. |

---

## 11. Answers to §7 open questions

### 11.1 Gmail blocking sign-in from Vercel IPs (Q1)

- With 2-Step Verification and an App Password, SMTP AUTH from datacenter IPs normally works. App Passwords skip the interactive "suspicious sign-in" challenge. A block shows up as `EAUTH` / `534-5.7.9` or `535-5.7.8`, which we store as `Gmail girişi reddedildi. Uygulama şifresini kontrol et.` README step 6 (a manual send right after setup) surfaces it on day one.
- **Remedies, in order (README):**
  1. Sign in to the choir Gmail in a browser, open Security → Recent security activity, and confirm the Vercel sign-in as "it was me". Then press `Şimdi gönder` again.
  2. Revoke the App Password, create a new one, update `SMTP_PASS`, and redeploy.
  3. **A free fallback provider through `SMTP_HOST`/`SMTP_PORT` (@po 11), no code change.**
     - The most robust option is **Brevo's free plan**: 300 emails/day, `smtp-relay.brevo.com:587` STARTTLS, attachments allowed.
     - A free mailbox with SMTP and app passwords (e.g. Yandex Mail, `smtp.yandex.com:465`) also works.
     - Both need a new free account, so they're used only if Gmail fails. The user should check the provider's current free terms at setup time.
  
  A second Gmail account (the PO's idea) would probably hit the same datacenter-IP heuristics, so I'd list it last.
- Brevo would carry the encrypted backup **and the plain CSVs** through a third party. Put that one line in the README so the board decides knowingly.

### 11.2 Passphrase loss (Q2)

- There's no recovery by design. AES-GCM with a scrypt key has no backdoor, and we must not add one (no key escrow in the DB or Vercel beyond the env var).
- What loss actually means:
  - the **live data is unaffected**, and only past emailed backups become unreadable
  - set a new passphrase in Vercel, redeploy, press `Şimdi gönder`, and from then on the backups are usable again
  - the README says exactly that
- Mitigations:
  - README step 3: two copies outside Vercel
  - the restore drill at setup (AC 39) proves the stored copy matches what Vercel uses
  - the Kurulum reminder line (@ux agreed)
  - rotation note: old files keep the old passphrase; record the rotation date next to the stored passphrase, because the file name carries the date
- **Optional (Could, PO decides):** a "passphrase id", the first 4 bytes (hex) of `scrypt(passphrase, "arkhe-passphrase-id", N=2^17)`. It would be shown under Kurulum and in the email body, and `npm run db:decrypt -- --id` would print it for a typed passphrase. Then the şef can check that a paper copy matches Vercel without ever seeing Vercel's value. The cost is one more scrypt per run and one line of UI. It gives an attacker no shortcut, because each guess still costs a full scrypt. I'd leave it out of Phase 7 unless the PO wants it.

### 11.3 The others

- Q4 (proxy): §2.3. Q5 (scrypt): §6.2. Q6 (`?bugun=`): §2.4.
- Q7 (table): agree with the DBA.
- Q8 (weekly later): `runMonthlyBackup` takes the month and the attachment set as data, so a weekly backup-only variant is a new trigger value and a second cron entry, not a rewrite.

---

## 12. Free-tier budget and duration (AC 34)

- **A skipped cron call** (most days): one indexed read (`covered?`), at most four. That's ~30 calls × ≤ 4 rows ≈ **120 row reads/month**.
- **A send:**
  - every row of every table once, for the dump. Today's seed is ~1 000 rows. A live choir with a year of data is maybe 10–30 k, mostly `attendance`, `sessions` and `login_attempts`.
  - plus the report queries, which re-read the month's rows: a few thousand.
  - ≈ **≤ 50 k reads per send**, and 1–3 sends a month. Against Turso's 500 M/month, that's < 0.01 %.
- **Writes per send:** claim (1–2) + finish (1) + prune (0–1) + `autoCloseStale` (usually 0). That's **< 10 writes/month** against 10 M.
- **Duration estimate on Vercel (iad1 ↔ Turso Stockholm, ~100 ms RTT):**
  - the dump's read transaction: ~30 tables + 2 schema queries ≈ 3–4 s
  - report queries ≈ 1 s
  - scrypt ≈ 0.5 s
  - gzip/encrypt < 0.1 s
  - Gmail SMTP ≈ 1–3 s
  - **≈ 6–9 s**, worst case with SMTP timeouts ≈ 45 s. `maxDuration = 60` (well under Hobby's 300 s), and the 600 s stale threshold sits far above both.
- The measured dev duration goes into `e2e-results.txt` (gate). Implementation: log `backup run <status> in <ms> ms, <bytes> bytes` once per run.
- Memory: dump + gzip + ciphertext ≈ 3× the dump size, plus scrypt's 128 MiB. Fine on the default Hobby 2 GB.

---

## 13. File list (backend-owned)

| File | Kind |
|---|---|
| `vercel.json` | new |
| `.env.example`, `.env.development` (new), `.gitignore` | edit |
| `package.json` | `nodemailer@10.1.7` (exact), scripts `db:decrypt`, `db:restore` |
| `src/app/api/cron/aylik-yedek/route.ts` | new |
| `src/app/(portal)/yedek/actions.ts` | new |
| `src/lib/backup/{config,constants,crypto,dump}.ts` | new, pure (scripts import them) |
| `src/lib/backup/{run,email,messages,queries,schedule}.ts` | new, server-only (`schedule.ts` pure) |
| `src/lib/mail/send.ts` | new, server-only |
| `src/lib/finance/csv.ts`, `src/lib/homework/csv.ts` | new |
| `src/lib/finance/queries.ts` | split 3 functions (§5.1) |
| `src/lib/homework/queries.ts` | add `homeworkDueBetween` |
| `src/lib/labels.ts` | `HOMEWORK_STATE_LABELS` |
| `src/lib/permissions.ts` | `canManageBackup` |
| `src/lib/env.ts` | `bootWarnings` line only |
| `src/app/(portal)/finans/{rapor,aidat}/csv/route.ts` | use the shared builders, output unchanged |
| `scripts/db-backup.ts` | thin wrapper over `dumpDatabase` |
| `scripts/db-decrypt.ts`, `scripts/db-restore.ts` | new |
| README `Aylık yedek e-postası` | the steps in AC 31 + §11.1 fallback + §11.2 passphrase-loss note |
