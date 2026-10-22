// Header mapping and per-cell parsing: CSV records → typed rows with cell errors (AC 10–14).
import { parseLink, INVALID_LINK } from "@/lib/links";
import { cleanLine } from "@/lib/text";
import { emailSchema, nameSchema } from "@/lib/validation";
import { unknownCode } from "./codes";
import type { CsvRecord } from "./csv";
import type { ColumnDef, ImportDef } from "./def";
import { IMPORT_MAX_CELL, IMPORT_MAX_ROWS, NO_ROWS, TOO_MANY_ROWS } from "./limits";
import { normaliseCode } from "./normalise";
import type { RowError } from "./types";
import { parseDate, parseRecordNo, parseStrictAmount, parseTime } from "./values";

export const BLANK_REQUIRED = "Boş bırakılamaz.";
export const TOO_MANY_CELLS = "Satırda başlıktaki sütunlardan fazla hücre var.";
export const BLANK_HEADER_DATA = "Başlığı boş bir sütunda veri var.";

/** Parsed cell values keyed by column; null = blank, undefined = the cell had an error. */
export type Values = Record<string, unknown>;

export type ImportRow = {
  line: number;
  /** Trimmed raw cells, for echoes in messages. */
  raw: Record<string, string>;
  v: Values;
  errors: RowError[];
};

export type Mapped = { ok: true; rows: ImportRow[] } | { ok: false; messages: string[] };

function parseCell(col: ColumnDef, raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const f = col.format;
  switch (f.kind) {
    case "text": {
      const v = cleanLine(raw).trim();
      if (v.length > f.max) return { ok: false, message: `En fazla ${f.max} karakter.` };
      return { ok: true, value: v };
    }
    case "name": {
      const r = nameSchema.safeParse(raw);
      return r.success ? { ok: true, value: r.data } : { ok: false, message: r.error.issues[0].message };
    }
    case "email": {
      const r = emailSchema.safeParse(raw);
      return r.success ? { ok: true, value: r.data } : { ok: false, message: r.error.issues[0].message };
    }
    case "date": {
      const r = parseDate(raw, { future: f.future });
      return r.ok ? r : { ok: false, message: r.message };
    }
    case "time": {
      const r = parseTime(raw);
      return r.ok ? r : { ok: false, message: r.message };
    }
    case "amount": {
      const r = parseStrictAmount(raw);
      return r.ok ? r : { ok: false, message: r.message };
    }
    case "code": {
      const v = f.table.lookup.get(normaliseCode(raw));
      return v === undefined
        ? { ok: false, message: unknownCode(raw, f.codes ?? f.table.canonical) }
        : { ok: true, value: v };
    }
    case "codes": {
      const out: string[] = [];
      for (const part of raw.split("+")) {
        const v = f.table.lookup.get(normaliseCode(part));
        if (v === undefined) return { ok: false, message: unknownCode(part.trim(), f.table.canonical) };
        if (!out.includes(v)) out.push(v);
      }
      return { ok: true, value: out };
    }
    case "recordNo": {
      const r = parseRecordNo(raw);
      return r.ok ? r : { ok: false, message: r.message };
    }
    case "url": {
      const link = parseLink(raw);
      return link ? { ok: true, value: link.url } : { ok: false, message: INVALID_LINK };
    }
  }
}

/** Header cells beyond the type's columns that are still read one by one. */
const HEADER_SLACK = 20;
const MAX_HEADER_PROBLEMS = 20;
export const TOO_MANY_HEADER_CELLS =
  "Başlıkta çok fazla sütun var; ilk satır yalnızca sütun adlarını içermeli.";

/** Undoes the formula guard of the member list download (`'-a@b.co` → `-a@b.co`). */
export function unguard(cell: string) {
  return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}

/** Maps the header (D6-normalised names, free order) and parses every cell of every record. */
export function mapRecords(def: ImportDef, records: CsvRecord[]): Mapped {
  if (records.length === 0) return { ok: false, messages: [NO_ROWS] };
  const [first, ...data] = records;
  // Trailing blank header cells are spreadsheet padding; data under them is caught per row below.
  let width = first.cells.length;
  while (width > 0 && first.cells[width - 1].trim() === "") width--;
  const header = first.cells.slice(0, width);
  if (header.length > def.columns.length + HEADER_SLACK) return { ok: false, messages: [TOO_MANY_HEADER_CELLS] };
  if (data.length > IMPORT_MAX_ROWS) return { ok: false, messages: [TOO_MANY_ROWS] };
  const known = new Map(def.columns.map((c) => [c.name, c]));
  const valid = def.columns.map((c) => c.name).join(", ");
  const blanks = header.flatMap((cell, index) => (cell.trim() === "" ? [index] : []));
  // One pass over the data for all blank header cells together.
  const filled = new Set<number>();
  if (blanks.length) {
    for (const r of data) {
      for (const index of blanks) if ((r.cells[index] ?? "").trim() !== "") filled.add(index);
      if (filled.size === blanks.length) break;
    }
  }
  const problems: string[] = [];
  const at: (ColumnDef | null)[] = [];
  const seen = new Set<string>();
  header.forEach((cell, index) => {
    const raw = cell.trim();
    if (raw === "") {
      at.push(null);
      if (filled.has(index)) problems.push(BLANK_HEADER_DATA);
      return;
    }
    const col = known.get(normaliseCode(raw));
    if (!col) {
      problems.push(`Bilinmeyen sütun: "${raw.slice(0, 40)}". Geçerli sütunlar: ${valid}.`);
      at.push(null);
      return;
    }
    if (seen.has(col.name)) problems.push(`"${col.name}" sütunu iki kez var.`);
    seen.add(col.name);
    at.push(col);
  });
  for (const c of def.columns) {
    if (c.required === true && !seen.has(c.name)) problems.push(`Zorunlu sütun eksik: "${c.name}".`);
  }
  if (problems.length) {
    const unique = [...new Set(problems)];
    const shown = unique.slice(0, MAX_HEADER_PROBLEMS);
    if (unique.length > shown.length) shown.push(`ve ${unique.length - shown.length} sorun daha.`);
    return { ok: false, messages: shown };
  }
  if (data.length === 0) return { ok: false, messages: [NO_ROWS] };

  const rows = data.map((record): ImportRow => {
    const row: ImportRow = { line: record.line, raw: {}, v: {}, errors: [] };
    for (const c of def.columns) {
      row.raw[c.name] = "";
      row.v[c.name] = null;
    }
    record.cells.forEach((cell, index) => {
      const col = at[index];
      const raw = unguard(cell.trim());
      if (index >= at.length) {
        if (raw !== "" && !row.errors.some((e) => e.message === TOO_MANY_CELLS)) {
          row.errors.push({ line: record.line, column: null, message: TOO_MANY_CELLS });
        }
        return;
      }
      if (!col || raw === "") return;
      row.raw[col.name] = raw;
      if (raw.length > IMPORT_MAX_CELL) {
        row.v[col.name] = undefined;
        row.errors.push({ line: record.line, column: col.name, message: `En fazla ${IMPORT_MAX_CELL} karakter.` });
        return;
      }
      const parsed = parseCell(col, raw);
      if (parsed.ok) {
        row.v[col.name] = parsed.value === "" ? null : parsed.value;
      } else {
        row.v[col.name] = undefined;
        row.errors.push({ line: record.line, column: col.name, message: parsed.message });
      }
    });
    for (const c of def.columns) {
      if (c.required === true && row.raw[c.name] === "") {
        row.errors.push({ line: record.line, column: c.name, message: BLANK_REQUIRED });
      }
    }
    return row;
  });
  return { ok: true, rows };
}
