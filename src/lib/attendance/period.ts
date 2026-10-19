import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { terms } from "@/db/schema";
import { addDays, istanbulDateOf, istanbulToUtc } from "@/lib/time";

export const LAST_90 = "son90";

export async function listTerms() {
  return db.select().from(terms).orderBy(desc(terms.startsOn));
}

/** Resolves ?donem=<termId|son90>; default is the term containing today, else the last 90 days. */
export async function resolvePeriod(requested?: string) {
  const all = await listTerms();
  const today = istanbulDateOf(new Date());
  const term =
    (requested && requested !== LAST_90 ? all.find((t) => t.id === requested) : undefined) ??
    (requested === LAST_90 ? undefined : all.find((t) => t.startsOn <= today && t.endsOn >= today));
  if (term) {
    return {
      key: term.id,
      label: term.name,
      from: istanbulToUtc(term.startsOn),
      to: istanbulToUtc(addDays(term.endsOn, 1)),
      terms: all,
    };
  }
  return {
    key: LAST_90,
    label: "Son 90 gün",
    from: istanbulToUtc(addDays(today, -90)),
    to: istanbulToUtc(addDays(today, 1)),
    terms: all,
  };
}
