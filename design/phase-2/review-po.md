# Phase 2 PO acceptance review

Author: arkhe-po. Date: 2026-10-18. Yardstick: `po-decisions.md` §3 (AC 1–33).

Evidence used:
- `e2e-results.txt`: 108/108 pass.
- `npm run typecheck` and `npm run lint`: re-run by me, both clean.
- The four team reviews, and that the tech lead fixed their P1s. I confirmed these fixes in the code:
  - backend P1-1: `TRUST_PROXY_HEADERS`, plus the e2e "32 failed logins don't block the conductor";
  - UI P1-1: tablet overlap, with an e2e check;
  - UI P1-2: `CodePanel` owns the timer;
  - UI P1-3: `.catch` with `Bağlantı yok…` copy, and `(portal)/error.tsx`;
  - UX P1-2: the code-only view fits, with an e2e check;
  - UX P1-3: names readable at 375 px, with an e2e check.
- A spot-check in the running app on the freshly seeded DB, as `sef@` and `korist@`, plus a code read where e2e doesn't assert the AC directly.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| 1 | Met | e2e "AC1 member sees a new rehearsal in the calendar" |
| 2 | Met | e2e AC2 ×3 (`5 çalışma`, `5 çalışmayı ekle`, 5 rows) |
| 3 | Met | e2e AC3 ×2 (no actions while cancelled; un-cancel restores the excuse) |
| 4 | Met | e2e "AC4 Seriyi bitir deletes later occurrences, including excused ones" |
| 5 | Met | e2e AC5 ×2 |
| 6 | Met | e2e AC6: redirects, poll/CSV/mark 403. The create, close and bulk actions aren't called directly in e2e. Code read: every manager action in `calismalar/actions.ts` (create, update, cancel, endSeries, open, close, bulk, undo, createTerm) returns `Bu işlem için yetkin yok.` before writing. |
| 7 | Met | e2e AC7 ×4, incl. the code-only view without names and the code changing |
| 8 | Met | e2e AC8 ×3. The UI review measured 4.4 s. |
| 9 | Met | e2e AC9 ×2. The exact copy is awaited in the test. |
| 10 | Met (code) | No e2e assertion. `code.ts` `verifyCode` accepts only `step` and `step − 1`, so a code two steps old fails. Carry forward: an e2e test (P2 below). |
| 11 | Met | e2e AC11 ×3 |
| 12 | Met | e2e AC12 ×2 |
| 13 | Met | e2e AC13 ×2 |
| 14 | Met | e2e AC14 ×2 |
| 15 | Met | e2e AC15 ×2 |
| 16 | Met | e2e AC16. The "not shown after start" half is covered by D-rules and the backend review, not asserted. |
| 17 | Met | e2e "AC17 excuse reasons never reach the CSV". The poll route returns 403 to members (AC6). Backend and DBA reviews: `rosterOf(includeNotes)` is false on every member path. |
| 18 | Met | e2e AC18 ×6 |
| 19 | Met | e2e AC19 ×3 |
| 20 | Met | e2e AC20 ×2 |
| 21 | Met | e2e AC21 ×3 |
| 22 | Met | e2e AC22 ×2 |
| 23 | Met | e2e AC23 ×2 |
| 24 | Met | e2e AC24 ×3 |
| 25 | Met | e2e part tiles. Spot-check on `/raporlar`: every row matches the seed's documented numbers. Barış 4/6 %67 Uyarı; Ceren 4/4 %100 with 2 mazeretli; Demo Korist 6/6 with 1 late; Kaan and Selin 5/6 %83; everyone else 6/6. |
| 26 | Met | e2e AC26 ×3. Spot-check: the warning card lists only Barış Güneş. |
| 27 | Met | e2e AC27 ×3 |
| 28 | Met | e2e AC28 ×3 |
| 29 | Met | e2e AC29 (%78 vs %78 on test data). Spot-check: `korist@` sees `%100 · 6/6 çalışma · 1 geç…` under Geçmiş, with no "uyarı". The flagged copy (`calismalar/page.tsx`) is `bg-accent`: "Son çalışmaların bazılarına gelemedin. Bir sorun varsa şefinle konuşmaktan çekinme." |
| 30 | Met | e2e AC30 ×2 |
| 31 | Met | e2e AC31 ×2. Phase 1 tests cover that `sef@` can. |
| 32 | **Not met (one clause)** | No horizontal scroll at 375 px in light and dark: met (e2e AC32 ×10, plus the 1024×768 layout regression checks). **Code font ≥ 96 px at 1024×768: not met.** In `src/components/attendance/live-screen.tsx` the code is `text-[clamp(72px,9vw,140px)]`, and 9vw at 1024 px is **92 px**. The overlap fix shrank it below the floor, and no e2e asserts the size. |
| 33 | Met | e2e 108/108. I re-ran typecheck and lint: both clean. |

## Verdict: MUST-FIX

Only one item. Everything else is accepted as is. When it lands with its e2e check green, Phase 2 is **ACCEPTED** with no further review round. The tech lead may record the acceptance in `STATUS.md` and start Phase 3.

1. **Live code too small on the target tablet (AC32).**
   - **File:** `src/components/attendance/live-screen.tsx`, the `live-code` class for the non-code-only view.
   - **Expected:** at 1024×768 the computed font size of `[data-testid=live-code]` is ≥ 96 px, and the existing "code panel doesn't overlap the roster" check still passes.
   - **Suggested fix:** `text-[clamp(96px,9.5vw,140px)]`. Four tabular digits at 96 px fit the 40% column with `p-6`.
   - **Test:** add a check next to the tablet regression in `e2e/phase2-attendance.mjs` that reads `getComputedStyle(...).fontSize` and asserts it is ≥ 96 at 1024×768.
   - No copy change.

## Carry forward (not blocking)

P2:
- An e2e test for AC10: previous step accepted, two steps old rejected. Compute codes from the seeded secret in the test.
- A late poll can briefly undo a fresh mark (UI P2-4).
- Ticked sectional parts are lost after a form error (UI P2-7).
- Undoing a bulk mark after close, and editing type/parts after close, can leave people uncounted (backend P3-5/P3-6). Fix with Phase 3 schema work.
- DBA P2-1: freeze reports to closing-time rows, so a change of voice part doesn't rewrite history. Choirs move singers between parts, so do this before real data.
- DBA P1-A: the go-live gate. `db:backup` / `db:check` exist now; run them before the first Turso migration.

P3:
- Overnight concerts (backend P3-7) and date range validation (P3-8).
- The conductor can self check-in (P3-10).
- QR landing polish and the login hint `Yoklamaya katılmak için önce giriş yap.` (UX P2-8/9).
- Never-opened banner (UX P2-11).
- Phone stage strip on the live screen (UX P2-6).
- Mobile logo legibility (UX P3-18).

Cut, as already decided: the wake-lock indicator.

## Must-fix follow-up (tech lead, 2026-10-18)
- `live-screen.tsx`: code size is now `clamp(96px,9.5vw,140px)`; at 1024×768 it measures 97.28 px.
- `e2e/phase2-attendance.mjs`: added the font-size check next to the tablet overlap check. Both pass (`npm run e2e -- phase2`: 91/91).
- Per the verdict above, Phase 2 is **ACCEPTED**.
