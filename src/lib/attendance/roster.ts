import "server-only";
import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import {
  attendance,
  rehearsalParts,
  rehearsals,
  users,
  type AttendanceStatus,
  type CheckInMethod,
  type RehearsalType,
  type Role,
  type VoicePart,
} from "@/db/schema";

export type RosterUser = {
  id: string;
  name: string;
  role: Role;
  voicePart: VoicePart | null;
  joinedAt: Date;
  leftAt: Date | null;
};

export type RehearsalForRoster = {
  id: string;
  type: RehearsalType;
  startsAt: Date;
  parts: VoicePart[];
};

/** The single definition of who is expected at a rehearsal. */
export function isExpected(user: RosterUser, rehearsal: RehearsalForRoster) {
  if (user.role === "conductor") return false;
  if (user.joinedAt > rehearsal.startsAt) return false;
  if (user.leftAt && user.leftAt <= rehearsal.startsAt) return false;
  if (rehearsal.type === "sectional") {
    return user.voicePart !== null && rehearsal.parts.includes(user.voicePart);
  }
  return true;
}

/** Ids of everyone expected at `rehearsal`, in `users` order. */
export function expectedIds(users: readonly RosterUser[], rehearsal: RehearsalForRoster) {
  return users.filter((u) => isExpected(u, rehearsal)).map((u) => u.id);
}

export async function loadRosterUsers(): Promise<RosterUser[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      voicePart: users.voicePart,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
    })
    .from(users);
}

export async function partsByRehearsal(ids: string[]) {
  const map = new Map<string, VoicePart[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select()
    .from(rehearsalParts)
    .where(inArray(rehearsalParts.rehearsalId, ids));
  for (const row of rows) {
    map.set(row.rehearsalId, [...(map.get(row.rehearsalId) ?? []), row.voicePart]);
  }
  return map;
}

export async function loadRehearsalForRoster(id: string) {
  const [row] = await db
    .select({ id: rehearsals.id, type: rehearsals.type, startsAt: rehearsals.startsAt })
    .from(rehearsals)
    .where(eq(rehearsals.id, id))
    .limit(1);
  if (!row) return null;
  const parts = (await partsByRehearsal([id])).get(id) ?? [];
  return { ...row, parts } satisfies RehearsalForRoster;
}

export type RosterRow = {
  userId: string;
  name: string;
  voicePart: VoicePart | null;
  onRoster: boolean;
  status: AttendanceStatus | null;
  method: CheckInMethod | null;
  note: string | null;
  recordedAt: Date | null;
  recordedByName: string | null;
  correctedAt: Date | null;
};

/** Everyone expected plus anyone who has a row anyway. Notes only for managers. */
export async function rosterOf(rehearsalId: string, { includeNotes }: { includeNotes: boolean }) {
  const rehearsal = await loadRehearsalForRoster(rehearsalId);
  if (!rehearsal) return null;
  const recorder = alias(users, "recorder");
  const [people, rows] = await Promise.all([
    loadRosterUsers(),
    db
      .select({
        userId: attendance.userId,
        status: attendance.status,
        method: attendance.method,
        note: attendance.note,
        recordedAt: attendance.recordedAt,
        correctedAt: attendance.correctedAt,
        recordedByName: recorder.name,
      })
      .from(attendance)
      .leftJoin(recorder, eq(recorder.id, attendance.recordedBy))
      .where(eq(attendance.rehearsalId, rehearsalId)),
  ]);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const result: RosterRow[] = [];
  for (const person of people) {
    const row = byUser.get(person.id);
    const onRoster = isExpected(person, rehearsal);
    if (!onRoster && !row) continue;
    result.push({
      userId: person.id,
      name: person.name,
      voicePart: person.voicePart,
      onRoster,
      status: row?.status ?? null,
      method: row?.method ?? null,
      note: includeNotes ? (row?.note ?? null) : null,
      recordedAt: row?.recordedAt ?? null,
      recordedByName: row?.recordedByName ?? null,
      correctedAt: row?.correctedAt ?? null,
    });
  }
  return { rehearsal, rows: result };
}

/** Rows to write as absent when attendance closes: expected people with no mark yet. */
export async function unmarkedExpected(rehearsalId: string) {
  const roster = await rosterOf(rehearsalId, { includeNotes: false });
  return roster?.rows.filter((r) => r.onRoster && r.status === null).map((r) => r.userId) ?? [];
}
