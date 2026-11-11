import "server-only";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { festivals } from "@/db/schema";
import { monthWeeks, shiftMonth } from "@/lib/board/calendar";
import { addDays, formatMonthYear, dayInstant } from "@/lib/time";
import {
  FESTIVAL_STATUS_LABELS,
  festivalDates,
  formatDayLong,
  isNew,
  isPast,
  SHEET_HEX,
  SPECIAL_DAY_LABELS,
} from "./labels";
import { type Festival, sortFestivals, specialDaysBetween, type SpecialDay } from "./queries";

const fill = (hex: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: `FF${hex}` },
});
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

const HEADER = [
  "",
  "",
  "ETKİNLİK ADI",
  "TARİHİ",
  "BAŞVURU",
  "KATILIM ÜCRETİ",
  "YER",
  "AÇIKLAMA",
  "DURUM",
  "NOT",
];
const LEGEND: [string, string][] = [
  ["Türkiye", SHEET_HEX.tr],
  ["Yurtdışı", SHEET_HEX.abroad],
  ["Katılıyoruz", SHEET_HEX.attending],
];

function deadlineText(f: Festival) {
  if (f.deadlineNote) return f.deadlineNote;
  return f.deadlineOn ? formatDayLong(f.deadlineOn) : "";
}

/** Sheet 1 in the board spreadsheet's layout: legend in A, number in B, coloured C–F. */
function festivalSheet(wb: ExcelJS.Workbook, rows: Festival[], today: string) {
  const ws = wb.addWorksheet("Festivaller", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [14, 6, 46, 26, 32, 34, 16, 52, 14, 44].map((width) => ({ width }));
  ws.addRow(HEADER).eachCell((cell, col) => {
    if (col > 2) {
      cell.font = { bold: true };
      cell.border = thin;
    }
  });

  const thisYear = Number(today.slice(0, 4));
  const current = rows.filter((f) => !isPast(f, today));
  const later = (f: Festival) =>
    f.startsOn !== null && Number(f.startsOn.slice(0, 4)) >= thisYear + 2;
  const attending = current.filter((f) => f.status === "attending" && !later(f));
  const season = current.filter((f) => f.status !== "attending" && !later(f));
  const tr = season.filter((f) => f.region === "tr");
  const abroad = season.filter((f) => f.region === "abroad");
  const ahead = current.filter(later);
  const past = rows.filter((f) => isPast(f, today));

  const put = (f: Festival, n: number | null, muted = false) => {
    const fresh = isNew(f.createdAt, today) && !muted;
    const row = ws.addRow([
      fresh ? "Yeni eklendi" : "",
      n ?? "",
      f.name,
      festivalDates(f),
      deadlineText(f),
      f.fee ?? "",
      f.place ?? "",
      f.url ? { text: f.linkLabel ?? f.url, hyperlink: f.url } : "",
      FESTIVAL_STATUS_LABELS[f.status],
      f.note ?? "",
    ]);
    const tone = fresh
      ? SHEET_HEX.new
      : f.status === "attending"
        ? SHEET_HEX.attending
        : f.region === "tr"
          ? SHEET_HEX.tr
          : SHEET_HEX.abroad;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col < 3) return;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = thin;
      if (col <= 6 && !muted) cell.fill = fill(tone);
      if (muted) cell.font = { color: { argb: "FF808080" }, italic: true };
    });
    if (f.url) row.getCell(8).font = { color: { argb: "FF1155CC" }, underline: true };
  };
  const heading = (text: string, hex: string) => {
    const row = ws.addRow(["", text]);
    row.getCell(2).fill = fill(hex);
    row.getCell(2).font = { bold: true };
  };

  for (const f of attending) put(f, null);
  let n = 0;
  for (const f of [...tr, ...abroad]) put(f, ++n);
  const byYear = Map.groupBy(ahead, (f) => f.startsOn!.slice(0, 4));
  for (const [year, list] of [...byYear].sort(([a], [b]) => a.localeCompare(b))) {
    heading(year, SHEET_HEX.later);
    list.forEach((f, i) => put(f, i + 1));
  }
  if (past.length) {
    heading("Geçmiş", "D9D9D9");
    past.reverse().forEach((f) => put(f, null, true));
  }

  // The legend sits in column A of the first rows, as in the original sheet; new rows say so themselves.
  LEGEND.forEach(([label, hex], i) => {
    const cell = ws.getCell(i + 1, 1);
    if (i > 0 && cell.value) return;
    cell.value = label;
    cell.fill = fill(hex);
    cell.font = { bold: i === 0 };
  });
}

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const SPECIAL_HEX = {
  holiday: SHEET_HEX.holiday,
  eve: SHEET_HEX.eve,
  observance: SHEET_HEX.observance,
  other: null,
} as const;

