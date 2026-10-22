// Budget plan vs actual: pure and isomorphic. The page, the CSV route and the email all call
// computeReport, so they can't disagree (AC 37, 38).
import { formatKurus } from "@/lib/money";
import { CATEGORIES, kindOfCategory, type Category } from "./categories";

export const PLAN_STALE = "Bu plan az önce değişti. Sayfayı yenile.";
export const APPROVED_LOCKED = "Onaylanmış bütçenin adı ve tarihleri değiştirilemez.";
export const APPROVED_NO_DELETE = "Onaylanmış bütçe silinemez.";
export const NO_CHANGE = "Hiçbir tutar değişmedi.";
export const NAME_TAKEN = "Bu adla bir bütçe zaten var.";
export const EMPTY_PLAN = "Onaylamak için plana en az bir tutar gir.";
export const NO_PRIOR = "Önceki 12 ayda kayıt yok.";
export const overlapError = (name: string) => `Bu tarihler ${name} bütçesiyle çakışıyor.`;
export const CASH_NOTE =
  "Gerçekleşen: bu tarihlerde kasaya ve bankaya gerçekten giren ve çıkan para. Ödenmemiş aidat sayılmaz.";

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

export type BudgetStatus = "draft" | "approved";
export type BudgetPhase = "future" | "running" | "ended";
// "upcoming": the period hasn't started, so there is no actual and no verdict yet.
export type Signal =
  | "met"
  | "pending"
  | "short"
  | "unplanned"
  | "within"
  | "near"
  | "over"
  | "upcoming";

export const STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Taslak",
  approved: "Onaylandı",
};

/** "2026-09" + k months. */
export function addMonths(ym: string, k: number) {
  const [y, m] = ym.split("-").map(Number);
  const i = y * 12 + (m - 1) + k;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** The budget's exclusive end month: start + 12. */
export const endMonthOf = (start: string) => addMonths(start, 12);

/** Half-open plain days [start-01, start+12-01), like monthRange. */
export function budgetRange(start: string): [string, string] {
  return [`${start}-01`, `${endMonthOf(start)}-01`];
}

/** "Eylül 2026". */
export function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "Eylül 2026 – Ağustos 2027" for the 12 months starting at `start`. */
export function rangeLabel(start: string) {
  return `${monthName(start)} – ${monthName(addMonths(start, 11))}`;
}

/** "21 Ekim 2026" for a plain "YYYY-MM-DD" day. */
export function dayLabel(day: string) {
  return `${Number(day.slice(8, 10))} ${monthName(day.slice(0, 7))}`;
}

// Ablative suffix after the spoken last word of a year: "2027'den", "2026'dan", "2025'ten".
const ONES = ["", "den", "den", "ten", "ten", "ten", "dan", "den", "den", "dan"];
const TENS = ["den", "dan", "den", "dan", "tan", "den", "tan", "ten", "den", "dan"];
function yearAblative(year: number) {
  const one = year % 10;
  return one ? ONES[one] : year % 100 ? TENS[(year % 100) / 10] : "den";
}

/** "Gerçekleşenler Eylül 2027'den itibaren burada görünür." */
export function upcomingNote(start: string) {
  return `Gerçekleşenler ${monthName(start)}'${yearAblative(Number(start.slice(0, 4)))} itibaren burada görünür.`;
}

/**
 * Tech lead decision TL1 (amends D33): the month after the latest budget ends; with no budget,
 * September of today's year, or the next September no budget covers.
 */
export function defaultStart(today: string, existing: { startMonth: string; endMonth: string }[]) {
  if (existing.length) {
    return existing.reduce((m, b) => (b.endMonth > m ? b.endMonth : m), existing[0].endMonth);
  }
  return `${today.slice(0, 4)}-09`;
}

export type PriorWindow = {
  // Plain days, half-open; `to` is capped at the day after today.
  from: string;
  to: string;
  // The window still has days that haven't passed, so its numbers may be incomplete.
  partial: boolean;
  // "Eylül 2025 – Ağustos 2026", or "Eylül 2026 – 21 Ekim 2026" while partial.
  label: string;
  // The last day whose entries count, "21 Ekim 2026"; null when the window hasn't started.
  throughLabel: string | null;
  // The last month of the window that has fully passed, "Eylül 2026"; null if none.
  lastFullMonth: string | null;
};

/** D18 "Önceki 12 aydan doldur": the 12 months before `start`, never past today (D24). */
export function priorWindow(start: string, today: string): PriorWindow {
  const fromYm = addMonths(start, -12);
  const from = `${fromYm}-01`;
  const end = `${start}-01`;
  const partial = today < end;
  const to = partial ? addDay(today) : end;
  const last = partial ? today : addDay(end, -1);
  const fullYm = partial ? addMonths(today.slice(0, 7), -1) : addMonths(start, -1);
  return {
    from,
    to: to < from ? from : to,
    partial,
    label: partial ? `${monthName(fromYm)} – ${dayLabel(today)}` : rangeLabel(fromYm),
    throughLabel: last < from ? null : dayLabel(last),
    lastFullMonth: fullYm < fromYm ? null : monthName(fullYm),
  };
}

/** D33: January "2027", September "2026–27 sezonu", otherwise the range itself. */
export function defaultName(start: string) {
  const [y, m] = start.split("-").map(Number);
  if (m === 1) return String(y);
  if (m === 9) return `${y}–${String((y + 1) % 100).padStart(2, "0")} sezonu`;
  return rangeLabel(start);
}

/** Plain-day arithmetic without Node or timezone APIs. */
function addDay(day: string, k = 1) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
}

