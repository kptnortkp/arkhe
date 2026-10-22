# Phase 8 backend review

Author: arkhe-backend (reviewer, read-only on `src/`). Date: 2026-10-21.
Read: `po-decisions.md`, `po-spec.md`, `implementation-notes.md`, and the code under review: `src/lib/board/*`, `src/app/(portal)/yonetim/**`, `src/lib/finance/budget.ts`, the budget parts of `src/lib/finance/queries*.ts`, `src/app/(portal)/finans/butce/**` (including `[id]/csv` and `[id]/bilgiler`), `src/lib/csv.ts`, the budget parts of `src/lib/backup/{reports,email,run,dump}.ts`, `drizzle/0008_phase8_board_budget.sql`, `src/app/(portal)/layout.tsx`, `src/components/board/home-card.tsx` and the client callers (`ticket-client.tsx`, `move-menu.tsx`, `ticket-form.tsx`, `budget-meta-form.tsx`).

**Counts: P1 0 · P2 1 · P3 9.**

## How I tested

I ran scratch scripts against the running dev server at 127.0.0.1:3100. They call the real server-action ids from the dev manifest, the same way `e2e/board.mjs` does. The scripts are in `scratchpad/r8be/` (`probe.mjs`, `korist-pages.mjs`, `approve-race.mjs`, `status404.mjs`, `emoji.mjs`).

Every row I created was removed afterwards: ticket #8 with its events and reads (the delete cascades), two `R8BE` budgets, and my `board-create`/`board-comment` rate-limit rows. The ticket counter is back to the value it would have had without my ticket (7, because another reviewer took #7 during my run). Another session (sef@ moves on #1, the `UXR 2027–28 deneme` budget) worked on the same DB at the same time, and I left its rows alone.

What I checked and found to hold:

- **korist@:** all 13 actions are refused (`Bu işlem için yetkin yok.`, and `{changed:false}` from `markTicketSeen`). The CSV route answers 403. None of the 10 board and budget pages leaks any ticket title, budget name or category label. `/yonetim/<n>`, `/arsiv`, `/yeni` and `/duzenle` answer 307. `/yonetim`, `/finans/butce/**` and the other routes under a `loading.tsx` answer 200 with a streamed redirect; see P3-8.
- **No session:** an action POST gets 307 → `/giris?next=…` from the proxy, and the action never runs. The CSV gets 307. With a bogus cookie, the CSV answers 401.
- **Delete rules in SQL:**
  - yk@ deleting sef@'s ticket #1 → `Bu işi yalnızca açan kişi ya da koro şefi silebilir.`
  - sef@ deleting yk@'s comment → `Yalnızca kendi yorumunu silebilirsin.`
  - deleting a `created` system entry → `Kayıt bulunamadı.`
  - the 15-minute window uses the DB clock (`yonetim/actions.ts:349`)
  - draft-only budget delete (`butce/actions.ts:369`)
- **FK cascade:** deleting a ticket leaves 0 orphan events and 0 orphan reads. libsql turns `foreign_keys` on.
- **Bound args:** `updateTicket.bind("1 or 1=1")` and `.bind({a:1})` → `Bu iş bulunamadı.` A missing edit key → `Kaydedilemedi. Alanları kontrol et.` `moveTicket({number:"1e400"})` is refused. Assigning to korist@ → `Bu kişi sorumlu olarak seçilemez.` `prefillPlan("../../etc")` → `Kayıt bulunamadı.`
- **Optimistic locks and idempotency:**
  - two parallel moves from `todo` → one `OK`, one `STALE`, and exactly one status entry
  - three parallel replays of one create id → 1 row
  - two parallel comments with one `clientKey` → 1 row
  - approving with a stale revision → `PLAN_STALE`
  - a forged `markTicketSeen(n, 999999999, 999999999)` is capped at the ticket's real max event id and revision
