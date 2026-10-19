import "server-only";
import { and, asc, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, rehearsals, type AttendanceStatus, type VoicePart } from "@/db/schema";
import { WARN_ABSENT, WARN_BELOW_PERCENT, WARN_MIN_COUNTED, WARN_OF_LAST } from "./rules";
import { loadRosterUsers } from "./roster";

export type MemberStats = {
  userId: string;
  name: string;
  voicePart: VoicePart | null;
  attended: number; // present + late
  expected: number; // counted rehearsals minus excused ones: the denominator
  percent: number | null;
  late: number;
  excused: number;
  absent: number;
  warning: boolean;
  /** Newest first: what happened at each counted rehearsal. */
  history: { rehearsalId: string; startsAt: Date; status: AttendanceStatus }[];
};

/**
 * One pass over counted rehearsals (closed, not cancelled) in [from, to).
 * Unmarked people never appear here because closing fills them in as absent.
 */
export async function attendanceStats({
  from,
  to,
  userId,
}: {
  from: Date;
  to: Date;
  userId?: string;
}) {
  const counted = await db
    .select({ id: rehearsals.id, startsAt: rehearsals.startsAt })
    .from(rehearsals)
    .where(
      and(
        isNull(rehearsals.cancelledAt),
        isNotNull(rehearsals.closedAt),
        gte(rehearsals.startsAt, from),
        lt(rehearsals.startsAt, to),
      ),
    )
    .orderBy(asc(rehearsals.startsAt));
  const ids = counted.map((r) => r.id);
  const [people, marks] = await Promise.all([
    loadRosterUsers(),
    ids.length
      ? db
          .select({
            rehearsalId: attendance.rehearsalId,
            userId: attendance.userId,
            status: attendance.status,
          })
          .from(attendance)
          .where(inArray(attendance.rehearsalId, ids))
      : Promise.resolve([]),
  ]);
  const mark = new Map(marks.map((m) => [`${m.rehearsalId}|${m.userId}`, m.status]));

  const result: MemberStats[] = [];
  for (const person of people) {
    if (userId && person.id !== userId) continue;
    if (person.role === "conductor") continue;
    const history: MemberStats["history"] = [];
    // Closing wrote a row for everyone expected at the time, so the rows are the record;
    // later part or role changes must not rewrite past percentages.
    for (const r of counted) {
      const status = mark.get(`${r.id}|${person.id}`);
      if (status) history.push({ rehearsalId: r.id, startsAt: r.startsAt, status });
    }
    // Former members with nothing in this period would only add noise.
    if (history.length === 0 && person.leftAt) continue;
    history.reverse();
    const late = history.filter((h) => h.status === "late").length;
    const attended = history.filter((h) => h.status === "present").length + late;
    const excused = history.filter((h) => h.status === "excused").length;
    const absent = history.filter((h) => h.status === "absent").length;
    const expected = history.length - excused;
    const percent = expected > 0 ? Math.round((attended / expected) * 100) : null;
    const lastCounted = history.filter((h) => h.status !== "excused").slice(0, WARN_OF_LAST);
    const warning =
      lastCounted.filter((h) => h.status === "absent").length >= WARN_ABSENT ||
      (expected >= WARN_MIN_COUNTED && percent !== null && percent < WARN_BELOW_PERCENT);
    result.push({
      userId: person.id,
      name: person.name,
      voicePart: person.voicePart,
      attended,
      expected,
      percent,
      late,
      excused,
      absent,
      warning,
      history,
    });
  }
  return { rehearsalCount: counted.length, members: result };
}
