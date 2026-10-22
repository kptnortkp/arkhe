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
import { writeTx } from "@/db/write-tx";
import { assertManager, assertUser } from "@/lib/auth/dal";
import { isEligible } from "@/lib/homework/eligibility";
import { RECORDING_EMAIL_RE } from "@/lib/homework/mail";
import { loadViewer } from "@/lib/homework/queries";
import { withdrawTake } from "@/lib/homework/withdraw";
import { canWriteFeedback } from "@/lib/review/access";
import { errorTag } from "@/lib/review/log";
import { drainKeys } from "@/lib/storage/ledger";
import { COMMENTED_KEEP_DAYS, UNCOMMENTED_KEEP_DAYS } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { addDays, istanbulDateOf, istanbulToUtc, now } from "@/lib/time";
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
  const { deleted, keys } = await writeTx(async (tx) => {
    // Recordings and assistant notes cascade; the 0010 triggers queue every live audio key.
    const live = await tx.all<{ k: string }>(
      sql`select storage_key as k from recordings where assignment_id = ${id} and audio_deleted_at is null`,
    );
    await tx.delete(submissions).where(eq(submissions.assignmentId, id));
    await tx.delete(assignmentParts).where(eq(assignmentParts.assignmentId, id));
    const deleted = await tx
      .delete(assignments)
      .where(eq(assignments.id, id))
      .returning({ id: assignments.id });
    return { deleted, keys: live.map((r) => r.k) };
  });
  if (deleted.length === 0) return { error: NOT_FOUND };
  await drainKeys(keys);
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

/** Fallback `Geri al`; with a take in the slot it is the same as the recorder's `Sil` (D47). */
export async function undoSubmission(id: string): Promise<FormState> {
  const actor = await assertUser();
  if (!actor) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const result = await withdrawTake(id, actor.id, { requireTake: false });
  // Phase 4's copy for this button; the recorder's own `Sil` says the D8 sentence.
  if (result.error) return { error: FEEDBACK_LOCK };
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
    const refused = await writeTx(async (tx) => {
      const [take] = await tx.all<{ id: string; gone: number }>(sql`
        select id, audio_deleted_at is not null as gone from recordings
        where assignment_id = ${assignmentId} and user_id = ${userId} and replaced_at is null`);
      // D47: the singer's audio isn't the manager's to discard by unmarking.
      if (take && !take.gone) return true;
      if (take) {
        await tx.run(sql`
          update recordings set replaced_at = ${Math.floor(now().getTime() / 1000)}, commented_at = null
          where id = ${take.id}`);
      }
      await tx
        .update(submissions)
        .set({ submittedAt: null, method: null, markedBy: null })
        .where(and(where, isNotNull(submissions.feedback)));
      await tx.delete(submissions).where(and(where, isNull(submissions.feedback)));
      return false;
    });
    if (refused) return { error: MSG.unmarkRefused };
  }
  revalidateHomework();
  return { success: submitted ? "Teslim işaretlendi." : "Teslim kaldırıldı." };
}

const recordingIdField = z.union([z.literal(""), z.uuid()]);

/**
 * The conductor's comment is submissions.feedback (D2), conductor-only (D3). The form carries the
 * take that was on screen; if the singer replaced it meanwhile nothing is written (D49). The first
 * comment sets the take's commented_at and deletion day; deleting the comment clears them (D54).
 */
export async function saveFeedback(
  assignmentId: string,
  userId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  if (!canWriteFeedback(actor.role)) return { error: MSG.feedbackConductorOnly };
  if (!idSchema.safeParse(assignmentId).success || !idSchema.safeParse(userId).success) {
    return { error: NOT_FOUND };
  }
  const parsed = z
    .object({ feedback: optionalText(1000), recordingId: recordingIdField })
    .safeParse({
      feedback: formData.get("feedback") ?? "",
      recordingId: formData.get("recordingId") ?? "",
    });
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const feedback = parsed.data.feedback?.replace(/\r\n?/g, "\n") ?? null;
  const onScreen = parsed.data.recordingId || null;
  const error = await targetAllowed(assignmentId, userId);
  if (error) return { error };
  const where = and(eq(submissions.assignmentId, assignmentId), eq(submissions.userId, userId));

  let outcome: "stale" | "updated" | "sent" | "deleted";
  try {
    outcome = await writeFeedback(actor.id);
  } catch (error) {
    // Name and code only: drizzle's error repeats the params, the comment text among them.
    console.error("feedback save failed", errorTag(error));
    return { error: MSG.generic, values: formValues(formData) };
  }
  function writeFeedback(actorId: string) {
    return writeTx(async (tx) => {
      const at = now();
      const [take] = await tx.all<{ id: string; uploaded_at: number }>(sql`
      select id, uploaded_at from recordings
      where assignment_id = ${assignmentId} and user_id = ${userId} and replaced_at is null`);
      if ((take?.id ?? null) !== onScreen) return "stale" as const;
      const [current] = await tx
        .select({ feedback: submissions.feedback })
        .from(submissions)
        .where(where);
      const before = current?.feedback ?? null;
      if (feedback) {
        // Re-saving the same text must not bring back the "Yeni not" dot.
        if (before === feedback) return "updated" as const;
        await tx
          .insert(submissions)
          .values({ assignmentId, userId, feedback, feedbackBy: actorId, feedbackAt: at })
          .onConflictDoUpdate({
            target: [submissions.assignmentId, submissions.userId],
            set: { feedback, feedbackBy: actorId, feedbackAt: at, feedbackSeenAt: null },
          });
        if (before === null && take) {
          await tx.run(sql`
          update recordings set commented_at = ${Math.floor(at.getTime() / 1000)},
            delete_on = ${addDays(istanbulDateOf(at), COMMENTED_KEEP_DAYS)}
          where id = ${take.id} and commented_at is null`);
        }
        return before === null ? ("sent" as const) : ("updated" as const);
      }
      await tx
        .update(submissions)
        .set({ feedback: null, feedbackBy: null, feedbackAt: null, feedbackSeenAt: null })
        .where(and(where, isNotNull(submissions.submittedAt)));
      await tx.delete(submissions).where(and(where, isNull(submissions.submittedAt)));
      if (take) {
        // TL1 (D54 amended): back to upload day + 120, but never before tomorrow, so deleting a
        // comment to rewrite it can't lose the audio to the next morning's sweep.
        const uploadDay = istanbulDateOf(new Date(Number(take.uploaded_at) * 1000));
        const byUpload = addDays(uploadDay, UNCOMMENTED_KEEP_DAYS);
        const tomorrow = addDays(istanbulDateOf(at), 1);
        await tx.run(sql`
        update recordings set commented_at = null,
          delete_on = ${byUpload > tomorrow ? byUpload : tomorrow}
        where id = ${take.id}`);
      }
      return "deleted" as const;
    });
  }
  if (outcome === "stale") return { error: MSG.staleForComment, values: formValues(formData) };
  revalidateHomework();
  if (outcome === "deleted") return { success: MSG.commentDeleted };
  return { success: outcome === "sent" ? MSG.commentSent : MSG.commentUpdated };
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
