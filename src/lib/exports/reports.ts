import "server-only";
import { z } from "zod";
import { json } from "@/lib/api";
import { ATTENDANCE_HEADER, attendanceRows } from "@/lib/attendance/csv";
import { autoCloseStale } from "@/lib/attendance/close";
import { resolvePeriod } from "@/lib/attendance/period";
import { attendanceStats } from "@/lib/attendance/stats";
import {
  BUDGET_HEADER,
  budgetRows,
  DUES_HEADER,
  duesRows,
  LEDGER_HEADER,
  ledgerRows,
} from "@/lib/finance/csv";
import { budgetReport, csvEntries, duesMatrix, todayIstanbul } from "@/lib/finance/queries";
import { isRealDay } from "@/lib/finance/schemas";
import { collator, searchKey } from "@/lib/format";
import { trDay, type ExportTable } from "./table";

// Builders run after exportRoute's manager check; each returns a table or an error response.

const slugOf = (text: string) =>
  searchKey(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function attendanceExport(request: Request): Promise<ExportTable> {
  await autoCloseStale();
  const params = new URL(request.url).searchParams;
  const period = await resolvePeriod(params.get("donem") ?? undefined);
  const stats = await attendanceStats({ from: period.from, to: period.to });
  const onlyFlagged = params.get("uyari") === "1";
  const members = stats.members
    .filter((m) => !onlyFlagged || m.warning)
    .sort((a, b) => collator.compare(a.name, b.name));
  return {
    title: "Devam raporu",
    subtitle: [
      period.label,
      `${stats.rehearsalCount} sayılan çalışma`,
      onlyFlagged ? "Yalnız uyarı alanlar" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    header: ATTENDANCE_HEADER,
    rows: attendanceRows(members),
    rowTones: members.map((m) => m.level),
    legend:
      "Yeşil: sorun yok · Turuncu: bir devamsızlık daha olursa sınırı geçer · Kırmızı: sınırı geçti (Uyarı)",
    filename: "arkhe-devam",
    utf8Name: `arkhe-devam-${period.label
      .toLocaleLowerCase("tr")
      .replace(/[^a-z0-9ğüşıöç]+/g, "-")
      .replace(/^-|-$/g, "")}`,
  };
}

export async function ledgerExport(request: Request): Promise<ExportTable | Response> {
  const params = new URL(request.url).searchParams;
  const year = todayIstanbul().slice(0, 4);
  const from = params.get("from") || `${year}-01-01`;
  const to = params.get("to") || `${year}-12-31`;
  const fiveYears = Date.parse(to) - Date.parse(from) > 5 * 366 * 86_400_000;
  if (!isRealDay(from) || !isRealDay(to) || to < from || fiveYears) {
    return json({ error: "Geçersiz tarih aralığı." }, 400);
  }
  return {
    title: "Muhasebe dökümü",
    subtitle: `${trDay(from)} – ${trDay(to)} · İptal edilen kayıtlar dahil değil`,
    header: LEDGER_HEADER,
    rows: ledgerRows(await csvEntries(from, to)),
    pdfOmit: ["Belge", "Kaydeden", "Kayıt no"],
    filename: `arkhe-finans-${from}-${to}`,
  };
}

export async function duesExport(request: Request): Promise<ExportTable | Response> {
  const id = new URL(request.url).searchParams.get("donem") ?? "";
  if (!z.uuid().safeParse(id).success) return json({ error: "Dönem bulunamadı." }, 404);
  const { periods, members } = await duesMatrix(todayIstanbul());
  const period = periods.find((p) => p.id === id);
  if (!period) return json({ error: "Dönem bulunamadı." }, 404);
  return {
    title: `Aidat · ${period.name}`,
    subtitle: `Son ödeme ${trDay(period.dueOn)}`,
    header: DUES_HEADER,
    rows: duesRows(members, id),
    filename: "arkhe-aidat",
    utf8Name: `arkhe-aidat-${slugOf(period.name)}`,
  };
}

export async function budgetExport(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<ExportTable | Response> {
  const report = await budgetReport((await ctx.params).id);
  if (!report) return json({ error: "Bütçe bulunamadı." }, 404);
  const rows = budgetRows(report);
  return {
    title: `${report.name} · Bütçe`,
    subtitle: `${report.rangeLabel} · ${trDay(report.asOf)} itibarıyla`,
    header: BUDGET_HEADER,
    rows,
    strongRows: rows.flatMap((r, i) => (r[1] === "Toplam" || r[0] === "Net" ? [i] : [])),
    filename: `arkhe-butce-${report.startMonth}-${report.asOf}`,
  };
}
