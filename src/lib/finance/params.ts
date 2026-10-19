import { z } from "zod";
import { CATEGORIES } from "./categories";
import type { LedgerFilters } from "./queries";

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const KINDS = { gelir: "income", gider: "expense", virman: "transfer" } as const;
const ACCOUNTS = { kasa: "cash", banka: "bank" } as const;

/** Ledger URL params; anything invalid is ignored rather than failing the page. */
export function ledgerFilters(sp: Params): LedgerFilters & { allMonths: boolean } {
  const ay = one(sp.ay);
  const tur = one(sp.tur);
  const kategori = one(sp.kategori);
  const hesap = one(sp.hesap);
  const uuid = (v?: string) => (v && z.uuid().safeParse(v).success ? v : undefined);
  const f: LedgerFilters = {
    month: ay && MONTH.test(ay) ? ay : undefined,
    kind: tur && tur in KINDS ? KINDS[tur as keyof typeof KINDS] : undefined,
    category: (CATEGORIES as readonly string[]).includes(kategori ?? "")
      ? (kategori as LedgerFilters["category"])
      : undefined,
    account: hesap && hesap in ACCOUNTS ? ACCOUNTS[hesap as keyof typeof ACCOUNTS] : undefined,
    eventId: uuid(one(sp.etkinlik)),
    sponsorId: uuid(one(sp.sponsor)),
    undocumented: one(sp.belgesiz) === "1",
    voided: one(sp.iptal) === "1",
  };
  const allMonths = !f.month && Boolean(f.undocumented || f.eventId || f.sponsorId);
  return { ...f, allMonths };
}

/** Rebuilds a query string from the current params with some keys replaced or removed. */
export function withParams(sp: Params, patch: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && !(k in patch)) q.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) if (v !== null) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
