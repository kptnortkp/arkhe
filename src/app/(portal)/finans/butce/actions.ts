"use server";

import { and, eq, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { writeTx, type Tx } from "@/db/write-tx";
import { budgetLines, budgetRevisionLines, budgetRevisions, budgets } from "@/db/schema";
import { assertManager } from "@/lib/auth/dal";
import {
  APPROVED_LOCKED,
  APPROVED_NO_DELETE,
  EMPTY_PLAN,
  endMonthOf,
  MONTH,
  NAME_TAKEN,
  NO_CHANGE,
  NO_PRIOR,
  overlapError,
  PLAN_STALE,
} from "@/lib/finance/budget";
import { CATEGORIES, type Category } from "@/lib/finance/categories";
import { FieldError, guarded } from "@/lib/finance/guard";
import { priorActuals } from "@/lib/finance/queries";
import { CHECK_FAILED, FORBIDDEN, NOT_FOUND } from "@/lib/finance/schemas";
import { setFlash } from "@/lib/flash";
import { parsePlanAmount } from "@/lib/money";
import { cleanLine, cleanText } from "@/lib/text";
import { istanbulDateOf, now } from "@/lib/time";
import { fieldErrorsOf, formValues, type FormState } from "@/lib/validation";

const idSchema = z.uuid();
const nowSql = sql`(unixepoch())`;

function revalidateBudget() {
  revalidatePath("/", "layout");
}

const metaSchema = z.object({
  name: z
    .string("Bir ad yaz.")
    .overwrite(cleanLine)
    .trim()
    .min(1, "Bir ad yaz.")
    .max(40, "Ad en fazla 40 karakter olabilir."),
  start: z
    .string("Başlangıç ayı seç.")
    .trim()
    .refine((v) => {
      if (!MONTH.test(v)) return false;
      const year = Number(v.slice(0, 4));
      return year >= 2000 && year <= Number(istanbulDateOf(now()).slice(0, 4)) + 10;
    }, "Başlangıç ayı seç."),
  note: z
    .string()
    .overwrite(cleanText)
    .trim()
    .max(500, "Not en fazla 500 karakter olabilir.")
    .optional()
    .transform((v) => v || null),
});

const reasonSchema = z
  .string("Gerekçe en az 5 karakter olmalı.")
  .overwrite(cleanLine)
  .trim()
  // The CHECK counts characters, not UTF-16 units: "😀😀😀" is 3, not 6.
  .refine((v) => [...v].length >= 5, "Gerekçe en az 5 karakter olmalı.")
  .max(200, "Gerekçe en fazla 200 karakter olabilir.");

/** The name of a budget other than `selfId` whose 12 months overlap [start, end). */
async function overlapping(tx: Tx | typeof db, selfId: string, start: string) {
  const [hit] = await tx
    .select({ name: budgets.name })
    .from(budgets)
    .where(
      and(
        ne(budgets.id, selfId),
        sql`${budgets.startMonth} < ${endMonthOf(start)}`,
        sql`${start} < ${budgets.endMonth}`,
      ),
    )
    .limit(1);
  return hit?.name ?? null;
}

async function checkMeta(tx: Tx, selfId: string, name: string, start: string) {
  const other = await overlapping(tx, selfId, start);
  if (other) throw new FieldError("start", overlapError(other));
  const [taken] = await tx
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.name, name), ne(budgets.id, selfId)));
  if (taken) throw new FieldError("name", NAME_TAKEN);
}

function errorText(error: unknown) {
  let text = "";
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    text += e instanceof Error ? e.message : "";
  }
  return text;
}

/** Maps a lost race (the overlap trigger or a unique index) to the AC 26 texts. */
function budgetGuarded(
  formData: FormData,
  start: string,
  selfId: string,
  fn: () => Promise<FormState>,
) {
  return guarded(formData, async () => {
    try {
      return await fn();
    } catch (error) {
      const text = errorText(error);
      if (text.includes("budgets.name")) throw new FieldError("name", NAME_TAKEN);
      if (text.includes("budgets_overlap") || text.includes("budgets.start_month")) {
        const other = await overlapping(db, selfId, start);
        throw new FieldError("start", overlapError(other ?? "başka bir"));
      }
      throw error;
    }
  });
}

