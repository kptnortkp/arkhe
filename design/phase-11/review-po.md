# Phase 11 acceptance (tech lead, fast process)

Date: 2026-10-24. Verdict: **ACCEPTED** for go-live, pending the user's commit/push approval and the §9 checklist in `po-spec.md`.

- Reviews: backend/security 0 P1, 2 P2; UI/UX 0 P1, 5 P2. All P2s fixed except UI P2-4 (wake lock only while playing), rejected because the user asked for the screen to stay on while the player is open. P3s handled as listed in `review-fixes.md`.
- Tests: full `npm run e2e` 1746/1746, `npm run e2e:prod` 80/80, lint and typecheck clean (`e2e-results.txt`). The earlier phase10 failures were test bugs around quiet hours after 22:00, fixed in the tests.
- Migration 0014 rehearsed on a seeded copy (triggers, indexes and rows preserved; rolls back as a whole). It must be rehearsed again on a copy of the Turso dump before `db:migrate` on production.
- Not yet proven: the workflow on a real GitHub runner (AC 28) and opening a score PDF from the iPhone home-screen app (risk 7). Both are go-live steps.
- Live hotfixes made during the phase (`a1e11f8`, `00d36bd`, `d98bf69`: iOS screen lock, wake lock, stalled audio context) are already in production and also in this tree.
