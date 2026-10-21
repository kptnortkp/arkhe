import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/db";
import {
  appSettings,
  duesOverrides,
  duesPeriods,
  events,
  memberDues,
  rehearsals,
  sponsors,
  users,
} from "@/db/schema";
import { requireManager, requireUser } from "@/lib/auth/dal";
import { collator } from "@/lib/format";
import { monthRange, yearRange } from "@/lib/finance/dates";
import { addDays, formatAuditDate, istanbulDateOf, now } from "@/lib/time";
import type { Account, Category, EntryKind } from "./categories";
import { duesStatus, owedFor, owesPeriod, type DuesPeriodLike, type DuesStatus } from "./dues";
import {
  creator,
  entryColumns,
  fe,
  inRange,
  ledgerRowsBetween,
  live,
  loadDuesMatrix,
  member,
  monthTotals,
  num,
  periodColumns,
  type DuesMemberRow,
} from "./queries-internal";

export type { DuesCell, DuesMemberRow, DuesPeriod } from "./queries-internal";

/** Signed effect of a row on one account: openings and income add, expenses and outgoing transfers subtract. */
function signed(account: Account) {
  return sql<number>`coalesce(sum(case
    when ${fe.account} = ${account} and ${fe.kind} in ('opening', 'income') then ${fe.amountKurus}
    when ${fe.account} = ${account} and ${fe.kind} in ('expense', 'transfer') then -${fe.amountKurus}
    when ${fe.toAccount} = ${account} then ${fe.amountKurus}
    else 0 end), 0)`;
}

export function todayIstanbul() {
  return istanbulDateOf(now());
}

export const balances = cache(async () => {
  await requireManager();
  const [row] = await db
    .select({
      cash: signed("cash"),
      bank: signed("bank"),
      last: sql<string | null>`max(${fe.occurredOn})`,
    })
    .from(fe)
    .where(live);
  const cash = num(row?.cash);
  const bank = num(row?.bank);
  return { cash, bank, total: cash + bank, lastEntryOn: row?.last ?? null };
});

/** Income and expense of a month; transfers and openings never count. */
export async function monthSummary(month: string) {
  await requireManager();
  return monthTotals(month);
}

// ---------- Ledger ----------

export type LedgerFilters = {
  month?: string;
  kind?: "income" | "expense" | "transfer";
  category?: Category;
  account?: Account;
  eventId?: string;
  sponsorId?: string;
  undocumented?: boolean;
  voided?: boolean;
};

export const LEDGER_CAP = 200;

export type EntryRow = Awaited<ReturnType<typeof listEntries>>["rows"][number];

export async function listEntries(f: LedgerFilters) {
  await requireManager();
  const where = [
    f.voided ? isNotNull(fe.voidedAt) : live,
    f.month && monthRange(f.month) ? inRange(monthRange(f.month)) : undefined,
    f.kind ? eq(fe.kind, f.kind) : undefined,
    f.category ? eq(fe.category, f.category) : undefined,
    f.account ? or(eq(fe.account, f.account), eq(fe.toAccount, f.account)) : undefined,
    f.eventId ? eq(fe.eventId, f.eventId) : undefined,
    f.sponsorId ? eq(fe.sponsorId, f.sponsorId) : undefined,
    f.undocumented ? and(eq(fe.kind, "expense"), isNull(fe.documentUrl)) : undefined,
  ];
  const rows = await db
    .select(entryColumns)
    .from(fe)
    .leftJoin(sponsors, eq(sponsors.id, fe.sponsorId))
    .leftJoin(events, eq(events.id, fe.eventId))
    .leftJoin(member, eq(member.id, fe.memberId))
    .leftJoin(duesPeriods, eq(duesPeriods.id, fe.duesPeriodId))
    .where(and(...where))
    .orderBy(desc(fe.occurredOn), desc(fe.createdAt))
    .limit(LEDGER_CAP + 1);
  return { rows: rows.slice(0, LEDGER_CAP), capped: rows.length > LEDGER_CAP };
}

