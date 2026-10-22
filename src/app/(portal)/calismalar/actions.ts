"use server";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { attendance, rehearsalParts, rehearsalSecrets, rehearsals, terms } from "@/db/schema";
import { closeRehearsal } from "@/lib/attendance/close";
import { newSecretRow, verifyCode } from "@/lib/attendance/code";
import { getRehearsal, phaseOf } from "@/lib/attendance/rehearsals";
import { isExpected, loadRosterUsers, rosterOf } from "@/lib/attendance/roster";
import {
  CHECKIN_MAX_WRONG,
  CHECKIN_MAX_WRONG_PER_DAY,
  CHECKIN_WINDOW_MS,
  LATE_AFTER_MINUTES,
} from "@/lib/attendance/rules";
import {
  rehearsalSchema,
  TERM_NAME_TAKEN,
  termConflict,
  termSchema,
} from "@/lib/attendance/schemas";
import { assertManager, assertUser } from "@/lib/auth/dal";
import { consumeAttempt, forgetAttempt } from "@/lib/auth/rate-limit";
import { addDays, istanbulToUtc } from "@/lib/time";
import { fieldErrorsOf, formValues, optionalText, type FormState } from "@/lib/validation";

const FORBIDDEN = "Bu işlem için yetkin yok.";
const NOT_FOUND = "Bu çalışma bulunamadı.";

function revalidateRehearsal(id?: string) {
  revalidatePath("/");
  revalidatePath("/calismalar");
  if (id) revalidatePath(`/calismalar/${id}`);
}

const idSchema = z.uuid();
function parseRehearsalForm(formData: FormData) {
  return rehearsalSchema.safeParse({
    ...Object.fromEntries(formData),
    parts: formData.getAll("parts"),
  });
}

export async function createRehearsal(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = parseRehearsalForm(formData);
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;

  const dates = [d.date];
  if (d.repeat && d.repeatUntil) {
    for (let next = addDays(d.date, 7); next <= d.repeatUntil; next = addDays(next, 7)) {
      dates.push(next);
    }
  }
  if (istanbulToUtc(d.date, d.start) < new Date(Date.now() - 24 * 3600_000)) {
    return {
      values: formValues(formData),
      fieldErrors: { date: ["Bir günden eski bir tarihe çalışma eklenemez."] },
    };
  }

  const seriesId = dates.length > 1 ? crypto.randomUUID() : null;
  const rows = dates.map((date) => ({
    id: crypto.randomUUID(),
    type: d.type,
    title: d.title,
    location: d.location,
    note: d.note,
    startsAt: istanbulToUtc(date, d.start),
    endsAt: istanbulToUtc(date, d.end),
    seriesId,
    createdBy: actor.id,
  }));
  await db.transaction(async (tx) => {
    await tx.insert(rehearsals).values(rows);
    if (d.type === "sectional") {
      await tx
        .insert(rehearsalParts)
        .values(
          rows.flatMap((r) => d.parts.map((voicePart) => ({ rehearsalId: r.id, voicePart }))),
        );
    }
  });
  revalidateRehearsal();
  redirect(rows.length === 1 ? `/calismalar/${rows[0].id}` : "/calismalar");
}

export async function updateRehearsal(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const current = await getRehearsal(id);
  if (!current || current.cancelledAt) return { error: NOT_FOUND };
  const parsed = parseRehearsalForm(formData);
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const startsAt = istanbulToUtc(d.date, d.start);
  if (
    current.openedAt &&
    Math.abs(startsAt.getTime() - current.startsAt.getTime()) > 24 * 3600_000
  ) {
    return {
      values: formValues(formData),
      fieldErrors: { date: ["Yoklaması alınmış bir çalışma en fazla bir gün kaydırılabilir."] },
    };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(rehearsals)
      .set({
        type: d.type,
        title: d.title,
        location: d.location,
        note: d.note,
        startsAt,
        endsAt: istanbulToUtc(d.date, d.end),
      })
      .where(eq(rehearsals.id, id));
    await tx.delete(rehearsalParts).where(eq(rehearsalParts.rehearsalId, id));
    if (d.type === "sectional") {
      await tx
        .insert(rehearsalParts)
        .values(d.parts.map((voicePart) => ({ rehearsalId: id, voicePart })));
    }
  });
  revalidateRehearsal(id);
  redirect(`/calismalar/${id}`);
}

