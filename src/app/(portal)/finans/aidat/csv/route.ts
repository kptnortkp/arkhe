import { z } from "zod";
import { json, managerOrError } from "@/lib/api";
import { csvDocument, csvHeaders } from "@/lib/csv";
import { DUES_HEADER, duesRows } from "@/lib/finance/csv";
import { duesMatrix, todayIstanbul } from "@/lib/finance/queries";
import { searchKey } from "@/lib/format";

export async function GET(request: Request) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("donem") ?? "";
  if (!z.uuid().safeParse(id).success) return json({ error: "Dönem bulunamadı." }, 404);
  const { periods, members } = await duesMatrix(todayIstanbul());
  const period = periods.find((p) => p.id === id);
  if (!period) return json({ error: "Dönem bulunamadı." }, 404);
  const body = csvDocument(DUES_HEADER, duesRows(members, id));
  const slug = searchKey(period.name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new Response(body, { headers: csvHeaders("arkhe-aidat.csv", `arkhe-aidat-${slug}.csv`) });
}