export async function recentEntries(limit = 10) {
  await requireManager();
  return db
    .select(entryColumns)
    .from(fe)
    .leftJoin(sponsors, eq(sponsors.id, fe.sponsorId))
    .leftJoin(events, eq(events.id, fe.eventId))
    .leftJoin(member, eq(member.id, fe.memberId))
    .leftJoin(duesPeriods, eq(duesPeriods.id, fe.duesPeriodId))
    .where(live)
    .orderBy(desc(fe.occurredOn), desc(fe.createdAt))
    .limit(limit);
}

export async function undocumentedCount() {
  await requireManager();
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(fe)
    .where(and(live, eq(fe.kind, "expense"), isNull(fe.documentUrl)));
  return num(row?.n);
}

const updater = alias(users, "updater");
const voider = alias(users, "voider");

export async function getEntry(id: string) {
  await requireManager();
  const [row] = await db
    .select({
      ...entryColumns,
      sponsorId: fe.sponsorId,
      eventId: fe.eventId,
      memberId: fe.memberId,
      duesPeriodId: fe.duesPeriodId,
      paymentGroupId: fe.paymentGroupId,
      replacesId: fe.replacesId,
      revision: fe.revision,
      createdAt: fe.createdAt,
      updatedAt: fe.updatedAt,
      voidReason: fe.voidReason,
      creatorName: creator.name,
      updaterName: updater.name,
      voiderName: voider.name,
    })
    .from(fe)
    .leftJoin(sponsors, eq(sponsors.id, fe.sponsorId))
    .leftJoin(events, eq(events.id, fe.eventId))
    .leftJoin(member, eq(member.id, fe.memberId))
    .leftJoin(duesPeriods, eq(duesPeriods.id, fe.duesPeriodId))
    .leftJoin(creator, eq(creator.id, fe.createdBy))
    .leftJoin(updater, eq(updater.id, fe.updatedBy))
    .leftJoin(voider, eq(voider.id, fe.voidedBy))
    .where(eq(fe.id, id));
  if (!row) return null;
  const linkColumns = {
    id: fe.id,
    amountKurus: fe.amountKurus,
    occurredOn: fe.occurredOn,
    kind: fe.kind,
  };
  const [[replaces], [replacedBy], siblings] = await Promise.all([
    row.replacesId ? db.select(linkColumns).from(fe).where(eq(fe.id, row.replacesId)) : [],
    db.select(linkColumns).from(fe).where(eq(fe.replacesId, id)),
    row.paymentGroupId
      ? db
          .select({ id: fe.id, periodName: duesPeriods.name })
          .from(fe)
          .innerJoin(duesPeriods, eq(duesPeriods.id, fe.duesPeriodId))
          .where(and(eq(fe.paymentGroupId, row.paymentGroupId), live))
          .orderBy(asc(duesPeriods.startsOn))
      : [],
  ]);
  return { ...row, replaces: replaces ?? null, replacedBy: replacedBy ?? null, siblings };
}

// ---------- Events and sponsors ----------

const netSql = sql<number>`coalesce(sum(case when ${fe.kind} = 'income' then ${fe.amountKurus} when ${fe.kind} = 'expense' then -${fe.amountKurus} else 0 end), 0)`;

export async function eventOptions() {
  await requireManager();
  return db
    .select({ id: events.id, name: events.name })
    .from(events)
    .orderBy(desc(events.startsOn), asc(events.name));
}

export async function listEvents() {
  await requireManager();
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      startsOn: events.startsOn,
      net: netSql,
      count: sql<number>`count(${fe.id})`,
    })
    .from(events)
    .leftJoin(fe, and(eq(fe.eventId, events.id), live))
    .groupBy(events.id)
    .orderBy(desc(events.startsOn));
  return rows.map((r) => ({ ...r, net: num(r.net), count: num(r.count) }));
}

