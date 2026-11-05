import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatAuditDateTime, now } from "@/lib/time";
import { cellText, isNumeric, TONE_FILLS, type ExportBook, type ExportSheet } from "./table";

// Traced into the server bundle by outputFileTracingIncludes in next.config.ts.
const FONT_DIR = path.join(process.cwd(), "src/lib/exports/fonts");

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36;
const SIZE = 8;
const LINE = SIZE * 1.3;
const PAD = 4;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.8, 0.8, 0.8);
const HEAD_FILL = rgb(0.93, 0.93, 0.93);
const ZEBRA = rgb(0.97, 0.97, 0.97);
const hexRgb = (hex: string) =>
  rgb(
    ...([0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]),
  );

/** Greedy word wrap; words longer than the column are broken by character. */
function wrap(text: string, font: PDFFont, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, SIZE) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, SIZE) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), SIZE) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** Narrow columns (dates, amounts) keep their width; the wide ones share what is left and wrap. */
function fitWidths(natural: number[], usable: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= usable) return natural.map((w) => (w / total) * usable);
  const widths = [...natural];
  let flexible = natural.map((_, i) => i);
  let remaining = usable;
  for (;;) {
    const share = remaining / flexible.length;
    const fixed = flexible.filter((i) => natural[i] <= share);
    if (fixed.length === 0 || fixed.length === flexible.length) break;
    for (const i of fixed) remaining -= natural[i];
    flexible = flexible.filter((i) => natural[i] > share);
  }
  const flexTotal = flexible.reduce((a, i) => a + natural[i], 0);
  for (const i of flexible) widths[i] = (natural[i] / flexTotal) * remaining;
  return widths;
}

type Fonts = { regular: PDFFont; bold: PDFFont };

/** One sheet, starting on a new page; its pages are appended to `pages`. */
function drawSheet(
  doc: PDFDocument,
  table: ExportSheet,
  { regular, bold }: Fonts,
  pages: PDFPage[],
) {
  const keep = table.header
    .map((h, i) => (table.pdfOmit?.includes(h) ? -1 : i))
    .filter((i) => i >= 0);
  const header = keep.map((i) => table.header[i]);
  const rows = table.rows.map((r) => keep.map((i) => r[i]));
  const numeric = keep.map((_, c) => rows.some((r) => isNumeric(r[c])));
  const strong = new Set(table.strongRows);

  const landscape = header.length > 6;
  const [pageW, pageH] = landscape ? [A4[1], A4[0]] : A4;
  const usable = pageW - 2 * MARGIN;

  // Natural width per column (longest line, capped), then fitted to the page.
  const natural = header.map((h, c) => {
    const texts = rows.map((r) => cellText(r[c]));
    const longest = Math.max(
      bold.widthOfTextAtSize(h, SIZE),
      ...texts.flatMap((t) => t.split("\n").map((l) => regular.widthOfTextAtSize(l, SIZE))),
    );
    return Math.min(Math.max(longest, 24), 180) + 2 * PAD;
  });
  const widths = fitWidths(natural, usable);

  const cellLines = (values: string[], font: PDFFont) =>
    values.map((t, c) => wrap(t, font, widths[c] - 2 * PAD));
  const headLines = cellLines(header, bold);
  const headHeight = Math.max(...headLines.map((l) => l.length)) * LINE + 2 * PAD;

  let page!: PDFPage;
  let y = 0;
  let first = true;

  function drawRow(
    lines: string[][],
    font: PDFFont,
    height: number,
    fill?: ReturnType<typeof rgb>,
  ) {
    if (fill) page.drawRectangle({ x: MARGIN, y: y - height, width: usable, height, color: fill });
    let x = MARGIN;
    lines.forEach((cell, c) => {
      cell.forEach((text, i) => {
        const w = font.widthOfTextAtSize(text, SIZE);
        const tx = numeric[c] ? x + widths[c] - PAD - w : x + PAD;
        page.drawText(text, { x: tx, y: y - PAD - SIZE - i * LINE, size: SIZE, font, color: INK });
      });
      x += widths[c];
    });
    y -= height;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + usable, y },
      thickness: 0.5,
      color: RULE,
    });
  }

  function newPage() {
    page = doc.addPage([pageW, pageH]);
    pages.push(page);
    y = pageH - MARGIN;
    if (first) {
      first = false;
      page.drawText(table.title, { x: MARGIN, y: y - 14, size: 14, font: bold, color: INK });
      y -= 22;
      for (const line of [table.subtitle, table.legend]) {
        if (!line) continue;
        page.drawText(line, { x: MARGIN, y: y - 9, size: 9, font: regular, color: MUTED });
        y -= 15;
      }
      y -= 8;
    }
    drawRow(headLines, bold, headHeight, HEAD_FILL);
  }

  newPage();
  if (rows.length === 0) {
    page.drawText("Kayıt yok.", {
      x: MARGIN + PAD,
      y: y - PAD - SIZE,
      size: SIZE,
      font: regular,
      color: MUTED,
    });
  }
  rows.forEach((r, i) => {
    const font = strong.has(i) ? bold : regular;
    const lines = cellLines(r.map(cellText), font);
    const height = Math.max(...lines.map((l) => l.length)) * LINE + 2 * PAD;
    if (y - height < MARGIN + 16) newPage();
    const tone = table.rowTones?.[i];
    drawRow(lines, font, height, tone ? hexRgb(TONE_FILLS[tone]) : i % 2 === 1 ? ZEBRA : undefined);
  });
}

export async function bookPdf(book: ExportBook): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(book.title);
  doc.setCreator("Koro Arkhe");
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(FONT_DIR, "Geist-Regular.ttf")),
    readFile(path.join(FONT_DIR, "Geist-SemiBold.ttf")),
  ]);
  const fonts = {
    regular: await doc.embedFont(regularBytes, { subset: true }),
    bold: await doc.embedFont(boldBytes, { subset: true }),
  };
  const pages: PDFPage[] = [];
  for (const sheet of book.sheets) drawSheet(doc, sheet, fonts, pages);

  const stamp = [
    "Koro Arkhe",
    book.sheets.length > 1 ? book.title : null,
    formatAuditDateTime(now()),
  ]
    .filter(Boolean)
    .join(" · ");
  pages.forEach((p, i) => {
    const pageW = p.getWidth();
    p.drawText(stamp, { x: MARGIN, y: MARGIN - 18, size: 7, font: fonts.regular, color: MUTED });
    const label = `${i + 1} / ${pages.length}`;
    const w = fonts.regular.widthOfTextAtSize(label, 7);
    p.drawText(label, {
      x: pageW - MARGIN - w,
      y: MARGIN - 18,
      size: 7,
      font: fonts.regular,
      color: MUTED,
    });
  });
  return doc.save();
}
