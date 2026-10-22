import "server-only";
// Unguarded finance reads. Only src/lib/finance/queries.ts, src/lib/backup/* and src/lib/import/* may import this
// module; every caller must authorize first.
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import {
  budgetLines,
  budgetRevisionLines,
  budgetRevisions,
  budgets,
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
import { CATEGORIES, type Account, type Category, type DuesRate } from "./categories";
import type { BudgetStatus, PlanMap } from "./budget";
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

/** Signed effect of a row on one account: openings and income add, expenses and outgoing transfers subtract. */
export function signedBalance(account: Account) {
  return sql<number>`coalesce(sum(case
    when ${fe.account} = ${account} and ${fe.kind} in ('opening', 'income') then ${fe.amountKurus}
    when ${fe.account} = ${account} and ${fe.kind} in ('expense', 'transfer') then -${fe.amountKurus}
    when ${fe.toAccount} = ${account} then ${fe.amountKurus}
    else 0 end), 0)`;
}

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

// ---------- Budget ----------

/** Unguarded: callers must authorize first. Per-category income/expense actuals in [from, toExclusive). */
export async function categoryActuals(from: string, toExclusive: string): Promise<PlanMap> {
  const rows = await db
    .select({ category: fe.category, total: sql<number>`sum(${fe.amountKurus})` })
    .from(fe)
    .where(and(live, inArray(fe.kind, ["income", "expense"]), inRange([from, toExclusive])))
    .groupBy(fe.category);
  const out: PlanMap = {};
  for (const r of rows) if (r.category) out[r.category] = num(r.total);
  return out;
}

const approver = alias(users, "approver");

export const budgetColumns = {
  id: budgets.id,
  name: budgets.name,
  startMonth: budgets.startMonth,
  endMonth: budgets.endMonth,
  note: budgets.note,
  revision: budgets.revision,
  approvedAt: budgets.approvedAt,
  approverName: approver.name,
};

export type BudgetRow = {
  id: string;
  name: string;
  startMonth: string;
  endMonth: string;
  note: string | null;
  revision: number;
  status: BudgetStatus;
  approved: { name: string; at: Date } | null;
  plan: PlanMap;
};

function planOf(rows: { category: Category; amountKurus: number }[]) {
  const plan: PlanMap = {};
  for (const r of rows) plan[r.category] = r.amountKurus;
  return plan;
}

type BudgetSelect = {
  id: string;
  name: string;
  startMonth: string;
  endMonth: string;
  note: string | null;
  revision: number;
  approvedAt: Date | null;
  approverName: string | null;
};

function toBudget(b: BudgetSelect, plan: PlanMap): BudgetRow {
  return {
    id: b.id,
    name: b.name,
    startMonth: b.startMonth,
    endMonth: b.endMonth,
    note: b.note,
    revision: b.revision,
    status: b.approvedAt ? "approved" : "draft",
    approved: b.approvedAt ? { name: b.approverName ?? "", at: b.approvedAt } : null,
    plan,
  };
}

async function loadBudget(where: SQL | undefined) {
  const [b] = await db
    .select(budgetColumns)
    .from(budgets)
    .leftJoin(approver, eq(approver.id, budgets.approvedBy))
    .where(where)
    .orderBy(desc(budgets.startMonth))
    .limit(1);
  if (!b) return null;
  const lines = await db
    .select({ category: budgetLines.category, amountKurus: budgetLines.amountKurus })
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, b.id));
  return toBudget(b, planOf(lines));
}

/** Unguarded. A budget and its current plan. */
export async function budgetWithPlan(id: string) {
  return loadBudget(eq(budgets.id, id));
}

/** Unguarded. The budget whose 12 months contain `month` ("YYYY-MM"); at most one, by no-overlap. */
export async function budgetCovering(month: string) {
  return loadBudget(and(lte(budgets.startMonth, month), sql`${budgets.endMonth} > ${month}`));
}

/**
 * Unguarded. Every budget with its plan and its actuals over its own range, newest start first.
 * Entries on or after `capExclusive` (a plain day) don't count, so future-dated entries stay out.
 */
export async function allBudgets(capExclusive: string) {
  const [rows, lines, actuals] = await Promise.all([
    db
      .select(budgetColumns)
      .from(budgets)
      .leftJoin(approver, eq(approver.id, budgets.approvedBy))
      .orderBy(desc(budgets.startMonth)),
    db
      .select({
        budgetId: budgetLines.budgetId,
        category: budgetLines.category,
        amountKurus: budgetLines.amountKurus,
      })
      .from(budgetLines),
    // One query for all budgets: each one's range search uses fe_occurred_idx.
    db
      .select({
        budgetId: budgets.id,
        category: fe.category,
        total: sql<number>`sum(${fe.amountKurus})`,
      })
      .from(budgets)
      .innerJoin(
        fe,
        and(
          gte(fe.occurredOn, sql`${budgets.startMonth} || '-01'`),
          lt(fe.occurredOn, sql`${budgets.endMonth} || '-01'`),
          lt(fe.occurredOn, capExclusive),
          live,
          inArray(fe.kind, ["income", "expense"]),
        ),
      )
      .groupBy(budgets.id, fe.category),
  ]);
  return rows.map((b) => {
    const actual: PlanMap = {};
    for (const a of actuals)
      if (a.budgetId === b.id && a.category) actual[a.category] = num(a.total);
    return { ...toBudget(b, planOf(lines.filter((l) => l.budgetId === b.id))), actual };
  });
}

/** Unguarded. "Değişiklik geçmişi", newest first, changed lines in categories.ts order. */
export async function budgetHistory(id: string) {
  const actor = alias(users, "actor");
  const rows = await db
    .select({
      id: budgetRevisions.id,
      reason: budgetRevisions.reason,
      at: budgetRevisions.createdAt,
      by: actor.name,
      category: budgetRevisionLines.category,
      fromKurus: budgetRevisionLines.fromKurus,
      toKurus: budgetRevisionLines.toKurus,
    })
    .from(budgetRevisions)
    .innerJoin(actor, eq(actor.id, budgetRevisions.actorId))
    .leftJoin(budgetRevisionLines, eq(budgetRevisionLines.revisionId, budgetRevisions.id))
    .where(eq(budgetRevisions.budgetId, id))
    .orderBy(desc(budgetRevisions.id));
  const out: {
    id: number;
    by: string;
    at: Date;
    reason: string;
    changes: { category: Category; fromKurus: number; toKurus: number }[];
  }[] = [];
  for (const r of rows) {
    let entry = out.at(-1);
    if (entry?.id !== r.id) {
      entry = { id: r.id, by: r.by, at: r.at, reason: r.reason, changes: [] };
      out.push(entry);
    }
    if (r.category) {
      entry.changes.push({ category: r.category, fromKurus: r.fromKurus!, toKurus: r.toKurus! });
    }
  }
  for (const e of out) {
    e.changes.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  }
  return out;
}
