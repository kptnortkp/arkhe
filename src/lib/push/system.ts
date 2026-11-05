import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, type Role } from "@/db/schema";
import { reportMonthOf } from "@/lib/backup/schedule";
import { meters, playbackPausedFor, usage, type MeterKey } from "@/lib/storage/quota";
import { dayInstant, formatMonthYear, istanbulDateOf } from "@/lib/time";
import type { PushContext } from "./context";
import { DAY_MS, type Item } from "./copy";
import { enqueue } from "./dispatch";
import { getState, setState, STORAGE_LEVEL } from "./state";

async function activeWith(roles: Role[]) {
  return (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, roles), isNull(users.leftAt)))
  ).map((r) => r.id);
}
const conductors = () => activeWith(["conductor"]);

const METER_NAMES: Record<MeterKey, string> = {
  storage: "Kayıt alanı",
  uploads: "Aylık yükleme hakkı",
  transfer: "Aylık dinleme kotası",
  reads: "Aylık dinleme kotası",
};

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

/**
 * 22: once per crossing of 80%, of 95% (uploads stop) and of 100% (playback stops); re-armed by a
 * run below the level (D81). The conductor and the board both get it.
 */
export async function storageAlert(ctx: PushContext) {
  try {
    const u = await usage();
    const all = meters(u);
    const top = all.reduce((a, b) => (b.pct > a.pct ? b : a));
    // Only storage and uploads stop at 95%; transfer and reads stop at 100%, so they can't say "dolu".
    const full = all.some((m) => (m.key === "storage" || m.key === "uploads") && m.pct >= 95);
    const silent = playbackPausedFor(u);
    const level = silent ? 100 : full ? 95 : top.pct >= 80 ? 80 : 0;
    const prev = Number((await getState(STORAGE_LEVEL)) ?? "0");
    if (level !== prev) await setState(STORAGE_LEVEL, String(level));
    if (level <= prev) return;
    const day = istanbulDateOf(ctx.now);
    const copy =
      level === 100
        ? {
            kind: "storage_100" as const,
            title: "Dinleme durdu",
            body: "Aylık ücretsiz dinleme kotası doldu. Eski dinlemeler 30 günü doldurdukça kendiliğinden açılır; MIDI çalmaya devam eder.",
            line: "Dinleme kotası doldu; kayıtlar çalmıyor",
          }
        : level === 95
          ? {
              kind: "storage_95" as const,
              title: "Kayıt alanı dolu",
              body: "Yeni kayıt yüklenemiyor. Depolama sayfasına bak.",
              line: "Kayıt alanı dolu; yükleme durdu",
            }
          : {
              kind: "storage_80" as const,
              title: `${METER_NAMES[top.key]} %${top.pct} dolu`,
              body:
                top.key === "storage" || top.key === "uploads"
                  ? "Depolama sayfasına bak; gerekirse eski kayıtları erken sil."
                  : "Dolarsa kayıtlar bir süre çalmaz. Depolama sayfasına bak.",
              line: `${METER_NAMES[top.key]} %${top.pct} dolu`,
            };
    const items: Item[] = (await activeWith(["conductor", "board"])).map((userId) => ({
      userId,
      ...copy,
      group: "sistem",
      dedupeKey: `depolama-${level}-${day}`,
      url: "/odevler/depolama",
      tag: "depolama",
      expiresAt: new Date(ctx.now.getTime() + DAY_MS),
    }));
    await enqueue(items, ctx);
  } catch (e) {
    console.error("push storage alert failed", { name: (e as Error)?.name });
  }
}
