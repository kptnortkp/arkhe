// Phase 10 legacy browsers: the inline probe, the CSS-only banner and push notice, and the core
// flows (login, code check-in, read-only pages) with JavaScript disabled.
import {
  BASE,
  check,
  db,
  DEMO_PASSWORD,
  insertRehearsal,
  loginAs,
  markOf,
  newPage,
} from "./lib.mjs";

const PUSH_UNSUPPORTED = "Bu cihaz bildirimleri desteklemiyor. iPhone'da iOS 16.4 ve üstü gerekir.";
const IOS15_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";
const KORIST = "korist@arkhe.local";

/** Removes the built-ins the inline probe looks for, before any page script runs. */
async function simulateLegacy(context) {
  await context.addInitScript(() => {
    delete Array.prototype.at;
    delete Object.hasOwn;
    delete window.structuredClone;
  });
}

async function loginNoJs(page, email) {
  await page.goto(`${BASE}/giris`, { waitUntil: "load" });
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", DEMO_PASSWORD);
  await page.click("main button[type=submit]");
  await page.waitForURL(`${BASE}/`, { waitUntil: "load" });
}

export default async function run(browser, shots) {
  await legacyBanner(browser, shots);
  await hydratedUnsupported(browser);
  await withoutJs(browser);
}

async function legacyBanner(browser, shots) {
  for (const colorScheme of ["light", "dark"]) {
    const page = await newPage(browser, { phone: true, context: { colorScheme } });
    await simulateLegacy(page.context());
    await page.goto(`${BASE}/giris`);
    await page.fill("input[name=email]", KORIST);
    await page.fill("input[name=password]", DEMO_PASSWORD);
    await page.click("main button[type=submit]");
    await page.waitForURL(`${BASE}/`);
    check(
      await page.evaluate(() => document.documentElement.classList.contains("legacy-browser")),
      `${colorScheme}: the probe marks <html> with legacy-browser`,
    );
    check(
      await page.getByTestId("legacy-banner").isVisible(),
      `${colorScheme}: a legacy browser sees the banner`,
    );
    await page.goto(`${BASE}/profil`);
    await page.waitForTimeout(3000);
    check(
      await page.getByTestId("push-legacy").isVisible(),
      `${colorScheme}: Bildirimler shows the server-rendered unsupported notice`,
    );
    check(
      (await page.getByTestId("push-legacy").textContent()).trim() === PUSH_UNSUPPORTED,
      `${colorScheme}: the notice reads "${PUSH_UNSUPPORTED}"`,
    );
    check(
      !(await page.getByText("kontrol ediliyor").isVisible()),
      `${colorScheme}: no "kontrol ediliyor" is visible after 3 s`,
    );
    check(
      (await page.locator("[data-testid=push-pref]:visible").count()) === 0,
      `${colorScheme}: the notification switches are hidden`,
    );
    if (shots) {
      await page.locator("#bildirimler").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/legacy-profile-${colorScheme}.png` });
    }
    await page.context().close();
  }

  const modern = await loginAs(browser, KORIST, { phone: true });
  check(
    !(await modern.evaluate(() => document.documentElement.classList.contains("legacy-browser"))),
    "a modern browser is not marked legacy",
  );
  check(
    !(await modern.getByTestId("legacy-banner").isVisible()),
    "a modern browser sees no banner",
  );
  await modern.goto(`${BASE}/profil`);
  check(
    !(await modern.getByTestId("push-legacy").isVisible()),
    "a modern browser sees no legacy push notice",
  );
  await modern.context().close();
}

async function hydratedUnsupported(browser) {
  const page = await newPage(browser, { phone: true, context: { userAgent: IOS15_UA } });
  await page.goto(`${BASE}/giris`);
  await page.fill("input[name=email]", KORIST);
  await page.fill("input[name=password]", DEMO_PASSWORD);
  await page.click("main button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/profil`);
  const settled = await page
    .locator("[data-testid=push-device]:not([data-state=loading])")
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(settled, "iOS 15 with React: the device state leaves loading");
  check(
    (await page.getByTestId("push-state-text").textContent())?.trim() === PUSH_UNSUPPORTED,
    "iOS 15 with React: the panel shows the same unsupported text (not add-to-home-screen)",
  );
  check(
    (await page.getByText("kontrol ediliyor").count()) === 0,
    "iOS 15 with React: no kontrol ediliyor",
  );
  await page.context().close();
}

async function withoutJs(browser) {
  const sef = await loginAs(browser, "sef@arkhe.local");
  const page = await newPage(browser, { phone: true, context: { javaScriptEnabled: false } });
  await loginNoJs(page, KORIST);
  check(true, "no JS: login with the plain form post lands on the home page");

  for (const [path, heading] of [
    ["/odevler", "Ödevler"],
    ["/repertuvar", "Repertuvar"],
    ["/yoklama", null],
    ["/", null],
  ]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    // Streamed (Suspense) content stays where React put it, outside <main>, when no script can move it.
    const h1 = (await page.locator("h1:visible").first().textContent())?.trim() ?? "";
    check(
      res.status() === 200 && h1.length > 0 && (!heading || h1.includes(heading)),
      `no JS: ${path} renders on the server (${h1})`,
    );
  }

  const live = await insertRehearsal({ title: "E2E Eski Tarayıcı", startOffsetMin: -5 });
  try {
    await sef.goto(`${BASE}/calismalar/${live}`);
    await sef.getByRole("button", { name: "Yoklamayı başlat" }).click();
    await sef.waitForURL(`${BASE}/calismalar/${live}/canli`);
    const liveCode = async () => (await sef.getByTestId("live-code").textContent()).trim();

    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Geldim" }).click();
    await page.waitForURL(`${BASE}/yoklama/kod/${live}`, { waitUntil: "load" });
    check(true, "no JS: Geldim opens the code page");

    const wrong = (await liveCode()) === "0000" ? "0001" : "0000";
    await page.fill("#checkin-code", wrong);
    await page.click("main button[type=submit]");
    await page.waitForURL(`${BASE}/yoklama/kod/${live}?hata=kod`, { waitUntil: "load" });
    check(
      await page.getByText("Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.").isVisible(),
      "no JS: a wrong code shows the error",
    );
    check((await markOf(live, KORIST)) === null, "no JS: a wrong code writes nothing");

    await page.fill("#checkin-code", await liveCode());
    await page.click("main button[type=submit]");
    await page.waitForURL(`${BASE}/yoklama/kod/${live}`, { waitUntil: "load" });
    check(
      (await page.getByTestId("qr-state").textContent()).includes("Yoklamaya katıldın"),
      "no JS: the right code shows Yoklamaya katıldın",
    );
    const mark = await markOf(live, KORIST);
    check(
      mark && (mark.status === "present" || mark.status === "late") && mark.method === "code",
      `no JS: the attendance row is written (${mark?.status}, ${mark?.method})`,
    );
  } finally {
    await db.execute("delete from login_attempts");
    await page.context().close();
    await sef.context().close();
  }
}
