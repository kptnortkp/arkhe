import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberDues, pieces, users } from "@/db/schema";
import { ATTENDANCE_HEADER, attendanceRows } from "@/lib/attendance/csv";
import { autoCloseStale } from "@/lib/attendance/close";
import { listTerms, resolvePeriod } from "@/lib/attendance/period";
import { attendanceStats, type MemberStats } from "@/lib/attendance/stats";
import { day, money, pct, type CsvValue } from "@/lib/csv";
import {
  BUDGET_HEADER,
  budgetRows,
  DUES_HEADER,
  duesRows,
  LEDGER_HEADER,
  ledgerRows,
} from "@/lib/finance/csv";
import { isDuesPayer } from "@/lib/finance/dues";
import {
  budgetReport,
  csvEntries,
  duesMatrix,
  listBudgets,
  todayIstanbul,
} from "@/lib/finance/queries";
import { collator } from "@/lib/format";
import { HOMEWORK_HEADER, homeworkRows } from "@/lib/homework/csv";
import { homeworkDueBetween } from "@/lib/homework/queries";
import {
  DUES_RATE_LABELS,
  PIECE_STATUS_LABELS,
  ROLE_LABELS,
  VOICE_PART_LABELS,
} from "@/lib/labels";
import { formatAuditDateTime, istanbulDateOf, now } from "@/lib/time";
import type { ExportBook, ExportSheet } from "./table";

const LEGEND =
  "Yeşil: sorun yok · Turuncu: bir devamsızlık daha olursa sınırı geçer · Kırmızı: sınırı geçti (Uyarı)";
// Far enough ahead to include every homework already scheduled.
const FAR_FUTURE = new Date("9999-12-31T00:00:00Z");

const byName = <T extends { name: string }>(list: T[]) =>
  [...list].sort((a, b) => collator.compare(a.name, b.name));
const percentOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

async function memberSheet(): Promise<ExportSheet & { active: number; former: number }> {
  const rows = await db
    .select({
      name: users.name,
      email: users.email,
      voicePart: users.voicePart,
      role: users.role,
      isActive: users.isActive,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
      rate: memberDues.rate,
    })
    .from(users)
    .leftJoin(memberDues, eq(memberDues.userId, users.id));
  const sorted = byName(rows);
  return {
    title: "Üyeler",
    header: ["Ad soyad", "E-posta", "Partisyon", "Rol", "Durum", "Katılış", "Ayrılış", "Aidat"],
    rows: sorted.map((u) => [
      u.name,
      u.email,
      u.voicePart ? VOICE_PART_LABELS[u.voicePart] : "",
      ROLE_LABELS[u.role],
      u.isActive ? "Aktif" : "Ayrıldı",
      day(istanbulDateOf(u.joinedAt)),
      u.leftAt ? day(istanbulDateOf(u.leftAt)) : "",
      isDuesPayer(u.role) ? DUES_RATE_LABELS[u.rate ?? "standard"] : "",
    ]),
    active: rows.filter((u) => u.isActive).length,
    former: rows.filter((u) => !u.isActive).length,
  };
}

async function termSheet(): Promise<ExportSheet> {
  const terms = [...(await listTerms())].reverse();
  const header = ["Dönem", ...ATTENDANCE_HEADER];
  const rows: CsvValue[][] = [];
  const tones: MemberStats["level"][] = [];
  for (const term of terms) {
    const period = await resolvePeriod(term.id);
    const stats = await attendanceStats({ from: period.from, to: period.to });
    const members = byName(stats.members);
    rows.push(...attendanceRows(members).map((r) => [term.name, ...r]));
    tones.push(...members.map((m) => m.level));
  }
  return {
    title: "Devam · dönem dönem",
    sheetName: "Devam (dönemler)",
    legend: LEGEND,
    header,
    rows,
    rowTones: tones,
  };
}

async function budgetSheet(): Promise<ExportSheet & { count: number }> {
  const list = await listBudgets();
  const rows: CsvValue[][] = [];
  const strongRows: number[] = [];
  for (const b of list) {
    const report = await budgetReport(b.id);
    if (!report) continue;
    for (const r of budgetRows(report)) {
      if (r[1] === "Toplam" || r[0] === "Net") strongRows.push(rows.length);
      rows.push([report.name, ...r]);
    }
  }
  return {
    title: "Bütçeler",
    header: ["Bütçe", ...BUDGET_HEADER],
    rows,
    strongRows,
    count: list.length,
  };
}

