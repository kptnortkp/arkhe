import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, concertSignups, VOICE_PARTS, type VoicePart } from "@/db/schema";
import { collator } from "@/lib/format";
import { isExpected, loadRosterUsers } from "./roster";
import type { Rehearsal } from "./rehearsals";

export type LineupPart = {
  part: VoicePart;
  yes: string[];
  no: { name: string; note: string | null }[];
  unknown: string[];
};

/** The concert line-up by part: said yes, said no (their advance excuse), not answered yet. */
export async function concertLineup(r: Rehearsal): Promise<LineupPart[]> {
  const [people, signups, marks] = await Promise.all([
    loadRosterUsers(),
    db
      .select({ userId: concertSignups.userId })
      .from(concertSignups)
      .where(eq(concertSignups.rehearsalId, r.id)),
    db
      .select({ userId: attendance.userId, status: attendance.status, note: attendance.note })
      .from(attendance)
      .where(eq(attendance.rehearsalId, r.id)),
  ]);
  const yes = new Set(signups.map((s) => s.userId));
  const absent = new Map(
    marks.filter((m) => m.status === "excused" || m.status === "absent").map((m) => [m.userId, m]),
  );
  const expected = people
    .filter((u) => u.leftAt === null && isExpected(u, r))
    .sort((a, b) => collator.compare(a.name, b.name));
  return VOICE_PARTS.map((part) => {
    const inPart = expected.filter((u) => u.voicePart === part);
    return {
      part,
      yes: inPart.filter((u) => yes.has(u.id) && !absent.has(u.id)).map((u) => u.name),
      no: inPart
        .filter((u) => absent.has(u.id))
        .map((u) => ({ name: u.name, note: absent.get(u.id)!.note })),
      unknown: inPart.filter((u) => !yes.has(u.id) && !absent.has(u.id)).map((u) => u.name),
    };
  }).filter((p) => p.yes.length + p.no.length + p.unknown.length > 0);
}

export async function mySignup(userId: string, rehearsalId: string) {
  const [row] = await db
    .select({ userId: concertSignups.userId })
    .from(concertSignups)
    .where(and(eq(concertSignups.rehearsalId, rehearsalId), eq(concertSignups.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** Upcoming concerts (next 120 days) I'm expected at and haven't answered yet: one query. */
export async function unansweredConcerts(userId: string, from: Date) {
  const rows = await db.all<{
    id: string;
    title: string | null;
    location: string | null;
    starts_at: number;
  }>(sql`
    select r.id, r.title, r.location, r.starts_at from rehearsals r
    join users u on u.id = ${userId}
    where r.type = 'concert' and r.cancelled_at is null
      and r.starts_at >= ${Math.floor(from.getTime() / 1000)}
      and r.starts_at < ${Math.floor(from.getTime() / 1000) + 120 * 86_400}
      and u.role <> 'conductor' and u.is_active = 1 and u.joined_at <= r.starts_at
      and not exists (select 1 from concert_signups s where s.rehearsal_id = r.id and s.user_id = u.id)
      and not exists (select 1 from attendance a where a.rehearsal_id = r.id and a.user_id = u.id)
    order by r.starts_at`);
  return rows.map((r) => ({
    id: r.id,
    type: "concert" as const,
    title: r.title,
    location: r.location,
    startsAt: new Date(r.starts_at * 1000),
    parts: [] as VoicePart[],
  }));
}
