import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";
import { currentSessionId } from "@/lib/auth/session";
import { isManager } from "@/lib/permissions";
import { loadPerson, prefOn } from "./audience";
import { pushMode } from "./config";
import { GROUP_LABELS, groupVisible, PUSH_GROUPS, type PushGroup } from "./groups";
import { duesPushEnabled } from "./state";

export type PushDevice = {
  id: string;
  label: string;
  createdAt: Date;
  lastSuccessAt: Date | null;
  current: boolean;
};

export type PushSettings = {
  publicKey: string | null;
  devices: PushDevice[];
  groups: { key: PushGroup; label: string; on: boolean }[];
  quiet: boolean;
  manager: boolean;
};

/** Only the public key ever reaches a page; null when push isn't configured (D90). */
export async function getVapidPublicKey() {
  const mode = pushMode();
  return mode.mode === "real" || mode.mode === "outbox" ? mode.vapid.publicKey : null;
}

export async function getDuesPushEnabled() {
  return duesPushEnabled();
}

/** The session user's own devices (never endpoints) and switches. */
export async function getPushSettings(): Promise<PushSettings> {
  const user = await requireUser();
  const [person, duesOn, session, devices] = await Promise.all([
    loadPerson(user.id),
    duesPushEnabled(),
    currentSessionId(),
    db
      .select({
        id: pushSubscriptions.id,
        label: pushSubscriptions.label,
        createdAt: pushSubscriptions.createdAt,
        lastSuccessAt: pushSubscriptions.lastSuccessAt,
        sessionId: pushSubscriptions.sessionId,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id))
      .orderBy(desc(pushSubscriptions.createdAt)),
  ]);
  const audience = person ?? {
    role: user.role,
    voicePart: user.voicePart,
    assistant: false,
    prefs: new Map(),
  };
  return {
    publicKey: await getVapidPublicKey(),
    devices: devices.map(({ sessionId, ...d }) => ({ ...d, current: sessionId === session })),
    groups: PUSH_GROUPS.filter((g) => groupVisible(g, audience, duesOn)).map((key) => ({
      key,
      label: GROUP_LABELS[key],
      on: prefOn(audience, key),
    })),
    quiet: prefOn(audience, "gece"),
    manager: isManager(user.role),
  };
}
