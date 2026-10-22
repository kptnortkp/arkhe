import { chromium } from "playwright-core";
import { seedBoard, seedBudgets } from "../scripts/board-fixture.mjs";
import { seedFinance } from "../scripts/finance-fixture.mjs";
import { seedHomework } from "../scripts/homework-fixture.mjs";
import { clearE2eMedia, reconcileLocalUploads } from "../scripts/media-fixture.mjs";
import { createLibsqlClient } from "../src/db/local-client.mjs";

export const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
export const DEMO_PASSWORD = "arkhe-demo-2026";
const DB_URL =
  process.env.DATABASE_URL ?? `file:${new URL("../data/arkhe.db", import.meta.url).pathname}`;
// The suite logs in with demo accounts and wipes fixtures: never against a remote DB or a deployed site.
if (!DB_URL.startsWith("file:")) throw new Error(`e2e refuses a non-file database: ${DB_URL}`);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  throw new Error(`e2e refuses a non-loopback base URL: ${BASE}`);
}
// The dev server writes the same file; every pooled connection waits for its lock (ms).
export const db = createLibsqlClient({ url: DB_URL, timeout: 5000 });

const results = [];
export const consoleErrors = [];
// Every Content-Security-Policy violation in any page fails the run.
export const cspViolations = [];

export async function watchCsp(context) {
  await context.exposeBinding("__arkheCspViolation", ({ page }, v) => {
    cspViolations.push(`${page.url()}: ${v}`);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__arkheCspViolation(`${e.effectiveDirective} blocked ${e.blockedURI || "inline"}`);
    });
  });
}

export function check(ok, message) {
  results.push({ ok: Boolean(ok), message });
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
}

export async function launch() {
  return chromium.launch({ channel: "chrome" });
}

/** A real (non-incognito) Chrome profile in `dir`: needed for installability checks. */
export async function launchPersistent(dir, options = {}) {
  const context = await chromium.launchPersistentContext(dir, { channel: "chrome", ...options });
  await watchCsp(context);
  return context;
}

/** `phone` is the Phase 6 375×812 context; `context` adds options such as colorScheme or userAgent. */
export async function newPage(
  browser,
  { mobile = false, phone = false, context: extra = {} } = {},
) {
  const device =
    mobile || phone
      ? {
          viewport: phone ? { width: 375, height: 812 } : { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1280, height: 900 } };
  const context = await browser.newContext({ ...device, ...extra });
  await watchCsp(context);
  return watchConsole(settleOnGoto(await context.newPage()));
}

/**
 * `goto` also waits until the page is settled: no streaming fallback (aria-busy) left in main and
 * React has hydrated it. A caller that passes `waitUntil` (a timing) gets plain Playwright.
 */
export function settleOnGoto(page) {
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => {
    const res = await goto(url, options);
    if (options?.waitUntil) return res;
    await page
      .waitForFunction(
        () => {
          if (document.querySelector("main div[aria-busy=true]")) return false;
          const el = document.querySelector("main form, main button, main a");
          return !el || Object.keys(el).some((k) => k.startsWith("__react"));
        },
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});
    return res;
  };
  return page;
}

/** Collects console errors and CSP refusals of one page. */
export function watchConsole(page) {
  page.on("console", (m) => {
    // Playwright itself injects caret-color styles that trip React's hydration check.
    const text = m.text();
    if (text.includes("Refused to") && text.includes("Content Security Policy")) {
      cspViolations.push(`${page.url()}: ${text.slice(0, 300)}`);
    }
    // Expected noise: Playwright's caret-color styles, the 403s the permission tests provoke,
    // and requests made while the offline tests have the network or the server switched off.
    const expected = [
      "caret-color",
      "status of 403",
      "ERR_INTERNET_DISCONNECTED",
      "ERR_CONNECTION_REFUSED",
    ].some((t) => text.includes(t));
    if (m.type() === "error" && !expected) {
      consoleErrors.push(text.slice(0, 300));
    }
  });
  return page;
}

export async function login(page, email, password = DEMO_PASSWORD) {
  await page.goto(`${BASE}/giris`);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("main button[type=submit]");
}

export async function loginAs(browser, email, options) {
  const page = await newPage(browser, options);
  await login(page, email);
  await page.waitForURL(`${BASE}/`);
  return page;
}

