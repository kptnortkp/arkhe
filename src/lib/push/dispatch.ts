import "server-only";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { notifications, notificationState, pushRemoved, pushSubscriptions } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { addDays, istanbulDateOf, istanbulTimeOf, istanbulToUtc } from "@/lib/time";
import { duesPushEnabled, loadPeople, prefOn, subscriptionsOf, wants } from "./audience";
import { pushMode } from "./config";
import type { PushContext } from "./context";
import { BODY_MAX, cut, DAY_MS, kindOrder, LINE_MAX, TITLE_MAX, type Item } from "./copy";
import type { PushGroup } from "./groups";
import { morningItems } from "./morning";
import { pool, sendOne, topicOf, type SendResult } from "./send";
import { claim, morningKey, unclaim } from "./state";

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 10;
const LEASE_MS = 120_000;
const KEEP_DAYS = 30;
const DEAD_FAILS = 10;
const DEAD_DAYS = 14;
const TOMBSTONE_DAYS = 180;
// Housekeeping is cheap; anything more needs at least this much of the deadline left.
const MIN_STEP_MS = 10_000;

export type Stats = { sent: number; failed: number; dropped: number; removed: number; held: number };
const zero = (): Stats => ({ sent: 0, failed: 0, dropped: 0, removed: 0, held: 0 });

/** 22:00–08:00 Istanbul (D71). */
export function inQuietHours(at: Date) {
  const t = istanbulTimeOf(at);
  return t >= "22:00" || t < "08:00";
}

function errTag(e: unknown) {
  return { name: (e as Error)?.name, code: (e as { code?: unknown })?.code };
}

/**
 * Writes one row per wanted recipient and returns the ids due now. Never throws: the triggering
 * action must not fail because of a notification (D68).
 */
export async function enqueue(items: Item[], ctx: PushContext): Promise<string[]> {
  try {
    return await enqueueOrThrow(items, ctx);
  } catch (e) {
    console.error("push enqueue failed", errTag(e));
    return [];
  }
}

/** enqueue without the safety net: the morning run needs to know whether its rows were written. */
async function enqueueOrThrow(items: Item[], ctx: PushContext): Promise<string[]> {
  if (pushMode().mode === "inert") return [];
  const live = items.filter((i) => i.expiresAt > ctx.now);
  if (live.length === 0) return [];
  const [people, duesOn] = await Promise.all([
    loadPeople([...new Set(live.map((i) => i.userId))], { withDevicesOnly: true }),
    duesPushEnabled(),
  ]);
  const quiet = inQuietHours(ctx.now);
  const rows = live.flatMap((i) => {
    const p = people.get(i.userId);
    if (!p || !wants(p, i.group, duesOn)) return [];
    const hold = i.morning || (!i.urgent && quiet && prefOn(p, "gece"));
    return [
      {
        userId: i.userId,
        kind: i.kind,
        groupKey: i.group,
        dedupeKey: i.dedupeKey.slice(0, 200),
        title: cut(i.title, TITLE_MAX),
        body: cut(i.body, BODY_MAX),
        url: i.url,
        tag: i.tag.slice(0, 64),
        line: i.line ? cut(i.line, LINE_MAX) : null,
        urgent: Boolean(i.urgent),
        status: hold ? ("held" as const) : ("pending" as const),
        createdAt: ctx.now,
        expiresAt: i.expiresAt,
      },
    ];
  });
  if (rows.length === 0) return [];
  const inserted: { id: string; status: string }[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    inserted.push(
      ...(await db
        .insert(notifications)
        .values(rows.slice(i, i + 100))
        .onConflictDoNothing()
        .returning({ id: notifications.id, status: notifications.status })),
    );
  }
  return inserted.filter((r) => r.status === "pending").map((r) => r.id);
}

/** enqueue, then send the due rows after the response (D68). */
export async function notify(items: Item[], ctx: PushContext) {
  const ids = await enqueue(items, ctx);
  if (ids.length === 0) return;
  try {
    after(async () => {
      try {
        await deliver(ids, ctx, Date.now() + 45_000);
      } catch (e) {
        console.error("push send failed", errTag(e));
      }
    });
  } catch (e) {
    // Outside a request scope: the next dispatcher run sends them.
    console.error("push after() unavailable", errTag(e));
  }
}

