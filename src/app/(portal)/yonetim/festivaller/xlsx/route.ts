import { managerOrError } from "@/lib/api";
import { downloadHeaders } from "@/lib/csv";
import { festivalWorkbook } from "@/lib/festivals/export";
import { istanbulDateOf, now } from "@/lib/time";

/** The board's festival spreadsheet, rebuilt from the portal: Festivaller and Özel Günler. */
export async function GET() {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const today = istanbulDateOf(now());
  const body = await festivalWorkbook(today);
  return new Response(new Uint8Array(body as ArrayBuffer), {
    headers: downloadHeaders(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "arkhe-festivaller.xlsx",
      `arkhe-festivaller-${today}.xlsx`,
    ),
  });
}
