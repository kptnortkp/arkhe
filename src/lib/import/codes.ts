// Code tables for the enumerated columns (D6), built from the app labels so they can't drift.
import {
  ATTENDANCE_STATUSES,
  REHEARSAL_TYPES,
  VOICE_PARTS,
  type AttendanceStatus,
  type RehearsalType,
  type VoicePart,
} from "@/db/schema";
import {
  ACCOUNTS,
  CATEGORIES,
  DUES_RATES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type Account,
  type Category,
  type DuesRate,
} from "@/lib/finance/categories";
import {
  ACCOUNT_LABELS,
  CATEGORY_LABELS,
  DUES_RATE_LABELS,
  REHEARSAL_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_SHORT,
  VOICE_PART_LABELS,
} from "@/lib/labels";
import { normaliseCode } from "./normalise";

export type CodeTable<V extends string = string> = {
  /** Canonical codes in display order: what the docs and the prompts list. */
  canonical: readonly string[];
  /** Every accepted normalised spelling → stored value. */
  lookup: ReadonlyMap<string, V>;
  /** Stored value → canonical code. */
  codeOf: (value: V) => string;
};

/** Canonical = normalised label; also accepts the DB value and aliases. Throws on a collision. */
function codeTable<V extends string>(
  values: readonly V[],
  label: (v: V) => string,
  aliases: Partial<Record<V, string[]>> = {},
): CodeTable<V> {
  const lookup = new Map<string, V>();
  const canonicalOf = new Map<V, string>();
  const add = (key: string, v: V) => {
    const k = normaliseCode(key);
    const prev = lookup.get(k);
    if (prev !== undefined && prev !== v) throw new Error(`import code collision: ${k}`);
    lookup.set(k, v);
  };
  for (const v of values) {
    const canonical = normaliseCode(label(v));
    canonicalOf.set(v, canonical);
    add(canonical, v);
    add(v, v);
    for (const a of aliases[v] ?? []) add(a, v);
  }
  return {
    canonical: values.map((v) => canonicalOf.get(v)!),
    lookup,
    codeOf: (v) => canonicalOf.get(v)!,
  };
}

export const VOICE_PART_CODES = codeTable<VoicePart>(VOICE_PARTS, (v) => VOICE_PART_LABELS[v]);
export const REHEARSAL_TYPE_CODES = codeTable<RehearsalType>(
  REHEARSAL_TYPES,
  (v) => REHEARSAL_TYPE_LABELS[v],
);
export const STATUS_CODES = codeTable<AttendanceStatus>(
  ATTENDANCE_STATUSES,
  (v) => STATUS_LABELS[v],
  { late: [STATUS_SHORT.late] },
);
export const ENTRY_KIND_CODES = codeTable<"income" | "expense" | "transfer">(
  ["income", "expense", "transfer"],
  (v) => ({ income: "Gelir", expense: "Gider", transfer: "Virman" })[v],
);
/** Every category including dues, so "aidat" is recognised and refused with its own message. */
export const CATEGORY_CODES = codeTable<Category>(CATEGORIES, (v) => CATEGORY_LABELS[v]);
export const INCOME_CODES = INCOME_CATEGORIES.filter((c) => c !== "dues").map(
  CATEGORY_CODES.codeOf,
);
export const EXPENSE_CODES = EXPENSE_CATEGORIES.map(CATEGORY_CODES.codeOf);
/** What the docs list for kategori: dues is never offered. */
export const CATEGORY_DOC_CODES = [...INCOME_CODES, ...EXPENSE_CODES];
export const ACCOUNT_CODES = codeTable<Account>(ACCOUNTS, (v) => ACCOUNT_LABELS[v]);
export const DUES_RATE_CODES = codeTable<DuesRate>(DUES_RATES, (v) => DUES_RATE_LABELS[v]);
export const DUES_ROW_CODES = codeTable<"payment" | "waiver">(
  ["payment", "waiver"],
  (v) => ({ payment: "Ödeme", waiver: "Muaf" })[v],
);

export function unknownCode(raw: string, canonical: readonly string[]) {
  return `"${raw.slice(0, 40)}" geçerli değil. Şunlardan biri olmalı: ${canonical.join(", ")}.`;
}
