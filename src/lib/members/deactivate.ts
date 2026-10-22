import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Q } from "@/db/write-tx";
import { invites, sessions, users } from "@/db/schema";

/** What "Pasifleştir" writes: inactive with `leftAt`, every session closed, unused links gone. */
export function deactivateQueries(q: Q, userId: string, leftAt: Date) {
  return [
    q.update(users).set({ isActive: false, leftAt }).where(eq(users.id, userId)),
    q.delete(sessions).where(eq(sessions.userId, userId)),
    q.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usedAt))),
  ] as const;
}
