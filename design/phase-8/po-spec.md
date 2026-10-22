# Phase 8 spec: Yönetim Kurulu board (kanban) and budget plan vs actual

Author: PO. Date: 2026-10-21. Status: **amended 2026-10-21 by `po-decisions.md` (D21–D41) and by `review-po.md` §2 (AC 24, 26, 32, 34)**; changed decisions and ACs carry `(amended Dn)`. AC numbers 1–45 are unchanged.

Inputs: the user's two requests of 2026-10-21 (translated in the tech lead's brief), the tech lead's starting points, `design/STATUS.md`, `design/phase-7/review-po.md` (§5 backlog, §6 process note), `design/phase-7/po-spec.md` (format), and the current code: `src/db/schema.ts` (`finance_entries`, `terms`, `users`), `src/lib/finance/categories.ts`, `src/lib/finance/dates.ts`, `src/lib/finance/queries.ts` (`categoryTotals`, `live`, `yearRange`), `src/app/(portal)/finans/rapor/page.tsx`, `src/components/finance/finance-nav.tsx`, `src/components/shell/nav-items.ts`, `src/components/shell/app-nav.tsx`, `src/lib/permissions.ts`, `src/lib/backup/email.ts` and `run.ts`.

Fixed constraints (not up for discussion):
1. **The portal is live** with real data (37 users). The Phase 8 migration is **additive only** (new tables, no change to existing columns or CHECKs), and it is **not deployed before Phase 7 is live** (`phase-7/review-po.md` §6), so the first post-go-live migration has a monthly backup behind it.
2. **Zero budget.** No new dependency is needed. If the team wants one (for example a drag-and-drop library), it must be free/open-source and justified in `ui.md`; my default answer is no (D3).
3. **e2e only.** Every AC is checked by `npm run e2e` (Playwright, real Chrome, dev server, file outbox), by `npm run e2e:prod`, or by a script. "Arrange" means the test writes DB state directly, like Phase 7 did.
4. **Authorize on the server** in every page, action, route and query. Hiding a button is never the check.

## 1. Problem

**A. The board runs on WhatsApp.** "Who's booking the hall for the spring concert?", "Did anyone ask the festival about the fee?", "The costume order is stuck until the treasurer pays the deposit." Today this lives in a busy group chat. Tasks scroll away, nobody knows who took what, and when the board hands over in autumn the new board inherits nothing. The şef and the board want a shared, simple list of work: who does what, how urgent it is, where it is stuck, and a short written trail of what was done.

**B. The budget lives in a spreadsheet, if anywhere.** At the start of a season the board estimates: dues will bring this much, two concerts this much, the festival trip costs that much. At the end of the season nobody compares. The general assembly and the auditors (denetçiler) ask "how did we do against plan?". The ledger already knows every actual kuruş by category. What's missing is the plan, and a report that puts the two side by side, with plain words for "we overspent on travel" and "dues came in 8% under target".

## 2. Users and roles

| Role | Board (A) | Budget (B) |
|---|---|---|
| Şef (conductor) | Full use: opens, edits, moves, assigns, comments. Can delete any ticket. | Same as board (edits, approves, revises). |
| Yönetim kurulu (board) | Full use. Can delete only tickets they opened. | Creates, edits, approves and revises budgets; reads reports; exports CSV. |
| Korist (member) | No access. Pages redirect to `/`; actions are refused. No nav entry. | No access (like the rest of `/finans`). |
| Monthly email (machine) | Nothing. | Adds one budget CSV attachment (D19). |

Why "full use" for every manager: the board is 5–9 people who trust each other and share work. Per-ticket permissions would be admin burden with no real protection. Finance today is edited by every manager (`assertManager()` in `src/app/(portal)/finans/actions.ts`), so the budget follows the same rule.

## 3. Key product decisions (my starting answers to the tech lead's points)

### Board (A)

- **D1. Name, route and column labels.** The page is **`Yönetim Kurulu`** at **`/yonetim`**. The columns use **Turkish labels**, because the UI copy rule is Turkish and the board's own message was in Turkish. The user's English names map one-to-one; the DB keeps English codes:

  | DB `status` | User's name | Label | URL `?sutun=` |
  |---|---|---|---|
  | `todo` | TODO | `Yapılacak` | `yapilacak` |
  | `in_progress` | IN PROGRESS | `Devam ediyor` | `devam` |
  | `blocked` | BLOCKED | `Takıldı` | `takildi` |
  | `done` | DONE | `Bitti` | `bitti` |

  `Takıldı` over `Engellendi`: it is how people speak ("bütçe onayında takıldı").

- **D2. Ticket fields.**
  - `#numara`: a short sequential number (1, 2, 3…), shown on cards and in the URL `/yonetim/12`. People will say "12 numaralı iş" in the group chat.
  - `Başlık`: required, 3–120 characters.
  - `Açıklama`: optional, up to 4000 characters, plain text with line breaks kept. Links are shown as text (D9).
  - `Sorumlu` (assignee): **optional**, one person, chosen from **active conductor and board users**. Unassigned shows `Atanmadı`.
  - `Aciliyet` (urgency): `Düşük` / `Orta` / `Yüksek` / `Acil` (DB `low` / `medium` / `high` / `urgent`), default `Orta`.
  - `Son tarih` (due date): optional plain Istanbul day.
  - `Açan` (creator), `created_at`, `updated_at`, and `done_at` (set when moved to `Bitti`, cleared when moved out).
  - Optional assignee: half of board work is "someone should…". An unassigned card in `Yapılacak` is the honest state.

- **D3. Status changes by a menu, not drag-and-drop.**
  - Every card has a `Taşı` button that opens a menu with the other three columns.
  - The detail page has the same menu as a button `Durum: <değer>` (amended D27). No native select that saves on change.
  - Desktop drag-and-drop is **out of scope**: it's unreliable on phones, hard to make accessible, and would need a library.

- **D4. Layout.**
  - **Below `xl` (375 px, tablets and 1024 px):** a segmented control of four cells with counts (count on top, label below), built as `nav[aria-label="Sütunlar"]` of links with `aria-current`. One column is shown at a time. The default is `Yapılacak`, and `?sutun=` keeps the column across reloads and shared links.
  - **From `xl` (1280 px):** four columns side by side, one card design (amended D21).
  - Measured content widths are 432 / 688 / 944 px at 768 / 1024 / 1280, which gives 99 / 163 / 227 px per column.

