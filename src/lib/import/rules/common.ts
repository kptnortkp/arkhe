import "server-only";
import type { Role } from "@/db/schema";
import { formatKurus } from "@/lib/money";
import { dayInstant, formatAuditDate } from "@/lib/time";
import type { ImportRow } from "../engine";
import type { BatchDb, Stmt } from "../tx";
import type { BalancePreview, Counts, ResultLink, RowError, Warning } from "../types";

export type Actor = { id: string; role: Role; name: string };
export type Ctx = { actor: Actor; now: Date; today: string };

export type Plan = {
  errors: RowError[];
  warnings: Warning[];
  effects: string[];
  notes: string[];
  counts: Counts;
  balances?: BalancePreview;
  deactivations: number;
  /** Result links to the imported data; the type's static links when absent. */
  links?: ResultLink[];
  /** The statements after the batch row, in dependency order, chunked. */
  writes: (q: BatchDb, batchId: number) => Stmt[];
};

export type Rules<R extends Record<string, Stmt>> = {
  reads: (q: BatchDb, rows: ImportRow[], ctx: Ctx) => R;
  plan: (rows: ImportRow[], snap: { [K in keyof R]: Awaited<R[K]> }, ctx: Ctx) => Plan;
};

export const SAME_RECORD = (line: number) => `Satır ${line} ile aynı kayıt.`;
export const NO_SUCH_MEMBER = "Bu e-postayla üye yok.";
/** The imported row is untouched, but this file says something else under the same number. */
export const RECORD_TAKEN = (no: string, at: Date) =>
  `Kayıt ${no}, ${formatAuditDate(at)} tarihli aktarımda farklı içerikle var. O aktarım doğruysa bu satıra yeni bir kayit_no ver; yanlışsa önce onu geri al.`;
export const RECORD_EDITED = (no: string) =>
  `Kayıt ${no} aktarıldıktan sonra portalda değiştirildi; bu satırı çıkar ya da yeni bir kayit_no ver.`;
export const RECORD_DELETED = (no: string) =>
  `Kayıt ${no} portalda silinmiş; bu satırı çıkar ya da yeni bir kayit_no ver.`;
export const BEFORE_OPENING_IMPORT = (opened: string) =>
  `Tarih açılış bakiyesinden (${day(opened)}) önce. Önce Finans › Ayarlar'da açılış tarihini kayıtlarının başladığı güne çek ve o günkü bakiyeyi yaz.`;

/** "8 Eki 2024" for a plain day. */
export function day(d: string) {
  return formatAuditDate(dayInstant(d));
}

export const money = formatKurus;

/** Collects row errors and remembers which rows are still clean. */
export class Errors {
  readonly list: RowError[] = [];
  private bad = new Set<number>();
  add(row: { line: number }, column: string | null, message: string) {
    this.list.push({ line: row.line, column, message });
    this.bad.add(row.line);
  }
  absorb(row: ImportRow) {
    for (const e of row.errors) this.add(row, e.column, e.message);
  }
  ok(row: { line: number }) {
    return !this.bad.has(row.line);
  }
  sorted() {
    return this.list
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (a.e.line ?? 0) - (b.e.line ?? 0) || a.i - b.i)
      .map((x) => x.e);
  }
}

/** First line of each natural key; a later repeat is "Satır <m> ile aynı kayıt.". */
export class Keys {
  private seen = new Map<string, number>();
  /** True when the key is new; reports the duplicate on `column` otherwise. */
  claim(errors: Errors, row: { line: number }, column: string, key: string) {
    const first = this.seen.get(key);
    if (first !== undefined) {
      errors.add(row, column, SAME_RECORD(first));
      return false;
    }
    this.seen.set(key, row.line);
    return true;
  }
}

export function emptyPlan(errors: Errors, rowCount: number): Plan {
  return {
    errors: errors.sorted(),
    warnings: [],
    effects: [],
    notes: [],
    counts: { added: 0, updated: 0, unchanged: rowCount },
    deactivations: 0,
    writes: () => [],
  };
}

export const str = (v: unknown) => (typeof v === "string" ? v : null);
export const json = (v: unknown) => JSON.stringify(v);
export const secs = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);

/** Drops the in-memory kayit_no before a row is written to its own table. */
export function withoutKayit<T extends { kayitNo: string }>(row: T): Omit<T, "kayitNo"> {
  const copy: Partial<T> = { ...row };
  delete copy.kayitNo;
  return copy as Omit<T, "kayitNo">;
}
