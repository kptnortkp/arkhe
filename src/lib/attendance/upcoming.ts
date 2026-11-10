import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attendance, VOICE_PARTS, type VoicePart } from "@/db/schema";
import { listRehearsals, type Rehearsal } from "./rehearsals";
import { isExpected, loadRosterUsers } from "./roster";
import { collator } from "@/lib/format";

export type UpcomingAbsence = { userId: string; name: string; voicePart: VoicePart | null; note: string | null };

export type UpcomingRehearsal = {
  rehearsal: Rehearsal;
  expected: number;
  /** Expected singers per part, and how many of them said they can't come. */
  parts: { part: VoicePart; expected: number; missing: number }[];
  absences: UpcomingAbsence[];
};

/** Not-yet-closed, not-cancelled rehearsals from `from` on, with the advance excuses (managers only). */
export async function upcomingAbsences(from: Date): Promise<UpcomingRehearsal[]> {
  const list = (await listRehearsals({ from, limit: 500 })).filter(
    (r) => !r.cancelledAt && !r.closedAt,
  );
  if (list.length === 0) return [];
  const [people, rows] = await Promise.all([
    loadRosterUsers(),
    db
      .select({ rehearsalId: attendance.rehearsalId, userId: attendance.userId, note: attendance.note })
      .from(attendance)
      .where(
        and(
          inArray(
            attendance.rehearsalId,
            list.map((r) => r.id),
          ),
          eq(attendance.status, "excused"),
        ),
      ),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  return list.map((rehearsal) => {
    const expectedPeople = people.filter((p) => isExpected(p, rehearsal));
    const expectedIds = new Set(expectedPeople.map((p) => p.id));
    const absences = rows
      .filter((row) => row.rehearsalId === rehearsal.id && expectedIds.has(row.userId))
      .map((row) => {
        const p = byId.get(row.userId)!;
        return { userId: p.id, name: p.name, voicePart: p.voicePart, note: row.note };
      })
      .sort((a, b) => collator.compare(a.name, b.name));
    const parts = VOICE_PARTS.map((part) => ({
      part,
      expected: expectedPeople.filter((p) => p.voicePart === part).length,
      missing: absences.filter((a) => a.voicePart === part).length,
    })).filter((p) => p.expected > 0);
    return { rehearsal, expected: expectedPeople.length, parts, absences };
  });
}
