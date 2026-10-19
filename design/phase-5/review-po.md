# Phase 5 PO review: Finans (`/finans`)

Author: arkhe-po. Checked against `po-decisions.md` §3 (AC1–AC26), `implementation-notes.md`, `review-ux.md`, `review-ui.md`, `review-db.md`, `review-backend.md`, `review-fixes.md`, `e2e-results.txt` (440/440, Phases 1–5; Phase 5 = 118 checks), a spot-read of `e2e/phase5-finance.mjs`, and my own read-only pass on the running app at 375 px, light and dark (`yk@`, `korist@`; no data created).

## Verdict: **ACCEPTED**

Phase 5 meets every acceptance criterion. All four reviewers reported their P1s and P2s, and the tech lead fixed every one of them: 2 P1s (ui) and 20 P2s, each with a regression check where that made sense. Authorization holds at every layer. Members get 403 or a redirect on every route, and all 19 finance actions refuse them without changing any rows. Money is integer kuruş. Nothing is ever deleted: wrong entries are voided or corrected with an audit trail. The numbers reconcile: the balances, the report rows, the CSV sums and the dues matrix all match `financeExpected` and the DBA's independent SQL rebuild.

From a treasurer's side, the flows a volunteer actually needs work on a phone:
- Taking dues at rehearsal takes two taps per singer with `Sonraki borçlu`.
- Fixing a typo is `Düzelt`, not a delete.
- The accountant gets one CSV that opens in Excel.
- A singer sees their own dues and the IBAN, and nothing about anyone else.

There are no must-fix items, and nothing here should hold up the presentation.

## AC-by-AC

