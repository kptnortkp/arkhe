// All business dates are Europe/Istanbul; servers may run in UTC, so never use setHours/new Date(y, m, d).
export const TIME_ZONE = "Europe/Istanbul";

/** Current instant; a named helper keeps request-time reads explicit in server components. */
export function now() {
  return new Date();
}

const offsetFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  timeZoneName: "longOffset",
});

/** Offset of Istanbul from UTC in minutes at the given instant (e.g. 180). */
function offsetMinutes(at: Date) {
  const name = offsetFormat.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** "2026-10-21" + "19:30" in Istanbul → the UTC instant. */
export function istanbulToUtc(date: string, time = "00:00") {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - offsetMinutes(new Date(guess)) * 60_000);
}

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Istanbul calendar day of an instant, "YYYY-MM-DD". */
export function istanbulDateOf(at: Date) {
  return dateParts.format(at);
}

/** The Istanbul wall-clock time of an instant, "HH:mm". */
export function istanbulTimeOf(at: Date) {
  return timeParts.format(at);
}

export function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** [start of that Istanbul day, start of the next one). */
export function istanbulDayRange(date: string): [Date, Date] {
  return [istanbulToUtc(date), istanbulToUtc(addDays(date, 1))];
}

export function formatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: TIME_ZONE, ...options });
}

export const formatWeekdayShort = formatter({ weekday: "short" });
export const formatDay = formatter({ day: "numeric" });
export const formatMonthShort = formatter({ month: "short" });
export const formatDayMonth = formatter({ day: "numeric", month: "long" });
export const formatLongDate = formatter({ weekday: "long", day: "numeric", month: "long" });
export const formatTime = formatter({ hour: "2-digit", minute: "2-digit" });
export const formatDateTime = formatter({
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});
export const formatDue = formatter({
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
export const formatShortDate = formatter({ day: "numeric", month: "short" });
const auditDate = formatter({ day: "numeric", month: "short", year: "numeric" });
/** "19 Eki 2026" in Istanbul. */
export function formatAuditDate(at: Date) {
  return auditDate.format(at);
}
export const formatShortDateTime = formatter({
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** A plain "YYYY-MM-DD" business day as an instant that formats to that day in Istanbul. */
export function dayInstant(date: string) {
  return new Date(`${date}T12:00:00Z`);
}
