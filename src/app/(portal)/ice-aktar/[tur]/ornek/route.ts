import { json, managerOrError } from "@/lib/api";
import { csvHeaders } from "@/lib/csv";
import { fileBase } from "@/lib/import/def";
import { defOf } from "@/lib/import/defs";
import { sampleCsv } from "@/lib/import/docs";
import { isSlug } from "@/lib/import/limits";

export async function GET(_request: Request, ctx: RouteContext<"/ice-aktar/[tur]/ornek">) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const { tur } = await ctx.params;
  if (!isSlug(tur)) return json({ error: "Bulunamadı." }, 404);
  const def = defOf(tur);
  return new Response(sampleCsv(def), { headers: csvHeaders(`${fileBase(def)}.csv`) });
}