| AC | Result | Evidence |
|---|---|---|
| 1 Entry points | PASS | e2e AC1 ×5: `Finans` is in the desktop sidebar and not in the tab bar. The home `Kasa` card and the `/profil` rows `Finans` and `Raporlar` work on a phone, and the conductor reaches every sub-route. |
| 2 Özet numbers | PASS | e2e AC2 ×5: balances are 965000 / 2488725 / 3453725 kuruş, formatted like `₺1.234,56`. The month totals, the last 10 entries and the sub-nav chips are all present. I saw the same at 375 px. |
| 3 Gider ekle | PASS | e2e AC3 ×3: the `Kaydedildi.` toast appears, Banka drops by exactly −₺1.250,50 and Kasa doesn't change. The detail page shows `Belgeyi aç` with a Drive preview. |
| 4 Amount parsing | PASS | e2e AC4 ×4. The echo and the server both handle the D2 cases: `1250.50`, `150.5`, `1.250`, `1.250,5`, `0`, empty, `12,345`, `abc`, `1,250.50` and the cap. |
| 5 Form guards | PASS | e2e AC5 ×6: `Sponsor seç.`, the duplicate sponsor (case and diacritics), no `Aidat` in the generic form, `category=dues` refused by the server with nothing saved, a bad URL, and `Tarih çok ileride.` |
| 6 Virman | PASS | e2e AC6 ×2: Kasa −500 and Banka +500 while Toplam and the month totals stay the same. Same source and target is refused. |
| 7 İptal et | PASS | e2e AC7 ×10: reasons that are empty or 3 characters long are refused. Voided entries leave the balance and the list, and appear struck through under `İptal edilenler` together with the seeded catering entry. No delete control exists anywhere. Voiding twice gives `Bu kayıt zaten iptal edilmiş.` |
| 8 Düzelt | PASS | e2e AC8 ×6: leaving the form changes nothing. The links work in both directions, Banka changes by exactly −₺2,25, and a second correction is refused. |
| 9 Düzenle | PASS | e2e AC9 ×4: the sheet has meta fields only. `Son düzenleme` is stamped, and a stale `revision` is refused. |
| 10 Belgesiz | PASS | e2e AC10: the costume and bank-fee entries are listed and the venue entry is not, across `Tüm aylar`. |
| 11 Event P/L | PASS | e2e AC11 ×4: `Kâr ₺4.200,00`. The prefilled `Gider ekle` turns the result into `Zarar −₺800,00` in red, and deleting an event that has entries is refused. |
| 12 Konserden oluştur | PASS | e2e AC12 ×3: `Güz konseri` is listed and `Kış Konseri` is not. The form is prefilled with the Istanbul date, and a concert gets at most one event. |
| 13 Dues list | PASS | e2e AC13 ×5: the `amber`, `muted` and `red` tones are right. Deniz shows his waiver reason in the manager view. `Borçlular` shows 18 rows, a number taken from `financeExpected().currentDebtors`. At 375 px the overdue line `Eylül 2026 borcu var` reads well. |
| 14 Ödeme al, multi-period | PASS | e2e AC14 ×8: `Toplam ₺500,00 (2 dönem)`. Two entries share one payment group, `Aynı ödemede` shows on the detail, Kasa goes up by ₺500, `Sonraki borçlu` gets focus, and replaying the same clientId creates nothing. |
| 15 Overpayment | PASS | e2e AC15 ×2: the message is `Kalan borç ₺300,00; daha fazlası girilemez.`, nothing is saved and Kasa doesn't change. Backend probes also showed that parallel payments and parallel corrections are serialised; after the fix, `writeTx` retries instead of throwing `SQLITE_BUSY`. |
| 16 Rate freeze and waiver | PASS | e2e AC16 ×4: paid periods keep the old rate and the open period moves to ₺150. korist never sees `Oran değişikliği` or the note. A waiver on a paid period is refused. The DBA's P2-3 is fixed: a freeze is ignored once the period's paid amount is 0. |
| 17 Periods | PASS | e2e AC17 ×6: bulk-creating 2 periods works and a rerun creates nothing. Overlapping periods are refused, and so are editing and deleting a period that has payments. |
| 18 Monthly report | PASS | e2e AC18 ×4: Devir and Kapanış chain from month to month, the rows match `financeExpected`, the last row equals Toplam, and the Kasa view's Virman column holds −₺1.500,00. |
| 19 CSV | PASS | e2e AC19 ×8: BOM, the header from D13, no voided rows, the transfer only in `Virman/Açılış`, sums equal to the report (2085000 / 681275), openings included, formula cells prefixed with `'`, and an inline error for an inverted range. The dues CSV contains no notes. |
| 20 Ayarlar | PASS | e2e AC20 ×5: korist sees the updated payment info, an opening dated after existing entries is refused, and a new opening moves `balance-cash` by the difference. |
| 21 Last account | PASS | e2e AC21 ×2 (the account is remembered via the server cookie; Virman defaults to Kasa → Banka). `Ödeme al` defaulting to Kasa is covered by AC14's flow, since the payment is booked to Kasa (+₺500). |
| 22 korist Aidatım | PASS | e2e AC22 ×5. My 375 px pass matches: the section comes first on `/profil`, shows `Kalan borcun ₺500,00`, rows `Ödenmedi` / `Gecikti · ₺200,00 kaldı` (solid red) / `Ödendi` with the owed amounts, the two `Ödemelerim` entries, and `Nasıl ödenir?`. |
| 23 Member isolation | PASS | e2e AC23 ×6: redirects (I confirmed `/finans` sends korist to `/`), 403 from both CSV routes, 307 without a session, 19 actions refused with no rows changed, and no other member's names, notes or balances in korist's HTML. Backend review: no IDOR, open redirect, XSS or formula injection found. |
| 24 Paid-up, exempt and conductor | PASS | e2e AC24 ×4. |
| 25 Phone quality | PASS | e2e AC25 ×3 at 390 px, light and dark, with targets ≥ 44 px. The AC says 375 px and the suite's phone is 390 (as in every earlier phase), so I re-ran the check myself at 375 px, light and dark, on all 11 manager routes plus `/` and `/profil` as yk@ and korist@. There is **no page-level horizontal scroll anywhere**. The UX review confirms `tabular-nums` and that every state is in text. |
| 26 Build health | PASS | `e2e-results.txt` 440/440, and lint and typecheck are clean according to `review-fixes.md`. `drizzle/0005_phase5_finance.sql` has 0 occurrences of `__new_users`. |

## Must-fix

None.

## Carried to Phase 6 (not blockers)

