# Phase 4 — implementation notes (tech lead)

- Schema: `assignments`, `assignment_parts`, `submissions`, `app_settings` in `src/db/schema.ts`; migration `drizzle/0004_phase4_homework.sql` (additive, all 14 CHECKs, `piece_id` restrict). Extra index `assignment_parts(voice_part, assignment_id)` for the badge.
- Seed fixture `scripts/homework-fixture.mjs` (`seedHomework`): seeded homework uses fixed **UUID-shaped** ids `00000000-0000-4000-8000-00000000000{a..f}` instead of `seed-hw-*`, because every route validates ids with `z.uuid()`. Called by `scripts/seed.ts` and by e2e `cleanup()`; also upserts `yeni@arkhe.local` and the recording email.
- Pure helpers: `src/lib/homework/{eligibility,deadline,mail}.ts`. Queries: `src/lib/homework/queries.ts` (feedback text only in `mySubmission` and the manager-only `rosterFor`).
- Actions: `src/app/(portal)/odevler/actions.ts`. `deletePiece` now pre-checks homework and maps the FK error as a backstop.
- UI: `src/components/homework/*`, pages under `src/app/(portal)/odevler/`, nav tab + badge (`data-nav-badge` holds the count, the text shows `9+`), home cards, `Ödev ver` in the piece menu, `ÖDEVLER` on the piece page.
- Shared moves (D18): `src/components/{use-run-action.ts,confirm-dialog.tsx,part-dot.tsx}`.
- Found while testing: React 19 resets a `<form action>` after the action, which unticks controlled checkboxes/radios in the DOM while state stays ticked (the next submit sent no parts). `AssignmentForm` and the Phase 3 `LinkForm` now submit via `submitWithoutReset` (`src/components/forms/submit-without-reset.ts`), a transition dispatch with no auto reset.
- e2e: `e2e/phase4-homework.mjs` (AC1–AC23); `actionIds`/`callAction` moved into `e2e/lib.mjs`.
- Manual (not e2e, carried to Phase 6 deploy gate): the mail button on a real iPhone/Android; dark-mode contrast of the solid overdue badge is checked in review.
