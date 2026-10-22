// Phase 10 e2e helpers: a fake Push stack for dev, where the service worker is never registered (D88).
// Not matched by the runner's ^phase pattern.
import { generateKeyPairSync, randomBytes } from "node:crypto";

export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** A valid P-256 public key (65 bytes) and a 16-byte auth secret, base64url. */
export function pushKeys() {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-65);
  return { p256dh: raw.toString("base64url"), auth: randomBytes(16).toString("base64url") };
}

export const fakeEndpoint = (result = "ok") =>
  `https://push.invalid/e2e/${crypto.randomUUID()}/${result}`;

/**
 * Installs the fake stack on a context. `mode`: "supported" (default), "unsupported" (no
 * PushManager), "ios-old" (standalone iPhone without PushManager). `permission` is the starting
 * state; `answer` is what requestPermission resolves to. `standalone` fakes the home-screen app.
 */
export async function stubPush(
  context,
  {
    mode = "supported",
    permission = "default",
    answer = "granted",
    standalone = false,
    endpoint,
  } = {},
) {
  const keys = pushKeys();
  await context.addInitScript(
    ({ mode, permission, answer, standalone, endpoint, keys }) => {
      const store = {
        get perm() {
          return localStorage.getItem("__e2e_push_perm") ?? permission;
        },
        set perm(v) {
          localStorage.setItem("__e2e_push_perm", v);
        },
        get sub() {
          return localStorage.getItem("__e2e_push_sub");
        },
        set sub(v) {
          if (v) localStorage.setItem("__e2e_push_sub", v);
          else localStorage.removeItem("__e2e_push_sub");
        },
      };
      const calls = { requestPermission: 0, subscribe: 0, unsubscribe: 0 };
      window.__pushCalls = calls;
      if (standalone) Object.defineProperty(navigator, "standalone", { get: () => true });
      if (mode !== "supported") {
        delete window.PushManager;
        return;
      }
      Object.defineProperty(Notification, "permission", {
        get: () => store.perm,
        configurable: true,
      });
      Notification.requestPermission = async () => {
        calls.requestPermission++;
        if (store.perm === "default") store.perm = answer;
        return store.perm;
      };
      const makeSub = (url) => ({
        endpoint: url,
        expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: new ArrayBuffer(65) },
        toJSON: () => ({ endpoint: url, expirationTime: null, keys }),
        unsubscribe: async () => {
          calls.unsubscribe++;
          store.sub = null;
          return true;
        },
      });
      const pushManager = {
        subscribe: async () => {
          calls.subscribe++;
          if (store.perm !== "granted") throw new DOMException("denied", "NotAllowedError");
          if (!store.sub)
            store.sub = endpoint ?? `https://push.invalid/e2e/${crypto.randomUUID()}/ok`;
          return makeSub(store.sub);
        },
        getSubscription: async () => (store.sub ? makeSub(store.sub) : null),
        permissionState: async () => (store.perm === "default" ? "prompt" : store.perm),
      };
      const registration = { pushManager, scope: location.origin + "/" };
      Object.defineProperty(ServiceWorkerContainer.prototype, "ready", {
        get: () => Promise.resolve(registration),
        configurable: true,
      });
      ServiceWorkerContainer.prototype.getRegistration = async () => registration;
    },
    { mode, permission, answer, standalone, endpoint: endpoint ?? null, keys },
  );
}

/** The fake stack's call counters on this page. */
export const pushCalls = (page) => page.evaluate(() => window.__pushCalls);

/** The endpoint the fake browser currently holds, or null. */
export const browserEndpoint = (page) =>
  page.evaluate(() => localStorage.getItem("__e2e_push_sub"));
