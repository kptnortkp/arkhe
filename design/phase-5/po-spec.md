# Phase 5 — Finans (PO spec)

Author: arkhe-po. Inputs: `PLAN_INPUT.md` (Faz 5); Phase 2 `po-decisions.md` D14–D16 (roster = `member`+`board`, `joined_at`/`left_at`); `src/db/schema.ts` (`rehearsals.type = 'concert'`, `terms`, `app_settings`); `src/app/(portal)/raporlar/csv/route.ts` + `src/lib/attendance/csv.ts` (BOM, `;`, formula-safe cells); `src/components/shell/nav-items.ts` (`sidebarOnly`); `src/lib/links.ts` (`parseLink`, Drive preview).

@ux, @ui, @dba, @backend: reply in your own files. **Proposal** marks my default. Open questions are in §10.

## 1. Problem

Today the treasurer (a board member) keeps a Google Sheet nobody else can read, a cash envelope from rehearsals and a bank account. At every board meeting the same questions: "Kim ekim aidatını vermedi?", "Kış konseri kâr etti mi?", "Kasada ne kadar var?", "Sponsor ne kadar verdi, makbuz nerede?". Members ask the treasurer on WhatsApp "borcum var mı?". At year end the accountant/derneğin denetçisi wants a clean ledger.

Phase 5 gives:
1. One ledger of every lira in and out (kasa/banka), categorised, optionally tied to an event or sponsor, with a receipt link (Drive). Money records are never deleted: a wrong entry is **voided with a reason**, who/when kept.
2. Dues (aidat) that the treasurer can run in two minutes a month: periods with an amount, standard/reduced/exempt members, partial payments, and a list of who still owes.
3. Answers on one screen: balances, per-event profit/loss, monthly balance, CSV for the accountant.
4. Each member sees **only their own** dues status and how to pay (IBAN text). No payment gateway, no bank API, nothing paid (zero budget).

## 2. Users and roles

| Role | In this phase they… |
|---|---|
| Şef / YK (managers) | Read everything under `/finans`; add income/expense/transfer, void and correct entries; run dues periods, record payments, set member dues rates and waivers; manage events and sponsors; export CSV; edit `Ödeme bilgisi`. |
| Korist (and YK/şef as a person) | Sees `Aidatım`: own periods, owed/paid/remaining, own payment history, payment info. Never anyone else's money data, never the ledger. |

Authorization: every `/finans` page, route handler and action requires `isManager` on the server; the member dues query is always filtered by the session user id (no `userId` parameter). The conductor is **not** charged dues (roster = `member` + `board`). Plan says both managers write; I keep that (§10 Q1).

## 3. Domain

### 3.1 Money rules
- All amounts are **integer kuruş** (`amount_kurus`, > 0, ≤ 10.000.000,00 TL). Never floats, never negative: direction comes from the kind.
- Input accepts Turkish format: `1250`, `1250,5`, `1.250,50`. **Proposal:** `,` is the only decimal mark; `.` is accepted only as a thousands separator before exactly 3 digits (`1250.50` is rejected), max 2 decimals. Otherwise `Tutarı 1.250,50 biçiminde gir.` Zero → `Tutar sıfırdan büyük olmalı.`
- Display: `Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" })` → `₺1.250,50`. Income shown `+₺1.250,50`, expense `−₺1.250,50`; sign is text, colour is extra (present/absent tokens).
- Date: `occurred_on` = plain Europe/Istanbul calendar day `YYYY-MM-DD` (like `terms`), default today, no future beyond today + 31 days (`Tarih çok ileride.`). Months group by `substr(occurred_on,1,7)`.

