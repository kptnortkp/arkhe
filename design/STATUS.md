# Status (tech lead)

Updated: 2026-10-22 (Phases 8b and 9 accepted).

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

- **Live since 2026-10-19** (Vercel Hobby iad1 + Turso free, Stockholm; 37 users). Roadmap of 2026-10-21: Phase 7 data safety, Phase 8 board kanban + budget plan vs actual, Phase 9 audio upload + assistant → conductor → singer review + MIDI.
- Phase 7: data safety. Monthly email (Vercel Cron daily 05:00 UTC, sends while the previous Istanbul month is uncovered) with four CSVs (devam, ödev, finans, aidat) and an AES-256-GCM encrypted gzipped DB dump (scrypt from `BACKUP_PASSPHRASE`); Gmail SMTP via nodemailer 10.1.7 (MIT-0), file outbox outside production. `/yedek` (Yedekleme: Durum, Kurulum, Alıcılar, Şimdi gönder, Geçmiş), conductor-only recipients (1–5) with change notice, home banners, throttles, `db:decrypt`/`db:restore`, README `Aylık yedek e-postası`. Migration `0007_phase7_backup` (`backup_runs`, `app_settings` rebuild with `created_at`). Team review: 0 P1, 13 P2, all fixed (`design/phase-7/review-fixes.md`). `npm run e2e` **657/657**, `npm run e2e:prod` **44/44**, lint/typecheck clean. **ACCEPTED** (`design/phase-7/review-po.md`); AC 7, 8, 19 amended there. **Not yet live:** the user does the go-live steps in `review-po.md` §4 (commit, `db:migrate` on Turso, Gmail App Password, passphrase in two places, Vercel env vars Production-only, push, recipients on `/yedek`, first September email, restore drill = AC 39); record the date here when done.

- Phase 8: Yönetim Kurulu board and budget plan vs actual.
  - **Board** (`/yonetim`): kanban Yapılacak/Devam ediyor/Takıldı/Bitti, tabs below `xl`, `Taşı`/`Durum` menus, urgency, due dates, comments with a 15-minute delete, system entries, the `Yeni` marker + `data-board-badge`, a 30-day archive. The manager bar has `Yönetim` instead of `Üyeler`.
  - **Budget** (`/finans/butce`): 12-month budgets, draft → approved → revisions with a reason, prefill, signals, period progress, CSV, and `arkhe-butce-<M>.csv` in the monthly email.
  - Migration `0008_phase8_board_budget`: 8 tables and 2 triggers on `budgets`, additive.
  - Team review: 1 P1 and all P2s fixed (`design/phase-8/review-fixes.md`; TL1 sets the default start).
  - `npm run e2e` **923/923**, `npm run e2e:prod` **52/52**, lint/typecheck clean.
  - **ACCEPTED** (`design/phase-8/review-po.md`); AC 24, 26, 32 and 34 amended there.
  - **Not yet live:** it ships in one push with Phases 7 and 8b, when the user says so.

- Phase 8b: historical CSV import (`/ice-aktar`, template pack + AI prompts in `docs/ice-aktarma/`, all-or-nothing batches, undo of the latest batch). Migration `0009_phase8b_import`. **ACCEPTED** by the tech lead (`design/phase-8b/review-po.md`).
- Phase 9: in-browser recording and upload, assistant → conductor → singer review, storage quota and retention, MIDI player. Migrations `0010_phase9_media`, `0011_phase9_review`. Local libsql lock leak fixed (`src/db/local-client.mjs`). `npm run e2e` **1437/1437** (twice), `npm run e2e:prod` **63/63**. **ACCEPTED** by the tech lead (`design/phase-9/review-po.md`).
  - **Not yet live:** Phases 7–9 ship in one push when the user says so; `db:migrate` must show 12/12 and a private Blob store must be connected first.

## Next steps (in order)
1. **Go-live of Phases 7 + 8 + 8b (the user's):** `design/phase-7/review-po.md` §4, with the changes in `design/phase-8/review-po.md` §4.
   - One `db:migrate` applies 0007 → 0008 → 0009, and `db:check` must show `migrations=10/10`.
   - Record here the date of the first real email and the restore drill (Phase 7 AC 39).
2. **Phase 8** is accepted (see above).
   - **Phase 8b** (historical data import, `design/phase-8b/`): spec and `po-decisions.md` (D17–D34) done 2026-10-21. Migration `0009` after Phase 8's, not deployed before Phase 7 is live.
   - **Function region:** `vercel.json` pins `arn1` (committed in Phase 7, not pushed). Live still runs in `iad1` until the user pushes Phases 7–8b. The 8b commit must also work under `iad1` (few-round-trip batched path, D30).
3. **Phase 9** (audio recording upload, assistant → conductor → singer review, MIDI): the spec may start. It needs a free storage decision first.
4. **Post-launch backlog:** one list in two parts: `design/phase-7/review-po.md` §5 items 1–16 and `design/phase-8/review-po.md` §5 items 17–27. The first small release is items 1–5, 17 and 18.
5. **One month after go-live:** ask the board whether `Üyeler` is easy to find on the phone and whether jobs moved out of WhatsApp (Phase 8 risks 1–2). Note the answers here.

## Open review items from Phases 2–3 (post-launch backlog; consolidated in phase-7/review-po.md §5)
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
