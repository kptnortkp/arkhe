import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type {
  RecordingDeleteReason,
  RecordingType,
  SubmissionMethod,
  VoicePart,
} from "@/db/schema";
import type { Q } from "@/db/write-tx";
import { MAX_UPLOADS_PER_SLOT } from "@/lib/storage/limits";
import { isEligible, type Singer } from "./eligibility";

const toDate = (s: unknown) => (s === null || s === undefined ? null : new Date(Number(s) * 1000));

export type Slot = {
  dueAt: Date;
  parts: VoicePart[];
  singer: (Singer & { id: string }) | null;
  eligible: boolean;
  submittedAt: Date | null;
  method: SubmissionMethod | null;
  hasFeedback: boolean;
  uploads: number;
  /** The current take (replaced_at is null), with or without audio. */
  current: { id: string; storageKey: string; audioDeleted: boolean; uploadedAt: Date } | null;
};

/**
 * Everything the recording writes decide on, for one (homework, singer). Server-only; callers run
 * it again inside their write transaction (TOCTOU). null = no such homework.
 */
export async function loadSlot(q: Q, assignmentId: string, userId: string): Promise<Slot | null> {
  const [a] = await q.all<{ due_at: number; parts: string | null }>(sql`
    select asg.due_at, (select group_concat(voice_part) from assignment_parts where assignment_id = asg.id) as parts
    from assignments asg where asg.id = ${assignmentId}`);
  if (!a || !a.parts) return null;
  const [u] = await q.all<{
    id: string;
    role: Singer["role"];
    voice_part: VoicePart | null;
    joined_at: number;
    left_at: number | null;
  }>(sql`select id, role, voice_part, joined_at, left_at from users where id = ${userId}`);
  const [sub] = await q.all<{
    submitted_at: number | null;
    method: SubmissionMethod | null;
    has_feedback: number;
  }>(sql`
    select submitted_at, method, feedback is not null as has_feedback from submissions
    where assignment_id = ${assignmentId} and user_id = ${userId}`);
  const [rec] = await q.all<{
    uploads: number;
    id: string | null;
    storage_key: string | null;
    audio_deleted_at: number | null;
    uploaded_at: number | null;
  }>(sql`
    select (select count(*) from recordings where assignment_id = ${assignmentId} and user_id = ${userId}) as uploads,
      c.id, c.storage_key, c.audio_deleted_at, c.uploaded_at
    from (select 1) left join recordings c
      on c.assignment_id = ${assignmentId} and c.user_id = ${userId} and c.replaced_at is null`);
  const parts = a.parts.split(",") as VoicePart[];
  const singer = u
    ? {
        id: u.id,
        role: u.role,
        voicePart: u.voice_part,
        joinedAt: toDate(u.joined_at)!,
        leftAt: toDate(u.left_at),
      }
    : null;
  return {
    dueAt: toDate(a.due_at)!,
    parts,
    singer,
    eligible: singer !== null && isEligible(singer, parts),
    submittedAt: toDate(sub?.submitted_at),
    method: sub?.method ?? null,
    hasFeedback: Boolean(sub?.has_feedback),
    uploads: Number(rec?.uploads ?? 0),
    current: rec?.id
      ? {
          id: rec.id,
          storageKey: rec.storage_key!,
          audioDeleted: rec.audio_deleted_at !== null,
          uploadedAt: toDate(rec.uploaded_at)!,
        }
      : null,
  };
}

export type MyTake = {
  id: string;
  contentType: RecordingType;
  durationMs: number | null;
  sizeBytes: number;
  uploadedAt: Date;
  /** "Değiştirildi · <tarih>": this take replaced an earlier one. */
  replacedEarlier: boolean;
  audioDeletedAt: Date | null;
  deletedReason: RecordingDeleteReason | null;
  /** Istanbul day the audio goes, "YYYY-MM-DD". */
  deleteOn: string;
};

/**
 * The singer's own recorder state on /odevler/<id>: the current take (no storage key), the upload
 * count for `<n>/5`, and whether the server would accept a change (D8 lock, D7 cap).
 */
export async function myRecorder(assignmentId: string, userId: string) {
  const [rows, [count]] = await Promise.all([
    db.all<{
      id: string;
      content_type: RecordingType;
      duration_ms: number | null;
      size_bytes: number;
      uploaded_at: number;
      replaces_id: string | null;
      audio_deleted_at: number | null;
      deleted_reason: RecordingDeleteReason | null;
      delete_on: string;
    }>(sql`
      select id, content_type, duration_ms, size_bytes, uploaded_at, replaces_id, audio_deleted_at,
        deleted_reason, delete_on
      from recordings where assignment_id = ${assignmentId} and user_id = ${userId} and replaced_at is null`),
    db.all<{ n: number; locked: number }>(sql`
      select (select count(*) from recordings where assignment_id = ${assignmentId} and user_id = ${userId}) as n,
        coalesce((select feedback is not null from submissions where assignment_id = ${assignmentId} and user_id = ${userId}), 0) as locked`),
  ]);
  const r = rows[0];
  const take: MyTake | null = r
    ? {
        id: r.id,
        contentType: r.content_type,
        durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
        sizeBytes: Number(r.size_bytes),
        uploadedAt: toDate(r.uploaded_at)!,
        replacedEarlier: r.replaces_id !== null,
        audioDeletedAt: toDate(r.audio_deleted_at),
        deletedReason: r.deleted_reason,
        deleteOn: r.delete_on,
      }
    : null;
  const uploadsUsed = Number(count?.n ?? 0);
  const locked = Boolean(count?.locked);
  return {
    take,
    uploadsUsed,
    uploadsLeft: Math.max(0, MAX_UPLOADS_PER_SLOT - uploadsUsed),
    /** The comment lock (D8, D46): no upload, replace or delete. */
    locked,
    canUpload: !locked && uploadsUsed < MAX_UPLOADS_PER_SLOT,
    canDelete: !locked && take !== null && take.audioDeletedAt === null,
  };
}

export type RosterTake = { id: string; durationMs: number | null; audioDeleted: boolean };

/** Managers' roster `Kayıt · 0:05` tags: one query for the whole homework (metadata only). */
export async function rosterTakes(assignmentId: string) {
  const rows = await db.all<{
    user_id: string;
    id: string;
    duration_ms: number | null;
    gone: number;
  }>(sql`
    select user_id, id, duration_ms, audio_deleted_at is not null as gone
    from recordings where assignment_id = ${assignmentId} and replaced_at is null`);
  return new Map<string, RosterTake>(
    rows.map((r) => [
      r.user_id,
      {
        id: r.id,
        durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
        audioDeleted: Boolean(r.gone),
      },
    ]),
  );
}

/** The delete confirm's `<k> ses kaydı`: takes whose audio still exists. */
export async function liveTakeCount(assignmentId: string) {
  const [row] = await db.all<{ n: number }>(sql`
    select count(*) as n from recordings where assignment_id = ${assignmentId} and audio_deleted_at is null`);
  return Number(row?.n ?? 0);
}