### 3.2 Entry (`Hareket`) fields
| Field | UI label | Rules |
|---|---|---|
| `kind` | Tür: `Gelir` / `Gider` / `Virman` / `Açılış bakiyesi` | `transfer` moves money Kasa↔Banka (e.g. depositing the rehearsal cash), excluded from income/expense totals. `opening` = one per account, set once in `Ayarlar`, counts only in balances. |
| `category` | Kategori | required for income/expense, must belong to the kind (CHECK). Fixed list §3.3, not user-editable. |
| `amountKurus` | Tutar | §3.1 |
| `occurredOn` | Tarih | §3.1 |
| `account` | Hesap: `Kasa` (cash) / `Banka` (bank) | default `Kasa` for dues, `Banka` otherwise. For transfers this is the source; `toAccount` the target, must differ (`Kaynak ve hedef hesap aynı olamaz.`). |
| `description` | Açıklama | optional ≤ 200 (`Salon kirası, 12 Aralık genel prova`). |
| `counterparty` | Kimden / Kime | optional free text ≤ 120 (`Mülkiye Vakfı`, `Ahmet Yılmaz (korrepetitör)`). |
| `sponsorId` | Sponsor | **required** when category = `sponsorship`, else null. |
| `eventId` | Etkinlik | optional, any income/expense. |
| `memberId`, `duesPeriodId` | Üye, Aidat dönemi | **both required** when category = `dues`, else both null. |
| `documentUrl` | Belge (makbuz/fatura linki) | optional https URL ≤ 2000, normalised with `parseLink`; Drive files open in the existing preview. Invalid → `Geçerli bir https bağlantısı gir.` |
| audit | — | `createdBy/At`, `updatedBy/At`, `voidedAt/By`, `voidReason` (5–200), `replacesId`. |

Correction rules (an accountant must be able to trust it):
- **Edit** in place only `description`, `counterparty`, `eventId`, `documentUrl` (adding the receipt later is the common case). Stamps `updatedBy/At`.
- Anything else (amount, date, account, kind, category, member/period, sponsor) = **`Düzelt`**: one action voids the old entry with reason `Düzeltildi` and opens the form prefilled; the new entry stores `replacesId`. Detail of each shows the link (`Bu kaydın yerine: …` / `Düzeltilmiş kayıt: …`).
- **`İptal et`** (void) with a required reason: `İptal nedeni yaz (en az 5 karakter).` Voided entries leave every total and CSV, remain listable under the `İptal edilenler` filter, struck through, with `İptal: {ad} · {tarih} · {neden}`. No hard delete exists, not even for managers. Voiding is final (no un-void; re-enter instead).
- Refund to someone = an expense with category `refund` (İade); a mistaken entry = void.

### 3.3 Categories (code → label)
Income: `dues` Aidat · `sponsorship` Sponsorluk · `tickets` Bilet satışı · `donation` Bağış · `grant` Hibe / destek · `other_income` Diğer gelir.
Expense: `costume` Kostüm · `venue` Salon / mekân · `musician_fee` Şef / korrepetitör ücreti · `scores_royalties` Nota ve telif · `travel` Ulaşım ve konaklama · `festival_fee` Festival katılım ücreti · `organisation` Organizasyon / tanıtım · `catering` İkram · `refund` İade · `bank_fee` Banka masrafı · `other_expense` Diğer gider.
Labels live in `src/lib/labels.ts`; adding one later is a code change + migration, by design (no admin screen).

### 3.4 Events (`Etkinlik`)
**Proposal:** a small `events` table, not a direct link to rehearsals: a festival trip spans several sessions and some events (yardım gecesi, CD) are not rehearsals. Fields: `name` (1–80, `Kış Konseri 2026`), `startsOn` (date), optional `rehearsalId` → a `concert`-type rehearsal (set null). `Konserden oluştur` lists concert rehearsals without an event and prefills name/date. Events are never deleted while entries point to them (`Bu etkinliğe bağlı hareketler var.`); renaming is fine.
P/L per event = Σ non-voided income − Σ non-voided expense with that `eventId`, broken down by category: `Kâr ₺4.200,00` / `Zarar −₺1.300,00`.

### 3.5 Sponsors
`sponsors`: `name` (1–120, unique case-insensitive), `contactName`, `contact` (phone or email, free ≤ 120), `note` ≤ 500, `isActive`. Sponsor page shows total received per year and its entries. Quick-create from the entry form (`+ Yeni sponsor`). No contracts or invoices in this phase.

