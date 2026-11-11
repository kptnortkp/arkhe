import "server-only";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  pieceReadiness,
  users,
  VOICE_PARTS,
  type ReadinessLevel,
  type Role,
  type VoicePart,
} from "@/db/schema";
import { collator } from "@/lib/format";

/** Who answers "how ready am I": active singers with a part; the conductor doesn't sing. */
export function canMarkReadiness(user: { role: Role; voicePart: VoicePart | null }) {
  return user.role !== "conductor" && user.voicePart !== null;
}

export async function myReadiness(userId: string, pieceIds: string[]) {
  if (pieceIds.length === 0) return new Map<string, ReadinessLevel>();
  const rows = await db
    .select({ pieceId: pieceReadiness.pieceId, level: pieceReadiness.level })
    .from(pieceReadiness)
    .where(and(eq(pieceReadiness.userId, userId), inArray(pieceReadiness.pieceId, pieceIds)));
  return new Map(rows.map((r) => [r.pieceId, r.level]));
}

export type PartReadiness = {
  part: VoicePart;
  singers: number;
  counts: Record<ReadinessLevel, number>;
  people: { name: string; level: ReadinessLevel | null }[];
};

/** Per piece, per part: how many of today's singers answered what. Managers only. */
export async function readinessByPart(pieceIds: string[]) {
  const result = new Map<string, PartReadiness[]>();
  if (pieceIds.length === 0) return result;
  const [singers, rows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, voicePart: users.voicePart })
      .from(users)
      .where(and(eq(users.isActive, true), isNull(users.leftAt), ne(users.role, "conductor"))),
    db
      .select({
        pieceId: pieceReadiness.pieceId,
        userId: pieceReadiness.userId,
        level: pieceReadiness.level,
      })
      .from(pieceReadiness)
      .where(inArray(pieceReadiness.pieceId, pieceIds)),
  ]);
  const levels = new Map(rows.map((r) => [`${r.pieceId}:${r.userId}`, r.level]));
  const sorted = singers.sort((a, b) => collator.compare(a.name, b.name));
  for (const pieceId of pieceIds) {
    result.set(
      pieceId,
      VOICE_PARTS.map((part) => {
        const people = sorted
          .filter((s) => s.voicePart === part)
          .map((s) => ({ name: s.name, level: levels.get(`${pieceId}:${s.id}`) ?? null }));
        const counts = { ready: 0, partial: 0, not_ready: 0 };
        for (const p of people) if (p.level) counts[p.level]++;
        return { part, singers: people.length, counts, people };
      }).filter((p) => p.singers > 0),
    );
  }
  return result;
}
