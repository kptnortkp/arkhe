# Phase 12 spec: Excel and PDF for every export, Excel for import

Author: PO. Date: 2026-10-24. Status: **draft for the build team.** Decisions are in `po-decisions.md` (D119–D132), referred to as `(Dn)`. Amendments are made in place and marked `(amended Dn)`; ACs are never renumbered.

**Process (fast loop):** no separate role plans; one builder (backend + UI) or two in parallel against a short `contract.md`; targeted e2e during the build, one full `npm run e2e` at the end; two reviewers (security; UI + copy); the tech lead accepts.

**Independent of Phase 11** and can run in parallel. No migration. Shared files to coordinate (D132): `package.json` / `package-lock.json` (new dependencies), `next.config.ts` (only if `serverExternalPackages` is needed), `e2e/run.mjs` (suite list), `README.md`, `design/STATUS.md`. No overlap in `src/` with Phase 11.

Inputs:
- **The user's request of 2026-10-24:** "Dosyalar dışa ve içe aktarılırken CSV dışında bir seçenek yok. Export ederken veya indirilirken Excel ve PDF seçenekleri de olsun."
- **Inventory (code read):**

| # | Export | Where the button is | Route | Builder | Formats after this phase |
|---|---|---|---|---|---|
| E1 | Attendance report (`devam`) | `/raporlar` (period, `uyari`) | `raporlar/csv` | `src/lib/attendance/csv.ts` | CSV, Excel, PDF |
| E2 | Finance ledger | `/finans/rapor` range form (`csv-range-form.tsx`, GET `from`/`to`); link from `/finans/hareketler` | `finans/rapor/csv` | `LEDGER_HEADER`/`ledgerRows` in `src/lib/finance/csv.ts` (16 columns) | CSV, Excel, PDF |
| E3 | Dues per period | `/finans/aidat` | `finans/aidat/csv?donem=` | `DUES_HEADER`/`duesRows` | CSV, Excel, PDF |
| E4 | Budget plan vs actual | `/finans/butce/[id]` | `finans/butce/[id]/csv` | `BUDGET_HEADER`/`budgetRows` | CSV, Excel, PDF |
| E5 | Member list for imports | `/ice-aktar` | `ice-aktar/uye-listesi` | `MEMBER_LIST_HEADER`/`memberListRows` | CSV, Excel, PDF |
| E6 | Import templates (6 kinds) | `/ice-aktar/[tur]` | `ice-aktar/[tur]/ornek` | `sampleCsv` in `src/lib/import/docs.ts` | CSV, Excel (no PDF, D126) |
| E7 | Monthly backup email | cron | `src/lib/backup/{reports,run,email}.ts` | attendance, homework (`src/lib/homework/csv.ts`), ledger, dues, budget CSVs | CSVs unchanged + one `.xlsx` (D127) |
| I1 | Historical import | `/ice-aktar/[tur]` (`import-flow.tsx`, `accept=".csv,text/csv,text/plain"`; `decode()` refuses zip with `IS_EXCEL`) | server action → `src/lib/import/run.ts` → `parseCsv` | | CSV, paste, **Excel (.xlsx)** |

