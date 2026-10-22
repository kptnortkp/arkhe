"use server";

import { createHash } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import {
  notificationPrefs,
  notifications,
  pushRemoved,
  pushSubscriptions,
  PUSH_PREF_KEYS,
} from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { assertManager, assertUser } from "@/lib/auth/dal";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { currentSessionId } from "@/lib/auth/session";
import { loadPerson } from "@/lib/push/audience";
import { pushContext } from "@/lib/push/context";
import { deviceLabel } from "@/lib/push/device";
import { deliver } from "@/lib/push/dispatch";
import { REFUSED, validateSubscription } from "@/lib/push/endpoint";
import { groupVisible, isPushGroup, QUIET_KEY } from "@/lib/push/groups";
import { DUES_SWITCH, duesPushEnabled, setState } from "@/lib/push/state";
import type { FormState } from "@/lib/validation";

const FORBIDDEN = "Bu işlem için yetkin yok.";
const DEVICE_NOT_FOUND = "Cihaz bulunamadı.";
const MAX_DEVICES = 10;
const TEST_LIMIT = { max: 5, windowMs: 10 * 60_000 };

const endpointHash = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

/**
 * Saves this browser's subscription for the session user; an idempotent upsert. The daily re-sync
 * passes `resync`, which a device removed with `Kaldır` refuses; a tap on `Bildirimleri aç` clears that.
 */
export async function subscribePush(
  sub: unknown,
  opts?: { resync?: boolean },
): Promise<FormState & { removed?: boolean }> {
  const user = await assertUser();
  const sessionId = await currentSessionId();
  if (!user || !sessionId) return { error: FORBIDDEN };
  const valid = validateSubscription(sub);
  if (!valid) return { error: REFUSED };
  const resync = opts?.resync === true;
  const hash = endpointHash(valid.endpoint);
  const label = deviceLabel((await headers()).get("user-agent") ?? "");
  try {
    const removed = await writeTx(async (tx) => {
      const [tomb] = await tx
        .select({ hash: pushRemoved.endpointHash })
        .from(pushRemoved)
        .where(eq(pushRemoved.endpointHash, hash));
      if (tomb && resync) return true;
      if (tomb) await tx.delete(pushRemoved).where(eq(pushRemoved.endpointHash, hash));
      // One endpoint, one owner: the last user who subscribed it (D84).
      await tx
        .insert(pushSubscriptions)
        .values({ userId: user.id, sessionId, label, ...valid })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: user.id,
            sessionId,
            label,
            p256dh: valid.p256dh,
            auth: valid.auth,
            failCount: 0,
            firstFailAt: null,
            createdAt: sql`case when ${pushSubscriptions.userId} = ${user.id} then ${pushSubscriptions.createdAt} else unixepoch() end`,
          },
        });
      const others = await tx
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, user.id), ne(pushSubscriptions.endpoint, valid.endpoint)))
        .orderBy(
          asc(sql`coalesce(${pushSubscriptions.lastSuccessAt}, ${pushSubscriptions.createdAt})`),
        );
      const extra = others.length + 1 - MAX_DEVICES;
      for (const row of others.slice(0, Math.max(0, extra))) {
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
      }
      return false;
    });
    if (removed) return { error: "Bu cihaz listeden kaldırıldı.", removed: true };
  } catch (e) {
    console.error("push subscribe failed", { name: (e as Error)?.name });
    return { error: "Bildirimler açılamadı. Biraz sonra tekrar dene." };
  }
  revalidatePath("/profil");
  return { success: "Bu cihazda bildirimler açık." };
}

/** `Bu cihazda kapat`: removes this browser's row, only if it is the caller's. */
export async function unsubscribePush(endpoint: unknown): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  let href: string | null = null;
  try {
    if (typeof endpoint === "string" && endpoint.length <= 1024) href = new URL(endpoint).href;
  } catch {}
  if (href) {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, href), eq(pushSubscriptions.userId, user.id)));
  }
  revalidatePath("/profil");
  return { success: "Bu cihazda bildirimler kapandı." };
}

