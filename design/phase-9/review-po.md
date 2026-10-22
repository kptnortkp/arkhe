# Phase 9 acceptance (tech lead, fast process)

Date: 2026-10-22. **ACCEPTED.**

- Reviews: backend/DB and UX (`review-backend.md`, `review-ux.md`); all P1/P2 fixed (`review-fixes.md`, migration `0011_phase9_review`). TL1: clearing a comment resets `delete_on` to upload + 120 days, not before tomorrow.
- Final full run found a local-only SQLite lock leak in the native libsql driver (a failed or EXPLAIN statement poisoned a pooled connection). Fixed with `src/db/local-client.mjs`, which discards such connections; regression test `e2e/phase9-e-db-lock.mjs`. Turso (remote client) is not affected.
- A real focus bug found while removing flakes (focus restored before the moved row re-rendered) fixed in `src/components/repertoire/use-focus-after.ts`.
- `npm run e2e` 1437/1437 twice in a row, `npm run e2e:prod` 63/63, lint/typecheck clean (`e2e-results.txt`).
- Go-live: one `db:migrate` takes Turso from 7/7 to 12/12; a private Vercel Blob store must be connected (`BLOB_STORE_ID`/`BLOB_READ_WRITE_TOKEN`); audio and MIDI are not in the monthly backup.
- Backlog: `markFeedbackSeen` and `registerLoginAttempt` are plain autocommit writes; they could go through `writeTx` to retry on contention.