type Row = typeof notifications.$inferSelect;

/**
 * Sends pending rows (these ids, or every pending row when null) to each device not yet reached.
 * A lease makes after() and a dispatcher run that overlap never send the same row twice.
 */
export async function deliver(ids: string[] | null, ctx: PushContext, deadline: number) {
  const stats = zero();
  const mode = pushMode();
  if (mode.mode === "inert") return stats;
  const realNow = new Date();
  const base = and(
    eq(notifications.status, "pending"),
    or(isNull(notifications.leaseUntil), lt(notifications.leaseUntil, realNow)),
  );
  const scope = ids ? and(base, inArray(notifications.id, ids)) : base;
  if (ids && ids.length === 0) return stats;
  const claimed: Row[] = await db
    .update(notifications)
    .set({ leaseUntil: new Date(realNow.getTime() + LEASE_MS) })
    .where(scope)
    .returning();
  if (claimed.length === 0) return stats;

  const finish = async (id: string, set: Partial<typeof notifications.$inferInsert>) => {
    await db
      .update(notifications)
      .set({ ...set, leaseUntil: null })
      .where(eq(notifications.id, id));
  };

  if (mode.mode === "off") {
    for (const r of claimed) await finish(r.id, { status: "dropped" });
    stats.dropped += claimed.length;
    return stats;
  }

  const [people, duesOn, subs] = await Promise.all([
    loadPeople([...new Set(claimed.map((r) => r.userId))]),
    duesPushEnabled(),
    subscriptionsOf([...new Set(claimed.map((r) => r.userId))]),
  ]);

  type Job = { row: Row; sub: (typeof subs)[number] };
  const jobs: Job[] = [];
  const pendingRows: Row[] = [];
  for (const row of claimed) {
    const person = people.get(row.userId);
    const expired = row.expiresAt <= ctx.now;
    if (expired || !person || !wants(person, row.groupKey as PushGroup | null, duesOn)) {
      await finish(row.id, { status: "dropped" });
      stats.dropped++;
      continue;
    }
    const done = new Set<string>(JSON.parse(row.deliveredTo) as string[]);
    const targets = subs.filter((s) => s.userId === row.userId && !done.has(s.id));
    if (targets.length === 0) {
      await finish(row.id, done.size ? { status: "sent", sentAt: ctx.now } : { status: "dropped" });
      if (done.size) stats.sent++;
      else stats.dropped++;
      continue;
    }
    pendingRows.push(row);
    for (const sub of targets) jobs.push({ row, sub });
  }

  const results = new Map<string, { ok: string[]; failed: number; removed: number }>();
  for (const r of pendingRows) results.set(r.id, { ok: [], failed: 0, removed: 0 });
  const handled = new Set<Job>();
  await pool(jobs, CONCURRENCY, deadline, async (job) => {
    const { row, sub } = job;
    const ttl = Math.max(0, Math.min(DAY_MS, row.expiresAt.getTime() - ctx.now.getTime()));
    let result: SendResult;
    try {
      result = await sendOne(
        mode,
        sub,
        { title: row.title, body: row.body, url: row.url, tag: row.tag },
        {
          notificationId: row.id,
          userId: row.userId,
          kind: row.kind,
          ttl: Math.floor(ttl / 1000),
          urgency: row.urgent ? "high" : "normal",
          topic: topicOf(row.tag),
        },
        ctx,
      );
    } catch {
      result = "fail";
    }
    handled.add(job);
    const acc = results.get(row.id)!;
    if (result === "ok") {
      acc.ok.push(sub.id);
      // Saved per device at once, so a run killed mid-pool never re-sends to it.
      await db
        .update(notifications)
        .set({ deliveredTo: sql`json_insert(${notifications.deliveredTo}, '$[#]', ${sub.id})` })
        .where(eq(notifications.id, row.id));
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failCount: 0, firstFailAt: null })
        .where(eq(pushSubscriptions.id, sub.id));
    } else if (result === "gone" || result === "notfound") {
      acc.removed++;
      stats.removed++;
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    } else {
      acc.failed++;
      await db
        .update(pushSubscriptions)
        .set({
          failCount: sql`${pushSubscriptions.failCount} + 1`,
          firstFailAt: sql`coalesce(${pushSubscriptions.firstFailAt}, unixepoch())`,
        })
        .where(eq(pushSubscriptions.id, sub.id));
    }
  });

  for (const row of pendingRows) {
    const acc = results.get(row.id)!;
    const skipped = jobs.some((j) => j.row === row && !handled.has(j));
    const delivered = [...new Set([...(JSON.parse(row.deliveredTo) as string[]), ...acc.ok])];
    if (skipped) {
      // Out of time: leave it for the next run without spending an attempt.
      await finish(row.id, { deliveredTo: JSON.stringify(delivered) });
      continue;
    }
    const attempts = row.attempts + 1;
    if (acc.failed === 0) {
      const any = delivered.length > 0;
      await finish(row.id, {
        attempts,
        deliveredTo: JSON.stringify(delivered),
        status: any ? "sent" : "dropped",
        sentAt: any ? ctx.now : null,
      });
      if (any) stats.sent++;
      else stats.dropped++;
    } else {
      const giveUp = attempts >= MAX_ATTEMPTS;
      await finish(row.id, {
        attempts,
        deliveredTo: JSON.stringify(delivered),
        status: giveUp ? "failed" : "pending",
      });
      if (giveUp) stats.failed++;
    }
  }
  return stats;
}

