# Phase 8 review fixes

## Backend

Author: arkhe-backend (implementing). Date: 2026-10-21.

### Tech lead decision TL1 (amends D33): default start of a new budget
`budgetFormDefaults()` (`src/lib/finance/queries.ts`) via `defaultStart(today, existing)` (`src/lib/finance/budget.ts`):
1. If any budget exists, the start is the month after the latest budget ends (its exclusive `end_month`). By the no-overlap rule that month is never covered.
2. With no budget, the start is September of today's Istanbul year.
3. "If that September is already covered, use the next free September" can only apply when a budget exists, and then rule 1 has already picked a free month. So rule 3 is never reached.

The name still follows D33 (`defaultName`). Today (Oct 2026) this gives `2027-09` / `2027–28 sezonu`.

### Fixes
| Review item | Fix |
|---|---|
| Backend P2-1 = DB P2-1 (approve race) | `updateBudget`'s draft branch bumps `revision` when the name or start changes. A note-only save still doesn't. `approveBudget` already CASes on `revision`. Verified with `scratchpad/r8be/approve-race.mjs`: the approval is refused with `PLAN_STALE`, and the budget stays a draft (rev 2). |
| UX P1-1 (future budget) | `phase === "future"` is the upcoming state. In `computeReport`, every line has `signal: "upcoming"`, `signalLabel: ""`, `words: ""`, `pct: null` and `actualKurus: 0`. The totals have `pct: null` and `words: ""`. The net `verdict` is null. New fields: `ComputedReport.upcomingNote` and `BudgetReport.startsLabel`. The CSV `Durum` and `Gerçekleşme` cells are empty. |
| UX P2-2 | TL1 above. |
| UX P2-5 (prefill) | `priorWindow()` caps the window at today. `prefillPlan` returns `partial`, `throughLabel` and `lastFullMonth`. `planForEditor` returns `priorFrom` and `priorThrough`. |
| UX P3-11 | `diffWords(kind, diff, phase)`: after the period ends, an expense under its plan reads `₺… harcanmadı`. `kaldı` is used only while the period is running. Income `eksik` is unchanged. |
| Backend P3-1 / UI P3-4 | `budgetReport` is wrapped in `cache()`. |
| Backend P3-2 (actuals up to today) | **Decision:** the page, the CSV and the list count entries dated up to and including today (Istanbul): `categoryActuals(from, min(end, today + 1))`, and `allBudgets(capExclusive)`. The email counts up to the end of its month. Both are "as of" a day, and future-dated entries never count early. A future budget shows no actuals. |
| Backend P3-3 / DB P3-2 | `markTicketSeen` first reads outside a transaction. If the stored marker already covers the capped values, it returns `{changed:false}` without writing. The upsert also has `where excluded.seen_event_id > seen_event_id or excluded.seen_revision > seen_revision`. |
| DB P3-3 | `budgetGuarded` looks up the other budget's name with a plain `db` read. |
| Backend P3-6 | `createTicket` forgets the attempt on a field error (bad assignee) or an own replay. `addComment` forgets it on `TICKET_NOT_FOUND` or an own `clientKey` replay. |
| DB P3-1 (emoji) | The ticket title minimum and the revision reason minimum are code-point refines (`[...v].length >= 3` / `>= 5`), so they match the CHECK. They give the field message, not the generic one. The maximums were already stricter in JS. |
| Backend P3-5 | `run.ts` checks the 18 MB size without the budget CSV. If adding the budget CSV would pass the limit, it is dropped along with its body line, and the log says `budget attachment skipped (size)`. |

### Contract for the UI engineer
- **Report (`BudgetReport`)**
  - `phase === "future"` is the upcoming state. Use `upcomingNote` (string | null), e.g. `Gerçekleşenler Eylül 2027'den itibaren burada görünür.` The suffix is correct per year (`'den` / `'dan` / `'ten`).
  - `startsLabel` (string | null) is `"Eylül 2027"`, only for a future budget.
  - Lines: `signal === "upcoming"`, `signalLabel === ""`. Render the chip with `UPCOMING_CHIP` (`"Başlamadı"`, exported from `@/lib/finance/budget`). `words === ""` and `pct === null`, so render no bar and no Gerçekleşen. Totals `words === ""` and `pct === null`.
  - `report.tsx` already does this.
