import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Role } from "@/db/schema";
import { istanbulDateOf, now } from "@/lib/time";
import { canEarlyClean } from "@/lib/review/access";
import { storageConfigured } from "./driver";
import { cachedUsage, meters, playbackPausedFor, uploadsPausedFor, type Meter } from "./quota";
import { earlyCleanCutoff } from "./sweep";

export type Gauge = {
  configured: boolean;
  meters: Meter[];
  uploadsPaused: boolean;
  playbackPaused: boolean;
  lastSweep: { at: Date; deleted: number; status: string } | null;
  /** Conductor only (D19): what `... şimdi sil (<n> kayıt, <MB>)` would delete. */
  earlyClean: { count: number; bytes: number } | null;
};

/** /odevler/depolama for managers (the page checks the role). */
export async function storageGauge(viewer: { role: Role }): Promise<Gauge> {
  const u = await cachedUsage();
  const [[sweep], early] = await Promise.all([
    db.all<{ at: number; deleted: number; status: string }>(sql`
      select finished_at as at, deleted, status from storage_sweeps order by id desc limit 1`),
    canEarlyClean(viewer.role) ? earlyCleanPreview() : Promise.resolve(null),
  ]);
  return {
    configured: storageConfigured(),
    meters: meters(u),
    uploadsPaused: uploadsPausedFor(u, 0),
    playbackPaused: playbackPausedFor(u),
    lastSweep: sweep
      ? {
          at: new Date(Number(sweep.at) * 1000),
          deleted: Number(sweep.deleted),
          status: sweep.status,
        }
      : null,
    earlyClean: early,
  };
}

/** Commented takes whose comment day + 30 <= today, audio still present. */
export async function earlyCleanPreview() {
  const cut = Math.floor(earlyCleanCutoff(istanbulDateOf(now())).getTime() / 1000);
  const [row] = await db.all<{ n: number; b: number }>(sql`
    select count(*) as n, coalesce(sum(size_bytes), 0) as b from recordings
    where audio_deleted_at is null and commented_at is not null and commented_at < ${cut}`);
  return { count: Number(row?.n ?? 0), bytes: Number(row?.b ?? 0) };
}
