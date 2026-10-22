# Phase 8b implementation notes

## Backend (arkhe-backend)

Date: 2026-10-21. Scope: the server side of the historical CSV import. Finishes the earlier backend engineer's work; nothing of theirs was rewritten. Spec order on conflict: `po-decisions.md` (D17–D34) → `po-spec.md` → `backend.md` / `db.md` → `ui.md` contracts.

### 1. What was built

- **Migration `0009_phase8b_import.sql`**: additive only, with two tables (`import_batches`, `import_items`) and their indexes. It is applied to `data/arkhe.db`, and `db:check` reports `migrations=10/10, quick_check=ok`, with the DBA invariant "undone import batches still have items" in place.
- **Pipeline `src/lib/import/`**: our own strict CSV reader. The steps are UTF-8 check → tokenise → header map (D6/D27 normalisation) → typed cells → per-type rules over one bulk snapshot. Errors carry physical line numbers.
- **Six rule modules** under `rules/`. Each one reads its snapshot in one `batch()` and plans in memory. The plan is a pure function, and its write statements go out in one `batch()` inside a `BEGIN IMMEDIATE` transaction (`tx.ts importTx`, D30).
- **Chunked writes (D29).** Every multi-row insert goes through `insertChunks`, which measures the bound parameters of a real statement and splits so that each statement has **≤ 999** parameters. IN-lists use `chunked()` or subqueries.
- **Business rules are shared with the UI actions (backend §4).** They now live in these modules, and the existing actions call them:
  - `attendance/schemas.ts` (`rehearsalSchema`, `termSchema`, `termConflict`)
  - `roster.ts expectedIds`
  - `close.ts absentRows`
  - `finance/periods.ts`
  - `finance/dues.ts` (`positionOf`, `freezesForRateChange`, `waiverRefusal`, `isDuesPayer`, `beforeOpening`, `overpaymentError`)
  - `finance/entries.ts entryRow/entryEffect`
  - `finance/sponsors.ts`
  - `members/deactivate.ts`
  - `ledger.ts lapsedFreezeDelete`
- **Actions** in `src/app/(portal)/ice-aktar/actions.ts`: `checkImport`, `commitImport`, `undoImport`. Each one calls `assertManager()` first, before anything is parsed.
- **Undo** (`undo.ts`): the stack, the owner rule, and the per-type dependency checks (D13, D17, D28). Imported finance entries are hard-deleted when untouched. Created sponsors are deleted when unreferenced and unchanged. A batch's items are deleted and its batch row stays as `undone`.
- **Download routes**:
  - `/ice-aktar/[tur]/ornek` (sample CSV)
  - `/ice-aktar/[tur]/talimat` (`.md`)
  - `/ice-aktar/uye-listesi` (AC 4, through `csvDocument`)

  All three call `managerOrError()`. korist@ gets the JSON 403, logged-out users are sent to `/giris` by the proxy, and an unknown `tur` gets a 404.
- **Generator** `npm run docs:import` (`scripts/import-docs.ts`; `-- --check` fails when stale). It writes `docs/ice-aktarma/` (README plus the six `.csv` and six `.md` files) from the same functions the routes serve. The downloads are **byte-identical** to the repo files, verified over HTTP for all 12.
- **Read queries** in `queries.ts`. Every export calls `requireManager()`:
  - `importIndex()`
  - `listBatches(page)`
  - `rehearsalImported(id)`
  - `entryRecordNo(id)`
  - `memberListRows()`
