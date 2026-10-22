import "server-only";
import { importItems, terms } from "@/db/schema";
import { termConflict, termSchema } from "@/lib/attendance/schemas";
import { insertChunks, type BatchDb } from "../tx";
import { day, Errors, Keys, str, type Rules } from "./common";

const FIELD = { name: "ad", startsOn: "baslangic", endsOn: "bitis" } as const;

const reads = (q: BatchDb) => ({
  terms: q.select({ name: terms.name, startsOn: terms.startsOn, endsOn: terms.endsOn }).from(terms),
});

export const donemlerRules: Rules<ReturnType<typeof reads>> = {
  reads,
  plan(rows, snap) {
    const errors = new Errors();
    const keys = new Keys();
    const byName = new Map(snap.terms.map((t) => [t.name, t]));
    const taken = [...snap.terms];
    const created: { id: string; name: string; startsOn: string; endsOn: string }[] = [];
    let unchanged = 0;
    const effects: string[] = [];
    for (const row of rows) {
      errors.absorb(row);
      const name = str(row.v.ad);
      if (name) keys.claim(errors, row, "ad", name);
      if (!errors.ok(row)) continue;
      const parsed = termSchema.safeParse({ name, startsOn: row.v.baslangic, endsOn: row.v.bitis });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.add(row, FIELD[issue.path[0] as keyof typeof FIELD] ?? null, issue.message);
        }
        continue;
      }
      const d = parsed.data;
      const existing = byName.get(d.name);
      if (existing) {
        if (existing.startsOn === d.startsOn && existing.endsOn === d.endsOn) unchanged++;
        else errors.add(row, "ad", "Bu adla farklı tarihli bir dönem var.");
        continue;
      }
      const conflict = termConflict(taken, d);
      if (conflict) {
        errors.add(row, conflict.field === "name" ? "ad" : "baslangic", conflict.message);
        continue;
      }
      taken.push(d);
      created.push({ id: crypto.randomUUID(), ...d });
      effects.push(`${d.name}: ${day(d.startsOn)} – ${day(d.endsOn)}`);
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
              label: "Raporlar",
              href: `/raporlar?donem=${[...created].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0].id}`,
            },
          ]
        : undefined,
      deactivations: 0,
      writes: (q, batchId) => [
        ...insertChunks(q, terms, created),
        ...insertChunks(
          q,
          importItems,
          created.map((t) => ({ batchId, target: "term" as const, action: "create" as const, termId: t.id })),
        ),
      ],
    };
  },
};