- **Editor (`planForEditor`)**
  - New fields: `priorFrom: string` (`"Eylül 2026"`) and `priorThrough: string | null` (`"21 Ekim 2026"` while the prior window hasn't passed, else null).
  - **Open typecheck error:** `src/app/(portal)/finans/butce/[id]/duzenle/page.tsx` must pass `priorFrom={b.priorFrom} priorThrough={b.priorThrough}` to `PlanEditor`. That page isn't mine, and it is the only typecheck error left.
- **`prefillPlan(id)`**
  - It returns `{ lines, partial, throughLabel, lastFullMonth }`, or `{ empty: true, info, partial, throughLabel, lastFullMonth }`.
  - `throughLabel` is the last counted day (`"21 Ekim 2026"`, or the window's last day when it has passed). `lastFullMonth` is the last fully passed month in the window (`"Eylül 2026"`), or null.
  - When `partial`, the numbers only cover entries through today.
- **Create form:** the default start/name now come from TL1. No props changed.
- **Validation:** `🎵🎵` as a title and `😀😀😀` as a reason now return the field messages `Başlık en az 3 karakter olmalı.` / `Gerekçe en az 5 karakter olmalı.`
- **e2e suggestions** (`e2e/*`, for the UI engineer or the tech lead):
  - the approve race (draft, `updateBudget` start change, `approveBudget(id, oldRevision)` → `Bu plan az önce değişti. Sayfayı yenile.`, still a draft)
  - the future-budget CSV `Durum` empty
  - `/finans/butce/yeni` defaulting to `2027-09`
  - the e2e tests that assert `Eylül <this year>` as the default start, or `kaldı` on an ended budget, need updating

### Backlog (skipped)
- A future budget's CSV still writes `Gerçekleşen 0,00` and a negative `Fark` (−plan). Blanking those cells needs `src/lib/finance/csv.ts`, which is outside my edit scope. It's cheap if the PO wants it.
- Backend P3-4: the `sqlite_sequence` rows aren't in the dump.
- Backend P3-7: the ESLint `no-restricted-imports` rule for `queries-internal`.
- Backend P3-8 / UI P3-1: real 404s and 307s under `loading.tsx`. These are route and page changes.
- Backend P3-9: the board write throttle.
- DB P3-4: splitting the archive query.
- DB P3-5: a revision to an empty approved plan (a PO question).
- DB P3-6: the trigger body check in `db:check`.

## UI

Author: arkhe-ui-engineer (implementing). Date: 2026-10-21. Verified: `npm run lint`, `npm run typecheck` clean; `npm run e2e -- phase8-a` 156/156, `phase8-b` 100/100, `phase8-c` 10/10 (full suite left to the tech lead). Screenshots at 375 px light/dark (+ two at 1280) in the scratchpad `p8fix/`.

### Fixes
| Review item | Fix |
|---|---|
| UX P1-1 future budget | `report.tsx`: `phase === "future"` renders `Planlanan gelir / gider / net` and `upcomingNote`; eyebrow `Dönem henüz başlamadı` (no full stop). `LineCard` with `signal === "upcoming"` shows plan only, the muted `CalendarClock` `Başlamadı` chip (`UPCOMING_CHIP`), no Gerçekleşen, words or bar. |
| UX P2-1 | `ActiveChipIntoView` is mounted inside `FinanceNav`, so every finance page scrolls its active chip into view. |
| UX P2-2 | Backend TL1; e2e computes the expected default from `max(end_month)` and creates a draft with the untouched defaults (no overlap). |
| UX P2-3 | Report header keeps one primary (`Onayla` / `Planı değiştir`); `CSV indir` joins it only from `lg`. The rest is in a final `Bütçe işlemleri` section; draft `Sil` is a ghost destructive button. |
| UX P2-4 | `Hiçbir tutar değişmedi.` is `toast.info`; the bar's Net is `whitespace-nowrap`. Save bar is `lg:static` (UX P3-9). |
| UX P2-5 | Hint uses `priorFrom – priorThrough arası yazılır; bu dönem henüz bitmedi, rakamlar eksik olabilir.`; a partial prefill ends with `toast.warning(… ${throughLabel} tarihine kadarki kayıtlar.)` ("tarihine kadarki" avoids a per-year dative suffix). |
| UX P2-6 | Below `lg` the ticket delete is a ghost `İşi sil` after the comment form; from `lg` it stays in the aside (UX P3-6: `Durum` full width, `Düzenle`/`Sil` in a 2-column grid). |
| UI P2-1 | `MoveMenu` no longer sets `disabled` while pending (would drop focus to body): controlled `open` ignores opens while pending, `aria-disabled` instead; the detail variant re-focuses its trigger. |
| UI P2-2 | `rateLimits()` in phase8-a: seeded `login_attempts`; the 30th create passes, the 31st gets `Çok fazla deneme…`, an invalid create doesn't add a row; 60 comment rows → the 61st refused, an empty comment gets its validation message. Note: a blocked attempt still inserts its row, so the test asserts "nothing saved", not "row count unchanged". |
| UI P2-3 | AC 15 now asserts the exact target: the xl column heading `#sutun-takildi` after the last card leaves, the neighbouring card #4 at 1024, the Takıldı tab below xl, and the `Durum: Takıldı` button after a detail-page move. |
| UI P3-1 | Real 404s: `finans/loading.tsx` moved to `finans/(ozet)/` (with `page.tsx`); each finance section (hareketler, aidat, etkinlikler, sponsorlar, rapor, ayarlar, yeni) has its own `loading.tsx` using the new `FinanceSkeleton`; the budget list + skeleton live in `butce/(liste)/`. `/finans/butce/abc`, an unknown uuid, `…/duzenle` and `…/bilgiler` now answer 404. Side effect: `/finans/[id]` and the budget sub-pages no longer show a skeleton. |
| UI P3-2 | `BoardControls` derives the column from `useSearchParams()` (Next syncs `replaceState`), so the bottom-bar tap after a tab switch shows the default column. e2e `tabThenBar()`. |
| UI P3-3 | Last-card move focuses the visible active tab below xl, the heading at xl. |
| UI P3-5/6/7 | `save()` validates every amount before the revise dialog and focuses the first invalid input; the dialog opens with focus on `#reason` (`ConfirmDialog` gained `initialFocus`); a thrown prefill shows `Bir şeyler ters gitti, tekrar dene.` |
| UI P3-8 | Home summary link `py-2.5` (48 px); comment delete buttons are named `<yazar> yorumunu sil, <zaman>: <ilk 40 karakter>` (time alone collided within a minute). |
| UI P3-9 | `plan-editor.tsx` passes prettier. |
| UI P3-11 | `=2+3`: both checks now assert the name never appears in the CSV (and the email body line is literal); labels say so. `badge()` reads the visible copy. `TODAY` is replaced by `istanbulDate()` at each check; the CSV filename accepts the day before or at the request. |
| UX P3-1/2/3/5/7/8/10/15 | `Bağlantıyı olduğu gibi yapıştırabilirsin; tıklanmaz ama kopyalanabilir.`; visible `Aciliyet: Acil`; edit back link `İşe dön`; copy link shows `Bağlantıyı kopyala`; xl Takıldı header gets the `bg-late` dot; editor subtotals sit in the legend row only; desktop Net line has ` · ` before the status/verdict; draft delete copy `Kasa hareketleri etkilenmez.` |
| New e2e | `upcoming()` in phase8-b: the future summary and line cards, the phone action layout, light/dark overflow and targets, an empty CSV `Durum`, the partial prefill hint and toast, and the approve race (start change → `approveBudget(old revision)` → `PLAN_STALE`, still a draft). Ended budgets now expect `harcanmadı`. |

### Skipped (backlog)
- UX P3-4 `Sil · 12 dk` countdown on comment delete.
- UX P3-12 history reason on its own line; P3-13 plain-text locked fields on `Notu düzenle`; P3-14 the list's period-bar label; P3-16 home card `Üyeler` link outside the card.
- UX "unsaved changes" guard in the plan editor.
- UI P3-4 is done by the backend (`cache()`); UI P3-10 (`%91` doc note) is the backend's doc; the hex-grep extension (UI P3-11 last bullet).
- I ran `prettier --write` over `src/app/(portal)/yonetim/` once, which includes `actions.ts`; if it changed anything there it is whitespace only.
