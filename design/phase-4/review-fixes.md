# Phase 4 — review fixes (tech lead)

Date: 2026-10-18. No P1s from any reviewer. `npm run lint`, `npm run typecheck` clean; `npm run e2e` (Phases 1–4) see `e2e-results.txt`.

| Finding | Source | Fix |
|---|---|---|
| P2 subject cut could split an emoji/𝄞 into a lone surrogate → `encodeURIComponent` throws → detail 500 | backend | `homeworkSubject` cuts by code points (`Array.from`); `mailtoHref` returns null on any encoding error. |
| P2 focus lost and undo not announced after `Teslim ettim`/`Geri al` on detail | ui | `SingerSteps` renders one tree for both states, so the toggle never remounts; the status span announces `Teslim edildi` / `Teslim geri alındı`. |
| P2 form errors focused the summary, not the field | ui | `useFocusError` focuses the first invalid input/select/textarea (incl. inside invalid fieldsets) and the alert only as fallback; bar inputs get `aria-invalid`. |
| P2 eligible singer's badge only in step 3; manager saw singer-style `Gecikti`; member saw a badge on a homework not for their part | ux | Detail header badge: own state for singers, `managerBadge` (`Süre doldu`) for managers, none otherwise. |
| P2 matrix showed only 2 columns at 375; `Toplam` stretched on desktop | ux | Name column 6.5rem, table `w-max` (no min-w-full). |
| P2 matrix `Toplam` counted pending cells | ux | Total counts only due or submitted cells; rows kept when any cell applies. |
| P2 `yeni@` saw `hepsi tamam` above optional homework | ux | Summary reads `{n} isteğe bağlı` when nothing is expected. |
| P3 delete of an unknown homework reported success | dba | `delete … returning`; empty → `Ödev bulunamadı.` |
| (P5 planning) `submitWithoutReset` dropped the submitter button | ui | `new FormData(form, submitter)`. |

Also found: review agents had left untitled rehearsals (one open) in the local DB, which hijacked the home hero and broke a Phase 2 check-in test. Removed; reviewers must only create `E2E…` data.
Remaining P3s are carried forward in `design/STATUS.md`.
