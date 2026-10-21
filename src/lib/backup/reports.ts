import "server-only";
import { autoCloseStale } from "@/lib/attendance/close";
import { attendanceCsv } from "@/lib/attendance/csv";
import { attendanceStats } from "@/lib/attendance/stats";
import { csvDocument } from "@/lib/csv";
import { DUES_HEADER, duesRows, LEDGER_HEADER, ledgerRows } from "@/lib/finance/csv";
import { ledgerRowsBetween, loadDuesMatrix, monthTotals } from "@/lib/finance/queries-internal";
import { collator } from "@/lib/format";
import { homeworkCsv } from "@/lib/homework/csv";
import { homeworkDueBetween } from "@/lib/homework/queries";
import type { MonthSummary } from "./email";
import { monthBounds } from "./schedule";

const percentOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/**
 * Unguarded: the run authorizes first. The four CSVs and the body numbers for one Istanbul month.
 * `today` is the dues "as of" day; `at` decides which homework is already missing.
 */
export async function buildReports(month: string, today: string, at: Date) {
  const { from, to, firstDay, lastDay } = monthBounds(month);
  // Same side effect as opening /raporlar: forgotten rehearsals close before they are counted.
  await autoCloseStale();
  const [stats, homework, ledger, dues, totals] = await Promise.all([
    attendanceStats({ from, to }),
    homeworkDueBetween(from, to, at),
    ledgerRowsBetween(firstDay, lastDay),
    loadDuesMatrix(today),
    monthTotals(month),
  ]);

  const members = [...stats.members].sort((a, b) => collator.compare(a.name, b.name));
  const percents = members.flatMap((m) => (m.percent === null ? [] : [m.percent]));
  const expected = homework.rows.filter((r) => r.expected);

  const periods = dues.periods.filter((p) => p.startsOn <= lastDay && p.endsOn >= firstDay);
  const duesBody = periods.flatMap((p) =>
    duesRows(dues.members, p.id).map((row) => [p.name, ...row]),
  );

  const summary: MonthSummary = {
    rehearsals: stats.rehearsalCount,
    attendancePercent: percents.length
      ? Math.round(percents.reduce((s, p) => s + p, 0) / percents.length)
      : null,
    assignments: homework.assignmentCount,
    onTimePercent: percentOf(expected.filter((r) => r.state === "done").length, expected.length),
    income: totals.income,
    expense: totals.expense,
    net: totals.net,
  };
  return {
    summary,
    csv: {
      attendance: attendanceCsv(members),
      homework: homeworkCsv(homework.rows),
      ledger: csvDocument(LEDGER_HEADER, ledgerRows(ledger)),
      dues: csvDocument(["Dönem", ...DUES_HEADER], duesBody),
    },
  };
}
