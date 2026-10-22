// Arkhe service worker: offline page, static assets and Web Push. Never caches pages, API or RSC data.
// Bump VERSION on every change to this file; old caches are deleted on activate.
const VERSION = "arkhe-v2";
// Kill switch: set to true and deploy to drop every cache, unregister and reload open tabs.
// Unregistering also ends every push subscription on that device.
const KILL = false;

const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/manifest.webmanifest"];
const MAX_ENTRIES = 200;
// Content-hashed build output: cache-first.
const HASHED = /^\/_next\/static\//;
// Un-hashed public art and metadata: stale-while-revalidate so a redrawn icon still arrives.
const UNHASHED =
  /^\/(?:brand\/|icons\/|favicon\.ico$|icon\.svg$|apple-icon\.png$|manifest\.webmanifest$|offline\.html$)/;

self.addEventListener("install", (event) => {
  if (KILL) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await Promise.all(
        PRECACHE.map(async (url) => {
          // redirect: "error" so an auth redirect can never be precached as the offline page.
          const res = await fetch(url, { cache: "reload", redirect: "error", credentials: "omit" });
          if (!res.ok) throw new Error(`Precache failed for ${url}: ${res.status}`);
          await cache.put(url, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      if (KILL) {
        await Promise.all(keys.map((key) => caches.delete(key)));
        await self.registration.unregister();
        const windows = await self.clients.matchAll({ type: "window" });
        await Promise.all(windows.map((client) => client.navigate(client.url)));
        return;
      }
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isCacheable(res) {
  return (
    res.ok &&
    res.type === "basic" &&
    !res.headers.has("set-cookie") &&
    !/private|no-store/i.test(res.headers.get("cache-control") ?? "")
  );
}

async function store(req, res) {
  if (!isCacheable(res)) return;
  const cache = await caches.open(VERSION);
  await cache.put(req, res);
  // Oldest first (insertion order); precached entries are never evicted.
  const keys = await cache.keys();
  const evictable = keys.filter((key) => !PRECACHE.includes(new URL(key.url).pathname));
  const excess = evictable.length - (MAX_ENTRIES - PRECACHE.length);
  for (let i = 0; i < excess; i++) await cache.delete(evictable[i]);
}

function isRscRequest(req, url) {
  if (url.searchParams.has("_rsc") || req.headers.has("rsc")) return true;
  for (const name of req.headers.keys()) if (name.startsWith("next-router-")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  if (KILL) return;
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages always come from the network; the offline page only stands in when the network fails.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/api/") || isRscRequest(req, url)) return;

  if (HASHED.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        await store(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (UNHASHED.test(url.pathname)) {
    const network = fetch(req).then(async (res) => {
      await store(req, res.clone());
      return res;
    });
    event.waitUntil(network.catch(() => undefined));
    event.respondWith(caches.match(req).then((hit) => hit ?? network));
  }
});

const FALLBACK = { title: "Arkhe", body: "Portalda yeni bir şey var.", url: "/", tag: "arkhe" };

function readPayload(data) {
  try {
    const p = data?.json();
    if (p && typeof p.title === "string" && p.title && typeof p.body === "string") {
      return {
        title: p.title,
        body: p.body,
        url: typeof p.url === "string" ? p.url : "/",
        tag: typeof p.tag === "string" && p.tag ? p.tag : FALLBACK.tag,
      };
    }
  } catch {}
  return FALLBACK;
}

// Only a same-origin path: exactly one leading "/" and no backslash (browsers read "/\x" as "//x").
function safeTarget(url) {
  if (typeof url !== "string" || !/^\/(?![/\\])/.test(url) || url.includes("\\")) return "/";
  const target = new URL(url, self.location.origin);
  return target.origin === self.location.origin
    ? target.pathname + target.search + target.hash
    : "/";
}

// Browsers require a visible notification for every push; iOS revokes silent subscribers.
self.addEventListener("push", (event) => {
  const p = readPayload(event.data);
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      lang: "tr",
      data: { url: p.url },
    }),
  );
});

// Focuses an open portal window and sends it to the path; opens one when there is none.
async function openTarget(url) {
  const href = new URL(safeTarget(url), self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const mine = windows.filter((c) => new URL(c.url).origin === self.location.origin);
  const client = mine.find((c) => c.focused) ?? mine[0];
  if (client) {
    // Clicks may focus windows only briefly: focus before the navigation, which can be slow.
    const focused = await client.focus().catch(() => client);
    const navigated = await (focused ?? client).navigate(href).catch(() => null);
    if (navigated) return href;
  }
  await self.clients.openWindow(href);
  return href;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTarget(event.notification.data?.url));
});

// The push service rotated the subscription: subscribe again with the same key. The next page
// load re-syncs it to the server (the portal re-sends a granted subscription once a day).
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .catch(() => undefined),
  );
});