- **`listRehearsals({ offset })`** for `/calismalar` paging (AC 36), with an id tie-break so that pages never repeat or skip a row. D34 audit: every caller passes an explicit `limit` (home 30/10, `/calismalar` 60). No history or report path uses the default 200; reports and stats don't call `listRehearsals` at all.
- **Fault hook (AC 19).** The cookie `arkhe_e2e_import_fault=<n>` is honoured only when `NODE_ENV !== "production"` **and** `DATABASE_URL` (default `file:data/arkhe.db`) starts with `file:`. The commit writes about `n/rows` of its statements, then throws, and the transaction rolls back.
- **Double tap (D34): re-validation inside the write lock, no `client_key`.** The second commit re-plans against the first one's result, sees everything as unchanged, returns `kind: "unchanged"` and writes no batch.
- **Config and docs**:
  - `next.config.ts` sets `experimental.serverActions.bodySizeLimit: "1100kb"`.
  - `maxDuration = 60` is set on `/ice-aktar`, `/ice-aktar/[tur]` and `/ice-aktar/gecmis`.
  - `e2e/run.mjs` uses the pattern `/^phase\d+[a-z]?-.*\.mjs$/`.
  - `e2e/lib.mjs cleanup()` deletes imported rehearsals and terms, then `import_batches` (the items cascade), before `seedFinance`. It deletes the `@ornek.com` / `@eski.invalid` users after it.
  - `seedFinance` deletes `import_batches` first.
  - README has the D33 line and the `docs:import` row.

### 2. Changed in this session

| File | Change |
|---|---|
| `src/app/(portal)/ice-aktar/actions.ts` | `try/catch` around check, commit and undo. An unexpected error (constraint, fault hook, Turso) is logged as `{ op, slug, name, code }` only. The user gets `fileError` / `{ error }` with `Bir şeyler ters gitti, tekrar dene.` instead of a thrown action. |
| `src/lib/import/queries.ts` | **Bug fix:** `importIndex()` threw `ambiguous column name: id` (a self-join on a grouped subquery), so `/ice-aktar` answered 500 for everyone. It now uses `id IN (select max(id) … group by kind)`. `listBatches` clamps `page` to an integer from 1 to 1000. |
| `src/lib/import/run.ts` | The commit log line also carries `statements` (the count only). |
| `src/lib/import/undo.ts` | Removed two unused imports (lint). |
| `src/app/(portal)/ice-aktar/[tur]/placeholder-flow.tsx` (new) | A **placeholder** client component that only wires `checkImport` / `commitImport` (file → check → commit, raw JSON output). It exists so the actions are registered and can be tested over HTTP. **The UI engineer replaces it** with `ImportFlow`. |
| `src/app/(portal)/ice-aktar/gecmis/placeholder-undo.tsx` (new) | A **placeholder** `Geri al` button (no confirm), shown when `canUndo`. Replaced by `UndoButton`. |
| `src/app/(portal)/ice-aktar/[tur]/page.tsx`, `gecmis/page.tsx` | Render the two placeholders. |
| `README.md` | The D33 line and the `docs:import` row. |

### 3. Deviations from the plans

- **Batch id is an integer** (`import_batches.id`, autoincrement, which is also the stack order), not a uuid. `undoImport(batchId: number)` takes a number, and `CommitResult.done.batchId` is a number. The commit computes the id in its read batch (`max(id, sqlite_sequence) + 1`, inside the write lock), so the items can reference it within the same write batch.
- **Double commit returns `kind: "unchanged"`**, not the `fileError` that backend §6.3 sketched. It's the same "nothing to change" sentence, carried in `message`.
- **Undo messages** follow the per-type wording, which names the thing:
  - `<ad> bu aktarımdan sonra değişti ya da kullanıldı; geri alınamaz.`
  - `Kayıt <no> bu aktarımdan sonra değişti; geri alınamaz.`
  - `<tarih saat> çalışması bu aktarımdan sonra düzeltildi; geri alınamaz.`
  - `<tarih saat> çalışmasına bir etkinlik bağlanmış; geri alınamaz.`
  - `<ad> dönemi bu aktarımdan sonra değişti; geri alınamaz.`
  - `<ad> dönemine ödeme girilmiş; geri alınamaz.`
- **Fault hook granularity is statements, not rows.** The commit is a single write batch, so "after row n" becomes "after ≈ n/rows of the statements". AC 19 only needs a mid-way failure, and it gets one (for example, 3 of 5 statements for a 100-row file at n = 50).

### 4. Verification

