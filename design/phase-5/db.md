# Phase 5: database design (DBA)

Author: arkhe-dba. Inputs: `po-spec.md` §3/§6/§7, `backend.md`, `ux.md`, `src/db/schema.ts`, `drizzle/0000–0004`, `scripts/seed.ts`, `scripts/homework-fixture.mjs`, `e2e/lib.mjs`. CHECKs, the partial unique index and the balance query were tried on a scratch SQLite DB (a float amount, a second opening and a sponsorship without a sponsor are all rejected).

@po §6: I accept it with four changes. (1) Rate and note go in their own table `member_dues`, not on `users`. Adding CHECKed columns to `users` would force drizzle to rebuild `users`, and `DROP TABLE users` with FKs on cascades into sessions and invites. It also keeps the manager-only `dues_note` out of the many `users` selects (the same idea as `rehearsal_secrets`). (2) `dues_waivers` becomes `dues_overrides`, per @backend Q2. (3) Sponsor uniqueness uses an app-computed `name_key` (@backend: agreed, SQLite `lower()` is ASCII-only). (4) Actor FKs on money rows are `restrict`, not `set null`. Losing "who entered/voided this" would break the audit trail. Users are never hard-deleted by the app.
@backend: agreed on openings as entries (Q4), atomic `Düzelt`, refusing overlapping periods, derived ids for dues, and one entry per period, so no allocation table (§3). I added `revision` for your optimistic lock. `updated_at` is second-resolution, so two edits in the same second would pass a timestamp `version` check.

## 0. Rules carried over
- Money is `integer` kuruş with `typeof(x) = 'integer'` in the CHECK. SQLite's INTEGER affinity would otherwise store `12.5` as REAL. `sum()` of integers stays integer.
- Business dates are plain Istanbul days `YYYY-MM-DD` (text, glob CHECK, like `terms`). Instants are `integer(…, { mode: "timestamp" })` UTC seconds from `now()`.
- Enums are CHECKed via `inList`. Tuples are imported from `src/lib/finance/categories.ts` (@backend §1.2), plus `DUES_RATES`, `OVERRIDE_KINDS`.
- Money is never deleted: no cascade reaches `finance_entries`, and every FK into or out of it is `restrict`.

