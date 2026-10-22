import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CirclePlus,
  Hourglass,
  PencilLine,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { BudgetLine, BudgetStatus, BudgetTotal, Signal } from "@/lib/finance/budget";
import { STATUS_LABELS, UPCOMING_CHIP } from "@/lib/finance/budget";
import type { BudgetReport } from "@/lib/finance/queries";
import { CATEGORY_LABELS } from "@/lib/labels";
import { formatKurus, formatNet } from "@/lib/money";
import { formatAuditDate, formatAuditDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

export function StatusChip({ status }: { status: BudgetStatus }) {
  const approved = status === "approved";
  const Icon = approved ? CircleCheck : PencilLine;
  return (
    <span
      data-testid="budget-status"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        approved ? "bg-present/14 text-present-ink" : "border text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function CurrentChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-primary">
      Şu anki
    </span>
  );
}

type Tone = "good" | "warn" | "bad" | "neutral";
const TONE: Record<Tone, { chip: string; text: string }> = {
  good: { chip: "bg-present/14 text-present-ink", text: "text-present-ink" },
  warn: { chip: "bg-late/18 text-late-ink", text: "text-late-ink" },
  bad: { chip: "bg-absent text-absent-foreground", text: "font-medium text-absent-ink" },
  neutral: { chip: "bg-muted text-muted-foreground", text: "text-muted-foreground" },
};

function look(line: Pick<BudgetLine, "kind" | "signal">): { tone: Tone; icon: LucideIcon } {
  const s: Signal = line.signal;
  if (s === "met" || s === "within") return { tone: "good", icon: CircleCheck };
  if (s === "over") return { tone: "bad", icon: CircleAlert };
  if (s === "pending") return { tone: "neutral", icon: Hourglass };
  if (s === "upcoming") return { tone: "neutral", icon: CalendarClock };
  if (s === "unplanned") {
    return line.kind === "income"
      ? { tone: "neutral", icon: CirclePlus }
      : { tone: "warn", icon: CirclePlus };
  }
  return { tone: "warn", icon: TriangleAlert };
}

export function SignalChip({ line }: { line: BudgetLine }) {
  const { tone, icon: Icon } = look(line);
  return (
    <span
      data-testid="signal-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[tone].chip,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {line.signal === "upcoming" ? UPCOMING_CHIP : line.signalLabel}
    </span>
  );
}

function fillClass(line: BudgetLine) {
  if (line.signal === "over") return "bg-absent";
  if (line.signal === "near" || line.signal === "short") return "bg-late";
  return line.kind === "income" ? "bg-present" : "bg-foreground/40";
}

/** Decorative: the numbers are text. Planned lines only (D26). */
export function BudgetBar({ line, elapsed }: { line: BudgetLine; elapsed: number | null }) {
  const pct = line.pct ?? 0;
  return (
    <div aria-hidden data-testid="budget-bar" className="relative mt-3 h-2 rounded-full bg-muted">
      <div
        data-fill={Math.min(pct, 100)}
        className={cn("h-full rounded-full", fillClass(line))}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
      {pct > 100 && (
        <span
          data-over="true"
          className={cn(
            "absolute top-1/2 right-0 h-3.5 w-1 -translate-y-1/2 rounded-full",
            line.kind === "expense" ? "bg-absent" : "bg-foreground",
          )}
        />
      )}
      {elapsed !== null && (
        <span
          data-elapsed={elapsed}
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/60"
          style={{ left: `${elapsed}%` }}
        />
      )}
    </div>
  );
}

/** Before the period starts ("upcoming") only the plan is shown. */
export function LineCard({ line, elapsed }: { line: BudgetLine; elapsed: number | null }) {
  const upcoming = line.signal === "upcoming";
  const planned = line.planKurus > 0;
  const { tone } = look(line);
  return (
    <li
      data-testid="budget-line"
      data-kind={line.kind}
      data-category={line.category}
      data-signal={line.signal}
      data-plan-kurus={line.planKurus}
      data-actual-kurus={line.actualKurus}
      data-diff-kurus={line.diffKurus}
      data-pct={line.pct ?? ""}
      className="rounded-2xl border bg-card px-4 py-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-sans font-medium">{CATEGORY_LABELS[line.category]}</h3>
        <SignalChip line={line} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Plan</dt>
          <dd data-testid="line-plan" className="tabular-nums">
            {planned ? formatKurus(line.planKurus) : "Planlanmadı"}
          </dd>
        </div>
        {!upcoming && (
          <>
            <div>
              <dt className="text-xs text-muted-foreground">Gerçekleşen</dt>
              <dd className="tabular-nums">
                <span data-testid="line-actual" className="font-semibold">
                  {formatKurus(line.actualKurus)}
                </span>{" "}
                <span data-testid="line-pct" className="text-muted-foreground">
                  {line.pct === null ? "—" : `%${line.pct}`}
                </span>
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="sr-only">Fark</dt>
              <dd data-testid="line-words" className={cn("tabular-nums", TONE[tone].text)}>
                {line.words}
              </dd>
            </div>
          </>
        )}
      </dl>
      {planned && !upcoming && <BudgetBar line={line} elapsed={elapsed} />}
    </li>
  );
}

function TotalBlock({
  label,
  kind,
  total,
}: {
  label: string;
  kind: "income" | "expense";
  total: BudgetTotal;
}) {
  return (
    <div
      data-testid="budget-total"
      data-kind={kind}
      data-plan-kurus={total.planKurus}
      data-actual-kurus={total.actualKurus}
      data-pct={total.pct ?? ""}
      className="space-y-1"
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{formatKurus(total.actualKurus)}</dd>
      <dd className="text-sm text-muted-foreground tabular-nums">
        Plan {formatKurus(total.planKurus)}
        {total.pct !== null && ` · %${total.pct}`} · {total.words}
      </dd>
    </div>
  );
}

const signed = (k: number) => `${k > 0 ? "+" : ""}${formatNet(k)}`;
const longDay = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function PlannedTotals({ report }: { report: BudgetReport }) {
  const { income, expense, net } = report.totals;
  const blocks = [
    ["income", "Planlanan gelir", formatKurus(income.planKurus), income.planKurus],
    ["expense", "Planlanan gider", formatKurus(expense.planKurus), expense.planKurus],
    ["net", "Planlanan net", signed(net.planKurus), net.planKurus],
  ] as const;
  return (
    <>
      <dl className="grid gap-4 md:grid-cols-3">
        {blocks.map(([kind, label, text, kurus]) => (
          <div
            key={kind}
            data-testid={kind === "net" ? "budget-net" : "budget-total"}
            data-kind={kind}
            data-plan-kurus={kurus}
            className="space-y-1"
          >
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "text-2xl font-semibold tabular-nums",
                kind === "net" && kurus < 0 && "text-absent-ink",
              )}
            >
              {text}
            </dd>
          </div>
        ))}
      </dl>
      <p data-testid="budget-starts" className="text-sm text-muted-foreground">
        {report.upcomingNote}
      </p>
    </>
  );
}

