import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { cache } from "react";
import { db } from "@/db";
import {
  appSettings,
  assignmentParts,
  assignments,
  pieces,
  submissions,
  users,
  VOICE_PARTS,
  type Role,
  type SubmissionMethod,
  type VoicePart,
} from "@/db/schema";
import { collator } from "@/lib/format";
import { now } from "@/lib/time";
import { isEligible, isExpected, type Singer } from "./eligibility";
import { RECORDING_EMAIL_RE } from "./mail";

export const CURRENT_WINDOW_MS = 7 * 24 * 3_600_000;
export const HOMEWORK_VIEWS = ["guncel", "gecmis"] as const;
export type HomeworkView = (typeof HOMEWORK_VIEWS)[number];

export type Viewer = Singer & { id: string; name: string };

/** The session user plus the membership dates eligibility needs. */
export const loadViewer = cache(async (id: string): Promise<Viewer | null> => {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      voicePart: users.voicePart,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
});

export async function getRecordingEmail() {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "recording_email"));
  return row && RECORDING_EMAIL_RE.test(row.value) ? row.value : null;
}

/** Expected, unsubmitted homework in Güncel; shared by the tab badge and the home card. */
export const openHomeworkCount = cache(async (userId: string) => {
  const viewer = await loadViewer(userId);
  if (!viewer || !isEligible(viewer, VOICE_PARTS)) return 0;
  const since = new Date(now().getTime() - CURRENT_WINDOW_MS);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(assignments)
    .innerJoin(
      assignmentParts,
      and(
        eq(assignmentParts.assignmentId, assignments.id),
        eq(assignmentParts.voicePart, viewer.voicePart!),
      ),
    )
    .where(
      and(
        gte(assignments.dueAt, since),
        gte(assignments.createdAt, viewer.joinedAt),
        sql`not exists (select 1 from ${submissions} s where s.assignment_id = ${assignments.id} and s.user_id = ${viewer.id} and s.submitted_at is not null)`,
      ),
    );
  return Number(row?.n ?? 0);
});

const baseColumns = {
  id: assignments.id,
  pieceId: assignments.pieceId,
  pieceTitle: pieces.title,
  barFrom: assignments.barFrom,
  barTo: assignments.barTo,
  dueAt: assignments.dueAt,
  createdAt: assignments.createdAt,
};

async function partsOf(ids: string[]) {
  const map = new Map<string, VoicePart[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select()
    .from(assignmentParts)
    .where(inArray(assignmentParts.assignmentId, ids));
  for (const r of rows) map.set(r.assignmentId, [...(map.get(r.assignmentId) ?? []), r.voicePart]);
  for (const parts of map.values())
    parts.sort((a, b) => VOICE_PARTS.indexOf(a) - VOICE_PARTS.indexOf(b));
  return map;
}

function windowFilter(view: HomeworkView, at: Date) {
  const since = new Date(at.getTime() - CURRENT_WINDOW_MS);
  return view === "guncel" ? gte(assignments.dueAt, since) : lt(assignments.dueAt, since);
}

export type MemberRow = Awaited<ReturnType<typeof listForSinger>>[number];

/** A singer's homework: their part's, plus any they hold a row for. Never another user's data. */
export async function listForSinger(viewer: Viewer, view: HomeworkView, at: Date) {
  const rows = await db
    .select({
      ...baseColumns,
      submittedAt: submissions.submittedAt,
      hasNewNote:
        sql<boolean>`${submissions.feedback} is not null and (${submissions.feedbackSeenAt} is null or ${submissions.feedbackSeenAt} < ${submissions.feedbackAt})`.mapWith(
          Boolean,
        ),
    })
    .from(assignments)
    .innerJoin(pieces, eq(pieces.id, assignments.pieceId))
    .leftJoin(
      submissions,
      and(eq(submissions.assignmentId, assignments.id), eq(submissions.userId, viewer.id)),
    )
    .where(windowFilter(view, at))
    .orderBy(view === "guncel" ? asc(assignments.dueAt) : desc(assignments.dueAt));
  const parts = await partsOf(rows.map((r) => r.id));
  return rows
    .map((r) => {
      const p = parts.get(r.id) ?? [];
      const eligible = isEligible(viewer, p);
      return {
        ...r,
        parts: p,
        eligible,
        expected: isExpected(viewer, { parts: p, createdAt: r.createdAt }),
      };
    })
    .filter((r) => r.eligible || r.submittedAt !== null);
}

type RosterUser = Singer & { id: string; name: string; isActive: boolean };

async function loadRoster(): Promise<RosterUser[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      voicePart: users.voicePart,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
      isActive: users.isActive,
    })
    .from(users);
}