/** Oluştur: a Taslak; the id is the form's per-mount uuid, so a double submit makes one budget. */
export async function createBudget(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: PLAN_STALE };
  const parsed = metaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const state = await budgetGuarded(formData, d.start, id.data, async () => {
    const ok = await writeTx(async (tx) => {
      const [replay] = await tx
        .select({ createdBy: budgets.createdBy })
        .from(budgets)
        .where(eq(budgets.id, id.data));
      if (replay) return replay.createdBy === actor.id;
      await checkMeta(tx, id.data, d.name, d.start);
      await tx.insert(budgets).values({
        id: id.data,
        name: d.name,
        startMonth: d.start,
        endMonth: endMonthOf(d.start),
        note: d.note,
        createdBy: actor.id,
        createdAt: nowSql,
      });
      return true;
    });
    return ok ? { success: "ok" } : { error: PLAN_STALE };
  });
  if (!state.success) return state;
  revalidateBudget();
  await setFlash("taslak-olusturuldu");
  redirect(`/finans/butce/${id.data}/duzenle`);
}

/** Name, start and note. Approved budgets keep their name and start; the note stays editable. */
export async function updateBudget(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const parsed = metaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const state = await budgetGuarded(formData, d.start, id, async () => {
    const error = await writeTx(async (tx): Promise<string | null> => {
      const [cur] = await tx.select().from(budgets).where(eq(budgets.id, id));
      if (!cur) return NOT_FOUND;
      if (cur.approvedAt) {
        if (d.name !== cur.name || d.start !== cur.startMonth) return APPROVED_LOCKED;
        if (d.note === cur.note) return null;
        await tx
          .update(budgets)
          .set({ note: d.note, updatedAt: nowSql, updatedBy: actor.id })
          .where(eq(budgets.id, id));
        return null;
      }
      await checkMeta(tx, id, d.name, d.start);
      // A new name or period makes an open report's Onayla stale; a note-only save doesn't.
      const metaChanged = d.name !== cur.name || d.start !== cur.startMonth;
      // Status in the statement: an approval that landed meanwhile locks name and start.
      const hit = await tx
        .update(budgets)
        .set({
          ...(metaChanged ? { revision: sql`${budgets.revision} + 1` } : {}),
          name: d.name,
          startMonth: d.start,
          endMonth: endMonthOf(d.start),
          note: d.note,
          updatedAt: nowSql,
          updatedBy: actor.id,
        })
        .where(and(eq(budgets.id, id), isNull(budgets.approvedAt)))
        .returning({ id: budgets.id });
      return hit.length ? null : APPROVED_LOCKED;
    });
    return error ? { error, values: formValues(formData) } : { success: "Kaydedildi." };
  });
  if (state.success) revalidateBudget();
  return state;
}

/** Every category must be posted; a missing key is a broken request, never "set to 0". */
function parsePlan(formData: FormData) {
  const plan = {} as Record<Category, number>;
  const fieldErrors: Record<string, string[]> = {};
  for (const c of CATEGORIES) {
    const raw = formData.get(c);
    if (typeof raw !== "string") return { missing: true as const };
    const parsed = parsePlanAmount(raw);
    if (parsed.ok) plan[c] = parsed.kurus;
    else fieldErrors[c] = [parsed.error];
  }
  return { plan, fieldErrors };
}