- Shared: `src/lib/csv.ts` (BOM, `;`, CRLF, formula guard with `'`, `csvNum` for amounts), `src/lib/money.ts` (`csvAmount` `1250,50`; `formatKurus`/`formatNet` `₺1.250,50`, `−`), import limits `src/lib/import/limits.ts` (1 MB, 5,000 rows, 2,000-char cells), strict cell parsers `src/lib/import/values.ts` (`YYYY-MM-DD` or `D.M.YYYY`, `HH:MM`, amounts `1250,50`).
- **Libraries checked with `npm view` on 2026-10-24** (D120):
  - `write-excel-file` 4.1.1, MIT, published 2026-06, one dependency (`fflate`).
  - `read-excel-file` 9.3.12, MIT, published 2026-10, deps `fflate`, `saxen`, `unzipper-esm`, `worker-f`.
  - `pdfmake` 0.3.12, MIT, published 2026-10, on `pdfkit` 0.20 (MIT, deps `fontkit`, `fflate`, `linebreak`, `@noble/*`).
  - Rejected: `xlsx` (SheetJS) on npm is 0.18.5 from 2022 with known unfixed advisories (prototype pollution, ReDoS); fixed builds are only on SheetJS's own CDN, outside the npm registry. `exceljs` 4.4.0 (MIT) last released 2023-10 with dated `archiver`/`unzipper`/`tmp` deps, kept as the fallback writer. `@react-pdf/renderer` (MIT) has no real table pagination; `jspdf` is browser-first.
- Fonts in the repo: `brand/fonts/Jost[wght].ttf` (variable). Geist comes from `next/font/google` and isn't a file in the repo.

Fixed constraints:
1. **Zero budget:** free OSS libraries only, pinned exact versions; no conversion service.
2. **Authorization unchanged:** each new format runs the exact check and parameter validation of its CSV sibling (`managerOrError()` today).
3. **CSV stays byte-for-byte identical** (previous e2e compare bytes, and Phase 7 compares email attachments to routes).
4. **Server-side generation** in route handlers (`runtime = "nodejs"`), within Vercel Hobby's 60 s and bundle limits; nothing new in the client bundle except the menu.
5. **No migration.**

## 1. Problem

The board opens every report on a phone or a laptop with Excel or Google Sheets. A CSV with `;` opens fine in Turkish Excel but badly in Numbers and some Android apps, and nobody can hand a CSV to the general assembly or print it for the treasurer's folder. On the way in, people keep their old attendance and money lists in Excel, and today the portal answers `Bu bir Excel dosyası…` and makes them convert it.

## 2. Users

| Role | In this phase |
|---|---|
| **Manager** (conductor or board) | Chooses Excel, PDF or CSV for every export; downloads Excel templates; imports an `.xlsx`. |
| **Member** | Nothing changes (no member exports exist today, D129). |
| **Backup recipients** | Get one extra `.xlsx` with every report as a sheet (D127). |

## 3. UI and copy

- **`Dışa aktar` menu** (D121) replaces each `CSV indir` button on E1, E3, E4, E5: a button `Dışa aktar` with a download icon opening a menu with `Excel (.xlsx)`, `PDF`, `CSV`, in that order. Each item is a plain link to the sibling route with the same query string.
- **E2 range form**: the dates stay; the single submit becomes three submit buttons under the label `Dışa aktar:` → `Excel`, `PDF`, `CSV` (each with its own `formAction`), so it works without JavaScript.
- **E6 templates**: `Örnek dosya` becomes two links `Örnek (Excel)` and `Örnek (CSV)`.
- **I1 import**: `Dosya seç (.csv, .xlsx)`; help `Excel'de yalnız ilk sayfa okunur; ilk satır başlık olmalı.`
- New messages (exact):
  - `Eski Excel (.xls) ve .ods dosyaları okunmuyor. Excel'de .xlsx ya da "CSV UTF-8" olarak kaydet.`
  - `Excel dosyası okunamadı. Dosyayı Excel'de açıp yeniden kaydet.`
  - `Satır {n}, {sütun}: formül sonucu yok. Dosyayı Excel'de açıp kaydet, sonra yeniden yükle.`
  - `Bu rapor PDF için çok uzun ({n} satır). Aralığı daralt ya da Excel indir.`
- `IS_EXCEL` (`Bu bir Excel dosyası…`) is no longer shown for `.xlsx`.

## 4. Formats

