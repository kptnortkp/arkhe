import { json, managerOrError } from "@/lib/api";
import { csvDocument, csvHeaders } from "@/lib/csv";
import { LEDGER_HEADER, ledgerRows } from "@/lib/finance/csv";
import { csvEntries, todayIstanbul } from "@/lib/finance/queries";
import { isRealDay } from "@/lib/finance/schemas";

export async function GET(request: Request) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const params = new URL(request.url).searchParams;
  const year = todayIstanbul().slice(0, 4);
  const from = params.get("from") || `${year}-01-01`;
  const to = params.get("to") || `${year}-12-31`;
  const fiveYears = Date.parse(to) - Date.parse(from) > 5 * 366 * 86_400_000;
  if (!isRealDay(from) || !isRealDay(to) || to < from || fiveYears) {
    return json({ error: "Geçersiz tarih aralığı." }, 400);
  }
  const body = csvDocument(LEDGER_HEADER, ledgerRows(await csvEntries(from, to)));
  return new Response(body, { headers: csvHeaders(`arkhe-finans-${from}-${to}.csv`) });
}