export async function getEvent(id: string) {
  await requireManager();
  const [event] = await db
    .select({
      id: events.id,
      name: events.name,
      startsOn: events.startsOn,
      rehearsalId: events.rehearsalId,
      rehearsalTitle: rehearsals.title,
    })
    .from(events)
    .leftJoin(rehearsals, eq(rehearsals.id, events.rehearsalId))
    .where(eq(events.id, id));
  if (!event) return null;
  const lines = await db
    .select({ kind: fe.kind, category: fe.category, total: sql<number>`sum(${fe.amountKurus})` })
    .from(fe)
    .where(and(eq(fe.eventId, id), live))
    .groupBy(fe.kind, fe.category);
  const income = lines.filter((l) => l.kind === "income");
  const expense = lines.filter((l) => l.kind === "expense");
  const sum = (ls: typeof lines) => ls.reduce((s, l) => s + num(l.total), 0);
  const [anyEntry] = await db.select({ id: fe.id }).from(fe).where(eq(fe.eventId, id)).limit(1);
  return {
    ...event,
    income: income.map((l) => ({ category: l.category!, total: num(l.total) })),
    expense: expense.map((l) => ({ category: l.category!, total: num(l.total) })),
    net: sum(income) - sum(expense),
    hasEntries: Boolean(anyEntry),
  };
}

/** Concerts in the last year or ahead that no event points at yet. */
export async function concertsWithoutEvent() {
  await requireManager();
  return db
    .select({ id: rehearsals.id, title: rehearsals.title, startsAt: rehearsals.startsAt })
    .from(rehearsals)
    .leftJoin(events, eq(events.rehearsalId, rehearsals.id))
    .where(
      and(
        eq(rehearsals.type, "concert"),
        isNull(rehearsals.cancelledAt),
        isNull(events.id),
        gte(rehearsals.startsAt, new Date(now().getTime() - 365 * 86_400_000)),
      ),
    )
    .orderBy(asc(rehearsals.startsAt));
}

export async function sponsorOptions() {
  await requireManager();
  return db
    .select({ id: sponsors.id, name: sponsors.name, isActive: sponsors.isActive })
    .from(sponsors)
    .orderBy(asc(sponsors.nameKey));
}

