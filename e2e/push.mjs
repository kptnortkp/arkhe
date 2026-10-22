// Phase 10 backend e2e helpers: fake devices, the push outbox and the dispatcher route.
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, db } from "./lib.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const PUSH_OUTBOX = path.join(ROOT, "data/push-outbox");
export const CRON_SECRET = process.env.CRON_SECRET ?? "dev-only-cron-secret";
// Our arranged sessions; the UI suite owns "e2e-push-%".
const SESSION_PREFIX = "e2e-pushb-";

export function fakeKeys() {
  const ecdh = createECDH("prime256v1");
  return {
    p256dh: ecdh.generateKeys().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

export function fakeEndpoint(result = "ok") {
  return `https://push.invalid/e2e/${randomUUID()}/${result}`;
}

/** A device row written directly ("arrange"), on its own session row. */
export async function addDevice(userId, result = "ok", { createdAt, lastSuccessAt } = {}) {
  const sessionId = `${SESSION_PREFIX}${randomUUID()}`;
  await db.execute({
    sql: "insert into sessions (id, user_id, expires_at) values (?, ?, unixepoch() + 86400)",
    args: [sessionId, userId],
  });
  const id = randomUUID();
  const keys = fakeKeys();
  await db.execute({
    sql: `insert into push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, label, created_at, last_success_at)
          values (?, ?, ?, ?, ?, ?, 'Android · Chrome', coalesce(?, unixepoch()), ?)`,
    args: [id, userId, sessionId, fakeEndpoint(result), keys.p256dh, keys.auth, createdAt ?? null, lastSuccessAt ?? null],
  });
  return id;
}

export async function setPref(userId, key, on) {
  await db.execute({
    sql: `insert into notification_prefs (user_id, key, enabled) values (?, ?, ?)
          on conflict (user_id, key) do update set enabled = excluded.enabled`,
    args: [userId, key, on ? 1 : 0],
  });
}

/** Removes every push row the backend suites create; demo users' prefs go back to defaults. */
export async function resetPush() {
  await db.execute("delete from notifications");
  await db.execute(`delete from sessions where id like '${SESSION_PREFIX}%'`);
  await db.execute("delete from push_subscriptions where endpoint like 'https://push.invalid/%'");
  await db.execute("delete from notification_prefs");
  await db.execute("delete from notification_state");
}

/** Outbox entries written since `since` (ms). */
export function outboxSince(since) {
  let files = [];
  try {
    files = readdirSync(PUSH_OUTBOX).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => path.join(PUSH_OUTBOX, f))
    .filter((f) => statSync(f).mtimeMs >= since)
    .flatMap((f) => {
      try {
        return [{ file: f, ...JSON.parse(readFileSync(f, "utf8")) }];
      } catch {
        // Still being written; the next poll reads it.
        return [];
      }
    });
}

export function removeOutbox(entries) {
  for (const e of entries) rmSync(e.file, { force: true });
}

/** The dispatcher-only route; `query` like "?simdi=…". */
export async function dispatch(query = "", { secret = CRON_SECRET } = {}) {
  const headers = secret ? { Authorization: `Bearer ${secret}` } : {};
  const res = await fetch(`${BASE}/api/cron/bildirimler${query}`, { headers });
  const text = await res.text();
  return { status: res.status, text, cache: res.headers.get("cache-control") };
}

/** Waits until `fn()` is truthy (after() sends finish after the response). */
export async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function rowsOf(where = "1=1", args = []) {
  return (await db.execute({ sql: `select * from notifications where ${where}`, args })).rows;
}

/** Istanbul wall time → ISO with offset. */
export const at = (day, time) => `${day}T${time}:00+03:00`;
