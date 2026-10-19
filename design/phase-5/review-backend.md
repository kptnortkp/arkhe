# Phase 5 review: backend and security (arkhe-backend)

Scope: `finans/actions.ts`, `finans/aidat/actions.ts`, both CSV handlers, `src/lib/finance/*`, `src/lib/money.ts`, `src/lib/csv.ts`, `src/lib/flash.ts`, every `finans/**/page.tsx`, `components/finance/home-cards.tsx`, `my-dues.tsx`, and the client forms that feed ids to the server (`entry-form.tsx`, `payment-form.tsx`, `dues-list.tsx`). Checked against `po-decisions.md` D1–D31 and my `backend.md`.

Live probes against :3100 as `yk@` (server actions called with a hand-built React reply body; scratch script only). Results:
- A dues payment dated `2026-07-01`, before the `2026-08-01` opening, **was saved** (finding 1).
- Replaying a `clientId` with a different `memberId` returned `Ödeme alındı: …` and saved nothing for that member (finding 3).
- Two parallel full payments with different `clientId`s for the same member and period: one saved, the other got `Kalan borç ₺0,00; daha fazlası girilemez.` (BEGIN IMMEDIATE works).
- Two parallel `Düzelt` calls on the same entry: one saved, the other got `Bu kayıt zaten iptal edilmiş.`
- `/finans/rapor/csv` and `/finans/aidat/csv` as `korist@` return 403 JSON; anonymous requests get a 307 to `/giris`.
- `updateEntryMeta` on an opening was accepted (finding 4).
- Opening amount `0,00` gave `Tutar sıfırdan büyük olmalı.` (finding 5).

@tech lead: the probe rows are marked `E2E review…` and are voided now. The correction probe voided the seeded entry `…9000-000000000027` (`Korrepetitör, konser hazırlığı`, ₺2.100). There is no un-void, so Banka in the dev DB is ₺2.100 higher until the next `cleanup()` / `npm run e2e` re-seeds the fixture. Sorry for the noise.

## Verdict

**No P1.** Authorization is complete:
- Every page calls `requireManager()`.
- Every action calls `assertManager()` before it parses anything.
- Both CSV handlers call `managerOrError()` first.
- Every manager query re-checks.
- `myDues()` / `getPaymentInfo()` take no id and select no note, reason or other member.

I found no IDOR, privilege escalation or open redirect, and no XSS or formula injection. There are two P2 correctness gaps in `recordDuesPayment`.

## P2: fix this phase

### 1. `recordDuesPayment` skips the opening-date rule (D12)
`src/app/(portal)/finans/aidat/actions.ts:66-109`. `createEntry` and `correctEntry` refuse dates before the opening (`checkRefs`, `actions.ts:84-85`; `actions.ts:205-206`). The dues payment path does not, and the payment sheet's date input has no `min` (`payment-form.tsx:150-157`), so a treasurer can do this from the UI (verified live).

Consequences:
- The ledger holds income from before the opening.
- `setOpeningBalances` then refuses every change with `Açılış tarihinden önce hareket var.` until someone finds and voids that payment.
- The report's Devir includes pre-opening money.

Fix:
- Move `openingDate(tx)` from `actions.ts:64-70` to `src/lib/finance/ledger.ts` and export it.
- In the tx, before `allocate`, add: `const opened = await openingDate(tx); if (opened && d.occurredOn < opened) return { values: formValues(formData), fieldErrors: { occurredOn: ["Tarih açılış bakiyesinden önce olamaz."] } };`
- Optionally add `min={openedOn}` to the date input.

### 2. Multi-period payment records whatever is owed at commit time, not what the treasurer saw and collected
`aidat/actions.ts:60-64` and `:88`. With `multi=1` the form posts no amount (`payment-form.tsx:117-130` renders the total as text only), and the server uses `Σremaining` read inside the tx. Two cases go wrong:
- **Less owed by commit time.** Another manager recorded part of the debt in between, or a waiver was added. The sheet showed `Toplam ₺500,00`, the treasurer took ₺500 in cash, and the server saves ₺300 with `Ödeme alındı: … ₺300,00.` The cash box is then ₺200 over the books.
- **More owed by commit time.** A rate change or a period edit raised the remaining. The server books more than was collected.

D17 promises that "two managers recording the same cash" makes the second one fail. That holds in single mode only.

