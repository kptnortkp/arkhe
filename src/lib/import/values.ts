// Strict cell parsers (D4, D5). "Today" is read per call, in Istanbul.
import { DATE_OUT_OF_RANGE, inDateBounds } from "@/lib/finance/schemas";
import { AMOUNT_MAX, AMOUNT_ZERO, MAX_KURUS } from "@/lib/money";
import { addDays, istanbulDateOf, now } from "@/lib/time";

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export const DATE_FORMAT = "Tarihi 2025-10-07 ya da 07.10.2025 biçiminde yaz.";
export const DATE_NOT_REAL = "Bu tarih takvimde yok.";
export const DATE_BEFORE_2000 = "Tarih 2000'den önce olamaz.";
export const DATE_FUTURE = "Gelecek bir tarih olamaz.";
export const TIME_FORMAT = "Saati 19:30 biçiminde yaz.";
export const AMOUNT_STRICT = "Tutarı 1250,50 biçiminde yaz: binlik ayırıcı, ₺ ve boşluk yok.";
export const RECORD_NO_FORMAT = "Kayıt numarası 1–40 karakter olmalı: harf, rakam, - _ . /";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** `YYYY-MM-DD` or `D.M.YYYY`; real, from 2000, and not after today unless `future`. */
export function parseDate(raw: string, { future = false } = {}): Parsed<string> {
  let y: string, m: string, d: string;
  const iso = ISO.exec(raw);
  const dotted = iso ? null : DOTTED.exec(raw);
  if (iso) [, y, m, d] = iso;
  else if (dotted) [, d, m, y] = dotted;
  else return { ok: false, message: DATE_FORMAT };
  const value = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || addDays(value, 0) !== value) {
    return { ok: false, message: DATE_NOT_REAL };
  }
  if (value < "2000-01-01") return { ok: false, message: DATE_BEFORE_2000 };
  if (future) {
    if (!inDateBounds(value)) return { ok: false, message: DATE_OUT_OF_RANGE };
  } else if (value > istanbulDateOf(now())) {
    return { ok: false, message: DATE_FUTURE };
  }
  return { ok: true, value };
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)(?::00)?$/;

/** 24-hour `H:MM` or `HH:MM`, optionally `:00`; returns `HH:MM`. */
export function parseTime(raw: string): Parsed<string> {
  const m = TIME.exec(raw);
  if (!m) return { ok: false, message: TIME_FORMAT };
  return { ok: true, value: `${m[1].padStart(2, "0")}:${m[2]}` };
}

const AMOUNT = /^(0|[1-9]\d*)(?:[.,](\d{1,2}))?$/;

/** One meaning per string: digits, then at most one separator and two decimals. */
export function parseStrictAmount(raw: string): Parsed<{ kurus: number; text: string }> {
  const m = AMOUNT.exec(raw);
  if (!m) return { ok: false, message: AMOUNT_STRICT };
  if (m[1].length > 8) return { ok: false, message: AMOUNT_MAX };
  const kurus = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (kurus === 0) return { ok: false, message: AMOUNT_ZERO };
  if (kurus > MAX_KURUS) return { ok: false, message: AMOUNT_MAX };
  // The canonical form the UI's own (lenient) amount schema reads back to the same kuruş.
  const text = `${Math.floor(kurus / 100)},${String(kurus % 100).padStart(2, "0")}`;
  return { ok: true, value: { kurus, text } };
}

const RECORD_NO = /^[A-Za-z0-9._/-]{1,40}$/;

/** Case-sensitive, trimmed only. */
export function parseRecordNo(raw: string): Parsed<string> {
  return RECORD_NO.test(raw) ? { ok: true, value: raw } : { ok: false, message: RECORD_NO_FORMAT };
}
