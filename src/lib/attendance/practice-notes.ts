import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { VOICE_PARTS, type Role, type VoicePart } from "@/db/schema";
import { isManager } from "@/lib/permissions";
import { loadScope } from "@/lib/review/scope";

export const NOTE_BODY_MAX = 1000;

export type NoteViewer = { id: string; role: Role; voicePart: VoicePart | null };

export type PracticeNote = {
  id: string;
  body: string;
  voicePart: VoicePart | null;
  pieceId: string | null;
  pieceTitle: string | null;
  rehearsalId: string;
  rehearsalStartsAt: Date;
  authorName: string;
  createdAt: Date;
  canDelete: boolean;
};

/**
 * The parts `user` may write practice notes for: managers any part and "everyone" (null); a listening
 * assistant only the parts they listen to, and "everyone" only when that is all four.
 */
export async function noteTargets(user: NoteViewer): Promise<(VoicePart | null)[]> {
  if (isManager(user.role)) return [null, ...VOICE_PARTS];
  const scope = await loadScope(user.id);
  if (scope.length === 0) return [];
  return scope.length === VOICE_PARTS.length ? [null, ...scope] : scope;
}

/** Notes for everyone and for my part; managers and the author see every note. */
function visibleTo(viewer: NoteViewer) {
  if (isManager(viewer.role)) return sql`1 = 1`;
  return sql`(n.voice_part is null or n.voice_part = ${viewer.voicePart} or n.author_id = ${viewer.id})`;
}

type Row = {
  id: string;
  body: string;
  voice_part: VoicePart | null;
  piece_id: string | null;
  piece_title: string | null;
  rehearsal_id: string;
  starts_at: number;
  author_id: string;
  author_name: string;
  created_at: number;
};

function toNote(viewer: NoteViewer) {
  return (r: Row): PracticeNote => ({
    id: r.id,
    body: r.body,
    voicePart: r.voice_part,
    pieceId: r.piece_id,
    pieceTitle: r.piece_title,
    rehearsalId: r.rehearsal_id,
    rehearsalStartsAt: new Date(r.starts_at * 1000),
    authorName: r.author_name,
    createdAt: new Date(r.created_at * 1000),
    canDelete: r.author_id === viewer.id || viewer.role === "conductor",
  });
}

const SELECT = sql`
  select n.id, n.body, n.voice_part, n.piece_id, p.title as piece_title, n.rehearsal_id,
    r.starts_at, n.author_id, u.name as author_name, n.created_at
  from practice_notes n
  join rehearsals r on r.id = n.rehearsal_id
  join users u on u.id = n.author_id
  left join pieces p on p.id = n.piece_id`;

export async function notesForRehearsal(rehearsalId: string, viewer: NoteViewer) {
  const rows = await db.all<Row>(sql`${SELECT}
    where n.rehearsal_id = ${rehearsalId} and ${visibleTo(viewer)}
    order by n.created_at, n.id`);
  return rows.map(toNote(viewer));
}

export async function notesForPiece(pieceId: string, viewer: NoteViewer, limit = 10) {
  const rows = await db.all<Row>(sql`${SELECT}
    where n.piece_id = ${pieceId} and r.cancelled_at is null and ${visibleTo(viewer)}
    order by r.starts_at desc, n.created_at desc limit ${limit}`);
  return rows.map(toNote(viewer));
}

/** The home card: the latest notes meant for me from the last two weeks. */
export async function recentNotesFor(viewer: NoteViewer, since: Date, limit = 3) {
  const rows = await db.all<Row>(sql`${SELECT}
    where n.created_at >= ${Math.floor(since.getTime() / 1000)} and r.cancelled_at is null
      and ${isManager(viewer.role) ? sql`(n.voice_part is null or n.voice_part = ${viewer.voicePart})` : visibleTo(viewer)}
    order by n.created_at desc, n.id desc limit ${limit}`);
  return rows.map(toNote(viewer));
}
