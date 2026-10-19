import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { duesOverrides, duesPeriods, financeEntries, memberDues, users } from "@/db/schema";
import { owedFor, owesPeriod } from "./dues";

export type { Tx } from "@/db/write-tx";
import type { Tx } from "@/db/write-tx";

/** Deterministic v8 uuid, so replaying one multi-period payment yields the same row ids. */
export function derivedId(...parts: string[]) {
  const hex = createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** What one member owes and has paid per period, read inside the caller's transaction. */
export async function duesPosition(tx: Tx, memberId: string, periodIds?: string[]) {
  const [member] = await tx
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
      rate: memberDues.rate,
    })
    .from(users)
    .leftJoin(memberDues, eq(memberDues.userId, users.id))
    .where(eq(users.id, memberId));
  if (!member) return null;
  const periods = await tx
    .select()
    .from(duesPeriods)
    .where(periodIds ? inArray(duesPeriods.id, periodIds) : undefined);
  const overrides = await tx.select().from(duesOverrides).where(eq(duesOverrides.userId, memberId));
  const paid = await tx
    .select({
      periodId: financeEntries.duesPeriodId,
      total: sql<number>`sum(${financeEntries.amountKurus})`,
    })
    .from(financeEntries)
    .where(
      and(
        eq(financeEntries.memberId, memberId),
        eq(financeEntries.category, "dues"),
        isNull(financeEntries.voidedAt),
      ),
    )
    .groupBy(financeEntries.duesPeriodId);
  const rate = member.rate ?? "standard";
  const paidOf = new Map(paid.map((p) => [p.periodId, Number(p.total)]));
  const overrideOf = new Map(overrides.map((o) => [o.duesPeriodId, o]));
  return {
    member: { ...member, rate },
    periods: periods.map((p) => {
      const paidKurus = paidOf.get(p.id) ?? 0;
      const override = overrideOf.get(p.id) ?? null;
      const owed = owedFor(rate, p, override, paidKurus);
      return {
        period: p,
        override,
        onRoster: owesPeriod(member, p) || paidKurus > 0,
        owed,
        paid: paidKurus,
        remaining: Math.max(owed - paidKurus, 0),
      };
    }),
  };
}

/** The live opening date; nothing may be dated before it. */
export async function openingDate(tx: Tx) {
  const [row] = await tx
    .select({ on: sql<string | null>`min(${financeEntries.occurredOn})` })
    .from(financeEntries)
    .where(and(eq(financeEntries.kind, "opening"), isNull(financeEntries.voidedAt)));
  return row?.on ?? null;
}
