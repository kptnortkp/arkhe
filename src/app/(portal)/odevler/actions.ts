"use server";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  appSettings,
  assignmentParts,
  assignments,
  pieces,
  submissions,
  VOICE_PARTS,
} from "@/db/schema";
import { assertManager, assertUser } from "@/lib/auth/dal";
import { isEligible } from "@/lib/homework/eligibility";
import { RECORDING_EMAIL_RE } from "@/lib/homework/mail";
import { loadViewer } from "@/lib/homework/queries";
import { istanbulDateOf, istanbulToUtc, now } from "@/lib/time";
import { fieldErrorsOf, formValues, optionalText, type FormState } from "@/lib/validation";

const FORBIDDEN = "Bu işlem için yetkin yok.";
const NOT_FOUND = "Ödev bulunamadı.";
const STALE = "Ödev bu arada değişti. Sayfayı yenileyip tekrar dene.";
const FEEDBACK_LOCK = "Şef geri bildirim yazdı; teslimi geri alamazsın.";
const NOT_RESPONSIBLE = "Bu kişi bu ödevden sorumlu değil.";

const idSchema = z.uuid();

// The tab badge lives in the portal layout, so every write refreshes the whole tree.
function revalidateHomework() {
  revalidatePath("/", "layout");
}

const bar = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!/^\d{1,4}$/.test(v) || n < 1) {
      ctx.addIssue({ code: "custom", message: "Ölçü 1 ile 9999 arasında bir sayı olmalı." });
      return z.NEVER;
    }
    return n;
  });

const assignmentSchema = z
  .object({
    pieceId: z.uuid("Bir eser seç."),
    barFrom: bar,
    barTo: bar,
    parts: z
      .array(z.enum(VOICE_PARTS))
      .transform((a) => [...new Set(a)])
      .pipe(z.array(z.enum(VOICE_PARTS)).min(1, "En az bir partisyon seç.")),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih ve saat gir."),
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Tarih ve saat gir."),
    description: optionalText(1000).transform((v) => v?.replace(/\r\n?/g, "\n") ?? null),
  })
  .superRefine((d, ctx) => {
    if ((d.barFrom === null) !== (d.barTo === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["bars"],
        message: "Ölçüleri başlangıç ve bitiş olarak gir (ör. 12–34).",
      });
    } else if (d.barFrom !== null && d.barTo !== null && d.barTo < d.barFrom) {
      ctx.addIssue({
        code: "custom",
        path: ["bars"],
        message: "Bitiş ölçüsü başlangıçtan küçük olamaz.",
      });
    }
    const due = istanbulToUtc(d.dueDate, d.dueTime);
    if (Number.isNaN(due.getTime()) || istanbulDateOf(due) !== d.dueDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Tarih ve saat gir." });
    } else if (due.getTime() > now().getTime() + 2 * 365 * 24 * 3_600_000) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Son tarih çok ileride." });
    }
  });

function parseAssignment(formData: FormData) {
  return assignmentSchema.safeParse({
    ...Object.fromEntries(formData),
    parts: formData.getAll("parts"),
  });
}

async function pieceCheck(pieceId: string, currentPieceId?: string) {
  const [piece] = await db
    .select({ status: pieces.status })
    .from(pieces)
    .where(eq(pieces.id, pieceId));
  if (!piece) return "Bir eser seç.";
  if (piece.status === "archive" && pieceId !== currentPieceId) {
    return "Arşivdeki esere ödev verilemez.";
  }
  return null;
}

/** The id comes from the form (one per mount), so a double submit can't create two rows. */
export async function createAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: STALE };
  const parsed = parseAssignment(formData);
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  const dueAt = istanbulToUtc(d.dueDate, d.dueTime);
  if (dueAt <= now()) {
    return {
      values: formValues(formData),
      fieldErrors: { dueDate: ["Son tarih geçmişte olamaz."] },
    };
  }
  const pieceError = await pieceCheck(d.pieceId);
  if (pieceError) return { values: formValues(formData), fieldErrors: { pieceId: [pieceError] } };

  const at = now();
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(assignments)
      .values({
        id: id.data,
        pieceId: d.pieceId,
        barFrom: d.barFrom,
        barTo: d.barTo,
        description: d.description,
        dueAt,
        createdBy: actor.id,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: assignments.id });
    if (rows.length === 0) {
      const [existing] = await tx
        .select({ createdBy: assignments.createdBy })
        .from(assignments)
        .where(eq(assignments.id, id.data));
      return existing?.createdBy === actor.id;
    }
    await tx
      .insert(assignmentParts)
      .values(d.parts.map((voicePart) => ({ assignmentId: id.data, voicePart })));
    return true;
  });
  if (!inserted) return { error: STALE };
  revalidateHomework();
  return { success: "Ödev verildi.", values: { id: id.data } };
}

