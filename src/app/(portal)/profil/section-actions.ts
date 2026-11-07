"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { assertUser } from "@/lib/auth/dal";
import type { FormState } from "@/lib/validation";

const sectionSchema = z.union([z.literal(1), z.literal(2), z.null()]);

/** The signed-in singer's own sub-part; ignored without a voice part. */
export async function setMySection(section: unknown): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: "Oturumun kapanmış. Tekrar giriş yap." };
  const parsed = sectionSchema.safeParse(section);
  if (!parsed.success) return { error: "Geçersiz seçim." };
  const updated = await db
    .update(users)
    .set({ voiceSection: parsed.data })
    .where(and(eq(users.id, user.id), isNotNull(users.voicePart)))
    .returning({ id: users.id });
  if (updated.length === 0) return { error: "Önce yönetimin partisyonunu girmesi gerekiyor." };
  revalidatePath("/", "layout");
  return { success: "Alt partisyonun kaydedildi." };
}