export async function listSponsors(year: string) {
  await requireManager();
  const rows = await db
    .select({
      id: sponsors.id,
      name: sponsors.name,
      contactName: sponsors.contactName,
      isActive: sponsors.isActive,
      total: sql<number>`coalesce(sum(case when ${inRange(yearRange(year))} then ${fe.amountKurus} else 0 end), 0)`,
    })
    .from(sponsors)
    .leftJoin(fe, and(eq(fe.sponsorId, sponsors.id), live))
    .groupBy(sponsors.id);
  return rows
    .map((r) => ({ ...r, total: num(r.total) }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

export async function getSponsor(id: string) {
  await requireManager();
  const [sponsor] = await db.select().from(sponsors).where(eq(sponsors.id, id));
  if (!sponsor) return null;
  const years = await db
    .select({
      year: sql<string>`substr(${fe.occurredOn}, 1, 4)`,
      total: sql<number>`sum(${fe.amountKurus})`,
    })
    .from(fe)
    .where(and(eq(fe.sponsorId, id), live))
    .groupBy(sql`1`)
    .orderBy(desc(sql`1`));
  return { ...sponsor, years: years.map((y) => ({ year: y.year, total: num(y.total) })) };
}

// ---------- Report ----------

export type ReportView = "total" | Account;

export async function reportYears() {
  await requireManager();
  const rows = await db
    .selectDistinct({ year: sql<string>`substr(${fe.occurredOn}, 1, 4)` })
    .from(fe)
    .where(live);
  const years = new Set(rows.map((r) => r.year));
  years.add(todayIstanbul().slice(0, 4));
  return [...years].sort().reverse();
}

export type ReportRow = {
  month: string;
  carry: number;
  income: number;
  expense: number;
  transfer: number;
  net: number;
  closing: number;
};

/** One row per month: Devir (incl. that month's openings), Gelir, Gider, Virman (per account), Kapanış. */
export async function monthlyReport(year: string, view: ReportView) {
  await requireManager();
  const accounts: Account[] = view === "total" ? ["cash", "bank"] : [view];
  const inView = (column: typeof fe.account | typeof fe.toAccount) => inArray(column, accounts);
  const y0 = `${year}-01-01`;
  const [before] = await db
    .select(
      view === "total"
        ? { v: sql<number>`${signed("cash")} + ${signed("bank")}` }
        : { v: signed(view) },
    )
    .from(fe)
    .where(and(live, lt(fe.occurredOn, y0)));
  const rows = await db
    .select({
      month: sql<string>`substr(${fe.occurredOn}, 1, 7)`,
      opening: sql<number>`coalesce(sum(case when ${fe.kind} = 'opening' and ${inView(fe.account)} then ${fe.amountKurus} else 0 end), 0)`,
      income: sql<number>`coalesce(sum(case when ${fe.kind} = 'income' and ${inView(fe.account)} then ${fe.amountKurus} else 0 end), 0)`,
      expense: sql<number>`coalesce(sum(case when ${fe.kind} = 'expense' and ${inView(fe.account)} then ${fe.amountKurus} else 0 end), 0)`,
      transfer: sql<number>`coalesce(sum(case when ${fe.kind} <> 'transfer' then 0
        when ${inView(fe.account)} and ${inView(fe.toAccount)} then 0
        when ${inView(fe.toAccount)} then ${fe.amountKurus}
        when ${inView(fe.account)} then -${fe.amountKurus} else 0 end), 0)`,
    })
    .from(fe)
    .where(and(live, gte(fe.occurredOn, y0), lte(fe.occurredOn, `${year}-12-31`)))
    .groupBy(sql`1`);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const thisMonth = todayIstanbul().slice(0, 7);
  const months = [...byMonth.keys()].sort();
  const carry0 = num(before?.v);
  // From January, or from the first month with data when nothing came before the year.
  let first = `${year}-01`;
  if (carry0 === 0 && months.length) first = months[0];
  let last =
    year < thisMonth.slice(0, 4)
      ? `${year}-12`
      : thisMonth.slice(0, 4) === year
        ? thisMonth
        : first;
  if (months.length && months[months.length - 1] > last) last = months[months.length - 1];
  if (!months.length && carry0 === 0) return { rows: [] as ReportRow[], totals: null };

  const out: ReportRow[] = [];
  let closing = carry0;
  for (let m = first; m <= last; m = nextMonth(m)) {
    const r = byMonth.get(m);
    const carry = closing + num(r?.opening);
    const income = num(r?.income);
    const expense = num(r?.expense);
    const transfer = num(r?.transfer);
    closing = carry + income - expense + transfer;
    out.push({ month: m, carry, income, expense, transfer, net: income - expense, closing });
  }
  const totals = {
    income: out.reduce((s, r) => s + r.income, 0),
    expense: out.reduce((s, r) => s + r.expense, 0),
    transfer: out.reduce((s, r) => s + r.transfer, 0),
    closing,
  };
  return { rows: out.reverse(), totals };
}

export function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function categoryTotals(year: string, month?: string) {
  await requireManager();
  const rows = await db
    .select({ kind: fe.kind, category: fe.category, total: sql<number>`sum(${fe.amountKurus})` })
    .from(fe)
    .where(
      and(
        live,
        inArray(fe.kind, ["income", "expense"]),
        inRange(month ? monthRange(month) : yearRange(year)),
      ),
    )
    .groupBy(fe.kind, fe.category)
    .orderBy(desc(sql`3`));
  const pick = (kind: EntryKind) =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => ({ category: r.category!, total: num(r.total) }));
  return { income: pick("income"), expense: pick("expense") };
}

/** Ledger rows for the accountant's CSV, oldest first. */
export async function csvEntries(from: string, to: string) {
  await requireManager();
  return ledgerRowsBetween(from, to);
}

// ---------- Settings ----------

export async function getPaymentInfo() {
  await requireUser();
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "dues_payment_info"));
  return row?.value ?? null;
}