**Excel (.xlsx)** (D122, D123):
- One sheet, named after the report in Turkish (≤ 31 chars, no `[]:*?/\`), e.g. `Devam`, `Finans`, `Aidat`, `Bütçe`, `Üyeler`.
- Row 1: the same headers as the CSV, bold, frozen, autofilter. Column widths fitted to content (capped).
- Typed cells: amounts are **numbers** in lira (kuruş / 100, exact) with format `#,##0.00`, headers unchanged (CSV already says which columns are money); dates are date cells shown `dd.mm.yyyy`; times `hh:mm`; percentages numbers with `0%`; counts integers; everything else text; empty is empty.
- **No formula cells, ever.** User text that starts with `=`, `+`, `-`, `@` is written as a text cell and shows as typed, without the CSV's `'` prefix.
- File name: the CSV's name with `.xlsx`. Workbook creator `Arkhe Portal`.

**PDF** (D124, D125):
- A4. Orientation fixed per report: landscape for E2 ledger, E3 dues, E1 attendance; portrait for E4 budget and E5 members (rule: more than 6 columns → landscape, set once per report).
- Header on page 1: `Arkhe Mülkiye Çoksesli Korosu`, the report title (e.g. `Devam raporu`), the filter line (e.g. `Dönem: 2026 Güz · Yalnız uyarı alanlar`, `1 Ocak 2026 – 31 Mart 2026`), and `Oluşturuldu: {24 Eki 2026 14:05} · {ad}`. Every page: the table header repeats; footer `Sayfa {n} / {N}`.
- Body font Jost (static Regular and SemiBold instances committed with the OFL licence), embedded and subset. Turkish letters, `₺` and `−` render.
- Amounts right-aligned with `formatKurus`/`formatNet` (`₺1.250,50`, `−₺40,00`); dates `Intl.DateTimeFormat("tr-TR")` Europe/Istanbul; zebra rows; long text wraps; a row never splits across pages; totals rows (where the screen shows them) bold.
- Limit 3,000 rows; above it the §3 message (HTML, status 413).
- File name: the CSV's name with `.pdf`.

**Import from .xlsx** (D128): see S5.

## 5. User stories and acceptance criteria

`(e2e)` = Playwright in `e2e/phase12-*.mjs`. `(manual)` = a go-live check.

### S1. Platform

1. **Dependencies** (D120). `write-excel-file`, `read-excel-file`, `pdfmake` added with exact versions; no `xlsx`/SheetJS. `npm audit --omit=dev` reports no high or critical advisory from them; licences listed in README `Kullanılan açık kaynak paketler`. `npm run build` passes; the new route handlers are `nodejs` and none of these packages appears in a client chunk (bundle check like Phase 9 AC 52). (e2e static + build.)
2. **Font** (D125). Static `Jost-Regular.ttf` and `Jost-SemiBold.ttf` (OFL, from the official Jost release) plus `OFL.txt` live under `assets/fonts/`; the PDF embeds them (no Helvetica fallback in the font list). (e2e: PDF font names.)
3. **Authorization unchanged.** For every new route (`…/xlsx`, `…/pdf` next to each `…/csv`, and the xlsx template): signed out → same response as the CSV sibling; korist@ → same refusal as the CSV sibling; invalid params (bad `donem`, bad range, unknown budget, unknown `tur`) → the same status and message. (e2e matrix.)
4. **CSV untouched.** Every CSV route and every email CSV is byte-identical to the pre-phase output for the seed (snapshot taken before the first change); Phase 2, 5, 7, 8 and 8b CSV suites pass unedited. (e2e.)
5. **One builder, three renderers** (D122). For each export the CSV, Excel and PDF contain the same rows in the same order with the same filters: e2e compares row counts and 3 sample rows across the three for E1 (with `uyari=1`), E2 (a 3-month range), E3, E4, E5. (e2e.)
6. **Response headers.** Excel `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, PDF `application/pdf`, both `attachment` with ASCII `filename` and UTF-8 `filename*` mirroring the CSV name, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. (e2e.)

### S2. The export UI

7. **`Dışa aktar` menu** (D121) on `/raporlar`, `/finans/aidat`, `/finans/butce/[id]` and `/ice-aktar`: opens by tap and keyboard (Enter/Space, arrows, Esc), items `Excel (.xlsx)`, `PDF`, `CSV` in that order, each ≥ 44 px, each downloads the right file with the page's current filters. (e2e.)
8. **Finance range form**: `Dışa aktar:` `Excel` · `PDF` · `CSV` submit buttons use the entered dates; an invalid range shows the existing `Geçersiz tarih aralığı.` for all three; works with JavaScript disabled. `/finans/hareketler`'s link still lands on the form. (e2e, one run with JS off.)
9. **Phone and themes.** At 375 px in light and dark the menu and buttons fit without horizontal scroll and the menu stays inside the viewport; axe clean on the four pages. (e2e.)

### S3. Excel exports

10. **Typed cells** (D123). Unzipping E2's `.xlsx` (e2e reads the XML): an amount `1250,50` in the CSV is the number `1250.5` with format `#,##0.00`; a date is a date serial shown `dd.mm.yyyy`; E1's percentage is a number with `0%`; counts are integers; header row bold, frozen (`ySplit=1`), with an autofilter. (e2e.)
11. **No formulas** (D123). A member named `=HYPERLINK("http://x","y")` and a ledger description `+90 555` appear as literal text cells in E1, E3, E5 and E2; no sheet XML contains an `<f>` element; the text has no added `'`. (e2e.)
12. **Opens everywhere** (manual): E2 and E3 open correctly in Excel (Windows or Mac), Google Sheets on a phone, and LibreOffice: Turkish letters, amounts summable, dates sortable.

### S4. PDF exports

13. **Layout** (D124). E2's PDF for a range with ~200 entries is A4 landscape, has the header block with the range line and `Oluşturuldu: … · {manager name}`, repeats the table header on page 2, and ends each page with `Sayfa n / N`; E4's is portrait with its totals row. (e2e: text extracted with `pdfjs-dist`, a devDependency only.)
14. **Turkish text and money.** Extracted text contains exactly `Şubat`, a member name arranged by the test (`İlkay Göğüş Öztürk`) and `₺1.250,50` / `−₺40,00` where the screen shows them. (e2e.)
15. **Limits.** A ledger range with 3,001 entries (arranged rows) returns 413 with the §3 message and the Excel still downloads; a 3,000-row PDF builds in under 20 s locally. (e2e.)
16. **No extra data.** Each PDF and Excel has exactly the CSV's columns; nothing from the screen that the CSV lacks (no emails in E1, no notes). (e2e: header comparison.)

### S5. Templates and Excel import

17. **Excel templates** (D126). Each of the 6 `/ice-aktar/[tur]` pages offers `Örnek (Excel)`: sheet 1 has the same headers and sample rows as the CSV sample, every column formatted as text (`@`) so Excel keeps `07.10.2025`, `05551234567` and `1250,50` as typed; sheet 2 `Açıklama` lists each column with its rule from `docs.ts`. Importing the untouched Excel template gives the same check result as the untouched CSV template. (e2e.)
18. **Accept `.xlsx`** (D128). The file input accepts `.csv,.xlsx`; an `.xlsx` is recognised by bytes (zip with `xl/workbook.xml`), not by name. `.xls` (OLE) and `.ods` get the §3 refusal; a renamed zip without a workbook gets `Excel dosyası okunamadı…`. The paste tab stays CSV only. (e2e.)
19. **Same rules, same result.** For each of the 6 kinds, an `.xlsx` with the same content as the existing CSV fixture gives an identical check report (counts, errors, row numbers) and, committed, the same rows and the same undo behaviour (8b's batch and undo unchanged). Row numbers in errors are Excel row numbers. (e2e.)
20. **Cell conversion** (D128). Text cells are read as text (trimmed like CSV); integer cells → digits; number cells in amount columns → `1250,50` (more than 2 decimals → the existing `AMOUNT_STRICT` error); date cells → `YYYY-MM-DD`; time cells → `HH:MM`; a date-time cell in a date column takes the date; booleans → `evet`/`hayır`; formula cells → their cached value, or the §3 formula error when there is none; merged cells → the value in the top-left cell only; hidden rows are read. Only the first sheet is read. (e2e fixtures for each.)
21. **Safety.** The 1 MB file limit stays; parsing stops with `Excel dosyası okunamadı…` above 20 MB uncompressed, 5,000 data rows (the existing `TOO_MANY_ROWS` message), 60 columns or a 2,000-char cell (the existing message); a zip-bomb fixture is refused within 5 s; external links and macros are ignored, never followed; parsing happens on the server only. (e2e.)

### S6. Monthly backup email

22. **One extra workbook** (D127). The monthly email keeps its five (or six) CSVs byte-identical and adds `arkhe-rapor-YYYY-MM.xlsx` with sheets `Devam`, `Ödev`, `Finans`, `Aidat` and `Bütçe` (when a budget covers the month), each the same rows as its CSV, typed as in S3. The email body lists it: `- arkhe-rapor-YYYY-MM.xlsx: aynı raporlar tek Excel dosyasında`. The DB dump is unchanged. (e2e: Phase 7 email helpers, attachment list assertion updated only.)
23. **Never blocks the email.** With the workbook builder made to throw (fault hook), the email still goes with the CSVs and the dump, the run is `sent`, and the log says `xlsx skipped`. The 18 MB size guard counts the workbook. (e2e.)

### S7. Quality and the test round

24. **Speed and size on Vercel** (manual, after deploy): E2 for a full year as PDF and Excel each download in under 10 s on production; the function bundle stays under Hobby's limit (build output).
25. **Test round.** Suites `e2e/phase12-a-export.mjs`, `phase12-b-import.mjs`, `phase12-c-email.mjs` pass; earlier CSV, import and email suites pass with only the documented AC 22 edit; one full `npm run e2e` and `npm run e2e:prod` at the end; `npm run lint`, `npm run typecheck` clean. Results in `design/phase-12/e2e-results.txt`.

## 6. Out of scope

- New export surfaces (homework matrix, members page, a member's own history); the homework report stays email-only (D129).
- PDF templates, PDF import, `.xls`/`.ods`/Google Sheets links import, choosing a sheet other than the first.
- Charts, logos or colours in Excel; a logo image in the PDF header (text header only, D124).
- Changing the CSV format, delimiter or file names.
- Excel versions of the static `docs/ice-aktarma/*.csv` files (the in-portal template is the source; the AI prompts keep asking for CSV).

## 7. Open risks

1. **`read-excel-file` edge cases** (shared strings, inline strings, 1904 date system, Google Sheets exports). Mitigation: fixtures from Excel, LibreOffice and Google Sheets in `e2e/fixtures/xlsx/`; fallback is our own reader on `fflate` + `saxen` (both already pulled in).
2. **Bundle size and cold starts.** `pdfmake` + `fontkit` add a few MB to the functions that use them; only the `/pdf` routes import them (dynamic import), so other routes don't pay.
3. **Variable vs static font.** `fontkit` handles variable TTFs poorly, hence the committed static instances (D125).
4. **Excel's own auto-conversion** of templates people fill in (dates, leading zeros). Mitigation: text-formatted template columns and the date/number conversion rules in AC 20.
5. **People print the wrong thing.** A PDF of the ledger with personal names leaves the portal. Same data as the CSV, managers only; nothing new is exposed (AC 16).

## 8. Priorities if time runs short

Cut in this order: AC 22–23 (email workbook) → AC 17 sheet 2 `Açıklama` → PDF for E5 → AC 8's no-JS check. Never cut: AC 3–5, 11, 18–21.
