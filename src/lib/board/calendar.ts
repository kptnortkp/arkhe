// The /yonetim/takvim month grid. Isomorphic: no Node APIs, no DB.
import { z } from "zod";
import { cleanLine, cleanText } from "@/lib/text";
import { addDays } from "@/lib/time";
import { CALENDAR_KINDS, type CalendarKind } from "./labels";

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

export const EVENT_NOT_FOUND = "Bu etkinlik bulunamadı.";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const optional = (max: number, message: string, clean: (v: string) => string) =>
  z
    .string()
    .overwrite(clean)
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => v || null);

const time = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || TIME.test(v), "Geçerli bir saat seç.");

/** Only the title and the day are required; kind defaults to Diğer, no start time means all day. */
export const calendarEventSchema = z
  .object({
    title: z
      .string("Ad boş olamaz.")
      .overwrite(cleanLine)
      .trim()
      .min(1, "Ad boş olamaz.")
      .max(120, "Ad en fazla 120 karakter olabilir."),
    kind: z
      .enum(CALENDAR_KINDS, "Tür seç.")
      .optional()
      .transform((v) => v ?? "other"),
    day: z
      .string("Tarih seç.")
      .trim()
      .refine(
        (v) => DAY.test(v) && addDays(v, 0) === v && v >= "2000-01-01" && v <= "2100-12-31",
        "Tarih seç.",
      ),
    startTime: time,
    endTime: time,
    location: optional(120, "Yer en fazla 120 karakter olabilir.", cleanLine),
    note: optional(1000, "Not en fazla 1000 karakter olabilir.", cleanText),
  })
  .superRefine((d, ctx) => {
    if (d.endTime && !d.startTime) {
      ctx.addIssue({
        code: "custom",
        path: ["startTime"],
        message: "Bitiş için önce başlangıç saati seç.",
      });
    } else if (d.endTime && d.startTime && d.endTime <= d.startTime) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Bitiş, başlangıçtan sonra olmalı.",
      });
    }
  });

/** `?tur=` values, in chip order. */
export const CALENDAR_FILTERS = {
  hepsi: "Hepsi",
  calisma: "Çalışmalar",
  konser: "Konserler",
  toplanti: "Toplantılar",
  gezi: "Kamp / gezi",
  diger: "Diğer",
  is: "İşler",
} as const;
export type CalendarFilter = keyof typeof CALENDAR_FILTERS;

export function parseFilter(raw: unknown): CalendarFilter {
  return typeof raw === "string" && Object.hasOwn(CALENDAR_FILTERS, raw)
    ? (raw as CalendarFilter)
    : "hepsi";
}

/** What an entry looks like on the grid and in the lists; `tone` picks its colour. */
export type CalendarTone = "rehearsal" | CalendarKind | "ticket";