/** Character widths for the digest lines: short lines keep their length, long ones share the rest. */
export function fitLines(lengths: number[], budget: number) {
  const widths = new Array<number>(lengths.length);
  const order = lengths.map((n, i) => [n, i]).sort((a, b) => a[0] - b[0]);
  let left = budget;
  order.forEach(([n, i], k) => {
    const share = Math.floor(left / (order.length - k));
    widths[i] = Math.min(n, share);
    left -= widths[i];
  });
  return widths;
}

/** Morning release (D70): each person's held rows become one notification, or stay their own if single. */
async function releaseHeld(ctx: PushContext, deadline: number) {
  const held = await db
    .select()
    .from(notifications)
    .where(eq(notifications.status, "held"));
  if (held.length === 0) return 0;
  const [people, duesOn] = await Promise.all([
    loadPeople([...new Set(held.map((r) => r.userId))]),
    duesPushEnabled(),
  ]);
  const byUser = new Map<string, Row[]>();
  for (const r of held) {
    const p = people.get(r.userId);
    if (r.expiresAt <= ctx.now || !p || !wants(p, r.groupKey as PushGroup | null, duesOn)) {
      await db
        .update(notifications)
        .set({ status: "dropped" })
        .where(and(eq(notifications.id, r.id), eq(notifications.status, "held")));
      continue;
    }
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  }
  let released = 0;
  const endOfDay = istanbulToUtc(addDays(istanbulDateOf(ctx.now), 1)).getTime();
  for (const [userId, rows] of byUser) {
    // Out of time: the rest stay held for the next run.
    if (Date.now() > deadline) break;
    rows.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || +a.createdAt - +b.createdAt);
    await writeTx(async (tx) => {
      const ids = rows.map((r) => r.id);
      if (rows.length === 1) {
        await tx
          .update(notifications)
          .set({ status: "pending" })
          .where(and(eq(notifications.id, ids[0]), eq(notifications.status, "held")));
        return;
      }
      const combinedId = crypto.randomUUID();
      const taken = await tx
        .update(notifications)
        .set({ status: "merged", mergedInto: combinedId })
        .where(and(inArray(notifications.id, ids), eq(notifications.status, "held")))
        .returning({ id: notifications.id });
      const mine = rows.filter((r) => taken.some((t) => t.id === r.id));
      if (mine.length === 0) return;
      const lines = mine.map((r) => r.line ?? r.title);
      const shown = Math.min(4, lines.length);
      const tail = lines.length > shown ? `\n+${lines.length - shown} bildirim daha` : "";
      const widths = fitLines(
        lines.slice(0, shown).map((l) => [...l].length),
        BODY_MAX - [...tail].length - (shown - 1),
      );
      const body = lines.slice(0, shown).map((l, i) => cut(l, widths[i])).join("\n") + tail;
      // "Bugün …" lines are stale tomorrow: the digest never outlives this Istanbul day.
      const expires = Math.min(Math.max(...mine.map((r) => r.expiresAt.getTime())), endOfDay);
      await tx.insert(notifications).values({
        id: combinedId,
        userId,
        kind: "morning",
        groupKey: null,
        dedupeKey: `sabah-${combinedId}`,
        title: "Bugün Arkhe'de",
        body,
        url: "/",
        tag: "sabah",
        line: null,
        urgent: false,
        status: "pending",
        createdAt: ctx.now,
        expiresAt: new Date(expires),
      });
    });
    released++;
  }
  return released;
}