- **D5. Activity line (system entries).** These are logged in the thread as **system entries**: muted, no author avatar, and never deletable:
  - creation: `Demo Şef bu işi açtı.`
  - every status change: `Demo Şef durumu Yapılacak → Takıldı olarak değiştirdi.`
  - every assignee change: `Demo Şef sorumluyu Atanmadı → Demo YK olarak değiştirdi.`
  - every urgency change: `… aciliyeti Orta → Acil olarak değiştirdi.`
  - due date (amended D28): set `… son tarih koydu: 15 Kas 2026.`, changed `… son tarihi 15 Kas 2026 → 22 Kas 2026 olarak değiştirdi.`, removed `… son tarihi kaldırdı.`

  Title and description edits are **not** logged. They show only in the `Son değişiklik` line (Phase 6 pattern).

- **D6. Comments are append-only, with a 15-minute delete for the author.**
  - The author can delete their own comment for **15 minutes** after posting (to fix a typo or a wrong ticket). After that it's permanent.
  - There is **no edit**: delete and re-post is simpler, and the thread stays honest.
  - Nobody can delete someone else's comment, the conductor included.
  - Comment length: 1–2000 characters after trimming.

- **D7. "New for me" marker and nav badge: yes, kept small.**
  - There is no email or push notification (out of scope). Without some signal, a board member wouldn't know they were given a job.
  - "New for me" = a ticket **assigned to me**, not `Bitti`, where **someone else** did something (created it, commented, changed any field or the status) after I last opened its detail page, or I never opened it.
  - It shows as:
    - a `Yeni` dot on the card
    - a count badge on the sidebar entry
    - the count on the home card (D8)
  - Opening the detail page clears it for that ticket. Acting on it (commenting, moving, editing) also counts as seeing it (amended D30).
  - It is per user, so my own actions never mark anything new for me. Deleting a comment never marks anything new.

- **D8. Nav placement.**
  - **Sidebar (`md`+):** a new manager entry `Yönetim Kurulu` (icon `SquareKanban`) between `Finans` and `Üyeler`, carrying the D7 badge.
  - **Mobile bottom bar (amended D22):** for managers, `Yönetim` (icon `SquareKanban`, with the D7 badge) replaces `Üyeler`: `Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim`. A sixth tab breaks the bar (measured). `Üyeler` becomes `sidebarOnly` and is reached on the phone from an `Üyeler` link in the board header and in the home card footer. Members are unchanged.
  - The home card sits directly below the hero, above `Ödevlerim`, for managers. It is titled `Yönetim Kurulu`, shows `Sana atanan <n> açık iş`, plus `· <k> yeni` when k > 0 and `· <u> acil` when u > 0, plus the title of the most urgent ticket assigned to me, and links to `/yonetim?kim=ben`. When nothing is assigned it says `Sana atanmış açık iş yok.`, with a `Panoya git` link to `/yonetim`.

- **D9. Archive.** `Bitti` cards whose `done_at` is more than **30 × 24 h** ago (rolling, amended D32) leave the board. They appear on `/yonetim/arsiv` (`Arşiv`), newest first, 50 per page, and they still open by URL. Nothing is ever deleted automatically. Thirty days is long enough to show at the next board meeting what got done.

- **D10. Filters.** Two filters, combinable, kept in the URL and shown as chips:
  - `Herkes` / `Bana atananlar` (`?kim=ben`)
  - urgency: `Tümü`, `Acil`, `Yüksek`, `Orta`, `Düşük` inside an `Aciliyet` group (`?aciliyet=acil|yuksek|orta|dusuk`). Below `lg` the urgency group is one dropdown `Aciliyet: Tümü ▾` with a separate `×` clear link (amended D28).

  The tab counts follow the filters. No search and no label system.

- **D11. Concurrency.** Two people move the same card at the same moment: the second move is refused with `Bu iş az önce değişti. Sayfayı yenile.`, because each move carries the status it was moved *from*. Field edits use the same check, keyed on the revision, and a move bumps the revision (amended D30). The refusal is an error toast with the action `Yenile` (amended D28). Comments never conflict.

### Budget (B)

- **D12. Period: 12 consecutive months, starting at any month; the default start is September.**
  - The choir runs in seasons (September–June rehearsals, concerts in December and spring, a summer break), and the board changes in autumn. So the natural budget is a season. But the ledger report (`/finans/rapor`) is by calendar year, and a dernek's legal accounts are calendar-year.
  - A budget therefore has a **start month** and always covers **12 months**: `[start-01, start+12-01)`, Istanbul days, like `monthRange`.
  - The form defaults to September of the current Istanbul year, and a January start gives a calendar-year budget. One rule covers both; no `terms` dependency. Attendance terms are rehearsal semesters and the wrong unit for money.
  - Budgets may **not overlap**. Gaps are allowed.
  - Name: required, 1–40 characters, unique (exact after trim). The default follows the start month until typed in (amended D33): January `2027`, September `2026–27 sezonu`, any other month the range `Mart 2027 – Şubat 2028`.

- **D13. Plan lines reuse the existing categories.**
  - One planned amount per category: the 6 income and 11 expense categories from `src/lib/finance/categories.ts`, with Turkish labels from `CATEGORY_LABELS`.
  - Amounts are typed like everywhere else (`parseAmount`: `12.500`, `12500,50`, `₺12.500`). Blank, `0` and `0,00` all mean "not planned" and are stored as no row (amended D26).
  - No sub-lines, per-line notes or per-month phasing (§5).
  - The budget has one optional `Not` (up to 500 characters) for assumptions ("2 konser, 40 korist × aylık 300 ₺").

- **D14. Actuals.**
  - Actuals are the sum of `amount_kurus` per category over `finance_entries` with `kind in ('income','expense')`, `voided_at is null`, and `occurred_on` in the budget's range.
  - Transfers and opening balances are excluded. That is the same `live` filter `categoryTotals` uses, so the numbers agree with `/finans/rapor` for the same months.
  - It is cash basis: dues count when paid, not when owed. The report says so in one line (amended D36): `Gerçekleşen: bu tarihlerde kasaya ve bankaya gerçekten giren ve çıkan para. Ödenmemiş aidat sayılmaz.`

