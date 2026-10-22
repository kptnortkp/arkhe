import { json, managerOrError } from "@/lib/api";
import { fileBase } from "@/lib/import/def";
import { defOf } from "@/lib/import/defs";
import { isSlug } from "@/lib/import/limits";
import { liveMarkdown } from "@/lib/import/queries";

export async function GET(_request: Request, ctx: RouteContext<"/ice-aktar/[tur]/talimat">) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const { tur } = await ctx.params;
  if (!isSlug(tur)) return json({ error: "Bulunamadı." }, 404);
  const def = defOf(tur);
  return new Response(await liveMarkdown(def), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileBase(def)}.md"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
