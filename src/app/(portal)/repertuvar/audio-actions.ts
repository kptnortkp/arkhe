"use server";

import { eq } from "drizzle-orm";
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