### 3.6 Dues (`Aidat`)
- **Dues period** (`Aidat dönemi`): `name` (1–40, `Ekim 2026` or `2026 Güz`), `startsOn`, `endsOn`, `dueOn` (son ödeme), `amountKurus` (Tam), `reducedAmountKurus` (İndirimli, optional, < amount). Monthly or per term both fit; the amount lives on the period, so a fee change just means the next period has another amount. `Toplu oluştur`: month range + amounts → one period per month named `Ekim 2026`, due the 15th. Periods can be edited until they have a payment; deleting a period with payments is refused (`Bu döneme ödeme girilmiş.`).
- **Member dues rate** (on the member, set from the dues screen): `Tam` (default) / `İndirimli` / `Muaf`, plus `duesNote` ≤ 200 (`Öğrenci`, `İşsiz, YK kararı 3/2026`) visible to managers only. Reduced members owe `reducedAmount` (falls back to full if the period has none).
- **Waiver** (`Bu dönem muaf`): per (period, member) with reason, for one-offs (uzun hastalık, yurt dışı). Removable.
- **Who owes a period** (computed, never stored): role `member`/`board`, `joinedAt ≤ endsOn`, (`leftAt` null or `≥ startsOn`). Joined mid-period still owes the full amount (treasurer can waive). Left members with remaining debt stay listed with `Ayrıldı`.
- **Owed** = 0 if `Muaf` or waived, else full/reduced amount *as of now* (rate changes apply to all unpaid periods; **Proposal**, simple and what a treasurer expects). **Paid** = Σ non-voided `dues` entries for (member, period).
- **Status** (first match wins): `Muaf` (owed 0, tone `muted`) · `Ödendi` (paid ≥ owed, `done`) · after `dueOn`: `Gecikti · ₺200,00 kaldı` (`red`) · up to `dueOn`: `Kısmi · ₺200,00 kaldı` if paid > 0 (`amber`), else `Ödenmedi` (`amber`). Text + icon, tones/tokens reuse Phase 4 D3; exposed as `data-tone`.
- **Payment** (`Ödeme al`): member → amount (default remaining of the oldest unpaid period), date, account (default Kasa); `Birden fazla dönem`: tick several open periods, one entry is created per period for its remaining amount (the "3 aylığı birden verdi" case). Over the remaining → `Kalan borç ₺200,00; daha fazlası girilemez.` Partial payments are just several entries.
- **Payment info** (`Ödeme bilgisi`): free text in `app_settings` key `dues_payment_info` (≤ 500, e.g. `IBAN TR00 … · Alıcı: Arkhe Korosu · Açıklamaya adını ve ayı yaz.`), shown to members with `Kopyala`.

### 3.7 Balances and reports
- Account balance = opening + Σ income − Σ expense ± transfers, per account, non-voided only. Negative balance is allowed but shown red with `Eksi bakiye` (a data error the treasurer must see, not a block).
- Monthly report (`Aylık bakiye`) for a year: rows = months, columns = Devir (opening of month), Gelir, Gider, Net, Kapanış; per account and total. Category breakdown for the selected month/year.
- CSV (`Muhasebe CSV`, managers): ledger for a date range (default the selected year). Same conventions as `attendanceCsv`: UTF-8 BOM, `;`, CRLF, formula-safe cells. Columns: `Tarih;Tür;Kategori;Açıklama;Kimden/Kime;Sponsor;Etkinlik;Üye;Aidat dönemi;Hesap;Gelir;Gider;Belge;Kaydeden;Kayıt no`. Amounts as `1250,50` (no thousands separator, comma decimal, no ₺), income and expense in separate columns so Excel sums work. Transfers appear with `Virman` and both columns empty plus `Kasa → Banka` in Hesap. Voided entries excluded. Filename `arkhe-finans-{from}-{to}.csv`. Second CSV: dues status for a period (`Ad soyad;Partisyon;Oran;Borç;Ödenen;Kalan;Durum`).

## 4. Screens / IA (proposal; @ux owns details)

Nav: **`Finans`** → `/finans`, icon `Wallet`, `managersOnly`, **`sidebarOnly`** (the manager tab bar already has 5). Mobile entry points: a manager home card `Kasa` (total balance, this month net, `{n} kişi aidat borçlu`, link `Finans`) and a `Finans` row on `/profil` for managers. Members: home card `Aidatım` only when they have remaining/overdue dues, and an `Aidatım` section on `/profil` always.

