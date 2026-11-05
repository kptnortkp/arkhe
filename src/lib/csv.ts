import { csvAmount } from "@/lib/money";

/** A signed amount cell built from csvAmount; only this strict shape skips the formula guard. */
export type CsvNumber = { csvNumber: string };
const CSV_NUMBER = /^-?\d{1,12},\d{2}$/;
const csvNum = (value: string): CsvNumber => ({ csvNumber: value });

/** Typed cells: CSV prints them as text, Excel and PDF keep the type (number, date, percent). */
export type Money = { kurus: number };
export type Day = { day: string };
export type Pct = { pct: number };
export const money = (kurus: number): Money => ({ kurus });
export const day = (iso: string): Day => ({ day: iso });
export const pct = (value: number): Pct => ({ pct: value });

export type CsvValue = string | number | null | undefined | CsvNumber | Money | Day | Pct;

// Spreadsheet apps execute cells that start with these; prefix them so names stay text.
export function csvCell(value: CsvValue) {
  if (typeof value === "object" && value !== null) {
    if ("kurus" in value) value = csvNum(csvAmount(value.kurus));
    else if ("day" in value) value = value.day;
    else if ("pct" in value) value = `%${value.pct}`;
  }
  if (typeof value === "object" && value !== null) {
    if (CSV_NUMBER.test(value.csvNumber)) return `"${value.csvNumber}"`;
    value = value.csvNumber;
  }
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM, ";" separators and CRLF: what Turkish Excel opens without an import dialog. */
export function csvDocument(header: string[], rows: CsvValue[][]) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Headers for a download; `filename` is ASCII, `utf8Name` the readable Turkish one. */
export function downloadHeaders(contentType: string, filename: string, utf8Name = filename) {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export function csvHeaders(filename: string, utf8Name = filename) {
  return downloadHeaders("text/csv; charset=utf-8", filename, utf8Name);
}
