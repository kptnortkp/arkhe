# Phase 8 PO review: Yönetim Kurulu board (kanban) and budget plan vs actual

Author: arkhe-po. Date: 2026-10-21.

I checked `po-spec.md` (AC 1–45, as amended by `po-decisions.md` D21–D41) against these sources:
- `implementation-notes.md`, including its deviations
- the four reviews `review-ux/ui/db/backend.md`
- `review-fixes.md`, including the tech-lead decision TL1
- `e2e-results.txt`

I also ran my own checks on the running dev app and the working tree. They created no tickets, budgets or entries; the only writes were login sessions:
- `GET /api/saglik` → 200. `/yonetim` and `/finans/butce` without a session → 307 to `/giris?next=…`.
- **Logged in as sef@ at 375 and 1280 px:** 13 new pages, including `/yonetim/2/duzenle` and `/finans/butce/<id>/bilgiler`. All answered 200, with **no console errors, page errors or hydration warnings**. The only message was the existing dev-mode LCP hint for the home hero image, which is not new.
- **Logged in as yk@ at 375 px, light and dark:** I looked at the home page, `/yonetim`, `/yonetim/2`, `/finans/butce` and the current-season report. The bar reads `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim` with badges. The cards read well, and `Durum: Devam ediyor` sits next to `Düzenle`. The report opens on `Dönem içi durum · Dönemin geçen kısmı: %14` and `Net … Dönem sürüyor`. Expense lines say `kaldı`, income lines `eksik` / `Sürüyor`, and the `Değişiklik geçmişi` shows the seeded revision with its reason.
- **Lint and typecheck:** `npm run typecheck` → clean. `npm run lint` → clean.
- **Migration:** `drizzle/0008_phase8_board_budget.sql` has no `ALTER`, `DROP` or `__new_` (count 0) and exactly 2 `CREATE TRIGGER`s, both on `budgets`.

## Verdict: **ACCEPTED**

Phase 8 meets all 45 acceptance criteria. Four are amended below to match deliberate, better behaviour: AC 24, AC 26, AC 32 and AC 34 wording. **There are no must-fix items.** The two open product questions (the future-budget CSV and an emptied approved plan) don't block acceptance. They are backlog items 17–18, with my decision recorded for each.

Final runs:
- `npm run e2e`: **923/923**. The new files are `phase8-a-board` (AC 1–23 and the board parts of AC 41–44), `phase8-b-budget` (AC 24–37 and the budget parts of AC 41–44) and `phase8-c-email` (AC 38–39).
- `npm run e2e:prod`: **52/52**. These include the Phase 8 production checks: CSP nonce on `/yonetim`, `/yonetim/1` and `/finans/butce`; a member is redirected from all board and budget pages; the budget CSV gives a member 403.
- `npm run lint` and `npm run typecheck`: clean (I re-ran both).

**Team review:** 1 P1 (UX P1-1, a future budget read as running and short) plus P2s:
- ux: P2-1 to P2-6
- ui: P2-1 to P2-3
- backend P2-1 = db P2-1, the approve race

All are fixed, and each fix has an e2e check named after it (`UX P1-1 …`, `UX P2-2/3/5/6 …`, `UI P3-2/3/5/6/8 …`, `Backend P2-1 …`). The approve race was also reproduced and verified by script before the e2e was added.

**Constraints:**
- **Zero budget holds:** no new dependency.
- **Live data is safe:** migration 0008 only adds 8 tables, their indexes and 2 triggers on the new `budgets` table. It was drilled on a Phase 7 snapshot (`db:check` → `migrations=9/9`; a missing trigger or a counter behind the data is caught by `db:check`).
- **Existing tests:** exactly one older test changed, as D40 allows: the Phase 5 FinanceNav chip list gains `Bütçe`.

**For the choir.** The board gets one place for its jobs, sized for a phone. A job is opened in ten seconds and gets a number to paste into WhatsApp ("12 numaralı iş"). It's moved with one tap and leaves a written trail, and the `Yönetim` tab shows a badge when someone hands you something. The treasurer writes the season's plan from last year's real numbers. Any day of the season the board sees plan vs actual in plain words ("₺8.500,00 kaldı", "₺24.000,00 eksik"), with no false alarms while money is still coming in. At the end of the season there's a report and a CSV for the general assembly and the auditors, and the CSV also arrives by itself in the monthly email.

