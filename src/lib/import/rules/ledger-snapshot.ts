import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { financeEntries, importBatches, importItems, type KayitScope } from "@/db/schema";
import type { Account } from "@/lib/finance/categories";
import { entryEffect } from "@/lib/finance/entries";
import { signedBalance } from "@/lib/finance/queries-internal";
import type { BatchDb } from "../tx";
import type { BalancePreview } from "../types";

export const openingRead = (q: BatchDb) =>
  q
    .select({ on: sql<string | null>`min(${financeEntries.occurredOn})` })
    .from(financeEntries)
    .where(and(eq(financeEntries.kind, "opening"), isNull(financeEntries.voidedAt)));

export const balanceRead = (q: BatchDb) =>
  q
    .select({ cash: signedBalance("cash"), bank: signedBalance("bank") })
    .from(financeEntries)
    .where(isNull(financeEntries.voidedAt));

/** This scope's live items with the entries they point at (for "unchanged" and conflicts). */
export const itemEntriesRead = (q: BatchDb, scope: KayitScope) =>
  q
    .select({
      kayitNo: importItems.kayitNo,
      target: importItems.target,
      overridePeriodId: importItems.overridePeriodId,
      overrideUserId: importItems.overrideUserId,
      afterJson: importItems.afterJson,
      batchAt: importBatches.createdAt,
      entry: {
        kind: financeEntries.kind,
        category: financeEntries.category,
        amountKurus: financeEntries.amountKurus,
        occurredOn: financeEntries.occurredOn,
        account: financeEntries.account,
        toAccount: financeEntries.toAccount,
        description: financeEntries.description,
        counterparty: financeEntries.counterparty,
        documentUrl: financeEntries.documentUrl,
        sponsorId: financeEntries.sponsorId,
        eventId: financeEntries.eventId,
        memberId: financeEntries.memberId,
        duesPeriodId: financeEntries.duesPeriodId,
        voidedAt: financeEntries.voidedAt,
        revision: financeEntries.revision,
        updatedAt: financeEntries.updatedAt,
      },
    })
    .from(importItems)
    .innerJoin(importBatches, eq(importBatches.id, importItems.batchId))
    .leftJoin(financeEntries, eq(financeEntries.id, importItems.financeEntryId))
    .where(eq(importItems.kayitScope, scope));

export function balancePreview(
  before: { cash: number; bank: number } | undefined,
  rows: { kind: string; account: Account; toAccount: Account | null; amountKurus: number }[],
  hint: string,
): BalancePreview {
  const cash = Number(before?.cash ?? 0);
  const bank = Number(before?.bank ?? 0);
  return {
    cash: { before: cash, after: cash + rows.reduce((s, r) => s + entryEffect(r, "cash"), 0) },
    bank: { before: bank, after: bank + rows.reduce((s, r) => s + entryEffect(r, "bank"), 0) },
    hint,
  };
}
