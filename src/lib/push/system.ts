import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { reportMonthOf } from "@/lib/backup/schedule";
import { meters, usage } from "@/lib/storage/quota";
import { dayInstant, formatMonthYear, istanbulDateOf } from "@/lib/time";
import type { PushContext } from "./context";
import { DAY_MS, type Item } from "./copy";
import { enqueue } from "./dispatch";
import { getState, setState, STORAGE_LEVEL } from "./state";

async function conductors() {
  return (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "conductor"), isNull(users.leftAt)))
  ).map((r) => r.id);
}

/** 21: the cron backup run failed. Repeats daily while it keeps failing (D81). */
export async function backupFailed(ctx: PushContext, today: string) {
  try {
    const month = formatMonthYear(dayInstant(`${reportMonthOf(today)}-15`));
    const day = istanbulDateOf(ctx.now);
    const items: Item[] = (await conductors()).map((userId) => ({
      userId,
      kind: "backup_failed",
      group: "sistem",
      dedupeKey: `yedek-${day}`,
      title: "Aylık yedek gönderilemedi",
      body: `${month} yedeği gitmedi. Yarın sabah yeniden denenecek.`,
      line: `Yedek gönderilemedi (${month})`,
      url: "/yedek",
      tag: "yedek",
      expiresAt: new Date(ctx.now.getTime() + DAY_MS),
    }));
    await enqueue(items, ctx);
  } catch (e) {
    console.error("push backup alert failed", { name: (e as Error)?.name });
  }
}

/** 22: once per crossing of 80% and of 95%; re-armed by a run below the level (D81). */
export async function storageAlert(ctx: PushContext) {
  try {
    const all = meters(await usage());
    const pct = Math.max(...all.map((m) => m.pct));
    // Only storage and uploads stop at 95%; transfer and reads stop at 100%, so they can't say "dolu".
    const full = all.some((m) => (m.key === "storage" || m.key === "uploads") && m.pct >= 95);
    const level = full ? 95 : pct >= 80 ? 80 : 0;
    const prev = Number((await getState(STORAGE_LEVEL)) ?? "0");
    if (level !== prev) await setState(STORAGE_LEVEL, String(level));
    if (level <= prev) return;
    const day = istanbulDateOf(ctx.now);
    const items: Item[] = (await conductors()).map((userId) => ({
      userId,
      kind: full ? "storage_95" : "storage_80",
      group: "sistem",
      dedupeKey: `depolama-${level}-${day}`,
      title: full ? "Kayıt alanı dolu" : `Kayıt alanı %${pct} dolu`,
      body: full
        ? "Yeni kayıt yüklenemiyor. Depolama sayfasına bak."
        : "Depolama sayfasına bak; gerekirse eski kayıtları erken sil.",
      line: full ? "Kayıt alanı dolu; yükleme durdu" : `Kayıt alanı %${pct} dolu`,
      url: "/odevler/depolama",
      tag: "depolama",
      expiresAt: new Date(ctx.now.getTime() + DAY_MS),
    }));
    await enqueue(items, ctx);
  } catch (e) {
    console.error("push storage alert failed", { name: (e as Error)?.name });
  }
}
