import type { Role } from "@/db/schema";

export function isManager(role: Role) {
  return role === "conductor" || role === "board";
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
