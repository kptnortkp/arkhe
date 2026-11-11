"use server";

import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { pieces, practiceNotes, VOICE_PARTS } from "@/db/schema";
import { getRehearsal } from "@/lib/attendance/rehearsals";
import { NOTE_BODY_MAX, noteTargets } from "@/lib/attendance/practice-notes";
import { assertUser } from "@/lib/auth/dal";
import { practiceNoteAdded } from "@/lib/push/triggers";
import type { FormState } from "@/lib/validation";

const FORBIDDEN = "Çalışma notu yazma yetkin yok.";
const NOTES_PER_HOUR = 20;

const noteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Notu yaz.")
    .max(NOTE_BODY_MAX, `En fazla ${NOTE_BODY_MAX} karakter.`),
  pieceId: z.union([z.literal(""), z.uuid()]).transform((v) => v || null),
  voicePart: z.union([z.literal(""), z.enum(VOICE_PARTS)]).transform((v) => v || null),
  notify: z.literal("on").optional(),
});

function revalidateNote(rehearsalId: string, pieceId: string | null) {
  revalidatePath("/");
  revalidatePath(`/calismalar/${rehearsalId}`);
  if (pieceId) revalidatePath(`/repertuvar/${pieceId}`);
}

/** A manager or listening assistant writes "what to practise" on a rehearsal. */
export async function addPracticeNote(
  rehearsalId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  const targets = await noteTargets(user);
  if (targets.length === 0) return { error: FORBIDDEN };
  const parsed = noteSchema.safeParse({
    body: formData.get("body") ?? "",
    pieceId: formData.get("pieceId") ?? "",
    voicePart: formData.get("voicePart") ?? "",
    notify: formData.get("notify") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Not kaydedilemedi." };
  }
  const { body, pieceId, voicePart, notify } = parsed.data;
  if (!targets.includes(voicePart)) return { error: "Bu partisyona not yazamazsın." };
  if (!z.uuid().safeParse(rehearsalId).success) return { error: "Bu çalışma bulunamadı." };

  const [rehearsal, [piece], [recent]] = await Promise.all([
    getRehearsal(rehearsalId),
    pieceId
      ? db
          .select({ id: pieces.id, title: pieces.title })
          .from(pieces)
          .where(and(eq(pieces.id, pieceId), ne(pieces.status, "archive")))
          .limit(1)
      : [null],
    db
      .select({ n: count() })
      .from(practiceNotes)
      .where(
        and(
          eq(practiceNotes.authorId, user.id),
          gt(practiceNotes.createdAt, new Date(Date.now() - 3600_000)),
        ),
      ),
  ]);
  if (!rehearsal || rehearsal.cancelledAt) return { error: "Bu çalışma bulunamadı." };
  if (recent.n >= NOTES_PER_HOUR)
    return { error: "Bir saatte çok fazla not yazıldı; biraz sonra dene." };
  if (voicePart && rehearsal.type === "sectional" && !rehearsal.parts.includes(voicePart))
    return { error: "Bu çalışma o partisyon için değil." };
  if (pieceId && !piece) return { error: "Bu eser bulunamadı." };

  const [note] = await db
    .insert(practiceNotes)
    .values({ rehearsalId, pieceId, voicePart, body, authorId: user.id })
    .returning({ id: practiceNotes.id });
  if (notify) {
    await practiceNoteAdded(
      { id: note.id, voicePart, body },
      rehearsal,
      piece?.title ?? null,
      user.id,
    );
  }
  revalidateNote(rehearsalId, pieceId);
  return { success: notify ? "Not eklendi ve bildirildi." : "Not eklendi." };
}

/** The author, or the conductor, removes a note. */
export async function deletePracticeNote(id: string): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { error: "Not bulunamadı." };
  const owner = user.role === "conductor" ? sql`1 = 1` : eq(practiceNotes.authorId, user.id);
  const [gone] = await db
    .delete(practiceNotes)
    .where(and(eq(practiceNotes.id, id), owner))
    .returning({ rehearsalId: practiceNotes.rehearsalId, pieceId: practiceNotes.pieceId });
  if (!gone) return { error: "Not silinemedi." };
  revalidateNote(gone.rehearsalId, gone.pieceId);
  return { success: "Not silindi." };
}
