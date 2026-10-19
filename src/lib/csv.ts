// Spreadsheet apps execute cells that start with these; prefix them so names stay text.
export function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM, ";" separators and CRLF: what Turkish Excel opens without an import dialog. */
export function csvDocument(header: string[], rows: (string | number | null | undefined)[][]) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Headers for a CSV download; `filename` is ASCII, `utf8Name` the readable Turkish one. */
export function csvHeaders(filename: string, utf8Name = filename) {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
