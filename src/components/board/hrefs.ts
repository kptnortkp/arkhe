import {
  ACILIYET_SLUGS,
  SUTUN_SLUGS,
  type TicketStatus,
  type TicketUrgency,
} from "@/lib/board/labels";

export type Filters = { kim: "herkes" | "ben"; urgency: TicketUrgency | null };

export function boardHref(column: TicketStatus, f: Filters, page = "/yonetim") {
  const q = new URLSearchParams({ sutun: SUTUN_SLUGS[column] });
  if (f.kim === "ben") q.set("kim", "ben");
  if (f.urgency) q.set("aciliyet", ACILIYET_SLUGS[f.urgency]);
  return `${page}?${q}`;
}

/** The kim/aciliyet part only, for the move toast's Göster link. */
export function filterQuery(f: Filters) {
  const q = new URLSearchParams();
  if (f.kim === "ben") q.set("kim", "ben");
  if (f.urgency) q.set("aciliyet", ACILIYET_SLUGS[f.urgency]);
  return q.toString();
}
