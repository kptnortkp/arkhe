import { z } from "zod";
import { json, managerOrError } from "@/lib/api";
import { csvDocument, csvHeaders } from "@/lib/csv";
import { duesMatrix, todayIstanbul } from "@/lib/finance/queries";
import { collator, searchKey } from "@/lib/format";
import { DUES_RATE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { csvAmount } from "@/lib/money";

export async function GET(request: Request) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("donem") ?? "";
  if (!z.uuid().safeParse(id).success) return json({ error: "Dönem bulunamadı." }, 404);
  const { periods, members } = await duesMatrix(todayIstanbul());
  const period = periods.find((p) => p.id === id);
  if (!period) return json({ error: "Dönem bulunamadı." }, 404);
  const rows = members
    .filter((m) => m.cells.has(id))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((m) => {
      const s = m.cells.get(id)!.status;
      return [
        m.name,
        m.voicePart ? VOICE_PART_LABELS[m.voicePart] : "",
        DUES_RATE_LABELS[m.rate],
        csvAmount(s.owed),
        csvAmount(s.paid),
        csvAmount(s.remaining),
        s.label,
      ];
    });
  const body = csvDocument(
    ["Ad soyad", "Partisyon", "Oran", "Borç", "Ödenen", "Kalan", "Durum"],
    rows,
  );
  const slug = searchKey(period.name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new Response(body, { headers: csvHeaders("arkhe-aidat.csv", `arkhe-aidat-${slug}.csv`) });
}
