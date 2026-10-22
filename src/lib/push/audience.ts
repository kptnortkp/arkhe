import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notificationPrefs,
  pushSubscriptions,
  users,
  type PushPrefKey,
  type Role,
  type VoicePart,
} from "@/db/schema";
import { DEFAULTS, groupVisible, type PushGroup } from "./groups";
import { duesPushEnabled } from "./state";

export type Person = {
  id: string;
  role: Role;
  voicePart: VoicePart | null;
  assistant: boolean;
  prefs: Map<PushPrefKey, boolean>;
  devices: number;
};

export function prefOn(p: Pick<Person, "prefs">, key: PushPrefKey) {
  return p.prefs.get(key) ?? DEFAULTS[key];
}

/** Whether `group` may reach this person now: visible to their role and switched on. */
export function wants(p: Person, group: PushGroup | null, duesOn: boolean) {
  if (group === null) return true;
  return groupVisible(group, p, duesOn) && prefOn(p, group);
}

/** Active people among `ids` (all active people when null), with prefs and device counts. */
export async function loadPeople(ids: string[] | null, opts: { withDevicesOnly?: boolean } = {}) {
  if (ids && ids.length === 0) return new Map<string, Person>();
  const where = ids ? and(eq(users.isActive, true), inArray(users.id, ids)) : eq(users.isActive, true);
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      voicePart: users.voicePart,
      // Spelled out: drizzle renders a bare "id" for columns inside select fields.
      devices: sql<number>`(select count(*) from push_subscriptions s where s.user_id = "users"."id")`,
      assistant: sql<number>`exists (select 1 from listening_assistants la where la.user_id = "users"."id")`,
    })
    .from(users)
    .where(where);
  const people = rows.filter((r) => !opts.withDevicesOnly || Number(r.devices) > 0);
  const map = new Map<string, Person>();
  for (const r of people) {
    map.set(r.id, {
      id: r.id,
      role: r.role,
      voicePart: r.voicePart,
      // D9: appointments of the conductor or of non-singers are ignored.
      assistant: Boolean(Number(r.assistant)) && r.role !== "conductor",
      prefs: new Map(),
      devices: Number(r.devices),
    });
  }
  if (map.size) {
    const prefs = await db
      .select()
      .from(notificationPrefs)
      .where(inArray(notificationPrefs.userId, [...map.keys()]));
    for (const p of prefs) map.get(p.userId)?.prefs.set(p.key, p.enabled);
  }
  return map;
}

export async function loadPerson(id: string) {
  return (await loadPeople([id])).get(id) ?? null;
}

export { duesPushEnabled };

/** Subscriptions of these users, endpoints included: server-side senders only. */
export async function subscriptionsOf(userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));
}
