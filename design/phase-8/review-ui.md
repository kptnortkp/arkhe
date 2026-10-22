# Phase 8 review: UI engineering

Author: arkhe-ui-engineer (fresh-eyes reviewer). Date: 2026-10-21. Read-only on `src/` and `e2e/`.

Reads: `po-spec.md`, `po-decisions.md`, `implementation-notes.md`, `e2e-results.txt` (900/900). Code: `src/components/board/*`, `src/components/budget/*`, `src/app/(portal)/yonetim/**`, `src/app/(portal)/finans/butce/**`, `src/components/shell/*`, `src/app/(portal)/layout.tsx`, `src/app/(portal)/page.tsx`, `finance-nav.tsx`, `src/lib/board/queries.ts`. Tests: `e2e/board.mjs`, `e2e/phase8-{a,b,c}-*.mjs`, the `prod.mjs`/`lib.mjs`/`phase5-finance.mjs` diffs.

## Screens checked

Logged in as sef@ against the dev server (127.0.0.1:3100). Pages checked at 390 px (2x, touch) and 1280 px, in light and dark, plus `/yonetim` at 1024 px: `/`, `/yonetim`, `/yonetim?sutun=takildi`, `/yonetim/1`, `/yonetim/1/duzenle`, `/yonetim/yeni`, `/yonetim/arsiv`, `/finans/butce`, both seeded reports, the editor, `/finans/butce/yeni`, `…/bilgiler`. Screenshots are in the scratchpad (`p8review-ui/shots/`).

- **Overflow:** `scrollWidth − clientWidth = 0` on every page, in both themes and at both widths. No console errors.
- **Visual check:**
  - Tokens are applied correctly in both themes: the urgency chips, the signal chips (icon and label), the gold `Şu anki` chip in dark mode, and the bars with the elapsed marker.
  - At 1024 px the board uses the tabs (D21) and the card reads well.
  - At xl the icon-only `Taşı` has its `aria-label`.
- **Keyboard (my own run):**
  - On a card: `Taşı` → Enter → ArrowDown → Enter moves the ticket. Focus lands on the next card's link (`#4 …`) and the toast has `Göster`.
  - On the detail page, one ArrowDown on `Durum:` doesn't move the ticket. The menu offers the other three columns.
  - After a move from the detail page, focus is lost (P2-1 below).
- `npm run lint` and `npm run typecheck` are clean. `prettier --check` flags one file (P3-9).

## The `%69` vs `%91` discrepancy: `%69` is correct for the e2e fixture

`e2e/board.mjs:315-341` (`arrangePast`) dates the two expenses `festival_fee 950` on **2020-05-05** and `other_expense 50` on **2020-03-03**. Both fall after M = 2020-02, so they don't count in the February email:

- Expense actuals up to 2020-02-29: travel 1300 + scores 800 + organisation 1000 = **3100**, against a plan of 500 + 4 × 1000 = **4500**. 3100 / 4500 = 68.9 → **%69**.
- Income actuals: donation 1000 (the 2020-08-31 entry is excluded) + grant 400 (the leap day) + other 300 = **1700** of 2000 → **%85**.

Both match `phase8-c-email.mjs:18-32`.

The backend's `%91` comes from its own scratch fixture (`scratchpad/be8/verify.mjs:292,295`), which dates both expenses **2019-10-15**, before M. That makes 4100 / 4500 = %91. Both numbers are right for their own fixtures, and the code is correct.

The e2e fixture is the stronger test, because it also proves that expenses after M are cut. **Doc fix (P3-10):** `implementation-notes.md` §Backend → Verification → Email states `%91` as if it came from the shared fixture. Add "(scratch fixture: both expenses dated 2019-10-15)".

## Findings

### P1

None. Authorization is on the server everywhere I looked:

- Every loader calls `requireManager()`.
- `boardSummary` uses `assertManager()`, and the layout never passes a user id.
- The CSV route calls `managerOrError()`.
- `generateMetadata` only echoes the param or goes through the guarded `budgetReport`.

The client/server split is clean. Client components import only actions and isomorphic modules (`labels`, `rules`, `budget`, `money`).

### P2

**P2-1. Focus is lost after a move from the detail page.**
- Where: `src/components/board/move-menu.tsx:100` (`disabled={pending}`) and `:91` (focus is only handled for `variant === "card"`).
- Scenario: on `/yonetim/1`, a keyboard user opens `Durum: Yapılacak`, picks `Takıldı` and presses Enter. The menu returns focus to the trigger, which is then disabled while the action runs, so focus falls to `<body>`. I measured `document.activeElement` as `BODY` after the refresh. A screen-reader user has to start again from the top.
- The card variant shows the same blur while pending, but it recovers because it focuses `next` explicitly.
- Fix:
  - Keep the trigger focusable while pending (`aria-disabled` + `focusableWhenDisabled`, as `ConfirmDialog` already does) and ignore opens while `pending`.
  - Or call `triggerRef.current?.focus()` after the result when `variant === "detail"`.

