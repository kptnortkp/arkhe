import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isRealDay } from "@/lib/finance/schemas";
import { istanbulToUtc } from "@/lib/time";
import { pushHooksEnabled } from "./config";
import { cronPushContext } from "./context";
import { runDispatcher } from "./dispatch";
import { backupFailed, storageAlert } from "./system";

/** Digests first: equal lengths for timingSafeEqual, and the secret's length never leaks. */
export function bearerMatches(header: string | null, secret: string) {
  const a = createHash("sha256")
    .update(header ?? "")
    .digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/** Hooks for a cron call; `?bugun=` alone means 08:30 on that Istanbul day. */
function contextOf(url: URL) {
  const ctx = cronPushContext(url);
  const bugun = url.searchParams.get("bugun");
  if (pushHooksEnabled() && !url.searchParams.get("simdi") && bugun && isRealDay(bugun)) {
    ctx.now = istanbulToUtc(bugun, "08:30");
  }
  return ctx;
}

/**
 * The notification step of a cron call. Never throws: the backup reply and the storage sweep
 * must not change because of it (AC 47).
 */
export async function runPushStep(
  url: URL,
  deadline: number,
  system?: { backupFailed: boolean; today: string },
) {
  try {
    const ctx = contextOf(url);
    if (ctx.dispatcherFault) throw new Error("e2e dispatcher fault");
    if (system) {
      if (system.backupFailed) await backupFailed(ctx, system.today);
      // usage() is a few aggregate queries: skip it when the backup ate the budget.
      if (Date.now() < deadline - 10_000) await storageAlert(ctx);
    }
    await runDispatcher(ctx, deadline);
  } catch (e) {
    console.error("push dispatcher failed", { name: (e as Error)?.name });
  }
}