## 1. AC-by-AC

| AC | Result | Evidence |
|---|---|---|
| 1 Access managers-only | PASS | e2e: sef@ and yk@ get 200 on all 5 board pages; korist@ is redirected to `/` from each; all 6 actions refuse korist@ with `Bu işlem için yetkin yok.` (`markTicketSeen` → `changed:false`), no board row changed. prod-e2e: a member is redirected in production. My curl: logged out → 307 `/giris`. |
| 2 Nav entry (amended D22) | PASS | e2e: the 375 px manager bar is `Ana sayfa,Çalışmalar,Repertuvar,Ödevler,Yönetim`; korist@ has 4 tabs; the sidebar has `Yönetim Kurulu` between `Finans` and `Üyeler`; `aria-current=page` on `/yonetim/arsiv` and on a ticket page; `Üyeler` is linked from the board header and the home card footer. My screenshots match. |
| 3 Home card | PASS | e2e: directly below the hero (`home-board`); yk@ sees `Sana atanan 2 açık iş · 1 yeni · 1 acil` → `/yonetim?kim=ben` and the first assigned title (#1); the empty text `Sana atanmış açık iş yok.` + `Panoya git`; korist@ has no card and no ticket title in the HTML. |
| 4 Mobile layout | PASS | e2e (light and dark): 4 cells with `data-count` and names `<Sütun>, <n> iş`; title and a ≥ 44 px `Yeni iş`; `Yapılacak` is the default; each cell sets `?sutun=` and survives a reload; no horizontal scroll on any tab; all targets ≥ 44 px. Extra: a tab switch followed by the bar tap shows the default column again. |
| 5 Wide layout `xl` (amended D21) | PASS | e2e: at 1280, four columns with `h2` and counts and no `Sütunlar` nav; at 1024 and 768, the `Sütunlar` nav and one column. |
| 6 Card content | PASS | e2e: #2 shows its number, title, `Yüksek`, `Gecikti · 19 Eki`, 2 comments and the assignee; tones are alert (`Acil`, `Gecikti`) and warning (`Yüksek`); the `Yeni` dot with sr text `yeni`; the link `/yonetim/1`; `Atanmadı`; a 2-line clamp. |
| 7 Order | PASS | e2e: urgency, then due date (none last), then updated: `903,902,901,904,3,900` as expected; `Bitti` is newest `done_at` first. |
| 8 Empty states (amended D28) | PASS | e2e: `Panoda henüz iş yok.` with the hint; `Bu sütunda iş yok.`; `Bu filtreye uyan iş yok.` + `Filtreleri temizle` → `/yonetim?sutun=takildi`. |
| 9 Filters (amended D28) | PASS | e2e: `kim=ben` → yk@'s 2 tickets in the counts, with `aria-current`; `aciliyet=acil` narrows further; unknown values are ignored. Below `lg`: a dropdown of 5 links, the trigger shows `Acil` and a 44 px `×` link. From `lg`: inline chips. The filter row wraps at 375 instead of scrolling (deviation accepted, §3). |
| 10 Create | PASS | e2e: the defaults (`Orta`, `Durum` from `?sutun=`, else `Yapılacak`), a native date input, `Bana ata`, all four validation messages with values kept, nothing saved on invalid input; `#7` created with the toast `#7 açıldı.` and the creation entry first. Rate limit: the 30th create passes, the 31st is refused with `Çok fazla deneme…` and saves nothing; a validation failure doesn't count. |
| 11 Assignee rules | PASS | e2e: the options are exactly `Atanmadı, Demo Şef, Demo Yönetim`; a member id is refused; a demoted assignee keeps the name with `(kurulda değil)`, offered only as the current value. |
| 12 Detail page | PASS | e2e: every field, including `Açan` and `Son değişiklik`; line breaks are kept; the thread is oldest first, then the comment box; `Panoya dön` → `/yonetim?sutun=devam`; `Son tarih yok` and no `Son değişiklik` on an unedited ticket; `/yonetim/9999` and `/yonetim/abc` → 404. |
| 13 Edit | PASS | e2e: sef@ edits yk@'s ticket, giving exactly one urgency entry and none for the title; the toast `Kaydedildi.`; `Son değişiklik` names Demo Şef. A stale save gets the message + `Yenile`, and `Yenile` reloads the current values. A move after the editor opened makes the save stale (D30). |
| 14 Delete | PASS | e2e: the confirm copy; yk@ deletes their own ticket (`#7 silindi.`); no `Sil` on sef@'s ticket for yk@ and a direct call is refused; the conductor deletes yk@'s; after deleting #6 and #7, the next ticket is **#8** (high-water + 1, D29). On the phone, delete is the ghost `İşi sil` at the end (UX P2-6). |
| 15 Move from the card | PASS | e2e: `Taşı` is ≥ 44 px and named `#4 taşı`; the menu shows the other three columns; the toast `#4 Takıldı sütununa taşındı.`; counts and the DB update; `Göster` opens `?sutun=takildi`; `done_at` is set and cleared; a keyboard-only move works at 1280. Focus goes to the neighbour card, to the column heading or the active tab after the last card leaves, and stays on `Durum` on the detail page (UI P2-1, P2-3). |
| 16 Move from detail (amended D27) | PASS | e2e: one arrow press never moves the ticket; the `Durum` menu gives the same toast; the system entry appears without a full reload. |
| 17 System entries | PASS | e2e: the exact D5/D28 sentences in order (`… bu işi açtı.`, `… sorumluyu Atanmadı → Demo Yönetim olarak değiştirdi.`, `… son tarih koydu: 10 Kas 2026.`, …); every entry has a `tr-TR` timestamp; no delete control. |
| 18 Concurrent move | PASS | e2e: two contexts; the stale move gets the error toast + `Yenile`; the ticket stays `Devam ediyor` with exactly one status entry. |
| 19 Add a comment | PASS | e2e: a labelled box with the placeholder `Yorum yaz…`; the comment appears with author, time and line break; the box clears; the card count goes up; a double tap → 1 row; both errors, nothing saved. Rate limit: the 61st comment in 10 minutes is refused, and an empty comment still gets its own message. |
| 20 Delete own comment | PASS | e2e: the confirm `Yorum silinsin mi?`; a fresh comment is deleted; after 15 minutes no button and a direct call is refused; sef@ has no `Sil` on yk@'s comment and a direct call is refused. Each delete button has a unique name (UI P3-8). |
| 21 Text safety | PASS | e2e: titles, descriptions and comments render literally, and no dialog fires. |
| 22 New marker (amended D30, D31) | PASS | e2e: the seeded ticket gives badge 1 on `Yönetim` (`, 1 yeni iş`) and the dot, and the home card agrees; sef@ doesn't see it; opening clears it and it stays cleared after a reload; sef@'s comment brings it back; yk@'s own comment doesn't; a move clears it; deleting a comment marks nothing; `9+`; `data-nav-badge` stays homework-only. |
| 23 Archive (amended D32) | PASS | e2e: the 40-day-old #6 is not in `Bitti` but is on `/yonetim/arsiv`, linked from `Bitti` and the header; 29 days → on the board, 31 → archived; page 1 holds 50 newest first, page 2 has the rest with `Daha yeni`; an archived ticket reopens into `Yapılacak`; the empty state `Arşivde iş yok.` |
| 24 Budget access (amended below) | PASS | e2e: 200 for sef@ and yk@ on every budget page; the FinanceNav order `…,Rapor,Bütçe,Ayarlar`; korist@ is redirected, and all 6 actions refuse and change nothing; the CSV gives korist@ 403. Logged out: with no cookie, the proxy answers 307 → `/giris`; with a stale cookie, 401. Neither returns a CSV body. The active chip scrolls into view on the phone (UX P2-1). |
| 25 List (amended D23, D36) | PASS | e2e: newest start first; the row `2026–27 sezonu · Onaylandı · Şu anki · Eylül 2026 – Ağustos 2027 · Gelir %12 · Gider %14 (plana göre)`; `Yeni bütçe`; the empty state. |
| 26 Create (amended TL1, below) | PASS | e2e: the default start is **2027-09** `2027–28 sezonu`, the month after the latest budget (TL1), and `Oluştur` with the untouched defaults succeeds. A January start is named `2031`, ending `Aralık 2031`; a March start uses the range name; after typing, the name no longer follows the start; all five errors and the overlap naming the other budget, with nothing saved on refusal; the toast `Taslak oluşturuldu…` |
| 27 Plan editor (amended D26) | PASS | e2e: 6 + 11 lines in `categories.ts` order; `inputmode=decimal` and ≥ 44 px; live totals `₺16.500,50 / ₺0,00 / +₺16.500,50`; an invalid amount is shown inline and nothing is saved; the DB holds `1250000 / 300050 / 100000` and **no row** for blank, `0` or `0,00`; `Plan kaydedildi.`; no horizontal scroll at 375, and `Kaydet` stays reachable. |
| 28 Prefill (amended D35) | PASS | e2e: the hint names the prior window. The sums are rounded up (`1.235,00`), with voided, transfer and out-of-window entries ignored; nothing is saved until `Kaydet`; with a typed value, a confirm (`Vazgeç` keeps it, `Doldur` replaces it); no entries → `Önceki 12 ayda kayıt yok.`. A window that isn't over yet gets the partial hint and a warning toast (UX P2-5). |
| 29 Approve (amended D34) | PASS | e2e: the confirm copy; an empty plan is refused; `Bütçe onaylandı.`; afterwards `Onaylandı`, `Onaylayan`, no `Sil`, `Planı değiştir`; the server refuses name/start/delete; the note stays editable with no history entry. The approve race is refused with `PLAN_STALE`, and the budget stays a draft (Backend P2-1). |
| 30 Delete a draft | PASS | e2e: the confirm copy; `Bütçe silindi.`; the ledger is untouched. |
| 31 Revise (amended D34) | PASS | e2e: titled `Planı değiştir`; a no-change save is refused (UI and server); amounts are validated before the dialog, which opens on `Değişiklik gerekçesi`; the reason rule; one history entry with two lines `Aidat: ₺12.500,00 → ₺13.000,00`, `Ulaşım ve konaklama: ₺0,00 → ₺2.600,00`; the report uses the new amounts; a stale revision gets the message + `Yenile`; a draft save writes no history. |
| 32 Actuals (amended below) | PASS | e2e on `E2E 2019–20`, with literal kuruş: first and last day included, the day before and after excluded, the leap day included, voided, transfer and opening excluded. The report, list and CSV count up to and including today; the email counts up to the end of M (decision 3). |
| 33 Per-category row (amended D26) | PASS | e2e: income first, then expense; 0/0 lines hidden; `Planlanmadı` and no bar on unplanned lines; bars at `min(pct,100)` with an over-mark past 100; every number has a label (`dt`). Lines are cards at every width, two columns from `lg` (deviation accepted, §3). |
| 34 Signals (amended below) | PASS | e2e: every signal, label, word and % as listed, `pending` on the running season and `short` on the ended fixture; the tones are by token. After the end, an expense under plan reads `₺… harcanmadı` instead of `kaldı` (UX P3-11; see §2.4). |
| 35 Totals, net, progress | PASS | e2e: running: `Dönem içi durum`, `Dönemin geçen kısmı: %14`, markers at 14, `Dönem sürüyor` and no verdict, totals equal the sum of the lines. Ended: `Dönem sonu raporu`, no marker, `Plandan iyi` (−₺2.200 vs −₺2.500), the cash note once. Future: `Dönem henüz başlamadı`, with only planned totals, `Başlamadı` chips, no actuals, words or bars (UX P1-1 fix). |
| 36 Agrees with `/finans/rapor` | PASS | e2e: the `E2E 2021` January budget's income/expense actuals equal the 2021 yearly report (`173456 / 70000`). |
| 37 CSV export | PASS | e2e: the filename `arkhe-butce-2019-09-2026-10-21.csv`, BOM, CRLF; literal rows (`Gelir;Bağış;1000,00;1200,00;200,00;%120;Hedefe ulaşıldı`, `…;-600,00;%40;Hedefin altında`), so the signed `Fark` is a plain number (D37); it matches the page to the kuruş; the `=2+3 sezon` name never appears in the CSV, and no cell starts a formula. The future-budget CSV leaves `Durum` empty; its `0,00 / −plan` cells are decision 1. |
| 38 Email attachment (amended D39) | PASS | e2e: `?bugun=2020-03-01` → `sent`, 6 attachments including `arkhe-butce-2020-02.csv` (BOM, CRLF), literal actuals up to 2020-02-29 (`Bağış 1000,00 … Hedefe ulaşıldı`, `Hibe 400,00 … Sürüyor`); the route CSV has the same header and shape; the size guard counts it; January 2018 → 5 attachments. Best effort: a size overflow drops only the budget file and its line (Backend P3-5). |
| 39 Email body line (amended D23, D39) | PASS | e2e: right after `Gelir: …`, `Bütçe (E2E 2019–20, Onaylandı): gelir plana göre %85 · gider plana göre %69.`; `Ekler:` names the file; the subject is unchanged; no line when there's no budget; `gider planı yok` when the expense plan total is 0; the name is written literally. Phase 7's tests pass unchanged. |
| 40 Additive migration (amended D40) | PASS | My grep: no `ALTER`/`DROP`/`__new_`, 2 triggers on `budgets`. Implementation notes: migrated on a Phase 7 snapshot → `db:check` `migrations=9/9`, and `db:check` detects a missing trigger or a counter behind the data. The only older test edit is `phase5-finance.mjs:175` (chip list); no test asserted the old fifth tab. |
| 41 Constraints | PASS | e2e: invalid board and budget writes fail at the DB; budget lines cascade; board comments/events cascade with their ticket. The DBA's constraint matrix in `db.md` §5 is green. `board_ticket_reads.user_id` cascades (D40). |
| 42 Themes and phone | PASS | e2e: no horizontal scroll and every target ≥ 44 px at 375, light and dark, on every listed page plus `/yonetim/arsiv` and the future report; a visible focus ring; no raw hex in 29 new files. My screenshots in both themes agree. |
| 43 Accessible structure | PASS | e2e: `nav[aria-label=Sütunlar]` with `aria-current`; the `xl` columns are `section`s labelled by their `h2`; the status menu, dialogs and comment box are named; axe reports no serious violations on the board, detail, report and editor; numbers sit in `dt/dd` pairs. **Console/hydration:** there is no e2e listener, so I checked it myself (13 pages × 2 widths, clean). The missing listener is backlog item 24. |
| 44 Performance | PASS | e2e: 300 tickets / 2000 comments: `/yonetim` 513 ms, a detail page 133 ms; a report over 5000 entries 116 ms; `EXPLAIN QUERY PLAN` → `SEARCH finance_entries USING INDEX fe_occurred_idx`. |
| 45 Test round | PASS | `npm run e2e` 923/923, `npm run e2e:prod` 52/52 (production refusal of korist@ on `/yonetim`, `/finans/butce` and the CSV), lint/typecheck clean, results saved in `e2e-results.txt`. |

## 2. Decisions on the open items

1. **Future-budget CSV shows `Gerçekleşen 0,00` and `Fark −plan`: not blocking. Backlog item 17, first small release.**
   - **The decision for the fix:** for lines of a budget that hasn't started, and for its total rows, the `Gerçekleşen`, `Fark`, `Gerçekleşme` and `Durum` cells are empty. That matches the page, which shows plan only.
   - **Why it doesn't block:** only someone who opens a plan that hasn't started yet and presses `CSV indir` ever sees it. The plan columns, which are the only meaningful numbers then, are correct. The monthly email can never attach a future budget, because "covers M" means it has started. The page itself is already right (the P1 fix).
2. **DB P3-5: an approved plan revised down to zero lines. Refuse it. Backlog item 18, first small release.**
   - **Copy:** `Onaylanmış planda en az bir tutar kalmalı.` This is the same rule as D34 ("an empty plan can't be approved"), applied to revisions.
   - **Why:** an approved, empty budget reads as "everything unplanned" all season. It's never what anyone means; it would be a mistake made through the one path that can't be undone, because approved budgets can't be deleted.
   - **Why it doesn't block:** the revision needs a typed reason and is written to `Değişiklik geçmişi`, so nothing is lost or hidden, and the next revision restores the amounts.
3. **Actuals up to today on the page, the CSV and the list; up to the end of M in the email: accepted, and AC 32 amended.**
   - Both answers are "as of a day", and a future-dated entry (a booked festival fee entered early) never counts before its date. That is what a treasurer expects.
   - AC 32 now reads "…with `occurred_on` in `[start, min(end, today + 1))` on the page, the list and the CSV; in the email, up to and including the last day of M".
4. **`harcanmadı` after the period ends: accepted, and AC 34 amended.**
   - At year end, `₺300,00 kaldı` would suggest money still to spend. The amended wording: an ended period's expense under plan reads `₺… harcanmadı`; `kaldı` is used only while the period runs; unplanned lines carry words too (`₺300,00 fazla`, `₺50,00 aşıldı`).
5. **TL1, the default start is the month after the latest budget ends: accepted, and it amends D33 and AC 26.**
   - This is better than my D33. My rule opened `Yeni bütçe` on a month that was already taken (UX P2-2), so the treasurer's first sight was an error. The new default is always free by construction. With no budgets at all, it is still September of the current year. The default name follows D33 (`2027–28 sezonu`).
6. **AC 24 logged out: a 307 to `/giris` with no cookie, a 401 with a stale cookie: accepted, and AC 24 amended.**
   - The proxy redirects before the route runs, exactly as it does for `/finans/rapor/csv`. No CSV body leaves in any case, and that's the requirement.
7. **The route groups `yonetim/(pano)`, `finans/(ozet)` and `butce/(liste)`: accepted.**
   - They give real 404s: `/finans/butce/abc`, an unknown uuid, `…/duzenle` and `…/bilgiler`. Before, these were a skeleton followed by a soft "not found".
   - The side effect is no loading skeleton on `/finans/[id]` and the budget sub-pages. Those pages are fast (AC 44), so a correct 404 is worth more. I'd like the skeleton back where it's cheap (backlog item 23).
8. **`/finans/butce/[id]/bilgiler` (`Bilgileri düzenle`, and `Notu düzenle` on an approved budget): accepted.**
   - It separates the name, start and note from the amounts. That's the D17/D34 split exactly: a draft can change everything, and an approved budget only its note.
   - It sits under `Bütçe işlemleri` at the end of the report on the phone, after the answer (UX P2-3).
9. **The skipped UX P3s: accepted as backlog items 19–21.** None of them affects correctness, and all are polish on screens that already pass the phone checks:
   - the comment delete countdown
   - the history reason on its own line
   - plain-text locked fields
   - the period-bar label in the list
   - the home `Üyeler` link placement
   - the plan editor's unsaved-changes guard

## 3. Deviations accepted during implementation

- **Data model per `db.md`:**
  - tickets have a uuid `id` plus a unique `number`
  - the thread is `board_ticket_events`
  - "seen" is `seen_event_id` + `seen_revision`
  - plus `client_key` for comment dedupe, which is additive and inside 0008
- **Ticket create runs in one `writeTx`,** with a self-healing counter `max(last_number, max(number)) + 1`.
- **`updateBudget` is last-write-wins for the name and note,** but the draft branch bumps `revision` when the name or start changes (the approve-race fix). A note-only save never makes an open plan editor stale.
- **The budget start-year bound** is 2000 … Istanbul year + 10.
- **Report lines are cards at every width** (two columns from `lg`), not a table. AC 33 allows it.
- **Detail-page controls:** a visible `Sil` (ghost `İşi sil` at the end on the phone) instead of an overflow menu.
- **Filters:** the filter row wraps at 375 px instead of scrolling sideways.
- **No `beforeunload` guard in the plan editor** (it would fight AC 28's reload). The sticky save bar is the mitigation. A guard on in-app links is backlog item 21.
- **Module location:** the budget math lives in `src/lib/finance/budget.ts`.

## 4. Go-live notes (only the user can do these)

Phase 8 goes live **in one push together with Phase 7 and Phase 8b** (historical import, migration `0009`), when the user says so. That push also moves functions to `arn1` (`vercel.json`). The Phase 7 steps in `design/phase-7/review-po.md` §4 still apply, with these changes:

1. **Commit Phase 8 with your personal repo-local identity** after reviewing the diff. Push only when §4 step 7 says so: Vercel deploys on push, and the new code needs migrations 0007 **and** 0008 in place first.
2. **One `npm run db:migrate` applies the migrations in order:** `0007_phase7_backup`, then `0008_phase8_board_budget`, then Phase 8b's `0009`. 0008 must come after 0007, and the journal guarantees that.
   - It takes its backup first, as before.
   - `db:check` must then show **`migrations=10/10`** with 8b, not `8/8`. If 8b were held back, it would be `9/9`. A Phase 9 migration would go in a later push.
   - 0008 only adds tables, indexes and two triggers on the new `budgets` table, so it is safe while the old code is live.
   - Keep the backup file.
3. **The restore drill (Phase 7 AC 39)** expects the same count: `db:check` → the same count (`10/10` with 8b) on the restored copy.
4. **Production starts with an empty board and no budgets.** The demo tickets and budgets are seed/e2e fixtures only, and the fixtures refuse non-file DBs and production.
   - On the first evening, the şef or the treasurer creates the `2026–27 sezonu` budget. With no budgets the default `Başlangıç ayı` is September of the current year, so today it is **Eylül 2026**. Check it before `Oluştur`.
   - Use `Önceki 12 aydan doldur`, adjust, then `Onayla` after the board agrees.
5. **The first monthly email after go-live** will carry `arkhe-butce-<M>.csv` once a budget covers M. That is September 2026 if the season budget starts in September. Check once that it opens in Excel with Turkish characters.
6. **Tell the board, in one WhatsApp message:**
   - the `Yönetim` tab replaces `Üyeler` in their phone bar, and `Üyeler` is on the board page and the home card
   - share jobs as `https://arkhe-beta.vercel.app/yonetim/<numara>`
7. **After one month, ask the board two questions** (risk 1 and 2): can they find `Üyeler` when someone joins, and did jobs move out of WhatsApp? Record the answers in `STATUS.md`.

**Local dev note (D41):** every `npm run e2e` and `npm run db:reset` wipes the board and budget rows and reseeds the demo ones, like the ledger. Don't keep real notes in the local DB.

## 5. Backlog (Phase 8 additions; the single list stays in `design/phase-7/review-po.md` §5)

Items 1–16 in `phase-7/review-po.md` §5 are unchanged and still come first. Phase 8 adds items 17–27, ordered by value to the choir. **Suggested first small release:** phase-7 items 1–5, plus 17 and 18.

17. **The future-budget CSV leaves `Gerçekleşen`, `Fark` and `Gerçekleşme` empty** (decision 1). This is a change in `src/lib/finance/csv.ts` plus one e2e check.
18. **Refuse revising an approved plan to zero lines** with `Onaylanmış planda en az bir tutar kalmalı.` (decision 2, DB P3-5). One check plus one e2e.
19. **Comment delete countdown** `Sil · 12 dk` (UX P3-4).
20. **Report and list polish:** the history reason on its own line (UX P3-12); plain-text locked fields on `Notu düzenle` (P3-13); the list's period-bar label (P3-14); the home card `Üyeler` link moved outside the card (P3-16).
21. **Plan editor:** an unsaved-changes guard on in-app links only, with no `beforeunload` (UX/UI).
22. **Backend hardening:** a throttle on board moves/edits (Backend P3-9); the ESLint `no-restricted-imports` rule for `queries-internal` (P3-7); `sqlite_sequence` in the dump (P3-4, same as phase-7 item 12).
23. **Loading skeletons** back on `/finans/[id]` and the budget sub-pages, where they don't break real 404s (decision 7).
24. **Test gaps:**
    - a console/hydration listener in the Phase 8 e2e (AC 43 was checked by hand)
    - the hex grep extended to all of `src/components` (UI P3-11)
25. **DB:** split the archive query (DB P3-4); a trigger-body check in `db:check` (DB P3-6).
26. **The home hero LCP hint** (`loading="eager"` / `priority` on the stage image). This is dev-only noise that predates Phase 8, but it's one prop.
27. **Revisit only on request:** drag-and-drop, notifications, labels, multiple assignees, per-month budget phasing, budgets per event (all `po-spec.md` §5).

## 6. Process note

Phase 8 is **accepted**. It becomes **live** when the user pushes it together with Phase 7 (§4 above and Phase 7 §4) and `db:check` on Turso shows the full migration count. The tech lead records that date in `STATUS.md`.

Phase 9 (audio recording upload, the assistant → conductor → singer review, MIDI) may start its spec. It first needs a free storage decision.
