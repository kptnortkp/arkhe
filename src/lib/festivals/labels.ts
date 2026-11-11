// Festival and special-day labels, colours and date text. Isomorphic: no Node APIs, no DB.
import type { FestivalRegion, FestivalStatus, SpecialDayKind } from "@/db/schema";
import { addDays, formatter } from "@/lib/time";

export const REGION_LABELS: Record<FestivalRegion, string> = { tr: "Türkiye", abroad: "Yurt dışı" };

export const FESTIVAL_STATUS_LABELS: Record<FestivalStatus, string> = {
  watching: "Takipte",
  applied: "Başvurduk",
  attending: "Katılıyoruz",
  declined: "Katılmıyoruz",
};

export const SPECIAL_DAY_LABELS: Record<SpecialDayKind, string> = {
  holiday: "Resmi tatil",
  eve: "Arife (13.00'ten sonra)",
  observance: "Anma günü",
  other: "Diğer",
};

/** Tailwind classes on the spreadsheet tokens; the export uses SHEET_HEX for the same colours. */
export const REGION_FILL: Record<FestivalRegion, string> = {
  tr: "bg-sheet-tr",
  abroad: "bg-sheet-abroad",
};
export const ATTENDING_FILL = "bg-sheet-attending";
export const NEW_FILL = "bg-sheet-new";
export const SPECIAL_DAY_FILL: Record<SpecialDayKind, string> = {
  holiday: "bg-day-holiday",
  eve: "bg-day-eve",
  observance: "bg-day-observance",
  other: "",
};

export const SHEET_HEX = {
  tr: "FFF2CC",
  abroad: "C9DAF8",
  attending: "B6D7A8",
  new: "00FF00",
  later: "EAD1DC",
  month: "2B542C",
  current: "C00000",
  holiday: "F2DEDE",
  eve: "FCF8E3",
  weekend: "E8F0F5",
  observance: "D9D9D9",
  title: "F9FCB6",
} as const;

/** A festival counts as "Yeni" for this many days after it was added. */
export const NEW_DAYS = 30;

const dayMonth = formatter({ day: "numeric", month: "long" });
const dayOnly = formatter({ day: "numeric" });
const dayMonthYear = formatter({ day: "numeric", month: "long", year: "numeric" });
const at = (day: string) => new Date(`${day}T12:00:00Z`);

/** "11–13 Aralık 2026", "28 Nisan – 2 Mayıs 2027", or the note when the dates are not known. */
export function festivalDates(f: {
  startsOn: string | null;
  endsOn: string | null;
  dateNote: string | null;
}) {
  if (f.dateNote) return f.dateNote;
  if (!f.startsOn) return "Tarih belli değil";
  const end = f.endsOn ?? f.startsOn;
  const year = end.slice(0, 4);
  if (end === f.startsOn) return dayMonthYear.format(at(end));
  if (f.startsOn.slice(0, 7) === end.slice(0, 7)) {
    return `${dayOnly.format(at(f.startsOn))}–${dayMonth.format(at(end))} ${year}`;
  }
  const startYear = f.startsOn.slice(0, 4) === year ? "" : ` ${f.startsOn.slice(0, 4)}`;
  return `${dayMonth.format(at(f.startsOn))}${startYear} – ${dayMonth.format(at(end))} ${year}`;
}

export function formatDayLong(day: string) {
  return dayMonthYear.format(at(day));
}

export type DeadlineState =
  | { kind: "none"; text: string }
  | { kind: "closed"; text: string }
  | { kind: "open"; days: number; text: string };

/** The deadline line and how far away it is from `today`. */
export function deadlineState(
  f: { deadlineOn: string | null; deadlineNote: string | null },
  today: string,
): DeadlineState {
  if (!f.deadlineOn) return { kind: "none", text: f.deadlineNote ?? "Belirtilmemiş" };
  const text = f.deadlineNote ?? `Son gün ${formatDayLong(f.deadlineOn)}`;
  if (f.deadlineOn < today) return { kind: "closed", text };
  const days = Math.round((at(f.deadlineOn).getTime() - at(today).getTime()) / 86_400_000);
  return { kind: "open", days, text };
}

export function daysLeftText(days: number) {
  return days === 0 ? "Son gün bugün" : days === 1 ? "Yarın son gün" : `${days} gün kaldı`;
}

/** The festival is over once its last day (or, with no dates, nothing) is behind us. */
export function isPast(f: { startsOn: string | null; endsOn: string | null }, today: string) {
  const end = f.endsOn ?? f.startsOn;
  return end !== null && end < today;
}

export function isNew(createdAt: Date, today: string) {
  return createdAt.getTime() >= at(addDays(today, -NEW_DAYS)).getTime();
}