/** Sheet 2: month grids three to a row, holidays and weekends coloured. */
function specialDaySheet(
  wb: ExcelJS.Workbook,
  months: string[],
  days: SpecialDay[],
  today: string,
) {
  const first = months[0].slice(2, 4);
  const last = months.at(-1)!.slice(2, 4);
  const ws = wb.addWorksheet(`Özel Günler '${first} -'${last}`);
  ws.columns = Array.from({ length: 23 }, (_, i) => ({ width: i % 8 === 7 ? 3 : 11 }));
  const byDay = Map.groupBy(days, (d) => d.day);
  const thisYear = today.slice(0, 4);
  let r = 1;

  const legend = () => {
    const items: [string, string][] = [
      [SPECIAL_DAY_LABELS.holiday, SHEET_HEX.holiday],
      [SPECIAL_DAY_LABELS.eve, SHEET_HEX.eve],
      ["Hafta sonu", SHEET_HEX.weekend],
      [SPECIAL_DAY_LABELS.observance, SHEET_HEX.observance],
    ];
    items.forEach(([label, hex], i) => {
      const col = 1 + i * 5;
      ws.mergeCells(r, col, r, col + 3);
      const cell = ws.getCell(r, col);
      cell.value = label;
      cell.fill = fill(hex);
      cell.alignment = { horizontal: "center" };
    });
    r += 2;
  };

  for (let i = 0; i < months.length; i += 3) {
    const block = months.slice(i, i + 3);
    if (
      block[0].slice(0, 4) !== thisYear &&
      (i === 0 || months[i - 1].slice(0, 4) !== block[0].slice(0, 4))
    ) {
      ws.mergeCells(r, 1, r, 7);
      const title = ws.getCell(r, 1);
      title.value = `${block[0].slice(0, 4)} Yıllık Takvim`;
      title.fill = fill(SHEET_HEX.title);
      title.font = { bold: true, size: 13 };
      r += 1;
      legend();
    } else if (i === 0) {
      legend();
    }
    const grids = block.map((m) => monthWeeks(m));
    block.forEach((m, b) => {
      const col = 1 + b * 8;
      ws.mergeCells(r, col, r, col + 6);
      const cell = ws.getCell(r, col);
      cell.value = formatMonthYear(dayInstant(`${m}-01`));
      cell.fill = fill(m.slice(0, 4) === thisYear ? SHEET_HEX.current : SHEET_HEX.month);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center" };
      WEEKDAYS.forEach((w, d) => {
        const head = ws.getCell(r + 1, col + d);
        head.value = w;
        head.font = { bold: true };
        head.alignment = { horizontal: "center" };
      });
    });
    const height = Math.max(...grids.map((g) => g.length));
    for (let w = 0; w < height; w++) {
      const row = ws.getRow(r + 2 + w);
      let tall = false;
      block.forEach((m, b) => {
        const week = grids[b][w];
        if (!week) return;
        week.forEach((day, d) => {
          if (!day.startsWith(m)) return;
          const cell = row.getCell(1 + b * 8 + d);
          const special = byDay.get(day) ?? [];
          const n = Number(day.slice(8));
          cell.value = special.length ? `${special.map((s) => s.title).join(" · ")}\n${n}` : n;
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          cell.border = thin;
          const hex =
            special.map((s) => SPECIAL_HEX[s.kind]).find(Boolean) ??
            (d >= 5 ? SHEET_HEX.weekend : null);
          if (hex) cell.fill = fill(hex);
          if (special.length) tall = true;
        });
      });
      if (tall) row.height = 46;
    }
    r += 2 + height + 1;
  }
}

/** Both sheets; months run from the start of this quarter to the end of next year. */
export async function festivalWorkbook(today: string) {
  const quarterStart = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}`;
  const endMonth = `${Number(today.slice(0, 4)) + 1}-12`;
  const months: string[] = [];
  for (let m = quarterStart; m <= endMonth; m = shiftMonth(m, 1)) months.push(m);
  const [rows, days] = await Promise.all([
    db.select().from(festivals),
    specialDaysBetween(`${months[0]}-01`, addDays(`${shiftMonth(endMonth, 1)}-01`, -1)),
  ]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Koro Arkhe";
  festivalSheet(wb, sortFestivals(rows), today);
  specialDaySheet(wb, months, days, today);
  return wb.xlsx.writeBuffer();
}
