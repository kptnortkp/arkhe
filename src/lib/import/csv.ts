// Our own CSV reader (D3): exact physical line numbers, no multi-line cells, strict UTF-8.
export const NOT_UTF8 =
  'Dosya UTF-8 değil. Excel\'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan UTF-8 iste.';
export const IS_EXCEL =
  'Bu bir Excel dosyası. Excel\'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan CSV iste.';

export type Decoded = { ok: true; text: string } | { ok: false; message: string };

export function decode(bytes: Uint8Array): Decoded {
  // xlsx and ods are zip archives.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return { ok: false, message: IS_EXCEL };
  }
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return { ok: false, message: NOT_UTF8 };
  }
  let text: string;
  try {
    // Strips one UTF-8 BOM; Windows-1254 ş ğ ı İ are never valid UTF-8 on their own.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, message: NOT_UTF8 };
  }
  if (text.includes("\u0000")) return { ok: false, message: NOT_UTF8 };
  return { ok: true, text };
}

export type CsvRecord = { line: number; cells: string[] };
export type Parsed = { ok: true; records: CsvRecord[] } | { ok: false; message: string };

const isBlank = (cells: string[]) => cells.every((c) => c.trim() === "");

/**
 * RFC 4180 subset: a cell is quoted when its first non-space character is `"`, `""` is a quote,
 * a quote never spans a line break. Blank records are dropped but keep their line numbers.
 * The delimiter is `;` when the first non-blank line has one, else `,`.
 */
export function parseCsv(text: string): Parsed {
  const records: CsvRecord[] = [];
  let sep: string | null = null;
  let line = 1;
  let i = 0;
  const n = text.length;
  while (i < n) {
    // One physical line.
    const lineStart = i;
    let end = i;
    while (end < n && text[end] !== "\n" && text[end] !== "\r") end++;
    if (sep === null) {
      const raw = text.slice(lineStart, end);
      if (raw.trim() !== "" && !/^[\s;,]*$/.test(raw)) sep = raw.includes(";") ? ";" : ",";
    }
    const delim = sep ?? ";";
    const cells: string[] = [];
    let j = i;
    for (;;) {
      // Leading spaces before a possible quote.
      let k = j;
      while (k < end && (text[k] === " " || text[k] === "\t")) k++;
      if (k < end && text[k] === '"') {
        let value = "";
        let p = k + 1;
        for (;;) {
          if (p >= end) {
            return { ok: false, message: `Satır ${line}: Hücrede satır sonu olamaz.` };
          }
          const c = text[p];
          if (c === '"') {
            if (text[p + 1] === '"' && p + 1 < end) {
              value += '"';
              p += 2;
              continue;
            }
            p++;
            break;
          }
          value += c;
          p++;
        }
        while (p < end && (text[p] === " " || text[p] === "\t")) p++;
        if (p < end && text[p] !== delim) {
          return { ok: false, message: `Satır ${line}: Tırnak işaretleri hatalı.` };
        }
        cells.push(value);
        if (p >= end) break;
        j = p + 1;
      } else {
        let p = j;
        while (p < end && text[p] !== delim) p++;
        cells.push(text.slice(j, p));
        if (p >= end) break;
        j = p + 1;
      }
    }
    if (!isBlank(cells)) records.push({ line, cells });
    // Line break: CRLF, LF or a lone CR.
    if (end >= n) break;
    i = text[end] === "\r" && text[end + 1] === "\n" ? end + 2 : end + 1;
    line++;
  }
  return { ok: true, records };
}
