import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  VOICE_PARTS,
  type AnnouncementAudience,
  type Role,
  type VoicePart,
} from "@/db/schema";
import { isManager } from "@/lib/permissions";
import { istanbulDateOf, now } from "@/lib/time";
import { HOME_MAX } from "./labels";

export type Viewer = { id: string; role: Role; voicePart: VoicePart | null };

export type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  parts: VoicePart[];
  important: boolean;
  showUntil: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  senderName: string;
  senderRole: Role;
};

export type ManagedAnnouncement = Announcement & { audienceCount: number; readCount: number };

type Row = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  parts: string | null;
  important: number;
  show_until: string;
  created_at: number;
  updated_at: number;
  created_by: string;
  sender_name: string;
  sender_role: Role;
  audience_n?: number;
  read_n?: number;
};

const ACTIVE = sql.raw("u.is_active = 1 and u.left_at is null");

/** Whether user `u` is addressed by announcement `a`: managers always are. */
const ADDRESSED = sql.raw(`(a.audience = 'all' or u.role in ('conductor', 'board') or (a.audience = 'parts'
  and exists (select 1 from announcement_parts p where p.announcement_id = a.id and p.voice_part = u.voice_part)))`);

/** The viewer's own filter, from the session (role and part are re-read on every request). */
function visibleTo(viewer: Viewer): SQL {
  if (isManager(viewer.role)) return sql`1`;
  if (!viewer.voicePart) return sql`a.audience = 'all'`;
  return sql`(a.audience = 'all' or (a.audience = 'parts' and exists (
    select 1 from announcement_parts p where p.announcement_id = a.id and p.voice_part = ${viewer.voicePart})))`;
}

const COLUMNS = sql.raw(`a.id, a.title, a.body, a.audience, a.important, a.show_until, a.created_at,
  a.updated_at, a.created_by, s.name as sender_name, s.role as sender_role,
  (select group_concat(p.voice_part) from announcement_parts p where p.announcement_id = a.id) as parts`);

function toAnnouncement(r: Row): Announcement {
  const parts = new Set((r.parts ?? "").split(","));
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    audience: r.audience,
    // Fixed S/A/T/B order whatever group_concat returns.
    parts: VOICE_PARTS.filter((p) => parts.has(p)),
    important: Number(r.important) === 1,
    showUntil: r.show_until,
    createdAt: new Date(Number(r.created_at) * 1000),
    updatedAt: new Date(Number(r.updated_at) * 1000),
    createdBy: r.created_by,
    senderName: r.sender_name,
    senderRole: r.sender_role,
  };
}

/** /duyurular: newest first, only what is addressed to the viewer; managers also get read counts. */
export async function listAnnouncements(viewer: Viewer, limit = 100) {
  const manager = isManager(viewer.role);
  const counts = manager
    ? sql`, (select count(*) from users u where ${ACTIVE} and u.id <> a.created_by and ${ADDRESSED}) as audience_n,
        (select count(*) from announcement_reads r join users u on u.id = r.user_id
          where r.announcement_id = a.id and ${ACTIVE} and u.id <> a.created_by and ${ADDRESSED}) as read_n`
    : sql``;
  const rows = await db.all<Row>(sql`
    select ${COLUMNS} ${counts}
    from announcements a join users s on s.id = a.created_by
    where a.deleted_at is null and ${visibleTo(viewer)}
    order by a.created_at desc, a.id
    limit ${limit}`);
  return rows.map((r) => ({
    ...toAnnouncement(r),
    audienceCount: Number(r.audience_n ?? 0),
    readCount: Number(r.read_n ?? 0),
  })) satisfies ManagedAnnouncement[];
}

/** Home card: active, unread and addressed to the viewer, newest first. */
export async function homeAnnouncements(viewer: Viewer) {
  const today = istanbulDateOf(now());
  const where = sql`a.deleted_at is null and a.show_until >= ${today} and ${visibleTo(viewer)}
    and not exists (select 1 from announcement_reads r where r.announcement_id = a.id and r.user_id = ${viewer.id})`;
  const [rows, [{ n }]] = await Promise.all([
    db.all<Row>(sql`
      select ${COLUMNS} from announcements a join users s on s.id = a.created_by
      where ${where} order by a.created_at desc, a.id limit ${HOME_MAX}`),
    db.all<{ n: number }>(sql`select count(*) as n from announcements a where ${where}`),
  ]);
  return { items: rows.map(toAnnouncement), total: Number(n) };
}

/** One live announcement, only when the viewer is addressed by it. */
export async function visibleAnnouncement(viewer: Viewer, id: string) {
  const [row] = await db.all<Row>(sql`
    select ${COLUMNS} from announcements a join users s on s.id = a.created_by
    where a.id = ${id} and a.deleted_at is null and ${visibleTo(viewer)}`);
  return row ? toAnnouncement(row) : null;
}

/** Active people an announcement reaches (the sender included; callers drop them). */
export async function audienceIds(audience: AnnouncementAudience, parts: VoicePart[]) {
  const partList = parts.length ? sql.join(parts.map((p) => sql`${p}`), sql`, `) : sql`''`;
  const rows = await db.all<{ id: string }>(sql`
    select u.id from users u where ${ACTIVE} and (
      ${audience} = 'all' or u.role in ('conductor', 'board')
      or (${audience} = 'parts' and u.voice_part in (${partList})))`);
  return rows.map((r) => r.id);
}

/** Head counts for the compose form's "N kişiye bildirim gidecek." (sender not subtracted). */
export async function audienceCounts() {
  const rows = await db.all<{ role: Role; voice_part: VoicePart | null; n: number }>(sql`
    select u.role, u.voice_part, count(*) as n from users u where ${ACTIVE}
    group by u.role, u.voice_part`);
  const byPart = Object.fromEntries(VOICE_PARTS.map((p) => [p, 0])) as Record<VoicePart, number>;
  let all = 0;
  let managers = 0;
  for (const r of rows) {
    const n = Number(r.n);
    all += n;
    if (isManager(r.role)) managers += n;
    else if (r.voice_part) byPart[r.voice_part] += n;
  }
  return { all, managers, byPart };
}
export type AudienceCounts = Awaited<ReturnType<typeof audienceCounts>>;