- **D15. Signals, with income and expense treated differently.** Per category, `pct = round(actual / plan × 100)` (`—` when plan = 0) and `fark = actual − plan`.

  | Kind | Condition | `data-signal` | Label | Tone |
  |---|---|---|---|---|
  | Income | plan > 0, actual ≥ plan | `met` | `Hedefe ulaşıldı` | good |
  | Income | plan > 0, actual < plan, period not ended | `pending` | `Sürüyor` | neutral |
  | Income | plan > 0, actual < plan, period ended | `short` | `Hedefin altında` | warning |
  | Income | plan = 0, actual > 0 | `unplanned` | `Plansız gelir` | neutral |
  | Expense | plan > 0, actual ≤ 90% of plan | `within` | `Bütçe içinde` | good |
  | Expense | plan > 0, 90% < actual ≤ plan | `near` | `Sınıra yakın` | warning |
  | Expense | plan > 0, actual > plan | `over` | `Bütçe aşıldı` | bad |
  | Expense | plan = 0, actual > 0 | `unplanned` | `Plansız gider` | warning |

  Over-income is good and over-spend is bad. The difference is written in words, so nobody has to interpret a sign:
  - income: `₺1.200,00 fazla` / `₺800,00 eksik`
  - expense: `₺500,00 aşıldı` / `₺300,00 kaldı`
  - exactly on plan: `Planla aynı`

  Lines with plan = 0 and actual = 0 are hidden.

- **D16. Progress during the period: no pro-rating per category.** Choir money is lumpy: dues every month, tickets twice a year, the festival trip once. A linear "to date" plan would flag everything wrong all year.
  - Instead the report shows **how much of the period has passed**: `Dönemin geçen kısmı: %<p>` with `<tarih> itibarıyla` below (amended D23), where p = round((today − start + 1) / total days × 100), Istanbul plain days, clamped 0–100 (amended D24). No suffix after a percentage anywhere.
  - Each category bar has a thin marker at that percentage, so the reader can judge for themselves.
  - Signals compare with the **full** plan, except income `short`, which waits for the period to end (D15).
  - Once the period has ended, the heading reads `Dönem sonu raporu` instead of `Dönem içi durum`. The net verdict waits for the end too (amended D25).

- **D17. Draft → approved, then revisions with a reason.**
  - A new budget is a `Taslak` (draft): freely editable and deletable.
  - `Onayla` marks it `Onaylandı · <ad> · <tarih>`, typically after the board or general-assembly meeting.
  - After approval:
    - the start month and the name are locked, and the budget can't be deleted
    - amounts can still change through `Planı değiştir` (amended D34), which **requires a reason** (5–200 characters)
    - the note stays editable without a reason or history (amended D34)
  - An empty plan can't be approved (amended D34).
  - Each revision is stored and listed under `Değişiklik geçmişi`: who, when, the reason, and each changed line `Seyahat: ₺20.000,00 → ₺26.000,00`.
  - The report always uses the current plan. Plans change mid-season (a festival invitation arrives), and a locked plan would just get worked around. Without a trail, though, the year-end comparison could be quietly rewritten.

- **D18. Prefill.** `Önceki 12 aydan doldur` (amended D35) fills the editor with the actuals of the 12 months before the start month, per category, rounded **up** to whole lira. Nothing is saved until `Kaydet`. A first-time treasurer starts from real numbers instead of a blank page.

- **D19. CSV and the monthly email.**
  - The report has a `CSV indir` button.
  - The Phase 7 monthly email gains **one optional attachment** `arkhe-butce-<YYYY-MM>.csv`. It is for the budget whose range contains the report month, draft or approved, with actuals up to the end of the report month.
  - If no budget covers the month, there is no attachment and no extra line. Otherwise the body gets one line and the `Ekler:` list names the file (AC 39, amended D39). Building it is best effort: a budget failure never stops the backup email.
  - This is the one Phase 7 change, and it reuses the same CSV builder.

- **D20. Where it lives.** `/finans/butce` is a new `FinanceNav` chip `Bütçe` between `Rapor` and `Ayarlar`. Its pages:
  - the list: `/finans/butce`
  - new: `/finans/butce/yeni`
  - the report: `/finans/butce/<id>`
  - the editor: `/finans/butce/<id>/duzenle`
  - the CSV: `/finans/butce/<id>/csv`

  No home card and no Özet card in this phase (§5).

## 4. User stories and acceptance criteria

Copy in backticks is the exact Turkish UI text; the team may polish it in `ux.md`, and I'll settle the final wording in `po-decisions.md`. The e2e notes say how each AC is checked.

**Seed (needed by many ACs; `npm run db:reset` and the e2e reset).**

Board:
- 6 tickets spread over the four columns, with every urgency level present:
  - open tickets: 2 assigned to yk@, 1 to sef@, 1 unassigned; the two `Bitti` tickets are assigned to sef@ (amended D41)
  - one with a past due date and not done
  - one `Bitti` ticket with `done_at` 40 days ago (archived)
  - comments on two tickets
  - one ticket assigned to yk@ that yk@ has never opened (`Yeni`)

Budget:
- two approved budgets anchored to today's season (amended D41): the current season (September of this year if today is September or later, else of last year) with plan lines for at least 3 income and 5 expense categories, and the previous season
- no extra demo ledger entries; AC 32–36 arrange their own fixed fixtures (`E2E 2019–20`, `E2E 2021`, `E2E 2022`, `E2E 2017`, see `ui.md` §9.3)

Every `npm run e2e` and `npm run db:reset` wipes all board and budget rows and reinserts the demo ones, like the ledger fixture. The e2e arranges any extra state itself.

### S1. Access and navigation (şef, board)

*As a board member I want the board's work in one place that only the şef and board can see.*

1. **Access is managers-only, on the server.** sef@ and yk@ open `/yonetim`, `/yonetim/arsiv`, `/yonetim/yeni` and a ticket detail page with status 200. korist@ is redirected to `/` from each of them. A direct call to every board server action as korist@ returns `Bu işlem için yetkin yok.` and changes nothing.
   (e2e: navigate each URL per user; invoke the actions as korist@ through the test helper and compare row counts before and after.)
2. **Nav entry** (amended D22).
   - From `md` up, the sidebar shows `Yönetim Kurulu` between `Finans` and `Üyeler` for sef@ and yk@, and not for korist@.
   - At 375 px the manager bottom bar is exactly `Ana sayfa`, `Çalışmalar`, `Repertuvar`, `Ödevler`, `Yönetim` (→ `/yonetim`), with no horizontal overflow. korist@'s bar is unchanged (4 tabs, no `Yönetim`).
   - On the phone, `Üyeler` is reachable for managers from the board header link `Üyeler` and from the home card footer, both → `/uyeler`.
   - The sidebar entry and the `Yönetim` tab have `aria-current="page"` on `/yonetim` and its subpages.

   (e2e: the tab labels in order per user at 375 px; the sidebar links at 1280 px; both `Üyeler` links at 375 px.)
