import { managerOrError } from "@/lib/api";
import { autoCloseStale } from "@/lib/attendance/close";
import { attendanceCsv } from "@/lib/attendance/csv";
import { resolvePeriod } from "@/lib/attendance/period";
import { attendanceStats } from "@/lib/attendance/stats";
import { collator } from "@/lib/format";

export async function GET(request: Request) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  await autoCloseStale();
  const params = new URL(request.url).searchParams;
  const period = await resolvePeriod(params.get("donem") ?? undefined);
  const stats = await attendanceStats({ from: period.from, to: period.to });
  const rows = stats.members
    .filter((m) => params.get("uyari") !== "1" || m.warning)
    .sort((a, b) => collator.compare(a.name, b.name));
  const slug = period.label
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9ğüşıöç]+/g, "-")
    .replace(/^-|-$/g, "");
  return new Response(attendanceCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="arkhe-devam.csv"; filename*=UTF-8''${encodeURIComponent(`arkhe-devam-${slug}.csv`)}`,
      "Cache-Control": "no-store",
    },
  });
}
