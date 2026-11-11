// Form validation for festivals and special days. Isomorphic.
import { z } from "zod";
import { FESTIVAL_REGIONS, FESTIVAL_STATUSES, SPECIAL_DAY_KINDS } from "@/db/schema";
import { cleanLine } from "@/lib/text";
import { addDays } from "@/lib/time";
import { optionalLine, optionalText } from "@/lib/validation";

export const FESTIVAL_NOT_FOUND = "Bu festival bulunamadı.";
export const SPECIAL_DAY_NOT_FOUND = "Bu özel gün bulunamadı.";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: string) =>
  DAY.test(v) && addDays(v, 0) === v && v >= "2000-01-01" && v <= "2100-12-31";

const optionalDay = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || isDay(v), "Geçerli bir tarih seç.");

const url = z
  .string()
  .trim()
  .max(2000, "Bağlantı çok uzun.")
  .optional()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      const u = new URL(v);
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Geçerli bir bağlantı yaz.");

export const festivalSchema = z
  .object({
    name: z
      .string("Ad boş olamaz.")
      .overwrite(cleanLine)
      .trim()
      .min(1, "Ad boş olamaz.")
      .max(160, "Ad en fazla 160 karakter olabilir."),
    region: z.enum(FESTIVAL_REGIONS, "Türkiye mi yurt dışı mı, seç."),
    status: z
      .enum(FESTIVAL_STATUSES, "Durum seç.")
      .optional()
      .transform((v) => v ?? "watching"),
    startsOn: optionalDay,
    endsOn: optionalDay,
    dateNote: optionalLine(80),
    deadlineOn: optionalDay,
    deadlineNote: optionalLine(160),
    fee: optionalLine(160),
    place: optionalLine(120),
    url,
    linkLabel: optionalLine(160),
    note: optionalText(1000),
  })
  .superRefine((d, ctx) => {
    if (d.endsOn && !d.startsOn) {
      ctx.addIssue({ code: "custom", path: ["startsOn"], message: "Önce başlangıç tarihini seç." });
    } else if (d.endsOn && d.startsOn && d.endsOn < d.startsOn) {
      ctx.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "Bitiş, başlangıçtan önce olamaz.",
      });
    }
  })
  .transform((d) => ({ ...d, linkLabel: d.url ? d.linkLabel : null }));

export type FestivalInput = z.infer<typeof festivalSchema>;

export const specialDaySchema = z.object({
  day: z.string("Tarih seç.").trim().refine(isDay, "Tarih seç."),
  title: z
    .string("Ad boş olamaz.")
    .overwrite(cleanLine)
    .trim()
    .min(1, "Ad boş olamaz.")
    .max(80, "Ad en fazla 80 karakter olabilir."),
  kind: z.enum(SPECIAL_DAY_KINDS, "Tür seç."),
});
