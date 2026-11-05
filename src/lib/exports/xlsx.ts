import "server-only";
import ExcelJS from "exceljs";
import type { CsvValue } from "@/lib/csv";
import { cellText, TONE_FILLS, type ExportBook, type ExportSheet } from "./table";

const HEADER_ROW = 4;

function setCell(cell: ExcelJS.Cell, value: CsvValue) {
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "object") {
    // Strings stay strings: ExcelJS only writes a formula for { formula } objects.
    cell.value = value;
  } else if ("kurus" in value) {
    cell.value = value.kurus / 100;
    cell.numFmt = "#,##0.00";
  } else if ("day" in value) {
    const [y, m, d] = value.day.split("-").map(Number);
    cell.value = new Date(Date.UTC(y, m - 1, d));
    cell.numFmt = "dd.mm.yyyy";
  } else if ("pct" in value) {
    cell.value = value.pct;
    cell.numFmt = '"%"0';
  } else {
    cell.value = value.csvNumber;
  }
}

function addSheet(wb: ExcelJS.Workbook, table: ExportSheet) {
  const name =
    (table.sheetName ?? table.title)
      .replace(/[[\]:*?/\\]/g, " ")
      .slice(0, 31)
      .trim() || `Sayfa ${wb.worksheets.length + 1}`;
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: HEADER_ROW }] });

  ws.getCell(1, 1).value = table.title;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  const sub = [table.subtitle, table.legend].filter(Boolean).join(" · ");
  if (sub) {
    ws.getCell(2, 1).value = sub;
    ws.getCell(2, 1).font = { color: { argb: "FF666666" } };
  }

  const header = ws.getRow(HEADER_ROW);
  table.header.forEach((h, i) => {
    const cell = header.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  const strong = new Set(table.strongRows);
  table.rows.forEach((values, r) => {
    const row = ws.getRow(HEADER_ROW + 1 + r);
    const tone = table.rowTones?.[r];
    values.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      setCell(cell, v);
      if (tone)
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${TONE_FILLS[tone]}` },
        };
    });
    if (strong.has(r)) row.font = { bold: true };
  });

  table.header.forEach((h, c) => {
    const longest = Math.max(
      h.length,
      ...table.rows.map((r) =>
        Math.max(
          ...cellText(r[c])
            .split("\n")
            .map((l) => l.length),
        ),
      ),
    );
    ws.getColumn(c + 1).width = Math.min(Math.max(longest + 2, 8), 50);
  });

  if (table.rows.length > 0) {
    ws.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW + table.rows.length, column: table.header.length },
    };
  }
}

export async function bookXlsx(book: ExportBook): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Koro Arkhe";
  wb.created = new Date();
  for (const sheet of book.sheets) addSheet(wb, sheet);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
