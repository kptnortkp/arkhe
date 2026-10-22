// Board validation, ordering and thread sentences. Isomorphic: no Node APIs, no DB.
import { z } from "zod";
import { cleanLine, cleanText } from "@/lib/text";
import { addDays, dayInstant, formatAuditDate, istanbulDateOf, now } from "@/lib/time";
import {
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_URGENCIES,
  URGENCY_LABELS,
  URGENCY_RANK,
  type TicketEventKind,
  type TicketStatus,
  type TicketUrgency,
} from "./labels";

export const TICKET_STALE = "Bu iş az önce değişti. Sayfayı yenile.";
export const TICKET_NOT_FOUND = "Bu iş bulunamadı.";
export const BAD_ASSIGNEE = "Bu kişi sorumlu olarak seçilemez.";
export const DELETE_TICKET_DENIED = "Bu işi yalnızca açan kişi ya da koro şefi silebilir.";
export const COMMENT_NOT_OWN = "Yalnızca kendi yorumunu silebilirsin.";
export const COMMENT_TOO_OLD = "Yorum 15 dakika geçtikten sonra silinemez.";
export const RATE_LIMITED = "Çok fazla deneme. Biraz sonra yeniden dene.";
export const BAD_DATE = "Geçerli bir tarih seç.";
export const UNASSIGNED = "Atanmadı";
export const NOT_ON_BOARD = "kurulda değil";

export const COMMENT_DELETE_WINDOW_S = 15 * 60;
export const ARCHIVE_AFTER_S = 30 * 86_400;
export const ARCHIVE_PAGE_SIZE = 50;
export const CREATE_LIMIT = { max: 30, windowMs: 3_600_000 };
export const COMMENT_LIMIT = { max: 60, windowMs: 600_000 };

/** "#12 açıldı." etc.; the URL segment and bound numbers must match before any query. */
export const TICKET_NUMBER = /^[1-9]\d{0,8}$/;
export const ticketNumber = z.coerce.number().int().min(1).max(999_999_999);

const title = z
  .string("Başlık en az 3 karakter olmalı.")
  .overwrite(cleanLine)
  .trim()
  // The CHECK counts characters, not UTF-16 units: "🎵🎵" is 2, not 4.
  .refine((v) => [...v].length >= 3, "Başlık en az 3 karakter olmalı.")
  .max(120, "Başlık en fazla 120 karakter olabilir.");

const description = z
  .string()
  .overwrite(cleanText)
  .trim()
  .max(4000, "Açıklama en fazla 4000 karakter olabilir.")
  .optional()
  .transform((v) => v || null);

const assigneeId = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.uuid(BAD_ASSIGNEE).nullable());

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (v: string) => DAY.test(v) && addDays(v, 0) === v;

const dueOn = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .refine(
    (v) =>
      v === null || (isRealDay(v) && v >= "2000-01-01" && v <= addDays(istanbulDateOf(now()), 730)),
    BAD_DATE,
  );

const urgency = z.enum(TICKET_URGENCIES, "Aciliyet seç.");
const ticketFields = { title, description, assigneeId, dueOn };

export const createTicketSchema = z.object({
  ...ticketFields,
  urgency: urgency.default("medium"),
  status: z.enum(TICKET_STATUSES, "Durum seç.").default("todo"),
});

// No defaults on edit: a field missing from the form must never silently reset the ticket.
export const updateTicketSchema = z.object({
  ...ticketFields,
  urgency,
  revision: z.coerce.number().int().min(0),
});

export const commentSchema = z.object({
  body: z
    .string("Yorum boş olamaz.")
    .overwrite(cleanText)
    .trim()
    .min(1, "Yorum boş olamaz.")
    .max(2000, "Yorum en fazla 2000 karakter olabilir."),
});

export const moveSchema = z
  .object({
    number: ticketNumber,
    from: z.enum(TICKET_STATUSES),
    to: z.enum(TICKET_STATUSES),
  })
  .refine((d) => d.from !== d.to);

/** "#12 Devam ediyor sütununa taşındı." */
export function movedMessage(number: number, to: TicketStatus) {
  return `#${number} ${TICKET_STATUS_LABELS[to]} sütununa taşındı.`;
}

export type SortableTicket = {
  number: number;
  status: TicketStatus;
  urgency: TicketUrgency;
  dueOn: string | null;
  doneAt: Date | null;
  updatedAt: Date;
};

/** AC 7: urgency, then due date (none last), then most recently updated; Bitti by done_at. */
export function compareTickets(a: SortableTicket, b: SortableTicket) {
  if (a.status === "done" && b.status === "done") {
    return (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0) || b.number - a.number;
  }
  return (
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    (a.dueOn === b.dueOn
      ? 0
      : a.dueOn === null
        ? 1
        : b.dueOn === null
          ? -1
          : a.dueOn < b.dueOn
            ? -1
            : 1) ||
    b.updatedAt.getTime() - a.updatedAt.getTime() ||
    b.number - a.number
  );
}

export type ThreadEvent = {
  kind: TicketEventKind;
  actorName: string;
  fromValue: string | null;
  toValue: string | null;
  fromUserName: string | null;
  toUserName: string | null;
};

const dueText = (day: string) => formatAuditDate(dayInstant(day));

/** The D5 sentence of a system entry, rendered at read time from stored codes. */
export function systemSentence(e: ThreadEvent) {
  const who = e.actorName;
  switch (e.kind) {
    case "created":
      return `${who} bu işi açtı.`;
    case "status":
      return `${who} durumu ${TICKET_STATUS_LABELS[e.fromValue as TicketStatus]} → ${TICKET_STATUS_LABELS[e.toValue as TicketStatus]} olarak değiştirdi.`;
    case "urgency":
      return `${who} aciliyeti ${URGENCY_LABELS[e.fromValue as TicketUrgency]} → ${URGENCY_LABELS[e.toValue as TicketUrgency]} olarak değiştirdi.`;
    case "assignee":
      return `${who} sorumluyu ${e.fromUserName ?? UNASSIGNED} → ${e.toUserName ?? UNASSIGNED} olarak değiştirdi.`;
    case "due":
      if (!e.fromValue) return `${who} son tarih koydu: ${dueText(e.toValue!)}.`;
      if (!e.toValue) return `${who} son tarihi kaldırdı.`;
      return `${who} son tarihi ${dueText(e.fromValue)} → ${dueText(e.toValue)} olarak değiştirdi.`;
    default:
      return "";
  }
}
