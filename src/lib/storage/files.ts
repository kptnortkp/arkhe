import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeTx } from "@/db/write-tx";
import type { RecordingType, Role, VoicePart } from "@/db/schema";

// The only readers of storage_key: the file routes and the actions that delete. Page queries never
// select it, so no key can reach HTML, RSC or JSON (AC 2).

const toDate = (s: number | null) => (s === null ? null : new Date(Number(s) * 1000));

export type DeliveryRecording = {
  id: string;
  userId: string;
  storageKey: string;
  contentType: RecordingType;
  sizeBytes: number;
  uploadedAt: Date;
  audioDeletedAt: Date | null;
  singerName: string;
  singerPart: VoicePart | null;
  singerRole: Role;
  pieceTitle: string;
  current: boolean;
  commented: boolean;
};

export async function recordingForDelivery(id: string): Promise<DeliveryRecording | null> {
  const [r] = await db.all<{
    id: string;
    user_id: string;
    storage_key: string;
    content_type: RecordingType;
    size_bytes: number;
    uploaded_at: number;
    audio_deleted_at: number | null;
    name: string;
    voice_part: VoicePart | null;
    role: Role;
    title: string;
    current: number;
    commented: number;
  }>(sql`
    select r.id, r.user_id, r.storage_key, r.content_type, r.size_bytes, r.uploaded_at,
      r.audio_deleted_at, s.name, s.voice_part, s.role, p.title,
      r.replaced_at is null as current,
      coalesce(sub.feedback is not null, 0) as commented
    from recordings r
    join users s on s.id = r.user_id
    join assignments asg on asg.id = r.assignment_id
    join pieces p on p.id = asg.piece_id
    left join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
    where r.id = ${id}`);
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    storageKey: r.storage_key,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    uploadedAt: toDate(r.uploaded_at)!,
    audioDeletedAt: toDate(r.audio_deleted_at),
    singerName: r.name,
    singerPart: r.voice_part,
    singerRole: r.role,
    pieceTitle: r.title,
    current: Boolean(r.current),
    commented: Boolean(r.commented),
  };
}

/**
 * D56: the store doesn't have the file. The trigger queues the key; we close that queue row in the
 * same transaction, so if the object was only unreachable (another store, a bad 404) and comes
 * back, nothing of ours ever deletes it. True = this call marked the take.
 */
export async function markRecordingMissing(id: string, storageKey: string) {
  const t = Math.floor(Date.now() / 1000);
  return writeTx(async (tx) => {
    const marked = await tx.run(sql`
      update recordings set audio_deleted_at = ${t}, deleted_reason = 'missing'
      where id = ${id} and audio_deleted_at is null`);
    if (marked.rowsAffected === 0) return false;
    await tx.run(sql`
      update storage_deletions set state = 'done', done_at = ${t}, attempts = attempts + 1,
        last_attempt_at = ${t}, last_error = null, not_before = null
      where storage_key = ${storageKey} and state = 'pending'`);
    return true;
  });
}

export type DeliveryMidi = {
  id: string;
  storageKey: string;
  sizeBytes: number;
  voicePart: VoicePart | null;
  label: string | null;
  pieceTitle: string;
};

export async function midiForDelivery(id: string): Promise<DeliveryMidi | null> {
  const [m] = await db.all<{
    id: string;
    storage_key: string;
    size_bytes: number;
    voice_part: VoicePart | null;
    label: string | null;
    title: string;
  }>(sql`
    select m.id, m.storage_key, m.size_bytes, m.voice_part, m.label, p.title
    from midi_files m join pieces p on p.id = m.piece_id where m.id = ${id}`);
  if (!m) return null;
  return {
    id: m.id,
    storageKey: m.storage_key,
    sizeBytes: Number(m.size_bytes),
    voicePart: m.voice_part,
    label: m.label,
    pieceTitle: m.title,
  };
}