## 1. Schema (`src/db/schema.ts`)
```ts
export const DUES_RATES = ["standard", "reduced", "exempt"] as const;
export const OVERRIDE_KINDS = ["waiver", "freeze"] as const;
export const SETTING_KEYS = ["recording_email", "dues_payment_info"] as const;
const DAY = (c: string) => sql.raw(`${c} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`);
const kurus = (c: string, max = "1000000000") => sql.raw(`typeof(${c}) = 'integer' and ${c} between 1 and ${max}`);
const optText = (c: string, max: number) => sql.raw(`${c} is null or length(trim(${c})) between 1 and ${max}`);

export const sponsors = sqliteTable("sponsors", {
  id: id(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),            // searchKey(name): trim, collapse spaces, tr-TR lower
  contactName: text("contact_name"), contact: text("contact"), note: text("note"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("sponsors_name_key_idx").on(t.nameKey),
  check("sponsors_name_length", sql`length(trim(name)) between 1 and 120`),
  check("sponsors_texts", sql`(${optText("contact_name", 80)}) and (${optText("contact", 120)}) and (${optText("note", 500)})`),
]);

export const events = sqliteTable("events", {
  id: id(),
  name: text("name").notNull(),
  startsOn: text("starts_on").notNull(),
  rehearsalId: text("rehearsal_id").references(() => rehearsals.id, { onDelete: "set null" }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("events_rehearsal_idx").on(t.rehearsalId).where(sql`rehearsal_id is not null`),
  index("events_starts_idx").on(t.startsOn),
  check("events_name_length", sql`length(trim(name)) between 1 and 80`),
  check("events_starts_format", DAY("starts_on")),
]);

export const duesPeriods = sqliteTable("dues_periods", {
  id: id(),
  name: text("name").notNull().unique(),
  startsOn: text("starts_on").notNull(), endsOn: text("ends_on").notNull(), dueOn: text("due_on").notNull(),
  amountKurus: integer("amount_kurus").notNull(),
  reducedAmountKurus: integer("reduced_amount_kurus"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  index("dues_periods_starts_idx").on(t.startsOn),     // picker, "current period", overlap check
  check("dues_periods_name_length", sql`length(trim(name)) between 1 and 40`),
  check("dues_periods_dates", sql`${DAY("starts_on")} and ${DAY("ends_on")} and ${DAY("due_on")} and ends_on >= starts_on and due_on >= starts_on`),
  check("dues_periods_amount", kurus("amount_kurus")),
  check("dues_periods_reduced", sql`reduced_amount_kurus is null or (typeof(reduced_amount_kurus) = 'integer' and reduced_amount_kurus between 1 and amount_kurus - 1)`),
]);

// Row absent = standard. Separate from users so dues_note never rides along a users select.
export const memberDues = sqliteTable("member_dues", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "restrict" }),
  rate: text("rate", { enum: DUES_RATES }).notNull(),
  note: text("note"),                                  // managers only, never in myDues()
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
}, () => [
  check("member_dues_rate_check", sql`rate in (${inList(DUES_RATES)})`),
  check("member_dues_note_length", optText("note", 200)),
]);

// waiver = "Bu dönem muaf" (owed 0); freeze = owed pinned when the rate changes after a payment.
export const duesOverrides = sqliteTable("dues_overrides", {
  duesPeriodId: text("dues_period_id").notNull().references(() => duesPeriods.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  kind: text("kind", { enum: OVERRIDE_KINDS }).notNull(),
  owedKurus: integer("owed_kurus").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.duesPeriodId, t.userId] }),
  index("dues_overrides_user_idx").on(t.userId),       // member history + FK lookup
  check("dues_overrides_kind_check", sql`kind in (${inList(OVERRIDE_KINDS)})`),
  check("dues_overrides_owed", sql`typeof(owed_kurus) = 'integer' and ((kind = 'waiver' and owed_kurus = 0) or (kind = 'freeze' and owed_kurus between 1 and 1000000000))`),
  check("dues_overrides_reason_length", sql`length(trim(reason)) between 3 and 200`),
]);

export const financeEntries = sqliteTable("finance_entries", {
  id: id(),                                            // client uuid (createEntry) or uuidv8 (dues)
  kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
  category: text("category", { enum: CATEGORIES }),
  amountKurus: integer("amount_kurus").notNull(),
  occurredOn: text("occurred_on").notNull(),
  account: text("account", { enum: ACCOUNTS }).notNull(),
  toAccount: text("to_account", { enum: ACCOUNTS }),
  description: text("description"), counterparty: text("counterparty"), documentUrl: text("document_url"),
  sponsorId: text("sponsor_id").references(() => sponsors.id, { onDelete: "restrict" }),
  eventId: text("event_id").references(() => events.id, { onDelete: "restrict" }),
  memberId: text("member_id").references(() => users.id, { onDelete: "restrict" }),
  duesPeriodId: text("dues_period_id").references(() => duesPeriods.id, { onDelete: "restrict" }),
  paymentGroupId: text("payment_group_id"),            // clientId shared by one multi-period payment
  replacesId: text("replaces_id").references((): AnySQLiteColumn => financeEntries.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(0),  // +1 per updateEntryMeta; optimistic lock
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),   // no $onUpdateFn: voiding must not stamp it
  voidedAt: integer("voided_at", { mode: "timestamp" }),
  voidedBy: text("voided_by").references(() => users.id, { onDelete: "restrict" }),
  voidReason: text("void_reason"),
}, (t) => [
  check("fe_kind", sql`kind in (${inList(ENTRY_KINDS)})`),
  check("fe_account", sql`account in (${inList(ACCOUNTS)}) and (to_account is null or to_account in (${inList(ACCOUNTS)}))`),
  check("fe_transfer", sql`(kind = 'transfer') = (to_account is not null) and (to_account is null or to_account <> account)`),
  check("fe_category_present", sql`(kind in ('income', 'expense')) = (category is not null)`),
  check("fe_category_income", sql`kind <> 'income' or category in (${inList(INCOME_CATEGORIES)})`),
  check("fe_category_expense", sql`kind <> 'expense' or category in (${inList(EXPENSE_CATEGORIES)})`),
  check("fe_amount", kurus("amount_kurus")),
  check("fe_occurred_format", DAY("occurred_on")),
  check("fe_sponsor", sql`(category is 'sponsorship') = (sponsor_id is not null)`),
  check("fe_dues", sql`(category is 'dues') = (member_id is not null) and (category is 'dues') = (dues_period_id is not null) and (payment_group_id is null or category is 'dues')`),
  check("fe_event", sql`event_id is null or kind in ('income', 'expense')`),
  check("fe_texts", sql`(${optText("description", 200)}) and (${optText("counterparty", 120)})`),
  check("fe_document", sql`document_url is null or (document_url like 'https://%' and length(document_url) <= 2000)`),
  check("fe_updated_pair", sql`(updated_at is null) = (updated_by is null)`),
  check("fe_void_triple", sql`(voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)`),
  check("fe_void_reason", sql`void_reason is null or length(trim(void_reason)) between 5 and 200`),
  check("fe_replaces_self", sql`replaces_id is null or replaces_id <> id`),
  uniqueIndex("fe_opening_idx").on(t.account).where(sql`kind = 'opening' and voided_at is null`),
  uniqueIndex("fe_replaces_idx").on(t.replacesId).where(sql`replaces_id is not null`),  // one correction per entry
  index("fe_occurred_idx").on(t.occurredOn, t.createdAt),      // month list, report year, CSV range + sort
  index("fe_event_idx").on(t.eventId),                         // event P/L + FK restrict lookup
  index("fe_sponsor_idx").on(t.sponsorId, t.occurredOn),       // sponsor detail / year totals + FK
  index("fe_member_idx").on(t.memberId, t.duesPeriodId),       // myDues, member sheet, overpayment guard + FK
  index("fe_period_idx").on(t.duesPeriodId),                   // dues board per period + FK restrict on delete
]);
```
`app_settings`: extend the key CHECK, and add `check("app_settings_payment_info", sql\`key <> 'dues_payment_info' or length(value) <= 500\`)`. Index notes: the FK indexes are deliberately non-partial, because SQLite FK checks can't use a partial index. `created_by`/`voided_by` get no index, since a user delete (e2e only) is the only path that would use one. Balances and the year report are full scans of at most a few thousand rows a year. That's cheaper than maintaining covering indexes.

