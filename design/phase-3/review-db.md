# Phase 3 review: database layer (DBA)

Scope: `src/db/schema.ts` (`pieces`, `piece_links`), `drizzle/0002_phase3_repertoire.sql` + `meta/0002_snapshot.json`, `scripts/seed.ts` (repertoire), `src/lib/repertoire.ts`, `src/app/(portal)/repertuvar/actions.ts`, `e2e/lib.mjs` cleanup, measured against `db.md` as amended by `po-decisions.md` D12/D13/D19. Read-only on `data/arkhe.db`; write tests ran on copies in the scratchpad.

**Verdict: one P1 (label length CHECK contradicts D19 and my own db.md), no P2. Everything else matches the plan.**

## What I verified

| Check | Result |
|---|---|
| Migration on a pre-phase-3 DB | Built a DB with 0000+0001 only, inserted 2 pieces (`is_active` 1/0) and 5 `piece_files` (a `midi`, a duplicate URL, an `http://` URL, a `soprano1` voice, a blank label), then ran `drizzle-kit migrate` with the real `drizzle/`. Result: `learning`/`archive` mapped correctly, `midi`→`part`, the duplicate and the `http://` row dropped, `soprano1`→null voice, blank label→null, positions 1..n per piece. `integrity_check` ok, `foreign_key_check` empty. |
| `PRAGMA foreign_keys=OFF` inside the migration | A no-op inside a transaction, but `@libsql/client` `migrate()` turns FKs off before its transaction (sqlite3 client) and passes `disableForeignKeys` on HTTP/Turso. So `DROP TABLE pieces` does not cascade into `piece_files` before the copy (confirmed: rows survived). |
| Snapshot drift | `drizzle-kit generate` against `schema.ts` and a copy of `drizzle/`: "No schema changes". The partial unique index and all CHECKs are in the snapshot. |
| D12 | No unique on `(piece_id, position)`; plain `piece_links_piece_position_idx`. Reorder sends the full id set, set check plus `1..n` writes in one tx. Correct. |
| D13 | Partial unique `pieces_program_position_unique` and `pieces_archive_not_in_program` are live. Append is one guarded `UPDATE … (select max+1)`. Reorder and remove null all positions, then renumber in a tx. Archive (`setPieceStatus`, `updatePiece`) nulls the position in the same UPDATE. Clear is one UPDATE. Correct. |
| Transactions | `db.transaction()` in drizzle/libsql calls `client.transaction()`, which defaults to `"write"` (`BEGIN IMMEDIATE`), so every read-then-write (reorder, bulk dupe check + max position) is serialised. Bulk save is all-or-nothing. |
| Unique-violation mapping | `isUniqueUrlError` matches libSQL's `UNIQUE constraint failed: piece_links.piece_id, piece_links.url` through `cause`. The error is correct for add and update. Bulk can't race because of `BEGIN IMMEDIATE`. |
| N+1 | List: one `pieces` query plus one `piece_links … kind='part' and piece_id in (…)` query. Detail: two queries. No per-row queries. |
| Indexes | `(piece_id, url)` unique and `(piece_id, position)` cover every link lookup. `pieces_status_idx` serves `learningPieces()` on the dashboard. The full-table list read is fine at this size (hundreds of rows). |
| Role leaks | Every write action calls `assertManager()`. `/duzenle` calls `requireManager()`. Members only read pieces and links, which they are meant to see. |
| Live DB | 6 pieces, programme 1/2/3 contiguous, 26 links, max label length 25, no duplicate `(piece_id, position)`. |
| e2e cleanup | Deletes E2E links and then E2E pieces. A gap left in the programme is allowed (D12/D13). |

## P1

### P1-1 Link labels of 81–120 characters crash with a 500
- `src/db/schema.ts:298` (and `drizzle/0002_phase3_repertoire.sql:49`, live DB): `CHECK(label is null or length(trim(label)) between 1 and 80)`.
- `src/lib/links.ts:7` has `LABEL_MAX = 120`, and it is used by `linkSchema.label` (`actions.ts:184`), `bulkRowSchema.label` (`actions.ts:302`) and the paste parser (`links.ts:239,248`). D19 says "label 120 everywhere… matches db CHECKs", and `db.md` §1 specified 120.
- Effect: a label between 81 and 120 characters passes validation, then fails with `CHECK constraint failed: piece_links_label_length`. Neither `addLink`/`updateLink` nor `saveBulkLinks` catches it, so the user gets a generic error page or toast. For a bulk save, the whole paste is lost. Reproduced on the scratch DB with a 100-character label.
- Fix: add a new migration `0003` instead of editing 0002, which is already applied locally. Change the schema CHECK to `between 1 and 120` and run `db:generate`. drizzle-kit rebuilds `piece_links` (`__new_piece_links` + copy + rename). The `substr(label,1,80)` in 0002 can stay as is: it only touched legacy rows. Add an e2e case that saves a 120-character label.

## P2
None.

## P3
- **P3-1** `src/app/(portal)/repertuvar/[id]/page.tsx`: `generateMetadata` and the page each call `getPiece`, so every detail view runs 4 queries. Wrap `getPiece` in React `cache()` in `src/lib/repertoire.ts:109`.
- **P3-2** `scripts/seed.ts:193-205`: pieces and links are inserted one statement at a time, outside a batch. A failure in the middle leaves a partial repertoire, and the `n > 0` guard then skips the rest for good. Put them in one `db.batch([...])` as `db.md` §6 says.
- **P3-3** `actions.ts:435` `removeFromProgram` renumbers without the STALE set check that D13 mentions. It is idempotent and safe, so it is noted for completeness only.
- **P3-4** `drizzle/0002…sql:59`: a legacy divisi voice (e.g. `soprano1`) becomes a Tutti link and loses the divisi information, unless the label already said it. There is no legacy data, so this is moot. If it ever matters, fold it in as `coalesce(label, 'Soprano 1')`.
- **P3-5** `actions.ts:156-159`: `deletePiece` deletes the links by hand before the piece, which duplicates `ON DELETE CASCADE`. This is harmless, and it guards against a connection with FKs off.
