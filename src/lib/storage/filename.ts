// Pure: ASCII-only download names, so Content-Disposition needs no filename* (D16, AC 4).
const TR: Record<string, string> = {
  ç: "c",
  Ç: "C",
  ğ: "g",
  Ğ: "G",
  ı: "i",
  İ: "I",
  ö: "o",
  Ö: "O",
  ş: "s",
  Ş: "S",
  ü: "u",
  Ü: "U",
};

export function asciiSlug(parts: readonly string[], fallback: string) {
  const slug = parts
    .join("-")
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/** "Ave-Verum-Corpus-Demo-Korist.m4a"; never logged. */
export function downloadName(parts: readonly string[], ext: string, fallback: string) {
  return `${asciiSlug(parts, fallback)}.${ext}`;
}