- **`/finans`** overview: three balance tiles (Kasa · Banka · Toplam), this month Gelir/Gider/Net, current dues period collection `18/32 ödendi · ₺3.900 kalan`, primary `Gelir ekle` / `Gider ekle`, secondary `Virman`, last 10 entries, links to sub-sections (segmented control on desktop, list on phone): `Hareketler`, `Aidat`, `Etkinlikler`, `Sponsorlar`, `Rapor`, `Ayarlar`.
- **`/finans/hareketler`** (`?ay=2026-10&tur=&kategori=&hesap=&etkinlik=&belgesiz=1&iptal=1`): grouped by day, row = category chip, description/counterparty, `+₺/−₺` amount, Kasa/Banka icon, paperclip if document. Filter `Belgesiz giderler` helps the treasurer chase receipts. Month total footer.
- **`/finans/yeni?tur=gelir|gider|virman`** (also `?etkinlik=`, `?sponsor=`) form; **`/finans/[id]`** detail with audit lines, `Düzenle` (limited fields), `Düzelt`, `İptal et`. After save → back to where you came from, toast `Kaydedildi.`
- **`/finans/aidat`** (`?donem=`): period picker (default the current one), summary `Toplanan ₺6.300 / ₺9.600`, members grouped S/A/T/B with status chip and remaining; filter `Borçlular`; tapping a row opens a sheet: history across periods, `Ödeme al`, rate (`Tam/İndirimli/Muaf` + note), `Bu dönem muaf`. Header: `Dönemler` (list, `Yeni dönem`, `Toplu oluştur`), `CSV`.
- **`/finans/etkinlikler`** list with net per event; **`/finans/etkinlikler/[id]`** P/L by category + entries + `Gelir ekle`/`Gider ekle` prefilled.
- **`/finans/sponsorlar`** list with this year's total; detail with entries.
- **`/finans/rapor`** (`?yil=2026`): monthly table (cards on phone, table from `md`), category totals, `Muhasebe CSV` with date range.
- **`/finans/ayarlar`**: opening balances (date + Kasa + Banka; editable only while no other entry is dated before it), `Ödeme bilgisi`.
- **Member `Aidatım`** (`/profil#aidat`): total remaining big, per period rows (last 12 months + any unpaid) with status, own payments (date, amount, period), `Ödeme bilgisi` + `Kopyala`. Copy for no periods: `Henüz aidat dönemi yok.`; exempt: `Aidattan muafsın.`

## 5. User stories

Treasurer / managers
- **T1** After rehearsal I enter 6 cash dues payments on my phone in under 2 minutes, one of them for three months at once.
- **T2** I deposit the envelope: `Virman` Kasa → Banka ₺1.800; balances match the bank app.
- **T3** I pay the salon by transfer and paste the Drive link of the invoice; later I filter `Belgesiz giderler` and fix the two missing.
- **T4** I typed ₺1.500 instead of ₺150: `Düzelt`, the wrong one is voided with the trail, the new one is right.
- **T5** Before the board meeting I open `Kış Konseri 2026`: tickets + sponsor vs salon + costume + korrepetitör → `Kâr ₺4.200`.
- **T6** At year end I download `Muhasebe CSV` for 2026 and email it to the accountant; it opens correctly in Excel (Turkish).
- **T7** The board raises dues from ₺300 to ₺350 from January: I bulk-create Jan–Jun with ₺350 / ₺175.
- **T8** A student is set `İndirimli · Öğrenci`; a member abroad for a month gets `Bu dönem muaf`.
- **T9** I open `/finans/aidat`, filter `Borçlular`, and send the reminders myself (WhatsApp is outside the app).
Members
- **M1** I open my profile and see `Kalan borcun ₺400,00`: Ekim `Gecikti · ₺200,00 kaldı`, Kasım `Ödenmedi`; I copy the IBAN and pay.
- **M2** I never see anyone else's payments or the choir's balance.