export async function setCancelled(id: string, cancelled: boolean): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const r = idSchema.safeParse(id).success ? await getRehearsal(id) : null;
  if (!r) return { error: NOT_FOUND };
  if (r.openedAt) return { error: "Yoklaması alınmış bir çalışma iptal edilemez." };
  await db
    .update(rehearsals)
    .set(
      cancelled
        ? { cancelledAt: new Date(), cancelledBy: actor.id }
        : { cancelledAt: null, cancelledBy: null },
    )
    .where(and(eq(rehearsals.id, id), isNull(rehearsals.openedAt)));
  revalidateRehearsal(id);
  return { success: cancelled ? "Çalışma iptal edildi." : "İptal geri alındı." };
}

export async function endSeries(id: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const r = idSchema.safeParse(id).success ? await getRehearsal(id) : null;
  if (!r?.seriesId) return { error: NOT_FOUND };
  const after = new Date(Math.max(Date.now(), r.startsAt.getTime()));
  const deleted = await db
    .delete(rehearsals)
    .where(
      and(
        eq(rehearsals.seriesId, r.seriesId),
        gt(rehearsals.startsAt, after),
        isNull(rehearsals.openedAt),
      ),
    )
    .returning({ id: rehearsals.id });
  revalidateRehearsal(id);
  return { success: `Seri bitirildi, sonraki ${deleted.length} çalışma silindi.` };
}

export async function openAttendance(id: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const r = idSchema.safeParse(id).success ? await getRehearsal(id) : null;
  if (!r) return { error: NOT_FOUND };
  const phase = phaseOf(r);
  if (phase === "open") redirect(`/calismalar/${id}/canli`);
  if (phase !== "openable") {
    return {
      error:
        phase === "upcoming"
          ? "Yoklama çalışmadan 2 saat önce başlatılabilir."
          : "Bu çalışmanın yoklaması başlatılamaz.",
    };
  }
  await db.transaction(async (tx) => {
    const opened = await tx
      .update(rehearsals)
      .set({ openedAt: new Date() })
      .where(
        and(eq(rehearsals.id, id), isNull(rehearsals.openedAt), isNull(rehearsals.cancelledAt)),
      )
      .returning({ id: rehearsals.id });
    // Someone else opened it a moment ago: keep their secret, or their screen shows wrong codes.
    if (opened.length === 0) return;
    const row = newSecretRow(id);
    await tx
      .insert(rehearsalSecrets)
      .values(row)
      .onConflictDoUpdate({
        target: rehearsalSecrets.rehearsalId,
        set: { secret: row.secret, rotatedAt: row.rotatedAt },
      });
  });
  revalidateRehearsal(id);
  redirect(`/calismalar/${id}/canli`);
}

export async function closeAttendance(id: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const r = idSchema.safeParse(id).success ? await getRehearsal(id) : null;
  if (!r || r.cancelledAt) return { error: NOT_FOUND };
  if (r.startsAt > new Date() && !r.openedAt) return { error: "Bu çalışma henüz başlamadı." };
  const absent = await closeRehearsal(id);
  const roster = await rosterOf(id, { includeNotes: false });
  const came =
    roster?.rows.filter((x) => x.status === "present" || x.status === "late").length ?? 0;
  const expected = roster?.rows.filter((x) => x.onRoster).length ?? 0;
  revalidateRehearsal(id);
  return {
    success: `Yoklama kapandı. Geldi ${came} / ${expected}.${absent ? ` ${absent} kişi gelmedi olarak kaydedildi.` : ""}`,
  };
}

