"use server";

import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { writeTx } from "@/db/write-tx";
import {
  appSettings,
  events,
  financeEntries,
  rehearsals,
  sponsors,
} from "@/db/schema";
import { assertManager } from "@/lib/auth/dal";
import { searchKey } from "@/lib/format";
import { BEFORE_OPENING, beforeOpening, overpaymentError } from "@/lib/finance/dues";
import { entryRow, type EntryInput } from "@/lib/finance/entries";
import { SPONSOR_TAKEN, sponsorSchema } from "@/lib/finance/sponsors";
import { FieldError, guarded } from "@/lib/finance/guard";
import { dropLapsedFreezes, duesPosition, openingDate, type Tx } from "@/lib/finance/ledger";
import {
  ACCOUNT_COOKIE,
  ALREADY_VOID,
  constraintKind,
  dayField,
  duesCorrectionSchema,
  entrySchema,
  FORBIDDEN,
  metaSchema,
  NOT_FOUND,
  openingDayField,
  safeReturn,
  STALE,
  voidReason,
} from "@/lib/finance/schemas";
import { AMOUNT_ZERO, parseAmount } from "@/lib/money";
import { secureCookies } from "@/lib/auth/cookie-names";
import { setFlash } from "@/lib/flash";
import { cleanLine, cleanText } from "@/lib/text";
import { now } from "@/lib/time";
import { fieldErrorsOf, formValues, type FormState } from "@/lib/validation";

const idSchema = z.uuid();
const OPENING_ONLY_IN_SETTINGS = "Açılış bakiyesi Ayarlar'dan değiştirilir.";

// Home cards (Kasa, Aidatım) live outside /finans, so every write refreshes the whole tree.
function revalidateFinance() {
  revalidatePath("/", "layout");
}

async function rememberAccount(account: "cash" | "bank") {
  (await cookies()).set(ACCOUNT_COOKIE, account, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/finans",
    maxAge: 365 * 24 * 3600,
  });
}


async function checkRefs(tx: Tx, d: EntryInput) {
  if ("sponsorId" in d && d.sponsorId) {
    const [s] = await tx
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(eq(sponsors.id, d.sponsorId));
    if (!s) throw new FieldError("sponsorId", "Sponsor seç.");
  }
  if ("eventId" in d && d.eventId) {
    const [e] = await tx.select({ id: events.id }).from(events).where(eq(events.id, d.eventId));
    if (!e) throw new FieldError("eventId", NOT_FOUND);
  }
  const opened = await openingDate(tx);
  if (beforeOpening(opened, d.occurredOn)) throw new FieldError("occurredOn", BEFORE_OPENING);
}

function parseEntry(formData: FormData) {
  return entrySchema.safeParse(Object.fromEntries(formData));
}

/** The id comes from the form (one per mount), so a double submit can't create two rows. */
export async function createEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: STALE };
  const parsed = parseEntry(formData);
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  return guarded(formData, async () => {
    const ok = await writeTx(async (tx) => {
      await checkRefs(tx, d);
      const rows = await tx
        .insert(financeEntries)
        .values({ id: id.data, ...entryRow(d), createdBy: actor.id, createdAt: now() })
        .onConflictDoNothing()
        .returning({ id: financeEntries.id });
      if (rows.length) return true;
      const [existing] = await tx
        .select({ createdBy: financeEntries.createdBy })
        .from(financeEntries)
        .where(eq(financeEntries.id, id.data));
      return existing?.createdBy === actor.id;
    });
    if (!ok) return { error: STALE };
    if (d.kind !== "transfer") await rememberAccount(d.account);
    revalidateFinance();
    return {
      success: "Kaydedildi.",
      values: {
        id: id.data,
        intent: String(formData.get("intent") ?? ""),
        redirect: safeReturn(formData.get("geri")),
      },
    };
  });
}