Fix:
- Post the displayed total: `<input type="hidden" name="expected" value={total} />` in multi mode.
- Server side, parse it as `z.coerce.number().int().positive()`.
- In the tx, if `open.reduce(...) !== expected`, return `{ fieldErrors: { amount: [overpaymentError(Σ) /* or STALE */] } }` and save nothing.
- Simpler alternative: post `amount` in multi mode too and use the single-mode path. `allocate` already refuses over-payment. Then an under-payment shows up as a partial allocation the treasurer can see before saving.

## P3: later (or now if cheap)

3. **Replay check ignores member and actor.** `ledger.ts:11-17` and `aidat/actions.ts:67-78`. `derivedId(clientId, periodId)` doesn't include `memberId`. When any derived id exists, the action returns success, using the *submitted* member's name and the old rows' total, without checking that those rows belong to that member or were created by that actor. The UI remounts the form with a new `clientId` per member (`dues-list.tsx:212`), so this isn't reachable today. It is a trap for the next UI change. Fix:
   - Change to `derivedId(d.clientId, d.memberId, p)`.
   - On replay, select `memberId, createdBy` and return `STALE` unless all rows match `d.memberId` / `actor.id` (same as `createEntry`, `actions.ts:144-148`).
   - Update the e2e helper's `derivedId` call in the same change.
4. **Düzenle on openings.** `actions.ts:256-301` accepts `updateEntryMeta` for `kind='opening'` (verified live: the description and a document URL were stored). The UI hides it (`[id]/page.tsx:172`), but D12 says openings change only via `Ayarlar`. Fix: after loading `current`, add `if (current.kind === "opening") return { error: OPENING_ONLY_IN_SETTINGS };`.
5. **Opening amount `0,00` / `₺0`.** `actions.ts:339-345` treats only `""` and `"0"` as "none". Any other zero spelling hits `parseAmount` and fails with `Tutar sıfırdan büyük olmalı.`, although D12 says `0` means none. Fix: `if (!v) return 0; const p = parseAmount(v); if (!p.ok && p.error === AMOUNT_ZERO) return 0;`.
6. **Opening date unbounded.** `actions.ts:350` uses `dayField`, so `2099-01-01` is accepted on an empty ledger, and every later entry is then refused as "before the opening". Fix: use `entryDayField` (today + 31 cap).
7. **CSV span check is off by one year.** `rapor/csv/route.ts:34` compares only the year digits, so `2020-01-01..2025-12-31` (6 years) passes (verified: 200). Fix: `to > addDays(from, 5 * 366)` → 400.
8. **A freeze can be silently replaced or orphaned.** `aidat/actions.ts:451-471` and `:479-492`. If every payment of a frozen period is voided, `setWaiver` overwrites the `freeze` row (D3: "never edited by hand"). `removeWaiver` then deletes it, so owed jumps to the live rate. Separately, the orphaned freeze keeps pinning owed to the old rate after a later period edit (allowed once payments are voided, D10). Fix: in `voidEntry`/`correctEntry`, when a dues entry is voided and the member's live paid sum for that period becomes 0, delete the `kind='freeze'` override in the same tx. In `setWaiver`, refuse to overwrite a freeze while paid > 0 (already the case) and otherwise delete it first.
9. **Self-dealing on rates and waivers.** `aidat/actions.ts:380-426` and `:428-477` let a board member set their own rate to `Muaf` or waive their own period. `member_dues.updated_by` records it, but the manager sheet doesn't show it, and override rows keep `created_by` without a UI. Fix (cheap): show `Son değişiklik: {Ad} · {tarih}` under the rate in the member sheet. Or refuse `userId === actor.id` with `FORBIDDEN` and let the other manager do it. PO call; noting it because D1 relies on the audit trail being visible.
10. **Unmapped constraint errors in dues actions.** `recordDuesPayment`, `createDuesPeriod` and `bulkCreateDuesPeriods` have no `guarded`/`constraintKind` wrapper, so a CHECK/UNIQUE/FK failure becomes a thrown error (error boundary) instead of `Kaydedilemedi. Alanları kontrol et.` / `Kayıt bulunamadı.`. `deleteDuesPeriod` (`aidat/actions.ts:279`) sniffs `String(cause)` instead of using `constraintKind`. Fix: wrap these tx calls like `actions.ts:105-120`, and use `constraintKind(error) === "fk"` at :279.
11. **Waiver reason not stripped of control characters.** `aidat/actions.ts:439-444` lacks the `clean` transform that every other text field gets. It goes to the CSV and the manager list. Fix: use `text(200)` semantics plus `.min(3)`, or `.transform(clean)`.
12. **Flash cookie hardening.** `src/lib/flash.ts:7-23`. The cookie isn't httpOnly because the client clears it, and it is rendered as toast text, so there is no XSS. But anything that can set a cookie on the host can make the portal toast arbitrary text. In dev that includes the work containers on `127.0.0.1:8000`, because cookies ignore the port. Fix: store a key (`"corrected"`) and map it to copy in `readFlash`, or cap it to the known messages; set `secure` in production.
13. **Period/bulk dates unbounded.** `aidat/actions.ts:139-141` and `:305-306` accept years like `0001` or `9999`. This is harmless but pollutes `currentPeriodOf`. Fix: refine `startsOn`/`fromMonth` to within ±5 years of today.

