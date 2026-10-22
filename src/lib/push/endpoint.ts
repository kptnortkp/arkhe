import { createECDH } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { pushHooksEnabled } from "./config";

export const REFUSED = "Bu bildirim adresi kabul edilmedi.";
export const ENDPOINT_MAX = 1024;

// Exact hosts and suffixes of the browsers' push services (D67). Samsung Internet and Opera use FCM.
const HOSTS = new Set(["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com"]);
const SUFFIXES = [".notify.windows.com", ".push.apple.com"];
export const FAKE_HOST = "push.invalid";

export function hostAllowed(host: string, fake: boolean) {
  if (fake && host === FAKE_HOST) return true;
  return HOSTS.has(host) || SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

const b64url = /^[A-Za-z0-9_-]+$/;

function decode(v: string) {
  return b64url.test(v) ? Buffer.from(v, "base64url") : null;
}

const subscriptionSchema = z.object({
  endpoint: z.string().max(ENDPOINT_MAX),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export type ValidSubscription = { endpoint: string; p256dh: string; auth: string };

/** Null for anything outside the allowlist or with malformed keys; keys come back unpadded. */
export function validateSubscription(input: unknown, env = process.env): ValidSubscription | null {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return null;
  const { endpoint, keys } = parsed.data;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) || host === "localhost") return null;
  if (!hostAllowed(host, pushHooksEnabled(env))) return null;
  const p256dh = decode(keys.p256dh.replace(/=+$/, ""));
  const auth = decode(keys.auth.replace(/=+$/, ""));
  // An uncompressed P-256 point: 0x04 then two 32-byte coordinates.
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 4) return null;
  if (!auth || auth.length !== 16) return null;
  if (!onCurve(p256dh) || url.href.length > ENDPOINT_MAX) return null;
  return {
    endpoint: url.href,
    p256dh: p256dh.toString("base64url"),
    auth: auth.toString("base64url"),
  };
}

function onCurve(point: Buffer) {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    ecdh.computeSecret(point);
    return true;
  } catch {
    return false;
  }
}

/** The simulated answer of a push.invalid endpoint: its last path segment. */
export function fakeResult(endpoint: string) {
  const last = new URL(endpoint).pathname.split("/").pop() ?? "";
  return (["ok", "gone", "notfound", "fail", "slow"] as const).find((r) => r === last) ?? "ok";
}
