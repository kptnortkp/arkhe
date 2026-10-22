import { json, managerOrError } from "@/lib/api";
import { csvDocument, csvHeaders } from "@/lib/csv";
import { BUDGET_HEADER, budgetRows } from "@/lib/finance/csv";
import { budgetReport } from "@/lib/finance/queries";

export async function GET(_request: Request, ctx: RouteContext<"/finans/butce/[id]/csv">) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const report = await budgetReport(id);
  if (!report) return json({ error: "Bütçe bulunamadı." }, 404);
  const body = csvDocument(BUDGET_HEADER, budgetRows(report));
  return new Response(body, {
    headers: csvHeaders(`arkhe-butce-${report.startMonth}-${report.asOf}.csv`),
  });
}