async function housekeeping(ctx: PushContext) {
  const keepFrom = new Date(ctx.now.getTime() - KEEP_DAYS * DAY_MS);
  await db.delete(notifications).where(lt(notifications.createdAt, keepFrom));
  await db
    .delete(notificationState)
    .where(and(sql`${notificationState.key} like 'sabah-%'`, lt(notificationState.updatedAt, keepFrom)));
  await db
    .delete(pushRemoved)
    .where(lt(pushRemoved.removedAt, new Date(ctx.now.getTime() - TOMBSTONE_DAYS * DAY_MS)));
  const deadSince = new Date(ctx.now.getTime() - DEAD_DAYS * DAY_MS);
  const dead = await db
    .delete(pushSubscriptions)
    .where(
      and(
        sql`${pushSubscriptions.failCount} >= ${DEAD_FAILS}`,
        lte(pushSubscriptions.firstFailAt, deadSince),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  const expired = await db
    .update(notifications)
    .set({ status: "dropped", leaseUntil: null })
    .where(
      and(
        inArray(notifications.status, ["pending", "held"]),
        lte(notifications.expiresAt, ctx.now),
      ),
    )
    .returning({ id: notifications.id });
  return { removed: dead.length, dropped: expired.length };
}

/** The morning lines; each section on its own, markers advanced only once the rows are written. */
async function buildMorning(ctx: PushContext, day: string) {
  const { items, commits, failed } = await morningItems(ctx, day);
  if (failed.length) console.error("push morning sections failed", { failed });
  try {
    await enqueueOrThrow(items, ctx);
  } catch (e) {
    // Give the day back, so the next run builds the morning again.
    await unclaim(morningKey(day));
    throw e;
  }
  for (const commit of commits) await commit();
  return items.length;
}

/**
 * One dispatcher run (D69): housekeeping, then outside quiet hours the morning lines (once per
 * Istanbul day) and the release of held rows, then every due row until `deadline`.
 */
export async function runDispatcher(ctx: PushContext, deadline: number) {
  const started = Date.now();
  if (pushMode().mode === "inert") return zero();
  const hk = await housekeeping(ctx);
  // Too little time left (a slow backup): retries and the morning wait for the next run.
  if (Date.now() > deadline - MIN_STEP_MS) {
    console.info("push dispatcher skipped", { msLeft: deadline - Date.now() });
    return zero();
  }
  let morning = 0;
  let released = 0;
  if (!inQuietHours(ctx.now)) {
    const day = istanbulDateOf(ctx.now);
    try {
      if (await claim(morningKey(day))) morning = await buildMorning(ctx, day);
    } catch (e) {
      console.error("push morning failed", errTag(e));
    }
    released = await releaseHeld(ctx, deadline);
  }
  const stats = await deliver(null, ctx, deadline);
  const [{ held }] = await db
    .select({ held: sql<number>`count(*)` })
    .from(notifications)
    .where(eq(notifications.status, "held"));
  // Counts only: never endpoints, payloads or names (D89).
  console.info("push dispatcher", {
    ms: Date.now() - started,
    morning,
    released,
    sent: stats.sent,
    failed: stats.failed,
    dropped: stats.dropped + hk.dropped,
    removedDevices: stats.removed + hk.removed,
    held: Number(held),
  });
  return stats;
}