**P2-2. The e2e never tests the rate limits of AC 10 and AC 19 (amended D28).**
- Where: `e2e/phase8-a-board.mjs`. There is no occurrence of `Çok fazla deneme` in any `phase8-*` file.
- Scenario: both limits are part of the ACs. They were checked only in the backend's scratch script, so a regression would pass `npm run e2e`.
- Fix: add one section that runs after a `reset()`:
  - Insert 30 `board-create:<ykId>` rows (the key format at `yonetim/actions.ts:80`) into `login_attempts`. Then post one valid create through `callForm` and expect the message, with the row count unchanged.
  - Post one invalid create and expect the validation message, which proves that validation failures don't count.
  - Do the same with 60 `board-comment:<ykId>` rows (`actions.ts:299`).
  - Clear the keys with the existing `delete from login_attempts where key like 'board-%'`.

**P2-3. AC 15's focus assertion is nearly vacuous.**
- Where: `e2e/phase8-a-board.mjs:1015-1018`.
- Scenario: it only asserts that `activeElement !== document.body`. It doesn't check where focus went, it doesn't cover the detail variant, and it would pass with focus on any leftover element.
- Fix:
  - Assert that the focused element is the title link of the neighbouring card, or the source column's `h2` (`#sutun-yapilacak`).
  - Add the same assertion after the detail-page move in `moves()` (`:1036-1057`). It catches P2-1.

### P3

**P3-1. Budget 404s are soft: they return HTTP 200.**
- Where: `src/app/(portal)/finans/butce/loading.tsx` (new), together with the pre-existing `src/app/(portal)/finans/loading.tsx`.
- Measured: `/finans/butce/abc`, `/finans/butce/<unknown uuid>`, `…/abc/duzenle` and `…/abc/bilgiler` answer **200** with the not-found UI and `noindex`. `/yonetim/9999` answers 404, because the board moved its loading into `(pano)`.
- AC 24 doesn't demand a 404 status, so this is a consistency issue.
- Fix: move the budget skeleton into a `butce/(liste)/` route group, as the board did. The parent `finans/loading.tsx` still wraps `[id]`, so a real 404 also needs that loading moved into a group. That touches Phase 5 pages, so leave it for later.

**P3-2. The selected column drifts from the URL after a tab switch followed by a same-route navigation.**
- Where: `src/components/board/board-controls.tsx:76-82`.
- Scenario, measured at 390 px:
  1. Open `/yonetim?sutun=yapilacak`.
  2. Tap `Takıldı` (this calls `replaceState`).
  3. Tap the bottom-bar `Yönetim` (`/yonetim`, no `sutun`).
- Result: the server sends `column = todo`, but `seen` is still `todo`, so `selected` stays `blocked`. The page shows Takıldı while the URL says the default.
- Fix: also call `setSeen(s)` in the tab `onClick`. Then any later server `column` that differs from the tab the user picked resets `selected`. Alternatively, key `BoardControls` on the search-params string in the page.

**P3-3. Focus after moving the last card goes to an invisible heading.**
- Where: `src/components/board/move-menu.tsx:71-74` and `board-column.tsx:44` (`max-xl:sr-only`).
- Scenario: below xl, moving the only card of a column focuses the sr-only `h2`, so a sighted keyboard user sees no focus.
- Fix: below xl, focus the active tab link in `nav[aria-label=Sütunlar]` instead (`document.querySelector('nav[aria-label="Sütunlar"] a[aria-current]')`), or make the heading visible on focus (`focus:not-sr-only`).

**P3-4. The report query runs twice per report request.**
- Where: `src/app/(portal)/finans/butce/[id]/page.tsx:13-16`.
- Scenario: `generateMetadata` and the page both call `budgetReport(id)`, and that function isn't `cache()`d (`src/lib/finance/queries.ts:727`). That doubles the actuals, plan and history queries: 115 ms today with 5000 entries.
- Fix: wrap `budgetReport` in `cache()`, as `boardSummary` already is. The layout badge itself is fine: one indexed query for managers, none for members, and shared with the home card.