export type PartCount = { part: VoicePart; done: number; total: number };

function countsFor(
  a: { id: string; parts: VoicePart[]; createdAt: Date },
  roster: RosterUser[],
  submitted: Set<string>,
) {
  const perPart: PartCount[] = a.parts.map((part) => ({ part, done: 0, total: 0 }));
  for (const u of roster) {
    const has = submitted.has(`${a.id}:${u.id}`);
    // Denominator = expected singers plus anyone else who submitted and is still in the choir.
    if (!isExpected(u, a) && !(has && u.leftAt === null)) continue;
    const bucket = perPart.find((c) => c.part === u.voicePart);
    if (!bucket) continue;
    bucket.total++;
    if (has) bucket.done++;
  }
  return {
    perPart,
    done: perPart.reduce((s, c) => s + c.done, 0),
    total: perPart.reduce((s, c) => s + c.total, 0),
  };
}

async function submittedKeys(ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ a: submissions.assignmentId, u: submissions.userId })
    .from(submissions)
    .where(and(inArray(submissions.assignmentId, ids), isNotNull(submissions.submittedAt)));
  return new Set(rows.map((r) => `${r.a}:${r.u}`));
}

/** Managers: every homework with submission counts, three queries regardless of row count. */
export async function listForManager(view: HomeworkView, at: Date) {
  const rows = await db
    .select(baseColumns)
    .from(assignments)
    .innerJoin(pieces, eq(pieces.id, assignments.pieceId))
    .where(windowFilter(view, at))
    .orderBy(view === "guncel" ? asc(assignments.dueAt) : desc(assignments.dueAt));
  const ids = rows.map((r) => r.id);
  const [parts, submitted, roster] = await Promise.all([
    partsOf(ids),
    submittedKeys(ids),
    loadRoster(),
  ]);
  return rows.map((r) => {
    const withParts = { ...r, parts: parts.get(r.id) ?? [] };
    return { ...withParts, counts: countsFor(withParts, roster, submitted) };
  });
}

export async function countHomework(view: HomeworkView, at: Date) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(assignments)
    .where(windowFilter(view, at));
  return Number(row?.n ?? 0);
}

export const getAssignment = cache(async (id: string) => {
  const creator = alias(users, "creator");
  const [row] = await db
    .select({
      ...baseColumns,
      description: assignments.description,
      updatedAt: assignments.updatedAt,
      pieceStatus: pieces.status,
      creatorName: creator.name,
    })
    .from(assignments)
    .innerJoin(pieces, eq(pieces.id, assignments.pieceId))
    .leftJoin(creator, eq(creator.id, assignments.createdBy))
    .where(eq(assignments.id, id));
  if (!row) return null;
  const parts = (await partsOf([id])).get(id) ?? [];
  return { ...row, parts };
});

/** The viewer's own row, including their feedback text. */
export async function mySubmission(assignmentId: string, userId: string) {
  const author = alias(users, "author");
  const marker = alias(users, "marker");
  const [row] = await db
    .select({
      submittedAt: submissions.submittedAt,
      method: submissions.method,
      markedByName: marker.name,
      feedback: submissions.feedback,
      feedbackAt: submissions.feedbackAt,
      feedbackSeenAt: submissions.feedbackSeenAt,
      feedbackByName: author.name,
      feedbackByRole: author.role,
    })
    .from(submissions)
    .leftJoin(author, eq(author.id, submissions.feedbackBy))
    .leftJoin(marker, eq(marker.id, submissions.markedBy))
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.userId, userId)));
  return row ?? null;
}

export type RosterEntry = {
  userId: string;
  name: string;
  part: VoicePart | null;
  state: "done" | "late" | "missing" | "pending";
  submittedAt: Date | null;
  method: SubmissionMethod | null;
  feedback: string | null;
  feedbackByName: string | null;
  feedbackByRole: Role | null;
  expected: boolean;
  eligible: boolean;
  left: boolean;
};

