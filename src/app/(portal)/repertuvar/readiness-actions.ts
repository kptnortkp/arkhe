"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { pieceReadiness, pieces, READINESS_LEVELS } from "@/db/schema";
import { assertUser } from "@/lib/auth/dal";
import { canMarkReadiness } from "@/lib/repertoire-readiness";
import type { FormState } from "@/lib/validation";

const inputSchema = z.object({
  pieceId: z.uuid(),
  level: z.enum(READINESS_LEVELS).nullable(),
});

/** The signed-in singer's own readiness on a piece; null clears it. */
export async function setReadiness(pieceId: unknown, level: unknown): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: "Oturumun kapanmış. Tekrar giriş yap." };
  if (!canMarkReadiness(user)) return { error: "Partisyonun girilmemiş; yönetime yaz." };
  const parsed = inputSchema.safeParse({ pieceId, level });
  if (!parsed.success) return { error: "Geçersiz seçim." };
  const [piece] = await db
    .select({ status: pieces.status })
    .from(pieces)
    .where(eq(pieces.id, parsed.data.pieceId))
    .limit(1);
  if (!piece || piece.status === "archive") return { error: "Bu eser artık çalışılmıyor." };

  if (parsed.data.level === null) {
    await db
      .delete(pieceReadiness)
      .where(
        and(eq(pieceReadiness.pieceId, parsed.data.pieceId), eq(pieceReadiness.userId, user.id)),
      );
  } else {
    await db
      .insert(pieceReadiness)
      .values({ pieceId: parsed.data.pieceId, userId: user.id, level: parsed.data.level })
      .onConflictDoUpdate({
        target: [pieceReadiness.pieceId, pieceReadiness.userId],
        set: { level: parsed.data.level, updatedAt: new Date() },
      });
  }
  revalidatePath(`/repertuvar/${parsed.data.pieceId}`);
  revalidatePath("/raporlar/hazirlik");
  return { success: "Kaydedildi." };
}
