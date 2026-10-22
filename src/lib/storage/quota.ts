import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { storageEvents, type StorageArea } from "@/db/schema";
import { now } from "@/lib/time";
import {
  PLAYBACK_STOP_RATIO,
  QUOTA_WINDOW_MS,
  READ_LIMIT,
  RECORDING_MAX_BYTES,
  STORAGE_LIMIT_BYTES,
  TRANSFER_LIMIT_BYTES,
  UPLOAD_LIMIT,
  UPLOAD_STOP_RATIO,
  WARN_RATIO,
} from "./limits";

export type Usage = {
  storedBytes: number;
  uploads: number;
  /** Every delivery, MIDI included: what the gauge shows and Blob bills. */
  reads: number;
  transferBytes: number;
  /** Recording deliveries only: the playback stop never counts MIDI (D20). */
  recordingReads: number;
  recordingTransferBytes: number;
};

/** Our own counters (D19): bytes still in the store (queued ones included) and 30-day events. */
export async function usage(): Promise<Usage> {
  const since = Math.floor((now().getTime() - QUOTA_WINDOW_MS) / 1000);
  const [row] = await db.all<{
    s: number;
    u: number;
    r: number;
    t: number;
    rr: number;
    rt: number;
  }>(sql`
    select
      (select coalesce(sum(size_bytes), 0) from recordings where audio_deleted_at is null)
      + (select coalesce(sum(size_bytes), 0) from midi_files)
      + (select coalesce(sum(size_bytes), 0) from storage_deletions where state = 'pending') as s,
      (select count(*) from storage_events where kind = 'put' and at > ${since}) as u,
      g.r, g.t, g.rr, g.rt
    from (
      select count(*) as r, 2 * coalesce(sum(bytes), 0) as t,
        coalesce(sum(area is not 'midi'), 0) as rr,
        2 * coalesce(sum(case when area is not 'midi' then bytes else 0 end), 0) as rt
      from storage_events where kind = 'get' and at > ${since}
    ) g
  `);
  return {
    storedBytes: Number(row?.s ?? 0),
    uploads: Number(row?.u ?? 0),
    reads: Number(row?.r ?? 0),
    transferBytes: Number(row?.t ?? 0),
    recordingReads: Number(row?.rr ?? 0),
    recordingTransferBytes: Number(row?.rt ?? 0),
  };
}

/** Once per request for the layout banner and the page. */
export const cachedUsage = cache(usage);

export type MeterKey = "storage" | "uploads" | "transfer" | "reads";
export type MeterState = "ok" | "warn" | "full";
export type Meter = { key: MeterKey; used: number; limit: number; pct: number; state: MeterState };

export function meters(u: Usage): Meter[] {
  const make = (key: MeterKey, used: number, limit: number, stop: number): Meter => {
    const ratio = used / limit;
    return {
      key,
      used,
      limit,
      pct: Math.floor(ratio * 100),
      state: ratio >= stop ? "full" : ratio >= WARN_RATIO ? "warn" : "ok",
    };
  };
  return [
    make("storage", u.storedBytes, STORAGE_LIMIT_BYTES, UPLOAD_STOP_RATIO),
    make("uploads", u.uploads, UPLOAD_LIMIT, UPLOAD_STOP_RATIO),
    make("transfer", u.transferBytes, TRANSFER_LIMIT_BYTES, PLAYBACK_STOP_RATIO),
    make("reads", u.reads, READ_LIMIT, PLAYBACK_STOP_RATIO),
  ];
}

/** D20, on the projected value: this file and this operation included. */
export function uploadsPausedFor(u: Usage, incomingBytes: number) {
  return (
    (u.storedBytes + incomingBytes) / STORAGE_LIMIT_BYTES >= UPLOAD_STOP_RATIO ||
    (u.uploads + 1) / UPLOAD_LIMIT >= UPLOAD_STOP_RATIO
  );
}

export async function uploadsPaused(incomingBytes: number) {
  return uploadsPausedFor(await usage(), incomingBytes);
}

/** The same rule once holdKey has counted this file and this operation. */
export async function uploadsPausedAfterHold() {
  const u = await usage();
  return (
    u.storedBytes / STORAGE_LIMIT_BYTES >= UPLOAD_STOP_RATIO ||
    u.uploads / UPLOAD_LIMIT >= UPLOAD_STOP_RATIO
  );
}

/** The pessimistic transfer estimate or the read count at 100% stops recording playback. */
export function playbackPausedFor(u: Usage) {
  return (
    u.recordingTransferBytes / TRANSFER_LIMIT_BYTES >= PLAYBACK_STOP_RATIO ||
    u.recordingReads / READ_LIMIT >= PLAYBACK_STOP_RATIO
  );
}

/** For managers' banners: the highest meter percent, and whether uploads are stopped now. */
export async function storageWarning() {
  const u = await cachedUsage();
  const all = meters(u);
  return {
    pct: Math.max(...all.map((m) => m.pct)),
    warn: all.some((m) => m.state !== "ok"),
    full: uploadsPausedFor(u, 0) || playbackPausedFor(u),
    uploadsPaused: uploadsPausedFor(u, 0),
  };
}

/** A successful delivery (counted as a simple operation and transfer). */
export async function logDelivery(area: StorageArea, bytes: number) {
  const clamped = Math.min(Math.max(Math.round(bytes), 1), RECORDING_MAX_BYTES);
  try {
    await db.insert(storageEvents).values({ kind: "get", area, bytes: clamped, at: now() });
  } catch (error) {
    console.error("storage event not logged", { name: (error as Error)?.name });
  }
}
