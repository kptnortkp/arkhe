import { json, managerOrError } from "@/lib/api";
import { csvDocument, csvHeaders } from "@/lib/csv";
import { csvEntries, todayIstanbul } from "@/lib/finance/queries";
import { isRealDay } from "@/lib/finance/schemas";
import { ACCOUNT_LABELS, CATEGORY_LABELS, ENTRY_KIND_LABELS } from "@/lib/labels";
import { csvAmount } from "@/lib/money";

const HEADER = [
  "Tarih",
  "Tür",
  "Kategori",
  "Açıklama",
  "Kimden/Kime",
  "Sponsor",
  "Etkinlik",
  "Üye",
  "Aidat dönemi",
  "Hesap",
  "Gelir",
  "Gider",
  "Virman/Açılış",
  "Belge",
  "Kaydeden",
  "Kayıt no",
];

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
  const rows = await csvEntries(from, to);
  const body = csvDocument(
    HEADER,
    rows.map((e) => [
      e.occurredOn,
      ENTRY_KIND_LABELS[e.kind],
      e.category ? CATEGORY_LABELS[e.category] : "",
      e.description,
      e.counterparty,
      e.sponsorName,
      e.eventName,
      e.memberName,
      e.periodName,
      e.toAccount
        ? `${ACCOUNT_LABELS[e.account]} → ${ACCOUNT_LABELS[e.toAccount]}`
        : ACCOUNT_LABELS[e.account],
      e.kind === "income" ? csvAmount(e.amountKurus) : "",
      e.kind === "expense" ? csvAmount(e.amountKurus) : "",
      e.kind === "transfer" || e.kind === "opening" ? csvAmount(e.amountKurus) : "",
      e.documentUrl,
      e.creatorName,
      e.id,
    ]),
  );
  return new Response(body, { headers: csvHeaders(`arkhe-finans-${from}-${to}.csv`) });
}
