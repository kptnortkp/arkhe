import "server-only";
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, rehearsals } from "@/db/schema";
import { openUntil } from "./rehearsals";
import { unmarkedExpected } from "./roster";

/** Closes attendance and records every unmarked expected person as absent. Idempotent. */
export async function closeRehearsal(rehearsalId: string, closedAt = new Date()) {
  const absentees = await unmarkedExpected(rehearsalId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ openedAt: rehearsals.openedAt, closedAt: rehearsals.closedAt })
      .from(rehearsals)
      .where(eq(rehearsals.id, rehearsalId))
      .limit(1);
    if (!row || row.closedAt) return;
    const openedAt = row.openedAt ?? closedAt;
    await tx
      .update(rehearsals)
      .set({ openedAt, closedAt: closedAt < openedAt ? openedAt : closedAt })
      .where(and(eq(rehearsals.id, rehearsalId), isNull(rehearsals.closedAt)));
    if (absentees.length) {
      await tx
        .insert(attendance)
        .values(
          absentees.map((userId) => ({
            rehearsalId,
            userId,
            status: "absent" as const,
            method: "auto" as const,
            recordedAt: closedAt,
          })),
        )
        .onConflictDoNothing();
    }
  });
  return absentees.length;
}

/** Forgotten open rehearsals close themselves at the end of their Istanbul day, on next access. */
export async function autoCloseStale() {
  const now = new Date();
  const stale = await db
    .select({ id: rehearsals.id, startsAt: rehearsals.startsAt, endsAt: rehearsals.endsAt })
    .from(rehearsals)
    .where(
      and(
        isNotNull(rehearsals.openedAt),
        isNull(rehearsals.closedAt),
        lt(rehearsals.startsAt, now),
      ),
    );
  for (const r of stale) {
    const until = openUntil(r);
    if (until <= now) await closeRehearsal(r.id, until);
  }
}