export async function updateAssignment(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const version = Number(formData.get("version"));
  const parsed = parseAssignment(formData);
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;

  const [current] = await db
    .select({ pieceId: assignments.pieceId })
    .from(assignments)
    .where(eq(assignments.id, id));
  if (!current) return { error: NOT_FOUND };
  const pieceError = await pieceCheck(d.pieceId, current.pieceId);
  if (pieceError) return { values: formValues(formData), fieldErrors: { pieceId: [pieceError] } };

  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(assignments)
      .set({
        pieceId: d.pieceId,
        barFrom: d.barFrom,
        barTo: d.barTo,
        description: d.description,
        dueAt: istanbulToUtc(d.dueDate, d.dueTime),
      })
      .where(
        and(eq(assignments.id, id), sql`${assignments.updatedAt} = ${Math.floor(version / 1000)}`),
      )
      .returning({ id: assignments.id });
    if (updated.length === 0) return STALE;
    await tx.delete(assignmentParts).where(eq(assignmentParts.assignmentId, id));
    await tx
      .insert(assignmentParts)
      .values(d.parts.map((voicePart) => ({ assignmentId: id, voicePart })));
    return null;
  });
  if (result) return { error: result, values: formValues(formData) };
  revalidateHomework();
  return { success: "Kaydedildi.", values: { id } };
}

export async function deleteAssignment(id: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(submissions).where(eq(submissions.assignmentId, id));
    await tx.delete(assignmentParts).where(eq(assignmentParts.assignmentId, id));
    return tx.delete(assignments).where(eq(assignments.id, id)).returning({ id: assignments.id });
  });
  if (deleted.length === 0) return { error: NOT_FOUND };
  revalidateHomework();
  return { success: "Ödev silindi." };
}

async function partsOfAssignment(id: string) {
  const rows = await db
    .select({ part: assignmentParts.voicePart })
    .from(assignmentParts)
    .where(eq(assignmentParts.assignmentId, id));
  return rows.map((r) => r.part);
}

/** The singer always comes from the session: there is no userId to tamper with. */
export async function submitAssignment(id: string): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const parts = await partsOfAssignment(id);
  if (parts.length === 0) return { error: NOT_FOUND };
  const viewer = await loadViewer(actor.id);
  if (!viewer || !isEligible(viewer, parts)) return { error: FORBIDDEN };
  await db
    .insert(submissions)
    .values({ assignmentId: id, userId: actor.id, submittedAt: now(), method: "self" })
    .onConflictDoUpdate({
      target: [submissions.assignmentId, submissions.userId],
      set: { submittedAt: now(), method: "self", markedBy: null },
      setWhere: isNull(submissions.submittedAt),
    });
  revalidateHomework();
  return { success: "Teslim edildi." };
}

export async function undoSubmission(id: string): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const deleted = await db
    .delete(submissions)
    .where(
      and(
        eq(submissions.assignmentId, id),
        eq(submissions.userId, actor.id),
        isNull(submissions.feedback),
        isNotNull(submissions.submittedAt),
      ),
    )
    .returning({ id: submissions.userId });
  if (deleted.length === 0) {
    const [row] = await db
      .select({ feedback: submissions.feedback, submittedAt: submissions.submittedAt })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, id), eq(submissions.userId, actor.id)));
    if (row?.feedback && row.submittedAt) return { error: FEEDBACK_LOCK };
  }
  revalidateHomework();
  return { success: "Teslim geri alındı." };
}

/** Feedback may stay on a former singer's row; marking a submission needs current eligibility. */
async function targetAllowed(assignmentId: string, userId: string, requireEligible = false) {
  const parts = await partsOfAssignment(assignmentId);
  if (parts.length === 0) return NOT_FOUND;
  const target = await loadViewer(userId);
  if (!target) return NOT_RESPONSIBLE;
  if (isEligible(target, parts)) return null;
  if (requireEligible) return NOT_RESPONSIBLE;
  const [row] = await db
    .select({ u: submissions.userId })
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.userId, userId)));
  return row ? null : NOT_RESPONSIBLE;
}

