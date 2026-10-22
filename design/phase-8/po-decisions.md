# Phase 8 PO decisions

Author: PO. Date: 2026-10-21. Reads: `po-spec.md`, `ux.md`, `ui.md`, `db.md`, `backend.md`. Every point addressed to me is settled here. Where an AC changes, `po-spec.md` is amended in place and marks the change `(amended Dn)`. **AC numbers are unchanged (1–45).**

The rule I applied throughout: a volunteer choir, phones first, nobody does admin. When two options are equally safe, I took the one that needs fewer explanations to a board member. When the team measured something, the measurement wins over my guess.

## 1. Decisions

### D21. Four columns from `xl` (1280 px), tabs below (D4, AC 5)
- **Decision:** four columns from **`xl`**. At 768 and 1024 px the board uses the same tabs as the phone. There is one card design, with no compact variant.
- **Why:**
  - UX's own measurements decide it. The content widths are 432 / 688 / 944 px at 768 / 1024 / 1280, so columns would be 99 / 163 / 227 px.
  - At 1024, UX needs a second, compact card to make it work, and the assignee name still truncates (`Demo Y…`). Two card variants are twice the testing for a screen size the board barely uses (a landscape tablet).
  - At 1280 the normal card fits, and most board laptops are 1280 px or wider in CSS pixels. Below that, one wide column with tabs reads fine (UI §2.3).
- **The tabs are a `nav[aria-label="Sütunlar"]` of links with `aria-current`**, not an ARIA tablist (UI §2.2). With all four panels visible at `xl`, tab semantics would be false. AC 43 already allows it.
- Amended: D4, AC 4, AC 5, AC 43.

### D22. The bottom bar: `Yönetim` replaces `Üyeler` for managers (D8, AC 2, AC 3)
- **Decision:** I accept UX's swap.
  - **Bar:** the manager bar is `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim` (icon `SquareKanban`), and the D7 badge sits on `Yönetim`.
  - **Sidebar:** the entry stays `Yönetim Kurulu`, between `Finans` and `Üyeler`.
  - **Üyeler:** becomes `sidebarOnly`. On the phone it's reached from an `Üyeler` link in the board header and in the footer of the home `Yönetim Kurulu` card.
  - **Members:** nothing changes (4 tabs).
