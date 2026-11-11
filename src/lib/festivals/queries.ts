import "server-only";
import { and, asc, eq, gte, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { festivals, specialDays } from "@/db/schema";
import { requireManager, requireUser } from "@/lib/auth/dal";
import { collator } from "@/lib/format";

const UUID = /^[0-9a-f-]{36}$/i;

export type Festival = typeof festivals.$inferSelect;
export type SpecialDay = typeof specialDays.$inferSelect;

/** Dated festivals by start day, then the undated ones, then by name. */
export function sortFestivals(rows: Festival[]) {
  return rows.sort(
    (a, b) =>
      Number(a.startsOn === null) - Number(b.startsOn === null) ||
      (a.startsOn ?? "").localeCompare(b.startsOn ?? "") ||
      collator.compare(a.name, b.name),
  );
}

export async function listFestivals() {
  await requireManager();
  return sortFestivals(await db.select().from(festivals));
}

export async function getFestival(id: string) {
  await requireManager();
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(festivals).where(eq(festivals.id, id));
  return row ?? null;
}

/** Festivals running on, or with a deadline on, any day in [first, last]. Callers check the role. */
export async function festivalsBetween(first: string, last: string) {
  return db
    .select()
    .from(festivals)
    .where(
      and(
        ne(festivals.status, "declined"),
        or(
          and(
            lte(festivals.startsOn, last),
            gte(sql`coalesce(${festivals.endsOn}, ${festivals.startsOn})`, first),
          ),
          and(gte(festivals.deadlineOn, first), lte(festivals.deadlineOn, last)),
        ),
      ),
    );
}

/** Deadlines in [today, until] we have not applied for yet, soonest first. Callers check the role. */
export async function deadlinesWithin(today: string, until: string) {
  return db
    .select()
    .from(festivals)
    .where(
      and(
        eq(festivals.status, "watching"),
        gte(festivals.deadlineOn, today),
        lte(festivals.deadlineOn, until),
      ),
    )
    .orderBy(asc(festivals.deadlineOn), asc(festivals.name));
}

/** Special days in [from, to]; every signed-in member may see them. */
export async function specialDaysBetween(from: string, to: string) {
  return db
    .select()
    .from(specialDays)
    .where(and(gte(specialDays.day, from), lte(specialDays.day, to)))
    .orderBy(asc(specialDays.day), asc(specialDays.title));
}

export async function listSpecialDays(from: string, to: string) {
  await requireUser();
  return specialDaysBetween(from, to);
}

export async function getSpecialDay(id: string) {
  await requireManager();
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(specialDays).where(eq(specialDays.id, id));
  return row ?? null;
}
