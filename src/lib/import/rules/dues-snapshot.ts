import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { duesOverrides, duesPeriods, financeEntries, memberDues, users } from "@/db/schema";
import { positionOf } from "@/lib/finance/dues";
import type { BatchDb } from "../tx";

/** Users with what the dues and roster rules need; one select for the whole file. */
export const usersRead = (q: BatchDb) =>
  q
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      voicePart: users.voicePart,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
      isActive: users.isActive,
      hasPassword: sql<number>`${users.passwordHash} is not null`,
    })
    .from(users);

export const duesReads = (q: BatchDb) => ({
  memberDues: q.select().from(memberDues),
  periods: q.select().from(duesPeriods),
  overrides: q.select().from(duesOverrides),
  paid: q
    .select({
      memberId: financeEntries.memberId,
      periodId: financeEntries.duesPeriodId,
      total: sql<number>`sum(${financeEntries.amountKurus})`,
    })
    .from(financeEntries)
    .where(and(eq(financeEntries.category, "dues"), isNull(financeEntries.voidedAt)))
    .groupBy(financeEntries.memberId, financeEntries.duesPeriodId),
});

type DuesSnap = {
  memberDues: (typeof memberDues.$inferSelect)[];
  periods: (typeof duesPeriods.$inferSelect)[];
  overrides: (typeof duesOverrides.$inferSelect)[];
  paid: { memberId: string | null; periodId: string | null; total: number }[];
};

/** Per-member lookups, so positionOf runs per row without another query. */
export function duesIndex(snap: DuesSnap) {
  const rateOf = new Map(snap.memberDues.map((m) => [m.userId, m]));
  const overridesOf = new Map<string, Map<string, (typeof snap.overrides)[number]>>();
  for (const o of snap.overrides) {
    if (!overridesOf.has(o.userId)) overridesOf.set(o.userId, new Map());
    overridesOf.get(o.userId)!.set(o.duesPeriodId, o);
  }
  const paidOf = new Map<string, Map<string, number>>();
  for (const p of snap.paid) {
    if (!p.memberId || !p.periodId) continue;
    if (!paidOf.has(p.memberId)) paidOf.set(p.memberId, new Map());
    paidOf.get(p.memberId)!.set(p.periodId, Number(p.total));
  }
  return {
    rateOf,
    overridesOf: (userId: string) => overridesOf.get(userId) ?? new Map(),
    paidOf: (userId: string) => paidOf.get(userId) ?? new Map<string, number>(),
    position(
      member: { id: string; role: (typeof users.$inferSelect)["role"]; joinedAt: Date; leftAt: Date | null },
      periods = snap.periods,
    ) {
      return positionOf(
        { ...member, rate: rateOf.get(member.id)?.rate ?? null },
        periods,
        overridesOf.get(member.id) ?? new Map(),
        paidOf.get(member.id) ?? new Map(),
      );
    },
  };
}