const dayNumber = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** `today` is the Istanbul day whose entries already count; it counts as passed (D24). */
export function phaseOf(start: string, today: string): BudgetPhase {
  const [from, to] = budgetRange(start);
  if (today < from) return "future";
  return today >= to ? "ended" : "running";
}

/** D24: round((today − start + 1) / total days × 100), clamped to 0–100. */
export function elapsedPercent(start: string, today: string) {
  const [from, to] = budgetRange(start);
  const total = dayNumber(to) - dayNumber(from);
  const passed = dayNumber(today) - dayNumber(from) + 1;
  return Math.min(100, Math.max(0, Math.round((passed / total) * 100)));
}

export const pctOf = (actual: number, plan: number) =>
  plan > 0 ? Math.round((actual * 100) / plan) : null;

export const SIGNAL_LABELS: Record<"income" | "expense", Record<Signal, string>> = {
  income: {
    met: "Hedefe ulaşıldı",
    pending: "Sürüyor",
    short: "Hedefin altında",
    unplanned: "Plansız gelir",
    within: "Bütçe içinde",
    near: "Sınıra yakın",
    over: "Bütçe aşıldı",
    upcoming: "",
  },
  expense: {
    met: "Hedefe ulaşıldı",
    pending: "Sürüyor",
    short: "Hedefin altında",
    unplanned: "Plansız gider",
    within: "Bütçe içinde",
    near: "Sınıra yakın",
    over: "Bütçe aşıldı",
    upcoming: "",
  },
};

/** The chip for an "upcoming" line; its signalLabel stays empty so the CSV Durum cell is blank. */
export const UPCOMING_CHIP = "Başlamadı";

/** D15, integers only. */
export function signalOf(
  kind: "income" | "expense",
  plan: number,
  actual: number,
  phase: BudgetPhase,
): Signal {
  if (phase === "future") return "upcoming";
  if (plan === 0) return "unplanned";
  if (kind === "income") return actual >= plan ? "met" : phase === "ended" ? "short" : "pending";
  if (actual > plan) return "over";
  return actual * 10 > plan * 9 ? "near" : "within";
}

/** The difference in words, so nobody has to read a sign (D15); none before the period starts. */
export function diffWords(kind: "income" | "expense", diff: number, phase: BudgetPhase) {
  if (phase === "future") return "";
  if (diff === 0) return "Planla aynı";
  const amount = formatKurus(diff);
  if (kind === "income") return `${amount} ${diff > 0 ? "fazla" : "eksik"}`;
  return `${amount} ${diff > 0 ? "aşıldı" : phase === "ended" ? "harcanmadı" : "kaldı"}`;
}

export type BudgetLine = {
  kind: "income" | "expense";
  category: Category;
  planKurus: number;
  actualKurus: number;
  diffKurus: number;
  pct: number | null;
  signal: Signal;
  signalLabel: string;
  words: string;
};

export type BudgetTotal = {
  planKurus: number;
  actualKurus: number;
  diffKurus: number;
  pct: number | null;
  words: string;
};