export async function markRemainingPresent(
  id: string,
  part: string,
): Promise<FormState & { userIds?: string[] }> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const r = idSchema.safeParse(id).success ? await getRehearsal(id) : null;
  if (!r || r.cancelledAt || !r.openedAt) return { error: NOT_FOUND };
  const roster = await rosterOf(id, { includeNotes: false });
  const targets =
    roster?.rows
      .filter((x) => x.onRoster && x.status === null && (x.voicePart ?? "none") === part)
      .map((x) => x.userId) ?? [];
  if (targets.length === 0) return { userIds: [] };
  const inserted = await db
    .insert(attendance)
    .values(
      targets.map((userId) => ({
        rehearsalId: id,
        userId,
        status: "present" as const,
        method: "manual" as const,
        recordedBy: actor.id,
        correctedAt: r.closedAt ? new Date() : null,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: attendance.userId });
  revalidateRehearsal(id);
  return { userIds: inserted.map((x) => x.userId) };
}

/** Undo for the bulk action: removes exactly the rows it created, if nobody changed them since. */
export async function undoBulkPresent(id: string, userIds: string[]): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const ids = z.array(z.uuid()).max(100).safeParse(userIds);
  if (!idSchema.safeParse(id).success || !ids.success) return { error: NOT_FOUND };
  await db
    .delete(attendance)
    .where(
      and(
        eq(attendance.rehearsalId, id),
        inArray(attendance.userId, ids.data),
        eq(attendance.method, "manual"),
        eq(attendance.status, "present"),
        eq(attendance.recordedBy, actor.id),
      ),
    );
  revalidateRehearsal(id);
  return { success: "Geri alındı." };
}

export type CheckInResult =
  | { ok: true; status: "present" | "late"; at: Date; already?: boolean }
  | { ok: false; error: string; managerMarked?: boolean };

export async function checkIn(
  rehearsalId: string,
  code: string,
  method: "code" | "qr",
): Promise<CheckInResult> {
  const user = await assertUser();
  if (!user) return { ok: false, error: "Oturumun kapanmış. Tekrar giriş yap." };
  if (!idSchema.safeParse(rehearsalId).success) return { ok: false, error: NOT_FOUND };
  if (!/^\d{4}$/.test(code)) return { ok: false, error: "Kod 4 haneli olmalı." };
  if (method !== "code" && method !== "qr") return { ok: false, error: NOT_FOUND };

  const r = await getRehearsal(rehearsalId);
  if (!r || r.cancelledAt) return { ok: false, error: NOT_FOUND };
  if (!r.openedAt) return { ok: false, error: "Yoklama henüz açılmadı." };
  if (r.closedAt)
    return { ok: false, error: "Yoklama kapandı. Geldiysen yoklamayı alan kişiye söyle." };

  const existing = await currentMark(rehearsalId, user.id);
  if (existing && (existing.status === "present" || existing.status === "late")) {
    return { ok: true, status: existing.status, at: existing.recordedAt, already: true };
  }
  if (existing && existing.method !== "self") {
    return {
      ok: false,
      managerMarked: true,
      error: "Yoklamayı alan kişi seni zaten işaretledi.",
    };
  }

  const perRehearsal = await consumeAttempt(
    `checkin:${rehearsalId}:${user.id}`,
    CHECKIN_MAX_WRONG,
    CHECKIN_WINDOW_MS,
  );
  const perDay = await consumeAttempt(
    `checkin-day:${user.id}`,
    CHECKIN_MAX_WRONG_PER_DAY,
    24 * 3600_000,
  );
  if (perRehearsal.blocked || perDay.blocked) {
    return {
      ok: false,
      error: "Çok fazla hatalı deneme. Birkaç dakika bekle ya da yoklamayı alan kişiye söyle.",
    };
  }
  if (!(await verifyCode(rehearsalId, code))) {
    return { ok: false, error: "Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir." };
  }
  await forgetAttempt(perRehearsal.attemptId);
  await forgetAttempt(perDay.attemptId);

  const now = new Date();
  const status =
    now.getTime() > r.startsAt.getTime() + LATE_AFTER_MINUTES * 60_000 ? "late" : "present";
  // One guarded statement: never lands after close, and only replaces the member's own excuse.
  await db.run(sql`
    insert into attendance (rehearsal_id, user_id, status, method, note, recorded_by, recorded_at)
    select ${rehearsalId}, ${user.id}, ${status}, ${method}, null, ${user.id}, ${Math.floor(now.getTime() / 1000)}
    from rehearsals
    where id = ${rehearsalId} and opened_at is not null and closed_at is null and cancelled_at is null
    on conflict (rehearsal_id, user_id) do update set
      status = excluded.status, method = excluded.method, note = null,
      recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
    where attendance.method = 'self'
  `);
  const after = await currentMark(rehearsalId, user.id);
  revalidateRehearsal(rehearsalId);
  if (after && (after.status === "present" || after.status === "late")) {
    return { ok: true, status: after.status, at: after.recordedAt };
  }
  if (after)
    return { ok: false, managerMarked: true, error: "Yoklamayı alan kişi seni zaten işaretledi." };
  return { ok: false, error: "Yoklama kapandı. Geldiysen yoklamayı alan kişiye söyle." };
}