- **Transactions are IMMEDIATE:** `@libsql/client` `transaction(mode = "write")` → `BEGIN IMMEDIATE`. The read-then-CAS sequences in `updateTicket`, `savePlan`, `approveBudget` and `createTicket` can't interleave.
- **XSS:** a title `<img src=x onerror=…>`, a description `<script>…</script>` and a comment `<img …>` all render as text. Nothing executed, and there's no `img[src=x]` in `main`. There's no `dangerouslySetInnerHTML` anywhere in the board or budget code.
- **CSV injection:** a budget named `=2+3 R8BE` with the note `@SUM(1)` never reaches the CSV. The budget CSV has no free-text cell at all: kind, category label, amounts, `%n` and the signal label. Its filename is built from `start_month` and the Istanbul `asOf`. `csvNum` cells only skip the guard when they match `^-?\d{1,12},\d{2}$`. Any other `CsvNumber` value falls through to the string guard (`src/lib/csv.ts:10-13`). Negative `Fark` cells came out as `"-1000,00"` with no `'` prefix, as D37 asks.
- **D11:** `grep -rn queries-internal src scripts e2e` → only `src/lib/finance/queries.ts:54,56` (`:56` is a type-only re-export) and `src/lib/backup/reports.ts:21`. Every guarded budget loader in `queries.ts:692-792` calls `requireManager()` first. The only callers of the unguarded `budgetCovering` and `categoryActuals` are `backup/reports.ts:43,48`.
- **Email best effort:** `budgetPart` (`backup/reports.ts:41-60`) wraps all of its I/O and computation in `try/catch` and returns `null`. It can't reject the `Promise.all` at `:73`. `budgetEmailLine` is pure. The one remaining coupling is the size check (P3-5).
- **Badge cost:** one query per manager layout render. It reads only my open tickets (`board_tickets_assignee_idx`), with one `EXISTS` per row on `board_ticket_events_ticket_idx`. It's shared with the home card through `cache()`, and for members it returns before any query (`queries.ts:281-282`). There's no N+1. The board query uses correlated subqueries per card, each one indexed. That's fine at this scale and matches the 300-ticket timing test.
- **Restore:** the dump includes `board_ticket_seq` and both `budgets_no_overlap_*` triggers. Triggers are written after the data, so the restore inserts don't trip them.
- **Timezones:** overdue uses the Istanbul day (`queries.ts:109`). The due-date bound is the Istanbul day + 730 (`rules.ts:68`). The archive window is rolling seconds in SQL, as D32 asks. Budget phase, elapsed share, default start and CSV `asOf` all use `todayIstanbul()`. `dayInstant` is noon UTC, so the due sentence can't shift by a day. The email month comes from the Phase 7 Istanbul schedule.
- **Emoji titles:** `😀😀` as a title gets the proper field message, not the generic CHECK failure.

## P1

None.

## P2