/** Düzelt: voids the old entry and saves its replacement in one transaction. */
export async function correctEntry(
  oldId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(oldId).success) return { error: NOT_FOUND };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: STALE };
  const [old] = await db.select().from(financeEntries).where(eq(financeEntries.id, oldId));
  if (!old) return { error: NOT_FOUND };
  if (old.kind === "opening") return { error: OPENING_ONLY_IN_SETTINGS };
  const isDues = old.category === "dues";
  const parsed = isDues
    ? duesCorrectionSchema.safeParse(Object.fromEntries(formData))
    : parseEntry(formData);
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);

  const state = await guarded(formData, async () => {
    const result = await writeTx(async (tx) => {
      const [replay] = await tx
        .select({ replacesId: financeEntries.replacesId, createdBy: financeEntries.createdBy })
        .from(financeEntries)
        .where(eq(financeEntries.id, id.data));
      if (replay)
        return replay.replacesId === oldId && replay.createdBy === actor.id ? null : STALE;
      // Read before the void: with the old payment still live, a rate-change freeze is honoured.
      const before = isDues ? await duesPosition(tx, old.memberId!, [old.duesPeriodId!]) : null;
      const voided = await tx
        .update(financeEntries)
        .set({ voidedAt: now(), voidedBy: actor.id, voidReason: "Düzeltildi" })
        .where(and(eq(financeEntries.id, oldId), isNull(financeEntries.voidedAt)))
        .returning({ id: financeEntries.id });
      if (!voided.length) return ALREADY_VOID;

      let row: Omit<typeof financeEntries.$inferInsert, "id" | "createdBy">;
      if (isDues) {
        const d = parsed.data as z.infer<typeof duesCorrectionSchema>;
        const remaining = (before?.periods[0]?.remaining ?? 0) + old.amountKurus;
        if (d.amount > remaining) throw new FieldError("amount", overpaymentError(remaining));
        const opened = await openingDate(tx);
        if (beforeOpening(opened, d.occurredOn)) throw new FieldError("occurredOn", BEFORE_OPENING);
        row = {
          kind: "income",
          category: "dues",
          amountKurus: d.amount,
          occurredOn: d.occurredOn,
          account: d.account,
          toAccount: null,
          description: d.description,
          counterparty: d.counterparty,
          documentUrl: d.documentUrl,
          sponsorId: null,
          eventId: old.eventId,
          memberId: old.memberId,
          duesPeriodId: old.duesPeriodId,
          paymentGroupId: old.paymentGroupId,
        };
      } else {
        const d = parsed.data as EntryInput;
        await checkRefs(tx, d);
        row = entryRow(d);
      }
      await tx.insert(financeEntries).values({
        id: id.data,
        ...row,
        replacesId: oldId,
        createdBy: actor.id,
        createdAt: now(),
      });
      return null;
    });
    if (result) return { error: result, values: formValues(formData) };
    const account = formData.get("account");
    if (
      !isDues &&
      formData.get("kind") !== "transfer" &&
      (account === "cash" || account === "bank")
    ) {
      await rememberAccount(account);
    }
    revalidateFinance();
    return { success: "Kayıt düzeltildi." };
  });
  if (!state.success) return state;
  // The old entry is voided now, so the form's own page re-renders without the form.
  await setFlash("kayit-duzeltildi");
  redirect(`/finans/${id.data}`);
}

/** Düzenle: only the four descriptive fields; amounts, dates and accounts need Düzelt. */
export async function updateEntryMeta(
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
  return guarded(formData, async () => {
    const result = await writeTx(async (tx): Promise<FormState | null> => {
      const [current] = await tx
        .select({ kind: financeEntries.kind, voidedAt: financeEntries.voidedAt })
        .from(financeEntries)
        .where(eq(financeEntries.id, id));
      if (!current) return { error: NOT_FOUND };
      if (current.voidedAt) return { error: ALREADY_VOID };
      if (current.kind === "opening") return { error: OPENING_ONLY_IN_SETTINGS };
      const withEvent = current.kind === "income" || current.kind === "expense";
      if (withEvent && d.eventId) {
        const [e] = await tx.select({ id: events.id }).from(events).where(eq(events.id, d.eventId));
        if (!e) throw new FieldError("eventId", NOT_FOUND);
      }
      const updated = await tx
        .update(financeEntries)
        .set({
          description: d.description,
          counterparty: d.counterparty,
          documentUrl: current.kind === "transfer" ? null : d.documentUrl,
          ...(withEvent ? { eventId: d.eventId } : {}),
          revision: sql`${financeEntries.revision} + 1`,
          updatedBy: actor.id,
          updatedAt: now(),
        })
        .where(
          and(
            eq(financeEntries.id, id),
            isNull(financeEntries.voidedAt),
            eq(financeEntries.revision, d.revision),
          ),
        )
        .returning({ id: financeEntries.id });
      return updated.length ? null : { error: STALE, values: formValues(formData) };
    });
    if (result) return result;
    revalidateFinance();
    return { success: "Kaydedildi." };
  });
}

