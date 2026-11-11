import "server-only";
import { and, asc, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { cache } from "react";
import { db } from "@/db";
import {
  boardTicketEvents,
  boardTicketReads,
  boardTickets,
  calendarEvents,
  users,
} from "@/db/schema";
import { assertManager, requireManager } from "@/lib/auth/dal";
import { collator } from "@/lib/format";
import { canDeleteComment, canDeleteTicket } from "@/lib/permissions";
import { listRehearsals, rehearsalTitle } from "@/lib/attendance/rehearsals";
import { REHEARSAL_TYPE_LABELS } from "@/lib/labels";
import { festivalsBetween, specialDaysBetween } from "@/lib/festivals/queries";
import { REGION_LABELS, SPECIAL_DAY_LABELS } from "@/lib/festivals/labels";
import type { SpecialDayKind } from "@/db/schema";
import { addDays, istanbulDateOf, istanbulTimeOf, istanbulToUtc, now } from "@/lib/time";
import { monthWeeks, type CalendarFilter, type CalendarTone } from "./calendar";
import {
  CALENDAR_KIND_LABELS,
  TICKET_STATUSES,
  type BoardFilters,
  type CalendarKind,
  type TicketStatus,
  type TicketUrgency,
} from "./labels";
import {
  ARCHIVE_AFTER_S,
  ARCHIVE_PAGE_SIZE,
  compareTickets,
  systemSentence,
  TICKET_NUMBER,
} from "./rules";

const t = boardTickets;
const ev = boardTicketEvents;
const reads = boardTicketReads;
const assignee = alias(users, "assignee");
const opener = alias(users, "opener");
const editor = alias(users, "editor");
const fromUser = alias(users, "from_user");
const toUser = alias(users, "to_user");

export type TicketCardData = {
  number: number;
  title: string;
  status: TicketStatus;
  urgency: TicketUrgency;
  dueOn: string | null;
  onCalendar: boolean;
  overdue: boolean;
  // active = false renders "(kurulda değil)".
  assignee: { id: string; name: string; active: boolean } | null;
  commentCount: number;
  isNew: boolean;
  doneAt: Date | null;
  updatedAt: Date;
};

export type ThreadItem =
  | { kind: "system"; id: number; at: Date; text: string }
  | {
      kind: "comment";
      id: number;
      at: Date;
      authorId: string;
      author: string;
      body: string;
      canDelete: boolean;
    };

const notArchived = sql`(${t.status} <> 'done' or ${t.doneAt} >= unixepoch() - ${ARCHIVE_AFTER_S})`;
const archived = sql`(${t.status} = 'done' and ${t.doneAt} < unixepoch() - ${ARCHIVE_AFTER_S})`;

/** Assigned to `me`, not Bitti, and someone else acted after my last seen marker (D7). */
function isNewFor(me: string) {
  return sql<number>`(${t.assigneeId} = ${me} and ${t.status} <> 'done' and (
    exists (select 1 from ${ev} e where e.ticket_id = ${t.id}
            and e.id > coalesce(${reads.seenEventId}, 0) and e.actor_id <> ${me})
    or (${t.updatedBy} is not null and ${t.updatedBy} <> ${me}
        and ${t.revision} > coalesce(${reads.seenRevision}, -1))))`;
}

function cardColumns(me: string) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    status: t.status,
    urgency: t.urgency,
    dueOn: t.dueOn,
    onCalendar: t.onCalendar,
    doneAt: t.doneAt,
    updatedAt: t.updatedAt,
    assigneeId: t.assigneeId,
    assigneeName: assignee.name,
    assigneeActive: sql<number>`(${assignee.isActive} = 1 and ${assignee.role} in ('conductor', 'board'))`,
    commentCount: sql<number>`(select count(*) from ${ev} c where c.ticket_id = ${t.id} and c.kind = 'comment')`,
    isNew: isNewFor(me),
  };
}

function cardsQuery(me: string, where: SQL | undefined) {
  return db
    .select(cardColumns(me))
    .from(t)
    .leftJoin(assignee, eq(assignee.id, t.assigneeId))
    .leftJoin(reads, and(eq(reads.ticketId, t.id), eq(reads.userId, me)))
    .where(where);
}

type CardRow = Awaited<ReturnType<typeof cardsQuery>>[number];

