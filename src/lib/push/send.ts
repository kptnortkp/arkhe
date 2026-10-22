import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import webpush from "web-push";
import type { PushMode } from "./config";
import type { PushContext } from "./context";
import { FAKE_HOST, fakeResult } from "./endpoint";

export const SEND_TIMEOUT_MS = 10_000;
export const OUTBOX_DIR = path.join(process.cwd(), "data", "push-outbox");

export type Payload = { title: string; body: string; url: string; tag: string };
export type SendResult = "ok" | "gone" | "notfound" | "fail" | "slow" | "throw";
export type Target = { id: string; endpoint: string; p256dh: string; auth: string };
export type SendMeta = {
  notificationId: string;
  userId: string;
  kind: string;
  ttl: number;
  urgency: "high" | "normal";
  topic: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A Topic header must be ≤ 32 base64url characters. */
export function topicOf(tag: string) {
  return tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
}

async function writeOutbox(entry: object) {
  await mkdir(OUTBOX_DIR, { recursive: true });
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}`;
  // Written aside, then renamed: a reader never sees a half-written file.
  const tmp = path.join(OUTBOX_DIR, `${stamp}.tmp`);
  await writeFile(tmp, JSON.stringify(entry, null, 2), { flag: "wx", mode: 0o600 });
  await rename(tmp, path.join(OUTBOX_DIR, `${stamp}.json`));
}

async function simulate(target: Target, ctx: PushContext): Promise<SendResult> {
  if (ctx.latencyMs) await sleep(ctx.latencyMs);
  if (ctx.fault === "throw") return "throw";
  const fake = new URL(target.endpoint).hostname === FAKE_HOST;
  const result = ctx.fault === "slow" ? "slow" : fake ? fakeResult(target.endpoint) : "ok";
  if (result === "slow") await sleep(SEND_TIMEOUT_MS);
  return result;
}

async function real(
  target: Target,
  body: string,
  meta: SendMeta,
  vapid: { publicKey: string; privateKey: string; subject: string },
): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // web-push's timeout is a socket idle timeout; this is the hard cap per send.
  const hard = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), SEND_TIMEOUT_MS);
  });
  try {
    const sent = webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      body,
      {
        vapidDetails: vapid,
        TTL: meta.ttl,
        urgency: meta.urgency,
        topic: meta.topic || undefined,
        timeout: SEND_TIMEOUT_MS,
      },
    );
    return await Promise.race([sent.then(() => "ok" as const), hard]);
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 410) return "gone";
    if (status === 404) return "notfound";
    const code = (e as { code?: string }).code;
    const timedOut =
      code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || (e as Error)?.message === "Socket timeout";
    return timedOut ? "slow" : "fail";
  } finally {
    clearTimeout(timer);
  }
}

/** One device, one attempt. Never throws; outside production nothing leaves the machine (D66). */
export async function sendOne(
  mode: Extract<PushMode, { mode: "real" | "outbox" }>,
  target: Target,
  payload: Payload,
  meta: SendMeta,
  ctx: PushContext,
): Promise<SendResult> {
  const body = JSON.stringify(payload);
  if (mode.mode === "real") {
    if (new URL(target.endpoint).hostname === FAKE_HOST) return "gone";
    return real(target, body, meta, mode.vapid);
  }
  const result = await simulate(target, ctx);
  try {
    await writeOutbox({ ...meta, subscriptionId: target.id, result, payload });
  } catch (e) {
    console.error("push outbox write failed", { code: (e as { code?: string }).code });
  }
  return result;
}

/** Runs `fn` over `items` with at most `limit` in flight, stopping new work after `deadline`. */
export async function pool<T>(
  items: T[],
  limit: number,
  deadline: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