export async function voidEntry(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const reason = voidReason.safeParse(formData.get("reason") ?? "");
  if (!reason.success) return { fieldErrors: { reason: [reason.error.issues[0].message] } };
  return guarded(formData, async () => {
    const error = await writeTx(async (tx) => {
      const [v] = await tx
        .update(financeEntries)
        .set({ voidedAt: now(), voidedBy: actor.id, voidReason: reason.data })
        .where(
          and(
            eq(financeEntries.id, id),
            isNull(financeEntries.voidedAt),
            ne(financeEntries.kind, "opening"),
          ),
        )
        .returning({
          category: financeEntries.category,
          memberId: financeEntries.memberId,
          periodId: financeEntries.duesPeriodId,
        });
      if (!v) {
        const [row] = await tx
          .select({ kind: financeEntries.kind, voidedAt: financeEntries.voidedAt })
          .from(financeEntries)
          .where(eq(financeEntries.id, id));
        if (!row) return NOT_FOUND;
        return row.voidedAt ? ALREADY_VOID : OPENING_ONLY_IN_SETTINGS;
      }
      if (v.category === "dues" && v.memberId && v.periodId) {
        await dropLapsedFreezes(tx, v.memberId, v.periodId);
      }
      return null;
    });
    if (error) return { error };
    revalidateFinance();
    return { success: "Kayıt iptal edildi." };
  });
}

// Settings --------------------------------------------------------------------------------------

function optionalAmount(raw: FormDataEntryValue | null, field: string) {
  const v = String(raw ?? "").trim();
  if (v === "") return 0;
  const parsed = parseAmount(v);
  // "0", "0,00" and "0.00" all mean no opening balance.
  if (!parsed.ok && parsed.error === AMOUNT_ZERO) return 0;
  if (!parsed.ok) throw new FieldError(field, parsed.error);
  return parsed.kurus;
}

export async function setOpeningBalances(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const date = openingDayField.safeParse(formData.get("openedOn") ?? "");
  if (!date.success) {
    return {
      values: formValues(formData),
      fieldErrors: { openedOn: [date.error.issues[0].message] },
    };
  }
  return guarded(formData, async () => {
    const amounts = {
      cash: optionalAmount(formData.get("cash"), "cash"),
      bank: optionalAmount(formData.get("bank"), "bank"),
    };
    await writeTx(async (tx) => {
      const [before] = await tx
        .select({ id: financeEntries.id })
        .from(financeEntries)
        .where(
          and(
            isNull(financeEntries.voidedAt),
            ne(financeEntries.kind, "opening"),
            lt(financeEntries.occurredOn, date.data),
          ),
        )
        .limit(1);
      if (before) throw new FieldError("openedOn", "Açılış tarihinden önce hareket var.");
      for (const account of ["cash", "bank"] as const) {
        const [current] = await tx
          .select()
          .from(financeEntries)
          .where(
            and(
              eq(financeEntries.kind, "opening"),
              eq(financeEntries.account, account),
              isNull(financeEntries.voidedAt),
            ),
          );
        const amount = amounts[account];
        if (current && current.amountKurus === amount && current.occurredOn === date.data) continue;
        if (!current && amount === 0) continue;
        if (current) {
          await tx
            .update(financeEntries)
            .set({ voidedAt: now(), voidedBy: actor.id, voidReason: "Açılış bakiyesi değişti" })
            .where(eq(financeEntries.id, current.id));
        }
        if (amount > 0) {
          await tx.insert(financeEntries).values({
            kind: "opening",
            amountKurus: amount,
            occurredOn: date.data,
            account,
            createdBy: actor.id,
            createdAt: now(),
          });
        }
      }
    });
    revalidateFinance();
    return { success: "Açılış bakiyesi kaydedildi." };
  });
}

export async function setPaymentInfo(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = z
    .object({ info: z.string().overwrite(cleanText).trim().max(500, "En fazla 500 karakter.") })
    .safeParse({ info: String(formData.get("info") ?? "").replace(/\r\n?/g, "\n") });
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const info = parsed.data.info.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "");
  if (!info) {
    await db.delete(appSettings).where(eq(appSettings.key, "dues_payment_info"));
  } else {
    await db
      .insert(appSettings)
      .values({ key: "dues_payment_info", value: info, updatedAt: now(), updatedBy: actor.id })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: info, updatedAt: now(), updatedBy: actor.id },
      });
  }
  revalidateFinance();
  return { success: "Ödeme bilgisi güncellendi.", values: { info } };
}