/** Kaydet in the editor: a free draft save, or on an approved budget a revision with a reason (D17). */
export async function savePlan(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const revision = z.coerce
    .number()
    .int()
    .min(0)
    .safeParse(formData.get("revision") ?? undefined);
  if (!revision.success) return { error: PLAN_STALE };
  const parsed = parsePlan(formData);
  if ("missing" in parsed) return { error: CHECK_FAILED };
  if (Object.keys(parsed.fieldErrors).length) {
    return { values: formValues(formData), fieldErrors: parsed.fieldErrors };
  }
  const next = parsed.plan;

  const state = await guarded(formData, async () => {
    const error = await writeTx(async (tx): Promise<string | null> => {
      const [cur] = await tx
        .select({ approvedAt: budgets.approvedAt, revision: budgets.revision })
        .from(budgets)
        .where(eq(budgets.id, id));
      if (!cur) return NOT_FOUND;
      const rows = await tx
        .select({ category: budgetLines.category, amountKurus: budgetLines.amountKurus })
        .from(budgetLines)
        .where(eq(budgetLines.budgetId, id));
      const old = new Map(rows.map((r) => [r.category, r.amountKurus]));
      const changed = CATEGORIES.filter((c) => (old.get(c) ?? 0) !== next[c]);
      const approved = cur.approvedAt !== null;
      let reason: string | null = null;
      if (approved) {
        if (!changed.length) return NO_CHANGE;
        const r = reasonSchema.safeParse(formData.get("reason") ?? undefined);
        if (!r.success) throw new FieldError("reason", r.error.issues[0].message);
        reason = r.data;
      } else if (!changed.length) {
        return null;
      }
      const hit = await tx
        .update(budgets)
        .set({ revision: sql`${budgets.revision} + 1`, updatedAt: nowSql, updatedBy: actor.id })
        .where(
          and(
            eq(budgets.id, id),
            eq(budgets.revision, revision.data),
            approved ? isNotNull(budgets.approvedAt) : isNull(budgets.approvedAt),
          ),
        )
        .returning({ id: budgets.id });
      if (!hit.length) return PLAN_STALE;
      const planned = CATEGORIES.filter((c) => next[c] > 0);
      await tx
        .delete(budgetLines)
        .where(
          planned.length
            ? and(eq(budgetLines.budgetId, id), notInArray(budgetLines.category, planned))
            : eq(budgetLines.budgetId, id),
        );
      const upserts = changed.filter((c) => next[c] > 0);
      if (upserts.length) {
        await tx
          .insert(budgetLines)
          .values(upserts.map((c) => ({ budgetId: id, category: c, amountKurus: next[c] })))
          .onConflictDoUpdate({
            target: [budgetLines.budgetId, budgetLines.category],
            set: { amountKurus: sql`excluded.amount_kurus` },
          });
      }
      if (reason !== null) {
        const [rev] = await tx
          .insert(budgetRevisions)
          .values({ budgetId: id, reason, actorId: actor.id, createdAt: nowSql })
          .returning({ id: budgetRevisions.id });
        await tx.insert(budgetRevisionLines).values(
          changed.map((c) => ({
            revisionId: rev.id,
            category: c,
            fromKurus: old.get(c) ?? 0,
            toKurus: next[c],
          })),
        );
      }
      return null;
    });
    return error ? { error, values: formValues(formData) } : { success: "ok" };
  });
  if (!state.success) return state;
  revalidateBudget();
  await setFlash("plan-kaydedildi");
  redirect(`/finans/butce/${id}`);
}

/** Onayla: the revision makes you approve the plan you saw (D17, D34). */
export async function approveBudget(id: string, rawRevision: number): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const revision = z.coerce.number().int().min(0).safeParse(rawRevision);
  if (!revision.success) return { error: PLAN_STALE };
  const error = await writeTx(async (tx): Promise<string | null> => {
    const [cur] = await tx
      .select({ approvedAt: budgets.approvedAt, approvedBy: budgets.approvedBy })
      .from(budgets)
      .where(eq(budgets.id, id));
    if (!cur) return NOT_FOUND;
    if (cur.approvedAt) return cur.approvedBy === actor.id ? null : PLAN_STALE;
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(budgetLines)
      .where(eq(budgetLines.budgetId, id));
    if (Number(n) === 0) return EMPTY_PLAN;
    const hit = await tx
      .update(budgets)
      .set({
        approvedAt: nowSql,
        approvedBy: actor.id,
        revision: sql`${budgets.revision} + 1`,
        updatedAt: nowSql,
        updatedBy: actor.id,
      })
      .where(
        and(eq(budgets.id, id), isNull(budgets.approvedAt), eq(budgets.revision, revision.data)),
      )
      .returning({ id: budgets.id });
    return hit.length ? null : PLAN_STALE;
  });
  if (error) return { error };
  revalidateBudget();
  return { success: "Bütçe onaylandı." };
}

/** Drafts only; the lines cascade, ledger entries are untouched. */
export async function deleteBudget(id: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const deleted = await db
    .delete(budgets)
    .where(and(eq(budgets.id, id), isNull(budgets.approvedAt)))
    .returning({ id: budgets.id });
  if (!deleted.length) {
    const [cur] = await db.select({ id: budgets.id }).from(budgets).where(eq(budgets.id, id));
    return { error: cur ? APPROVED_NO_DELETE : NOT_FOUND };
  }
  revalidateBudget();
  await setFlash("butce-silindi");
  redirect("/finans/butce");
}

/** Önceki 12 aydan doldur: read-only; the editor fills its inputs and saves nothing (D18). */
export async function prefillPlan(id: string): Promise<{
  error?: string;
  empty?: true;
  info?: string;
  lines?: Partial<Record<Category, number>>;
  // The window hasn't fully passed: the numbers only cover entries through `throughLabel`.
  partial?: boolean;
  throughLabel?: string | null;
  lastFullMonth?: string | null;
}> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const prior = await priorActuals(id);
  if (!prior) return { error: NOT_FOUND };
  const { lines, partial, throughLabel, lastFullMonth } = prior;
  const window = { partial, throughLabel, lastFullMonth };
  if (!Object.keys(lines).length) return { empty: true, info: NO_PRIOR, ...window };
  return { lines, ...window };
}