function toCard(r: CardRow, today: string): TicketCardData {
  return {
    number: r.number,
    title: r.title,
    status: r.status,
    urgency: r.urgency,
    dueOn: r.dueOn,
    onCalendar: r.onCalendar,
    overdue: r.status !== "done" && r.dueOn !== null && r.dueOn < today,
    assignee:
      r.assigneeId && r.assigneeName
        ? { id: r.assigneeId, name: r.assigneeName, active: Boolean(r.assigneeActive) }
        : null,
    commentCount: Number(r.commentCount),
    isNew: Boolean(r.isNew),
    doneAt: r.doneAt,
    updatedAt: r.updatedAt,
  };
}

export type Board = {
  columns: Record<TicketStatus, TicketCardData[]>;
  counts: Record<TicketStatus, number>;
  filters: BoardFilters;
  // False only when the table has no ticket at all (AC 8 "Panoda henüz iş yok.").
  anyTickets: boolean;
};

/** The four columns, filtered and ordered (AC 7, 9); archived Bitti tickets are left out. */
export async function getBoard(filters: BoardFilters): Promise<Board> {
  const viewer = await requireManager();
  const [rows, [{ n }]] = await Promise.all([
    cardsQuery(
      viewer.id,
      and(
        notArchived,
        filters.kim === "ben" ? eq(t.assigneeId, viewer.id) : undefined,
        filters.urgency ? eq(t.urgency, filters.urgency) : undefined,
      ),
    ),
    db.select({ n: sql<number>`count(*)` }).from(t),
  ]);
  const today = istanbulDateOf(now());
  const columns = Object.fromEntries(TICKET_STATUSES.map((s) => [s, []])) as unknown as Record<
    TicketStatus,
    TicketCardData[]
  >;
  for (const r of rows.sort(compareTickets)) columns[r.status].push(toCard(r, today));
  const counts = Object.fromEntries(TICKET_STATUSES.map((s) => [s, columns[s].length])) as Record<
    TicketStatus,
    number
  >;
  return { columns, counts, filters, anyTickets: Number(n) > 0 };
}

/** Bitti tickets older than 30 × 24 h, newest done_at first, 50 a page (AC 23). */
export async function getArchive(rawPage: unknown) {
  const viewer = await requireManager();
  const parsed = Number(typeof rawPage === "string" && /^\d{1,5}$/.test(rawPage) ? rawPage : 1);
  const page = parsed >= 1 ? parsed : 1;
  const rows = await cardsQuery(viewer.id, archived)
    .orderBy(sql`${t.doneAt} desc`, sql`${t.number} desc`)
    .limit(ARCHIVE_PAGE_SIZE + 1)
    .offset((page - 1) * ARCHIVE_PAGE_SIZE);
  const today = istanbulDateOf(now());
  return {
    page,
    rows: rows.slice(0, ARCHIVE_PAGE_SIZE).map((r) => toCard(r, today)),
    hasOlder: rows.length > ARCHIVE_PAGE_SIZE,
    hasNewer: page > 1,
  };
}

export type CalendarItem = {
  key: string;
  tone: CalendarTone;
  title: string;
  href: string;
  // "HH:MM" or null for all day.
  start: string | null;
  end: string | null;
  location: string | null;
  // Rehearsal type or event kind label, ticket number.
  label: string;
  // Cancelled rehearsals and Bitti tickets are struck through.
  struck: boolean;
};

const EVENT_FILTER: Partial<Record<CalendarFilter, CalendarKind>> = {
  konser: "concert",
  toplanti: "meeting",
  gezi: "trip",
  diger: "other",
};

