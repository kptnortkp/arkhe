"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribePush, unsubscribePush } from "@/app/actions/push";
import { isIos, isStandalone } from "@/lib/pwa-store";
import type { FormState } from "@/lib/validation";

export type DeviceState =
  "loading" | "unsupported" | "ios-install" | "ios-old" | "default" | "denied" | "on";

const SYNC_KEY = "arkhe-push-sync";
const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;
// The worker registers in production only; a missing one must not hang the page.
const READY_TIMEOUT_MS = 8000;

// 40×24 px; the off track is dark enough to read as a control on the light card (3:1).
export const SWITCH_CLASS =
  "data-[size=default]:h-6 data-[size=default]:w-10 data-unchecked:bg-muted-foreground/60 dark:data-unchecked:bg-muted-foreground/45 [&>[data-slot=switch-thumb]]:size-5!";

export const ENABLE_ERROR = "Bildirimler açılamadı. Sayfayı yenileyip tekrar dene.";

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function detectState(): Promise<Exclude<DeviceState, "loading">> {
  if (isIos() && !isStandalone()) return "ios-install";
  if (!pushSupported()) return isIos() ? "ios-old" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "default";
  return (await currentSubscription()) ? "on" : "default";
}

function keyBytes(base64url: string) {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type SyncStamp = { user: string; endpoint: string; at: number };

function readStamp(): SyncStamp | null {
  try {
    return JSON.parse(localStorage.getItem(SYNC_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeStamp(user: string, endpoint: string) {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ user, endpoint, at: Date.now() }));
  } catch {}
}

function asJson(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}

/** Called from a tap only: asks for permission, subscribes and saves the subscription. */
export async function enablePush(publicKey: string, userId: string) {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { state: "denied" as const };
  if (permission !== "granted") return { state: "default" as const };
  const reg = await registration();
  if (!reg) return { state: "default" as const, error: ENABLE_ERROR };
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe(options);
  } catch {
    // A subscription made with an older key blocks a new one: drop it and try once more.
    try {
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      sub = await reg.pushManager.subscribe(options);
    } catch {
      return { state: "default" as const, error: ENABLE_ERROR };
    }
  }
  const result = await subscribePush(asJson(sub)).catch((): FormState => ({ error: ENABLE_ERROR }));
  if (result.error) {
    await sub.unsubscribe().catch(() => undefined);
    return { state: "default" as const, error: result.error };
  }
  writeStamp(userId, sub.endpoint);
  return { state: "on" as const, success: result.success };
}

/** "Bu cihazda kapat": the browser drops the subscription, then the server row goes. */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return { success: "Bu cihazda bildirimler kapandı." };
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {}
  return unsubscribePush(endpoint).catch((): FormState => ({
    error: "Bir şeyler ters gitti, tekrar dene.",
  }));
}

/** Re-sends a granted subscription at most once a day, and at once when the endpoint changed. */
export async function resyncPush(userId: string) {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const stamp = readStamp();
  // Another person's subscription on a shared browser is never taken over silently.
  if (stamp && stamp.user !== userId) return;
  const sub = await currentSubscription();
  if (!sub) return;
  if (stamp && stamp.endpoint === sub.endpoint && Date.now() - stamp.at < SYNC_EVERY_MS) return;
  const result = await subscribePush(asJson(sub), { resync: true }).catch(() => null);
  if (result?.removed) {
    // Removed from the list on another device: stop this browser's subscription too.
    await sub.unsubscribe().catch(() => undefined);
    try {
      localStorage.removeItem(SYNC_KEY);
    } catch {}
    return;
  }
  if (result && !result.error) writeStamp(userId, sub.endpoint);
}

/** Best effort on logout, bounded so the form never waits long. */
export async function dropBrowserSubscription() {
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {}
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
}

/** This browser's push state, detected after hydration and on demand. */
export function useDeviceState() {
  const [state, setState] = useState<DeviceState>("loading");
  const refresh = useCallback(() => {
    void detectState().then(setState);
  }, []);
  useEffect(() => {
    refresh();
    // Permission changed in browser settings while the page was open.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  return [state, setState] as const;
}