- **Why:** I sing in a choir. Üyeler is opened a few times a season, when someone new joins: one invite link sent from a phone, once. The board is meant to replace a daily WhatsApp habit, and its only "someone gave you a job" signal is a badge. A badge that lives only in a desktop sidebar and halfway down the home page is a badge nobody sees.
  - The cost is one array entry and one AC wording. The risk (an inviter can't find Üyeler) is covered by two links, and Üyeler's URL is unchanged.
- **The home card stays,** directly **below the hero**, above `Ödevlerim`, for managers only. It also shows the title of the most urgent ticket assigned to me (UX §3), so it's worth a glance.
- Amended: D8, AC 2, AC 3, AC 22, risk 1.

### D23. No suffix after a percentage: rephrase (AC 25, 35, 39)
- **Decision:** UX's rephrasing, and **no `possessivePercent()` helper**.
- **Why:** a helper is code, tests and an edge case (`%0`, `%1000`) that saves no reader any effort. The suffix-free wording is just as clear, and it can't be wrong.
- Final copy:
  - Report header: `Dönemin geçen kısmı: %<p>`, with `<tarih> itibarıyla` on the next line.
  - List row: `Gelir %<x> · Gider %<y> (plana göre)`.
  - Email line: `Bütçe (<ad>, <Taslak|Onaylandı>): gelir plana göre %<x> · gider plana göre %<y>.`
  - When a side's plan total is 0, its part reads `gelir planı yok` / `gider planı yok`. In the list it reads `Gelir —`.
- Amended: D16, AC 25, AC 35, AC 39.

### D24. Elapsed percentage formula (D16, AC 35)
- **Decision:** `p = round((today − start + 1) / totalDays × 100)` in Istanbul plain days, so today counts as passed. It is clamped to 0–100. Before the start, the header says `Dönem henüz başlamadı.`, and after the end it says `Dönem sonu raporu` with no percentage.
- **Why:** the report says "as of today", and today's entries are in the actuals, so today belongs to the elapsed part. UI already assumed this formula; backend asked me to choose.
- Amended: AC 35.

### D25. Net verdict waits for the end of the period (AC 35)
- **Decision:**
  - While the period runs, the Net row shows `Dönem sürüyor`, muted.
  - `Plandan iyi` / `Plandan kötü` appear only once the period has ended.
  - The CSV and the email don't carry a net verdict.
- **Why:** this is the same lumpiness argument as D16. In October the costume deposit is paid and only two months of dues are in, so the line the board reads first would say `Plandan kötü` all year. That trains people to ignore it.
- Amended: AC 35.

### D26. Zero or blank means "not planned": no row, no bar (D13, AC 27, AC 33)
- **Decision:**
  - In the editor, blank, `0` and `0,00` all mean "not planned", and that is not an error. The budget action treats `kurus === 0` as blank (UX's note to backend).
  - A plan line exists in the DB only for an amount > 0, and a CHECK forbids 0 (db §8).
  - Unplanned lines (plan 0, actual > 0) show `Planlanmadı` in the plan cell and `—` as the percentage, with **no bar**. The chip and the words carry the meaning.
- **Why:** there's no denominator, and a fake 100% bar would lie.
- Amended: AC 27, AC 33.

### D27. Status control: a menu button everywhere (D3, AC 13, AC 16)
- **Decision:** the detail page uses the same menu as `Taşı`. It is a button labelled `Durum: <değer>` that opens the other three columns.
  - **No native select that saves on change.** In desktop Chrome, arrow keys fire `change` on every step, so one keypress would move the ticket.
  - The `Düzenle` form doesn't edit the status. The `Yeni iş` form keeps `Durum` (default `Yapılacak`), because nothing is saved until `Kaydet`.
- **Why:** one control, one code path, one toast, and keyboard-safe.
- Amended: AC 13, AC 16.

### D28. Board copy (UX §7)
These are all accepted as UX proposed:
- **Move toast:** `#12 Devam ediyor sütununa taşındı.`, with the action `Göster` (→ `?sutun=<new>`, because on the phone the card leaves the visible tab).
- **Stale refusal:** an error toast with the same copy, `Bu iş az önce değişti. Sayfayı yenile.`, plus the action `Yenile`. The same applies to `Bu plan az önce değişti. Sayfayı yenile.`
- **Due-date system entries:**
  - set: `<ad> son tarih koydu: 15 Kas 2026.`
  - changed: `<ad> son tarihi 15 Kas 2026 → 22 Kas 2026 olarak değiştirdi.`
  - removed: `<ad> son tarihi kaldırdı.`

  The other D5 sentences are unchanged.
- **Empty board:** `Panoda henüz iş yok.`, with `Kurulun yapacağı işleri buraya yaz. Her işin bir numarası olur; WhatsApp'ta “12 numaralı iş” diye paylaşabilirsin.`
- **New-ticket form:** a `Bana ata` shortcut next to `Sorumlu`.
- **Urgency filter below `lg`:** one row, `Herkes` · `Bana atananlar <n>` · `Aciliyet: Tümü ▾`.
  - The dropdown holds 5 links with `aria-current`.
  - When an urgency is set, the trigger shows the value with a filled style, next to a separate 44 px `×` link (`Aciliyet filtresini kaldır`).
  - From `lg`, the chips are inline, with `Tümü` inside the `Aciliyet` group.
  - The URLs and the AC 9 semantics are unchanged.
- **Rate limits** (backend §2.2/2.6): ticket create 30 per hour per user, comment create 60 per 10 minutes per user. When blocked: `Çok fazla deneme. Biraz sonra yeniden dene.` A validation failure doesn't count toward the limit.
- Amended: D5, AC 8, AC 9, AC 10, AC 15, AC 17, AC 18, AC 19.

### D29. Ticket numbers are high-water + 1 (AC 14)
- **Decision:** numbers come from the `board_ticket_seq` counter row (db §1.3), so a deleted number, the highest included, is never reused, even after a backup restore.
- **Why:** `max + 1` breaks when the highest is deleted, and `sqlite_sequence` isn't in the dump. Phase 7 made restore a real procedure.
- Amended: AC 14 (e2e: delete the highest → the next one is highest + 1).

### D30. Moves, `Son değişiklik`, `Yeni` and the revision (D7, D11, AC 12, AC 13, AC 22)
- **A move updates `Son değişiklik`** (backend §2.4). A status change is a change, and a `Son değişiklik` older than the latest status entry looks wrong.
- **A move bumps the ticket's revision** (db §1.5). An editor opened before someone moved the card is refused on save. That's the safe side, it's rare, and the `Yenile` action makes it painless.
- **Acting on a ticket counts as seeing it.** If I comment on it, move it or edit it, my own seen marker advances. So an earlier change by someone else no longer shows `Yeni` for me ("you touched it, you saw it"). I accept that gap (db §8, backend §7.7).
- **Things that do mark a ticket `Yeni`:** title and description edits by someone else (via the revision).
- **Things that don't:** deleting a comment (backend §7.8).
- Amended: AC 12, AC 13, AC 22.

### D31. Board badge attribute: `data-board-badge` (AC 22)
- **Decision:** the board badge uses `data-board-badge={n}`, with the same visuals and `9+`, and the accessible text `, <n> yeni iş`. `data-nav-badge` stays for homework.
- **Why:** Phase 4's test reads the first `[data-nav-badge]` and expects none for sef@. Two badges sharing one attribute invites exactly that kind of confusion in any later test or style.
- Amended: AC 22.

### D32. Archive window: a rolling 30 × 24 h (D9, AC 23)
- **Decision:** a `Bitti` ticket leaves the board once `done_at` is more than 30 × 24 h ago. This is not counted in Istanbul calendar days. The e2e uses 29 days (on the board) and 31 days (archived), never exactly 30. The seed's archived ticket is 40 days old, which stays valid.
- **Why:** the difference is a few hours at the edge, and nobody can see it.
- Amended: D9, AC 23.

### D33. Budget default names and the default start (D12, AC 26)
- **Decision:** the default name follows the start month until the user types in the field:
  - January → `2027`
  - September → `2026–27 sezonu`
  - any other month → the range itself, `Mart 2027 – Şubat 2028` (22 characters, within the 40 limit)
- **Why:** a March–February budget isn't a "season", and `2027–28` would be read as September–August. The range can't be misread. The user can always overwrite it.
- **The default start month is always September of the current Istanbul year.** This is what D12 already meant: in September–December it's the September just gone, and in January–August the coming one. The e2e pins the date.
- **Name uniqueness is exact after trimming** (db §8). Budgets are few, and their names come from the default, so a Turkish case-folded key isn't worth a column.
- AC 26's e2e computes a free January year (`year(today) + 5`) instead of the literal `2028`, which would collide with a seeded season from September 2027 (UI §9.3).
- Amended: D12, AC 26.

### D34. Approval rules (D17, AC 29, AC 31)
- **An empty plan can't be approved:** `Onaylamak için plana en az bir tutar gir.` Approving nothing is always a mistake.
- **The note stays editable after approval,** with no reason and no history entry. It describes assumptions, not numbers. The name, start month and amounts keep their D17 rules.
- **Approve toast:** `Bütçe onaylandı.`.
- **Confirm body:** `Onaydan sonra adı ve başlangıç ayı değişmez. Tutar değişiklikleri gerekçesiyle geçmişe yazılır.`
- **`Planı revize et` becomes `Planı değiştir`.** `Revize` is office jargon. The field `Değişiklik gerekçesi` stays.
- **Draft delete confirm body:** `Plan tutarları da silinir. Kayıtlar (hareketler) etkilenmez.`
- **Create toast:** `Taslak oluşturuldu. Şimdi tutarları yaz.`
- Amended: AC 26, AC 29, AC 30, AC 31.

### D35. Prefill wording (D18, AC 28)
- **Button:** `Önceki 12 aydan doldur`.
- **Hint:** `<Eylül 2025> – <Ağustos 2026> gerçekleşenleri yazılır, liraya yukarı yuvarlanır. Kaydetmeden önce değiştirebilirsin.`
- **If any input already has a value,** a confirm appears: `Yazdığın tutarların yerine önceki 12 ayın rakamları yazılsın mı?`, with `Vazgeç` / `Doldur`.
- **Why:** "last year" was inaccurate (the window isn't a calendar year) and too long for a 343 px button.
- Amended: D18, AC 28.

### D36. Other budget copy (UX §7)
- **Cash note:** `Gerçekleşen: bu tarihlerde kasaya ve bankaya gerçekten giren ve çıkan para. Ödenmemiş aidat sayılmaz.`
- **Empty list:** `Henüz bütçe yok.`, with `Sezon başında planı yaz; portal yıl boyunca gerçekleşenle karşılaştırır.`
- Amended: D14, AC 25.

### D37. CSV: a signed `Fark` through a number-cell path (AC 37)
- **Decision:** accept backend §4.1.
  - `csvNum()` cells, built only from `csvAmount`, are checked against a strict `^-?\d{1,12},\d{2}$` and written unprefixed. Every string cell keeps the formula guard.
  - The bytes of the other CSVs don't change, so Phase 7 AC 11 still holds.
- **Why:** a `'-300,00` in Excel is text, and the auditors' sums would break. The regex can't carry a formula.
- AC 37 is unchanged.

### D38. CSV access: 401 for logged out, 403 for members (AC 24)
- **Decision:** reuse `managerOrError`. A logged-out request gets 401, korist@ gets 403, and neither gets a CSV body.
- **Why:** this is the existing pattern for `/finans/rapor/csv`, and a special case would buy nothing.
- Amended: AC 24.

### D39. The monthly email: best effort, literal oracle, listed attachment (D19, AC 38, AC 39)
- **The budget part is best effort** (backend §5). If building it throws, the email goes out exactly as in Phase 7, and the error is logged. A budget bug must never cost the choir its monthly encrypted backup.
- **Actuals are as of the end of M:** from the budget's start up to and including the last day of M. Nothing after M counts, even when it's dated in range.
- **The e2e uses a literal oracle,** not "a page render with today pinned". No page has a clock override, and I don't want one in production code (UI §9.5). The fixed fixture `E2E 2019–20` (start 2019-09) is used with `?bugun=2020-03-01` (M = 2020-02), and the test writes the expected kuruş literally. The route CSV is compared for header, BOM, CRLF and column count.
- **The `Ekler:` list names the file:** add `- arkhe-butce-<M>.csv: bütçe planı ve gerçekleşen` when it's attached. An unlisted sixth file would confuse recipients. The subject is unchanged.
- **Where the line goes:** the AC 39 sentence goes right after the `Gelir: …` line.
- **Byte-identical without a budget:** with no budget for M, the body is byte-identical to Phase 7.
- Amended: AC 38, AC 39.

### D40. Migration and existing tests (AC 40, AC 41)
- **The migration** creates tables, indexes, and **triggers on the new `budgets` table only** (the no-overlap backstop; SQLite has no subqueries in CHECK). It alters, rebuilds and drops nothing that exists.
- **Phase 1–7 tests pass, with only these intended expectation edits,** each listed in `implementation-notes.md`:
  - the Phase 5 FinanceNav chip list gains `Bütçe` (`e2e/phase5-finance.mjs:175`)
  - any assertion on the manager bottom bar's fifth tab (D22)

  Nothing else in an older test may change.
- **FKs** restrict to `users` everywhere except `board_ticket_reads.user_id`, which cascades. Read marks are disposable per-user UI state (db §8).
- Amended: AC 40, AC 41.

### D41. Seed and test data (Seed, AC 32–36)
- **The seed's board numbers describe open tickets:** 2 assigned to yk@, 1 to sef@, and 1 unassigned. The two `Bitti` tickets are assigned to sef@ (db §8).
- **Two seeded budgets,** both approved and anchored to today's season (UI §9.4):
  - the current season: September of this year if today is September or later, else September of last year
  - the previous season
- **No extra demo ledger entries.** The finance fixture only spans M−2…M, so the past season has actuals only in some months. That's fine for a demo, and extra entries would shift the Phase 5/6 balance expectations. **AC 32–36 arrange their own fixed fixtures:** `E2E 2019–20`, `E2E 2021`, `E2E 2022` and `E2E 2017` from UI §9.3, plus the running-period lines in categories the finance fixture never uses.
- **Every `npm run e2e` and `npm run db:reset` wipes all board and budget rows** and reinserts the demo ones, exactly like the ledger fixture today. Tickets or budgets typed by hand into the local dev DB won't survive a test run. Production is unaffected: the fixtures refuse non-file DBs and `NODE_ENV=production`. The tech lead adds one README line saying so.
- Amended: Seed paragraph, AC 26, AC 32–36.

## 2. Agreements recorded without change

- **UX:** D1–D3, D5–D7, D9, D11–D17, D19, D20; the Turkish labels, `Takıldı`, the 15-minute comment delete, and no drag-and-drop.
- **UI:** no new dependency. Server-rendered columns are switched by one attribute on the client. The card links use `prefetch={false}`. The sticky editor save bar has `pb-24` below `md`.
- **Backend:**
  - The only exports from the `"use server"` files are the actions.
  - Forms carry a `clientKey` and the revision; the comment form remounts after each success.
  - The editor posts all 17 fields, and unknown keys are ignored.
  - System entries are stored structured and rendered at read time, so copy can change without a migration.
- **DBA:**
  - the counter table, the structured events, and the indexes as in db §4
  - no new index on `finance_entries`, since `fe_occurred_idx` covers the actuals
  - the overlap trigger message `budget_overlap`, mapped by `guarded` to the AC 26 overlap error

## 3. Changed copy at a glance

| Where | Final |
|---|---|
| Mobile bar (managers) | `Yönetim` (replaces `Üyeler`) |
| Move toast | `#12 Devam ediyor sütununa taşındı.` + `Göster` |
| Stale | `Bu iş az önce değişti. Sayfayı yenile.` + `Yenile` |
| Detail status | menu button `Durum: <değer>` |
| Due-date entries | `son tarih koydu: …` / `son tarihi … → … olarak değiştirdi.` / `son tarihi kaldırdı.` |
| Urgency filter "all" | `Tümü` in the `Aciliyet` group |
| Empty board | `Panoda henüz iş yok.` + the hint in D28 |
| Rate limit | `Çok fazla deneme. Biraz sonra yeniden dene.` |
| Period header | `Dönemin geçen kısmı: %<p>` / `<tarih> itibarıyla` |
| Net while running | `Dönem sürüyor` |
| List row | `Gelir %<x> · Gider %<y> (plana göre)` |
| Email line | `Bütçe (<ad>, <durum>): gelir plana göre %<x> · gider plana göre %<y>.` |
| Email Ekler | `- arkhe-butce-<M>.csv: bütçe planı ve gerçekleşen` |
| Unplanned plan cell | `Planlanmadı` |
| Revise | `Planı değiştir` |
| Prefill | `Önceki 12 aydan doldur` + hint + overwrite confirm |
| Approve empty | `Onaylamak için plana en az bir tutar gir.` |
| Approve toast / confirm | `Bütçe onaylandı.` / `Onaydan sonra adı ve başlangıç ayı değişmez. Tutar değişiklikleri gerekçesiyle geçmişe yazılır.` |
| Create toast | `Taslak oluşturuldu. Şimdi tutarları yaz.` |
| Draft delete body | `Plan tutarları da silinir. Kayıtlar (hareketler) etkilenmez.` |
| Cash note | `Gerçekleşen: bu tarihlerde kasaya ve bankaya gerçekten giren ve çıkan para. Ödenmemiş aidat sayılmaz.` |
| Empty budgets | `Henüz bütçe yok.` + `Sezon başında planı yaz; portal yıl boyunca gerçekleşenle karşılaştırır.` |

## 4. Nothing cut

All 45 ACs stay. The priorities in `po-spec.md` §8 are unchanged.
