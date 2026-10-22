import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { VOICE_PARTS, type Role, type VoicePart } from "@/db/schema";
import { collator } from "@/lib/format";

export type AssistantRow = {
  userId: string;
  name: string;
  role: Role;
  part: VoicePart | null;
  /** The parts in scope; all four = `Tüm partisyonlar`. */
  scope: VoicePart[];
  allParts: boolean;
  /** Ignored (not deleted) while inactive or the conductor (D9). */
  effective: boolean;
  appointedAt: Date;
};

/** `/odevler/asistanlar` (conductor only; the page checks). */
export async function assistantList(): Promise<AssistantRow[]> {
  const rows = await db.all<{
    id: string;
    name: string;
    role: Role;
    part: VoicePart | null;
    active: number;
    parts: string;
    at: number;
  }>(sql`
    select u.id, u.name, u.role, u.voice_part as part, u.is_active as active,
      group_concat(la.voice_part) as parts, min(la.created_at) as at
    from listening_assistants la join users u on u.id = la.user_id
    group by u.id`);
  return rows
    .map((r) => {
      const scope = VOICE_PARTS.filter((p) => r.parts.split(",").includes(p));
      return {
        userId: r.id,
        name: r.name,
        role: r.role,
        part: r.part,
        scope,
        allParts: scope.length === VOICE_PARTS.length,
        effective: Boolean(r.active) && (r.role === "member" || r.role === "board"),
        appointedAt: new Date(Number(r.at) * 1000),
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** The `Asistan ekle` picker: active member/board users who aren't assistants yet. */
export async function assistantCandidates() {
  const rows = await db.all<{ id: string; name: string; part: VoicePart | null; role: Role }>(sql`
    select u.id, u.name, u.voice_part as part, u.role from users u
    where u.is_active = 1 and u.role in ('member', 'board')
      and not exists (select 1 from listening_assistants la where la.user_id = u.id)`);
  return rows.sort((a, b) => collator.compare(a.name, b.name));
}