/** Rehearsals, calendar events and tickets put on the calendar, for the month's grid, by day. */
export async function getCalendar(month: string, filter: CalendarFilter) {
  const viewer = await requireManager();
  const weeks = monthWeeks(month);
  const first = weeks[0][0];
  const last = weeks.at(-1)!.at(-1)!;
  const want = (f: CalendarFilter) => filter === "hepsi" || filter === f;
  const eventKind = EVENT_FILTER[filter];
  const wantEvents = filter === "hepsi" || eventKind !== undefined;
  const wantRehearsals = want("calisma") || want("konser");

  const [rehearsalRows, eventRows, ticketRows, festivalRows, specialRows] = await Promise.all([
    wantRehearsals
      ? listRehearsals({
          from: istanbulToUtc(first),
          to: istanbulToUtc(addDays(last, 1)),
          limit: 500,
        })
      : [],
    wantEvents
      ? db
          .select()
          .from(calendarEvents)
          .where(
            and(
              sql`${calendarEvents.day} between ${first} and ${last}`,
              eventKind ? eq(calendarEvents.kind, eventKind) : undefined,
            ),
          )
      : [],
    want("is")
      ? cardsQuery(
          viewer.id,
          and(eq(t.onCalendar, true), sql`${t.dueOn} between ${first} and ${last}`),
        )
      : [],
    want("festival") ? festivalsBetween(first, last) : [],
    specialDaysBetween(first, last),
  ]);

  const items: (CalendarItem & { day: string })[] = [];
  for (const r of rehearsalRows) {
    const concert = r.type === "concert";
    if (filter === "calisma" && concert) continue;
    if (filter === "konser" && !concert) continue;
    items.push({
      key: `r-${r.id}`,
      day: istanbulDateOf(r.startsAt),
      tone: concert ? "concert" : "rehearsal",
      title: rehearsalTitle(r),
      href: `/calismalar/${r.id}`,
      start: istanbulTimeOf(r.startsAt),
      end: istanbulTimeOf(r.endsAt),
      location: r.location,
      label: REHEARSAL_TYPE_LABELS[r.type],
      struck: r.cancelledAt !== null,
    });
  }
  for (const ev of eventRows) {
    items.push({
      key: `e-${ev.id}`,
      day: ev.day,
      tone: ev.kind,
      title: ev.title,
      href: `/yonetim/takvim/etkinlik/${ev.id}`,
      start: ev.startTime,
      end: ev.endTime,
      location: ev.location,
      label: CALENDAR_KIND_LABELS[ev.kind],
      struck: false,
    });
  }
  for (const r of ticketRows) {
    items.push({
      key: `t-${r.number}`,
      day: r.dueOn!,
      tone: "ticket",
      title: r.title,
      href: `/yonetim/${r.number}`,
      start: null,
      end: null,
      location: null,
      label: `İş #${r.number}`,
      struck: r.status === "done",
    });
  }
  for (const f of festivalRows) {
    const href = `/yonetim/festivaller/${f.id}`;
    if (f.startsOn) {
      const end = f.endsOn ?? f.startsOn;
      for (
        let day = f.startsOn < first ? first : f.startsOn;
        day <= end && day <= last;
        day = addDays(day, 1)
      ) {
        items.push({
          key: `f-${f.id}-${day}`,
          day,
          tone: "festival",
          title: f.name,
          href,
          start: null,
          end: null,
          location: f.place,
          label:
            f.status === "attending"
              ? "Festival · Katılıyoruz"
              : `Festival · ${REGION_LABELS[f.region]}`,
          struck: false,
        });
      }
    }
    if (f.deadlineOn && f.deadlineOn >= first && f.deadlineOn <= last) {
      items.push({
        key: `fd-${f.id}`,
        day: f.deadlineOn,
        tone: "deadline",
        title: `Son başvuru: ${f.name}`,
        href,
        start: null,
        end: null,
        location: null,
        label: "Başvuru",
        struck: false,
      });
    }
  }
  const special = new Map<string, SpecialDayKind>();
  for (const d of specialRows) {
    if (!special.has(d.day) || d.kind !== "other") special.set(d.day, d.kind);
    items.push({
      key: `s-${d.id}`,
      day: d.day,
      tone: "special",
      title: d.title,
      href: `/ozel-gunler?yil=${d.day.slice(0, 4)}`,
      start: null,
      end: null,
      location: null,
      label: SPECIAL_DAY_LABELS[d.kind],
      struck: false,
    });
  }
  // All-day entries first, then by start time, then by title.
  items.sort(
    (a, b) =>
      (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) ||
      (a.start ?? "").localeCompare(b.start ?? "") ||
      collator.compare(a.title, b.title),
  );
  const byDay = new Map<string, CalendarItem[]>();
  for (const { day, ...item } of items) {
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }
  return { weeks, byDay, special, today: istanbulDateOf(now()) };
}

export type TicketDetail = TicketCardData & {
  description: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  lastEdit: { name: string; at: Date } | null;
  revision: number;
  canDelete: boolean;
  thread: ThreadItem[];
  // Round-tripped to markTicketSeen: what this render showed.
  seen: { eventId: number; revision: number };
};

