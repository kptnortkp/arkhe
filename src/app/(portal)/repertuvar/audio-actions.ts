"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pieceAudio } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { assertManager } from "@/lib/auth/dal";
import { drainKeys } from "@/lib/storage/ledger";
import { MSG } from "@/lib/storage/messages";
import type { FormState } from "@/lib/validation";

/** The row goes now; the 0018 trigger queues the file, deleted inline when possible. */
export async function deleteAudio(audioId: string): Promise<FormState> {
  if (!(await assertManager())) return { error: MSG.forbidden };
  if (!z.uuid().safeParse(audioId).success) return { error: MSG.fileNotFound };
  const deleted = await writeTx((tx) =>
    tx
      .delete(pieceAudio)
      .where(eq(pieceAudio.id, audioId))
      .returning({ key: pieceAudio.storageKey, pieceId: pieceAudio.pieceId }),
  );
  if (deleted.length === 0) return { error: MSG.fileNotFound };
  await drainKeys(deleted.map((d) => d.key));
  revalidatePath(`/repertuvar/${deleted[0].pieceId}`);
  revalidatePath(`/repertuvar/${deleted[0].pieceId}/duzenle`);
  return { success: MSG.audioDeleted };
}

const sectionSchema = z.union([z.literal(1), z.literal(2), z.null()]);

/** Sub-part of a part file (Bas 1 / Bas 2 / whole part). A Tutti file never takes one. */
export async function setAudioSection(audioId: string, section: unknown): Promise<FormState> {
  if (!(await assertManager())) return { error: MSG.forbidden };
  const value = sectionSchema.safeParse(section);
  if (!z.uuid().safeParse(audioId).success || !value.success) return { error: MSG.fileNotFound };
  const updated = await writeTx((tx) =>
    tx
      .update(pieceAudio)
      .set({ section: value.data })
      .where(and(eq(pieceAudio.id, audioId), isNotNull(pieceAudio.voicePart)))
      .returning({ pieceId: pieceAudio.pieceId }),
  );
  if (updated.length === 0) return { error: MSG.fileNotFound };
  revalidatePath(`/repertuvar/${updated[0].pieceId}`);
  revalidatePath(`/repertuvar/${updated[0].pieceId}/duzenle`);
  return { success: "Alt partisyon kaydedildi." };
}
