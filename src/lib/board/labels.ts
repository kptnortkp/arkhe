// Board codes, Turkish labels and URL slugs. Shared by schema.ts (CHECKs), server and client; no Node APIs.
export const TICKET_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TICKET_URGENCIES = ["low", "medium", "high", "urgent"] as const;
export const TICKET_EVENT_KINDS = [
  "created",
  "status",
  "assignee",
  "urgency",
  "due",
  "comment",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketUrgency = (typeof TICKET_URGENCIES)[number];
export type TicketEventKind = (typeof TICKET_EVENT_KINDS)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  todo: "Yapılacak",
  in_progress: "Devam ediyor",
  blocked: "Takıldı",
  done: "Bitti",
};

export const URGENCY_LABELS: Record<TicketUrgency, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  urgent: "Acil",
};

/** `?sutun=` values. */
export const SUTUN_SLUGS: Record<TicketStatus, string> = {
  todo: "yapilacak",
  in_progress: "devam",
  blocked: "takildi",
  done: "bitti",
};

/** `?aciliyet=` values. */
export const ACILIYET_SLUGS: Record<TicketUrgency, string> = {
  low: "dusuk",
  medium: "orta",
  high: "yuksek",
  urgent: "acil",
};

/** Column order on the board, and urgency order inside a column (most urgent first). */
export const URGENCY_RANK: Record<TicketUrgency, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function fromSlug<K extends string>(map: Record<K, string>, slug: unknown): K | null {
  if (typeof slug !== "string") return null;
  for (const key of Object.keys(map) as K[]) if (map[key] === slug) return key;
  return null;
}

export const statusFromSlug = (slug: unknown) => fromSlug(SUTUN_SLUGS, slug);
export const urgencyFromSlug = (slug: unknown) => fromSlug(ACILIYET_SLUGS, slug);

export type BoardFilters = {
  column: TicketStatus;
  kim: "herkes" | "ben";
  urgency: TicketUrgency | null;
};

/** Whitelist parse of the board's search params; anything unknown means "no filter" (AC 9). */
export function parseBoardFilters(params: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (typeof params[k] === "string" ? params[k] : undefined);
  return {
    column: statusFromSlug(one("sutun")) ?? "todo",
    kim: one("kim") === "ben" ? "ben" : "herkes",
    urgency: urgencyFromSlug(one("aciliyet")),
  } satisfies BoardFilters;
}