3. **Home card for managers** (D8, amended D22). On `/`:
   - The card sits directly below the hero and above `Ödevlerim`.
   - When at least one open ticket is assigned to me, it also shows the title of the first one in board order (AC 7).
   - sef@ and yk@ see the `Yönetim Kurulu` card with `Sana atanan <n> açık iş` (n = assigned to them and not `Bitti`), `· <k> yeni` when k > 0, and `· <u> acil` when u > 0.
   - It links to `/yonetim?kim=ben`.
   - With nothing assigned, the text is `Sana atanmış açık iş yok.` and there is a `Panoya git` link to `/yonetim`.
   - korist@ never sees the card, and the home HTML contains no ticket title.

   (e2e: seeded counts for yk@; reassign everything away from sef@ and check the empty text; korist@ HTML check.)

### S2. The board (kanban)

*As a board member I want to see at a glance what's waiting, what's moving and what's stuck, on my phone.*

4. **Mobile layout (375 px)** (amended D21).
   - `/yonetim` shows the title `Yönetim Kurulu`, a primary `Yeni iş` button (≥ 44 px), and a segmented control `nav[aria-label="Sütunlar"]` with four links: `Yapılacak`, `Devam ediyor`, `Takıldı`, `Bitti`. Each shows its count (`data-count`) with the accessible name `<Sütun>, <n> iş`, and the selected one has `aria-current`.
   - Only the selected column's cards are visible. The default is `Yapılacak`.
   - Choosing a tab sets `?sutun=` and survives a reload.
   - The page has no horizontal scroll (`scrollWidth ≤ clientWidth`), in both light and dark themes.

   (e2e: tab counts equal the seeded counts per status; click each tab; reload; overflow check under `colorScheme: 'dark'` and `'light'`.)
5. **Wide layout (≥ 1280 px, `xl`)** (amended D21): the four columns are visible side by side, each with its `h2` heading and count; the `Sütunlar` nav is hidden. At 768 and 1024 px the `Sütunlar` nav is used.
   (e2e: viewport 1280 → 4 visible column regions; viewports 768 and 1024 → `nav[aria-label=Sütunlar]` is visible and one column shows.)
6. **Card content.** Each card (`data-testid="ticket-card"`, `data-status`, `data-urgency`) shows:
   - `#<numara>` and the title, clamped to 2 lines
   - the urgency chip with its label (`Acil` uses the alert tone, `Yüksek` the warning tone, `Orta`/`Düşük` muted)
   - the assignee's name or `Atanmadı`
   - the due date (`15 Kas`) when set; when it's past and the card isn't `Bitti`, `Gecikti · 15 Kas` in the alert tone (`data-overdue="true"`)
   - the comment count, when > 0
   - the `Yeni` dot (D7), with the accessible text `yeni`

   The whole card links to `/yonetim/<numara>`.

   (e2e: assert each element on seeded cards, including the overdue one.)
7. **Order within a column:** urgency (`Acil` → `Düşük`), then due date ascending with no-date last, then most recently updated first. `Bitti` is ordered by `done_at`, newest first.
   (e2e: arrange 4 tickets in one column with mixed urgency/dates and compare the DOM order.)
8. **Empty board** (amended D28): with no tickets at all, `Panoda henüz iş yok.` and `Kurulun yapacağı işleri buraya yaz. Her işin bir numarası olur; WhatsApp'ta “12 numaralı iş” diye paylaşabilirsin.` **Empty column:** `Bu sütunda iş yok.`. With filters active and no match: `Bu filtreye uyan iş yok.` with a `Filtreleri temizle` link to `/yonetim?sutun=<same>`.
   (e2e: all three states.)
9. **Filters** (D10, amended D28).
   - `Herkes` / `Bana atananlar` and the `Aciliyet` group (`Tümü` / `Acil` / `Yüksek` / `Orta` / `Düşük`) set `?kim=ben` and `?aciliyet=…`, combinably.
   - Below `lg`, the urgency group is one dropdown `Aciliyet: Tümü ▾` of 5 links. With a value set, the trigger shows it (for example `Acil`) beside a 44 px `×` link named `Aciliyet filtresini kaldır`. From `lg`, the chips are inline.
   - The cards and the tab counts reflect the filters.
   - The active chip has `aria-pressed` or `aria-current`.
   - An unknown value is ignored, which means no filter.

   (e2e: yk@ with `kim=ben` sees only their 2 seeded tickets; `aciliyet=acil` narrows further; `?aciliyet=xyz` shows everything.)

### S3. Tickets

*As the şef I want to drop a job on the board in ten seconds and give it to someone.*

10. **Create.**
    - `Yeni iş` opens `/yonetim/yeni` with the fields:
      - `Başlık`
      - `Açıklama`
      - `Sorumlu`: a select with `Atanmadı` first, then active conductor and board users by name, plus a `Bana ata` shortcut (amended D28)
      - `Aciliyet`: four options, default `Orta`
      - `Son tarih`: native date input, optional
      - `Durum`: default `Yapılacak`
    - `Kaydet` creates the ticket with the next `#numara` and redirects to its detail page with the toast `#<numara> açıldı.`. The creation system entry is the first item in the thread (D5).
    - Validation (inline, values kept):
      - `Başlık en az 3 karakter olmalı.`
      - `Başlık en fazla 120 karakter olabilir.`
      - `Açıklama en fazla 4000 karakter olabilir.`
      - `Geçerli bir tarih seç.`
    - Rate limit (amended D28): more than 30 creates per hour per user → `Çok fazla deneme. Biraz sonra yeniden dene.`, and nothing is saved. Validation failures don't count.

    (e2e: create one as yk@ assigned to sef@ and check the number, the redirect, the toast, the DB row and the system entry; each validation error.)
