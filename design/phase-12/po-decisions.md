# Phase 12 PO decisions

Author: PO. Date: 2026-10-24. The decisions behind `po-spec.md`. Numbering continues from Phase 11 (D91–D118). Later Phase 12 decisions (from the build or review) go here from D133 onward; later Phase 11 decisions take the next free number after the highest in either file.

**Changes from the user's request:**
- D126: templates get Excel but not PDF (a PDF template can't be filled in).
- D127: the backup email keeps its CSVs and adds one workbook, rather than switching.

**D119. Phase 12 is independent of Phase 11.** No migration and no shared `src/` files; it can be built in parallel or after. Deploy order doesn't matter.

**D120. Libraries: `write-excel-file` (write), `read-excel-file` (read), `pdfmake` (PDF), all MIT, pinned exact.**
- `xlsx` (SheetJS) is rejected: the npm package is frozen at 0.18.5 (2022) with known advisories, and the fixed builds come from SheetJS's own CDN, outside the registry and `npm audit`. We don't take a security-relevant parser from a tarball URL.
- `exceljs` (MIT) works but hasn't released since 2023-10 and drags `archiver`, `unzipper`, `tmp`; it is the fallback writer if `write-excel-file` can't do frozen panes, autofilter or number formats.
- `pdfmake` gives declarative tables with repeating headers, page breaks, landscape and headers/footers on top of `pdfkit`; raw `pdfkit` would mean writing a table layout engine. `@react-pdf/renderer` lacks robust table pagination.
- All imports are server-only and lazy, so the client bundle and unrelated routes don't grow.

**D121. One `Dışa aktar` menu per export, Excel first.**
- Three formats behind one button keep the toolbar as small as today on a phone. Excel is first because that's what the board opens; CSV stays for the AI and import round trip.
- Formats are sibling routes (`…/xlsx`, `…/pdf` next to `…/csv`), not a `?bicim=` parameter on `/csv`: existing URLs, bookmarks and e2e stay valid, and each route has one content type.
- The finance range form uses three submit buttons with `formAction` instead of the menu, so it keeps working without JavaScript as it does today.

**D122. One report model, three renderers.**
- Each export builds `{ title, filterLine, columns: [{ header, kind: text | amount | int | date | time | percent }], rows, totals? }` once. The CSV renderer must reproduce today's bytes exactly (`csvDocument`, `csvNum`), proven by snapshot (AC 4); the Excel and PDF renderers read the same model.
- Why: the three files can never disagree about rows or filters, and the CSV contract (Phase 7's email byte-compare) stays intact.

**D123. Excel cells are typed, and there are no formulas.**
- Money as numbers in lira with `#,##0.00`, so the treasurer can sum a column; kuruş / 100 is exact for our range.
- An `.xlsx` text cell is never evaluated, so the CSV's `'` prefix isn't needed and would show. The safety rule becomes "the writer never emits a formula cell", checked by AC 11.

**D124. PDF: A4, fixed orientation per report, text header, page numbers.**
- Landscape for the wide reports (ledger 16 columns, dues, attendance), portrait for budget and members.
- Header: choir name, report title, filter line, creation time and the manager's name, so a printout in a folder explains itself. No logo image (simpler, smaller; backlog).
- 3,000-row limit: a year of ledger is a few hundred rows; anything larger is a mistake or a job for Excel, and it keeps us far from the 60 s limit.

**D125. The PDF font is Jost, as static Regular and SemiBold TTFs committed with the OFL licence.**
- The repo's only font file is the variable `Jost[wght].ttf`, which `fontkit` subsets unreliably; the official static instances are free (OFL) and cover Turkish, `₺` and `−`. Geist isn't a file in the repo.
- Jost is the brand typeface (Phase 6), so printouts match the portal's identity.

**D126. Templates: Excel and CSV, no PDF.**
- An Excel template with text-formatted columns stops Excel from turning `07.10.2025` into a date serial or dropping a phone number's leading zero, the most common import failure.
- A second sheet `Açıklama` carries the column rules from the same `docs.ts` source as the docs.

**D127. The monthly backup email keeps its CSVs and adds one workbook `arkhe-rapor-YYYY-MM.xlsx`.**
- The CSVs are the archival format, Phase 7's ACs byte-compare them, and the restore drill doesn't need Excel. The workbook is for people: one attachment with every report as a sheet.
- No PDF in the email (the backup is data, not a printout).
- A failure building the workbook never stops the backup (AC 23).

**D128. Excel import: first sheet, header row 1, converted to the same strings the CSV engine already validates.**
- The import engine, its strict parsers (`values.ts`), its limits, check/commit with SHA, and undo stay untouched. Only the reader changes: `.xlsx` cells are turned into the canonical strings (`1250,50`, `YYYY-MM-DD`, `HH:MM`) and fed to the same pipeline with Excel row numbers.
- Formula cells use their cached result; with no cached result we refuse that cell rather than calculate.
- The 1 MB limit stays (an `.xlsx` of 5,000 rows is well under it), plus uncompressed-size, row and column caps against zip bombs.
- `.xls` and `.ods` stay refused: old binary formats need another parser for a case nobody has asked about.

**D129. Members get no exports in this phase.** No member-facing export exists today, and the request was about the existing ones. The homework report stays email-only. Backlog if asked.

**D130. Privacy is unchanged.** Excel and PDF contain exactly the CSV's columns for the same people. No new personal data leaves the portal.

**D131. Verification split.** e2e reads the files themselves (unzipped XML for Excel, `pdfjs-dist` text for PDF, devDependency only). Opening in real apps (Excel, Google Sheets on a phone, LibreOffice) and the production timing are manual go-live checks (AC 12, 24).

**D132. Coordinating with Phase 11.** Shared files are `package.json`/lock, possibly `next.config.ts`, `e2e/run.mjs`, README and STATUS. Whoever lands second rebases these; neither phase touches the other's `src/` files or migrations.