## 2. Balances and reports (each one query, `voided_at is null`)
```sql
with legs as (
  select account acct, kind, occurred_on, case when kind in ('expense','transfer') then -amount_kurus else amount_kurus end delta
  from finance_entries where voided_at is null
  union all
  select to_account, 'transfer_in', occurred_on, amount_kurus from finance_entries where voided_at is null and kind = 'transfer')
select acct, sum(delta) from legs group by acct;             -- balances(); total = cash + bank, transfers cancel
```
- `monthlyReport(y)` uses the same `legs`: `select acct, case when occurred_on < :y0 then 'carry' else substr(occurred_on,1,7) end m, kind, sum(delta) … where occurred_on <= :yEnd group by 1,2,3`. Running sums go in JS. Openings count in the Devir of their month, so Gelir/Gider exclude them. Virman in/out are per-account columns that net to 0 in the total. This agrees with @backend §3.
- `monthSummary`, `eventPL`, the category breakdown: `group by kind, category`, with `kind in ('income','expense')`.
- The dues board for one period: one query for the roster (`users` where role in member/board) `left join member_dues`, `left join dues_overrides` on (period, user), and `left join (select member_id, sum(amount_kurus) paid from finance_entries where dues_period_id = :p and voided_at is null group by member_id)`. JS `owesPeriod` filters it. Also keep any row with `paid > 0` that `owesPeriod` would drop, so no money disappears from the list.
- The all-periods matrix (home `{n} kişi borçlu`, member sheet, `myDues`): three flat queries with no per-row loops. Periods; overrides (`where user_id = :me` for `myDues`); and `select member_id, dues_period_id, sum(amount_kurus) … group by 1,2` (`where member_id = :me` for `myDues`, through `fe_member_idx`). Then `owedFor`/`duesStatus` in JS. Do not run a query per member or per period.
- `myDues` never selects `member_dues.note`, freeze reasons, `created_by` names or other `member_id`s. @backend §3 already says this. The review will grep for it.