/** One ticket with its thread; null for a malformed or unknown number (the page 404s). */
export async function getTicket(raw: string): Promise<TicketDetail | null> {
  const viewer = await requireManager();
  if (!TICKET_NUMBER.test(raw)) return null;
  const [row] = await db
    .select({
      ...cardColumns(viewer.id),
      description: t.description,
      revision: t.revision,
      createdAt: t.createdAt,
      createdById: t.createdBy,
      createdByName: opener.name,
      updatedBy: t.updatedBy,
      updatedByName: editor.name,
    })
    .from(t)
    .innerJoin(opener, eq(opener.id, t.createdBy))
    .leftJoin(editor, eq(editor.id, t.updatedBy))
    .leftJoin(assignee, eq(assignee.id, t.assigneeId))
    .leftJoin(reads, and(eq(reads.ticketId, t.id), eq(reads.userId, viewer.id)))
    .where(eq(t.number, Number(raw)));
  if (!row) return null;

  const actor = alias(users, "actor");
  const events = await db
    .select({
      id: ev.id,
      kind: ev.kind,
      actorId: ev.actorId,
      actorName: actor.name,
      body: ev.body,
      fromValue: ev.fromValue,
      toValue: ev.toValue,
      fromUserName: fromUser.name,
      toUserName: toUser.name,
      createdAt: ev.createdAt,
    })
    .from(ev)
    .innerJoin(actor, eq(actor.id, ev.actorId))
    .leftJoin(fromUser, eq(fromUser.id, ev.fromUserId))
    .leftJoin(toUser, eq(toUser.id, ev.toUserId))
    .where(eq(ev.ticketId, row.id))
    .orderBy(asc(ev.id));

  const at = now();
  const thread: ThreadItem[] = events.map((e) =>
    e.kind === "comment"
      ? {
          kind: "comment",
          id: e.id,
          at: e.createdAt,
          authorId: e.actorId,
          author: e.actorName,
          body: e.body ?? "",
          canDelete: canDeleteComment(viewer, { ...e, createdAt: e.createdAt }, at),
        }
      : { kind: "system", id: e.id, at: e.createdAt, text: systemSentence(e) },
  );
  return {
    ...toCard(row, istanbulDateOf(at)),
    description: row.description,
    createdBy: { id: row.createdById, name: row.createdByName },
    createdAt: row.createdAt,
    lastEdit:
      row.updatedBy && row.updatedByName ? { name: row.updatedByName, at: row.updatedAt } : null,
    revision: row.revision,
    canDelete: canDeleteTicket(viewer, { createdBy: row.createdById }),
    thread,
    seen: { eventId: events.at(-1)?.id ?? 0, revision: row.revision },
  };
}

/** Active conductor and board members, by name (AC 11). */
export async function assigneeOptions() {
  await requireManager();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.isActive, true), or(eq(users.role, "conductor"), eq(users.role, "board"))));
  return rows.sort((a, b) => collator.compare(a.name, b.name));
}

export type BoardSummary = {
  open: number;
  fresh: number;
  urgent: number;
  // The first of my open tickets in board order.
  top: { number: number; title: string; urgency: TicketUrgency } | null;
};

/**
 * Non-redirecting: null for members (and logged-out requests), so the home page and the layout
 * can call it for everyone. Reads the session itself; there is no user parameter to forge.
 */
export const boardSummary = cache(async (): Promise<BoardSummary | null> => {
  const viewer = await assertManager();
  if (!viewer) return null;
  const rows = await db
    .select({
      number: t.number,
      title: t.title,
      status: t.status,
      urgency: t.urgency,
      dueOn: t.dueOn,
      doneAt: t.doneAt,
      updatedAt: t.updatedAt,
      isNew: isNewFor(viewer.id),
    })
    .from(t)
    .leftJoin(reads, and(eq(reads.ticketId, t.id), eq(reads.userId, viewer.id)))
    .where(and(eq(t.assigneeId, viewer.id), ne(t.status, "done")));
  const [first] = rows.sort(compareTickets);
  return {
    open: rows.length,
    fresh: rows.filter((r) => r.isNew).length,
    urgent: rows.filter((r) => r.urgency === "urgent").length,
    top: first ? { number: first.number, title: first.title, urgency: first.urgency } : null,
  };
});

/** The D7 badge count; 0 for members without a board query. */
export async function boardBadgeCount() {
  return (await boardSummary())?.fresh ?? 0;
}

/** One calendar event for its edit page; null for a malformed or unknown id (the page 404s). */
export async function getCalendarEvent(id: string) {
  await requireManager();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
  return row ?? null;
}
