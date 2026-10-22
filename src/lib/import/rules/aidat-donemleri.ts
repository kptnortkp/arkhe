import "server-only";
import { duesPeriods, importItems } from "@/db/schema";
import { periodOverlap, periodSchema } from "@/lib/finance/periods";
import { insertChunks, type BatchDb } from "../tx";
import { day, Errors, json, Keys, money, str, type Rules } from "./common";

const FIELD = {
  name: "ad",
  startsOn: "baslangic",
  endsOn: "bitis",
  dueOn: "son_odeme",
  amount: "tutar",
  reducedAmount: "indirimli_tutar",
} as const;

const reads = (q: BatchDb) => ({ periods: q.select().from(duesPeriods) });

type Amount = { kurus: number; text: string } | null;

export const aidatDonemleriRules: Rules<ReturnType<typeof reads>> = {
  reads,
  plan(rows, snap, ctx) {
    const errors = new Errors();
    const keys = new Keys();
    const byName = new Map(snap.periods.map((p) => [p.name, p]));
    const taken = snap.periods.map((p) => ({ id: p.id, name: p.name, startsOn: p.startsOn, endsOn: p.endsOn }));
    const created: (typeof duesPeriods.$inferInsert & { id: string })[] = [];
    const effects: string[] = [];
    let unchanged = 0;
    for (const row of rows) {
      errors.absorb(row);
      const name = str(row.v.ad);
      if (name) keys.claim(errors, row, "ad", name);
      if (!errors.ok(row)) continue;
      const amount = row.v.tutar as Amount;
      const reduced = row.v.indirimli_tutar as Amount;
      const parsed = periodSchema.safeParse({
        name,
        startsOn: row.v.baslangic,
        endsOn: row.v.bitis,
        dueOn: row.v.son_odeme,
        amount: amount?.text,
        reducedAmount: reduced?.text,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.add(row, FIELD[issue.path[0] as keyof typeof FIELD] ?? null, issue.message);
        }
        continue;
      }
      const d = parsed.data;
      const existing = byName.get(d.name);
      if (existing) {
        const same =
          existing.startsOn === d.startsOn &&
          existing.endsOn === d.endsOn &&
          existing.dueOn === d.dueOn &&
          existing.amountKurus === d.amount &&
          existing.reducedAmountKurus === d.reducedAmount;
        if (same) unchanged++;
        else errors.add(row, "ad", "Bu adla farklı bir aidat dönemi var.");
        continue;
      }
      const overlap = periodOverlap(taken, d.startsOn, d.endsOn);
      if (overlap) {
        errors.add(row, "baslangic", overlap);
        continue;
      }
      const id = crypto.randomUUID();
      taken.push({ id, name: d.name, startsOn: d.startsOn, endsOn: d.endsOn });
      created.push({
        id,
        name: d.name,
        startsOn: d.startsOn,
        endsOn: d.endsOn,
        dueOn: d.dueOn,
        amountKurus: d.amount,
        reducedAmountKurus: d.reducedAmount,
        createdBy: ctx.actor.id,
        createdAt: ctx.now,
      });
      effects.push(
        `${d.name}: ${day(d.startsOn)} – ${day(d.endsOn)}, son ödeme ${day(d.dueOn)} · ${money(d.amount)}${d.reducedAmount ? ` (indirimli ${money(d.reducedAmount)})` : ""}`,
      );
    }
    return {
      errors: errors.sorted(),
      warnings: [],
      effects,
      notes: [],
      counts: { added: created.length, updated: 0, unchanged },
      links: created.length
        ? [
            {
              label: "Aidat",
              href: `/finans/aidat?donem=${[...created].sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0].id}`,
            },
          ]
        : undefined,
      deactivations: 0,
      writes: (q, batchId) => [
        ...insertChunks(q, duesPeriods, created),
        ...insertChunks(
          q,
          importItems,
          created.map((p) => ({
            batchId,
            target: "dues_period" as const,
            action: "create" as const,
            duesPeriodId: p.id,
            afterJson: json(periodSnapshot(p)),
          })),
        ),
      ],
    };
  },
};

export function periodSnapshot(p: {
  name: string;
  startsOn: string;
  endsOn: string;
  dueOn: string;
  amountKurus: number;
  reducedAmountKurus?: number | null;
}) {
  return {
    name: p.name,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    dueOn: p.dueOn,
    amountKurus: p.amountKurus,
    reducedAmountKurus: p.reducedAmountKurus ?? null,
  };
}
