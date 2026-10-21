import "server-only";
// Unguarded finance reads. Only src/lib/finance/queries.ts and src/lib/backup/* may import this
// module; every caller must authorize first.
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import {
  duesOverrides,
  duesPeriods,
  events,
  financeEntries,
  memberDues,
  sponsors,
  users,
  VOICE_PARTS,
  type VoicePart,
} from "@/db/schema";
import { collator } from "@/lib/format";
import { monthRange } from "@/lib/finance/dates";
import type { DuesRate } from "./categories";
import {
  duesStatus,
  owedFor,
  owesPeriod,
  type DuesOverride,
  type DuesPeriodLike,
  type DuesStatus,
} from "./dues";

export const fe = financeEntries;
export const live = isNull(fe.voidedAt);
export const num = (v: unknown) => Number(v ?? 0);

export const creator = alias(users, "creator");
export const member = alias(users, "member");

export const entryColumns = {
  id: fe.id,
  kind: fe.kind,
  category: fe.category,
  amountKurus: fe.amountKurus,
  occurredOn: fe.occurredOn,
  account: fe.account,
  toAccount: fe.toAccount,
  description: fe.description,
  counterparty: fe.counterparty,
  documentUrl: fe.documentUrl,
  voidedAt: fe.voidedAt,
  sponsorName: sponsors.name,
  eventName: events.name,
  memberName: member.name,
  periodName: duesPeriods.name,
};

/** occurred_on within [from, to); an invalid month or year matches nothing. */
export function inRange(range: [string, string] | null) {
  return range ? and(gte(fe.occurredOn, range[0]), lt(fe.occurredOn, range[1]))! : sql`0`;
}

/** Unguarded: callers must authorize first. Income and expense of a month; transfers and openings never count. */
export async function monthTotals(month: string) {
  const rows = await db
    .select({ kind: fe.kind, total: sql<number>`sum(${fe.amountKurus})` })
    .from(fe)
    .where(and(live, inArray(fe.kind, ["income", "expense"]), inRange(monthRange(month))))
    .groupBy(fe.kind);
  const income = num(rows.find((r) => r.kind === "income")?.total);
  const expense = num(rows.find((r) => r.kind === "expense")?.total);
  return { income, expense, net: income - expense };
}

/** Unguarded: callers must authorize first. Ledger rows for the accountant's CSV, oldest first, inclusive days. */
export async function ledgerRowsBetween(from: string, to: string) {
  return db
    .select({ ...entryColumns, creatorName: creator.name })
    .from(fe)
    .leftJoin(sponsors, eq(sponsors.id, fe.sponsorId))
    .leftJoin(events, eq(events.id, fe.eventId))
    .leftJoin(member, eq(member.id, fe.memberId))
    .leftJoin(duesPeriods, eq(duesPeriods.id, fe.duesPeriodId))
    .leftJoin(creator, eq(creator.id, fe.createdBy))
    .where(and(live, gte(fe.occurredOn, from), lte(fe.occurredOn, to)))
    .orderBy(asc(fe.occurredOn), asc(fe.createdAt));
}

// ---------- Dues ----------

export type DuesPeriod = DuesPeriodLike;

export type DuesCell = {
  period: DuesPeriod;
  status: DuesStatus;
  override: DuesOverride | null;
};

export type DuesMemberRow = {
  id: string;
  name: string;
  voicePart: VoicePart | null;
  left: boolean;
  rate: DuesRate;
  note: string | null;
  cells: Map<string, DuesCell>;
};

export const periodColumns = {
  id: duesPeriods.id,
  name: duesPeriods.name,
  startsOn: duesPeriods.startsOn,
  endsOn: duesPeriods.endsOn,
  dueOn: duesPeriods.dueOn,
  amountKurus: duesPeriods.amountKurus,
  reducedAmountKurus: duesPeriods.reducedAmountKurus,
};

/** Unguarded: callers must authorize first. Members × periods; statuses are computed here, never stored. */
export async function loadDuesMatrix(today: string) {
  const [periods, roster, overrides, paid] = await Promise.all([
    db.select(periodColumns).from(duesPeriods).orderBy(asc(duesPeriods.startsOn)),
    db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        voicePart: users.voicePart,
        joinedAt: users.joinedAt,
        leftAt: users.leftAt,
        rate: memberDues.rate,
        note: memberDues.note,
      })
      .from(users)
      .leftJoin(memberDues, eq(memberDues.userId, users.id))
      .where(inArray(users.role, ["member", "board"])),
    db.select().from(duesOverrides),
    db
      .select({
        memberId: fe.memberId,
        periodId: fe.duesPeriodId,
        total: sql<number>`sum(${fe.amountKurus})`,
      })
      .from(fe)
      .where(and(live, eq(fe.category, "dues")))
      .groupBy(fe.memberId, fe.duesPeriodId),
  ]);
  const overrideOf = new Map(overrides.map((o) => [`${o.duesPeriodId}:${o.userId}`, o]));
  const paidOf = new Map(paid.map((p) => [`${p.periodId}:${p.memberId}`, num(p.total)]));
  const members: DuesMemberRow[] = roster.map((u) => {
    const rate = u.rate ?? "standard";
    const cells = new Map<string, DuesCell>();
    for (const p of periods) {
      const key = `${p.id}:${u.id}`;
      const paidKurus = paidOf.get(key) ?? 0;
      if (!owesPeriod(u, p) && paidKurus === 0) continue;
      const o = overrideOf.get(key);
      const override = o ? { kind: o.kind, owedKurus: o.owedKurus, reason: o.reason } : null;
      const owed = owedFor(rate, p, override, paidKurus);
      cells.set(p.id, { period: p, override, status: duesStatus(owed, paidKurus, p.dueOn, today) });
    }
    return {
      id: u.id,
      name: u.name,
      voicePart: u.voicePart,
      left: u.leftAt !== null,
      rate,
      note: u.note,
      cells,
    };
  });
  const order = (p: VoicePart | null) => (p ? VOICE_PARTS.indexOf(p) : VOICE_PARTS.length);
  members.sort(
    (a, b) => order(a.voicePart) - order(b.voicePart) || collator.compare(a.name, b.name),
  );
  return { periods, members };
}