### P2-1. Approving a draft doesn't see a concurrent name or start change, and the result is permanent
- **Where:** `src/app/(portal)/finans/butce/actions.ts:190-202` (`updateBudget` on a draft doesn't bump `revision`), `:342-355` (`approveBudget` CASes only on `revision`).
- **Scenario (reproduced, `approve-race.mjs`):**
  1. yk@ opens the report of a draft starting `2035-09` (revision 1).
  2. sef@ changes the start to `2035-01` on `/bilgiler`.
  3. yk@ clicks `Onayla` with revision 1 → `Bütçe onaylandı.`
  4. The budget is now approved for January–December, a period yk@ never saw.

  This can't be undone in the app:
  - name and start are locked after approval (`APPROVED_LOCKED`)
  - an approved budget can't be deleted (`Onaylanmış bütçe silinemez.`)
  - there is no un-approve

  Only someone with DB access can fix it. The same applies to a rename.

  Implementation-notes deviation 8 chose this on purpose, so that renaming a draft doesn't make an open plan editor stale. But "approve what you saw" (D34) is exactly the case where the period matters most.
- **Fix:** make approval check the metadata it showed, without touching the editor's revision. Pass the shown start and name and add them to the CAS:
  ```ts
  // approveBudget(id, rawRevision, shownStart, shownName)
  .where(and(eq(budgets.id, id), isNull(budgets.approvedAt), eq(budgets.revision, revision.data),
             eq(budgets.startMonth, shownStart), eq(budgets.name, shownName)))
  ```
  `ApproveButton` already gets `r.revision`; give it `r.startMonth` and `r.name` too. Validate `shownStart` with `MONTH` and `shownName` as a string of at most 40 characters before the query.

  The alternative is to bump `revision` in `updateBudget` only when `name` or `start` actually changes. The note stays revision-free. The plan editor's `Yenile` already handles a stale revision.

  Add an e2e for step 3: expect `Bu plan az önce değişti. Sayfayı yenile.`, with the budget still a draft.

## P3

### P3-1. The budget report runs twice per view
- **Where:** `src/app/(portal)/finans/butce/[id]/page.tsx:13-16` and `:20`. Both `generateMetadata` and the page call `budgetReport(id)` (`src/lib/finance/queries.ts:727`), which isn't `cache()`d.
- **Cost:** each view runs `budgetWithPlan` (2 queries), `categoryActuals` and `budgetHistory` twice, and the second actuals query is a range scan over `finance_entries`.
- **Fix:** `export const budgetReport = cache(async (id: string) => { … })`, as `balances` already is. Or have `generateMetadata` use a cheap name-only loader.

### P3-2. Page and CSV actuals include future-dated entries, but the page says "<today> itibarıyla"
- **Where:** `src/lib/finance/queries.ts:733-734` reads `categoryActuals` over the budget's whole range. `entryDayField` allows entries up to 31 days ahead (`src/lib/finance/schemas.ts:60-62`).
- **Scenario:**
  1. The treasurer enters next month's venue payment today.
  2. The report "as of today" already counts it, so the line can read `Bütçe aşıldı` early.
  3. A `future` budget shows actuals before it starts.
  4. The email (`backup/reports.ts:47-48`) caps at the end of M, so the page and the email disagree for the same month. backend.md §7 flagged this; nobody decided it.
- **Fix:** cap the page and the CSV the same way the email does: `categoryActuals(from, min(to, addDays(today, 1)))`. Or keep the full range and change the label to say it includes future-dated entries. The cap is one line and makes the three outputs agree.

### P3-3. `markTicketSeen` opens a write transaction on every detail view
- **Where:** `src/app/(portal)/yonetim/actions.ts:386-406`, called from `TicketSeen` on every mount (`src/components/board/ticket-client.tsx:33-38`).
- **Cost:** the upsert always runs, because `seen_at` changes. On Turso, every ticket view costs a `BEGIN IMMEDIATE` round trip and holds the single write lock.
- **Fix:** return early when the marker already covers the shown values:
  ```sql
  … on conflict (user_id, ticket_id) do update set …
    where excluded.seen_event_id > seen_event_id or excluded.seen_revision > seen_revision
  ```
  Also skip the transaction when `before` is not fresh and a read row exists with `seen_event_id >= eventId` and `seen_revision >= revision`. `seen_at` isn't read anywhere.

### P3-4. Board `Yeni` can miss a comment after a restore
- **Where:** `src/lib/backup/dump.ts:27-28` skips `sqlite_%` tables, so `sqlite_sequence` isn't dumped. `board_ticket_events.id` is AUTOINCREMENT, and `isNewFor` compares ids (`src/lib/board/queries.ts:66-70`).
- **Scenario:**
  1. The newest event (id 500) is a comment.
  2. Its author deletes it within 15 minutes, and the assignee's read row says `seen_event_id = 500`.
  3. The DB is restored. After the restore, the next id is `max(id) + 1 = 500`.
  4. The next comment from someone else gets id 500, isn't `> 500`, and doesn't show `Yeni` or the badge.

  It needs a restore and a deleted tail comment, so it's rare and the harm is small.
- **Fix:** in the dump, after the data, emit the `sqlite_sequence` rows: `INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES (…)`, or `UPDATE` them, since the table exists once an AUTOINCREMENT table is created. Or have `db:restore` run, after loading, `update board_ticket_reads set seen_event_id = min(seen_event_id, (select coalesce(max(id),0) from board_ticket_events e where e.ticket_id = board_ticket_reads.ticket_id))`.

### P3-5. The budget CSV counts toward the 18 MB size check
- **Where:** `src/lib/backup/run.ts:188-192`. The budget attachment is pushed before `size` is summed. If a dump sits just under the limit, the budget CSV (≈1 KB) tips it and `BackupError("size")` fails the whole email. D39 says a budget part must never cost the backup.
- **Fix:** compute `size` without the budget file. If adding it would pass `MAX_ATTACHMENT_BYTES`, drop the budget attachment and its body line, and log `budget attachment skipped (size)`. Then send.

### P3-6. Some failed creates and comments still count toward the rate limit
- **Where:** `src/app/(portal)/yonetim/actions.ts:79-84` consumes the attempt before the in-transaction `checkAssignee` (`:94`) and before the replay check (`:89-93`). `:298-303` consumes the comment attempt before `TICKET_NOT_FOUND`.
- **Effect:** a `Bu kişi sorumlu olarak seçilemez.` failure, a double submit, or a comment on a just-deleted ticket counts as an attempt. backend.md §2.2 said failed attempts are forgotten. The limits are generous, so this is a correctness nit.
- **Fix:** keep `limit.attemptId`. Call `forgetAttempt(limit.attemptId)` when the result is a `FieldError`, `TICKET_NOT_FOUND`, or a replay (`replay.createdBy === actor.id`).

### P3-7. The D11 import rule isn't enforced by a tool
- **Where:** `eslint.config.mjs` has no rule. The only protection is the comment at `src/lib/finance/queries-internal.ts:2-3`. Today the rule holds (see the grep above), but a future page importing `budgetCovering` directly would pass lint and typecheck.
- **Fix:** add a `no-restricted-imports` pattern for `@/lib/finance/queries-internal` and `./queries-internal`, with an override that allows `src/lib/finance/queries.ts` and `src/lib/backup/**`.

### P3-8. Budget pages answer 200 for an unknown id, and member redirects are streamed
- **Where:** `src/app/(portal)/finans/butce/loading.tsx` wraps `[id]/**`.
  - `notFound()` from `[id]/page.tsx:21`, `[id]/duzenle/page.tsx:12` and `[id]/bilgiler/page.tsx:12` therefore streams with HTTP 200: `/finans/butce/<unknown uuid>` → 200 and `/finans/butce/nope` → 200, while `/yonetim/9999` → 404.
  - The same boundary makes korist@'s redirect from `/finans/butce/**` (and from `/yonetim`, via `(pano)/loading.tsx`) a 200 with a client-side redirect, after the skeleton has rendered. No data leaks; I checked the bodies.
- **Fix:**
  - Do what the UI engineer did for the board: move `butce/page.tsx` and `loading.tsx` into a `(liste)` route group, so `[id]` has no loading boundary.
  - For the member case, add `src/app/(portal)/yonetim/layout.tsx` and `src/app/(portal)/finans/butce/layout.tsx` that `await requireManager()` and return `children`. The redirect then happens before streaming starts and is a real 307. Keep the per-loader checks.

### P3-9. Only create and comment are rate-limited
- **Where:** `moveTicket`, `updateTicket`, `deleteComment`, `markTicketSeen` and all six budget actions have no throttle.
- **Effect:** a stolen manager session could loop `moveTicket` between two statuses. Every move writes a `status` event, so the thread and the DB grow without bound. backend.md §1 accepted this, because managers are trusted and every write is CAS-guarded.
- **Fix (optional):** one shared `board-write:<user>` bucket of 300 per 10 minutes on `moveTicket` and `updateTicket`. That's far above any human pace. Leave the budget actions as they are.

## Notes for the tech lead (no action)
- `moveTicket` answers `TICKET_STALE` for malformed input, such as a non-numeric number (`yonetim/actions.ts:227`). Only a crafted request can produce that, so the wording doesn't matter.
- `approveBudget` treats a replay as success when the same actor already approved (`butce/actions.ts:336`), even with a stale revision. That's correct for a double click.
- `updateBudget` on an approved budget saves the note without a CAS (`:182-185`). That's last-write-wins, as D34 intends.
