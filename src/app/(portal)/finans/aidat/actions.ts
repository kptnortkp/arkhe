"use server";

import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeTx } from "@/db/write-tx";
import { duesOverrides, duesPeriods, financeEntries, memberDues } from "@/db/schema";
import { assertManager } from "@/lib/auth/dal";
import { ACCOUNTS, DUES_RATES } from "@/lib/finance/categories";
import { allocate, owedFor, owesPeriod, periodNameOf } from "@/lib/finance/dues";
import { guarded } from "@/lib/finance/guard";
import { derivedId, duesPosition, openingDate, type Tx } from "@/lib/finance/ledger";
import {
  amountField,
  boundedDayField,
  constraintKind,
  DATE_OUT_OF_RANGE,
  entryDayField,
  FORBIDDEN,
  inDateBounds,
  NOT_FOUND,
  STALE,
  text,
} from "@/lib/finance/schemas";
import { formatKurus, parseAmount } from "@/lib/money";
import { cleanLine, cleanText } from "@/lib/text";
import { addDays, now } from "@/lib/time";
import { fieldErrorsOf, formValues, type FormState } from "@/lib/validation";

const idSchema = z.uuid();
const NOT_RESPONSIBLE = "Bu kişi bu dönemden sorumlu değil.";
const HAS_PAYMENTS = "Bu döneme ödeme girilmiş.";

function revalidateDues() {
  revalidatePath("/", "layout");
}

const paymentSchema = z.object({
  clientId: z.uuid(),
  memberId: z.uuid(),
  periodIds: z
    .array(z.uuid())
    .transform((a) => [...new Set(a)])
    .pipe(z.array(z.uuid()).min(1, "Bir dönem seç.").max(24)),
  multi: z.literal("1").optional(),
  amount: z.string().optional(),
  // Multi mode: the total the treasurer saw; refused if the debt changed meanwhile.
  expected: z.coerce.number().int().optional(),
  occurredOn: entryDayField,
  account: z.enum(ACCOUNTS, "Hesap seç."),
  description: text(200),
});

/**
 * One entry per period, oldest due first. Ids derive from the form's clientId and the member, so a
 * replay returns the earlier result instead of tripping the overpayment guard.
 */
export async function recordDuesPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = paymentSchema.safeParse({
    ...Object.fromEntries(formData),
    periodIds: formData.getAll("periodIds"),
  });
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  let amount: number | null = null;
  if (!d.multi) {
    const a = parseAmount(String(d.amount ?? ""));
    if (!a.ok) return { values: formValues(formData), fieldErrors: { amount: [a.error] } };
    amount = a.kurus;
  }

  const result = await guarded(formData, () =>
    writeTx(async (tx): Promise<FormState> => {
      const ids = d.periodIds.map((p) => derivedId(d.clientId, d.memberId, p));
      const existing = await tx
        .select({
          amount: financeEntries.amountKurus,
          memberId: financeEntries.memberId,
          createdBy: financeEntries.createdBy,
        })
        .from(financeEntries)
        .where(inArray(financeEntries.id, ids));
      // Only the manager who made the payment may read its result back.
      if (existing.some((e) => e.memberId !== d.memberId || e.createdBy !== actor.id)) {
        return { error: STALE };
      }
      const position = await duesPosition(tx, d.memberId, d.periodIds);
      if (!position || position.periods.length !== d.periodIds.length) return { error: NOT_FOUND };
      const name = position.member.name;
      const nameOf = new Map(position.periods.map((p) => [p.period.id, p.period.name]));
      const paidMessage = (total: number, periodIds: string[]) =>
        `Ödeme alındı: ${name} · ${formatKurus(total)} (${periodIds.map((p) => nameOf.get(p)).join(", ")}).`;
      if (existing.length) {
        const total = existing.reduce((s, e) => s + e.amount, 0);
        return { success: paidMessage(total, d.periodIds) };
      }
      if (position.member.role !== "member" && position.member.role !== "board") {
        return { error: NOT_RESPONSIBLE };
      }
      if (position.periods.some((p) => !p.onRoster)) return { error: NOT_RESPONSIBLE };
      const open = position.periods.map((p) => ({
        periodId: p.period.id,
        dueOn: p.period.dueOn,
        remaining: p.remaining,
      }));
      const opened = await openingDate(tx);
      if (opened && d.occurredOn < opened) {
        return {
          values: formValues(formData),
          fieldErrors: { occurredOn: ["Tarih açılış bakiyesinden önce olamaz."] },
        };
      }
      const owedNow = open.reduce((s, p) => s + p.remaining, 0);
      if (amount === null && d.expected !== undefined && d.expected !== owedNow) {
        return { error: "Borç bu arada değişti. Sayfayı yenileyip tekrar dene." };
      }
      const total = amount ?? owedNow;
      if (total === 0) return { fieldErrors: { amount: ["Bu dönemlerin borcu yok."] } };
      const parts = allocate(total, open);
      if ("error" in parts)
        return { values: formValues(formData), fieldErrors: { amount: [parts.error] } };
      const group = parts.length > 1 ? derivedId(d.clientId, d.memberId, "group") : null;
      await tx.insert(financeEntries).values(
        parts.map((p) => ({
          id: derivedId(d.clientId, d.memberId, p.periodId),
          kind: "income" as const,
          category: "dues" as const,
          amountKurus: p.kurus,
          occurredOn: d.occurredOn,
          account: d.account,
          description: d.description,
          memberId: d.memberId,
          duesPeriodId: p.periodId,
          paymentGroupId: group,
          createdBy: actor.id,
          createdAt: now(),
        })),
      );
      return {
        success: paidMessage(
          total,
          parts.map((p) => p.periodId),
        ),
        values: { memberId: d.memberId },
      };
    }),
  );
  if (result.success) revalidateDues();
  return result;
}