// Events ----------------------------------------------------------------------------------------

const eventSchema = z.object({
  name: z.string().overwrite(cleanLine).trim().min(1, "Ad gir.").max(80, "En fazla 80 karakter."),
  startsOn: dayField,
  rehearsalId: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
});

export async function createEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: STALE };
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  if (d.rehearsalId) {
    const [r] = await db
      .select({ type: rehearsals.type, cancelledAt: rehearsals.cancelledAt })
      .from(rehearsals)
      .where(eq(rehearsals.id, d.rehearsalId));
    if (!r || r.type !== "concert" || r.cancelledAt) {
      return { values: formValues(formData), fieldErrors: { rehearsalId: ["Bir konser seç."] } };
    }
  }
  try {
    const rows = await db
      .insert(events)
      .values({ id: id.data, ...d, createdBy: actor.id, createdAt: now() })
      .onConflictDoNothing({ target: events.id })
      .returning({ id: events.id });
    if (!rows.length) {
      const [existing] = await db
        .select({ createdBy: events.createdBy })
        .from(events)
        .where(eq(events.id, id.data));
      if (existing?.createdBy !== actor.id) return { error: STALE };
    }
  } catch (error) {
    if (constraintKind(error) !== "unique") throw error;
    return { error: "Bu konser için etkinlik var.", values: formValues(formData) };
  }
  revalidateFinance();
  return { success: "Etkinlik oluşturuldu.", values: { id: id.data } };
}

export async function updateEvent(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const parsed = eventSchema.omit({ rehearsalId: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const updated = await db
    .update(events)
    .set(parsed.data)
    .where(eq(events.id, id))
    .returning({ id: events.id });
  if (!updated.length) return { error: NOT_FOUND };
  revalidateFinance();
  return { success: "Kaydedildi." };
}

const EVENT_HAS_ENTRIES = "Bu etkinliğe bağlı hareketler var.";

export async function deleteEvent(id: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  try {
    const result = await writeTx(async (tx) => {
      const [entry] = await tx
        .select({ id: financeEntries.id })
        .from(financeEntries)
        .where(eq(financeEntries.eventId, id))
        .limit(1);
      if (entry) return EVENT_HAS_ENTRIES;
      const deleted = await tx.delete(events).where(eq(events.id, id)).returning({ id: events.id });
      return deleted.length ? null : NOT_FOUND;
    });
    if (result) return { error: result };
  } catch (error) {
    // Backstop for an entry linked in between: the restrict FK rolls the delete back.
    if (constraintKind(error) !== "fk") throw error;
    return { error: EVENT_HAS_ENTRIES };
  }
  revalidateFinance();
  return { success: "Etkinlik silindi.", values: { redirect: "/finans/etkinlikler" } };
}

// Sponsors --------------------------------------------------------------------------------------

export async function createSponsor(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: STALE };
  const parsed = sponsorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const nameKey = searchKey(d.name);
  const [taken] = await db
    .select({ id: sponsors.id })
    .from(sponsors)
    .where(eq(sponsors.nameKey, nameKey));
  if (taken && taken.id !== id.data) {
    return { values: formValues(formData), fieldErrors: { name: [SPONSOR_TAKEN] } };
  }
  try {
    await db
      .insert(sponsors)
      .values({ id: id.data, ...d, nameKey, createdAt: now() })
      .onConflictDoNothing({ target: sponsors.id });
  } catch (error) {
    if (constraintKind(error) !== "unique") throw error;
    return { values: formValues(formData), fieldErrors: { name: [SPONSOR_TAKEN] } };
  }
  revalidateFinance();
  return { success: "Sponsor kaydedildi.", values: { id: id.data, name: d.name } };
}

export async function updateSponsor(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const parsed = sponsorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const nameKey = searchKey(d.name);
  const isActive = formData.get("isActive") === "on";
  try {
    const updated = await db
      .update(sponsors)
      .set({ ...d, nameKey, isActive })
      .where(eq(sponsors.id, id))
      .returning({ id: sponsors.id });
    if (!updated.length) return { error: NOT_FOUND };
  } catch (error) {
    if (constraintKind(error) !== "unique") throw error;
    return { values: formValues(formData), fieldErrors: { name: [SPONSOR_TAKEN] } };
  }
  revalidateFinance();
  return { success: "Sponsor kaydedildi." };
}
