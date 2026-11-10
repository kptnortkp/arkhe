// Phase 18: the score viewer. In the home-screen iPhone app "Aç" opens the score inside the
// portal (pages drawn, Geri and the nav stay); everywhere else it keeps the new-tab viewer.
import { createRequire } from "node:module";
import { BASE, check, cleanup, db, login, loginAs, newPage } from "./lib.mjs";
import { newPiece, uploadScore } from "./omr.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts } = require("pdf-lib");

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) doc.addPage([595, 842]).drawText(`E2E nota sayfa ${n}`, { x: 50, y: 780, size: 24, font });
  return Buffer.from(await doc.save());
}

export default async function run(browser) {
  await cleanup();
  try {
    await suite(browser);
  } finally {
    await db.execute("delete from login_attempts where key like 'score%'");
    await cleanup();
  }
}

async function suite(browser) {
  const piece = await newPiece("E2E Nota Görüntüleyici");
  const sef = await loginAs(browser, "sef@arkhe.local");
  const up = await uploadScore(sef, piece, await twoPagePdf());
  check(up.status === 200 || up.status === 201, `a real two-page score uploads (${up.status})`);

  // Browser: "Aç" still targets the new-tab PDF.
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  await korist.goto(`${BASE}/repertuvar/${piece}`);
  const open = korist.getByRole("link", { name: "Aç: Nota (PDF)" });
  check((await open.getAttribute("target")) === "_blank" && (await open.getAttribute("href")).startsWith("/api/dosya/nota/"), "in a browser Aç opens the PDF in a new tab");

  // Home-screen iPhone app: the portal viewer.
  const app = await newPage(browser, { phone: true, context: { userAgent: IPHONE_UA } });
  await app.context().addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
  });
  await login(app, "korist@arkhe.local");
  await app.waitForURL(`${BASE}/`);
  await app.goto(`${BASE}/repertuvar/${piece}`);
  await app.getByRole("link", { name: "Aç: Nota (PDF)" }).click();
  await app.waitForURL(`${BASE}/repertuvar/${piece}/nota`);
  await app.getByTestId("pdf-page").nth(1).waitFor();
  await app.waitForFunction(() => [...document.querySelectorAll("[data-testid=pdf-page]")].every((c) => c.width > 0));
  const pages = await app.getByTestId("pdf-page").count();
  const drawn = await app.evaluate(() => {
    const c = document.querySelector("[data-testid=pdf-page]");
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 200) return true;
    return false;
  });
  check(pages === 2 && drawn, `the app shows both pages drawn inside the portal (${pages})`);
  check(await app.getByRole("navigation").last().isVisible(), "the bottom nav stays");
  const before = await app.evaluate(() => document.querySelector("[data-testid=pdf-page]").getBoundingClientRect().width);
  await app.getByRole("button", { name: "Yakınlaştır" }).click();
  await app.waitForFunction((w) => document.querySelector("[data-testid=pdf-page]").getBoundingClientRect().width > w * 1.4, before);
  check(true, "Yakınlaştır enlarges the pages");
  await app.getByRole("button", { name: "Geri" }).click();
  await app.waitForURL(`${BASE}/repertuvar/${piece}`);
  check(true, "Geri returns to the piece");

  await app.goto(`${BASE}/repertuvar/${crypto.randomUUID()}/nota`);
  check((await app.title()).includes("bulunamadı") || (await app.locator("text=404").count()) > 0 || (await app.getByTestId("pdf-viewer").count()) === 0, "an unknown piece has no viewer");
  const anon = await newPage(browser);
  await anon.goto(`${BASE}/repertuvar/${piece}/nota`);
  check(anon.url().includes("/giris"), "signed out, the viewer sends you to sign in");

  for (const p of [sef, korist, app, anon]) await p.context().close();
}
