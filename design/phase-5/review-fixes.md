# Phase 5 review fixes (tech lead)

All four reviews are in (`review-ux.md`, `review-ui.md`, `review-db.md`, `review-backend.md`). Reviewer P1s: 2 (ui). Every P1 and P2 is fixed. After the fixes: `npm run e2e` **440/440** (Phase 5: 118, including two new regression checks), lint and typecheck clean.

## P1 (ui)
1. **Waiver save looped** (new object passed to the toast hook on every render → toast + refresh forever). `useToastOnSuccess(state, toastErrors)` now gets `state` itself; e2e asserts at most 4 refreshes after `Muaf tut`.
2. **Echo could show the wrong amount** after the payment period changed. `AmountInput` uses the server echo only while the value is still the first-render value; e2e asserts `Kaydedilecek: ₺300,00` after picking the other period.

## P2
| From | Finding | Fix |
|---|---|---|
| backend 1, db 1 | Dues payments ignored the opening date (D12) | `openingDate()` moved to `src/lib/finance/ledger.ts`; `recordDuesPayment` checks it in the transaction (`Tarih açılış bakiyesinden önce olamaz.`) |
| backend 2 | Multi-period payment booked what was owed at save time | Form posts `expected` (the total shown); the transaction refuses a mismatch with `Borç bu arada değişti. Sayfayı yenileyip tekrar dene.` |
| db 2 | Second concurrent writer got `SQLITE_BUSY` and the error page | `src/db/write-tx.ts` `writeTx()` retries the whole transaction up to 6 times with async back-off; every finance transaction uses it |
| db 3 | Freeze outlived its voided payments (D3) | `owedFor(rate, period, override, paid)` ignores a freeze when paid is 0 |
| ui 1 | Report table clipped between 768 and ~1100 px | Table from `lg`, cards below |
| ui 2 | Virman cells read as Gelir/Gider and turned green | Muted, `sr-only` "Virman", signed text |
| ui 3 | Void reason error dropped focus | Textarea is focused after the error |
| ui 4 | `+ Yeni sponsor` / `Ekle` dropped focus | New-sponsor input autofocuses; the select is focused after adding |
| ui 5 | Flash toast twice in Strict Mode | `toast.success(message, { id: "flash" })` |
| ui 6 | Payment errors not linked to fields | Period fieldset / date input `aria-describedby`; multi-mode amount error is `role="alert"` |
| ui 7 | Focus lost after closing the payment sheet | Focus returns to the member's name link |
| ui 8 | CSV range error didn't move focus | `Bitiş` is focused |
| ux 1 | Sheet still said `kalan ₺300,00` after paying | Description shows the name only in the success state |
| ux 2 | `Sonraki borçlu` paid an older period silently | Success line and toast name the periods (`… · ₺300,00 (Eylül 2026).`); rows that owe an older period show `{Eylül 2026} borcu var` |
| ux 3 | Active ledger filter off-screen at 375 px | `Filtre: Belgesiz giderler` line, active chip scrolled into view, `Bu ay iptal edilen kayıt yok.` |
| ux 4 | Sticky submit bar took a third of the phone | One row: `Kaydet` + outline `+ Yeni` (accessible name `Kaydet ve yenisini ekle`) |
| ux 5 | No `Belge ekle` on the detail page | Button opens Düzenle with focus in `Belge` |
| ux 6 | Member sheet had no `Ödeme al` | Inline `Ödeme al` under `Kalan borç` |
| ux 7 | `Ekim 2026: bu dönem muaf` read as already exempt | `Ekim 2026 için muafiyet` |

## P3 done now
- `updateEntryMeta` refuses opening entries (backend, db P3-4).
- CSV range limit is real days (backend).
- e2e debtor count comes from `financeExpected().currentDebtors` (db P3-5).
- Phase 4 carry-forward P2s: matrix header `min-h-11`; catch-all toast in `useRunAction`; marking a submission requires current eligibility.

## P3 carried to Phase 6
See each `review-*.md`. Main ones: replay id without member; self-waiver audit visibility; `substr` month filters vs a range on the index; `payment_group_id` index; un-voidable freeze cleanup; wrapping single-statement writes in `writeTx`; Düzenle/Düzelt naming; check icon on selected chips; desktop max width; dues rows titled by member name.
