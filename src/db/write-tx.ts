import "server-only";
import type { ResultSet } from "@libsql/client";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { db } from "./index";
import type * as schema from "./schema";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Anything that builds queries: the db, a drizzle transaction, or the import's batch handle. */
export type Q = BaseSQLiteDatabase<"async", ResultSet, typeof schema>;

export function isBusy(error: unknown) {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: string }).code ?? "";
    const msg = e instanceof Error ? e.message : "";
    if (
      code.startsWith("SQLITE_BUSY") ||
      msg.includes("SQLITE_BUSY") ||
      msg.includes("database is locked")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A write transaction that waits its turn: the local libSQL driver fails a second writer with
 * SQLITE_BUSY at once (and a busy_timeout would block the event loop), so retry asynchronously.
 */
export async function writeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (error) {
      if (attempt >= 6 || !isBusy(error)) throw error;
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt + Math.random() * 40));
    }
  }
}
