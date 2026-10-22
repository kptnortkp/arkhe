// Money is integer kuruş end to end; parsing is string-only (never parseFloat). Isomorphic.
export const MAX_KURUS = 1_000_000_000;

export const AMOUNT_EMPTY = "Tutar gir.";
export const AMOUNT_FORMAT = "Tutarı 1.250,50 biçiminde gir.";
export const AMOUNT_ZERO = "Tutar sıfırdan büyük olmalı.";
export const AMOUNT_MAX = "Tutar en fazla ₺10.000.000,00 olabilir.";

export type ParsedAmount = { ok: true; kurus: number } | { ok: false; error: string };

const TURKISH = /^(0|[1-9]\d{0,7}|[1-9]\d{0,2}(?:\.\d{3}){1,2})(?:,(\d{1,2}))?$/;
// Phones with an English region show only "." on the decimal keypad: "1250.5" means 1.250,50.
const DOT_DECIMAL = /^(0|[1-9]\d{0,7})\.(\d{1,2})$/;

export function parseAmount(raw: string): ParsedAmount {
  const s = raw
    .replace(/[\s  ]/g, "")
    .replace(/^₺/, "")
    .replace(/tl$/i, "");
  if (!s) return { ok: false, error: AMOUNT_EMPTY };
  const m = TURKISH.exec(s) ?? DOT_DECIMAL.exec(s);
  if (!m) return { ok: false, error: AMOUNT_FORMAT };
  const kurus = Number(m[1].replaceAll(".", "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (kurus === 0) return { ok: false, error: AMOUNT_ZERO };
  if (kurus > MAX_KURUS) return { ok: false, error: AMOUNT_MAX };
  return { ok: true, kurus };
}

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
const plain = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// Intl emits an ASCII hyphen for negatives; we always print the sign ourselves.
const MINUS = "−";

/** "₺1.250,50" for the absolute value. */
export function formatKurus(kurus: number) {
  return currency.format(Math.abs(kurus) / 100);
}

export function formatSigned(kurus: number, direction: "in" | "out") {
  return `${direction === "in" ? "+" : MINUS}${formatKurus(kurus)}`;
}

/** Balances and P/L: no sign when ≥ 0, "−" when negative. */
export function formatNet(kurus: number) {
  return kurus < 0 ? `${MINUS}${formatKurus(kurus)}` : formatKurus(kurus);
}

/** The value an amount input is prefilled with: "1.250,50". */
export function amountInput(kurus: number) {
  return plain.format(kurus / 100);
}

/** CSV cells: "1250,50", no thousands separator, so spreadsheets sum it. */
export function csvAmount(kurus: number) {
  const sign = kurus < 0 ? "-" : "";
  const abs = Math.abs(kurus);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Plan editor amounts: blank, "0" and "0,00" mean "not planned" (0); anything else as parseAmount. */
export function parsePlanAmount(raw: string): ParsedAmount {
  const parsed = parseAmount(raw);
  if (!parsed.ok && (parsed.error === AMOUNT_EMPTY || parsed.error === AMOUNT_ZERO)) {
    return { ok: true, kurus: 0 };
  }
  return parsed;
}
