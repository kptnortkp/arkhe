// Production smoke test: builds, seeds a throwaway DB, runs `next start` on 3101 and checks what
// only a production build does (CSP without eval, secure cookies, service worker, offline page,
// installability, demo refusal, env check). Usage: npm run e2e:prod
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { wavBytes } from "../scripts/media-fixture.mjs";
import { pushWorkerChecks } from "./prod-push.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROD_DB = path.join(ROOT, "data/e2e-prod.db");
const PORT = 3101;
const BAD_PORT = 3102;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const NEXT = path.join(ROOT, "node_modules/.bin/next");
const BOARD_EMAIL = "e2e-yk@example.org";
const MEMBER_EMAIL = "e2e-member@example.org";
const ADMIN_EMAIL = "admin@e2e-prod.test";
const ADMIN_PASSWORD = "e2e-prod-admin-2026";
const DEMO_EMAIL = "korist@arkhe.local";

// The runner itself is never production, so the fixture guards keep meaning something; only the
// server child gets NODE_ENV=production.
if (process.env.NODE_ENV === "production")
  throw new Error("Run e2e:prod without NODE_ENV=production.");
// Delete before lib.mjs opens its client on the path; a crashed run may have left files behind.
removeDb();
process.env.DATABASE_URL = `file:${PROD_DB}`;
process.env.E2E_BASE_URL = BASE_URL;
const {
  BASE,
  DEMO_PASSWORD,
  check,
  cspViolations,
  db,
  launch,
  launchPersistent,
  newPage,
  summary,
  watchConsole,
} = await import("./lib.mjs");

const childEnv = (extra = {}) => {
  const env = { ...process.env, DATABASE_URL: `file:${PROD_DB}`, APP_URL: BASE_URL };
  delete env.DATABASE_AUTH_TOKEN;
  delete env.TRUST_PROXY_HEADERS;
  delete env.NODE_ENV;
  return { ...env, ...extra };
};
const run = (cmd, args, extra) =>
  execFileSync(cmd, args, {
    cwd: ROOT,
    env: childEnv(extra),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

function removeDb() {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(PROD_DB + suffix, { force: true });
  // The local file store of this database (src/lib/storage/root.mjs).
  rmSync(path.join(ROOT, "data/uploads-e2e-prod"), { recursive: true, force: true });
}

function startServer(port, extra) {
  const child = spawn(NEXT, ["start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: childEnv({ NODE_ENV: "production", ...extra }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => (child.output.stdout += d));
  child.stderr.on("data", (d) => (child.output.stderr += d));
  child.exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await child.exited;
  clearTimeout(timer);
}

async function waitForHealth(child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`next start exited:\n${child.output.stderr}`);
    try {
      const res = await fetch(`${BASE_URL}/api/saglik`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("next start did not become healthy in 60 s");
}

const nonceOf = (csp) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
const scriptSrc = (csp) =>
  (csp ?? "")
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src")) ?? "";

async function cspCheck(request, url, label) {
  const res = await request.get(url);
  const csp = res.headers()["content-security-policy"];
  const nonce = nonceOf(csp);
  const html = await res.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  check(
    res.status() === 200 &&
      Boolean(nonce) &&
      scripts.length > 0 &&
      scripts.every((tag) => tag.includes(`nonce="${nonce}"`)),
    `AC19 ${label}: every <script> carries the header nonce (${scripts.length} scripts)`,
  );
  const src = scriptSrc(csp);
  check(
    src.includes("'strict-dynamic'") &&
      !src.includes("unsafe-inline") &&
      !src.includes("unsafe-eval"),
    `AC19/21 ${label}: script-src has strict-dynamic, no unsafe-inline, no unsafe-eval`,
  );
  return { res, nonce };
}

async function cacheUrls(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const key of await caches.keys()) {
      for (const req of await (await caches.open(key)).keys()) out.push(req.url);
    }
    return out;
  });
}

const ALLOWED_CACHE =
  /^\/(?:_next\/static\/|brand\/|icons\/|favicon\.ico$|icon\.svg$|apple-icon\.png$|manifest\.webmanifest$|offline\.html$)/;

async function loginWith(page, email, password) {
  await page.goto(`${BASE}/giris`);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/giris",
    ),
    page.click("main button[type=submit]"),
  ]);
  return res;
}