// Periods ---------------------------------------------------------------------------------------

const optionalReduced = z
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

const REDUCED_TOO_HIGH = "İndirimli aidat tam aidattan az olmalı.";

const periodSchema = z
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

async function overlapping(tx: Tx, startsOn: string, endsOn: string, exceptId?: string) {
  const [row] = await tx
    .select({ name: duesPeriods.name })
    .from(duesPeriods)
    .where(
      and(
        lte(duesPeriods.startsOn, endsOn),
        gte(duesPeriods.endsOn, startsOn),
        exceptId ? ne(duesPeriods.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row ? `Bu tarihler ${row.name} dönemiyle çakışıyor.` : null;
}

async function nameTaken(tx: Tx, name: string, exceptId?: string) {
  const [row] = await tx
    .select({ id: duesPeriods.id })
    .from(duesPeriods)
    .where(and(eq(duesPeriods.name, name), exceptId ? ne(duesPeriods.id, exceptId) : undefined));
  return Boolean(row);
}

export async function createDuesPeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = periodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  return guarded(formData, async () => {
    const result = await writeTx(async (tx): Promise<FormState | null> => {
      if (await nameTaken(tx, d.name)) return { fieldErrors: { name: ["Bu adla bir dönem var."] } };
      const overlap = await overlapping(tx, d.startsOn, d.endsOn);
      if (overlap) return { fieldErrors: { startsOn: [overlap] } };
      await tx.insert(duesPeriods).values({
        name: d.name,
        startsOn: d.startsOn,
        endsOn: d.endsOn,
        dueOn: d.dueOn,
        amountKurus: d.amount,
        reducedAmountKurus: d.reducedAmount,
        createdBy: actor.id,
        createdAt: now(),
      });
      return null;
    });
    if (result) return { ...result, values: formValues(formData) };
    revalidateDues();
    return { success: "Dönem oluşturuldu." };
  });
}

async function hasPayments(tx: Tx, periodId: string, includeVoided: boolean) {
  const [row] = await tx
    .select({ id: financeEntries.id })
    .from(financeEntries)
    .where(
      and(
        eq(financeEntries.duesPeriodId, periodId),
        includeVoided ? undefined : isNull(financeEntries.voidedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function updateDuesPeriod(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const parsed = periodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  return guarded(formData, async () => {
    const result = await writeTx(async (tx): Promise<FormState | null> => {
      if (await hasPayments(tx, id, false))
        return { error: "Bu döneme ödeme girilmiş; değiştirilemez." };
      if (await nameTaken(tx, d.name, id))
        return { fieldErrors: { name: ["Bu adla bir dönem var."] } };
      const overlap = await overlapping(tx, d.startsOn, d.endsOn, id);
      if (overlap) return { fieldErrors: { startsOn: [overlap] } };
      const updated = await tx
        .update(duesPeriods)
        .set({
          name: d.name,
          startsOn: d.startsOn,
          endsOn: d.endsOn,
          dueOn: d.dueOn,
          amountKurus: d.amount,
          reducedAmountKurus: d.reducedAmount,
        })
        .where(eq(duesPeriods.id, id))
        .returning({ id: duesPeriods.id });
      return updated.length ? null : { error: NOT_FOUND };
    });
    if (result) return { ...result, values: formValues(formData) };
    revalidateDues();
    return { success: "Kaydedildi." };
  });
}

export async function deleteDuesPeriod(id: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  try {
    const result = await writeTx(async (tx) => {
      if (await hasPayments(tx, id, true)) return HAS_PAYMENTS;
      const deleted = await tx
        .delete(duesPeriods)
        .where(eq(duesPeriods.id, id))
        .returning({ id: duesPeriods.id });
      return deleted.length ? null : NOT_FOUND;
    });
    if (result) return { error: result };
  } catch (error) {
    if (constraintKind(error) !== "fk") throw error;
    return { error: HAS_PAYMENTS };
  }
  revalidateDues();
  return { success: "Dönem silindi." };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length <= 12) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const monthField = z
  .string()
  .regex(MONTH, "Ay seç.")
  .refine((v) => !MONTH.test(v) || inDateBounds(`${v}-01`), DATE_OUT_OF_RANGE);

const bulkSchema = z
  .object({
    fromMonth: monthField,
    toMonth: monthField,
    amount: amountField,
    reducedAmount: optionalReduced,
    dueDay: z.coerce
      .number("Gün 1 ile 28 arasında olmalı.")
      .int("Gün 1 ile 28 arasında olmalı.")
      .min(1, "Gün 1 ile 28 arasında olmalı.")
      .max(28, "Gün 1 ile 28 arasında olmalı."),
  })
  .superRefine((d, ctx) => {
    if (d.toMonth < d.fromMonth) {
      ctx.addIssue({ code: "custom", path: ["toMonth"], message: "Son ay ilk aydan önce olamaz." });
    } else if (monthsBetween(d.fromMonth, d.toMonth).length > 12) {
      ctx.addIssue({ code: "custom", path: ["toMonth"], message: "En fazla 12 ay seçebilirsin." });
    }
    if (d.reducedAmount !== null && d.reducedAmount >= d.amount) {
      ctx.addIssue({ code: "custom", path: ["reducedAmount"], message: REDUCED_TOO_HIGH });
    }
  });

/** One period per month; months whose name already exists are skipped, any other clash refuses all. */
export async function bulkCreateDuesPeriods(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = bulkSchema.safeParse({
    ...Object.fromEntries(formData),
    dueDay: formData.get("dueDay") || "15",
  });
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const result = await guarded(formData, () =>
    writeTx(async (tx): Promise<FormState> => {
      let created = 0;
      for (const month of monthsBetween(d.fromMonth, d.toMonth)) {
        const name = periodNameOf(month);
        if (await nameTaken(tx, name)) continue;
        const startsOn = `${month}-01`;
        const [y, m] = month.split("-").map(Number);
        const endsOn = addDays(
          `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`,
          -1,
        );
        const overlap = await overlapping(tx, startsOn, endsOn);
        if (overlap) throw new BulkError(`${name}: ${overlap}`);
        await tx.insert(duesPeriods).values({
          name,
          startsOn,
          endsOn,
          dueOn: `${month}-${String(d.dueDay).padStart(2, "0")}`,
          amountKurus: d.amount,
          reducedAmountKurus: d.reducedAmount,
          createdBy: actor.id,
          createdAt: now(),
        });
        created += 1;
      }
      if (created === 0) return { error: "Bu aylar için dönem zaten var." };
      return { success: `${created} dönem oluşturuldu.` };
    }).catch((error) => {
      if (error instanceof BulkError) return { error: error.message } as FormState;
      throw error;
    }),
  );
  if (result.success) revalidateDues();
  return result.error ? { ...result, values: formValues(formData) } : result;
}

class BulkError extends Error {}

// Rates and waivers -----------------------------------------------------------------------------

export async function setDuesRate(
  userId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(userId).success) return { error: NOT_FOUND };
  const parsed = z
    .object({ rate: z.enum(DUES_RATES, "Bir oran seç."), note: text(200) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  return guarded(formData, async () => {
    const result = await writeTx(async (tx) => {
      const position = await duesPosition(tx, userId);
      if (!position) return NOT_FOUND;
      if (position.member.role !== "member" && position.member.role !== "board") return FORBIDDEN;
      if (position.member.rate !== d.rate) {
        // Periods already being paid keep what they owed under the old rate.
        const frozen = position.periods.filter((p) => p.paid > 0 && !p.override && p.owed > 0);
        if (frozen.length) {
          await tx.insert(duesOverrides).values(
            frozen.map((p) => ({
              duesPeriodId: p.period.id,
              userId,
              kind: "freeze" as const,
              owedKurus: owedFor(position.member.rate, p.period, null, 0),
              reason: "Oran değişikliği",
              createdBy: actor.id,
              createdAt: now(),
            })),
          );
        }
      }
      await tx
        .insert(memberDues)
        .values({ userId, rate: d.rate, note: d.note, updatedBy: actor.id, updatedAt: now() })
        .onConflictDoUpdate({
          target: memberDues.userId,
          set: { rate: d.rate, note: d.note, updatedBy: actor.id, updatedAt: now() },
        });
      return null;
    });
    if (result) return { error: result };
    revalidateDues();
    return { success: "Aidat oranı güncellendi." };
  });
}

export async function setWaiver(
  periodId: string,
  userId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(periodId).success || !idSchema.safeParse(userId).success) {
    return { error: NOT_FOUND };
  }
  const reason = z
    .string()
    .overwrite(cleanText)
    .trim()
    .min(3, "Neden yaz (en az 3 karakter).")
    .max(200, "En fazla 200 karakter.")
    .safeParse(formData.get("reason") ?? "");
  if (!reason.success) {
    return {
      values: formValues(formData),
      fieldErrors: { reason: [reason.error.issues[0].message] },
    };
  }
  return guarded(formData, async () => {
    const result = await writeTx(async (tx) => {
      const position = await duesPosition(tx, userId, [periodId]);
      const p = position?.periods[0];
      if (!position || !p) return NOT_FOUND;
      if (!owesPeriod(position.member, p.period)) return NOT_RESPONSIBLE;
      if (p.paid > 0) return "Bu döneme ödeme girilmiş; önce ödemeyi iptal et.";
      await tx
        .insert(duesOverrides)
        .values({
          duesPeriodId: periodId,
          userId,
          kind: "waiver",
          owedKurus: 0,
          reason: reason.data,
          createdBy: actor.id,
          createdAt: now(),
        })
        .onConflictDoUpdate({
          target: [duesOverrides.duesPeriodId, duesOverrides.userId],
          set: {
            kind: "waiver",
            owedKurus: 0,
            reason: reason.data,
            createdBy: actor.id,
            createdAt: now(),
          },
        });
      return null;
    });
    if (result) return { error: result, values: formValues(formData) };
    revalidateDues();
    return { success: "Muaf tutuldu." };
  });
}

export async function removeWaiver(periodId: string, userId: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(periodId).success || !idSchema.safeParse(userId).success) {
    return { error: NOT_FOUND };
  }
  await writeTx((tx) =>
    tx
      .delete(duesOverrides)
      .where(
        and(
          eq(duesOverrides.duesPeriodId, periodId),
          eq(duesOverrides.userId, userId),
          eq(duesOverrides.kind, "waiver"),
        ),
      ),
  );
  revalidateDues();
  return { success: "Muafiyet kaldırıldı." };
}
