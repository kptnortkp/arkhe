# Status (tech lead)

Updated: 2026-10-19.

## Done
- Phase 0–1: scaffold, brand refresh (vector ARKHE logo, Jost, navy-violet), auth, members, profile. Team review done, P1s fixed.
- Phase 2: rehearsals + attendance (rotating code/QR, live screen, manual marks, excuses, reports, CSV, terms).
  Team review done (`design/phase-2/review-*.md`); all P1s fixed plus most P2s. `npm run e2e`: 108/108 (`design/phase-2/e2e-results.txt`).
- DB: drizzle migrations `0000_baseline`, `0001_phase2_review`; `db:migrate` = backup → migrate → FK check; `db:reset` is local-only.

- Phase 2: **ACCEPTED** by PO (`design/phase-2/review-po.md`) after the live-code size must-fix.
- Phase 3: repertoire + Drive links (`/repertuvar`, detail with part filter and lazy previews, editor with bulk paste, programme). Migrations `0002_phase3_repertoire`, `0003_phase3_label_length`. Team review done, all P1/P2 fixed (`design/phase-3/review-fixes.md`). `npm run e2e`: 210/210. **ACCEPTED** by PO (`design/phase-3/review-po.md`).
- Phase 4: recording homework (`/odevler`). Migration `0004_phase4_homework`. **ACCEPTED** (`design/phase-4/review-po.md`); its carry-forward P2s fixed during Phase 5.
- Phase 5: finance (`/finans`: ledger, dues, events, sponsors, report, CSV, member Aidatım). Migration `0005_phase5_finance`. Team review: 2 P1 + 20 P2, all fixed (`design/phase-5/review-fixes.md`). `npm run e2e`: **440/440**. **ACCEPTED** (`design/phase-5/review-po.md`).
- Presentation of Phases 0–5 (Artifact slides, 18 slides) done on 2026-10-18 before Phase 6, at the user's request.

- Phase 6 (final): real ARKHE logo drawn from `brand/images.jpeg` (lockup/wordmark/monogram, IoU 0.951), generated icons, installable PWA (manifest, hand-written `sw.js`, Turkish offline page, `Telefonuna ekle` card), security pass (nonce CSP, headers, `__Host-` cookies, flash keys, demo accounts refused in production, fixture guards, fail-fast env, input hygiene, `/api/saglik`), `Son değişiklik` audit line, Phase 5 finance carry-forward, restorable `db:backup`/`db:check`, README deploy checklist (Vercel Hobby + Turso, Render fallback). Migration `0006_phase6_payment_group`. Team review: 0 P1, 12 P2, all fixed. `npm run e2e` **521/521**, `npm run e2e:prod` **28/28**, lint/typecheck/build clean. **ACCEPTED as deploy-ready** (`design/phase-6/review-po.md`). AC 26 (per-email-only login limit without a trusted IP) and AC 3 (sidebar wordmark at 1× DPR) amended there; `Tekrar dene` stays `/`.

## Next steps (in order)
1. **AC 43: final presentation** of Phases 0–6 (extend the 18-slide deck; Turkish, real logo, stage colours, staff motif).
2. **Go-live is the user's**, following the preconditions in `design/phase-6/review-po.md`: personal git identity and private repo, re-read Vercel Hobby/Turso terms (Render fallback), board consent for `stage-choir.webp`, README checklist 1–9, restore drill, real-phone checklist, demo refusal check, staged rollout (şef + board first), and updating the Fraunces → Jost font rule in `CLAUDE.md` (D40).
3. **Post-launch backlog:** the single consolidated list is "Deferred backlog" in `design/phase-6/review-po.md` (it includes everything still open from Phases 2–5 below). Don't start it until the choir has used the portal for about a month.

## Open review items from Phases 2–3 (post-launch backlog; consolidated in phase-6/review-po.md)
- UI: a late poll can briefly undo a fresh mark; ticked sectional parts are lost after a form error; no wake-lock indicator (cut by PO).
- Backend P3: undoing a bulk mark after close, and editing the type after close, can leave people uncounted.
- DBA: piece_files CHECKs (folded into Phase 3 schema work).

## How to run
- Stop the dev server, run `npm run db:reset`, then start it again with `npm run dev` (127.0.0.1:3100).
- Demo password `arkhe-demo-2026`: sef@, yk@ and korist@arkhe.local.

## Phase 3 carry-forward (from `design/phase-3/review-po.md`)
- Done since: `?partisyon=` guarded with `Object.hasOwn`.
- P2: map CHECK/FK errors in `addLink`/`updateLink`/`saveBulkLinks` to a form error; Phase 4 must add the assignments FK + `deletePiece` message.
- P2 (from Phase 2): freeze reports at close (still open). `db:backup`/`db:check` before the first Turso migration: done in Phase 6 (README step 2).
- P3: active list chip scroll-into-view; detail row line 2 repeats the part; bulk folder count in the save label; filter chip vs primary button weight; desktop list width; double empty message; `/duzenle` back link; home row height; drop extra `router.refresh()`; `cache()` around `getPiece`; bulk mobile focus parity; kind select width; misc backend/DB notes (see review-po.md).
- Manual: real-phone Drive PDF + YouTube preview is now in the README post-deploy checklist.

## Final presentation (AC 43)
- Done 2026-10-19: `~/Desktop/arkhe-sunum-final/index.html` (22 slides), PDF `~/Desktop/Arkhe-Portal-Surec-Sunumu.pdf`.
