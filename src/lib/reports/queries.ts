import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { IssueImageType, IssueStatus, VoicePart, VoiceSection } from "@/db/schema";

const toDate = (s: number | null) => (s === null ? null : new Date(Number(s) * 1000));

/** Read fresh on every check: the flag is set by SQL, never cached in the session (db.md §4). */
export async function isReportHandler(userId: string) {
  const [row] = await db.all<{ h: number }>(sql`
    select handles_reports as h from users where id = ${userId} and is_active = 1`);
  return Boolean(Number(row?.h ?? 0));
}

/** The handler's nav badge (open reports); null for everyone else. */
export async function reportNavCount(userId: string): Promise<number | null> {
  const [row] = await db.all<{ h: number; n: number }>(sql`
    select u.handles_reports as h,
      (select count(*) from issue_reports where status in ('new', 'in_progress')) as n
    from users u where u.id = ${userId} and u.is_active = 1`);
  return Number(row?.h ?? 0) ? Number(row.n) : null;
}

export type MyReport = {
  id: string;
  number: number;
  title: string;
  status: IssueStatus;
  reply: string | null;
  createdAt: Date;
  images: number;
};

export async function myReports(userId: string): Promise<MyReport[]> {
  const rows = await db.all<{
    id: string;
    number: number;
    title: string;
    status: IssueStatus;
    reply: string | null;
    created_at: number;
    images: number;
  }>(sql`
    select r.id, r.number, r.title, r.status, r.reply, r.created_at,
      (select count(*) from issue_report_images i where i.report_id = r.id) as images
    from issue_reports r where r.reporter_id = ${userId}
    order by r.created_at desc, r.number desc limit 50`);
  return rows.map((r) => ({
    id: r.id,
    number: Number(r.number),
    title: r.title,
    status: r.status,
    reply: r.reply,
    createdAt: toDate(r.created_at)!,
    images: Number(r.images),
  }));
}

export const REPORT_FILTERS = ["acik", "kapali", "tumu"] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export type ReportRow = MyReport & { reporterName: string; updatedAt: Date };

/** The handler's list, newest first. Callers check isReportHandler first. */
export async function listReports(filter: ReportFilter): Promise<ReportRow[]> {
  const where =
    filter === "acik"
      ? sql`r.status in ('new', 'in_progress')`
      : filter === "kapali"
        ? sql`r.status in ('done', 'wontfix')`
        : sql`1 = 1`;
  const rows = await db.all<{
    id: string;
    number: number;
    title: string;
    status: IssueStatus;
    reply: string | null;
    created_at: number;
    updated_at: number;
    images: number;
    name: string;
  }>(sql`
    select r.id, r.number, r.title, r.status, r.reply, r.created_at, r.updated_at, u.name,
      (select count(*) from issue_report_images i where i.report_id = r.id) as images
    from issue_reports r join users u on u.id = r.reporter_id
    where ${where}
    order by r.created_at desc, r.number desc limit 200`);
  return rows.map((r) => ({
    id: r.id,
    number: Number(r.number),
    title: r.title,
    status: r.status,
    reply: r.reply,
    createdAt: toDate(r.created_at)!,
    updatedAt: toDate(r.updated_at)!,
    images: Number(r.images),
    reporterName: r.name,
  }));
}

export async function reportCounts() {
  const [row] = await db.all<{ open: number; closed: number }>(sql`
    select coalesce(sum(status in ('new', 'in_progress')), 0) as open,
      coalesce(sum(status in ('done', 'wontfix')), 0) as closed
    from issue_reports`);
  const open = Number(row?.open ?? 0);
  const closed = Number(row?.closed ?? 0);
  return { acik: open, kapali: closed, tumu: open + closed } satisfies Record<ReportFilter, number>;
}

export type ReportDetail = {
  id: string;
  number: number;
  title: string;
  body: string;
  status: IssueStatus;
  reply: string | null;
  page: string | null;
  device: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  reporter: { name: string; voicePart: VoicePart | null; voiceSection: VoiceSection | null };
  images: { id: string }[];
};

export async function reportByNumber(number: number): Promise<ReportDetail | null> {
  const [r] = await db.all<{
    id: string;
    number: number;
    title: string;
    body: string;
    status: IssueStatus;
    reply: string | null;
    page: string | null;
    device: string | null;
    created_at: number;
    updated_at: number;
    closed_at: number | null;
    name: string;
    voice_part: VoicePart | null;
    voice_section: VoiceSection | null;
  }>(sql`
    select r.*, u.name, u.voice_part, u.voice_section
    from issue_reports r join users u on u.id = r.reporter_id where r.number = ${number}`);
  if (!r) return null;
  const images = await db.all<{ id: string }>(sql`
    select id from issue_report_images where report_id = ${r.id} order by created_at, id`);
  return {
    id: r.id,
    number: Number(r.number),
    title: r.title,
    body: r.body,
    status: r.status,
    reply: r.reply,
    page: r.page,
    device: r.device,
    createdAt: toDate(r.created_at)!,
    updatedAt: toDate(r.updated_at)!,
    closedAt: toDate(r.closed_at),
    reporter: { name: r.name, voicePart: r.voice_part, voiceSection: r.voice_section },
    images,
  };
}

export type DeliveryImage = { storageKey: string; contentType: IssueImageType; sizeBytes: number };

/** The image only when the viewer reported it or handles reports; one query, nothing else leaks. */
export async function reportImageFor(id: string, viewerId: string): Promise<DeliveryImage | null> {
  const [row] = await db.all<{ storage_key: string; content_type: IssueImageType; size_bytes: number }>(sql`
    select i.storage_key, i.content_type, i.size_bytes
    from issue_report_images i join issue_reports r on r.id = i.report_id
    where i.id = ${id}
      and (r.reporter_id = ${viewerId}
        or (select handles_reports from users where id = ${viewerId} and is_active = 1) = 1)`);
  if (!row) return null;
  return {
    storageKey: row.storage_key,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
  };
}