## 3. Payments, corrections, guards (`db.transaction`, libsql `BEGIN IMMEDIATE`)
- **No allocation table.** A multi-period payment is N `income/dues` entries, one per period, sharing `payment_group_id`. Each one is voidable on its own, and the CSV shows one line per period. Detail shows `Aynı ödemede: Ekim 2026, Kasım 2026` via `where payment_group_id = ?`.
- **Overpayment guard** (`recordDuesPayment`), all inside one tx:
  1. Replay check on the derived ids.
  2. Load the periods, `member_dues`, the overrides, and `sum(amount_kurus) where member_id = :m and dues_period_id in (…) and voided_at is null group by dues_period_id`.
  3. Run `allocate`; throw if it overflows. Any throw rolls back, so nothing is saved.
  4. Insert the N rows.

  `BEGIN IMMEDIATE` serialises a second manager behind the first, who then sees the new sum. On Turso, `client.transaction("write")` gives the same semantics.
- **Düzelt**: in one tx, `update … set voided_* , void_reason='Düzeltildi' where id=:old and voided_at is null` (expect 1 row, else `ALREADY_VOID`). For dues, re-run the guard after the void. Then insert the new row with `replaces_id = :old`. The partial unique index on `replaces_id` stops two corrections of the same row.
- **Void**: a single statement `where voided_at is null and kind <> 'opening'`. **Meta edit**: `set …, revision = revision + 1, updated_by, updated_at where id and voided_at is null and revision = :rev`.
- **Openings** (`setOpeningBalances`): one tx. Check that no non-opening entry is dated before the opening, void the old opening, insert the new one. The partial unique index enforces at most one live opening per account.
- **Period edit/delete** (one tx): refuse if `exists(… dues_period_id = :p and voided_at is null)`. Voided payments also block a delete, through FK restrict. That's intended: the trail keeps its period. Overlap check: `starts_on <= :end and ends_on >= :start and id <> :id`.
- **Rate change** (`setDuesRate`, one tx): first insert `freeze` overrides for periods with paid > 0 and no override, then upsert `member_dues`. **Waiver**: upsert a `waiver` override, refused if paid > 0.
- **Event delete**: FK restrict backs up the app check (`Bu etkinliğe bağlı hareketler var.`). Voided entries also block it, which is intended. **Sponsors**: no delete, only `is_active`.

## 4. Migration `0005_phase5_finance`
- Edit `schema.ts`, then run `npx drizzle-kit generate --name phase5_finance`. Expect 6 `CREATE TABLE` (sponsors, events, dues_periods, member_dues, dues_overrides, finance_entries) and a rebuild of `app_settings`, because a CHECK changed. Small and safe: nothing references `app_settings`. The existing `recording_email` row is copied by `INSERT … SELECT`.
- There must be **no** `__new_users` in the SQL. If it appears, a column landed on `users`: stop and fix the schema.
- Count the CHECKs named in §1 (30 new + 1 setting) and check `ON DELETE restrict` on every finance FK. The tech lead runs `npm run db:migrate` (backup + `db:check`). No data migration is needed: the finance tables start empty, and production gets openings through `Ayarlar`.

## 5. Seed fixture `scripts/finance-fixture.mjs`
`seedFinance(client, T = new Date())` uses raw SQL in one `client.batch(…, "write")`, like `seedHomework`. It refuses unless `DATABASE_URL` is a `file:` URL. Finance data in the dev DB is demo-only.
- **Wipe** (FK order): `finance_entries`, `dues_overrides`, `member_dues`, `dues_periods`, `events`, `sponsors`, the setting `dues_payment_info`. Then **reinsert** with fixed ids `00000000-0000-4000-9000-0000000000xx`.
- **Rehearsal**: upsert one concert rehearsal (fixed id, title `Kış Konseri`, `T + 42 d` 19:00–21:30 Istanbul, `on conflict(id) do update` the times and clear `cancelled_at`). The seed's `Güz konseri` stays unlinked for AC12.
- **Anchors**: `today = istanbulDate(T)`, `M = today[0..7]`, `M-1`/`M-2` by string month arithmetic (year rollover handled). Day `dd` of a month is `${ym}-${dd}`, using only days ≤ 28. Period names come from `Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" })` (`Ekim 2026`).
- `export function financeExpected(T)` returns the numbers below plus the month keys and names. e2e imports them instead of hard-coding.