async function setCookies(res) {
  return (await res.headersArray())
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

async function isOfflinePage(page, url) {
  try {
    await page.goto(url, { timeout: 10_000 });
  } catch {
    return false;
  }
  return (await page.title()) === "Çevrimdışı · Arkhe";
}

// Phase 7: the backup flow on production builds with alternative env sets, each on BAD_PORT.
const OUTBOX = path.join(ROOT, "data/outbox");
const outboxFiles = () => {
  mkdirSync(OUTBOX, { recursive: true });
  return readdirSync(OUTBOX).filter((f) => f.endsWith(".eml")).length;
};
const AC22_TEXT =
  'E-posta hesabı ayarlanmamış (SMTP_USER, SMTP_PASS). README: "Aylık yedek e-postası".';
const AC23_TEXT =
  'Yedek şifresi ayarlanmamış ya da geçersiz (BACKUP_PASSPHRASE). README: "Aylık yedek e-postası".';
const NO_SMTP = { SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "", SMTP_HOST: "", SMTP_PORT: "" };

async function withServer(extra, fn) {
  const url = `http://127.0.0.1:${BAD_PORT}`;
  const child = startServer(BAD_PORT, { APP_URL: url, ...NO_SMTP, ...extra });
  try {
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw new Error(`next start exited:\n${child.output.stderr}`);
      try {
        if ((await fetch(`${url}/api/saglik`)).ok) break;
      } catch {}
      if (i > 120) throw new Error("phase 7 server did not become healthy");
      await new Promise((r) => setTimeout(r, 500));
    }
    await fn(url, child);
  } finally {
    await stopServer(child);
  }
}

async function adminOn(url) {
  const page = await newPage(browser, { phone: true });
  await page.goto(`${url}/giris`);
  await page.fill("input[name=email]", ADMIN_EMAIL);
  await page.fill("input[name=password]", ADMIN_PASSWORD);
  await page.click("main button[type=submit]");
  await page.waitForURL(`${url}/`);
  return page;
}