/** Manager-only: who is expected, who submitted, and every private note on one homework. */
export async function rosterFor(
  a: { id: string; parts: VoicePart[]; createdAt: Date; dueAt: Date },
  at: Date,
) {
  const author = alias(users, "author");
  const [roster, rows] = await Promise.all([
    loadRoster(),
    db
      .select({
        userId: submissions.userId,
        submittedAt: submissions.submittedAt,
        method: submissions.method,
        feedback: submissions.feedback,
        feedbackByName: author.name,
        feedbackByRole: author.role,
      })
      .from(submissions)
      .leftJoin(author, eq(author.id, submissions.feedbackBy))
      .where(eq(submissions.assignmentId, a.id)),
  ]);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const entries: RosterEntry[] = [];
  for (const u of roster) {
    const sub = byUser.get(u.id);
    const expected = isExpected(u, a);
    const eligible = isEligible(u, a.parts);
    const submitted = Boolean(sub?.submittedAt);
    if (!expected && !submitted) continue;
    if (!submitted && !eligible) continue;
    entries.push({
      userId: u.id,
      name: u.name,
      part: u.voicePart,
      state: submitted
        ? sub!.submittedAt! > a.dueAt
          ? "late"
          : "done"
        : a.dueAt <= at
          ? "missing"
          : "pending",
      submittedAt: sub?.submittedAt ?? null,
      method: sub?.method ?? null,
      feedback: sub?.feedback ?? null,
      feedbackByName: sub?.feedbackByName ?? null,
      feedbackByRole: sub?.feedbackByRole ?? null,
      expected,
      eligible,
      left: u.leftAt !== null,
    });
  }
  entries.sort((x, y) => collator.compare(x.name, y.name));
  return entries;
}

export type MatrixCell = "done" | "late" | "missing" | "pending" | "none";

/** Manager-only: the last 8 homework by due date, newest first, without any feedback text. */
export async function homeworkMatrix(at: Date) {
  const columns = await db
    .select(baseColumns)
    .from(assignments)
    .innerJoin(pieces, eq(pieces.id, assignments.pieceId))
    .orderBy(desc(assignments.dueAt))
    .limit(8);
  const ids = columns.map((c) => c.id);
  const [parts, roster, subs] = await Promise.all([
    partsOf(ids),
    loadRoster(),
    ids.length
      ? db
          .select({
            a: submissions.assignmentId,
            u: submissions.userId,
            at: submissions.submittedAt,
          })
          .from(submissions)
          .where(and(inArray(submissions.assignmentId, ids), isNotNull(submissions.submittedAt)))
      : Promise.resolve([]),
  ]);
  const submittedAt = new Map(subs.map((s) => [`${s.a}:${s.u}`, s.at!]));
  const cols = columns.map((c) => ({ ...c, parts: parts.get(c.id) ?? [] }));
  const rows = roster
    .map((u) => {
      const cells = cols.map((c): MatrixCell => {
        const at2 = submittedAt.get(`${c.id}:${u.id}`);
        if (at2) return at2 > c.dueAt ? "late" : "done";
        if (!isExpected(u, c)) return "none";
        return c.dueAt <= at ? "missing" : "pending";
      });
      // Pending cells aren't due yet, so they don't count against anyone.
      const counted = cells.filter((x) => x !== "none" && x !== "pending");
      return {
        id: u.id,
        name: u.name,
        part: u.voicePart,
        left: u.leftAt !== null,
        cells,
        done: counted.filter((x) => x === "done" || x === "late").length,
        total: counted.length,
      };
    })
    .filter((r) => r.cells.some((c) => c !== "none") && r.part !== null && (!r.left || r.done > 0))
    .sort((x, y) => collator.compare(x.name, y.name));
  return { columns: cols, rows };
}

export async function openHomeworkForPiece(pieceId: string, at: Date) {
  return db
    .select({
      id: assignments.id,
      barFrom: assignments.barFrom,
      barTo: assignments.barTo,
      dueAt: assignments.dueAt,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.pieceId, pieceId),
        gte(assignments.dueAt, new Date(at.getTime() - CURRENT_WINDOW_MS)),
      ),
    )
    .orderBy(asc(assignments.dueAt));
}

export async function submissionCount(assignmentId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), isNotNull(submissions.submittedAt)));
  return Number(row?.n ?? 0);
}

export async function pieceOptions(currentId?: string) {
  const rows = await db
    .select({ id: pieces.id, title: pieces.title, status: pieces.status })
    .from(pieces);
  return rows
    .filter((p) => p.status !== "archive" || p.id === currentId)
    .sort((a, b) => collator.compare(a.title, b.title));
}