## 6. Data (for @dba; proposal)
- `finance_entries`: `id`, `kind` CHECK (`income|expense|transfer|opening`), `category` null (CHECK in list; CHECK income cats ↔ income, expense cats ↔ expense, null for transfer/opening), `amount_kurus` int CHECK `> 0 and ≤ 1000000000`, `occurred_on` text (glob like `terms`), `account` CHECK (`cash|bank`), `to_account` null (CHECK: non-null and ≠ account iff transfer), `description` ≤ 200, `counterparty` ≤ 120, `sponsor_id` → sponsors restrict (CHECK non-null iff category `sponsorship`), `event_id` → events restrict, `member_id` → users restrict + `dues_period_id` → dues_periods restrict (CHECK both non-null iff category `dues`), `document_url` (https, ≤ 2000), `created_by/at`, `updated_by/at`, `voided_at`, `voided_by`, `void_reason` (CHECK all-or-none), `replaces_id` → self. Partial unique on (`kind`='opening', `account`). Indexes: (`occurred_on`), (`event_id`), (`sponsor_id`), (`member_id`, `dues_period_id`), all `where voided_at is null` where useful.
- `events`: `id`, `name`, `starts_on`, `rehearsal_id` → rehearsals set null (unique where not null), `created_by/at`.
- `sponsors`: `id`, `name` (unique on `lower(name)`), `contact_name`, `contact`, `note`, `is_active`, `created_at`.
- `dues_periods`: `id`, `name` unique, `starts_on`, `ends_on`, `due_on`, `amount_kurus` > 0, `reduced_amount_kurus` null (< amount), `created_by/at`; CHECK date order/format.
- `users`: add `dues_rate` (`standard|reduced|exempt`, default `standard`), `dues_note` ≤ 200.
- `dues_waivers`: PK (`dues_period_id` cascade, `user_id` restrict), `reason` ≤ 200, `created_by/at`.
- `app_settings`: add key `dues_payment_info` (≤ 500).
- Owed/paid/status and balances computed in queries; nothing derived is stored. Migration number per dba.
- Seed (months relative to reset month M; documented with expected totals in the seed file): openings at M−2 day 1: Kasa ₺2.500,00, Banka ₺18.000,00; periods M−2, M−1, M at ₺300 / ₺150, M−2/M−1 due the 15th (past), M due reset day + 10 (so it stays `Ödenmedi` during the suite); `korist@` standard: M−2 paid, M−1 partial ₺100, M unpaid; one `İndirimli` member fully paid; one `Muaf` member; one waiver; event `Kış Konseri` linked to a seeded concert rehearsal with tickets ₺6.000, sponsor ₺5.000 (`Mülkiye Kitabevi`), venue ₺3.500 (with document), costume ₺1.200 (no document), korrepetitör ₺2.100 → net ₺4.200; a transfer Kasa → Banka ₺1.500; one voided expense with reason; payment info text.

## 7. Acceptance criteria (e2e-verifiable)

Managers (`yk@`, `sef@`)
1. `Finans` is in the sidebar (≥ md) and not in the mobile tab bar; at 375 px the manager home card `Kasa` and `/profil` row both link to `/finans`.
2. `/finans` shows Kasa, Banka, Toplam balances equal to the seed doc, each formatted `₺1.234,56`.
3. Adding a `Gider` (Salon / mekân, `1.250,50`, Banka, today, Drive link) lands with `Kaydedildi.`; the Banka balance drops by exactly ₺1.250,50; the entry shows the Drive preview link.
4. Amount validation: `0` → `Tutar sıfırdan büyük olmalı.`; `12,345` → `Tutarı 1.250,50 biçiminde gir.`; `abc` same; `1.250,5` is accepted as ₺1.250,50.
5. Category `Sponsorluk` without a sponsor → `Sponsor seç.`; `Aidat` cannot be picked from the generic form (dues go through `Ödeme al`); a bad URL → `Geçerli bir https bağlantısı gir.`
6. `Virman` Kasa → Banka ₺500 moves both balances by ₺500, the Toplam is unchanged, and this month's Gelir/Gider are unchanged; same source and target → `Kaynak ve hedef hesap aynı olamaz.`
7. `İptal et` without a reason → `İptal nedeni yaz (en az 5 karakter).`; with one, the entry disappears from the default list and balances, appears under `İptal edilenler` with name/date/reason; no delete control exists anywhere.
8. `Düzelt` on an entry: the old one is voided with `Düzeltildi`, the new one shows `Bu kaydın yerine: …`; totals count only the new one.
9. `Düzenle` can change the description and add a document link; amount/date fields are not editable there.
10. `/finans/hareketler?belgesiz=1` lists the seeded costume expense and not the venue one.
11. `Kış Konseri` P/L shows the seeded category lines and `Kâr ₺4.200,00`; adding a ₺5.000 expense to it turns it into `Zarar −₺800,00`.
12. `Konserden oluştur` lists the seeded concert rehearsal without an event and prefills its name/date.
13. `/finans/aidat` (current period) shows `korist@` `Ödenmedi`, the exempt member `Muaf`, the waived member `Muaf` with reason; the M−1 period (due date past) shows `korist@` `Gecikti · ₺200,00 kaldı` with `data-tone="red"`; `Borçlular` filter hides paid and exempt members.
14. `Ödeme al` for `korist@` with `Birden fazla dönem` (M−1 and M) creates two entries (₺200 + ₺300), both periods become `Ödendi`, Kasa rises by ₺500.
15. Paying more than the remaining → `Kalan borç ₺300,00; daha fazlası girilemez.` and nothing is saved.
16. Setting a member to `İndirimli` changes their owed amount for unpaid periods to ₺150; `Toplu oluştur` for the next 2 months at `350` / `175` creates two periods named in Turkish (`Ocak 2027`…).
17. `/finans/rapor?yil=` shows month rows whose Kapanış equals the next month's Devir, and the last Kapanış equals the Toplam on `/finans`.
18. `Muhasebe CSV` downloads with `text/csv`, starts with the BOM, has the §3.7 header, no voided rows, amounts like `1250,50`, a value starting with `=` is prefixed with `'`; the dues CSV lists the period's owing members.
19. Editing `Ödeme bilgisi` updates what `korist@` sees.

