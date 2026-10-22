// Phase 10 S3 on the production build: the worker's push and click handlers (D88), its headers, and
// the Bildirimler section without VAPID keys. Called from e2e/prod.mjs; not a phase file.

const NOTE = {
  title: "Yoklama açıldı",
  body: "Koro çalışması · 19:30. Yoklamaya katılmak için dokun.",
  tag: "yoklama-e2e",
};

/** `context`: the persistent context whose `page` is controlled by the worker; `cdp`: page CDP session. */
export async function pushWorkerChecks({ context, page, cdp, base, check }) {
  console.log("# phase 10 worker");
  const origin = new URL(base).origin;

  // AC 22: VERSION bumped, the Phase 6 headers kept, the page CSP unchanged.
  const sw = await page.request.get(`${base}/sw.js`);
  const swh = sw.headers();
  const swText = await sw.text();
  check(
    swh["cache-control"] === "no-cache, no-store, must-revalidate" &&
      swh["content-type"] === "application/javascript; charset=utf-8" &&
      swh["content-security-policy"] === "default-src 'self'; script-src 'self'" &&
      swText.includes('const VERSION = "arkhe-v2"') &&
      swText.includes("const KILL = false"),
    "Phase10 AC22 /sw.js keeps its Phase 6 headers; VERSION is arkhe-v2; KILL stays false",
  );
  const csp = (await page.request.get(`${base}/profil`)).headers()["content-security-policy"] ?? "";
  check(
    csp.includes("connect-src 'self';") && csp.includes("worker-src 'self';"),
    "Phase10 AC22 the page CSP keeps connect-src 'self' and worker-src 'self'",
  );
  const badge = await page.request.get(`${base}/icons/badge-96.png`);
  check(
    badge.status() === 200 && badge.headers()["content-type"] === "image/png",
    "Phase10 AC20 the monochrome badge icon is served",
  );

  // AC 2 (UI): production without VAPID keys.
  await page.goto(`${base}/profil`);
  const section = page.locator("#bildirimler");
  check(
    ((await section.textContent()) ?? "").includes("Bildirimler henüz açılmadı.") &&
      (await section.getByRole("button").count()) === 0,
    "Phase10 AC2 without VAPID keys: Bildirimler henüz açılmadı. and no button",
  );
  await page.goto(`${base}/`);
  await page.waitForTimeout(500);
  check(
    (await page.getByTestId("push-nudge").count()) === 0,
    "Phase10 AC19 without VAPID keys the home nudge never shows",
  );

  // AC 20: CDP delivers pushes to the real worker.
  await context.grantPermissions(["notifications"], { origin });
  const registrationId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no service worker registration")), 10_000);
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
      const r = registrations.find((x) => x.scopeURL === `${origin}/` && !x.isDeleted);
      if (r) {
        clearTimeout(timer);
        resolve(r.registrationId);
      }
    });
    void cdp.send("ServiceWorker.enable");
  });
  const worker = context.serviceWorkers().find((w) => w.url().startsWith(origin));

  const shown = () =>
    page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return (await reg.getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        icon: n.icon,
        badge: n.badge,
        url: n.data?.url,
      }));
    });
  const clear = () =>
    page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      for (const n of await reg.getNotifications()) n.close();
    });
  async function deliver(data) {
    await clear();
    await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data });
    for (let i = 0; i < 40; i++) {
      const list = await shown();
      if (list.length) return list;
      await page.waitForTimeout(250);
    }
    return [];
  }

  const [valid] = await deliver(JSON.stringify({ ...NOTE, url: "/yoklama" }));
  check(
    valid?.title === NOTE.title &&
      valid.body === NOTE.body &&
      valid.tag === NOTE.tag &&
      valid.icon === `${origin}/icons/icon-192.png` &&
      valid.badge === `${origin}/icons/badge-96.png`,
    `Phase10 AC20 a valid payload shows its title, body, tag, icon and badge (${JSON.stringify(valid)})`,
  );
  for (const [label, data] of [
    ["an empty payload", ""],
    ["a non-JSON payload", "not json"],
    ["JSON without a title", JSON.stringify({ body: "x" })],
  ]) {
    const [n] = await deliver(data);
    check(
      n?.title === "Arkhe" &&
        n.body === "Portalda yeni bir şey var." &&
        n.tag === "arkhe" &&
        n.url === "/",
      `Phase10 AC20 ${label} still shows Arkhe / Portalda yeni bir şey var. (${JSON.stringify(n)})`,
    );
  }

  // AC 21: the click handler. A real OS click can't be automated, so the worker dispatches the
  // notificationclick itself (an untrusted event: waitUntil throws, the handler body still runs).
  const click = () =>
    worker.evaluate(async () => {
      const [n] = await self.registration.getNotifications();
      try {
        self.dispatchEvent(new NotificationEvent("notificationclick", { notification: n }));
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
      return (await self.registration.getNotifications()).length;
    });
  const cases = [
    ["/repertuvar", "/repertuvar"],
    ["/profil#bildirimler", "/profil"],
    ["//evil.test/x", "/"],
    ["https://evil.test/", "/"],
    ["/\\evil.test", "/"],
    ["javascript:alert(1)", "/"],
  ];
  for (const [url, expected] of cases) {
    await page.goto(`${base}/finans`);
    const n = await deliver(JSON.stringify({ ...NOTE, url }));
    const left = n.length ? await click() : -1;
    await page.waitForURL((u) => u.pathname === expected, { timeout: 10_000 }).catch(() => {});
    const at = new URL(page.url());
    check(
      left === 0 && at.origin === origin && at.pathname === expected,
      `Phase10 AC21 click on url ${JSON.stringify(url)} closes it and navigates the open window to ${expected} (${at.pathname}, left ${left})`,
    );
  }
  const safe = await worker.evaluate(() =>
    ["/a", "//x.test", "https://x.test", "/\\x.test", "", null, 7, "a/b"].map((u) => safeTarget(u)),
  );
  check(
    JSON.stringify(safe) === JSON.stringify(["/a", "/", "/", "/", "/", "/", "/", "/"]),
    `Phase10 AC21 only single-slash same-origin paths pass (${safe})`,
  );
  await cdp.send("ServiceWorker.disable").catch(() => {});
}
