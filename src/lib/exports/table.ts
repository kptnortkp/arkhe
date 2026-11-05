import type { CsvValue } from "@/lib/csv";
import { amountInput } from "@/lib/money";

export type ExportFormat = "xlsx" | "pdf" | "csv";
export type RowTone = "ok" | "near" | "over";

/** Light row tints, readable in print; hex without "#". */
export const TONE_FILLS: Record<RowTone, string> = {
  ok: "DDF2E3",
  near: "FDE3C4",
  over: "F8D0CC",
};

/** One table: an Excel worksheet, a PDF section, or a whole CSV. */
export type ExportSheet = {
  title: string;
  /** Excel tab name (≤ 31 characters); defaults to the title. */
  sheetName?: string;
  subtitle?: string;
  header: string[];
  rows: CsvValue[][];
  /** A traffic-light tint per row; `legend` explains it under the title. */
  rowTones?: (RowTone | null)[];
  legend?: string;
  /** Row indexes printed bold (totals). */
  strongRows?: number[];
  /** Columns left out of the PDF, where the page is too narrow for every column. */
  pdfOmit?: string[];
};

/** File name without extension: ASCII fallback and the readable Turkish one. */
type FileName = { filename: string; utf8Name?: string };

/** One report as a table; CSV, Excel and PDF are all rendered from this. */
export type ExportTable = ExportSheet & FileName;

/** Several tables in one file: Excel worksheets, PDF sections. No CSV. */
export type ExportBook = FileName & { title: string; sheets: ExportSheet[] };

export const asBook = (table: ExportTable): ExportBook => ({
  title: table.title,
  filename: table.filename,
  utf8Name: table.utf8Name,
  sheets: [table],
});

/** "2026-01-05" → "05.01.2026". */
export function trDay(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** A cell as display text, for the PDF. */
export function cellText(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if ("kurus" in value) return `${value.kurus < 0 ? "−" : ""}${amountInput(Math.abs(value.kurus))}`;
  if ("day" in value) return trDay(value.day);
  if ("pct" in value) return `%${value.pct}`;
  return value.csvNumber;
}

export function isNumeric(value: CsvValue) {
  return (
    typeof value === "number" ||
    (typeof value === "object" && value !== null && ("kurus" in value || "pct" in value))
  );
}