11. **Assignee rules.**
    - The `Sorumlu` options are exactly the active users with role `conductor` or `board`.
    - The server refuses a member, an inactive user or an unknown id: `Bu kişi sorumlu olarak seçilemez.`
    - A ticket whose assignee later stopped being an active manager keeps their name, with `(kurulda değil)`. The select then shows them only as the current value, and `Bana atananlar` no longer lists the ticket for anyone else.

    (e2e: compare the options with the DB; post korist@'s id directly → the error; demote an assignee to member → the suffix.)
12. **Detail page `/yonetim/<numara>`.** It shows:
    - `#<numara>`, the title, and the description with its line breaks
    - the status, the urgency, the assignee, and the due date (or `Son tarih yok`)
    - `Açan: <ad> · <tarih>`
    - `Son değişiklik: <ad> · <tarih saat>` when the ticket was edited or moved (amended D30)
    - the thread (oldest first)
    - the comment box at the bottom

    An unknown number, or a non-number, gives the 404 page. The back link `Panoya dön` returns to `/yonetim?sutun=<the ticket's column>`.

    (e2e: seeded ticket fields; `/yonetim/9999` and `/yonetim/abc` → 404.)
13. **Edit.**
    - `Düzenle` on the detail page edits the title, description, assignee, urgency and due date, with the same validation as AC 10. The status is not in this form (amended D27).
    - Any manager can edit any ticket.
    - Saving shows the toast `Kaydedildi.`, updates `Son değişiklik`, and writes one system entry per changed assignee, urgency or due-date field (D5). Title and description changes write none.
    - A stale edit is refused with `Bu iş az önce değişti. Sayfayı yenile.` and the action `Yenile` (D11), and nothing is saved. A move after the editor was opened also makes it stale (amended D30).

    (e2e: sef@ edits yk@'s ticket and changes the urgency and the title → exactly one urgency system entry; stale: load the editor in two pages, save both → the second gets the message; open the editor, move the card in another page, save → the message.)
14. **Delete.**
    - The opener and the conductor see `Sil` on the detail page; others don't.
    - A confirm dialog reads `#12 silinsin mi?` / `İş ve tüm yorumları kalıcı olarak silinir.` with `Vazgeç` / `Sil`.
    - On success it redirects to `/yonetim` with the toast `#12 silindi.`. The number is never reused.
    - The server refuses anyone else: `Bu işi yalnızca açan kişi ya da koro şefi silebilir.`

    (e2e: yk@ deletes their own; yk@ can't delete sef@'s (no button; direct call → the message); sef@ deletes yk@'s; delete the highest-numbered ticket, then create one → it gets the deleted number + 1, never the deleted number (amended D29).)

### S4. Moving work and the activity trail

*As a board member I want to mark a job as stuck and everyone to see when and by whom.*

15. **Move from the card.**
    - `Taşı` on every card (≥ 44 px, accessible name `#12 taşı`) opens a menu with the three other columns.
    - Choosing one moves the card, updates both counts, and shows the toast `#12 Devam ediyor sütununa taşındı.` with the action `Göster` → `/yonetim?sutun=<new>` (amended D28).
    - Moving to `Bitti` sets `done_at`; moving out of `Bitti` clears it.
    - It works with the keyboard alone (Enter/Space to open, arrows, Enter).

    (e2e: at 375 px move a card `Yapılacak` → `Takıldı` and check the counts, the toast and the DB; keyboard-only move at 1280 px; done_at set and cleared.)
16. **Move from the detail page** (amended D27). The menu button `Durum: <değer>` (same menu as `Taşı`) changes the status with the same result and toast as AC 15, and the new system entry appears in the thread without a full reload.
    (e2e: change it with the keyboard; one arrow press alone never moves the ticket.)
17. **System entries** (D5, amended D28).
    - Every status, assignee, urgency and due-date change appends one entry with the actor's name and the old → new values, in the exact copy of D5, and a timestamp (`tr-TR`, Istanbul).
    - System entries are visually muted (`data-kind="system"`) and have no delete control.

    (e2e: after AC 13/15/16, the thread contains the expected sentences in order.)
18. **Concurrent move** (D11). Two sessions both show a card in `Yapılacak`. sef@ moves it to `Devam ediyor`, then yk@ moves it to `Takıldı` from the stale page. yk@ gets the error toast `Bu iş az önce değişti. Sayfayı yenile.` with `Yenile`, and the ticket stays `Devam ediyor` with exactly one status system entry.
    (e2e: two browser contexts.)

### S5. Comments

*As the person doing the job I want to write down what I did, so the next board knows.*

19. **Add a comment.**
    - Below the thread there's a textarea `Yorum yaz…` and a button `Gönder`.
    - On success the comment appears at the end with the author's name and `tr-TR` time, the box clears, and the comment count on the card goes up by one.
    - Line breaks are kept.
    - The empty or whitespace-only comment is refused: `Yorum boş olamaz.`
    - More than 2000 characters is refused: `Yorum en fazla 2000 karakter olabilir.`
    - A double tap creates one comment (the button is disabled while pending).
    - Rate limit (amended D28): more than 60 comments in 10 minutes per user → `Çok fazla deneme. Biraz sonra yeniden dene.`

    (e2e: add, a double click → 1 row, both errors.)
20. **Delete own comment within 15 minutes** (D6).
    - The author sees `Sil` on their own comment for 15 minutes after posting. A confirm `Yorum silinsin mi?` removes it.
    - Other people's comments never show `Sil`.
    - After 15 minutes the button is gone, and a direct call is refused with `Yorum 15 dakika geçtikten sonra silinemez.`
    - Deleting someone else's comment is refused with `Yalnızca kendi yorumunu silebilirsin.`

    (e2e: delete fresh; backdate `created_at` by 16 min → no button + the direct call message; sef@ on yk@'s comment → the message.)
21. **Text safety.** Titles, descriptions and comments are rendered as text: `<script>`, `<b>` and `javascript:` show literally. No markdown, no HTML. URLs are not linkified in this phase.
    (e2e: save `<img src=x onerror=alert(1)>` and assert there's no dialog and the literal text is visible.)

### S6. "New for me" and the archive

*As a board member I want to know when someone hands me a job or replies on mine, without checking every card.*

22. **New marker** (D7, amended D30, D31).
    - A ticket assigned to yk@, not `Bitti`, created or changed by someone else after yk@ last opened it, shows `Yeni` on its card for yk@ only. sef@ doesn't see it unless the same holds for sef@.
    - Opening the detail page clears it, and it stays cleared after a reload.
    - yk@'s own comment, move or edit never marks it new for yk@, and acting on it clears it as opening does. Deleting a comment marks nothing new.
    - The sidebar entry and the mobile `Yönetim` tab show the count badge (`data-board-badge`, `9+` above 9; `data-nav-badge` stays homework-only) with the accessible text `, <n> yeni iş`. The home card count (AC 3) agrees.

    (e2e: seeded new ticket for yk@ → badge 1 and the dot; open → 0; sef@ comments → 1 again; yk@ comments → stays 0.)
23. **Archive** (D9, amended D32).
    - `Bitti` shows only tickets with `done_at` within the last 30 × 24 h. Older ones are listed on `/yonetim/arsiv` (`Arşiv`, linked from the bottom of the `Bitti` column and from the board header as `Arşiv`), newest `done_at` first, 50 per page, with `Daha eski` / `Daha yeni` paging.
    - An archived ticket still opens and can be moved out of `Bitti`; moving it out puts it back on the board.
    - The archive's empty state reads `Arşivde iş yok.`

    (e2e: the seeded 40-day-old ticket is absent from `Bitti` and present on `/yonetim/arsiv`; arrange 29 days → on the board, 31 days → archived, never exactly 30; arrange 51 → 2 pages; reopen one → it's back in `Yapılacak`.)

### S7. Budget: creating and editing a plan (treasurer, board)

*As the treasurer I want to write the season's plan in ten minutes on my phone, starting from last year's real numbers.*

24. **Access and nav.**
    - `FinanceNav` shows `Bütçe` between `Rapor` and `Ayarlar`.
    - `/finans/butce` and all of its subpages are 200 for sef@ and yk@, and korist@ is redirected to `/`.
    - Every budget action as korist@ returns `Bu işlem için yetkin yok.` and changes nothing.
    - The budget CSV route never returns a CSV body to korist@ (403) or to a logged-out request: a 307 to `/giris` with no cookie, or a 401 with a stale cookie (amended D38, review-po decision 6).

    (e2e.)
25. **List** (amended D23, D36).
    - `/finans/butce` lists the budgets, newest start first. Each row shows the name, the range (`Eylül 2026 – Ağustos 2027`), the status chip (`Taslak` / `Onaylandı`), and for the current or past ones, `Gelir %<x> · Gider %<y> (plana göre)` (a side with plan total 0 shows `—`).
    - The budget containing today is marked `Şu anki`.
    - The primary button is `Yeni bütçe`.
    - Empty state: `Henüz bütçe yok.` with `Sezon başında planı yaz; portal yıl boyunca gerçekleşenle karşılaştırır.`

    (e2e: the seeded two budgets in order with the chips; remove all budgets in the DB → the empty state.)
26. **Create** (D12, amended D33, D34).
    - `/finans/butce/yeni` has:
      - `Ad`: follows the start month until the user types in it: January `2027`, September `2026–27 sezonu`, any other month `Mart 2027 – Şubat 2028`
      - `Başlangıç ayı`: a month picker. The default is the month after the latest budget ends, or September of the current Istanbul year when there are no budgets (amended TL1, review-po decision 5)
      - read-only `Bitiş: Ağustos 2027`, updating with the start
      - `Not`: optional
    - `Oluştur` creates a `Taslak`, opens the plan editor and shows the toast `Taslak oluşturuldu. Şimdi tutarları yaz.`
    - Errors:
      - an overlap: `Bu tarihler <ad> bütçesiyle çakışıyor.`
      - a duplicate name: `Bu adla bir bütçe zaten var.`
      - an empty name: `Bir ad yaz.`
      - a name over 40 characters: `Ad en fazla 40 karakter olabilir.`
      - a note over 500 characters: `Not en fazla 500 karakter olabilir.`

    (e2e: the default start equals the month after `max(end_month)`, and `Oluştur` with the untouched defaults succeeds; create a January budget for `year(today) + 5` → that year as the name and `Ocak <y> – Aralık <y>`; pick March → the range name; the default start with a pinned date; overlap with the seeded season → the message; each error.)
27. **Plan editor** (D13, amended D26).
    - `/finans/butce/<id>/duzenle` shows two groups, `Gelir` (6 categories) and `Gider` (11), in the order of `categories.ts`, each with a Turkish label and an amount input (`inputmode="decimal"`, ≥ 44 px).
    - Live totals: `Planlanan gelir`, `Planlanan gider`, `Planlanan net` (gelir − gider, signed).
    - `Kaydet` saves all lines in one write, shows the toast `Plan kaydedildi.`, and returns to the report.
    - Blank, `0` and `0,00` mean "not planned", are not errors, and are stored as no row. Invalid amounts show the existing `parseAmount` messages inline on that line, and nothing is saved.
    - At 375 px there's no horizontal scroll, and the save button stays reachable (sticky or at the end).

    (e2e: enter `12.500`, `3000,50`, `₺1.000`, blank → the DB has 1250000, 300050, 100000 kuruş and no row for blank or `0`; the totals text; `abc` → the error and nothing saved.)
28. **Prefill** (D18, amended D35). `Önceki 12 aydan doldur`, with the hint `<Eylül 2025> – <Ağustos 2026> gerçekleşenleri yazılır, liraya yukarı yuvarlanır. Kaydetmeden önce değiştirebilirsin.`:
    - fills each input with the non-voided income/expense actuals of the 12 months before the start month, per category, rounded up to whole lira
    - leaves categories without actuals blank
    - saves nothing until `Kaydet`
    - when any input already has a value, asks first: `Yazdığın tutarların yerine önceki 12 ayın rakamları yazılsın mı?` / `Vazgeç` / `Doldur`

    If there are no entries in that window: the toast `Önceki 12 ayda kayıt yok.`

    (e2e: arrange entries in the prior window (one voided, one transfer) → the inputs equal the expected sums, with the voided and the transfer ignored; reload without saving → no plan rows in the DB; type one value, then prefill → the confirm.)
29. **Approve** (D17, amended D34).
    - On a `Taslak`, the report has `Onayla`. A confirm `Bütçe onaylansın mı?` / `Onaydan sonra adı ve başlangıç ayı değişmez. Tutar değişiklikleri gerekçesiyle geçmişe yazılır.` / `Vazgeç` / `Onayla`. Success shows the toast `Bütçe onaylandı.`
    - A plan with no amounts is refused: `Onaylamak için plana en az bir tutar gir.`
    - After approval: the chip `Onaylandı`, the line `Onaylayan: <ad> · <tarih>`, and the name, start month and `Sil` no longer offered.
    - The server refuses changing those (`Onaylanmış bütçenin adı ve tarihleri değiştirilemez.`) and deleting (`Onaylanmış bütçe silinemez.`). The note stays editable, with no reason and no history entry.

    (e2e: approve; empty plan → the refusal; direct calls for name/start/delete → the messages; edit the note → saved, no history.)
30. **Delete a draft** (amended D34): `Sil` with the confirm `<ad> silinsin mi?` / `Plan tutarları da silinir. Kayıtlar (hareketler) etkilenmez.` deletes the budget and its lines, then returns to the list with the toast `Bütçe silindi.`
    (e2e.)
31. **Revise an approved plan** (D17, amended D34).
    - On an approved budget, the editor is titled `Planı değiştir` and requires `Değişiklik gerekçesi` (5–200 characters: `Gerekçe en az 5 karakter olmalı.`).
    - Saving with no amount changed is refused: `Hiçbir tutar değişmedi.`
    - A successful save adds one entry under `Değişiklik geçmişi` on the report, newest first: `<ad> · <tarih saat> · "<gerekçe>"`, then one line per changed category, `Seyahat: ₺20.000,00 → ₺26.000,00`.
    - The report then uses the new amounts.
    - A stale save, after another manager revised it in the meantime, is refused: `Bu plan az önce değişti. Sayfayı yenile.` with the action `Yenile`.
    - Draft edits write no history.

    (e2e: revise two lines → one history entry with two lines; no change → the refusal; two contexts → the stale message; a draft save → no history.)

### S8. Budget: the plan-vs-actual report

*As the board I want to see during the season where we stand, and at year end a report I can read out at the general assembly.*

32. **Actuals are correct** (D14). On `/finans/butce/<id>` (the report), each category's `Gerçekleşen` (`data-actual-kurus`) equals the sum of non-voided income/expense entries of that category with `occurred_on` in `[start, min(start+12 months, today + 1))` on the page, the list and the CSV. In the email, it runs up to and including the last day of M (AC 38) (amended review-po decision 3). A budget that hasn't started shows plan only (no actuals, words, % or bars). These are excluded:
    - transfers and opening balances
    - voided entries
    - entries dated the day before the start
    - entries dated the first day after the end

    (e2e: the fixed fixture `E2E 2019–20` (amended D41, `ui.md` §9.3) with literal expected kuruş: first and last day included, the day before and the day after excluded, leap day included, voided/transfer/opening excluded.)
33. **Per-category row** (amended D26). Each shown line (`data-testid="budget-line"`, `data-kind`, `data-category`, `data-signal`) shows:
    - the category label
    - `Plan` (`Planlanmadı` when plan = 0)
    - `Gerçekleşen`
    - the difference in words (D15)
    - `%<pct>` or `—`
    - the signal chip with its label
    - for plan > 0 only, a bar filled to `min(pct, 100)%`, with an over-mark when pct > 100 and the period marker (AC 35); unplanned lines have no bar

    Lines with plan 0 and actual 0 are hidden. Income lines come first under `Gelir`, then expense under `Gider`.

    At 375 px each line is a card, with no horizontal scroll. From `lg` it may be a table, with real `th` headers.

    (e2e: each field on arranged lines.)
34. **Signals** (D15). The arranged lines below produce exactly these `data-signal` values and labels:
    - income
      - plan 1000 / actual 1200 → `met`, `₺200,00 fazla`, `%120`
      - plan 1000 / actual 400, period running → `pending`, `₺600,00 eksik`
      - the same after the period ended → `short`
      - plan 0 / actual 300 → `unplanned`, `Plansız gelir`, `—`
    - expense
      - plan 1000 / actual 800 → `within`, `₺200,00 kaldı` while the period runs, `₺200,00 harcanmadı` after it ends (amended review-po decision 4); unplanned lines carry words too (`₺300,00 fazla`, `₺50,00 aşıldı`)
      - 950 → `near`
      - 1000 → `near`, `Planla aynı`
      - 1300 → `over`, `₺300,00 aşıldı`
      - plan 0 / actual 50 → `unplanned`, `Plansız gider`

    Tone by token: `over` uses the alert token, `near`/`short`/expense `unplanned` the warning token, `met`/`within` the success token. No raw hex.

    (e2e: arrange a budget dated so the period is running; for `short`, arrange a past budget.)
35. **Totals, net and progress** (D16, amended D23, D24, D25).
    - The report header shows the name, the range, the status chip, and either:
      - for a running period: `Dönem içi durum`, then `Dönemin geçen kısmı: %<p>` and `<bugün> itibarıyla`, with p = round((today − start + 1) / total days × 100), Istanbul plain days
      - for an ended one: `Dönem sonu raporu`
      - for a future one: `Dönem henüz başlamadı.`
    - A summary block shows:
      - `Toplam gelir`: plan, actual, %, words
      - `Toplam gider`: same
      - `Net (gelir − gider)`: plan net and actual net, signed. After the period has ended: `Plandan iyi` when actual net ≥ plan net, else `Plandan kötü`. While it runs: `Dönem sürüyor`, muted, and no verdict
    - The period marker on each bar sits at p% (`data-elapsed`).
    - The totals equal the sums of the lines, including the unplanned ones.
    - The cash-basis note of D14 appears once.

    (e2e: the running season, `E2E 2019–20` (ended) and a future January budget: the elapsed text computed in JS by the same formula, the totals arithmetic, all three heading variants, and the net verdict only on the ended one.)
36. **Comparing with the ledger report.** For a budget starting in January, `Toplam gelir` and `Toplam gider` actuals equal the yearly income/expense totals on `/finans/rapor?yil=<that year>&hesap=toplam` (sum of the months).
    (e2e: one consistency check, so the two reports never disagree.)

### S9. Budget CSV and the monthly email

*As the treasurer I want to hand the auditors a file, and to get it every month without asking.*

37. **CSV export** (`CSV indir` → `/finans/butce/<id>/csv`).
    - Format: UTF-8 with BOM, `;` separator, CRLF, the formula-safe `csvCell` from `src/lib/csv.ts`, and amounts `1250,50` (no ₺, no thousands separator), like the other CSVs.
    - Filename: `arkhe-butce-<YYYY-MM start>-<YYYY-MM-DD today>.csv`.
    - Header: `Tür;Kategori;Plan;Gerçekleşen;Fark;Gerçekleşme;Durum`.
    - Rows:
      - the shown income lines, then `Gelir;Toplam;…`
      - the shown expense lines, then `Gider;Toplam;…`
      - then `Net;Gelir − gider;…`
    - Field values:
      - `Fark` = actual − plan, signed (`-300,00`)
      - `Gerçekleşme` = `%120`, or empty when plan = 0
      - `Durum` = the signal label, or empty on the total rows
    - The data matches the report page to the kuruş.

    (e2e: download, parse, and compare with the DOM `data-*` values; a budget named `=2+3 sezon` that a test arranges in the DB does not start a formula in the email body or in any CSV cell.)
38. **Monthly email attachment** (D19, amended D39).
    - When a budget's range contains the report month M, the Phase 7 email carries one more attachment, `arkhe-butce-<M>.csv`: the same format as AC 37, actuals from the budget's start up to and including the last day of M; nothing dated after M counts.
    - Building it is best effort: if it fails, the email still goes out as in Phase 7 and the error is logged.
    - When no budget covers M, the email is exactly as in Phase 7 (four CSVs + the backup).
    - The 18 MB guard counts the new attachment.

    (e2e: in the file outbox, `?bugun=2020-03-01` (M = 2020-02, inside `E2E 2019–20`) → 6 attachments including `arkhe-butce-2020-02.csv`, with literal expected values up to 2020-02-29 (the 2020-08-31 entry excluded, the leap day included); the route CSV has the same header, BOM, CRLF and column count; `?bugun=2018-02-01` → 5 attachments and no `arkhe-butce-*`.)
39. **One line in the email body and one in `Ekler:`** (amended D23, D39):
    - when a budget covers M, right after the `Gelir: …` line: `Bütçe (<ad>, <Taslak|Onaylandı>): gelir plana göre %<x> · gider plana göre %<y>.` A side with plan total 0 reads `gelir planı yok` / `gider planı yok`.
    - and in the `Ekler:` list: `- arkhe-butce-<M>.csv: bütçe planı ve gerçekleşen`
    - otherwise nothing: the body is byte-identical to Phase 7

    The subject and the rest of the Phase 7 body are unchanged.

    (e2e: the `.eml` text in both cases.)

### S10. Live-data safety, quality and the test round

40. **Additive migration.**
    - `drizzle/0008_phase8_board_budget.sql` (the name may differ) only creates tables, indexes, and triggers on the new `budgets` table (amended D40). It does not alter, rebuild or drop any existing table.
    - `npm run db:migrate` on a copy of a Phase 7 database succeeds, and `db:check` passes.
    - All Phase 1–7 e2e tests still pass. The only allowed expectation edits are the Phase 5 FinanceNav chip list gaining `Bütçe` and any assertion on the manager bottom bar's fifth tab (D22), each listed in `implementation-notes.md`.

    (script: migrate a Phase 7 snapshot; grep the SQL for `ALTER`/`DROP`/`__new_`; full `npm run e2e`.)
41. **Constraints back the rules** (for @dba to design):
    - CHECKs on status, urgency, title/description/comment lengths, the budget name, `start_month` format, kuruş integer > 0 for plan lines (0 is stored as no row), and approval fields that are together null or together set
    - FKs `restrict` to `users`, except `board_ticket_reads.user_id`, which cascades (amended D40)
    - comments and lines cascade with their ticket/budget
    - unique `(budget, category)`
    - a unique ticket number

    An invalid direct write fails at the DB.

    (e2e: a few direct inserts that must throw.)
42. **Both themes and the phone.**
    - At 375 px, in light and dark, these pages have no horizontal scroll, and their interactive targets are ≥ 44 px:
      - `/yonetim` (each tab)
      - a detail page with 10 comments
      - `/yonetim/yeni`
      - `/finans/butce`
      - a budget report
      - the editor
    - Focus is visible.
    - Colours come from tokens only: no raw hex in new components (grep).

    (e2e + grep.)
43. **Accessible structure.**
    - The column switcher is `nav[aria-label="Sütunlar"]` of links with `aria-current` (amended D21), and the columns at `xl` are `section`s labelled by their `h2`. The `Taşı` menu and the dialogs have accessible names. The comment box has a label.
    - The budget table/cards expose each number with its label (no number-only cells for a screen reader).
    - No new console errors or hydration warnings on any new page.

    (e2e: role/name queries; a console listener.)
44. **Performance at our scale.**
    - With 300 tickets (200 archived) and 2000 comments arranged, `/yonetim` and a detail page answer in under 1 s on the dev server, and `/finans/butce/<id>` with 5000 ledger entries in range does too.
    - The queries use indexes (no full scan of `finance_entries` outside `occurred_on`).

    (e2e timing, loose; `EXPLAIN QUERY PLAN` script.)
45. **Test round.**
    - `npm run e2e` is green, with new files `e2e/phase8-a-board.mjs`, `e2e/phase8-b-budget.mjs` and `e2e/phase8-c-email.mjs` (names may differ).
    - `npm run e2e:prod` is green, including `/yonetim` and `/finans/butce` refusing korist@ in production mode.
    - `npm run lint` and `npm run typecheck` are clean.
    - The results are saved to `design/phase-8/e2e-results.txt`.

## 5. Out of scope (explicitly)

- **Board:**
  - drag-and-drop
  - notifications by email, push or WhatsApp
  - labels/tags, checklists or subtasks
  - multiple assignees and watchers
  - attachments or file uploads (paste a Drive link as text)
  - linkified URLs and markdown
  - comment editing
  - search
  - recurring tasks
  - members seeing or proposing tickets
  - linking a ticket to a rehearsal, event or ledger entry
  - a calendar view
  - automatic deletion of anything
- **Budget:**
  - per-month phasing and pro-rated "to date" plans (D16)
  - sub-lines and per-line notes
  - budgets per event or project (the existing `Etkinlikler` covers event P&L)
  - accrual basis (dues owed vs paid)
  - multiple scenarios
  - charts beyond the simple bars
  - a home card or `Finans Özet` card
  - PDF export
  - comparing two budgets side by side
  - new categories, or editing the category list
- The Phase 7 email: no change beyond AC 38–39.
- The backlog in `phase-7/review-po.md` §5 stays there; Phase 8 doesn't pick from it.

## 6. Next phases (not specified now)

- **Phase 9:**
  - audio recording upload for homework (replacing "send to the recording email")
  - the review flow: the assistant (şef yardımcısı) listens first, then the conductor, then feedback to the singer
  - MIDI part files

  This needs a free storage decision first.
- **Post-launch backlog:** `design/phase-7/review-po.md` §5, items 1–5 first.

## 7. Open risks

1. **Finding Üyeler on the phone** (amended D22). `Yönetim` took `Üyeler`'s place in the manager bar. Mitigation: the board-header and home-card links. Check with the board after a month; if inviting new singers gets harder, revisit.
2. **Nobody uses it.** A kanban only works if the WhatsApp habit moves. Mitigation: ten-second creation (AC 10), the `Yeni` marker (AC 22), and the shareable `/yonetim/12` URL to paste into the chat. No notifications, by design.
3. **The budget categories may not fit.** A real choir budget may want "kostüm" split, or "festival" as travel + fee. We reuse the 17 existing categories. If the treasurer asks, adding a category is a separate change, because it touches CHECKs on live data.
4. **Cash vs plan timing.** Dues paid late in September for August count in the new season. The note (D14) says it; accrual is out of scope.
5. **Monthly email size and content.** One small CSV (< 5 KB). The budget plan is board data, the same audience as the existing finance CSV. No new privacy surface.
6. **A role change in autumn.** Former board members' tickets keep their name with `(kurulda değil)` (AC 11). The new board reassigns them by hand. No automation.

## 8. Priorities if time runs short

Must, in order:
1. AC 1, 24, 40, 41: access and a safe migration
2. AC 4–6, 10, 12, 15–17, 19: the board's core loop (create, see, move, comment)
3. AC 26, 27, 32–35: a budget plan and a correct plan-vs-actual report
4. AC 37, 38: the CSV and the email attachment
5. AC 2, 3, 42, 43, 45: navigation, phone quality and the test round

Should: AC 7–9, 11, 13, 14, 18, 20–23, 25, 28–31, 36, 39 and 44.

Could: none.

Anything cut gets an entry in `po-decisions.md`. The phase can't be accepted with a Must missing.
