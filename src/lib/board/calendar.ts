// The /yonetim/takvim month grid. Isomorphic: no Node APIs, no DB.
import { addDays } from "@/lib/time";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `?ay=YYYY-MM` within two years of today, else this month. */
export function parseMonth(raw: unknown, today: string) {
  const current = today.slice(0, 7);
  if (typeof raw !== "string" || !MONTH.test(raw)) return current;
  const [y] = raw.split("-").map(Number);
  const year = Number(today.slice(0, 4));
  return Math.abs(y - year) <= 2 ? raw : current;
}

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Monday-first weeks covering the month, as YYYY-MM-DD days. */
export function monthWeeks(month: string) {
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -weekday);
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const weeks: string[][] = [];
  for (let day = start; day <= last || weeks.at(-1)?.length !== 7; day = addDays(day, 1)) {
    if (!weeks.length || weeks.at(-1)!.length === 7) weeks.push([]);
    weeks.at(-1)!.push(day);
  }
  return weeks;
}