## Verified OK (no action)
- **Authorization (D1).**
  - All 13 `page.tsx` under `/finans` call `requireManager()` first.
  - All 21 exported actions start with `assertManager()`.
  - Both route handlers start with `managerOrError()` (probe: 403/307).
  - Every export in `queries.ts` except `myDues`/`getPaymentInfo` calls `requireManager()`. `kasaSummary` delegates and is only rendered under `manager &&` (`(portal)/page.tsx:181`).
- **Member data exposure.**
  - `myDues()` (`queries.ts:679-745`) takes no id. It selects overrides without `reason`, payments only for `user.id`, and no `note`/`createdBy`.
  - Home and `/profil` pass only `status`, names of own periods and payment info to client components.
- **IDOR.** Manager actions validate targets:
  - role `member`/`board` for payments and rates.
  - `owesPeriod`/paid for roster and waivers.
  - concert type and not cancelled for event links.
  - existence of sponsor and event inside the tx.
  - ids pass `z.uuid()`.
- **D2 parser** (`money.ts:11-27`) matches every AC4 case, including `150.5`, `1.25`, `1.250`, `1.250.000`, and the rejections `1,250.50`, `12,345`, `12.3456`, `1.250.5`, `007`, a lone `.`/`,`, and signs. It is integer-only, with no `parseFloat`.
- **D7.** A dues correction takes member, period, group and event from the old row, never from input (`actions.ts:200-222`). The overpayment guard runs after the void inside the same tx. Openings are refused. `dues` is excluded from `entrySchema`, so a non-dues entry can't become `Aidat`.
- **Idempotency.** The `createEntry`/`correctEntry` client id is regenerated on `Kaydet ve yenisini ekle` (`entry-form.tsx:105`). The payment form gets a new `clientId` per sheet mount.
- **Race safety.** libsql `transaction()` defaults to `BEGIN IMMEDIATE` (`@libsql/core` `transactionModeToBegin("write")`), so every read-check-write is serialised (probes above). Void is a single guarded `UPDATE`.
- **D12.** The opening is replaced via void + insert in one tx, and the partial unique index backs it. Dates before the opening are refused for generic entries and corrections; the dues payment gap is finding 1.
- **D13 CSV.**
  - The header matches exactly.
  - Gelir, Gider and Virman/Açılış each go in their own column.
  - Voided rows are excluded.
  - `csvCell` prefixes `= + - @ \t \r`, and all text cells (including user names) go through it. Text fields are trimmed and C0-stripped before storage.
  - Responses carry BOM, `;`, CRLF, `attachment`, `no-store` and `nosniff`. Filenames are built from validated dates or an ASCII slug.
  - The dues CSV has no `note` or reason.
- **Redirects.**
  - `safeReturn` (`schemas.ts:143-147`) allows only `/finans` paths with `[\w/-]` and a restricted query: no `//host`, `\`, `:` or `.` in the path.
  - `router.push` only receives server-validated or fixed paths.
  - `?geri` in `yeni/page.tsx:39` goes through `safeReturn`.
- **Document links.** `parseLink` allows only `https:`, length ≤ 2000, and a charset check, so a `javascript:` href is impossible.
- **Timezone.**
  - Business days come from `istanbulDateOf(now())`, evaluated per request (`entryDayField` refine).
  - Membership instants are converted with `istanbulDateOf` before comparing them with periods.
  - Concert to event date uses `istanbulDateOf(startsAt)` (`etkinlikler/page.tsx:25`).
  - Month names use UTC on plain dates, and month keys are string slices.
- **Cookies.** `arkhe_fin_hesap` is httpOnly, Lax and scoped to `/finans`, and is whitelisted on read (`yeni/page.tsx:113`).
