import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationState } from "@/db/schema";

export const DUES_SWITCH = "aidat-bildirimleri";
export const REPERTOIRE_SINCE = "repertuvar-since";
export const STORAGE_LEVEL = "depolama-seviye";
export const morningKey = (day: string) => `sabah-${day}`;

export async function getState(key: string) {
  const [row] = await db
    .select({ value: notificationState.value })
    .from(notificationState)
    .where(eq(notificationState.key, key));
  return row?.value ?? null;
}

export async function setState(key: string, value: string, by: string | null = null) {
  await db
    .insert(notificationState)
    .values({ key, value, updatedBy: by })
    .onConflictDoUpdate({
      target: notificationState.key,
      set: { value, updatedBy: by, updatedAt: sql`(unixepoch())` },
    });
}

/** True for exactly one caller per key: the morning run's once-per-day guard. */
export async function claim(key: string) {
  const rows = await db
    .insert(notificationState)
    .values({ key, value: "1" })
    .onConflictDoNothing()
    .returning({ key: notificationState.key });
  return rows.length === 1;
}

export async function unclaim(key: string) {
  await db.delete(notificationState).where(eq(notificationState.key, key));
}

export async function duesPushEnabled() {
  return (await getState(DUES_SWITCH)) === "1";
}
