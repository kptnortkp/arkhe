// The ledger row a hand-made income/expense/transfer writes; shared with the historical import.
import type { z } from "zod";
import type { Account } from "./categories";
import type { entrySchema } from "./schemas";

export type EntryInput = z.infer<typeof entrySchema>;

export function entryRow(d: EntryInput) {
  return {
    kind: d.kind,
    category: d.kind === "transfer" ? null : d.category,
    amountKurus: d.amount,
    occurredOn: d.occurredOn,
    account: d.account,
    toAccount: d.kind === "transfer" ? d.toAccount : null,
    description: d.description,
    counterparty: d.counterparty,
    documentUrl: d.kind === "transfer" ? null : d.documentUrl,
    sponsorId: d.kind === "income" ? d.sponsorId : null,
    eventId: d.kind === "transfer" ? null : d.eventId,
  };
}

/** Signed effect of one live row on one account, as the balance SQL computes it. */
export function entryEffect(
  row: { kind: string; account: Account; toAccount: Account | null; amountKurus: number },
  account: Account,
) {
  let v = 0;
  if (row.account === account) {
    v += row.kind === "opening" || row.kind === "income" ? row.amountKurus : -row.amountKurus;
  }
  if (row.toAccount === account) v += row.amountKurus;
  return v;
}
