// Phase 6: logo, icons, manifest, public PWA files and the install card (375×812 phone context).
import { BASE, check, login, newPage } from "./lib.mjs";

const LOCKUP = 'svg[role=img][aria-label="Arkhe Mülkiye Çoksesli Korosu"]';
const WORDMARK = 'svg[role=img][aria-label="Arkhe"]';
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const GENERIC = "Tarayıcı menüsünden “Ana ekrana ekle” ya da “Uygulamayı yükle”yi seç.";
const IOS = "Safari'de Paylaş simgesine, sonra “Ana Ekrana Ekle”ye dokun.";

/** PNG IHDR: width, height and colour type (2 = RGB without alpha). */
function pngHeader(buf) {
  const sig = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  return { sig, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

async function phonePage(browser, email, { scheme = "light", userAgent, init } = {}) {
  const page = await newPage(browser, {
    phone: true,
    context: { colorScheme: scheme, ...(userAgent ? { userAgent } : {}) },
  });
  if (init) await page.context().addInitScript(init);
  if (email) {
    await login(page, email);
    await page.waitForURL(`${BASE}/`);
  }
  return page;
}

export default async function phase6Brand(browser) {
  // AC2 + AC3: the logo components in both themes
  for (const scheme of ["light", "dark"]) {
    const anon = await phonePage(browser, null, { scheme });
    await anon.goto(`${BASE}/giris`);
    const loginLogo = anon.locator(`main ${LOCKUP}`);
    check(
      (await loginLogo.isVisible()) && (await loginLogo.getAttribute("fill")) === "currentColor",
      `AC2 /giris shows the lockup with currentColor (${scheme})`,
    );
    check(
      (await loginLogo.locator("text").count()) === 0,
      `AC2 the logo SVG has no <text> (${scheme})`,
    );
    await anon.context().close();

    const phone = await phonePage(browser, "korist@arkhe.local", { scheme });
    const mark = phone.locator(`header ${WORDMARK}`);
    const box = await mark.boundingBox();
    check(await mark.isVisible(), `AC2 the mobile header shows the wordmark (${scheme})`);
    check(
      box !== null && box.height >= 18 && box.height <= 20 && box.width < 375 / 2,
      `AC3 header wordmark is ${box?.width.toFixed(1)}×${box?.height.toFixed(1)} px (18–20 tall, < 50 % wide) (${scheme})`,
    );
    const link = await phone.locator('header a[aria-label="Ana sayfa"]').boundingBox();
    check(
      link !== null && link.height >= 44,
      `P3 the header logo link is a 44 px target (${scheme})`,
    );
    await phone.context().close();

    // The lockup's subtitle only reads on dense screens; 1× gets the wordmark.
    for (const dpr of [2, 1]) {
      const desk = await newPage(browser, {
        context: { colorScheme: scheme, deviceScaleFactor: dpr },
      });
      await login(desk, "korist@arkhe.local");
      await desk.waitForURL(`${BASE}/`);
      const lockup = desk.locator(`aside ${LOCKUP}`);
      const wordmark = desk.locator(`aside ${WORDMARK}`);
      if (dpr === 2) {
        const sideBox = await lockup.boundingBox();
        check(
          (await lockup.isVisible()) && !(await wordmark.isVisible()) && sideBox?.width >= 160,
          `AC3 sidebar lockup at 1280 px, 2× is ${sideBox?.width} px wide (≥ 160) (${scheme})`,
        );
      } else {
        check(
          (await wordmark.isVisible()) && !(await lockup.isVisible()),
          `AC3 sidebar shows the wordmark, not the lockup, at 1× (${scheme})`,
        );
      }
      await desk.context().close();
    }
  }

  // AC5, AC8, AC9, AC10 without a cookie
  const anon = await phonePage(browser, null);
  const get = (path) => anon.request.get(`${BASE}${path}`, { maxRedirects: 0 });
  let svgOk = true;
  for (const name of ["lockup", "wordmark", "monogram"]) {
    for (const suffix of ["", "-white"]) {
      const res = await get(`/brand/arkhe-${name}${suffix}.svg`);
      const body = await res.text();
      const ok =
        res.status() === 200 &&
        res.headers()["content-type"].startsWith("image/svg+xml") &&
        !body.includes("<text") &&
        body.includes("<title>");
      if (!ok) svgOk = false;
    }
  }
  check(svgOk, "AC5 six standalone SVGs: 200, image/svg+xml, <title>, no <text>");

  const manifestRes = await get("/manifest.webmanifest");
  const manifest = await manifestRes.json();
  check(
    manifestRes.status() === 200 &&
      manifest.name === "Arkhe · Mülkiye Çoksesli Korosu" &&
      manifest.short_name === "Arkhe" &&
      manifest.description ===
        "Arkhe korist portalı: çalışmalar, yoklama, repertuvar, ödevler ve aidat." &&
      manifest.lang === "tr" &&
      manifest.dir === "ltr" &&
      manifest.id === "/" &&
      manifest.start_url === "/" &&
      manifest.scope === "/" &&
      manifest.display === "standalone" &&
      manifest.background_color === "#0d0b19" &&
      manifest.theme_color === "#26214e",
    "AC9 manifest fields",
  );
  check(
    manifest.icons.some((i) => i.purpose === "maskable") &&
      manifest.shortcuts.map((s) => `${s.name}→${s.url}`).join(",") ===
        "Yoklama→/yoklama,Ödevlerim→/odevler",
    "AC9 maskable icon and the Yoklama / Ödevlerim shortcuts",
  );

  await anon.goto(`${BASE}/giris`);
  const links = await anon
    .locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')
    .evaluateAll((els) =>
      els.map((e) => ({
        rel: e.rel,
        href: e.getAttribute("href"),
        sizes: e.getAttribute("sizes"),
      })),
    );
  check(
    links.some((l) => l.rel === "manifest") &&
      links.some((l) => l.href.startsWith("/icon.svg")) &&
      links.some((l) => l.href.startsWith("/favicon.ico")) &&
      links.some((l) => l.rel === "apple-touch-icon"),
    "AC8 the HTML links the manifest, favicon.ico, icon.svg and apple-icon",
  );
  const icons = [
    ...manifest.icons.map((i) => ({ href: i.src, sizes: i.sizes, apple: false })),
    ...links
      .filter((l) => l.rel !== "manifest")
      .map((l) => ({ href: l.href, sizes: l.sizes, apple: l.rel === "apple-touch-icon" })),
  ];
  const bad = [];
  for (const icon of icons) {
    const res = await get(icon.href);
    if (res.status() !== 200) {
      bad.push(`${icon.href} ${res.status()}`);
      continue;
    }
    if (!icon.href.split("?")[0].endsWith(".png")) continue;
    const png = pngHeader(await res.body());
    const [w, h] = icon.sizes.split("x").map(Number);
    if (!png.sig || png.width !== w || png.height !== h)
      bad.push(`${icon.href} ${png.width}x${png.height}`);
    if (icon.apple && png.colorType !== 2) bad.push(`${icon.href} colour type ${png.colorType}`);
  }
  check(
    bad.length === 0,
    `AC8 every icon is 200 with its declared PNG size; apple icon has no alpha ${bad.join(" ")}`,
  );
  const iconSvg = await (await get(links.find((l) => l.href.startsWith("/icon.svg")).href)).text();
  check(
    iconSvg.includes("prefers-color-scheme:dark"),
    "AC7 icon.svg switches with prefers-color-scheme",
  );

  const publicPaths = [
    "/manifest.webmanifest",
    "/sw.js",
    "/offline.html",
    "/favicon.ico",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    links.find((l) => l.href.startsWith("/icon.svg")).href,
    links.find((l) => l.rel === "apple-touch-icon").href,
  ];
  const blocked = [];
  for (const path of publicPaths) {
    const res = await get(path);
    if (res.status() !== 200)
      blocked.push(`${path} ${res.status()} ${res.headers().location ?? ""}`);
  }
  check(
    blocked.length === 0,
    `AC10 manifest, icons, sw.js and offline.html are public ${blocked.join(" ")}`,
  );
  const sw = await get("/sw.js");
  check(
    sw.headers()["cache-control"] === "no-cache, no-store, must-revalidate" &&
      sw.headers()["content-type"].startsWith("application/javascript"),
    "AC13 sw.js is served no-store as JavaScript",
  );
  await anon.goto(`${BASE}/offline.html`);
  check(
    (await anon.title()) === "Çevrimdışı · Arkhe" &&
      (await anon.getByRole("heading", { name: "Bağlantı yok" }).isVisible()) &&
      (await anon.getByRole("link", { name: "Tekrar dene" }).getAttribute("href")) === "/",
    "AC16 offline.html has the title, heading and Tekrar dene → /",
  );
  await anon.context().close();

  // AC12 install card: generic, iOS, standalone
  for (const scheme of ["light", "dark"]) {
    const page = await phonePage(browser, "korist@arkhe.local", { scheme });
    await page.goto(`${BASE}/profil`);
    const card = page.getByTestId("install-card");
    await card.waitFor();
    const order = await page.evaluate(() => {
      const c = document.querySelector("[data-testid=install-card]");
      const next = c.nextElementSibling;
      return [next?.id, next?.nextElementSibling?.id].join(" ");
    });
    check(
      (await card.getByRole("heading", { name: "Telefonuna ekle" }).isVisible()) &&
        (await card.getByText(GENERIC).isVisible()) &&
        // Phase 10 puts Bildirimler between the install card and Aidatım.
        order === "bildirimler aidat",
      `AC12 /profil shows Telefonuna ekle with the generic text, then Bildirimler, then Aidatım (${scheme})`,
    );
    await page.context().close();
  }
  const iphone = await phonePage(browser, "korist@arkhe.local", { userAgent: IPHONE });
  await iphone.goto(`${BASE}/profil`);
  await iphone.getByTestId("install-card").waitFor();
  check(
    (await iphone.getByTestId("install-card").getByText(IOS).isVisible()) &&
      (await iphone.getByRole("button", { name: "Ana ekrana ekle" }).count()) === 0,
    "AC12 an iPhone gets the Safari Paylaş text",
  );
  await iphone.context().close();

  const prompt = await phonePage(browser, "korist@arkhe.local");
  await prompt.goto(`${BASE}/profil`);
  await prompt.getByTestId("install-card").waitFor();
  await prompt.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  const add = prompt.getByRole("button", { name: "Ana ekrana ekle" });
  await add.waitFor();
  const addBox = await add.boundingBox();
  await add.click();
  check(
    addBox.height >= 44 &&
      (await prompt.getByText("Eklendi. Arkhe'yi artık ana ekranından açabilirsin.").isVisible()),
    "AC12 a stored prompt shows Ana ekrana ekle (≥ 44 px); accepting shows Eklendi.",
  );
  await prompt.context().close();

  // This Chrome ignores CDP display-mode emulation, so the checks are stubbed instead; each stub
  // flags that the card consulted it, so the assertion runs only after the card decided.
  const stubs = {
    "display-mode: standalone": () => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (!q.includes("display-mode: standalone")) return original(q);
        window.__standaloneQueried = true;
        return {
          matches: true,
          media: q,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => false,
        };
      };
    },
    "navigator.standalone (iOS)": () => {
      Object.defineProperty(Navigator.prototype, "standalone", {
        get() {
          window.__standaloneQueried = true;
          return true;
        },
      });
    },
  };
  for (const [label, init] of Object.entries(stubs)) {
    const standalone = await phonePage(browser, "korist@arkhe.local", { init });
    await standalone.goto(`${BASE}/profil`);
    await standalone.getByRole("heading", { name: "Aidatım" }).waitFor();
    await standalone.waitForFunction(() => window.__standaloneQueried === true);
    // One more frame so React has committed whatever the snapshot decided.
    await standalone.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    check(
      (await standalone.getByTestId("install-card").count()) === 0,
      `AC12 the card is not rendered under ${label}`,
    );
    await standalone.context().close();
  }
}
