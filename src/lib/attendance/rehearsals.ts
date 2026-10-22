import "server-only";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, rehearsals, type RehearsalType, type VoicePart } from "@/db/schema";
import { REHEARSAL_TYPE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { isExpected, loadRosterUsers, partsByRehearsal } from "./roster";
import { OPEN_BEFORE_MINUTES } from "./rules";
import { istanbulDateOf, istanbulDayRange } from "@/lib/time";

// Never includes secrets; every rehearsal read for pages goes through these columns.
const publicColumns = {
  id: rehearsals.id,
  type: rehearsals.type,
  title: rehearsals.title,
  location: rehearsals.location,
  note: rehearsals.note,
  startsAt: rehearsals.startsAt,
  endsAt: rehearsals.endsAt,
  seriesId: rehearsals.seriesId,
  cancelledAt: rehearsals.cancelledAt,
  openedAt: rehearsals.openedAt,
  closedAt: rehearsals.closedAt,
};

export type Rehearsal = {
  id: string;
  type: RehearsalType;
  title: string | null;
  location: string | null;
  note: string | null;
  startsAt: Date;
  endsAt: Date;
  seriesId: string | null;
  cancelledAt: Date | null;
  openedAt: Date | null;
  closedAt: Date | null;
  parts: VoicePart[];
};

export function rehearsalTitle(r: Pick<Rehearsal, "type" | "title" | "parts">) {
  if (r.title) return r.title;
  if (r.type === "sectional" && r.parts.length) {
    return `${r.parts.map((p) => VOICE_PART_LABELS[p]).join(" + ")} partisyon çalışması`;
  }
  return r.type === "tutti" ? "Koro çalışması" : REHEARSAL_TYPE_LABELS[r.type];
}

/** Attendance can stay open until the end of the start's Istanbul day, or the rehearsal's end if later. */
export function openUntil(r: { startsAt: Date; endsAt: Date }) {
  const [, dayEnd] = istanbulDayRange(istanbulDateOf(r.startsAt));
  return dayEnd > r.endsAt ? dayEnd : r.endsAt;
}

export type RehearsalPhase = "cancelled" | "upcoming" | "openable" | "open" | "closed" | "untaken";

export function phaseOf(r: Rehearsal, now = new Date()): RehearsalPhase {
  if (r.cancelledAt) return "cancelled";
  if (r.closedAt) return "closed";
  if (r.openedAt) return "open";
  if (r.startsAt.getTime() - OPEN_BEFORE_MINUTES * 60_000 <= now.getTime()) {
    return now < openUntil(r) ? "openable" : "untaken";
  }
  return "upcoming";
}

async function withParts(rows: Omit<Rehearsal, "parts">[]): Promise<Rehearsal[]> {
  const parts = await partsByRehearsal(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, parts: parts.get(r.id) ?? [] }));
}

export async function getRehearsal(id: string) {
  const rows = await db
    .select(publicColumns)
    .from(rehearsals)
    .where(eq(rehearsals.id, id))
    .limit(1);
  return rows.length ? (await withParts(rows))[0] : null;
}

export async function listRehearsals({
  from,
  to,
  order = "asc",
  limit = 200,
  offset = 0,
}: {
  from?: Date;
  to?: Date;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const conditions = [from && gte(rehearsals.startsAt, from), to && lt(rehearsals.startsAt, to)];
  const rows = await db
    .select(publicColumns)
    .from(rehearsals)
    .where(and(...conditions.filter(Boolean)))
    // Ties on starts_at are broken by id so offset pages never repeat or skip a row.
    .orderBy(
      order === "asc" ? asc(rehearsals.startsAt) : desc(rehearsals.startsAt),
      order === "asc" ? asc(rehearsals.id) : desc(rehearsals.id),
    )
    .limit(limit)
    .offset(offset);
  return withParts(rows);
}

/** The member's own marks on the given rehearsals, notes included (they are theirs). */
export async function myMarks(userId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof attendance.$inferSelect>();
  const rows = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.userId, userId), inArray(attendance.rehearsalId, ids)));
  return new Map(rows.map((r) => [r.rehearsalId, r]));
}

/** Whether `userId` is expected at each rehearsal (sectionals, joining date). */
export async function expectedFor(userId: string, list: Rehearsal[]) {
  const me = (await loadRosterUsers()).find((u) => u.id === userId);
  return new Map(list.map((r) => [r.id, me ? isExpected(me, r) : false]));
}
