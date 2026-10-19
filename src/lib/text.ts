// Stripped: C0 controls except newline (tab becomes a space first), DEL, C1, soft hyphen, ALM,
// Hangul and Mongolian fillers, zero-width space, LRM/RLM, bidi embeddings/overrides/isolates,
// word joiner and invisible operators, deprecated format controls, BOM and tag characters.
// ZWJ/ZWNJ (U+200C/D) stay: emoji sequences and some scripts need them.
const INVISIBLE =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;
const LINE_SEPARATORS = /[\u2028\u2029]/g;

/** Free text: drops invisible and direction-changing characters, keeps newlines. */
export function cleanText(value: string) {
  return value
    .toWellFormed()
    .replace(/\t/g, " ")
    .replace(LINE_SEPARATORS, "\n")
    .replace(INVISIBLE, "");
}

/** Single-line text such as names and titles: as cleanText, with line breaks turned into a space. */
export function cleanLine(value: string) {
  return cleanText(value).replace(/\n+/g, " ");
}
