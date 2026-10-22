import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { VOICE_PARTS, type VoicePart } from "@/db/schema";
import { collator } from "@/lib/format";

/**
 * The parts a user reviews as a listening assistant; [] when not appointed, inactive, or no longer
 * a member/board user (the appointment is then ignored, not deleted: D9).
 */
export const loadScope = cache(async (userId: string): Promise<VoicePart[]> => {
  const rows = await db.all<{ p: VoicePart }>(sql`
    select la.voice_part as p from listening_assistants la join users a on a.id = la.user_id
    where la.user_id = ${userId} and a.is_active = 1 and a.role in ('member', 'board')`);
  return VOICE_PARTS.filter((p) => rows.some((r) => r.p === p));
});

/** D11 transparency: names of the effective assistants who can hear this singer. Names only. */
export async function listenersFor(singer: { id: string; voicePart: VoicePart | null }) {
  if (!singer.voicePart) return [];
  const rows = await db.all<{ name: string }>(sql`
    select a.name as name from listening_assistants la join users a on a.id = la.user_id
    where la.voice_part = ${singer.voicePart} and la.user_id <> ${singer.id}
      and a.is_active = 1 and a.role in ('member', 'board')`);
  return rows.map((r) => r.name).sort(collator.compare);
}