Members (`korist@`)
20. Home shows `Aidatım` with the seeded remaining total; `/profil` shows per-period statuses and own payments only, plus `Ödeme bilgisi` with `Kopyala` (toast `Kopyalandı.`).
21. `/finans` and every sub-route redirect away; `/finans/rapor/csv` (and every finance route handler) returns 403/redirect; every finance server action returns `Bu işlem için yetkin yok.` and changes nothing. Other members' names/amounts never appear in `korist@`'s HTML.
22. A member with no debt sees no home card; an exempt member sees `Aidattan muafsın.`

Quality
23. All new screens: no page-level horizontal scroll at 375 px in light and dark; touch targets ≥ 44 px; amounts use `tabular-nums`; sign and status always in text, not colour only.
24. `npm run lint`, `npm run typecheck`, `npm run e2e` pass.

## 8. Out of scope (Phase 5)
- Payment gateways, card/online payment, bank API/statement import, automatic reconciliation, e-invoice/e-arşiv, tax calculations.
- Reminders by email/SMS/push/WhatsApp; members' own "Ödedim" claims.
- File upload/storage of receipts (links only), OCR.
- Budgets/forecasts, multi-currency (festival abroad in EUR: enter the TRY amount, note the EUR in `Açıklama`), more than two accounts, user-defined categories.
- Locking/closing months, approval workflows (two-person rule), a separate treasurer role, a generic audit log table beyond the per-entry fields.
- Ticket sales/seating, sponsor contracts, donor receipts (bağış makbuzu), member-visible choir finances.

## 9. Risks
- The conductor sees the ledger including their own fee (plan decision); YK can restrict later with a treasurer role.
- Two managers entering the same cash payment twice: the dues list shows the duplicate as overpayment-blocked; generic duplicates are caught by the monthly reconciliation, not the app.
- Phone input of `,` vs `.` decimals: strict parser + clear error.
- Seeded month-relative data around month/year boundaries: e2e must compute expected months the same way the seed does.

## 10. Open questions (settle in po-decisions.md)
1. Should the conductor be read-only in finance (conflict of interest), or full like YK (plan)? My lean: full, per plan.
2. Rate change applying to already-past unpaid periods: OK, or snapshot the owed amount per period? My lean: compute live (no stored owed).
3. Events table vs linking entries straight to concert rehearsals? My lean: `events` with optional rehearsal link.
4. Opening balance as `opening` entries vs settings rows? @dba.
5. Dues entries: `Kasa` default right for a choir collecting cash at rehearsal? @ux.
6. `/profil#aidat` vs its own `/aidatim` page for members? @ux.
