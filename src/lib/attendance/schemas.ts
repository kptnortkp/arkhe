// Rehearsal and term rules shared by the forms' actions and the historical import.
import { z } from "zod";
import { REHEARSAL_TYPES, VOICE_PARTS } from "@/db/schema";
import { cleanLine } from "@/lib/text";
import { addDays } from "@/lib/time";
import { optionalLine, optionalText } from "@/lib/validation";
import { SERIES_MAX_WEEKS } from "./rules";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seç.");
export const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Saat seç.");

export const rehearsalSchema = z
  .object({
    type: z.enum(REHEARSAL_TYPES, "Bir tür seç."),
    date: dateSchema,
    start: timeSchema,
    end: timeSchema,
    title: optionalLine(80),
    location: optionalLine(120),
    note: optionalText(500),
    parts: z.array(z.enum(VOICE_PARTS)).max(4),
    repeat: z.literal("on").optional(),
    repeatUntil: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.type === "sectional" && d.parts.length === 0) {
      ctx.addIssue({ code: "custom", path: ["parts"], message: "En az bir partisyon seç." });
    }
    if (d.end <= d.start) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "Bitiş, başlangıçtan sonra olmalı." });
    }
    if (d.repeat) {
      if (!d.repeatUntil || !/^\d{4}-\d{2}-\d{2}$/.test(d.repeatUntil) || d.repeatUntil < d.date) {
        ctx.addIssue({
          code: "custom",
          path: ["repeatUntil"],
          message: "Geçerli bir son tarih seç.",
        });
      } else if (d.repeatUntil > addDays(d.date, SERIES_MAX_WEEKS * 7)) {
        ctx.addIssue({
          code: "custom",
          path: ["repeatUntil"],
          message: `En fazla ${SERIES_MAX_WEEKS} hafta ileriye kadar.`,
        });
      }
    }
  });

export const termSchema = z
  .object({
    name: z
      .string()
      .overwrite(cleanLine)
      .trim()
      .min(1, "Bir ad gir.")
      .max(40, "En fazla 40 karakter."),
    startsOn: dateSchema,
    endsOn: dateSchema,
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    path: ["endsOn"],
    message: "Bitiş başlangıçtan önce olamaz.",
  })
  .refine((d) => d.endsOn <= addDays(d.startsOn, 366), {
    path: ["endsOn"],
    message: "Bir dönem en fazla bir yıl olabilir.",
  });

export const TERM_OVERLAP = "Dönemler çakışamaz.";
export const TERM_NAME_TAKEN = "Bu adla bir dönem zaten var.";

type TermLike = { name: string; startsOn: string; endsOn: string };

/** The first rule a new term breaks against `existing`, or null. Days are inclusive. */
export function termConflict(
  existing: readonly TermLike[],
  d: TermLike,
): { field: "name" | "dates"; message: string } | null {
  if (existing.some((t) => t.startsOn <= d.endsOn && t.endsOn >= d.startsOn)) {
    return { field: "dates", message: TERM_OVERLAP };
  }
  if (existing.some((t) => t.name === d.name)) return { field: "name", message: TERM_NAME_TAKEN };
  return null;
}