async function currentMark(rehearsalId: string, userId: string) {
  const [row] = await db
    .select({
      status: attendance.status,
      method: attendance.method,
      recordedAt: attendance.recordedAt,
    })
    .from(attendance)
    .where(and(eq(attendance.rehearsalId, rehearsalId), eq(attendance.userId, userId)))
    .limit(1);
  return row ?? null;
}

const excuseSchema = z.object({ reason: optionalText(200) });

export async function submitExcuse(
  rehearsalId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  const parsed = excuseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const r = idSchema.safeParse(rehearsalId).success ? await getRehearsal(rehearsalId) : null;
  if (!r || r.cancelledAt) return { error: NOT_FOUND };
  if (r.startsAt <= new Date())
    return { error: "Çalışma başladı; mazeret artık yoklamayı alan kişiye iletilmeli." };
  const me = (await loadRosterUsers()).find((u) => u.id === user.id);
  if (!me || !isExpected(me, r)) return { error: "Bu çalışma senin partisyonun için değil." };
  const existing = await currentMark(rehearsalId, user.id);
  if (existing && existing.method !== "self")
    return { error: "Yoklamayı alan kişi seni zaten işaretledi." };

  await db
    .insert(attendance)
    .values({
      rehearsalId,
      userId: user.id,
      status: "excused",
      method: "self",
      note: parsed.data.reason,
      recordedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [attendance.rehearsalId, attendance.userId],
      set: { note: parsed.data.reason, recordedAt: new Date() },
      setWhere: eq(attendance.method, "self"),
    });
  revalidateRehearsal(rehearsalId);
  return { success: "Mazeretin iletildi." };
}

export async function withdrawExcuse(rehearsalId: string): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  if (!idSchema.safeParse(rehearsalId).success) return { error: NOT_FOUND };
  const deleted = await db
    .delete(attendance)
    .where(
      and(
        eq(attendance.rehearsalId, rehearsalId),
        eq(attendance.userId, user.id),
        eq(attendance.method, "self"),
        sql`exists (select 1 from rehearsals r where r.id = ${rehearsalId} and r.starts_at > unixepoch())`,
      ),
    )
    .returning({ userId: attendance.userId });
  revalidateRehearsal(rehearsalId);
  return deleted.length
    ? { success: "Mazeretin geri alındı." }
    : { error: "Mazeret geri alınamadı; yoklamayı alan kişiye yaz." };
}

export async function createTerm(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = termSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const existing = await db
    .select({ name: terms.name, startsOn: terms.startsOn, endsOn: terms.endsOn })
    .from(terms);
  const conflict = termConflict(existing, d);
  if (conflict?.field === "dates") return { values: formValues(formData), error: conflict.message };
  if (conflict) return { values: formValues(formData), fieldErrors: { name: [conflict.message] } };
  try {
    await db.insert(terms).values(d);
  } catch {
    return { values: formValues(formData), fieldErrors: { name: [TERM_NAME_TAKEN] } };
  }
  revalidatePath("/raporlar");
  return { success: `${d.name} eklendi.` };
}
