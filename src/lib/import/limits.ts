// Isomorphic: the client flow imports these for its pre-checks; no Node APIs, no server-only.
/** "1 MB" everywhere: client, server, README and tests. */
export const IMPORT_MAX_BYTES = 1_048_576;
export const IMPORT_MAX_ROWS = 5000;
/** Errors the server returns; the true count travels alongside. */
export const IMPORT_MAX_ERRORS = 1000;
export const IMPORT_MAX_EFFECTS = 50;
/** Longest cell read; bounds every per-cell regex. */
export const IMPORT_MAX_CELL = 2000;
/** The name the browser gives pasted CSV text before sending it as a file. */
export const PASTE_FILE_NAME = "yapistirilan-metin.csv";
/** Test-only fault hook; honoured only outside production on a file: database. */
export const FAULT_COOKIE = "arkhe_e2e_import_fault";

export const SLUGS = [
  "uyeler",
  "donemler",
  "yoklama",
  "hareketler",
  "aidat-donemleri",
  "aidat-odemeleri",
] as const;
export type Slug = (typeof SLUGS)[number];

export function isSlug(value: unknown): value is Slug {
  return typeof value === "string" && (SLUGS as readonly string[]).includes(value);
}

export const TOO_BIG = "Dosya en fazla 1 MB olabilir.";
export const NO_ROWS = "Dosyada veri satırı yok.";
export const TOO_MANY_ROWS = "En fazla 5000 satır aktarılabilir; dosyayı (örneğin sezonlara) böl.";
