import { CalendarRange, Download } from "lucide-react";
import Link from "next/link";
import { z } from "zod";
import { DuesChip } from "@/components/finance/dues-chip";
import { DuesList, type DuesListRow } from "@/components/finance/dues-list";
import { eyebrow, FinanceNav } from "@/components/finance/finance-nav";
import {
  MemberPayment,
  RateForm,
  UrlSheet,
  WaiverForm,
} from "@/components/finance/member-dues-forms";
import { FilterChip } from "@/components/filter-chip";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import {
  currentPeriodOf,
  duesAuditOf,
  duesMatrix,
  memberPayments,
  periodSummary,
  todayIstanbul,
  type DuesMemberRow,
} from "@/lib/finance/queries";
import { ACCOUNT_LABELS, DUES_RATE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { formatKurus } from "@/lib/money";
import { addDays, dayInstant, formatShortDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Aidat" };

function flagsOf(m: DuesMemberRow, periodId: string) {
  const cell = m.cells.get(periodId);
  const flags: string[] = [];
  if (m.rate !== "standard")
    flags.push([DUES_RATE_LABELS[m.rate], m.note].filter(Boolean).join(" · "));
  if (m.left) flags.push("Ayrıldı");
  if (cell?.override?.kind === "waiver") flags.push(`Bu dönem muaf: ${cell.override.reason}`);
  const older = [...m.cells.values()].filter(
    (c) =>
      c.period.id !== periodId &&
      c.status.remaining > 0 &&
      c.period.dueOn < (cell?.period.dueOn ?? ""),
  );
  if (older.length) flags.push(`${older.map((c) => c.period.name).join(", ")} borcu var`);
  return flags.join(" · ");
}

export default async function DuesPage({ searchParams }: PageProps<"/finans/aidat">) {
  await requireManager();
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : "");
  const today = todayIstanbul();
  const { periods, members } = await duesMatrix(today);
  const current = currentPeriodOf(periods, today);
  const selected = periods.find((p) => p.id === one(sp.donem)) ?? current;
  const debtorsOnly = one(sp.filtre) === "borclu";
  const memberId = z.uuid().safeParse(one(sp.uye)).success ? one(sp.uye) : null;

  if (!selected) {
    return (
      <div className="space-y-5">
        <h1 className="text-4xl font-medium">Aidat</h1>
        <FinanceNav active="aidat" />
        <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 pt-10 pb-12 text-center">
          <p className="font-medium">Henüz aidat dönemi yok.</p>
          <Link
            href="/finans/aidat/donemler"
            className={cn(buttonVariants(), "h-11 rounded-full px-5")}
          >
            Dönem oluştur
          </Link>
        </div>
      </div>
    );
  }

  const summary = periodSummary(members, selected.id);
  const onPeriod = members.filter((m) => m.cells.has(selected.id));
  const rows: DuesListRow[] = onPeriod
    .filter((m) => !debtorsOnly || m.cells.get(selected.id)!.status.remaining > 0)
    .map((m) => ({
      id: m.id,
      name: m.name,
      voicePart: m.voicePart,
      flags: flagsOf(m, selected.id),
      status: m.cells.get(selected.id)!.status,
      open: [...m.cells.values()]
        .filter((c) => c.status.remaining > 0)
        .sort((a, b) => a.period.dueOn.localeCompare(b.period.dueOn))
        .map((c) => ({ id: c.period.id, name: c.period.name, remaining: c.status.remaining })),
    }));
  const chips = [...periods].reverse().slice(0, 12);
  const base = `/finans/aidat?donem=${selected.id}`;
  const sheetMember = memberId ? members.find((m) => m.id === memberId) : null;
  const [payments, audit] = sheetMember
    ? await Promise.all([memberPayments(sheetMember.id), duesAuditOf(sheetMember.id)])
    : [[], null];
  const late = today > selected.dueOn;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-medium">Aidat</h1>
        <a
          href={`/finans/aidat/csv?donem=${selected.id}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
        >
          <Download />
          CSV
        </a>
      </div>
      <FinanceNav active="aidat" />

      <nav
        aria-label="Aidat dönemleri"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
      >
        {chips.map((p) => (
          <FilterChip
            key={p.id}
            href={`/finans/aidat?donem=${p.id}`}
            active={p.id === selected.id}
            label={p.name}
          />
        ))}
        <Link
          href="/finans/aidat/donemler"
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed px-4 text-sm hover:bg-muted"
        >
          <CalendarRange className="size-4" aria-hidden />
          Dönemler
        </Link>
      </nav>

      <section className="space-y-2 rounded-2xl border bg-card p-4" data-testid="period-summary">
        <h2 className="text-lg font-medium">{selected.name}</h2>
        <p className="text-sm tabular-nums">
          Toplanan {formatKurus(summary.collected)} / {formatKurus(summary.expected)}
        </p>
        <div
          role="img"
          aria-label={`${summary.paidCount}/${summary.owingCount} ödendi`}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-present"
            style={{
              width: `${summary.expected ? Math.min(summary.collected / summary.expected, 1) * 100 : 0}%`,
            }}
          />
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {summary.paidCount} ödedi · {summary.partial} kısmi · {summary.unpaid + summary.overdue}{" "}
          ödemedi · {summary.exempt} muaf
        </p>
        <p className={cn("text-sm", late ? "text-absent-ink" : "text-muted-foreground")}>
          Son ödeme: {formatShortDate.format(dayInstant(selected.dueOn))}
          {late && " · süresi geçti"}
        </p>
      </section>

      <nav aria-label="Aidat filtresi" className="flex gap-2">
        <FilterChip href={base} active={!debtorsOnly} label="Tümü" count={onPeriod.length} />
        <FilterChip
          href={`${base}&filtre=borclu`}
          active={debtorsOnly}
          label="Borçlular"
          count={summary.debtors}
        />
      </nav>

      <DuesList
        rows={rows}
        periodId={selected.id}
        today={today}
        yesterday={addDays(today, -1)}
        emptyText="Bu dönem borçlu kimse yok."
      />

      {sheetMember && (
        <UrlSheet
          title={sheetMember.name}
          description={`${sheetMember.voicePart ? VOICE_PART_LABELS[sheetMember.voicePart] : "Partisyonsuz"} · ${DUES_RATE_LABELS[sheetMember.rate]} aidat`}
          closeHref={debtorsOnly ? `${base}&filtre=borclu` : base}
        >
          <MemberSheetBody
            member={sheetMember}
            payments={payments}
            audit={audit}
            selectedId={selected.id}
            selectedName={selected.name}
            today={today}
          />
        </UrlSheet>
      )}
    </div>
  );
}

function MemberSheetBody({
  member,
  payments,
  audit,
  selectedId,
  selectedName,
  today,
}: {
  member: DuesMemberRow;
  payments: Awaited<ReturnType<typeof memberPayments>>;
  audit: Awaited<ReturnType<typeof duesAuditOf>>;
  selectedId: string;
  selectedName: string;
  today: string;
}) {
  const cells = [...member.cells.values()].sort((a, b) =>
    b.period.startsOn.localeCompare(a.period.startsOn),
  );
  const remaining = cells.reduce((s, c) => s + c.status.remaining, 0);
  const anyLate = cells.some((c) => c.status.state === "overdue");
  const selectedCell = member.cells.get(selectedId);
  return (
    <>
      <p
        className={cn("text-2xl font-semibold tabular-nums", anyLate && "text-absent-ink")}
        data-testid="member-remaining"
      >
        Kalan borç {formatKurus(remaining)}
      </p>
      <MemberPayment
        memberId={member.id}
        today={today}
        yesterday={addDays(today, -1)}
        open={cells
          .filter((c) => c.status.remaining > 0)
          .sort((a, b) => a.period.dueOn.localeCompare(b.period.dueOn))
          .map((c) => ({ id: c.period.id, name: c.period.name, remaining: c.status.remaining }))}
      />
      <section className="space-y-2">
        <h3 className={eyebrow}>Dönemler</h3>
        <ul className="divide-y rounded-2xl border">
          {cells.slice(0, 12).map((c) => (
            <li
              key={c.period.id}
              className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span>
                {c.period.name} · <span className="tabular-nums">{formatKurus(c.status.owed)}</span>
                {c.override?.kind === "freeze" && (
                  <span className="block text-xs text-muted-foreground">
                    Oran değişmeden önce başlandı: {formatKurus(c.override.owedKurus)}
                  </span>
                )}
              </span>
              <DuesChip status={c.status} />
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className={eyebrow}>Ödemeler</h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz ödeme yok.</p>
        ) : (
          <ul className="divide-y rounded-2xl border">
            {payments.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/finans/${p.id}`}
                  className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm hover:bg-muted/50"
                >
                  <span>
                    {formatShortDate.format(dayInstant(p.occurredOn))} · {p.periodName} ·{" "}
                    {ACCOUNT_LABELS[p.account]}
                  </span>
                  <span className="tabular-nums">{formatKurus(p.amountKurus)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2 border-t pt-4">
        <RateForm
          userId={member.id}
          rate={member.rate}
          note={member.note ?? ""}
          audit={audit?.rate ?? null}
        />
      </section>
      {selectedCell && (
        <section className="space-y-2 border-t pt-4">
          <WaiverForm
            periodId={selectedId}
            periodName={selectedName}
            userId={member.id}
            reason={selectedCell.override?.kind === "waiver" ? selectedCell.override.reason : null}
            audit={audit?.waivers.get(selectedId) ?? null}
          />
        </section>
      )}
    </>
  );
}
