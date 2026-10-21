// Pure month and schedule logic; every "next send" text on the page comes from nextSendAt().
import { addDays, formatMonthYear, istanbulDateOf, istanbulToUtc } from "@/lib/time";

export function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The month a run on Istanbul day `today` ("YYYY-MM-DD") reports on. */
export function reportMonthOf(today: string) {
  return previousMonth(today.slice(0, 7));
}

/** Istanbul calendar month as instants [from, to) and as inclusive plain days. */
export function monthBounds(month: string) {
  const next = nextMonth(month);
  return {
    from: istanbulToUtc(`${month}-01`),
    to: istanbulToUtc(`${next}-01`),
    firstDay: `${month}-01`,
    lastDay: addDays(`${next}-01`, -1),
  };
}

/** "Eylül 2026" for "2026-09". */
export function monthLabel(month: string) {
  return formatMonthYear(istanbulToUtc(`${month}-01`));
}

// Vercel Hobby fires the daily 05:00 UTC cron somewhere within that hour (08:00–09:00 Istanbul).
const CRON_HOUR_UTC = 5;
export const SEND_WINDOW_TEXT = "sabah 08:00–09:00 arası";

export type NextSend = { at: Date; kind: "gönderim" | "deneme" };

/** Covered: the 1st of next month's cron. Otherwise the next daily window that hasn't ended. */
export function nextSendAt(covered: boolean, now: Date): NextSend {
  const today = istanbulDateOf(now);
  if (covered) {
    const [y, m] = nextMonth(today.slice(0, 7)).split("-").map(Number);
    return { at: new Date(Date.UTC(y, m - 1, 1, CRON_HOUR_UTC)), kind: "gönderim" };
  }
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_HOUR_UTC),
  );
  // Inside today's window the call may still come, so today stays the answer until 06:00 UTC.
  if (now.getTime() >= at.getTime() + 3_600_000) at.setUTCDate(at.getUTCDate() + 1);
  return { at, kind: "deneme" };
}