export async function removePushDevice(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: DEVICE_NOT_FOUND };
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id.data), eq(pushSubscriptions.userId, user.id)))
    .returning({ endpoint: pushSubscriptions.endpoint });
  if (!deleted.length) return { error: DEVICE_NOT_FOUND };
  await db
    .insert(pushRemoved)
    .values({ endpointHash: endpointHash(deleted[0].endpoint), userId: user.id })
    .onConflictDoUpdate({
      target: pushRemoved.endpointHash,
      set: { userId: user.id, removedAt: sql`(unixepoch())` },
    });
  revalidatePath("/profil");
  return { success: "Cihaz kaldırıldı." };
}

const prefSchema = z.object({ key: z.enum(PUSH_PREF_KEYS), on: z.enum(["0", "1"]) });

/** One switch, saved at once; a group the role doesn't show is refused (AC 5). */
export async function savePushPref(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  const parsed = prefSchema.safeParse({ key: formData.get("key"), on: formData.get("on") });
  if (!parsed.success) return { error: "Bu ayar sana açık değil." };
  const { key, on } = parsed.data;
  if (key !== QUIET_KEY) {
    const [person, duesOn] = await Promise.all([loadPerson(user.id), duesPushEnabled()]);
    if (!person || !isPushGroup(key) || !groupVisible(key, person, duesOn)) {
      return { error: "Bu ayar sana açık değil." };
    }
  }
  const enabled = on === "1";
  await db
    .insert(notificationPrefs)
    .values({ userId: user.id, key, enabled })
    .onConflictDoUpdate({
      target: [notificationPrefs.userId, notificationPrefs.key],
      set: { enabled, updatedAt: sql`(unixepoch())` },
    });
  revalidatePath("/profil");
  return { success: "Kaydedildi." };
}

/** Every device of the caller, ignoring switches and quiet hours; waits for the answers (D85). */
export async function sendTestPush(): Promise<FormState & { sent?: number; removed?: number }> {
  const user = await assertUser();
  if (!user) return { error: FORBIDDEN };
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id));
  if (Number(n) === 0) return { error: "Önce bu cihazda bildirimleri aç." };
  const limit = await consumeAttempt(`push-test:${user.id}`, TEST_LIMIT.max, TEST_LIMIT.windowMs);
  if (limit.blocked) return { error: "Çok sık denedin. Biraz sonra tekrar dene." };
  const ctx = await pushContext();
  const id = crypto.randomUUID();
  await db.insert(notifications).values({
    id,
    userId: user.id,
    kind: "test",
    groupKey: null,
    dedupeKey: `deneme-${id}`,
    title: "Deneme bildirimi",
    body: "Bildirimler bu cihazda çalışıyor.",
    url: "/profil#bildirimler",
    tag: "deneme",
    status: "pending",
    createdAt: ctx.now,
    expiresAt: new Date(ctx.now.getTime() + 10 * 60_000),
  });
  const stats = await deliver([id], ctx, Date.now() + 12_000);
  const [row] = await db
    .select({ deliveredTo: notifications.deliveredTo })
    .from(notifications)
    .where(eq(notifications.id, id));
  const sent = row ? (JSON.parse(row.deliveredTo) as string[]).length : 0;
  revalidatePath("/profil");
  return {
    success: `Deneme bildirimi gönderildi (${sent} cihaz).`,
    warning: stats.removed
      ? `${stats.removed} cihaz artık bildirim almıyor; listeden kaldırıldı.`
      : undefined,
    sent,
    removed: stats.removed,
  };
}

/** `/finans/ayarlar` › `Aidat bildirimleri`: any manager (D80). */
export async function setDuesPush(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const on = formData.get("on");
  if (on !== "0" && on !== "1") return { error: FORBIDDEN };
  await setState(DUES_SWITCH, on, actor.id);
  revalidatePath("/finans/ayarlar");
  revalidatePath("/profil");
  return { success: "Kaydedildi." };
}