/** Removes everything e2e runs create; e2e data always uses @e2e.test emails or an "E2E" prefix. */
export async function cleanup() {
  // Imported rehearsals and terms go with their batches; the items would block seedFinance (restrict).
  await db.execute(
    "delete from rehearsals where id in (select rehearsal_id from import_items where rehearsal_id is not null)",
  );
  await db.execute(
    "delete from terms where id in (select term_id from import_items where term_id is not null)",
  );
  await db.execute("delete from import_batches");
  // First: finance rows reference users with restrict, and the ledger is re-anchored to now.
  await seedFinance(db, new Date());
  // Board and budget rows reference users with restrict: reseed before the e2e users go.
  await seedBoard(db, new Date());
  await seedBudgets(db, new Date());
  await db.execute("delete from login_attempts");
  // The dev DB never holds real backup state: every phase-7 test starts unconfigured.
  await db.execute("delete from backup_runs");
  await db.execute("delete from app_settings where key = 'backup_recipients'");
  await db.execute("delete from rehearsals where title like 'E2E%'");
  await db.execute("delete from terms where name like 'E2E%'");
  // Seeded rehearsals from today on start unopened and unmarked: one left live by an earlier run (or
  // by hand) would win the member's home hero over a test's own live rehearsal.
  const todayStart = Math.floor(Date.parse(`${istanbulDate()}T00:00:00+03:00`) / 1000);
  const seededAhead = `select id from rehearsals where starts_at >= ${todayStart}`;
  await db.execute(`delete from attendance where rehearsal_id in (${seededAhead})`);
  await db.execute(
    `update rehearsals set opened_at = null, closed_at = null where id in (${seededAhead})`,
  );
  const e2eHomework =
    "select id from assignments where piece_id in (select id from pieces where title like 'E2E%') or description like 'E2E%'";
  await db.execute(`delete from submissions where assignment_id in (${e2eHomework})`);
  await db.execute(`delete from assignment_parts where assignment_id in (${e2eHomework})`);
  await db.execute(`delete from assignments where id in (${e2eHomework})`);
  await db.execute(
    "delete from piece_links where piece_id in (select id from pieces where title like 'E2E%')",
  );
  await db.execute("delete from pieces where title like 'E2E%'");
  // Notes, takes, appointments and MIDI rows that point at @e2e.test users go before the users.
  await clearE2eMedia(db);
  await db.execute(
    "delete from attendance where user_id in (select id from users where email like '%@e2e.test')",
  );
  await db.execute(
    "delete from submissions where user_id in (select id from users where email like '%@e2e.test')",
  );
  await db.execute("delete from users where email like '%@e2e.test'");
  // Import fixtures and former members use the fictional sample domains.
  const sampleUsers =
    "select id from users where email like '%@ornek.com' or email like '%@eski.invalid'";
  await db.execute(`delete from attendance where user_id in (${sampleUsers})`);
  await db.execute(`delete from submissions where user_id in (${sampleUsers})`);
  await db.execute(`delete from users where id in (${sampleUsers})`);
  // Re-anchors the demo homework (and recording email, yeni@) to now; ends with the media seed.
  await seedHomework(db, new Date());
  // Storage bookkeeping last; the files are reconciled against the live rows (data/uploads*).
  await db.batch(
    ["delete from storage_deletions", "delete from storage_events", "delete from storage_sweeps"],
    "write",
  );
  await reconcileLocalUploads(db);
}

export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (consoleErrors.length) console.log("Browser console errors:", consoleErrors);
  if (cspViolations.length) console.log("CSP violations:", cspViolations);
  return failed.length === 0 && consoleErrors.length === 0 && cspViolations.length === 0;
}

/** Istanbul calendar date `days` from today, "YYYY-MM-DD". */
export function istanbulDate(days = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** Inserts a rehearsal directly, for time-relative scenarios the UI can't create. */
export async function insertRehearsal({
  title,
  startOffsetMin,
  durationMin = 150,
  type = "tutti",
  parts = [],
}) {
  const id = crypto.randomUUID();
  const starts = Math.floor(Date.now() / 1000) + startOffsetMin * 60;
  await db.execute({
    sql: "insert into rehearsals (id, type, title, location, starts_at, ends_at) values (?, ?, ?, 'E2E Salon', ?, ?)",
    args: [id, type, title, starts, starts + durationMin * 60],
  });
  for (const part of parts) {
    await db.execute({ sql: "insert into rehearsal_parts values (?, ?)", args: [id, part] });
  }
  return id;
}

export async function userId(email) {
  const r = await db.execute({ sql: "select id from users where email = ?", args: [email] });
  return r.rows[0].id;
}

export async function markOf(rehearsalId, email) {
  const r = await db.execute({
    sql: "select a.status, a.method, a.note, a.recorded_at, a.corrected_at from attendance a join users u on u.id = a.user_id where a.rehearsal_id = ? and u.email = ?",
    args: [rehearsalId, email],
  });
  return r.rows[0] ?? null;
}

/** Server action ids exported by `file`, each mapped to a page that serves it ([id] → sampleId). */
export async function actionIds(file, sampleId) {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("../.next/dev/server/server-reference-manifest.json", import.meta.url)),
  );
  const ids = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.filename !== file) continue;
    const worker =
      Object.keys(entry.workers).find((w) => w.includes("(portal)")) ??
      Object.keys(entry.workers)[0];
    const path = worker
      .replace(/^app/, "")
      .replace("/(portal)", "")
      .replace(/\/page$/, "")
      .replace("[id]", sampleId);
    ids[entry.exportedName] = { id, path: path || "/" };
  }
  return ids;
}

/** Calls a server action as the page's logged-in user, the way a crafted request would. */
export async function callAction(page, action, args) {
  return page.evaluate(
    async ({ id, path, args }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Next-Action": id,
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        body: JSON.stringify(args),
      });
      return res.text();
    },
    { ...action, args },
  );
}
