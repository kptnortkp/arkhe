import { collator } from "@/lib/format";
import {
  ACCOUNT_LABELS,
  CATEGORY_LABELS,
  DUES_RATE_LABELS,
  ENTRY_KIND_LABELS,
  VOICE_PART_LABELS,
} from "@/lib/labels";
import { csvNum, type CsvValue } from "@/lib/csv";
import { csvAmount } from "@/lib/money";
import type { BudgetTotal, ComputedReport } from "./budget";
import type { VoicePart } from "@/db/schema";
import type { Account, Category, DuesRate, EntryKind } from "./categories";
import type { DuesStatus } from "./dues";

export const LEDGER_HEADER = [
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

export type LedgerCsvRow = {
  id: string;
  kind: EntryKind;
  category: Category | null;
  amountKurus: number;
  occurredOn: string;
  account: Account;
  toAccount: Account | null;
  description: string | null;
  counterparty: string | null;
  documentUrl: string | null;
  sponsorName: string | null;
  eventName: string | null;
  memberName: string | null;
  periodName: string | null;
  creatorName: string | null;
};

export function ledgerRows(rows: LedgerCsvRow[]) {
  return rows.map((e) => [
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
  ]);
}

export const DUES_HEADER = ["Ad soyad", "Partisyon", "Oran", "Borç", "Ödenen", "Kalan", "Durum"];

type DuesCsvMember = {
  name: string;
  voicePart: VoicePart | null;
  rate: DuesRate;
  cells: Map<string, { status: DuesStatus }>;
};

/** One period's rows, sorted by name, for everyone who owes or paid it. */
export function duesRows(members: DuesCsvMember[], periodId: string) {
  return members
    .filter((m) => m.cells.has(periodId))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((m) => {
      const s = m.cells.get(periodId)!.status;
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
}

export const BUDGET_HEADER = [
  "Tür",
  "Kategori",
  "Plan",
  "Gerçekleşen",
  "Fark",
  "Gerçekleşme",
  "Durum",
];

const amountCell = (kurus: number) => csvNum(csvAmount(kurus));
const pctCell = (pct: number | null) => (pct === null ? "" : `%${pct}`);

/** AC 37: shown lines per side, each side's total, then the net; Fark is actual − plan, signed. */
export function budgetRows(report: ComputedReport): CsvValue[][] {
  const rows: CsvValue[][] = [];
  const totalRow = (label: string, t: BudgetTotal): CsvValue[] => [
    label,
    "Toplam",
    amountCell(t.planKurus),
    amountCell(t.actualKurus),
    amountCell(t.diffKurus),
    pctCell(t.pct),
    "",
  ];
  for (const [kind, label] of [
    ["income", "Gelir"],
    ["expense", "Gider"],
  ] as const) {
    for (const l of report.lines.filter((x) => x.kind === kind)) {
      rows.push([
        label,
        CATEGORY_LABELS[l.category],
        amountCell(l.planKurus),
        amountCell(l.actualKurus),
        amountCell(l.diffKurus),
        pctCell(l.pct),
        l.signalLabel,
      ]);
    }
    rows.push(totalRow(label, report.totals[kind]));
  }
  const net = report.totals.net;
  rows.push([
    "Net",
    "Gelir − gider",
    amountCell(net.planKurus),
    amountCell(net.actualKurus),
    amountCell(net.actualKurus - net.planKurus),
    "",
    "",
  ]);
  return rows;
}
