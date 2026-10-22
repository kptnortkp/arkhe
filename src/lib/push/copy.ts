// Kinds, their order in the morning notification, and the text helpers every trigger uses.
import { formatter, istanbulTimeOf } from "@/lib/time";
import type { PushGroup } from "./groups";

/** §4 order: the combined morning notification lists lines in this order. */
export const KINDS = [
  "attendance_open",
  "rehearsal_today",
  "concert_tomorrow",
  "concert_today",
  "rehearsal_new",
  "rehearsal_changed",
  "rehearsal_cancelled",
  "rehearsal_restored",
  "series_ended",
  "absent",
  "homework_new",
  "homework_due2",
  "homework_due0",
  "feedback",
  "assistant_queue",
  "conductor_queue",
  "repertoire",
  "ticket_new",
  "ticket_urgent",
  "ticket_assigned",
  "ticket_comment",
  "ticket_moved",
  "tickets_due",
  "dues_open",
  "dues_late",
  "budget_new",
  "budget_approved",
  "budget_revised",
  "backup_failed",
  "storage_80",
  "storage_95",
  "test",
  "morning",
] as const;
export type Kind = (typeof KINDS)[number];

export function kindOrder(kind: string) {
  const i = (KINDS as readonly string[]).indexOf(kind);
  return i < 0 ? KINDS.length : i;
}

export type Item = {
  userId: string;
  kind: Kind;
  group: PushGroup | null;
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  line: string | null;
  expiresAt: Date;
  urgent?: boolean;
  /** Morning lines wait for the release step even for people without quiet hours. */
  morning?: boolean;
};

export const TITLE_MAX = 40;
export const BODY_MAX = 140;
export const LINE_MAX = 70;

/** Cuts to `max` characters (code points), ending with "…" when cut; line breaks survive. */
export function cut(s: string, max: number) {
  const chars = [...s.replace(/[^\S\n]+/g, " ").trim()];
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Ticket titles are cut to 60 characters plus "…" (§4). */
export function ticketTitle(s: string) {
  const chars = [...s.replace(/\s+/g, " ").trim()];
  return chars.length <= 60 ? chars.join("") : `${chars.slice(0, 60).join("").trimEnd()}…`;
}

const weekdayShort = formatter({ weekday: "short" });
const shortDay = formatter({ day: "numeric", month: "short" });
const weekdayLong = formatter({ weekday: "long" });

/** {gün}: "Çar 29 Eki" (tr-TR alone would say "29 Eki Çar"). */
export const gun = (at: Date) => `${weekdayShort.format(at)} ${shortDay.format(at)}`;
/** {saat}: "19:30". */
export const saat = (at: Date) => istanbulTimeOf(at);
export const kisaGun = (at: Date) => shortDay.format(at);
export const haftaninGunu = (at: Date) => weekdayLong.format(at);
/** " · {yer}" or nothing. */
export const yerDot = (yer: string | null) => (yer ? ` · ${yer}` : "");

export const DAY_MS = 24 * 3600_000;