export async function setSubmissionFor(
  assignmentId: string,
  userId: string,
  submitted: boolean,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(assignmentId).success || !idSchema.safeParse(userId).success) {
    return { error: NOT_FOUND };
  }
  const where = and(eq(submissions.assignmentId, assignmentId), eq(submissions.userId, userId));
  if (submitted) {
    const error = await targetAllowed(assignmentId, userId, true);
    if (error) return { error };
    await db
      .insert(submissions)
      .values({ assignmentId, userId, submittedAt: now(), method: "manual", markedBy: actor.id })
      .onConflictDoUpdate({
        target: [submissions.assignmentId, submissions.userId],
        set: { submittedAt: now(), method: "manual", markedBy: actor.id },
        setWhere: isNull(submissions.submittedAt),
      });
  } else {
    await db.batch([
      db
        .update(submissions)
        .set({ submittedAt: null, method: null, markedBy: null })
        .where(and(where, isNotNull(submissions.feedback))),
      db.delete(submissions).where(and(where, isNull(submissions.feedback))),
    ]);
  }
  revalidateHomework();
  return { success: submitted ? "Teslim işaretlendi." : "Teslim kaldırıldı." };
}

export async function saveFeedback(
  assignmentId: string,
  userId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(assignmentId).success || !idSchema.safeParse(userId).success) {
    return { error: NOT_FOUND };
  }
  const parsed = z
    .object({ feedback: optionalText(1000) })
    .safeParse({ feedback: formData.get("feedback") ?? "" });
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const feedback = parsed.data.feedback?.replace(/\r\n?/g, "\n") ?? null;
  const error = await targetAllowed(assignmentId, userId);
  if (error) return { error };
  const where = and(eq(submissions.assignmentId, assignmentId), eq(submissions.userId, userId));

  if (feedback) {
    const [current] = await db
      .select({ feedback: submissions.feedback })
      .from(submissions)
      .where(where);
    // Re-saving the same text must not bring back the "Yeni not" dot.
    if (current?.feedback !== feedback) {
      await db
        .insert(submissions)
        .values({ assignmentId, userId, feedback, feedbackBy: actor.id, feedbackAt: now() })
        .onConflictDoUpdate({
          target: [submissions.assignmentId, submissions.userId],
          set: { feedback, feedbackBy: actor.id, feedbackAt: now(), feedbackSeenAt: null },
        });
    }
    revalidateHomework();
    return { success: "Not kaydedildi." };
  }
  await db.batch([
    db
      .update(submissions)
      .set({ feedback: null, feedbackBy: null, feedbackAt: null, feedbackSeenAt: null })
      .where(and(where, isNotNull(submissions.submittedAt))),
    db.delete(submissions).where(and(where, isNull(submissions.submittedAt))),
  ]);
  revalidateHomework();
  return { success: "Not silindi." };
}

/** Called from the client once the note is on screen; a prefetch never marks a note read. */
export async function markFeedbackSeen(id: string): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return {};
  await db
    .update(submissions)
    .set({ feedbackSeenAt: now() })
    .where(
      and(
        eq(submissions.assignmentId, id),
        eq(submissions.userId, actor.id),
        isNotNull(submissions.feedback),
        sql`(${submissions.feedbackSeenAt} is null or ${submissions.feedbackSeenAt} < ${submissions.feedbackAt})`,
      ),
    );
  revalidateHomework();
  return {};
}

export async function setRecordingEmail(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = z
    .object({
      email: z
        .string()
        .trim()
        .toLowerCase()
        .max(254, "Geçerli bir e-posta adresi gir.")
        .refine((v) => v === "" || RECORDING_EMAIL_RE.test(v), "Geçerli bir e-posta adresi gir."),
    })
    .safeParse({ email: formData.get("email") ?? "" });
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const email = parsed.data.email;
  if (!email) {
    await db.delete(appSettings).where(eq(appSettings.key, "recording_email"));
    revalidateHomework();
    return { success: "Kayıt e-postası kaldırıldı." };
  }
  await db
    .insert(appSettings)
    .values({ key: "recording_email", value: email, updatedAt: now(), updatedBy: actor.id })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: email, updatedAt: now(), updatedBy: actor.id },
    });
  revalidateHomework();
  return { success: "Kayıt e-postası güncellendi.", values: { email } };
}
