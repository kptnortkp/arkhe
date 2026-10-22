import { managerOrError } from "@/lib/api";
import { csvDocument, csvHeaders } from "@/lib/csv";
import { MEMBER_LIST_HEADER, memberListRows } from "@/lib/import/queries";
import { istanbulDateOf, now } from "@/lib/time";

export async function GET() {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const body = csvDocument(MEMBER_LIST_HEADER, await memberListRows());
  return new Response(body, { headers: csvHeaders(`arkhe-uyeler-${istanbulDateOf(now())}.csv`) });
}
