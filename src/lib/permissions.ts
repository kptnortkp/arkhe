import type { Role } from "@/db/schema";

export function isManager(role: Role) {
  return role === "conductor" || role === "board";
}

/** Recipients and manual sends decide where every member's data goes: conductor only. */
export function canManageBackup(role: Role) {
  return role === "conductor";
}

/** Reset links bypass the current password, so only the conductor may issue them for managers. */
export function canIssueLink(
  actor: { id: string; role: Role },
  target: { id: string; role: Role },
) {
  if (actor.id === target.id || !isManager(actor.role)) return false;
  return actor.role === "conductor" || target.role === "member";
}

/** Whether `actor` may edit `target` and give them `nextRole`. Board manages choristers only. */
export function canEditMember(
  actor: { id: string; role: Role },
  target: { id: string; role: Role },
  nextRole: Role,
) {
  if (!isManager(actor.role)) return false;
  // Nobody changes their own role; prevents locking the choir out by accident.
  if (actor.id === target.id && nextRole !== target.role) return false;
  if (actor.role === "conductor") return true;
  return target.role === "member" && nextRole === "member";
}

/** The opener or the conductor; the server re-checks this inside the delete statement. */
export function canDeleteTicket(actor: { id: string; role: Role }, ticket: { createdBy: string }) {
  return isManager(actor.role) && (ticket.createdBy === actor.id || actor.role === "conductor");
}

/** Own comments only, for 15 minutes after posting; nobody else, the conductor included. */
export function canDeleteComment(
  actor: { id: string },
  entry: { kind: string; actorId: string; createdAt: Date },
  at: Date,
) {
  return (
    entry.kind === "comment" &&
    entry.actorId === actor.id &&
    at.getTime() - entry.createdAt.getTime() < 15 * 60_000
  );
}
