import "server-only";
import { db } from "./index";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isBusy(error: unknown) {
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