export function Summary({ report }: { report: BudgetReport }) {
  const { income, expense, net } = report.totals;
  const heading =
    report.phase === "running"
      ? "Dönem içi durum"
      : report.phase === "ended"
        ? "Dönem sonu raporu"
        : "Dönem henüz başlamadı";
  return (
    <section
      aria-labelledby="ozet"
      data-testid="budget-summary"
      data-phase={report.phase}
      className="space-y-4 rounded-2xl border bg-card p-4 md:p-6"
    >
      <div className="space-y-1">
        <h2 id="ozet" className={eyebrow} data-testid="budget-phase">
          {heading}
        </h2>
        {report.phase === "running" && report.elapsedPct !== null && (
          <>
            <p data-testid="budget-elapsed" className="font-medium">
              Dönemin geçen kısmı: %{report.elapsedPct}
            </p>
            <p className="text-sm text-muted-foreground">
              {longDay.format(new Date(`${report.asOf}T00:00:00Z`))} itibarıyla
            </p>
            <div aria-hidden className="mt-2 h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/60"
                style={{ width: `${report.elapsedPct}%` }}
              />
            </div>
          </>
        )}
      </div>
      {report.phase === "future" ? (
        <PlannedTotals report={report} />
      ) : (
        <dl className="grid gap-4 md:grid-cols-3">
          <TotalBlock label="Toplam gelir" kind="income" total={income} />
          <TotalBlock label="Toplam gider" kind="expense" total={expense} />
          <div
            data-testid="budget-net"
            data-plan-kurus={net.planKurus}
            data-actual-kurus={net.actualKurus}
            data-verdict={net.verdict ?? ""}
            className="space-y-1"
          >
            <dt className="text-sm text-muted-foreground">Net (gelir − gider)</dt>
            <dd
              className={cn(
                "text-2xl font-semibold tabular-nums",
                net.actualKurus < 0 && "text-absent-ink",
              )}
            >
              {signed(net.actualKurus)}
            </dd>
            <dd className="flex flex-wrap items-center gap-x-2 text-sm tabular-nums">
              <span className="text-muted-foreground">Plan {signed(net.planKurus)}</span>
              {(net.verdict || report.phase === "running") && (
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
              )}
              {net.verdict === "better" && (
                <span className="inline-flex items-center gap-1 font-medium text-present-ink">
                  <TrendingUp aria-hidden className="size-4" />
                  Plandan iyi
                </span>
              )}
              {net.verdict === "worse" && (
                <span className="inline-flex items-center gap-1 font-medium text-absent-ink">
                  <TrendingDown aria-hidden className="size-4" />
                  Plandan kötü
                </span>
              )}
              {report.phase === "running" && (
                <span className="text-muted-foreground">Dönem sürüyor</span>
              )}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

export function History({ report }: { report: BudgetReport }) {
  if (!report.approved && report.history.length === 0) return null;
  return (
    <section aria-labelledby="gecmis" className="space-y-3">
      <h2 id="gecmis" className="text-xl font-medium">
        Değişiklik geçmişi
      </h2>
      <ol className="space-y-3">
        {report.history.map((h) => (
          <li
            key={h.id}
            data-testid="budget-revision"
            className="space-y-1.5 rounded-2xl border bg-card p-4"
          >
            <p className="text-sm font-medium">
              {h.by} · {formatAuditDateTime(h.at)} · “{h.reason}”
            </p>
            <ul className="text-sm tabular-nums">
              {h.changes.map((c) => (
                <li key={c.category}>
                  {CATEGORY_LABELS[c.category]}: {formatKurus(c.fromKurus)} →{" "}
                  {formatKurus(c.toKurus)}
                </li>
              ))}
            </ul>
          </li>
        ))}
        {report.approved && (
          <li
            data-testid="budget-approval"
            className="rounded-2xl border border-dashed p-4 text-sm font-medium"
          >
            {report.approved.name} · {formatAuditDate(report.approved.at)} · Onaylandı
          </li>
        )}
      </ol>
    </section>
  );
}
