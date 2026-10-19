# Phase 5 implementation notes (tech lead)

Built from `po-decisions.md` (D1–D31). Status: `npm run e2e` 437/437 (Phases 1–5, `e2e-results.txt`), lint and typecheck clean.

## Where things are
- Schema: `src/db/schema.ts` (sponsors, events, dues_periods, member_dues, dues_overrides, finance_entries, app_settings key `dues_payment_info`). Migration `drizzle/0005_phase5_finance.sql` (additive, `app_settings` rebuild only; no `__new_users`).
- Pure/isomorphic: `src/lib/money.ts` (parser, formatters), `src/lib/finance/categories.ts`, `src/lib/finance/dues.ts` (owesPeriod, owedFor, duesStatus, allocate, periodNameOf), `src/lib/csv.ts` (shared with the attendance CSV).
- Server: `src/lib/finance/queries.ts` (every manager query calls `requireManager()`; `myDues()` takes no id), `src/lib/finance/ledger.ts` (in-transaction dues position, `derivedId`), `src/lib/finance/schemas.ts` (zod, copy constants), `src/lib/finance/params.ts` (ledger URL params).
- Actions: `src/app/(portal)/finans/actions.ts` (entries, Düzelt, Düzenle, void, openings, payment info, events, sponsors) and `finans/aidat/actions.ts` (payments, periods, bulk, rates, waivers).
- Routes: `/finans` (Özet), `/hareketler`, `/yeni` (`?tur`, `?etkinlik`, `?sponsor`, `?duzelt`, `?geri`), `/[id]`, `/aidat` (`?donem`, `?filtre=borclu`, `?uye`), `/aidat/donemler`, `/etkinlikler(/[id])`, `/sponsorlar(/[id])`, `/rapor` (`?yil`, `?hesap`), `/ayarlar`; CSV handlers `/finans/rapor/csv`, `/finans/aidat/csv`.
- UI: `src/components/finance/*`, `src/components/copy-button.tsx` (extracted from homework), `src/components/flash-toast.tsx` + `src/lib/flash.ts`.
- Seed: `scripts/finance-fixture.mjs` (`seedFinance`, `financeExpected`), wired into `scripts/seed.ts` (early `return` became an `if`) and `e2e/lib.mjs` `cleanup()` (first).
- Tests: `e2e/phase5-finance.mjs` (AC1–AC25).

## Deviations and choices (for reviewers)
- **Flash toast after a server redirect.** `correctEntry` voids the entry whose form page is showing, so revalidation re-rendered that page without the form and the client redirect never ran. The action now sets a 30-second `arkhe_flash` cookie and calls `redirect()`; `(portal)/layout.tsx` renders `FlashToast`, which toasts once and clears the cookie.
- **Void dialog calls the action directly** (not `useActionState`): a successful void unmounts the dialog with the actions, which swallowed the toast.
- **Ledger filter** is a `<details>` disclosure with a plain GET form instead of a Sheet (no client JS, same params). ui §5 asked for a Sheet.
- **Entry form h1** follows `?tur`; switching the kind inside the form keeps the original heading.
- **Same-account transfer** is refused by the server (`Kaynak ve hedef hesap aynı olamaz.`); the UI only auto-flips the target when the *source* changes.
- **Multi-period payment** ticks the two oldest open periods by default (the "3 aylığı birden" case starts from two).
- **Seed** wipes every finance table on each `cleanup()`/seed; corrections are unlinked (`replaces_id = null`) before the delete because of the restrict self-FK.
- Not done (deferred by PO): dues table view (D24), searchable sponsor sheet, member picker on Özet.

## Gotcha found while testing
- Turbopack dev kept a route-handler module compiled while `schema.ts` was mid-edit: both CSV routes returned 500 (`financeEntries` undefined) until the route files were touched. Not a code bug; restart or touch the route if a fresh table export looks undefined in a route handler.
