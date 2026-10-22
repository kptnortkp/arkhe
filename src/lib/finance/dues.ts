// Pure dues rules shared by the manager list, the member card, the CSV and the payment guard.
import { z } from "zod";
import type { Role } from "@/db/schema";
import { formatKurus } from "@/lib/money";
import { cleanText } from "@/lib/text";
import { istanbulDateOf } from "@/lib/time";
import type { DuesRate, OverrideKind } from "./categories";

export type DuesPeriodLike = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  dueOn: string;
  amountKurus: number;
  reducedAmountKurus: number | null;
};

export type DuesMember = {
  role: Role;
  joinedAt: Date;
  leftAt: Date | null;
  rate: DuesRate;
};

export type DuesOverride = { kind: OverrideKind; owedKurus: number; reason: string };

export type DuesState = "exempt" | "paid" | "overdue" | "partial" | "unpaid";
export type DuesTone = "muted" | "done" | "red" | "amber";

export type DuesStatus = {
  state: DuesState;
  tone: DuesTone;
  label: string;
  owed: number;
  paid: number;
  remaining: number;
};

/** The conductor is never charged; membership days are compared as Istanbul calendar days. */
export function owesPeriod(m: Omit<DuesMember, "rate">, p: DuesPeriodLike) {
  return (
    (m.role === "member" || m.role === "board") &&
    istanbulDateOf(m.joinedAt) <= p.endsOn &&
    (m.leftAt === null || istanbulDateOf(m.leftAt) >= p.startsOn)
  );
}

/** A freeze only protects a period that still has payments; once they're voided it lapses. */
export function owedFor(
  rate: DuesRate,
  p: DuesPeriodLike,
  override: Pick<DuesOverride, "kind" | "owedKurus"> | null,
  paid: number,
) {
  if (override && (override.kind === "waiver" || paid > 0)) return override.owedKurus;
  if (rate === "exempt") return 0;
  if (rate === "reduced") return p.reducedAmountKurus ?? p.amountKurus;
  return p.amountKurus;
}

const TONES: Record<DuesState, DuesTone> = {
  exempt: "muted",
  paid: "done",
  overdue: "red",
  partial: "amber",
  unpaid: "amber",
};

/** First match wins: Muaf, Ödendi, Gecikti (after the due day), Kısmi, Ödenmedi. */
export function duesStatus(owed: number, paid: number, dueOn: string, today: string): DuesStatus {
  const remaining = Math.max(owed - paid, 0);
  const state: DuesState =
    owed === 0
      ? "exempt"
      : remaining === 0
        ? "paid"
        : today > dueOn
          ? "overdue"
          : paid > 0
            ? "partial"
            : "unpaid";
  const left = `${formatKurus(remaining)} kaldı`;
  const label = {
    exempt: "Muaf",
    paid: "Ödendi",
    overdue: `Gecikti · ${left}`,
    partial: `Kısmi · ${left}`,
    unpaid: "Ödenmedi",
  }[state];
  return { state, tone: TONES[state], label, owed, paid, remaining };
}

export const overpaymentError = (remaining: number) =>
  `Kalan borç ${formatKurus(remaining)}; daha fazlası girilemez.`;

/** Spreads a payment over open periods, oldest due first; refuses more than what is owed. */
export function allocate(
  amount: number,
  open: { periodId: string; dueOn: string; remaining: number }[],
): { periodId: string; kurus: number }[] | { error: string } {
  const sorted = [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const total = sorted.reduce((sum, p) => sum + p.remaining, 0);
  if (amount > total) return { error: overpaymentError(total) };
  const out: { periodId: string; kurus: number }[] = [];
  let left = amount;
  for (const p of sorted) {
    if (left === 0) break;
    const kurus = Math.min(left, p.remaining);
    if (kurus > 0) out.push({ periodId: p.periodId, kurus });
    left -= kurus;
  }
  return out;
}

const monthYear = new Intl.DateTimeFormat("tr-TR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2027-01" → "Ocak 2027": the name bulk creation gives a month, and month headings. */
export function periodNameOf(month: string) {
  return monthYear.format(new Date(`${month}-01T00:00:00Z`));
}

export const NOT_RESPONSIBLE = "Bu kişi bu dönemden sorumlu değil.";
export const BEFORE_OPENING = "Tarih açılış bakiyesinden önce olamaz.";

/** Only members and board members pay dues; the conductor never does. */
export function isDuesPayer(role: Role) {
  return role === "member" || role === "board";
}

/** True when `day` lies before the live opening date (no opening date: never). */
export function beforeOpening(opened: string | null, day: string) {
  return opened !== null && day < opened;
}

export type PeriodPosition<P extends DuesPeriodLike = DuesPeriodLike> = {
  period: P;
  override: (DuesOverride & { createdAt?: Date }) | null;
  onRoster: boolean;
  owed: number;
  paid: number;
  remaining: number;
};

/** What one member owes and has paid per period, from already loaded rows. */
export function positionOf<P extends DuesPeriodLike, O extends DuesOverride>(
  member: Omit<DuesMember, "rate"> & { rate: DuesRate | null },
  periods: readonly P[],
  overrideOf: ReadonlyMap<string, O>,
  paidOf: ReadonlyMap<string, number>,
) {
  const rate = member.rate ?? "standard";
  return {
    rate,
    periods: periods.map((p) => {
      const paid = paidOf.get(p.id) ?? 0;
      const override = overrideOf.get(p.id) ?? null;
      const owed = owedFor(rate, p, override, paid);
      return {
        period: p,
        override,
        onRoster: owesPeriod(member, p) || paid > 0,
        owed,
        paid,
        remaining: Math.max(owed - paid, 0),
      };
    }),
  };
}

/** Periods already being paid keep what they owed under the old rate: the freezes to insert. */
export function freezesForRateChange(
  oldRate: DuesRate,
  nextRate: DuesRate,
  periods: readonly { period: DuesPeriodLike; override: unknown; paid: number; owed: number }[],
) {
  if (oldRate === nextRate) return [];
  return periods
    .filter((p) => p.paid > 0 && !p.override && p.owed > 0)
    .map((p) => ({ periodId: p.period.id, owedKurus: owedFor(oldRate, p.period, null, 0) }));
}

export const RATE_FREEZE_REASON = "Oran değişikliği";

export const waiverReason = z
  .string()
  .overwrite(cleanText)
  .trim()
  .min(3, "Neden yaz (en az 3 karakter).")
  .max(200, "En fazla 200 karakter.");

/** Why a waiver can't be given: the member doesn't owe the period, or it already has payments. */
export function waiverRefusal(
  member: Omit<DuesMember, "rate">,
  p: { period: DuesPeriodLike; paid: number },
): "not_responsible" | "paid" | null {
  if (!owesPeriod(member, p.period)) return "not_responsible";
  if (p.paid > 0) return "paid";
  return null;
}