Harnesses live in the scratchpad (not in the repo; the UI engineer's `e2e/phase8b-*` files are the permanent tests): `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/imp8b/`.

- **`samples.ts`**: all six samples, plus each `.md` worked example, in D1 order. For each one: check is clean → commit → re-check is `unchanged`. Then every batch is undone in reverse order, and the DB equals its prior state table by table. **All pass.**
- **`edge.ts`**: 94 checks, **all pass** on two consecutive runs.
  - **Format:** empty file, header only, 1 MB + 1 byte, xlsx zip, UTF-16 BOM, Windows-1254 `ş`, NUL, multi-line cell, bad quotes, unknown / duplicate / missing / blank-with-data headers, 5001 rows, extra cells (blank cells OK), fewer cells, `EPosta` / `KATILIM_TARIHI` / `Katılım tarihi`, `,` + CRLF, a lone CR with true line numbers after blank lines, BOM, a 2001-character cell, an in-file duplicate email.
  - **Values:** date formats, 30 Feb, before 2000, future dates, codes and aliases, amounts (`1.250`, `₺100`, `1 250`, `0`, `0,00`, too large, `1250.5`), `kayit_no` format, the dues category, a same-account transfer, a date before the opening.
  - **Permissions (D27, AC 25):**
    - yk@ with an **unchanged** sef@ row: no error (1 güncellenecek · 1 değişmeyecek).
    - yk@ changing sef@, another board member or their own row: `Bu kişiyi yalnızca koro şefi değiştirebilir.`
    - sef@ can change a board member.
    - Self-deactivation is refused.
    - A rate for a conductor is refused.
    - Unknown email and former-member rules work.
  - **AC 15:** a clean and a broken check leave every table unchanged, sessions included.
  - **Hash:** a swapped file is refused, and a missing or invalid hash gets `Önce dosyayı kontrol et.` Nothing is written.
  - **D34 race:** three concurrent commits of one file (sef ×2, yk ×1) give `done, unchanged, unchanged`, +1 batch and one term.
  - **Undo (AC 38, AC 40):** each of these is refused, and a refused undo changes nothing:
    - not latest
    - not the owner (yk on sef's batch)
    - missing
    - already undone (replay)
    - a dues period edited by hand
    - a dues period with a hand payment
    - a corrected attendance row
    - an event linked to an imported rehearsal
    - an attendance row deleted
    - a voided entry
    - a corrected entry (`revision`)
    - a member edited after a `uyeler` import
    - board undo after the affected user was promoted to board

    Each case succeeds once restored. Undone entries are really deleted (D17).
  - **AC 19:** with the fault hook at 50 of 100 rows, every table is unchanged: batch, sponsors, entries.
- **`http.mjs`** against the dev server: 46/46 pass.
  - sef@ gets 200 on the pages.
  - All 12 downloads equal `docs/ice-aktarma/*` byte for byte.
  - Member list: BOM, header, `arkhe-uyeler-YYYY-MM-DD.csv`; an unknown `tur` gets 404.
  - korist@: `/ice-aktar` redirects to `/`; the three routes give the JSON 403 with no file; check, commit and undo are denied and nothing is written.
  - Logged out: 307 to `/giris?next=…`.
  - Crafted requests: an unknown slug or a missing file gives `Dosya okunamadı…`; 1 MB + 1 through the action gives `Dosya en fazla 1 MB olabilir.`; exactly 1 MB passes the body limit.
  - The fault cookie gives the generic error, with nothing written.
  - Two concurrent HTTP commits give `done, unchanged`; a swapped file is refused.
  - yk@ can't undo sef's batch; a non-integer id is refused; undo works, and a replay is refused.
- **Timings (AC 44)**, in-process against the local file DB (dev machine):

| File | Bytes | Check | Commit | Write statements (1 batch) | Re-check | Undo |
|---|---|---|---|---|---|---|
| `yoklama`, 5000 rows (139 rehearsals × 36) | 210,738 | 29 ms | 115 ms | 45 | 28 ms | 10 ms |
| `hareketler`, 5000 rows (with transfers and new sponsors) | 388,366 | 51 ms | 350 ms | 129 | 75 ms | 64 ms |

  The commit is BEGIN, one read batch, one write batch, then COMMIT, so about 4 round trips plus the session read, whatever the row count (D30). That stays well inside the limits in `iad1` as well.
- **`npm run lint`, `npm run typecheck`, `npm run db:check` and `npm run docs:import -- --check`** are clean.
- **Targeted e2e** (`npm run e2e -- <prefix>`, the way `run.mjs` runs them; not the full suite):
  - `phase1-` 18/18
  - `phase5-` 118/118
  - `phase7-` 136/136
  - `phase2-` 91/91

  **Environment note on `phase2-`:** it failed twice at AC 8 ("Yoklamaya katıldın"). The cause was not this phase's code. The seeded rehearsal "today 19:00" (`4773b66d…`) had been opened by hand at 17:45, so korist@'s home hero and its `Geldim` targeted that rehearsal, not the test's `E2E Canlı`, and the code was refused. I moved that rehearsal +3 days, ran phase 2 green (91/91), and put it back. Phase 2 is time-of-day sensitive whenever a seeded rehearsal is live (about 17:00–21:30 on seeded rehearsal days). This is a pre-existing test-isolation gap, for the tech lead.

### 5. Contract for the UI engineer

**Imports.**
- **Isomorphic** (safe in client components): `@/lib/import/limits`, `@/lib/import/types`.
- **Server components only:** `@/lib/import/def` (`headerLine`, `fileBase`), `@/lib/import/docs` (`columnDocs(def)`, `promptText(def)`), `@/lib/import/defs` (`defOf(slug)`, `DEFS`).
  - `ImportDef` holds Maps in its code tables, so don't pass `def` to a client component.
  - Pass strings instead: `promptText(def)` for the copy button, and the `columnDocs(def)` rows for the table.

**Actions** (`src/app/(portal)/ice-aktar/actions.ts`). Bind the slug in the server page, as the placeholder does: `checkImport.bind(null, def.slug)`.

```ts
checkImport(slug: string, formData: FormData): Promise<CheckResult>
commitImport(slug: string, formData: FormData): Promise<CommitResult>
undoImport(batchId: number): Promise<FormState>
```

FormData fields:
- `file`: the `File`. For pasted text, `new File([text], PASTE_FILE_NAME, { type: "text/csv" })`, with `PASTE_FILE_NAME = "yapistirilan-metin.csv"` from `limits.ts`.
- `sha256`: on commit only, `result.file.sha256` from the clean check.
- Send the **same bytes** you checked: keep the `File` or the text in state. React resets the form after an action.

**Result kinds** (`types.ts`). Every Turkish sentence comes from the server.

| kind | when | show |
|---|---|---|
| `denied` | not a manager | `message` |
| `fileError` | size, encoding, Excel, tokenizer, header, 0 / > 5000 rows; on commit also hash mismatch, `Önce dosyayı kontrol et.`, and the generic failure | `message`; `messages[]` holds every header problem, one per line. `file` may be `null`. |
| `errors` | row errors | `summary`, then `errors[]` (≤ 1000, file order, `line` = physical line with the header at 1, `column` may be `null`), `errorCount` (the true total), `capped`. On commit, `afterCheck: true` means the data changed after the check. |
| `clean` | check only | `summary`, `warnings[]`, `balances?`, `notes[]`, `effects[]` (≤ 50), `effectsMore`, `counts`, `deactivations` |
| `unchanged` | nothing to write (re-import or double tap) | `message` (`Değişecek bir şey yok; …`), `warnings` (may include `sameFile`); no button |
| `done` | commit only | `message`, `links[]`, `hint?` (`uyeler` only), `batchId: number`, `counts` |

**Warnings.** Each warning is `{ kind, text, items? }` with kind `deactivate`, `nameMismatch`, `autoAbsent`, `newSponsor`, `sameFile` or `other`.
- `deactivate` comes first and is never collapsed. Its `items` are the names.
- `nameMismatch` is one line. Its `items` go in `<details>` under `Listeyi göster` (D31).

**Balances** (`hareketler` and `aidat-odemeleri` only): `{ cash: { before, after }, bank: { before, after }, hint }`. The amounts are kuruş; format them with `formatKurus`. `hint` is the D19 sentence.

**Confirm dialog** (D31):
- Title: `<counts.added + counts.updated> değişiklik aktarılsın mı?`
- When `deactivations > 0`, the extra line `<k> kişi pasifleşecek ve oturumları kapanacak.`

**Size and errors.**
- Pre-check `file.size > IMPORT_MAX_BYTES` (1,048,576) on the client and show `TOO_BIG` from `limits.ts`.
- Next rejects any body over 1100 KB **before** the action runs, and then the action call throws. Keep the pre-check, and wrap the action calls in `try/catch` (fall back to `Bir şeyler ters gitti, tekrar dene.`). The server never throws for any file within the limit.

**Copying errors** (D22, D23). The copy text is built on the client: the preface, a blank line, `Satır <line> · <column>: <message>` for each error (or `<message>` when `line` is `null`), plus the closing line when `capped`.

**Undo.** `undoImport(id)` returns `{ success: "İçe aktarma geri alındı." }` or `{ error }`, which suits `useRunAction`. Show `Geri al` only when the row's `BatchRow.canUndo` is true. The server re-checks everything.

**Page reads.** These are server-only and each calls `requireManager()`, so call them only for managers:
- `importIndex()` → `{ steps: StepCard[] (slug, step, title, summary, last {at, by, rows} | null, next), lastBackupAt: Date | null, opening: { date, cash, bank } | null }`
- `listBatches(page)` → `{ batches: BatchRow[], hasMore }`, 50 per page. `BatchRow` has `id, slug, title, createdAt, by, fileName, fileSize, sha12, counts, undone {at, by} | null, latest, canUndo`.
- `rehearsalImported(id)`: boolean.
- `entryRecordNo(id)`: string or null, for the AC 35 chips.

**`/calismalar` paging** (AC 36): `listRehearsals({ to: todayStart, order: "desc", limit: 61, offset: (n - 1) * 60 })`.

**Still yours:**
- Replace the two `placeholder-*.tsx` files and the three placeholder pages.
- `loading.tsx`.
- The Ayarlar, profil and yedek links.
- The chips.
- The `/calismalar` pager.
- `e2e/phase8b-*.mjs`, plus `e2e:prod` asserting that the fault cookie is inert.

**Crafting requests in e2e.** The bound call encodes as multipart: field `0` = `JSON.stringify([slug, "$K1"])`, and the FormData entries are named `_1_file` and `_1_sha256`. POST it to `/ice-aktar/<slug>` with the header `Next-Action: <id>` (the ids come from `actionIds("src/app/(portal)/ice-aktar/actions.ts", …)`). `http.mjs` in the scratchpad has a working `call()` helper.

## UI (arkhe-ui-engineer)

Date: 2026-10-21. Scope: the Phase 8b screens, the entry links, the markers, the `/calismalar` pager and the `phase8b-*` e2e. The import library was not changed: no bug blocked the UI.

### 1. What was built

| File | Kind | Content |
|---|---|---|
| `src/app/(portal)/ice-aktar/page.tsx` | Server | Index (AC 3): back link `Profil`, intro, `Başlamadan önce` (backup line with link, order, member list + privacy line), step 0 (dashed, opening line in `text-late-ink`, `Ayarlar'a git`), six step cards (whole card is the link, done disc with `Check` + sr-only `n. adım, aktarıldı`, `Sıradaki` chip from `importIndex().steps[].next`), `İçe aktarma geçmişi`. |
| `src/app/(portal)/ice-aktar/[tur]/page.tsx` | Server | Header (`ADIM n / 6`, explanation, `Önce:` prerequisite line from `importIndex()`, board-only note for `board` on `uyeler`), `1 · Dosyanı hazırla` (prompt copy primary, two `<a download>`, `Nasıl yapılır?` disclosure), `<ImportFlow>`, `Sütunlar` (header block + `Başlığı kopyala` + `ColumnTable`). Only strings and `columnDocs(def)` rows cross to the client; `def` never does. |
| `src/app/(portal)/ice-aktar/gecmis/page.tsx` | Server | Log (AC 37): cards newest first, status chip, `Geri al` when `canUndo`, the "only the importer or the conductor" line on the latest batch otherwise, `?sayfa=` paging with the shared `Pager`. |
| `src/app/(portal)/ice-aktar/{,[tur]/,gecmis/}loading.tsx` | Server | Skeletons. |
| `src/components/import/import-flow.tsx` | Client | The only island: `Dosya seç` / `Metni yapıştır` tabs (base-ui `Tabs`, 44 px triggers), drop-zone label over an `sr-only` native input (`aria-labelledby` keeps its name exactly `Dosya seç (.csv)`), byte snapshot of the picked file, 1 MB client pre-check, `try/catch` around both actions, an always-present `role="status"` region (`data-testid=import-summary`) holding only the summary sentence, and the result states (file error, row errors, unchanged, clean, done). |
| `src/components/import/column-table.tsx` | Server | Table from `md` (`table-fixed`, 18/12/14/24/14/18 %), stacked cards below; renders the definitions' backticks as code chips. |
| `src/components/import/undo-button.tsx` | Client | `Geri al` + `ConfirmDialog` (destructive), finance line for `hareketler`/`aidat-odemeleri`, refusal inline as `FormMessage role=alert` inside the card, success toast. |
| `src/components/pager.tsx` | Server | `Daha yeni` / `Daha eski` (`h-11` outline links, `rel`), `pageParam()` (1–1000, else 1). |
| `src/components/copy-button.tsx` | edit | `useCopy(title)` hook: toast text per caller, and a dialog with the pre-selected read-only textarea when both clipboard paths fail (ux §0.3). `CopyButton` gains `toastText`, `fallbackTitle`, `variant`. Existing callers keep `Kopyalandı.`. |
| `calismalar/page.tsx` | edit | Past tab: `limit: 61, offset: (n−1)·60`, `Pager`; the `devamın` card only on page 1. |
| `calismalar/[id]/page.tsx`, `finans/[id]/page.tsx` | edit | `İçe aktarıldı` chip (managers only, neutral outline + `FileUp`) and `İçe aktarıldı · Kayıt no <n>` in the audit block. |
| `profil`, `yedek`, `finans/ayarlar` | edit | `Veri içe aktar` entry points (AC 2), per ux §1. |
| `[tur]/placeholder-flow.tsx`, `gecmis/placeholder-undo.tsx` | deleted | Replaced. |

### 2. Decisions and deviations

- **Focus after a check:** focus stays on `Kontrol et`, the result area scrolls into view, and the status region announces the summary. After a commit the button is gone, so focus moves to the outcome sentence (`tabIndex=-1`). This is ui §3.1 plus ux §0.1's scroll; I didn't move focus on check because that would read the whole card instead of one sentence.
- **Summary card for clean results:** the visible `n satır okundu` and the three tiles are `aria-hidden`; an `sr-only` copy of the AC 17 sentence sits in the card, and the live region carries the same sentence.
- **Copy text format:** `Satır n · sütun: mesaj`, `Satır n: mesaj` with no column, `mesaj` with no line. Each error `<li>` carries it as `data-text` for the tests.
- **"İçe aktarıldı" + `Sıradaki` result button:** links come from `result.links`; the primary button is `Sıradaki: n+1 · <başlık>`, or `Adımlara dön` on step 6.
- **`ve <k> hata daha (ilk 1000'i kopyalanır)`** is shown verbatim per D23, even for 120 errors.
- **Hydration marker:** `#sonuc` gets `data-ready` once hydrated (`useSyncExternalStore`, no effect). The tests wait for it, because a file set before hydration lost its `onChange` (seen once).
- **korist@ redirect is client-side** on pages with a `loading.tsx` (status 200, then a redirect after the shell streams), exactly like `/yedek`. The tests wait for the URL. Nothing leaks: the shell is a skeleton.
- **Pager status** is `Sayfa n`, not ux's `61–120 / 130`, because there's no `count(*)` (ui §5).
- Cut, as decided: `Hataları indir (.txt)` (D23), `?geri=ice-aktar` (D32).

### 3. e2e

| File | Checks | Covers |
|---|---|---|
| `e2e/import.mjs` | helper | fixtures in code (`csv`, `win1254`), cast, `snapshot`/`diff`, `checkUI`/`commitUI`/`importUI`, crafted `(slug, formData)` calls and `undoImport`, clipboard |
| `e2e/phase8b-a-format.mjs` | 109 | AC 1–6, 8–16, 43 (375 px light/dark overflow + 44 px targets on index, six type pages, errors, clean, log; hex grep) |
| `e2e/phase8b-b-types.mjs` | 88 | AC 3, 7 (samples and every `.md` example), 9 (paste logged as `yapistirilan-metin.csv`), 13–15, 17–18 (confirm, double tap, two concurrent commits, swapped file, DB change between steps, batch row/schema), 20–33, 34 (reduced, see §5), 35, 36 (130 arranged rehearsals, three pages), 38–39 (the whole stack undone through the log page, DB equal to before) |
| `e2e/phase8b-c-undo.mjs` | 29 | AC 19 (fault cookie at 50 of 100 rows, every table unchanged), 37, 38, 39, 40 (corrected attendance, linked event, voided entry, edited member, hand payment, edited period), 42, 44 |
| `e2e/prod.mjs` | +2 | `/ice-aktar` redirects a member and the member list answers 403; with the fault cookie set, a production import succeeds in full |

Timings (dev server, AC 44): 5000-row `yoklama` check 353 ms, import 1359 ms; 2000-row `hareketler` check 408 ms; index 59 ms and log 128 ms with 50+ batches.

**Results:** `phase1-` 18/18, `phase2-` 91/91, `phase5-` 117/118 (see §5), `phase7-` 136/136, `phase8b-` 226/226, `e2e:prod` 56/56. `npm run lint` and `npm run typecheck` are clean.

### 4. Phase 2 isolation fix

`cleanup()` now resets every rehearsal starting **today or later** (Istanbul): `opened_at`/`closed_at` are set to null, and their attendance rows are deleted. The seed never opens or marks today's or future rehearsals, so this restores seed state. Past seeded rehearsals (the closed weeks, yesterday's forgotten one, the untaken sectional) keep their designed state. I chose this over isolating phase 2 because any later test that reads the member's home hero has the same exposure. Verified: at 21:4x, with seeded `4773b66d…` left open, `phase2-` ran 91/91.

### 5. Open points for the tech lead

- **phase5 AC 13 reads 19 debtors, not 18.** The cause is `asistan@arkhe.local` from the Phase 9 media fixture (in flight; `scripts/media-fixture.mjs` changed at 21:36). It joined this month and owes Ekim 2026. `finance-fixture.mjs` already excludes it from the P1/P2 roster, but phase5's count doesn't yet. It's not from 8b.
- **Shared dev DB:** while the Phase 9 engineer's e2e ran, their `cleanup()` wiped my arranged cast mid-run twice (screenshots, one flaky check). The final runs above were clean. Run the full suite only when nobody else is running e2e.
- **AC 34 is reduced.** The tests check that imported rehearsals land in the term report CSV, the past list and the detail page, and that imported entries and payments land in `/finans`, `/finans/aidat` and the balances. A hand-made vs. imported **paired** comparison isn't automated: a hand-made past rehearsal can't be created through the UI (the 24 h rule).
- Screenshots: `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/p8bshots/` (375 light/dark, 1280 light complete; 1280 dark up to the clean preview).
