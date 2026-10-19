// Half-open [from, to) day ranges on ISO date strings, so filters can use fe_occurred_idx.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

/** "2026-12" → ["2026-12-01", "2027-01-01"]; null for anything else. */
export function monthRange(month: string): [string, string] | null {
  if (!MONTH.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return [`${month}-01`, `${next}-01`];
}

/** "2026" → ["2026-01-01", "2027-01-01"]; null for anything else. */
export function yearRange(year: string): [string, string] | null {
  if (!YEAR.test(year)) return null;
  return [`${year}-01-01`, `${Number(year) + 1}-01-01`];
}