export type ComputedReport = {
  // "future" is the upcoming state: actuals 0, pct null, words "", signal "upcoming".
  phase: BudgetPhase;
  // Only for a future period: "Gerçekleşenler Eylül 2027'den itibaren burada görünür."
  upcomingNote: string | null;
  // Only for a running period; null otherwise.
  elapsedPct: number | null;
  lines: BudgetLine[];
  totals: {
    income: BudgetTotal;
    expense: BudgetTotal;
    // verdict waits for the end of the period (D25).
    net: { planKurus: number; actualKurus: number; verdict: "better" | "worse" | null };
  };
};

export type PlanMap = Partial<Record<Category, number>>;

function total(kind: "income" | "expense", lines: BudgetLine[], phase: BudgetPhase): BudgetTotal {
  const mine = lines.filter((l) => l.kind === kind);
  const planKurus = mine.reduce((s, l) => s + l.planKurus, 0);
  const actualKurus = mine.reduce((s, l) => s + l.actualKurus, 0);
  const diffKurus = actualKurus - planKurus;
  return {
    planKurus,
    actualKurus,
    diffKurus,
    pct: phase === "future" ? null : pctOf(actualKurus, planKurus),
    words: diffWords(kind, diffKurus, phase),
  };
}

/** Lines with plan 0 and actual 0 are dropped; totals include the unplanned lines (AC 35). */
export function computeReport(input: {
  start: string;
  plan: PlanMap;
  actual: PlanMap;
  today: string;
}): ComputedReport {
  const phase = phaseOf(input.start, input.today);
  const ended = phase === "ended";
  const future = phase === "future";
  const lines: BudgetLine[] = [];
  for (const category of CATEGORIES) {
    const planKurus = input.plan[category] ?? 0;
    const actualKurus = future ? 0 : (input.actual[category] ?? 0);
    if (planKurus === 0 && actualKurus === 0) continue;
    const kind = kindOfCategory(category);
    const diffKurus = actualKurus - planKurus;
    const signal = signalOf(kind, planKurus, actualKurus, phase);
    lines.push({
      kind,
      category,
      planKurus,
      actualKurus,
      diffKurus,
      pct: future ? null : pctOf(actualKurus, planKurus),
      signal,
      signalLabel: SIGNAL_LABELS[kind][signal],
      words: diffWords(kind, diffKurus, phase),
    });
  }
  const income = total("income", lines, phase);
  const expense = total("expense", lines, phase);
  const planNet = income.planKurus - expense.planKurus;
  const actualNet = income.actualKurus - expense.actualKurus;
  return {
    phase,
    upcomingNote: future ? upcomingNote(input.start) : null,
    elapsedPct: phase === "running" ? elapsedPercent(input.start, input.today) : null,
    lines,
    totals: {
      income,
      expense,
      net: {
        planKurus: planNet,
        actualKurus: actualNet,
        verdict: ended ? (actualNet >= planNet ? "better" : "worse") : null,
      },
    },
  };
}

/** D23: "Gelir %x · Gider %y (plana göre)" parts; null pct means that side has no plan. */
export function sidePercents(plan: PlanMap, actual: PlanMap) {
  let pi = 0;
  let pe = 0;
  let ai = 0;
  let ae = 0;
  for (const c of CATEGORIES) {
    const income = kindOfCategory(c) === "income";
    if (income) {
      pi += plan[c] ?? 0;
      ai += actual[c] ?? 0;
    } else {
      pe += plan[c] ?? 0;
      ae += actual[c] ?? 0;
    }
  }
  return { incomePct: pctOf(ai, pi), expensePct: pctOf(ae, pe) };
}

/** D39 email line, right after "Gelir: …". */
export function budgetEmailLine(b: {
  name: string;
  status: BudgetStatus;
  incomePct: number | null;
  expensePct: number | null;
}) {
  const income = b.incomePct === null ? "gelir planı yok" : `gelir plana göre %${b.incomePct}`;
  const expense = b.expensePct === null ? "gider planı yok" : `gider plana göre %${b.expensePct}`;
  return `Bütçe (${b.name}, ${STATUS_LABELS[b.status]}): ${income} · ${expense}.`;
}

/** D18: whole lira, rounded up. */
export const ceilToLira = (kurus: number) => Math.ceil(kurus / 100) * 100;