**P3-5. Plan editor: the revise dialog can show invalid inputs as `₺0,00`.**
- Where: `src/components/budget/plan-editor.tsx:142, 171-177, 316-320`.
- Scenario: on an approved budget, type `abc` in a line and press Kaydet. `kurusOf('abc')` is 0, so the dialog lists `Aidat: ₺90.000,00 → ₺0,00` and asks for a reason. Only then does the server return the field error and close the dialog.
- Fix: in `save()`, run `parsePlanAmount` over all values first. If any fails, set the field errors locally and focus the first invalid input before opening the dialog.

**P3-6. Plan editor: the revise dialog focuses `Vazgeç`, not the required reason field.**
- Where: `plan-editor.tsx:306-349` with `confirm-dialog.tsx:57`.
- Fix: pass an `initialFocus` prop through `ConfirmDialog` and point it at `#reason`. The reason field is the only thing to do in that dialog.

**P3-7. Plan editor: a thrown prefill is unhandled.**
- Where: `plan-editor.tsx:181-192`. `await prefillPlan(budgetId)` has no try/catch, unlike `post()`.
- Fix: wrap it the same way and show the toast `Bir şeyler ters gitti, tekrar dene.`.

**P3-8. Targets and names on the home card and in comments.**
- The home summary link is about 36 px tall (`home-card.tsx:34`, `block py-1 text-lg`). Use `py-2` or `min-h-11`. The home page isn't in the AC 42 page list, but it's the managers' most-tapped card.
- Every comment's delete button is named just `Sil` (`ticket-client.tsx:105-111`). With several own comments, a screen-reader list shows identical buttons. Use `aria-label={`${author} yorumunu sil, ${time}`}`, or a visually hidden suffix.

**P3-9. Formatting.**
- `plan-editor.tsx:143` has a double blank line, which `prettier --check` flags.

**P3-10. Docs.**
- The `%91` note in `implementation-notes.md` (see above).

**P3-11. Some test checks are vacuous or weak.**
- **The `=2+3 sezon` checks** (`phase8-b-budget.mjs:984-992`, `phase8-c-email.mjs:108-127`):
  - The budget name never appears in a CSV cell, because the columns are kind/category/numbers and the filename uses the start month. So "no CSV cell starts a formula" can't fail.
  - The body check only proves that the line starts with `Bütçe (`, which holds in plain-text email anyway.
  - Fix: keep the checks, but relabel them honestly ("the name is not written into the CSV"). Or, if the name should go into the CSV later, assert the `'=` prefix.
- **The board badge check** (`phase8-a-board.mjs:43`): `badge()` reads `[data-board-badge]` with `.first()`. On the phone that's the hidden sidebar copy, so AC 22's "mobile `Yönetim` tab shows the badge" is never asserted. Scope it to `nav.fixed [data-board-badge]` in the phone contexts.
- **`TODAY` is fixed at module load** (`phase8-b-budget.mjs:28`) and then compared with server-rendered dates: the CSV filename (`:835`), `itibarıyla` and `%p` (`:906-916`). A run that crosses Istanbul midnight fails. Recompute `istanbulDate()` right before each assertion, or retry once.
- **The hex grep** (`phase8-a-board.mjs:1505-1513`) only matches `#rgb…`. Raw `oklch(`/`rgb(` in a className would pass. This is minor; consider extending the pattern.

## What is good

- **Column nav:** `nav[aria-label="Sütunlar"]` of links with `aria-current`, accessible names `<Sütun>, <n> iş`, and real `section`s labelled by `h2` at xl. Hidden columns are `display:none`, so they're out of the accessibility tree.
- **Cards:** the stretched link with `has-[a:focus-visible]` ring, `Taşı` above it with no nested interactive elements, and a `Yeni` that is spoken (`, yeni`) and not colour-only.
- **Moves:** the `Durum` menu is a menu button, not a select, so arrow keys can't save on change.
- **Thread:** `ol` with `data-kind`. System entries are muted with no controls. The comment textarea has a visible label. Errors use `role="alert"`, and the double-submit guard is a ref.
- **Plan editor:** every input has its `Label`, the `₺` is `aria-hidden`, and there's `inputmode="decimal"`. The sticky save bar clears the tab bar. The changed-line marker comes with `önceki ₺…` text, so it isn't gold-only.
- **Report:** bars are decorative (`aria-hidden`). Every number sits in a `dt`/`dd` pair, and every signal has an icon, a label and words, so nothing depends on colour.
- **Badges:** `data-board-badge` is separate from `data-nav-badge` (D31), with the sr text `, <n> yeni iş`.
- **Prod e2e:** checks CSP on the new pages, the member redirect and the CSV 403 on a throwaway DB. The renamed member account is disposable.
