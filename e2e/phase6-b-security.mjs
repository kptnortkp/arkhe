// Phase 6: nonce CSP, violations, flash keys, proxy headers, health and a restorable backup.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { BASE, check, cspViolations, db, insertRehearsal, login, newPage } from "./lib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

async function phone(browser, email) {
  const page = await newPage(browser, { phone: true });
  if (email) {
    await login(page, email);
    await page.waitForURL(`${BASE}/`);
  }
  return page;
}

/** The nonce from the CSP header and whether every <script> in the raw HTML carries it. */
async function nonceCheck(page, path) {
  const res = await page.request.get(`${BASE}${path}`, { maxRedirects: 0 });
  const csp = res.headers()["content-security-policy"] ?? "";
  const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
  const nonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1] ?? null;
  const scripts = (await res.text()).match(/<script\b[^>]*>/g) ?? [];
  return {
    status: res.status(),
    nonce,
    strict: scriptSrc.includes("'strict-dynamic'") && !scriptSrc.includes("unsafe-inline"),
    scripts: scripts.length,
    allNonced: scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce}"`)),
  };
}

export default async function phase6Security(browser) {
  const sef = await phone(browser, "sef@arkhe.local");
  const live = await insertRehearsal({ title: "E2E P6 Canlı", startOffsetMin: -5 });
  await sef.goto(`${BASE}/calismalar/${live}`);
  await sef.getByRole("button", { name: "Yoklamayı başlat" }).click();
  await sef.waitForURL(`${BASE}/calismalar/${live}/canli`);
  await sef.getByTestId("live-code").waitFor();

  // AC19 nonce CSP
  const anon = await phone(browser, null);
  for (const [page, path] of [
    [anon, "/giris"],
    [sef, "/"],
    [sef, `/calismalar/${live}/canli`],
  ]) {
    const a = await nonceCheck(page, path);
    const b = await nonceCheck(page, path);
    check(
      a.status === 200 && a.nonce && a.strict && a.allNonced,
      `AC19 ${path.replace(live, "<id>")}: script-src has a nonce and strict-dynamic, no unsafe-inline, all ${a.scripts} <script> carry it`,
    );
    check(
      a.nonce !== b.nonce,
      `AC19 ${path.replace(live, "<id>")}: two requests get different nonces`,
    );
  }

  // AC20 no CSP violations on each role's main pages
  const before = cspViolations.length;
  const korist = await phone(browser, "korist@arkhe.local");
  const code = (await sef.getByTestId("live-code").textContent()).trim();
  await korist.goto(`${BASE}/yoklama`);
  await korist.waitForLoadState("networkidle");
  await korist.goto(`${BASE}/yoklama/kod/${live}?c=${code}`);
  await korist.waitForLoadState("networkidle");
  const piece = (
    await db.execute(
      "select piece_id from piece_links where url like 'https://drive.google.com/%' limit 1",
    )
  ).rows[0].piece_id;
  await korist.goto(`${BASE}/repertuvar/${piece}?partisyon=tumu`);
  await korist
    .getByRole("button", { name: /Önizle/ })
    .first()
    .click();
  await korist.locator("iframe").waitFor();
  for (const path of ["/", "/odevler", "/profil"]) {
    await korist.goto(`${BASE}${path}`);
    await korist.waitForLoadState("networkidle");
  }
  await sef.goto(`${BASE}/calismalar/${live}/canli`);
  await sef.locator("svg").first().waitFor();
  const yk = await phone(browser, "yk@arkhe.local");
  for (const path of ["/", "/finans", "/finans/aidat", "/profil"]) {
    await yk.goto(`${BASE}${path}`);
    await yk.waitForLoadState("networkidle");
  }
  await korist.waitForTimeout(500);
  check(
    cspViolations.length === before,
    `AC20 no CSP violations on home, check-in, live screen, Drive preview, odevler, finans, profil (${cspViolations.length - before})`,
  );

  // AC23 the flash cookie only carries known keys
  let tampered = true;
  for (const value of ["<b>Hacked</b>", "constructor"]) {
    await yk
      .context()
      .addCookies([{ name: "arkhe_flash", value: encodeURIComponent(value), url: BASE }]);
    await yk.goto(`${BASE}/finans`);
    await yk.locator("main h1").first().waitFor();
    await yk.waitForTimeout(800);
    const html = await yk.content();
    if (
      (await yk.locator("[data-sonner-toast]").count()) > 0 ||
      html.includes("Hacked") ||
      (await yk.getByText("Bir şeyler ters gitti").count()) > 0
    ) {
      tampered = false;
    }
  }
  check(tampered, "AC23 a tampered arkhe_flash shows no toast and no error page");

  // AC26 spoofed proxy headers don't buy a fresh login bucket (TRUST_PROXY_HEADERS unset)
  const email = "xff@e2e.test";
  const guess = await phone(browser, null);
  let lastAlert = "";
  for (let i = 0; i < 6; i++) {
    await guess.setExtraHTTPHeaders({
      "X-Forwarded-For": `203.0.113.${i + 1}`,
      "X-Real-IP": `198.51.100.${i + 1}`,
    });
    await guess.goto(`${BASE}/giris`);
    await guess.fill("input[name=email]", email);
    await guess.fill("input[name=password]", `wrong-${i}`);
    await guess.click("main button[type=submit]");
    await guess.locator("main [role=alert]").waitFor();
    await guess.waitForLoadState("networkidle");
    lastAlert = (await guess.locator("main [role=alert]").textContent()) ?? "";
  }
  const keys = (
    await db.execute({
      sql: "select key, count(*) n from login_attempts where key like ? group by key",
      args: [`%${email}%`],
    })
  ).rows.map((r) => `${r.key}=${r.n}`);
  // Without a trusted IP only the per-email bucket (30) exists: spoofed values create no
  // email+IP or IP buckets, and six guesses don't lock the account.
  check(
    lastAlert.includes("E-posta ya da şifre hatalı.") &&
      keys.length === 1 &&
      keys[0] === `email:${email}=6`,
    `AC26 spoofed X-Forwarded-For values only count in the per-email bucket (${keys.join(", ")})`,
  );
  await db.execute({ sql: "delete from login_attempts where key like ?", args: [`%${email}%`] });

  // AC29 health
  const health = await anon.request.get(`${BASE}/api/saglik`, { maxRedirects: 0 });
  check(
    health.status() === 200 &&
      (await health.text()) === '{"ok":true}' &&
      (health.headers()["cache-control"] ?? "").includes("no-store"),
    'AC29 GET /api/saglik → 200 {"ok":true}, no-store, nothing else',
  );

  // AC39 db:backup restores into a fresh DB with every index and migration row
  const backup = spawnSync("npm", ["run", "db:backup"], { cwd: ROOT, encoding: "utf8" });
  const file = backup.stdout.match(/Backup written: (\S+)/)?.[1];
  check(
    backup.status === 0 && file?.startsWith("data/backups/") && !file.includes("public"),
    `AC39 db:backup writes under data/backups/ (${file})`,
  );
  if (!file) {
    console.log(backup.stdout, backup.stderr);
    for (const page of [sef, anon, korist, yk, guess]) await page.context().close();
    return;
  }
  const scratch = join(tmpdir(), `arkhe-restore-${Date.now()}.db`);
  try {
    const restored = createClient({ url: `file:${scratch}` });
    await restored.executeMultiple(readFileSync(join(ROOT, file), "utf8"));
    const indexes = "select count(*) n from sqlite_master where type = 'index'";
    const source = Number((await db.execute(indexes)).rows[0].n);
    const copy = Number((await restored.execute(indexes)).rows[0].n);
    const journal = JSON.parse(readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8"));
    const migrations = Number(
      (await restored.execute("select count(*) n from __drizzle_migrations")).rows[0].n,
    );
    restored.close();
    check(
      copy === source && source >= 32 && migrations === journal.entries.length,
      `AC39 the restored DB has ${copy}/${source} indexes and ${migrations}/${journal.entries.length} migrations`,
    );
    const dbCheck = spawnSync("npm", ["run", "db:check"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `file:${scratch}` },
    });
    check(
      dbCheck.status === 0 &&
        dbCheck.stdout.includes(`migrations=${journal.entries.length}/${journal.entries.length}`),
      "AC39 db:check passes on the restored copy",
    );
  } finally {
    rmSync(scratch, { force: true });
    rmSync(`${scratch}-wal`, { force: true });
    rmSync(`${scratch}-shm`, { force: true });
    if (file) rmSync(join(ROOT, file), { force: true });
  }

  for (const page of [sef, anon, korist, yk, guess]) await page.context().close();
}