These are P3s from the four reviews that are still open, ordered by how much they matter to the choir:

1. **Self-dealing visibility** (backend P3-9): show `Son değişiklik: {Ad} · {tarih}` under the rate and waiver in the member sheet, so the board can see who exempted whom. I'm not forbidding self-edits, because a two-person board must still be able to work. *PO priority for Phase 6.*
2. **Freeze cleanup on void** (backend P3-8): today this is harmless because a freeze is ignored when paid = 0. Delete the freeze in the void transaction and let `setWaiver` replace it cleanly.
3. **Replay id should include the member** (db P3-1, backend P3-3): `derivedId(clientId, memberId, periodId)`. A UI change shouldn't be able to trip it.
4. **Constraint errors in dues actions** go to the error boundary instead of `Kaydedilemedi. Alanları kontrol et.` (backend P3-10). Wrap the single-statement void and meta edits in `writeTx`.
5. **Fixture safety** (db P3-6): `seedFinance` should refuse `NODE_ENV=production`. **This must land before any production deploy.**
6. **Roster when a payer becomes conductor** (db P3-7); `removeWaiver` returns success when there was nothing to remove (db P3-8).
7. **Input hygiene:** the waiver reason isn't cleaned of control characters, the opening and period dates have no bounds, a zero-spelled opening isn't treated as "none", and the flash cookie should carry a key rather than free text and set `secure` in production (backend P3-5, 6, 11, 12, 13).
8. **Performance at scale:** month filters should use a range instead of `substr`, `payment_group_id` needs a partial index, and `getEntry` should use `Promise.all` (db P3-2, 3, 9).
9. **UX polish:**
   - Title dues rows by the member's name (ux P3-1, cheap; first in line).
   - Show a check icon on selected account and category chips (ux P3-2).
   - Rename `Düzenle`/`Düzelt` to `Not / belge` / `Tutarı düzelt` (ux P3-3).
   - Make the bulk preview read `son ödeme 15 Kas` (ux P3-4).
   - Hide `Nasıl ödenir?` for fully exempt members (ux P3-5).
   - Disable the period trash icon when the period has payments (ux P3-6).
   - Add P/L subtotals (ux P3-7) and a `Net` row on the report phone cards (ux P3-8).
   - Cap the desktop width and show `Ödeme al` as a dialog from `md` (ux P3-9).
   - Change the `Ekle` label on Hareketler (ux P3-10).
10. **UI/a11y polish:**
    - The disabled `Sonraki ay` span triggers an axe `aria-prohibited-attr` finding (ui P3-1).
    - The sticky bar leaves a 6 px gap (ui P3-2).
    - The overdue chip uses raw `text-white` (ui P3-4).
    - Voided rows use `opacity-60` (ui P3-5).
    - The ledger filter should use `next/form` (ui P3-6).
    - Focus is not returned after `Konserden oluştur` (ui P3-7).
    - Sheets skip their close animation (ui P3-8).
    - The `type="month"` input gets no hint in desktop Safari and Firefox (ui P3-9).
    - Use `useFocusError` on the secondary forms (ui P3-10).
11. **Deferred by decision:** the dues table view (D24), a searchable sponsor picker, a member picker on Özet, a treasurer role, un-void, charts, and everything else in `po-decisions` §4.

### Manual checks carried (tech lead, once, on real devices)

- On an iPhone with an English region, typing `150.5` echoes ₺150,50. With a Turkish region, `150,5` also echoes ₺150,50. Check an Android phone too.
- `Muhasebe CSV` and the dues CSV open in Turkish Excel and in LibreOffice with the right columns, `ş/ğ/ı/İ` intact, and amounts summable.
- Seed a negative Toplam once and check the contrast of `text-absent-ink` on the `bg-stage` tile in both themes (ui P3-11).
- Add a 375 px project to the e2e phone context, or document 390 as the reference width. This phase's 375 px check was done by hand.

## Process note

The user asked that Phase 6 not start yet. With this verdict Phase 5 is closed. Next comes the presentation of the whole process (Phases 1–5). The P3s and manual checks above are the agreed starting backlog when Phase 6 is planned.
