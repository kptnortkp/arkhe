# Phase 5 backend design: finance

Author: arkhe-backend. Inputs: `po-spec.md`, Phase 4 `odevler/actions.ts` + my `phase-4/backend.md`, `lib/auth/dal.ts`, `lib/api.ts` (`managerOrError`), `lib/permissions.ts`, `lib/time.ts`, `lib/links.ts`, `raporlar/csv/route.ts` + `attendance/csv.ts`, Next 16 docs `01-getting-started/15-route-handlers.md` (GET handlers are not cached unless opted in), `02-guides/server-actions.md`. `ux.md`/`ui.md`/`db.md` don't exist yet; I use the PO's §6 names.

## 0. Cross-cutting rules
- Every `/finans/**` page calls `requireManager()`. The `(portal)` layout is not the check (layouts don't re-run on every navigation).
- Every finance action starts with `const actor = await assertManager(); if (!actor) return { error: FORBIDDEN }`, **before** parsing or touching the DB (AC 21). Members have **no** finance actions at all. `Kopyala` is client-only.
- Bound args and form fields all go through zod (`z.uuid()`, enums from `schema.ts`). Copy: `FORBIDDEN = "Bu işlem için yetkin yok."`, `NOT_FOUND = "Kayıt bulunamadı."`, `STALE = "Kayıt bu arada değişti. Sayfayı yenileyip tekrar dene."`, `ALREADY_VOID = "Bu kayıt zaten iptal edilmiş."`.
- Mutations run inside `db.transaction()` (libsql: `BEGIN IMMEDIATE`, serialised), so read-check-write is race-free. Keep it DB-only.
- After every write: `revalidatePath("/", "layout")`. The home cards `Kasa`/`Aidatım` live outside `/finans`.
- Audit: `createdBy/At`, `updatedBy/At`, `voidedBy/At` always come from `actor.id` and `now()`, never from input.
- FK `restrict` errors surface as `SQLITE_CONSTRAINT_TRIGGER`/"FOREIGN KEY constraint failed" (Phase 4 finding). Reuse `isForeignKeyError`. A CHECK failure → `Kaydedilemedi. Alanları kontrol et.` and log it (it means our zod missed something).

## 1. Isomorphic modules (no `server-only`, no Node APIs)

### 1.1 `src/lib/money.ts`
```ts
export const MAX_KURUS = 1_000_000_000; // ₺10.000.000,00
export type ParsedAmount = { ok: true; kurus: number } | { ok: false; error: string };
export function parseAmount(raw: string): ParsedAmount;
export function formatKurus(k: number): string;                  // "₺1.250,50"
export function formatSigned(k: number, dir: "in" | "out"): string; // "+₺1.250,50" / "−₺1.250,50"
export function formatNet(k: number): string;                     // signed integer kuruş → "−₺800,00"
export function amountInput(k: number): string;                    // "1.250,50", Düzelt prefill
export function csvAmount(k: number): string;                      // "1250,50"
```
Parser, strict and string-only (never `parseFloat`):
1. Strip whitespace (`\s`, U+00A0, U+202F), then a single leading `₺` or trailing `TL`/`tl`.
2. Match `/^(0|[1-9]\d{0,7}|[1-9]\d{0,2}(?:\.\d{3}){1,2})(?:,(\d{1,2}))?$/`. Otherwise `FORMAT = "Tutarı 1.250,50 biçiminde gir."`.
3. `kurus = Number(int.replaceAll(".", "")) * 100 + Number((frac ?? "").padEnd(2, "0"))`. `0` → `Tutar sıfırdan büyük olmalı.`; `> MAX_KURUS` → `Tutar en fazla ₺10.000.000,00 olabilir.`

This rejects ambiguous input:
- `1250.50`, `1.25`, `12.3456` and `12,345` (3 decimals; AC 4) are rejected.
- `1.250` is ₺1.250 (the PO rule).
- `1,250.50`, a negative sign, `+`, leading zeros (`007`), exponent notation, `.`/`,` alone and empty are rejected.
- Accepted: `1250`, `1250,5`, `1.250,50`, `1.250,5` (AC 4), `₺ 1.250,50`.

Formatting uses one `Intl.NumberFormat("tr-TR", {style:"currency", currency:"TRY"})` and formats the absolute value. The sign is ours: `+` / U+2212 `−` (Intl would emit an ASCII hyphen), so the format is the same on server and client. All amounts are rendered `tabular-nums`. `amountInput(parseAmount(x))` round-trips.

### 1.2 `src/lib/finance/categories.ts`
`INCOME_CATEGORIES`, `EXPENSE_CATEGORIES`, `ENTRY_KINDS`, `ACCOUNTS` as `const` tuples, exported for `schema.ts` CHECKs (@dba: import from here, like `VOICE_PARTS`). Also `kindOfCategory(c)`. Labels go in `labels.ts` (PO §3.3).

### 1.3 `src/lib/finance/dues.ts` (pure; `today` = `istanbulDateOf(now())` injected)
```ts
type DuesMember = { role: Role; joinedAt: Date; leftAt: Date | null; duesRate: DuesRate };
export const owesPeriod = (m, p) => (m.role === "member" || m.role === "board")
  && istanbulDateOf(m.joinedAt) <= p.endsOn && (m.leftAt === null || istanbulDateOf(m.leftAt) >= p.startsOn);
export function owedFor(m, p, override: { owedKurus: number } | null): number;
export function duesStatus(owed, paid, dueOn, today): { tone: "muted"|"done"|"red"|"amber"; label: string; remaining: number };
export function allocate(amount: number, open: { periodId: string; dueOn: string; remaining: number }[]):
  { periodId: string; kurus: number }[] | { error: string };
```
- `joinedAt`/`leftAt` are instants. Compare their **Istanbul calendar day** with the plain-date period, never `toISOString().slice(0,10)`: a member who joined 1 Oct 01:00 Istanbul is 30 Sep in UTC.
- Overdue means `today > dueOn`. The due day itself is not late.
- `allocate` fills periods in `dueOn` order, oldest first. The last one may be partial; periods that get 0 are dropped. If `amount > Σremaining` → `Kalan borç ${formatKurus(Σ)}; daha fazlası girilemez.` (AC 15).
- The same functions feed the manager list, the member card, the CSV and the action guard. There is one definition, as with `isExpected`.

### 1.4 `src/lib/finance/schemas.ts`
Zod schemas, shared by the actions and the client forms' inline hints:
- `amountField = z.string().transform((v, ctx) => parseAmount(v) ...)`
- `dateField(max = today + 31)`: a real day, checked via `addDays(d, 0) === d`, plus `Tarih çok ileride.`
- `docUrl`: `optionalText(2000)` piped through `parseLink`, storing `parsed.url`; on failure `INVALID_LINK`.
- Text fields: `description optionalText(200)`, `counterparty optionalText(120)`, `reason` trimmed 5–200 (`İptal nedeni yaz (en az 5 karakter).`). All text strips C0 controls except `\n`.

## 2. Server actions: `src/app/(portal)/finans/actions.ts` (+ `aidat/actions.ts`)
All are manager-only (§0). "Tx" means inside one transaction.

| Action | Input (zod) | Rules / side effects | Errors |
|---|---|---|---|
| `createEntry(_p, fd)` | `id` uuid (client, per form mount), `kind` income/expense/transfer, `category`, `amount`, `occurredOn`, `account`, `toAccount?`, `description`, `counterparty`, `sponsorId?`, `eventId?`, `documentUrl?`, `returnTo?` | Discriminated union on `kind`. The category must belong to the kind, and `dues` is **refused** here (AC 5; dues go through `recordDuesPayment`). `sponsorship` ⇒ `sponsorId` is required (`Sponsor seç.`); otherwise `sponsorId` is dropped. Transfer: no category/sponsor/event; `toAccount ≠ account` (`Kaynak ve hedef hesap aynı olamaz.`). Tx: check the sponsor/event exist; `occurredOn ≥ opening date` (`Tarih açılış bakiyesinden önce olamaz.`); `insert … onConflictDoNothing().returning()`. On conflict with the same `createdBy` → success (replay); otherwise `STALE`. | field errors, `NOT_FOUND` for the sponsor/event |
| `updateEntryMeta(id, _p, fd)` | `version` (updatedAt ms), `description`, `counterparty`, `eventId?`, `documentUrl?` | Only these four fields (AC 9). `update … where id and voided_at is null and updated_at = version`. 0 rows → `NOT_FOUND` / `ALREADY_VOID` / `STALE`. `eventId` is ignored for transfer/opening. | |
| `voidEntry(id, _p, fd)` | `reason` 5–200 | `update set voided_* where id and voided_at is null and kind <> 'opening'`. 0 rows → `ALREADY_VOID`/`NOT_FOUND`. One statement, so a double tap is harmless. Openings change only via settings. | reason error |
| `correctEntry(oldId, _p, fd)` | the `createEntry` fields + `id`; `memberId`/`duesPeriodId` allowed **only** when the old entry is `dues` | Tx: (1) `update old set void… reason 'Düzeltildi' where id = oldId and voided_at is null returning` (0 rows → `ALREADY_VOID`); (2) dues: re-run the §1.3 overpayment guard (the old row is already voided inside the tx); (3) insert new with `replacesId = oldId`. Any failure rolls back both steps. Replay: the new `id` already exists with `replacesId = oldId` → success. | as create |
| `setOpeningBalances(_p, fd)` | `openedOn`, `cash`, `bank` (amounts; `0`/empty = none) | Tx: refuse if any non-opening, non-voided entry has `occurred_on < openedOn` (`Açılış tarihinden önce hareket var.`). For each account whose value changed: void the current opening (`Açılış bakiyesi değişti`), then insert the new one. History is kept, and voided rows don't count. | |
| `recordDuesPayment(_p, fd)` | `clientId` uuid, `memberId` uuid, `periodIds` uuid[] 1–24 (deduped), `amount`, `occurredOn`, `account` (default `cash`), `description?` | Tx: load the member, the periods, overrides and the paid sum per period (non-voided). Every period must satisfy `owesPeriod`, or already have the member's payments (`Bu kişi bu dönemden sorumlu değil.`). Run `allocate(amount, open)` and insert one `income/dues` entry per allocation. Entry id = `uuidv8(sha256(clientId + ":" + periodId))` (`node:crypto`). **First** step of the tx: if any derived id already exists → return the earlier success (replay), before the guard (which would otherwise say "₺0 kaldı"). Two managers recording the same cash: the second is serialised behind the first and gets the overpayment error. | AC 15 message, nothing saved |
| `createDuesPeriod` / `updateDuesPeriod(id, version)` / `deleteDuesPeriod(id)` | `name` 1–40, `startsOn ≤ endsOn`, `dueOn ≥ startsOn`, `amount`, `reducedAmount?` (< amount, `İndirimli tutar tamdan küçük olmalı.`) | Unique name (`Bu adla bir dönem var.`). **Overlap refused** (`Bu tarihler {ad} dönemiyle çakışıyor.`): otherwise a member is billed twice for the same days. Update: tx, refused if a non-voided dues entry exists (`Bu döneme ödeme girilmiş.`); `version` guard. Delete: refused if **any** entry exists, voided included (FK restrict); overrides cascade. | |
| `bulkCreateDuesPeriods(_p, fd)` | `fromMonth`, `toMonth` (`YYYY-MM`, ≤ 12 months, from ≤ to), `amount`, `reducedAmount?` | Name = `Intl.DateTimeFormat("tr-TR",{month:"long",year:"numeric",timeZone:"UTC"})` → `Ocak 2027`. Dates: the 1st, the last day (`addDays(nextMonth01, -1)`), due the 15th. All-or-nothing tx: any name clash or overlap → error naming the month, nothing inserted. A replay hits the name clash; the UI shows it, and that's harmless. | |
| `setDuesRate(userId, _p, fd)` | `rate` enum, `note` ≤ 200 | Target role must be `member`/`board` (the conductor is never charged → `FORBIDDEN`). Tx: for each period where the member has paid > 0 and has no override, insert a freeze override `owedKurus = old owed` (reason `Oran değişikliği`), then update the user. See @po Q2. | |
| `setWaiver(periodId, userId, _p, fd)` / `removeWaiver(periodId, userId)` | `reason` 3–200 | Waiver = override with `owedKurus 0`. Refused if the member already paid > 0 for that period (`Bu döneme ödeme girilmiş; önce ödemeyi iptal et.`). Upsert/delete; idempotent. The target must satisfy `owesPeriod`. | |
| `createEvent` / `updateEvent(id)` / `deleteEvent(id)` | `name` 1–80, `startsOn`, `rehearsalId?` | `rehearsalId` must be a `type='concert'`, non-cancelled rehearsal not already linked (unique → `Bu konser için etkinlik var.`). Delete: FK restrict → `Bu etkinliğe bağlı hareketler var.` (pre-check `select 1` in tx + catch backstop). | |
| `createEventFromConcert(rehearsalId)` | uuid | Name = `rehearsal.title ?? "Konser"`; `startsOn = istanbulDateOf(startsAt)` (not UTC; an evening concert must not shift a day). The unique rehearsal link makes it idempotent: on conflict, return the existing event id. | |
| `createSponsor` / `updateSponsor(id)` / `setSponsorActive(id, bool)` | `name` 1–120, `contactName` ≤ 80, `contact` ≤ 120, `note` ≤ 500, plus `id` uuid on create (quick-create from the entry form returns `{values:{id,name}}`) | Uniqueness on `name_key = searchKey(name)`. @dba: SQLite `lower()` is ASCII-only, so `İŞ`/`iş` would not collide. Keep a `name_key` column with a unique index, computed in the app. No delete. | `Bu adla bir sponsor var.` |
| `setPaymentInfo(_p, fd)` | `info` ≤ 500, CRLF → `\n` | `""` → delete the key; otherwise upsert `{value, updatedBy, updatedAt}`. @dba: add `dues_payment_info` to `SETTING_KEYS`. Rendered as text only (`whitespace-pre-line`). | |

`returnTo` (the `Kaydedildi.` redirect target) is validated as a same-site path: `^/finans(/[\w/-]*)?(\?[\w=&%-]*)?$`, else `/finans`. No open redirect.

## 3. Queries: `src/lib/finance/queries.ts` (`server-only`)
Every exported query except `myDues`/`getPaymentInfo` begins with `await requireManager()` (or takes a manager `viewer` it re-checks with `isManager`). That is defence in depth: a member page importing it by mistake still can't read it.

- **Signed amount**, one SQL fragment, per account `:a`: `case when kind in ('opening','income') and account=:a then amount when kind='expense' and account=:a then -amount when kind='transfer' and account=:a then -amount when kind='transfer' and to_account=:a then amount else 0 end`, always `where voided_at is null`.
- `balances()`: one row, `sum(...)` for cash and bank. Total = cash + bank (transfers cancel). Negative → `Eksi bakiye` flag.
- `monthSummary(month)`: income/expense sums `where kind in ('income','expense') and substr(occurred_on,1,7) = :m`. Transfers and openings are excluded (AC 6).
- `monthlyReport(year)`:
  - `devir0` = signed sum `where occurred_on < 'Y-01-01'`.
  - Then `group by substr(occurred_on,1,7)` within the year, with columns `opening`, `income`, `expense`, `transferIn`, `transferOut` per account.
  - Row: `Devir = previous Kapanış + opening in month`; `Kapanış = Devir + Gelir − Gider + VirmanGiriş − VirmanÇıkış`.
  - @ux: per-account views need a `Virman` column, or Kapanış ≠ Devir + Net; in the total view it nets to 0. The last Kapanış of the current year = `balances()` total (AC 17) only when no entry is dated in a later month. Entries are capped at today + 31, so compare against the row of the latest month that has data, not "the last row".
  - Category breakdown: `group by kind, category` for the month or year.
- `listEntries(filters)`: zod-parsed searchParams (`ay` `YYYY-MM`, enums, uuids; invalid → ignored), max 500 rows. Joins names (sponsor, event, member, creator, voider). `belgesiz=1` ⇒ `kind='expense' and document_url is null`. `iptal=1` ⇒ voided only.
- `eventPL(id)`: `group by kind, category where event_id=:id and voided_at is null`; net = income − expense → `Kâr`/`Zarar` (`formatNet`).
- `sponsorTotals(year)`, `concertsWithoutEvent()` (concert, not cancelled, `rehearsal_id` not linked, last 12 months + future).
- `duesBoard(periodId, today)`: the roster (`id, name, voicePart, role, joinedAt, leftAt, duesRate, duesNote`; no email/phone), overrides for the period, and `sum(amount) group by member_id where dues_period_id=:p and voided_at is null`. The rest is JS via §1.3. Members who left with `remaining > 0` are kept (`Ayrıldı`). Collection summary from the same data.
- `memberDuesHistory(userId)`: for the manager sheet only.
- **`myDues()`**: no parameters. It calls `requireUser()` itself and filters `member_id = user.id` and `user_id = user.id`. Its columns: periods (name, dates, amounts), my overrides **without the reason of a freeze** (the waiver reason is shown, see the spec), my payments (date, amount, period). It never returns `dues_note`, other members, the ledger or `createdBy` names. AC 21/22: e2e greps `korist@` HTML for another seeded member's name.
- `getPaymentInfo()`: any user, plain text.
- `kasaCard(today)` for the manager home: `balances()` + `monthSummary` + the count of owing members in the current period, using `requireManager`-style gating at the call site.

## 4. CSV route handlers
- `src/app/(portal)/finans/rapor/csv/route.ts` (`?from=&to=`) and `src/app/(portal)/finans/aidat/csv/route.ts` (`?donem=`). Route handlers aren't covered by layouts or `requireManager`, so the first line is `const auth = await managerOrError(); if (auth.error) return auth.error;`: 401 or 403 JSON, never data (AC 21). The proxy redirects cookie-less requests to `/giris`.
- No `dynamic='force-static'` / `revalidate` exports. Per the docs, GET handlers aren't cached unless opted in. Still send `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` (never inline).
- Params: `from`/`to` are real dates, `from ≤ to`, span ≤ 5 years. The default is the current Istanbul year. Invalid → 400 `{error:"Geçersiz tarih aralığı."}`. `donem` is a uuid (unknown → 404).
- Move `cell()` from `attendance/csv.ts` to `src/lib/csv.ts` (`csvCell`, `csvDocument(header, rows)` = BOM + `;` + CRLF). Both CSVs use it, so formula-safety lives in one place.
  - The rule prefixes `= + - @ \t \r` with `'`, which also catches a counterparty like `-Ahmet` or `+90 …`.
  - Amounts are `csvAmount` (`1250,50`), a cell that never starts with a trigger. Income and expense are separate columns.
  - A transfer has empty amount columns and Hesap `Kasa → Banka`. Openings are included as `Açılış bakiyesi`. @po: they go in **neither** amount column (Hesap shows the account, Açıklama the amount text), so the Excel sums equal the report's Gelir/Gider.
  - Voided rows are excluded. `Kayıt no` = the full id. `Kaydeden` = the creator's name.
  - Sorted by `occurred_on, created_at`.
- Filename: `arkhe-finans-{from}-{to}.csv` (ASCII, safe). Dues: ASCII fallback `arkhe-aidat.csv` plus `filename*=UTF-8''` with the Turkish slug, like `raporlar/csv`.
- Dues CSV: `Ad soyad;Partisyon;Oran;Borç;Ödenen;Kalan;Durum`. It lists everyone who owes the period (incl. `Muaf`), name-sorted with `collator`, and never `dues_note`.

## 5. Idempotency and concurrency summary
| Action | Double submit / replay | Concurrency |
|---|---|---|
| createEntry, createSponsor, correctEntry | client uuid PK + `onConflictDoNothing` → same result | — |
| recordDuesPayment | ids derived from `clientId` + period, checked first in the tx | `BEGIN IMMEDIATE` + overpayment guard |
| voidEntry, correctEntry (void step) | `where voided_at is null` → `ALREADY_VOID` | single statement / tx |
| updateEntryMeta, updateDuesPeriod | `version` guard → `STALE` | optimistic |
| bulk periods, events from concert | unique name / unique rehearsal link | tx all-or-nothing |
| waivers, rate, payment info, opening | upsert / compare-then-write | last write wins (audited) |

## 6. Security notes
- **IDOR:** members have no finance actions. `myDues()` takes no id. Manager actions accept ids, but managers may legitimately touch every record; the targets are still validated (role, `owesPeriod`, concert type), so a crafted id can't attach dues to the conductor or link a tutti rehearsal.
- **Privilege escalation:** roles are re-read from the session/DB per request (`getSessionUser`), never from input. A demoted board member loses access on the next request.
- **Self-dealing:** a board member can record their own dues. That is accepted (PO §9), and `createdBy` is visible on every entry and in the CSV.
- **Data exposure:** `dues_note` and waiver/freeze reasons for others, `counterparty` and the ledger never reach member-rendered props. Manager-only client components receive only the columns they render.
- **Tamper-evidence:** there is no delete path anywhere. `void` is one-way, with who/when/why. `replacesId` links corrections. The opening is changed by void + insert.
- **CSRF/replay:** server actions (POST + Next Origin check). The CSV handlers are GET-only and side-effect-free; the only risk is reading, which needs a manager session cookie (SameSite=Lax, httpOnly).
- **Input size:** text caps above, `periodIds ≤ 24`, bulk ≤ 12 months, CSV span ≤ 5 years, list ≤ 500 rows, the 1 MB action body cap. **Rate limits:** none. Everything is authenticated and O(rows); login is already rate-limited.
- **Timezone:** business dates are plain Istanbul days (`istanbulDateOf(now())`). Instant fields (`joinedAt`, `leftAt`, `startsAt`) are converted with `istanbulDateOf` before comparing to them. Month keys are string slices, never `Date` math. `bulkCreate` uses UTC-only date arithmetic (`addDays`) on plain days.
- **Floats:** none on the server. Amounts are integer kuruş end to end; SQL `sum()` of integers stays integer (≤ 2^53 is far away).

## 7. Answers
- **@po Q1 (conductor):** agree, full access. Audit fields show who entered their own fee; a treasurer role can come later.
- **@po Q2 (live owed):** partially agree. Pure live owed breaks history: switching a student from İndirimli to Tam would turn their fully paid ₺150 periods into `Kısmi · ₺150,00 kaldı`. Proposal: the rate change "applies to unpaid periods" (the spec wording) by freezing periods that already have payments into an override row (§2 `setDuesRate`).
  - @dba: generalise `dues_waivers` → `dues_overrides(period_id, user_id, owed_kurus ≥ 0, reason, created_by/at)`, PK (period, user). `owed_kurus = 0` is a waiver and shows `Muaf`.
  - Nothing derived is stored beyond that explicit decision.
- **@po Q3:** agree, `events` with an optional unique concert link.
- **@po Q4 (@dba):** openings as `opening` entries. Balance math stays one formula, history is voidable, and the CSV/report treat them uniformly. The partial unique index must be `(account) where kind='opening' and voided_at is null`.
- **@po `Düzelt`:** one atomic action (void + insert in one tx) on submit of the prefilled form `/finans/yeni?duzelt={id}`, **not** "void on click, then form". Abandoning the form must not leave the money missing.
- **@po period overlap:** I refuse overlapping periods (§2); say so if term + monthly must coexist.
- **@po `Ödeme al` amount:** one amount field plus the ticked periods, allocated oldest first. Default amount = Σremaining of the ticked periods, which satisfies AC 14 (₺200 + ₺300) and AC 15.