async function seen(page, message) {
  try {
    await page.getByText(message, { exact: true }).first().waitFor({ timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

async function saveRecipients(page, url, values) {
  await page.goto(`${url}/yedek`);
  const form = page.locator("[data-testid=backup-recipients-form]");
  const inputs = form.locator("input[name=recipients]");
  while ((await inputs.count()) > 1) {
    await form.getByRole("button", { name: /^\d+\. alıcıyı kaldır$/ }).last().click();
  }
  for (let i = 0; i < values.length; i++) {
    if (i > 0) await form.getByRole("button", { name: "Adres ekle" }).click();
    await inputs.nth(i).fill(values[i]);
  }
  await form.getByRole("button", { name: "Kaydet" }).click();
}

/** Şimdi gönder through the UI; returns the first Geçmiş row's text. */
async function sendNow(page, url) {
  await page.goto(`${url}/yedek`);
  await page.getByRole("button", { name: "Şimdi gönder" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Gönder", exact: true }).click();
  const toastOk = await seen(page, "Gönderilemedi. Ayrıntı aşağıda, Geçmiş'te.");
  await page.goto(`${url}/yedek`);
  const row = page.locator("[data-testid=backup-run]").first();
  return {
    toastOk,
    status: await row.getAttribute("data-status").catch(() => null),
    text: ((await row.textContent().catch(() => "")) ?? "").replace(/\s+/g, " "),
  };
}

const setupOk = async (page, id) =>
  page.locator(`[data-testid=backup-setup-${id}]`).getAttribute("data-ok");

async function phase7() {
  console.log("# phase 7 backup");
  const before = outboxFiles();
  const passphrase = randomBytes(18).toString("base64");
  const cronSecret = randomBytes(32).toString("hex");
  const secrets = [passphrase, cronSecret, "dev-only-backup-passphrase", "dev-only-cron-secret"];

  // B: a 31-character CRON_SECRET (too short for production), a valid passphrase, no SMTP.
  const shortSecret = "s".repeat(31);
  await withServer({ CRON_SECRET: shortSecret, BACKUP_PASSPHRASE: passphrase }, async (url, child) => {
    const res = await fetch(`${url}/api/cron/aylik-yedek`, {
      headers: { Authorization: `Bearer ${shortSecret}` },
    });
    check(
      res.status === 503 && (await res.text()) === "{}",
      `Phase7 AC2 a 31-character CRON_SECRET → 503 {} even with the matching bearer (${res.status})`,
    );
    check(
      (child.output.stdout + child.output.stderr).includes(
        "Monthly backup email is not fully configured: SMTP_USER, SMTP_PASS, CRON_SECRET",
      ),
      "Phase7 P9 the boot warning names the missing variables, never values",
    );
    const page = await adminOn(url);
    await saveRecipients(page, url, ["p7prod-a@e2e.test"]);
    check(
      await seen(page, "Alıcılar kaydedildi."),
      "Phase7 AC14 prod: the first save works without SMTP",
    );
    await saveRecipients(page, url, ["p7prod-a@e2e.test", "p7prod-b@e2e.test"]);
    const saved = await seen(page, "Alıcılar kaydedildi.");
    const warned = await seen(
      page,
      "Bilgi e-postası gönderilemedi. Eski ve yeni alıcılara sen haber ver.",
    );
    const value = (
      await db.execute("select value from app_settings where key = 'backup_recipients'")
    ).rows[0]?.value;
    check(
      saved && warned && value === "p7prod-a@e2e.test,p7prod-b@e2e.test",
      `Phase7 AC14 prod: a change without SMTP keeps the new value and warns (${value})`,
    );
    await page.goto(`${url}/yedek`);
    check(
      (await setupOk(page, "smtp")) === "false" &&
        (await setupOk(page, "passphrase")) === "true" &&
        (await setupOk(page, "cron")) === "false",
      "Phase7 AC22 Kurulum: E-posta hesabı and Zamanlayıcı anahtarı Eksik, Yedek şifresi Tamam",
    );
    const sent = await sendNow(page, url);
    check(
      sent.toastOk && sent.status === "failed" && sent.text.includes(AC22_TEXT),
      `Phase7 AC22 a manual send without SMTP logs the SMTP message (${sent.text})`,
    );
    const home = await page.goto(`${url}/`);
    check(home.status() === 200, "Phase7 AC22 / still loads");
    await page.context().close();
  });

  // C: both dev values.
  await withServer(
    { CRON_SECRET: "dev-only-cron-secret", BACKUP_PASSPHRASE: "dev-only-backup-passphrase" },
    async (url) => {
      const res = await fetch(`${url}/api/cron/aylik-yedek`, {
        headers: { Authorization: "Bearer dev-only-cron-secret" },
      });
      check(res.status === 503, `Phase7 AC25 the dev CRON_SECRET → 503 (${res.status})`);
      const page = await adminOn(url);
      await page.goto(`${url}/yedek`);
      check(
        (await setupOk(page, "passphrase")) === "false" &&
          (await setupOk(page, "cron")) === "false" &&
          ((await page.locator("[data-testid=backup-setup-passphrase]").textContent()) ?? "").includes(
            "Çok kısa ya da deneme şifresi; yenisini gir.",
          ),
        "Phase7 AC25 Kurulum marks the dev passphrase and secret Eksik, with the reason",
      );
      const sent = await sendNow(page, url);
      check(
        sent.status === "failed" && sent.text.includes(AC23_TEXT),
        `Phase7 AC25 a manual send with the dev passphrase fails with the AC23 message`,
      );
      await page.context().close();
    },
  );

  // D: a valid CRON_SECRET, no passphrase.
  await withServer({ CRON_SECRET: cronSecret, BACKUP_PASSPHRASE: "" }, async (url) => {
    const page = await adminOn(url);
    const sent = await sendNow(page, url);
    check(
      sent.status === "failed" && sent.text.includes(AC23_TEXT),
      "Phase7 AC23 a manual send without BACKUP_PASSPHRASE fails with its message",
    );
    const res = await fetch(`${url}/api/cron/aylik-yedek?bugun=2020-01-01`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const body = await res.json().catch(() => null);
    const old = (await db.execute("select count(*) as n from backup_runs where report_month = '2019-12'"))
      .rows[0].n;
    check(
      res.status === 500 && body?.status === "failed" && Number(old) === 0,
      `Phase7 AC30 production ignores ?bugun= (no 2019-12 run; ${res.status} ${JSON.stringify(body)})`,
    );
    await page.goto(`${url}/yedek`);
    check((await setupOk(page, "cron")) === "true", "Phase7 AC2 a 64-hex CRON_SECRET counts as set");
    await page.context().close();
  });

  const errors = (await db.execute("select error from backup_runs where error is not null")).rows;
  check(
    errors.length >= 3 && errors.every((r) => secrets.every((v) => !String(r.error).includes(v))),
    `Phase7 AC24 no failed row holds a secret value (${errors.length} rows)`,
  );
  check(outboxFiles() === before, "Phase7 P8 production never writes to the file outbox");
}

let server;
let profileDir;
let persistent;
let browser;
try {
  // 1. Build (writes .next/, never .next/dev, so the dev server keeps running).
  console.log("# build");
  const buildOut = run(NEXT, ["build"], { NODE_ENV: "production" });
  console.log(buildOut.split("\n").filter((l) => /yedek/.test(l)).join("\n"));
  check(
    /ƒ \/yedek\b/.test(buildOut) && /ƒ \/api\/cron\/aylik-yedek\b/.test(buildOut),
    "Phase7 AC37 the build table shows /yedek and /api/cron/aylik-yedek as dynamic (ƒ)",
  );

  // 2. Throwaway DB: migrate, check, seed, rename the board user, create an admin invite.
  console.log("# database");
  run("npx", ["drizzle-kit", "migrate"]);
  run("npx", ["tsx", "scripts/db-check.ts"]);
  run("npx", ["tsx", "scripts/seed.ts"]);
  await db.execute({
    sql: "update users set email = ? where email = 'yk@arkhe.local'",
    args: [BOARD_EMAIL],
  });
  // Phase 8: a member that can log in (demo addresses are refused in production).
  await db.execute({
    sql: `update users set email = ? where id = (select id from users where role = 'member'
            and is_active = 1 and email <> ? order by email limit 1)`,
    args: [MEMBER_EMAIL, DEMO_EMAIL],
  });
  const adminOut = run("npx", ["tsx", "scripts/create-admin.ts", "E2E Admin", ADMIN_EMAIL]);
  const inviteUrl = /(http:\/\/\S+\/davet\/\S+)/.exec(adminOut)?.[1];
  check(
    inviteUrl?.startsWith(`${BASE_URL}/davet/`),
    "README step 4: create-admin prints an invite link on APP_URL",
  );

  // 3. AC27: a bad APP_URL stops the server before it serves anything.
  console.log("# env check");
  const bad = startServer(BAD_PORT, { APP_URL: "http://example.org" });
  const badCode = await Promise.race([
    bad.exited,
    new Promise((r) => setTimeout(() => r("timeout"), 15_000)),
  ]);
  if (badCode === "timeout") await stopServer(bad);
  check(
    typeof badCode === "number" && badCode !== 0 && bad.output.stderr.includes("APP_URL"),
    `AC27 APP_URL=http://example.org → exit ${badCode}, stderr names APP_URL`,
  );

  // 4. The real server.
  console.log("# server");
  server = startServer(PORT);
  await waitForHealth(server);
  check(
    server.output.stdout
      .concat(server.output.stderr)
      .includes("TRUST_PROXY_HEADERS is not set; per-IP login limits are off."),
    "AC26 boot warning when TRUST_PROXY_HEADERS is unset",
  );
  const health = await fetch(`${BASE_URL}/api/saglik`);
  check(
    health.status === 200 &&
      JSON.stringify(await health.json()) === '{"ok":true}' &&
      health.headers.get("cache-control") === "no-store",
    'AC29 /api/saglik → {"ok":true}, no-store',
  );

  browser = await launch();

  // Admin invite on the prod build: sets a password and lands logged in.
  const admin = await newPage(browser, { mobile: true });
  await admin.goto(inviteUrl);
  await admin.fill("input[name=password]", ADMIN_PASSWORD);
  await admin.fill("input[name=confirm]", ADMIN_PASSWORD);
  await admin.click("main button[type=submit]");
  await admin.waitForURL(`${BASE}/`, { timeout: 15_000 }).catch(() => {});
  check(
    new URL(admin.url()).pathname === "/",
    "README step 4: the invite sets a password and logs the admin in",
  );
  await admin.context().close();

  // AC24: demo accounts are refused with the generic message.
  const demo = await newPage(browser, { mobile: true });
  await loginWith(demo, DEMO_EMAIL, DEMO_PASSWORD);
  await demo
    .getByText("E-posta ya da şifre hatalı.")
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  check(
    (await demo.getByText("E-posta ya da şifre hatalı.").count()) === 1 &&
      new URL(demo.url()).pathname === "/giris",
    "AC24 korist@arkhe.local is refused with E-posta ya da şifre hatalı.",
  );
  await demo.context().close();

  // AC21: headers on HTML.
  const anon = await newPage(browser, { mobile: true });
  const giris = await anon.request.get(`${BASE}/giris`);
  const h = giris.headers();
  check(
    h["strict-transport-security"] === "max-age=63072000; includeSubDomains" &&
      h["x-content-type-options"] === "nosniff" &&
      h["x-frame-options"] === "DENY" &&
      h["referrer-policy"] === "strict-origin-when-cross-origin" &&
      h["cross-origin-opener-policy"] === "same-origin" &&
      (h["permissions-policy"] ?? "").includes("camera=()") &&
      !("x-powered-by" in h),
    "AC21 HSTS, nosniff, DENY, strict-origin-when-cross-origin, COOP, Permissions-Policy present; no X-Powered-By",
  );

  // AC19 (logged out): /giris, and two requests get different nonces.
  const a = await cspCheck(anon.request, `${BASE}/giris`, "/giris");
  const b = await cspCheck(anon.request, `${BASE}/giris`, "/giris again");
  check(a.nonce && b.nonce && a.nonce !== b.nonce, "AC19 two requests get different nonces");
  const imageLike = await anon.request.get(`${BASE}/davet/x.png`);
  check(
    Boolean(nonceOf(imageLike.headers()["content-security-policy"])),
    "AC19 a page path ending in .png (/davet/x.png) still gets the CSP",
  );
  await anon.context().close();

  // Persistent profile: installability needs a non-incognito context.
  profileDir = mkdtempSync(path.join(os.tmpdir(), "arkhe-e2e-prod-"));
  persistent = await launchPersistent(profileDir, { viewport: { width: 375, height: 812 } });
  const page = watchConsole(persistent.pages()[0] ?? (await persistent.newPage()));
  const cdp = await persistent.newCDPSession(page);

  await page.goto(`${BASE}/giris`);
  const errorsGiris = (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors;
  check(errorsGiris.length === 0, `AC11 /giris is installable (${JSON.stringify(errorsGiris)})`);

  // AC22: session cookie flags from the raw login response.
  const loginRes = await loginWith(page, BOARD_EMAIL, DEMO_PASSWORD);
  const session = (await setCookies(loginRes)).find((c) => c.startsWith("__Host-arkhe_session="));
  check(
    session &&
      /;\s*Secure/i.test(session) &&
      /;\s*HttpOnly/i.test(session) &&
      /;\s*SameSite=Lax/i.test(session) &&
      /;\s*Path=\/(;|$)/i.test(session) &&
      !/;\s*Domain=/i.test(session),
    `AC22 __Host-arkhe_session is Secure, HttpOnly, SameSite=Lax, Path=/, no Domain`,
  );
  await page.waitForURL(`${BASE}/`);

  const errorsHome = (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors;
  check(errorsHome.length === 0, `AC11 / is installable (${JSON.stringify(errorsHome)})`);

  // AC19 (logged in): /, the live screen.
  await cspCheck(page.request, `${BASE}/`, "/");
  const { rows: rehearsalRows } = await db.execute(
    "select id from rehearsals order by starts_at desc limit 1",
  );
  const rehearsalId = rehearsalRows[0]?.id;
  await cspCheck(page.request, `${BASE}/calismalar/${rehearsalId}/canli`, "/calismalar/<id>/canli");

  // Phase 8: the board and budget pages build, carry the CSP and refuse a member.
  for (const p of ["/yonetim", "/yonetim/1", "/finans/butce"]) {
    await cspCheck(page.request, `${BASE}${p}`, p);
  }
  const member = await newPage(browser, { mobile: true });
  await loginWith(member, MEMBER_EMAIL, DEMO_PASSWORD);
  await member.waitForURL(`${BASE}/`).catch(() => {});
  const landed = [];
  for (const p of ["/yonetim", "/yonetim/1", "/yonetim/arsiv", "/finans/butce", "/finans/butce/yeni"]) {
    await member.goto(`${BASE}${p}`);
    await member.waitForURL(`${BASE}/`, { timeout: 10_000 }).catch(() => {});
    landed.push(new URL(member.url()).pathname);
  }
  check(
    landed.every((p) => p === "/"),
    `Phase8 AC45 production: /yonetim and /finans/butce redirect a member to / (${landed})`,
  );
  const { rows: budgetRows } = await db.execute("select id from budgets limit 1");
  const memberCsv = await member.request.get(`${BASE}/finans/butce/${budgetRows[0].id}/csv`);
  check(memberCsv.status() === 403, `Phase8 AC24 production: the budget CSV answers a member 403 (${memberCsv.status()})`);

  // Phase 8b: the import pages refuse a member; the AC19 fault cookie is inert in production.
  const importLanded = [];
  for (const p of ["/ice-aktar", "/ice-aktar/uyeler", "/ice-aktar/gecmis"]) {
    await member.goto(`${BASE}${p}`);
    await member.waitForURL(`${BASE}/`, { timeout: 10_000 }).catch(() => {});
    importLanded.push(new URL(member.url()).pathname);
  }
  const importCsv = await member.request.get(`${BASE}/ice-aktar/uye-listesi`);
  check(
    importLanded.every((p) => p === "/") && importCsv.status() === 403,
    `Phase8b AC45 production: /ice-aktar redirects a member and the member list answers 403 (${importLanded}, ${importCsv.status()})`,
  );
  await member.context().close();
  await cspCheck(page.request, `${BASE}/ice-aktar/donemler`, "/ice-aktar/donemler");
  await page.context().addCookies([{ name: "arkhe_e2e_import_fault", value: "1", url: BASE }]);
  await page.goto(`${BASE}/ice-aktar/donemler`);
  await page.locator("[data-testid=import-result][data-ready]").waitFor({ state: "attached" });
  await page.getByRole("tab", { name: "Metni yapıştır" }).click();
  await page.getByLabel("CSV metni").fill("ad;baslangic;bitis\nE2E Prod Dönemi;2021-09-01;2022-01-31\n");
  await page.getByRole("button", { name: "Kontrol et" }).click();
  await page.locator("[data-testid=import-result][data-kind=clean]").waitFor();
  await page.getByRole("button", { name: /^İçe aktar \(/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "İçe aktar" }).click();
  await page.locator("[data-testid=import-result]:not([data-kind=clean])").waitFor();
  const imported = await page.locator("[data-testid=import-result]").getAttribute("data-kind");
  const { rows: prodTerms } = await db.execute("select count(*) n from terms where name = 'E2E Prod Dönemi'");
  check(
    imported === "done" && Number(prodTerms[0].n) === 1,
    `Phase8b AC19/45 production ignores the fault cookie: the import succeeds in full (${imported})`,
  );
  await page.context().clearCookies({ name: "arkhe_e2e_import_fault" });

  // Phase 9: recordings and MIDI on the production build.
  console.log("# phase 9");
  const chunkDir = path.join(ROOT, ".next/static/chunks");
  const chunks = readdirSync(chunkDir, { recursive: true }).filter((f) => String(f).endsWith(".js"));
  const playerChunks = chunks.filter((f) =>
    readFileSync(path.join(chunkDir, String(f)), "utf8").includes("arkhe-midi-player"),
  );
  const gz = playerChunks.map((f) => gzipSync(readFileSync(path.join(chunkDir, String(f)))).length);
  check(
    playerChunks.length === 1 && gz[0] <= 60 * 1024,
    `Phase9 AC52 the MIDI player chunk is ≤ 60 KB gzipped (${playerChunks.map((f, i) => `${path.basename(String(f))}=${gz[i]} B`)})`,
  );
  const { rows: avePiece } = await db.execute("select id from pieces where title = 'Ave Verum Corpus'");
  const HW_A = "00000000-0000-4000-8000-00000000000a";
  const initial = [];
  for (const p of [`/repertuvar/${avePiece[0].id}`, `/odevler/${HW_A}`]) {
    const html = await (await page.request.get(`${BASE}${p}`)).text();
    const name = playerChunks[0] ? path.basename(String(playerChunks[0])) : "\u0000";
    initial.push(`${p}:${html.includes("arkhe-midi-player") || html.includes(name) ? "referenced" : "clean"}`);
  }
  check(
    initial.every((x) => x.endsWith(":clean")),
    `Phase9 AC52 the player chunk isn't in the initial HTML of the piece and homework pages (${initial})`,
  );
  // The chunk arrives on the first Çal tap, not before.
  const chunkRequests = [];
  const onRequest = (r) => playerChunks[0] && r.url().endsWith(path.basename(String(playerChunks[0]))) && chunkRequests.push(r.url());
  page.on("request", onRequest);
  await page.goto(`${BASE}/repertuvar/${avePiece[0].id}?partisyon=tumu`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const beforeTap = chunkRequests.length;
  await page.getByRole("button", { name: "Çal: MIDI · Tutti" }).click();
  await page.locator("[data-midi-player][data-state=playing]").waitFor({ timeout: 15_000 }).catch(() => {});
  check(
    beforeTap === 0 && chunkRequests.length === 1 && (await page.locator("[data-midi-player][data-state=playing]").count()) === 1,
    `Phase9 AC51/52 production loads the player chunk on the tap and plays (${beforeTap} → ${chunkRequests.length})`,
  );
  page.off("request", onRequest);
  const p9 = await page.request.get(`${BASE}/odevler/${HW_A}`);
  const p9csp = p9.headers()["content-security-policy"] ?? "";
  check(
    (p9.headers()["permissions-policy"] ?? "").includes("microphone=(self)") &&
      /media-src 'self' blob:/.test(p9csp) &&
      !/unsafe-eval/.test(p9csp),
    "Phase9 AC5 production: microphone=(self), media-src 'self' blob:, no unsafe-eval",
  );
  await page.context().addCookies([
    { name: "arkhe_e2e_recorder_limit", value: "3", url: BASE },
    { name: "arkhe_e2e_storage_fault", value: "put", url: BASE },
  ]);
  await page.goto(`${BASE}/odevler/${HW_A}`);
  const maxMs = await page.locator("[data-recorder]").getAttribute("data-max-ms");
  check(maxMs === "600000", `Phase9 AC16/59 production ignores the recorder hook (data-max-ms=${maxMs})`);
  const upload = await page.request.post(`${BASE}/api/dosya/kayit?odev=${HW_A}`, {
    headers: { Origin: BASE, "X-Upload-Id": crypto.randomUUID(), "X-Recording-Duration-Ms": "1000" },
    data: wavBytes({ seconds: 1 }),
    failOnStatusCode: false,
  });
  check(upload.status() === 201, `Phase9 AC47/59 production ignores the storage fault cookie (${upload.status()})`);
  await page.context().clearCookies({ name: "arkhe_e2e_recorder_limit" });
  await page.context().clearCookies({ name: "arkhe_e2e_storage_fault" });
  const asistanTry = await newPage(browser, { mobile: true });
  await loginWith(asistanTry, "asistan@arkhe.local", DEMO_PASSWORD);
  await asistanTry.getByText("E-posta ya da şifre hatalı.").waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    (await asistanTry.getByText("E-posta ya da şifre hatalı.").count()) === 1,
    "Phase9 AC59 asistan@arkhe.local is refused in production",
  );
  await asistanTry.context().close();

  // AC22: the flash cookie is Secure too (set by Düzelt, which redirects).
  const { rows: entryRows } = await db.execute(
    "select id from finance_entries where kind = 'expense' and voided_at is null and category <> 'dues' limit 1",
  );
  await page.goto(`${BASE}/finans/yeni?duzelt=${entryRows[0].id}`);
  await page.fill("input[name=amount]", "77");
  const [fixRes] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/finans/yeni",
    ),
    page.getByRole("button", { name: "Düzeltilmiş kaydı kaydet" }).click(),
  ]);
  const flash = (await setCookies(fixRes)).find((c) => c.startsWith("arkhe_flash="));
  check(
    flash?.startsWith("arkhe_flash=kayit-duzeltildi") && /;\s*Secure/i.test(flash),
    "AC22 the flash cookie is Secure and carries a key",
  );
  await page.waitForURL((u) => /^\/finans\/[0-9a-f-]{36}$/.test(u.pathname));

  // Service worker: wait for it, then reload so the page is controlled.
  await page.goto(`${BASE}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  check(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    "AC13 the service worker controls the page",
  );
  await pushWorkerChecks({ context: persistent, page, cdp, base: BASE, check });

  // AC15 walk + AC20 page list, then the cache audit.
  const { rows: memberRows } = await db.execute(
    "select id from users where email = 'korist@arkhe.local'",
  );
  const { rows: pieceRows } = await db.execute(
    "select piece_id from piece_links where url like '%drive.google.com%' limit 1",
  );
  const walk = [
    "/",
    "/finans",
    "/finans/aidat",
    "/odevler",
    "/uyeler",
    "/profil",
    `/uyeler/${memberRows[0].id}`,
    "/yoklama",
    `/calismalar/${rehearsalId}/canli`,
    pieceRows[0] ? `/repertuvar/${pieceRows[0].piece_id}` : "/repertuvar",
  ];
  for (const p of walk) {
    await page.goto(`${BASE}${p}`);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  const urls = await cacheUrls(page);
  const outside = urls.filter((u) => {
    const url = new URL(u);
    return (
      url.origin !== BASE_URL ||
      !ALLOWED_CACHE.test(url.pathname) ||
      url.pathname.startsWith("/api/") ||
      url.search.includes("_rsc")
    );
  });
  check(
    urls.length > 0 && outside.length === 0,
    `AC15 ${urls.length} cached URLs, all allow-listed (${outside.slice(0, 5)})`,
  );
  check(
    cspViolations.length === 0,
    `AC20 no CSP violations on the walk (${cspViolations.slice(0, 3)})`,
  );

  await phase7();

  // AC16–17: offline. Last, because the fallback path stops the server.
  console.log("# offline");
  // A second, incognito session that logged in, got the worker, then logged out.
  const leaver = await newPage(browser, { mobile: true });
  await loginWith(leaver, BOARD_EMAIL, DEMO_PASSWORD);
  await leaver.waitForURL(`${BASE}/`);
  await leaver.evaluate(() => navigator.serviceWorker.ready);
  await leaver.reload();
  await leaver.goto(`${BASE}/finans`);
  await leaver.goto(`${BASE}/profil`);
  await leaver.getByRole("button", { name: "Çıkış yap" }).first().click();
  await leaver.waitForURL(/\/giris/);
  const jar = await leaver.context().cookies();
  check(
    !jar.some((c) => c.name === "__Host-arkhe_session"),
    "AC22 logout removes __Host-arkhe_session from the browser",
  );

  await page.goto(`${BASE}/`);
  const contexts = [persistent, leaver.context()];
  for (const c of contexts) await c.setOffline(true);
  let offlinePath = "setOffline";
  let offline = await isOfflinePage(page, `${BASE}/repertuvar`);
  if (!offline) {
    offlinePath = "server stopped";
    for (const c of contexts) await c.setOffline(false);
    await stopServer(server);
    offline = await isOfflinePage(page, `${BASE}/repertuvar`);
  }
  console.log(`offline path: ${offlinePath}`);
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const layout = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      text: document.body.innerText,
    }));
    check(
      offline &&
        layout.fits &&
        layout.text.includes("Bağlantı yok") &&
        layout.text.includes("Tekrar dene"),
      `AC16 offline /repertuvar shows Bağlantı yok + Tekrar dene, no horizontal scroll (${scheme}, ${offlinePath})`,
    );
  }

  // AC17: logged out and offline, a navigation never shows a visited portal page.
  const leaverOffline = await isOfflinePage(leaver, `${BASE}/finans`);
  const leaverText = await leaver.evaluate(() => document.body.innerText).catch(() => "");
  check(
    leaverOffline && !leaverText.includes("Demo Yönetim"),
    `AC17 logged out + offline → the offline page, never a portal page (${offlinePath})`,
  );
} catch (error) {
  console.error(error);
  check(false, `e2e:prod aborted: ${error.message?.split("\n")[0]}`);
} finally {
  await persistent?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await stopServer(server);
  db.close();
  removeDb();
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  if (existsSync(PROD_DB)) console.error(`could not delete ${PROD_DB}`);
}
process.exit(summary() ? 0 : 1);