export async function openingState() {
  await requireManager();
  const openings = await db
    .select({ account: fe.account, amountKurus: fe.amountKurus, occurredOn: fe.occurredOn })
    .from(fe)
    .where(and(live, eq(fe.kind, "opening")));
  const [first] = await db
    .select({ on: sql<string | null>`min(${fe.occurredOn})` })
    .from(fe)
    .where(and(live, sql`${fe.kind} <> 'opening'`));
  return {
    date: openings[0]?.occurredOn ?? null,
    cash: openings.find((o) => o.account === "cash")?.amountKurus ?? 0,
    bank: openings.find((o) => o.account === "bank")?.amountKurus ?? 0,
    firstEntryOn: first?.on ?? null,
  };
}

// ---------- Dues ----------

/** Current period: the one containing today, else the latest past one, else the earliest ahead. */
export function currentPeriodOf<P extends DuesPeriodLike>(periods: P[], today: string) {
  const sorted = [...periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return (
    sorted.find((p) => p.startsOn <= today && p.endsOn >= today) ??
    sorted.filter((p) => p.endsOn < today).at(-1) ??
    sorted.find((p) => p.startsOn > today) ??
    null
  );
}

export async function listPeriods() {
  await requireManager();
  return db.select(periodColumns).from(duesPeriods).orderBy(asc(duesPeriods.startsOn));
}

/** Members × periods, three flat queries; statuses are computed here, never stored. */
export const duesMatrix = cache(async (today: string) => {
  await requireManager();
  return loadDuesMatrix(today);
});

export function periodSummary(members: DuesMemberRow[], periodId: string) {
  const cells = members.flatMap((m) => {
    const c = m.cells.get(periodId);
    return c ? [c] : [];
  });
  const owing = cells.filter((c) => c.status.state !== "exempt");
  return {
    expected: owing.reduce((s, c) => s + c.status.owed, 0),
    collected: cells.reduce((s, c) => s + c.status.paid, 0),
    paidCount: owing.filter((c) => c.status.state === "paid").length,
    owingCount: owing.length,
    partial: owing.filter((c) => c.status.state === "partial").length,
    overdue: owing.filter((c) => c.status.state === "overdue").length,
    unpaid: owing.filter((c) => c.status.state === "unpaid").length,
    exempt: cells.length - owing.length,
    debtors: owing.filter((c) => c.status.remaining > 0).length,
  };
}

/** A manager's view of one member's payments (for the member sheet). */
export async function memberPayments(userId: string) {
  await requireManager();
  return db
    .select({
      id: fe.id,
      occurredOn: fe.occurredOn,
      amountKurus: fe.amountKurus,
      account: fe.account,
      periodName: duesPeriods.name,
    })
    .from(fe)
    .innerJoin(duesPeriods, eq(duesPeriods.id, fe.duesPeriodId))
    .where(and(live, eq(fe.memberId, userId), eq(fe.category, "dues")))
    .orderBy(desc(fe.occurredOn), desc(fe.createdAt));
}

/**
 * "Son değişiklik" lines for one member's rate and waivers, as finished strings.
 * Managers only; kept out of duesMatrix so editor names never reach client props or the CSV.
 */
export async function duesAuditOf(userId: string) {
  await requireManager();
  if (!z.uuid().safeParse(userId).success) return null;
  const editor = alias(users, "editor");
  const [[rate], waivers] = await Promise.all([
    db
      .select({ at: memberDues.updatedAt, name: editor.name })
      .from(memberDues)
      .leftJoin(editor, eq(editor.id, memberDues.updatedBy))
      .where(eq(memberDues.userId, userId)),
    db
      .select({
        periodId: duesOverrides.duesPeriodId,
        at: duesOverrides.createdAt,
        name: editor.name,
      })
      .from(duesOverrides)
      .leftJoin(editor, eq(editor.id, duesOverrides.createdBy))
      .where(and(eq(duesOverrides.userId, userId), eq(duesOverrides.kind, "waiver"))),
  ]);
  const line = (r: { at: Date; name: string | null }) =>
    `Son değişiklik: ${r.name ?? "silinmiş üye"} · ${formatAuditDate(r.at)}`;
  return {
    rate: rate ? line(rate) : null,
    waivers: new Map(waivers.map((w) => [w.periodId, line(w)])),
  };
}

/** Home card for managers: balances, this month and the current period's debtors. */
export async function kasaSummary() {
  const today = todayIstanbul();
  const [b, month, matrix] = await Promise.all([
    balances(),
    monthSummary(today.slice(0, 7)),
    duesMatrix(today),
  ]);
  const current = currentPeriodOf(matrix.periods, today);
  const debtors = current ? periodSummary(matrix.members, current.id).debtors : 0;
  return { ...b, month, current, debtors };
}

export type MyDuesRow = {
  id: string;
  name: string;
  dueOn: string;
  owed: number;
  reduced: boolean;
  waived: boolean;
  status: DuesStatus;
};

/**
 * The session user's own dues. Takes no id on purpose; never selects notes, override reasons
 * or anyone else's rows.
 */
export const myDues = cache(async () => {
  const user = await requireUser();
  if (user.role === "conductor") return null;
  const today = todayIstanbul();
  const [[me], periods, overrides, paid, payments] = await Promise.all([
    db
      .select({
        role: users.role,
        joinedAt: users.joinedAt,
        leftAt: users.leftAt,
        rate: memberDues.rate,
      })
      .from(users)
      .leftJoin(memberDues, eq(memberDues.userId, users.id))
      .where(eq(users.id, user.id)),
    db.select(periodColumns).from(duesPeriods).orderBy(desc(duesPeriods.startsOn)),
    db
      .select({
        periodId: duesOverrides.duesPeriodId,
        kind: duesOverrides.kind,
        owedKurus: duesOverrides.owedKurus,
      })
      .from(duesOverrides)
      .where(eq(duesOverrides.userId, user.id)),
    db
      .select({ periodId: fe.duesPeriodId, total: sql<number>`sum(${fe.amountKurus})` })
      .from(fe)
      .where(and(live, eq(fe.memberId, user.id), eq(fe.category, "dues")))
      .groupBy(fe.duesPeriodId),
    db
      .select({
        id: fe.id,
        occurredOn: fe.occurredOn,
        amountKurus: fe.amountKurus,
        periodName: duesPeriods.name,
      })
      .from(fe)
      .innerJoin(duesPeriods, eq(duesPeriods.id, fe.duesPeriodId))
      .where(and(live, eq(fe.memberId, user.id), eq(fe.category, "dues")))
      .orderBy(desc(fe.occurredOn), desc(fe.createdAt)),
  ]);
  if (!me) return null;
  const rate = me.rate ?? "standard";
  const overrideOf = new Map(overrides.map((o) => [o.periodId, o]));
  const paidOf = new Map(paid.map((p) => [p.periodId, num(p.total)]));
  const yearAgo = addDays(today, -365);
  const rows: MyDuesRow[] = [];
  for (const p of periods) {
    const paidKurus = paidOf.get(p.id) ?? 0;
    if (!owesPeriod(me, p) && paidKurus === 0) continue;
    const o = overrideOf.get(p.id);
    const owed = owedFor(rate, p, o ?? null, paidKurus);
    const status = duesStatus(owed, paidKurus, p.dueOn, today);
    if (p.endsOn < yearAgo && status.remaining === 0) continue;
    rows.push({
      id: p.id,
      name: p.name,
      dueOn: p.dueOn,
      owed,
      reduced: !o && rate === "reduced" && p.reducedAmountKurus !== null,
      waived: o?.kind === "waiver",
      status,
    });
  }
  const remaining = rows.reduce((s, r) => s + r.status.remaining, 0);
  return { exempt: rate === "exempt", remaining, rows, payments };
});