| Data | Rows |
|---|---|
| Openings `M-2-01` | Kasa 2.500,00 · Banka 18.000,00 |
| Periods ₺300 / ₺150 | P1 = M−2 (due `M-2-15`), P2 = M−1 (due `M-1-15`), P3 = M (`dueOn = today + 10`). All start on the 1st and end on the last day. |
| `member_dues` | Ece Demir `reduced` `Öğrenci`; Barış Güneş `exempt` `YK kararı 2/2026` |
| Override | Deniz Aslan, P3, waiver `Bir ay yurt dışında` |
| Dues (Kasa) | P1 on `M-2-08`: all 21 owing except Onur Çetin (19×300 + Ece 150 = **5.850**). P2 on `M-1-12`: yk, Elif, Zeynep, Defne, Selin, Ayşe, Melis, Can, Emre, Ozan ×300, Ece 150, korist **100** = **3.250**. P3 on `M-01`: Ece 150, yk 300, Elif 300 = **750** |
| Kış Konseri (event, P/L +4.200) | sponsorship 5.000 Banka `M-1-03` (Mülkiye Kitabevi); venue 3.500 Banka `M-1-18` + Drive doc; costume 1.200 Kasa `M-1-22`, no doc; tickets 6.000 Banka `M-01`; musician_fee 2.100 Banka `M-01` + doc |
| Other | bank_fee 12,75 Banka `M-1-28`, no doc. Transfer Kasa→Banka 1.500 `M-1-20`. Catering 450 Kasa `M-1-05`, voided by yk with `Yanlış girildi, fiş yok`. Payment info `IBAN TR00 0000 0000 0000 0000 0000 00 · Alıcı: Arkhe Korosu · Açıklamaya adını ve ayı yaz.` |

All entries are created by `yk@`. Roster: P1/P2 have 22 people (yk, korist, 20 members). P3 has 23, because `yeni@` joined at T−1h and so owes P3 only.

**Expected (AC2/13/17/20/22):** Kasa **₺9.650,00**, Banka **₺24.887,25**, Toplam **₺34.537,25**.

Report (Devir / Gelir / Gider / Kapanış):
- M−2: 20.500 / 5.850 / 0 / 26.350
- M−1: 26.350 / 8.250 / 4.712,75 / 29.887,25
- M: 29.887,25 / 6.750 / 2.100 / 34.537,25

Dues:
- P1: 20/21 paid, 300 left (Onur `Gecikti`).
- P2: 11/21 paid, 3.250 / 6.150 collected, 2.900 left. korist shows `Gecikti · ₺200,00 kaldı` (red).
- P3: 3/21 paid, 750 / 6.150 collected, 5.400 left. korist `Ödenmedi`, Barış `Muaf`, Deniz `Muaf` + reason.
- korist remaining **₺500,00**, so the AC14 payment of 200 + 300 raises Kasa to 10.150. Debtors: **19**.
- Ece (paid up) has no home card. Barış sees `Aidattan muafsın.`

Wiring:
- `seed.ts`: call `seedFinance(db.$client, new Date())` **after** the calendar block. Replace the early `return` with an `if`, because the fixture's rehearsal would otherwise make `count(rehearsals) > 0` skip the calendar on a fresh DB.
- `e2e/lib.mjs` `cleanup()`: call `seedFinance(db, new Date())` **first**, before `delete from users where email like '%@e2e.test'`, because the finance FKs to users are `restrict`. This re-anchors M to the run's month, as `seedHomework` does. `seedHomework` re-anchors yeni@ later in the same cleanup. The finance numbers don't depend on the exact second, only on yeni's join being before the end of P3.
- Risk: the extra future concert at +42 d. Phase 2–4 e2e don't count upcoming concerts (grep found none). Check that the home "next rehearsal" is unaffected, since the weekly series comes first.