async function repertoireSheet(): Promise<ExportSheet> {
  const list = await db
    .select({
      title: pieces.title,
      composer: pieces.composer,
      arranger: pieces.arranger,
      language: pieces.language,
      voicing: pieces.voicing,
      status: pieces.status,
    })
    .from(pieces);
  return {
    title: "Repertuvar",
    header: ["Eser", "Besteci", "Düzenleyen", "Dil", "Ses dağılımı", "Durum"],
    rows: [...list]
      .sort((a, b) => collator.compare(a.title, b.title))
      .map((p) => [
        p.title,
        p.composer,
        p.arranger,
        p.language,
        p.voicing,
        PIECE_STATUS_LABELS[p.status],
      ]),
  };
}

/** Everything from the first record to today, one table per area. Runs after the manager check. */
export async function fullReportExport(): Promise<ExportBook> {
  await autoCloseStale();
  const at = now();
  const today = todayIstanbul();
  const [members, stats, terms, homework, ledger, dues, budgets, repertoire] = await Promise.all([
    memberSheet(),
    attendanceStats({ from: new Date(0), to: at }),
    termSheet(),
    homeworkDueBetween(new Date(0), FAR_FUTURE, at),
    csvEntries("1900-01-01", "9999-12-31"),
    duesMatrix(today),
    budgetSheet(),
    repertoireSheet(),
  ]);

  const attendees = byName(stats.members);
  const percents = attendees.flatMap((m) => (m.percent === null ? [] : [m.percent]));
  const expected = homework.rows.filter((r) => r.expected);
  const sum = (kind: "income" | "expense") =>
    ledger.filter((e) => e.kind === kind).reduce((s, e) => s + e.amountKurus, 0);
  const income = sum("income");
  const expense = sum("expense");
  const avg = percents.length
    ? Math.round(percents.reduce((s, p) => s + p, 0) / percents.length)
    : null;
  const onTime = percentOf(
    expected.filter((r) => r.state === "done").length,
    expected.filter((r) => r.state !== "pending").length,
  );

  const summary: ExportSheet = {
    title: "Özet",
    subtitle: `Başlangıçtan ${formatAuditDateTime(at)} itibarıyla`,
    header: ["Başlık", "Değer"],
    rows: [
      ["Aktif üye", members.active],
      ["Ayrılan üye", members.former],
      ["Sayılan çalışma", stats.rehearsalCount],
      ["Ortalama devam", avg === null ? "" : pct(avg)],
      ["Uyarı alan üye", attendees.filter((m) => m.warning).length],
      ["Ödev", homework.assignmentCount],
      ["Zamanında teslim", onTime === null ? "" : pct(onTime)],
      ["Toplam gelir", money(income)],
      ["Toplam gider", money(expense)],
      ["Net (gelir − gider)", money(income - expense)],
      ["Aidat dönemi", dues.periods.length],
      ["Bütçe", budgets.count],
      ["Repertuvardaki eser", repertoire.rows.length],
    ],
  };

  return {
    title: "Arkhe toplu rapor",
    filename: `arkhe-toplu-rapor-${today}`,
    sheets: [
      summary,
      members,
      {
        title: "Devam · tüm zamanlar",
        sheetName: "Devam (tümü)",
        legend: LEGEND,
        header: ATTENDANCE_HEADER,
        rows: attendanceRows(attendees),
        rowTones: attendees.map((m) => m.level),
      },
      terms,
      { title: "Ödevler", header: HOMEWORK_HEADER, rows: homeworkRows(homework.rows) },
      {
        title: "Muhasebe dökümü",
        sheetName: "Muhasebe",
        subtitle: "İptal edilen kayıtlar dahil değil",
        header: LEDGER_HEADER,
        rows: ledgerRows(ledger),
        pdfOmit: ["Belge", "Kaydeden", "Kayıt no"],
      },
      {
        title: "Aidat",
        header: ["Dönem", ...DUES_HEADER],
        rows: dues.periods.flatMap((p) => duesRows(dues.members, p.id).map((r) => [p.name, ...r])),
      },
      budgets,
      repertoire,
    ],
  };
}
