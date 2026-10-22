// Dues period rules shared by the period forms and the historical import.
import { z } from "zod";
import { parseAmount } from "@/lib/money";
import { cleanLine } from "@/lib/text";
import { amountField, boundedDayField } from "./schemas";

export const optionalReduced = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v?.trim()) return null;
    const a = parseAmount(v);
    if (!a.ok) {
      ctx.addIssue({ code: "custom", message: a.error });
      return z.NEVER;
    }
    return a.kurus;
  });

export const REDUCED_TOO_HIGH = "İndirimli aidat tam aidattan az olmalı.";
export const PERIOD_NAME_TAKEN = "Bu adla bir dönem var.";

export const periodSchema = z
  .object({
    name: z.string().overwrite(cleanLine).trim().min(1, "Ad gir.").max(40, "En fazla 40 karakter."),
    startsOn: boundedDayField,
    endsOn: boundedDayField,
    dueOn: boundedDayField,
    amount: amountField,
    reducedAmount: optionalReduced,
  })
  .superRefine((d, ctx) => {
    if (d.endsOn < d.startsOn) {
      ctx.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "Bitiş başlangıçtan önce olamaz.",
      });
    }
    if (d.dueOn < d.startsOn) {
      ctx.addIssue({
        code: "custom",
        path: ["dueOn"],
        message: "Son ödeme başlangıçtan önce olamaz.",
      });
    }
    if (d.reducedAmount !== null && d.reducedAmount >= d.amount) {
      ctx.addIssue({ code: "custom", path: ["reducedAmount"], message: REDUCED_TOO_HIGH });
    }
  });

type PeriodRange = { id?: string; name: string; startsOn: string; endsOn: string };

/** The overlap message for [startsOn, endsOn] against `periods` (inclusive days), or null. */
export function periodOverlap(
  periods: readonly PeriodRange[],
  startsOn: string,
  endsOn: string,
  exceptId?: string,
) {
  const hit = periods.find(
    (p) => p.startsOn <= endsOn && p.endsOn >= startsOn && (!exceptId || p.id !== exceptId),
  );
  return hit ? `Bu tarihler ${hit.name} dönemiyle çakışıyor.` : null;
}

export function periodNameTaken(periods: readonly PeriodRange[], name: string, exceptId?: string) {
  return periods.some((p) => p.name === name && (!exceptId || p.id !== exceptId));
}
