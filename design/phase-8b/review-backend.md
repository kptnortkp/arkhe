# Phase 8b review: backend, security and database

Reviewer: arkhe-backend (one of two reviewers under the lighter process, so this covers the DBA's ground too). Date: 2026-10-21.
Read: `po-decisions.md`, `po-spec.md`, `implementation-notes.md`, `db.md`, then the code under review (list at the end).
Method: I read the code and tried to break it. Each finding was proven on scratch DB copies with in-process harnesses or with crafted requests against the dev server, unless it says "by reading". I never wrote to `data/arkhe.db` except through the app (two logins), never ran git, and deleted my scratch DB copies afterwards. The harnesses are in `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/rv8b-be/h/`.

**Counts: P1 0 · P2 2 · P3 10.**

Overall, the core holds up. Authorization runs first in all three actions and all three routes. The commit re-plans inside `BEGIN IMMEDIATE`. All-or-nothing holds. The 999-parameter rule is enforced by measuring real statements. Logs carry no personal data. The migration chain applies cleanly to a real pre-Phase-7 backup. Neither P2 is a data-integrity hole: one is an availability problem, the other an undo that dead-ends.

---

## P2

### P2-1. A crafted header makes `Kontrol et` quadratic (minutes of CPU) and blows a 0.85 MB file up into a 20 MB response

- **Where:**
  - `src/lib/import/engine.ts:93-97`: for **every blank header cell**, `data.some(...)` scans **every data row**.
  - `src/lib/import/engine.ts:102`: one `Bilinmeyen sütun …` message per unknown header cell, with no cap, each repeating the full list of valid columns.
  - `src/lib/import/run.ts:56-57`: `fileError` sends those messages twice, once as `messages[]` and once joined into `message`.
  - `src/lib/import/engine.ts:115`: the 5000-row cap is checked only **after** the header loop.
- **Scenario (proven):**
  - Header `ad` followed by N `;`, then R lines `x`. That gives N × R `trim()` calls before any limit applies.
    - In process: 2k × 2k took 24 ms, 8k × 8k 356 ms, 16k × 16k 1534 ms.
    - Over HTTP as sef@: the 16k × 16k file (48 KB) took 1458 ms.
    - The 1 MB optimum (N ≈ 524k, R ≈ 262k) extrapolates to about 800 s of blocked event loop. Locally that stalls every user of the server. On Vercel it burns the full `maxDuration` 60 s and stalls the requests sharing the instance.
  - A header of 150,000 distinct short unknown names (852 KB) produced 150,003 messages. Over HTTP the action answered **20,604,448 bytes**, which a phone then has to parse.
  - Only managers can send this, but one mistaken file (or a compromised board account) is enough. No row-level limit protects against it.
- **Fix** (`engine.ts mapRecords`, before the header loop):
  - Refuse when `header.cells.length > def.columns.length + 20` (or simply > 64). Use a whole-file message, e.g. `Başlıkta çok fazla sütun var; ilk satır yalnızca sütun adlarını içermeli.`
  - Move the `data.length > IMPORT_MAX_ROWS` check above the header loop.
  - Compute "column has data" in **one** pass: `const filled = new Set<number>(); for (const r of data) r.cells.forEach((c, i) => { if (c.trim()) filled.add(i); });` and then use `filled.has(index)`.
  - Cap `problems` at about 20 and add a final `ve <k> sorun daha`.
  - Optionally have `parseCsv` refuse a line with more than 500 cells as it tokenizes, which bounds memory too.

### P2-2. Undo dead-ends permanently after normal hand actions on imported dues data (and so blocks every older batch)

- **Where:**
  - `src/lib/import/undo.ts:194` (`members`, freeze item with null `overridePeriodId`)
  - `src/lib/import/undo.ts:411-417` (`ledgerUndo`, waiver item with null target)
  - `src/lib/import/undo.ts:466-468` (`periodsUndo`, period not found)
  - `src/lib/import/rules/aidat-odemeleri.ts:107-119` (a re-import of that row says "önce o aktarımı geri al", which is now impossible)
- **Cause:** `import_items` points at `dues_overrides` (composite FK) and `dues_periods` with `ON DELETE SET NULL`, by design (db §, `neverNull` in `schema.ts:1058`). The three undo paths treat a nulled or missing target as "changed after the import" and refuse. But the state the undo wants (row gone) is already true. Since the stack only undoes the latest live batch, that batch and **everything older can never be undone again**. That is exactly the dead-end D17 was written to avoid.
- **Scenarios (all proven on a migrated copy of the pre-Phase-7 backup, after committing the six shipped samples):**
  1. **Muaf kaldır.** The treasurer removes the imported waiver `M-202409-1` in Finans › Aidat (`removeWaiver`). The item's override columns go null. `undoImport(6)` → `Kayıt M-202409-1 bu aktarımdan sonra değişti; geri alınamaz.`, for ever.
  2. **Dönemi sil.** Undo 6 succeeds. The treasurer deletes the unused imported period `Kasım 2024` (`deleteDuesPeriod`). `undoImport(5)` → `Kasım 2024 dönemi bu aktarımdan sonra değişti; geri alınamaz.`, for ever.
  3. **Ödemeyi iptal et.**
     - An `uyeler` file changes Mehmet's rate (`indirimli` → `tam`), which creates a freeze protecting his paid Eylül 2024 (batch 7).
     - The treasurer then voids that payment (`voidEntry` → `dropLapsedFreezes` deletes the freeze, as designed).
     - `undoImport(7)` → `Bir üye bu aktarımdan sonra değişti ya da kullanıldı; geri alınamaz.`, for ever. The name is also lost (see P3-3).
- **Fix:** a create item whose target was deleted by hand is already undone, so skip it instead of refusing.
  - `members`, `dues_override` items: `if (!item.overridePeriodId) continue;` (no write).
  - `ledgerUndo`, `dues_override` items: if `!item.overridePeriodId`, skip the item and don't emit its delete. Still refuse when the row exists but its snapshot differs.
  - `periodsUndo`: if `item.duesPeriodId === null`, skip. Still refuse when the row exists and differs or is used.
  - `aidat-odemeleri.ts:107-119`: when `item` exists but its override columns are null, report `Kayıt <no> portalda silinmiş; bu satırı çıkar ya da yeni bir kayıt numarası ver.` instead of `RECORD_CONFLICT`. Its "önce o aktarımı geri al" now works after the fix above, but the row would never match again anyway.
  - `termsUndo` already behaves this way (`ids()` drops nulls), so this aligns the other kinds with it.
  - Add these three cases to `phase8b-c-undo.mjs`.

---

## P3

### P3-1. The member list's formula guard breaks the round trip for addresses or names starting with `+` or `-`
- **Where:** `src/lib/csv.ts:15` (adds `'` before `= + - @`); `src/lib/import/engine.ts:43` (email) and `:38` (name) don't undo it.
- **Scenario (by reading, plus checking zod):**
  - `z.email()` accepts `-a@b.co` and `+a@b.co`. The member list exports `'-a@b.co`, and the AI is told to copy addresses "aynen".
  - The zod email local part also accepts `'`, so `'-a@b.co` parses as a **different valid address**:
    - steps 3 and 6 say `Bu e-postayla üye yok`;
    - in step 1, a row with `ayrilis_tarihi` would **create a duplicate former member** under the wrong address.
- **Fix:** in `mapRecords`, strip exactly one leading `'` when it is followed by `[=+\-@\t\r]` (the inverse of `csvCell`) before parsing any cell.

### P3-2. Created-user undo misses some `restrict` FKs; if one is ever reached, the user gets the generic error instead of the refusal
- **Where:** `src/lib/import/undo.ts:279-290`.
- **What it covers and misses:** `used` checks attendance, entries by `member_id`, overrides, submissions, the ticket assignee, sessions, invites and the Phase 9 tables. It doesn't check:
  - `board_ticket_events.from_user_id/to_user_id`
  - `finance_entries.created_by/updated_by/voided_by`
  - `budgets.*`, `budget_revisions.created_by`
  - `midi_files.created_by`
  - `import_batches.created_by`
- **Reachability:** today none of these is reachable. They all need the former member to be active or a manager, and reactivating them changes `isActive`/`leftAt`, so the snapshot refusal fires first. If a future phase lets an inactive user be referenced, though, the delete hits `SQLITE_CONSTRAINT_FOREIGNKEY`. The transaction rolls back (safe), but the user sees `Bir şeyler ters gitti, tekrar dene.`, and "again" will never work.
- **Fix:** in `undoBatch`, catch a foreign-key constraint error from the final `t.batch` and return the `memberChanged`-style refusal (`Bu aktarımdaki bir kayıt portalda kullanıldı; geri alınamaz.`).

### P3-3. A refusal names "Bir üye" when the freeze row is gone
- **Where:** `src/lib/import/undo.ts:194` and `:199`.
- **Problem:** `byId` is keyed by `item.userId`, which freeze items don't have, and `overrideUserId` is null after a hand deletion.
- **Fix:** largely moot once P2-2 skips these items. Otherwise, look the name up through the user item of the same batch, or through `overrideUserId` before it goes null.

### P3-4. Phase 9 additions to the "used" check: verified correct (no change needed)
- **Where:** `src/lib/import/undo.ts:169-183`, `:287-289`.
- **Proven:** on a scratch copy of the dev DB, sef@ imported a former member. Each of the following blocked the undo with `Rv Eski bu aktarımdan sonra değişti ya da kullanıldı; geri alınamaz.`:
  - a `listening_assistants` row for them
  - a `recordings` row as singer
  - an `assistant_notes` row as singer
  - an `assistant_notes` row as assistant

  With all of them removed, the undo succeeded and the user was deleted.
- **Notes on the code:**
  - The `in ${userIds}` subquery compiles correctly in both note columns.
  - `listening_assistants.created_by` and `midi_files.created_by` can't point at an inactive former member, so they don't need checks (see P3-2 for the safety net).

### P3-5. The production driver path (Turso/Hrana) of `importTx` was never exercised
- **Where:** `src/lib/import/tx.ts:25-27`.
- **Gap:** `drizzle(tx as unknown as Client)` over `db.$client.transaction("write")` is new. Every run so far, `e2e:prod` included, used a `file:` DB. I read `HranaTransaction.batch` (`@libsql/client/lib-esm/hrana.js:19`): it chains steps on `ok(lastStep)` and throws on failure, so the rollback path should hold. That is still reading, not a run.
- **Fix:** before go-live, run `samples.ts` and the fault-hook case once against a local `sqld` / `turso dev` (open source, free) with `DATABASE_URL=http://127.0.0.1:8080`. Time a 5000-row `uyeler` commit there, because it can reach about 5 statements per row in one batch (update, three deactivation statements, `member_dues`).

### P3-6. The commit hash is client-asserted, not a server token
- **Where:** `src/lib/import/run.ts:167-171`.
- **Behaviour:** the commit compares the server's SHA-256 of the uploaded bytes with the `sha256` field the client sent. A crafted client can send any file with its own hash. That is fine, because the commit re-validates everything inside the write lock (re-proven: a swapped file is refused, and a crafted commit of an invalid file gets `errors` + `afterCheck`).
- **Fix:** none needed. Record in `backend.md` that the hash guards against accidental swaps (AC 18), not against a malicious manager. That is where the integrity actually comes from.

### P3-7. `db:check` could catch one more import invariant
- **Where:** `scripts/db-check.ts` (the import block).
- **Proposal:** every **live** batch has at least one item, which the counts CHECK (`added + updated ≥ 1`) implies. A batch row whose items were lost (a botched manual fix, or a restore of a partial dump) would otherwise only show up when someone undoes it.
- **Fix:** add `select count(*) from import_batches b where b.status = 'imported' and not exists (select 1 from import_items i where i.batch_id = b.id)` → `live import batches without items`.

### P3-8. `docs:import -- --check` runs only when someone remembers it
- **Where:** `scripts/import-docs.ts:47-51`.
- **Problem:** nothing calls the check; it isn't part of lint, typecheck or e2e. It also doesn't flag an orphan file left in `docs/ice-aktarma/` after a rename.
- **Fix:** call it from `e2e/run.mjs` before the suite (it's read-only), and list `readdirSync(dir)` entries that aren't in `files` as stale.

### P3-9. The README's D33 line doesn't mention the new attendance reset
- **Where:** `e2e/lib.mjs:128-135`; `README.md` (the D33 line).
- **Assessment of the change:** I checked `scripts/seed.ts:269-405`. The seed never opens or marks a rehearsal from today on, so resetting them restores seed state. The homework and media fixtures re-seed after it (`seedHomework` runs later in `cleanup()`). `run.mjs` calls `cleanup()` once before and once after the run, so it can't interfere between phase files. It breaks nothing I could find.
- **Side effect:** it deletes **every** attendance row, excuses included, for any rehearsal from today on in the local DB. That includes ones the user entered by hand while testing.
- **Fix:** extend the D33 line: `… ve bugünden sonraki çalışmaların yoklama ve mazeret kayıtlarını siler.`

### P3-10. Small hardening notes (no action required)
- **Same-day duplicates:** `yoklama` refuses a portal rehearsal only at the **same start** (`rules/yoklama.ts:213-218`), as the spec says. A hand-made 19:30 rehearsal and an imported 19:00 one on the same day both stand and double-count that evening. Consider a warning when a non-imported rehearsal exists on the same Istanbul day.
- **Body size:** `experimental.serverActions.bodySizeLimit: "1100kb"` (`next.config.ts:24`) is global, so every action now accepts 1.1 MB. Each action still validates its own input, so this is acceptable. It's noted here only so that nobody raises it further without per-action checks.
- **Rate limits:** `checkImport` has none. It is manager-only and costs about 30–50 ms for 5000 rows once P2-1 is fixed, so none is needed.

---

## What I verified and found sound

- **Authorization.**
  - Each action calls `assertManager()` before any parsing, and the slug is validated (`actions.ts:41-43, 64-66, 85-88`).
  - korist@ over HTTP: `checkImport` → `{kind:"denied"}`; `/ice-aktar/uye-listesi`, `/uyeler/ornek` and `/uyeler/talimat` → 403 JSON, no file.
  - Every export of `queries.ts` calls `requireManager()`.
  - Undo applies the owner rule and the latest-only rule inside the write transaction, and the board re-check runs per user item (`undo.ts:76, 214`).
- **D27, per row** (`rules/uyeler.ts:104-131`):
  - An unchanged manager row writes nothing and needs no permission.
  - Any change to a manager by a board user is refused before planning a write.
  - Self-deactivation is refused, and a dues rate for the conductor is refused.
  - Former members are always created as `member`, inactive, with no password.
  - Note: rate changes in the import go through `canEditMember`, which is **stricter** than `setDuesRate` (any manager, any payer). That is acceptable.
- **CSV injection.** Downloads go through `csvCell`/`csvDocument` (member list) or `sampleCell` (samples, static). Error copies are plain text built on the client, and React renders the raw echoes as text; there is no `dangerouslySetInnerHTML` under `components/import` or `ice-aktar`. Cells longer than 40 characters are cut in the echoes.
- **Parser** (proven in process):
  - BOM, CRLF, a lone CR and blank lines all keep their true line numbers (rows reported on lines 2, 4 and 5).
  - A 1 MB quoted cell made of `""` pairs takes 7 ms and is refused by `IMPORT_MAX_CELL`.
  - Random binary input, gzip, UTF-16 BOM and NUL get `NOT_UTF8`; xlsx/ods get `IS_EXCEL`.
  - A PDF's first line becomes unknown-header errors.
  - The only problem found is P2-1.
- **Hash and commit integrity; all-or-nothing.** The commit runs begin, one read batch, the pure plan, then one write batch, under `BEGIN IMMEDIATE` (`run.ts:177-225`, `tx.ts:21-39`). The batch id is computed inside the lock. A double commit re-plans to `unchanged`. A thrown error rolls back the whole file (the earlier fault-hook proof stands; I re-read the path). `kayit_no` is required in both finance types, so a double commit can't duplicate entries.
- **Undo matrix.** All 13 refusals listed in `implementation-notes.md` §4 exist in code. The order is safe:
  - items are deleted first (restrict FKs), then the target writes, then the batch row update;
  - the targets are named explicitly, in 999-wide chunks;
  - entry deletes come before `lapsedFreezeDelete`, so freezes are dropped by `voidEntry`'s own rule.
  - The only correctness gap is P2-2.
- **999 parameters.** `insertChunks` measures `toSQL().params` on the first row and re-splits any statement over the cap. IN-lists are either subqueries or `chunked()` at 999. Reads never bind file-sized lists.
- **Personal data in logs.** The only logs are `run.ts:138`, `undo.ts:91/96` (op, slug, kind, counts, ms) and `actions.ts:36` (error name and code). The fault message carries counts only. There are no cell values, names or emails.
- **Timezones (Europe/Istanbul).**
  - `katilim_tarihi` is stored as 00:00 Istanbul and `ayrilis_tarihi` as 23:59:59 Istanbul (`leftAtOf`).
  - "Unchanged" compares `istanbulDateOf`.
  - `isExpected` uses instants, so a member is expected on both their first and their last day.
  - Rehearsal times come from `istanbulToUtc(date, time)`; `NOT_FINISHED` compares with `ctx.now`; the future-date guard uses the Istanbul day.
  - `e2e/lib.mjs:130` hard-codes `+03:00`, which is correct (Turkey has no DST since 2016).
- **Shared rules used by the existing actions.**
  - What I read:
    - `attendance/schemas.ts`: `createRehearsal`, `updateRehearsal`, `createTerm`
    - `close.ts absentRows`: `closeRehearsal`
    - `roster.ts expectedIds`
    - `finance/periods.ts`: `createDuesPeriod`, `updateDuesPeriod`, `bulkCreateDuesPeriods`
    - `finance/dues.ts`: `recordDuesPayment`, `setDuesRate`, `setWaiver`
    - `finance/entries.ts entryRow` and `finance/sponsors.ts`: `createEntry`, `createSponsor`, `updateSponsor`
    - `members/deactivate.ts`: `setMemberActive`
    - `ledger.ts lapsedFreezeDelete` via `dropLapsedFreezes`: `voidEntry`
  - I found no behaviour change: the same statements, the same messages and the same guards.
  - **Limit:** I couldn't diff against the pre-8b source (no git allowed). This rests on reading plus the e2e suites reported green (`phase1/2/5/7`).
- **Migration drill.**
  - Restored `data/backups/2026-10-21T11-18-03-962Z.sql` (7 migrations applied, pre-Phase-7, real-shaped data) into a scratch file with `db:restore`.
  - `drizzle-kit migrate` applied 0007 → 0010 in order: `migrations=11/11`, and `db:check` → `foreign_keys=1, orphaned rows=0, quick_check=ok`.
  - Dumped with `dumpDatabase` and restored into a new file: the schema (tables, indexes, all 6 triggers) is identical, row counts are identical, and `db:check` is ok.
  - Repeated after committing all six shipped samples on the migrated copy (6 batches, 24 items, composite override FK, partial unique indexes). The dump and restore were identical and `db:check` was ok.
  - `docs:import -- --check` reports 0 stale files. `db:check` on a copy of today's dev DB is ok.
- **`e2e/lib.mjs` cleanup.** The order is safe (imported rehearsals and terms → batches with their cascading items → `seedFinance` → users), and `lib.mjs:13` refuses any non-file DB. The today-onward reset is assessed in P3-9.

## Replies

- **@tech-lead:** P2-2 is a small change (three `continue`s and one message). Please add the three scenarios to `phase8b-c-undo.mjs`, because they are the realistic "treasurer cleans up after the import" path. P2-1 belongs in `mapRecords`. Both are server-only, so the UI contract doesn't change.
- **@ui-engineer:** after P2-1, `fileError.messages` will be at most about 21 lines, so the list never needs virtualising.
- **@dba (db.md §6):** the `ON DELETE SET NULL` design is right. The undo just has to read a null target as "already gone" rather than "changed" (P2-2).

## Files reviewed
- `src/lib/import/**` (actions, run, tx, csv, engine, values, codes, defs, docs, queries, undo, the six rules modules)
- `src/app/(portal)/ice-aktar/**` (actions, the three routes, three pages)
- `src/lib/attendance/{schemas,close,roster}.ts`, `src/lib/finance/{dues,periods,entries,sponsors,ledger}.ts`, `src/lib/members/deactivate.ts`, `src/lib/permissions.ts`, `src/lib/csv.ts`
- `src/app/(portal)/{calismalar,uyeler,finans,finans/aidat}/actions.ts`
- `src/db/schema.ts` (import tables, user FKs), `drizzle/0009_phase8b_import.sql`, `scripts/db-check.ts`, `scripts/import-docs.ts`, `next.config.ts`, `e2e/lib.mjs`, `e2e/run.mjs`, `scripts/seed.ts`
