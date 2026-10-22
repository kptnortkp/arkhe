// Phase 8 helpers: board and budget arrangement, action calls and page probes. Not a phase file.
import { readFile } from "node:fs/promises";
import { BASE, db, login, newPage, userId } from "./lib.mjs";

export const BOARD_ACTIONS = "src/app/(portal)/yonetim/actions.ts";
export const BUDGET_ACTIONS = "src/app/(portal)/finans/butce/actions.ts";
const D = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);

export const text = async (locator) =>
  ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();

export async function as(browser, email, { phone = false, scheme = "light", width } = {}) {
  const context = { colorScheme: scheme };
  if (width) context.viewport = { width, height: 900 };
  const page = await newPage(browser, { phone, context });
  await login(page, email);
  await page.waitForURL(`${BASE}/`);
  return page;
}

export async function goto(page, path) {
  const res = await page.goto(`${BASE}${path}`);
  await page
    .locator("main h1")
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  return res;
}

export async function toast(page, message, timeout = 10_000) {
  try {
    await page.getByText(message, { exact: true }).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** Server action ids of `file`, each with a path that serves it ([numara]/[id] → sample). */
export async function actionIds(file, sample = "1") {
  const manifest = JSON.parse(
    await readFile(new URL("../.next/dev/server/server-reference-manifest.json", import.meta.url)),
  );
  const ids = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.filename !== file) continue;
    const worker = Object.keys(entry.workers)[0];
    const path = worker
      .replace(/^app/, "")
      .replace(/\/\([^)]+\)/g, "")
      .replace(/\/page$/, "")
      .replace(/\[(numara|id)\]/, sample);
    ids[entry.exportedName] = { id, path: path || "/" };
  }
  return ids;
}

/** A plain-argument action, as a crafted request would call it. */
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

/** A form action (bound args first, then prev state and the FormData), multipart like React. */
export async function callForm(page, action, bound, fields) {
  return page.evaluate(
    async ({ id, path, bound, fields }) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
      fd.append("0", JSON.stringify([...bound, {}, "$K1"]));
      const res = await fetch(path, {
        method: "POST",
        headers: { "Next-Action": id, Accept: "text/x-component" },
        body: fd,
      });
      return res.text();
    },
    { ...action, bound, fields },
  );
}

export async function scalar(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}

export async function ticketRow(number) {
  return (await db.execute({ sql: "select * from board_tickets where number = ?", args: [number] }))
    .rows[0];
}

export async function eventsOf(number, kind) {
  const r = await db.execute({
    sql: `select e.* from board_ticket_events e join board_tickets t on t.id = e.ticket_id
          where t.number = ? ${kind ? "and e.kind = ?" : ""} order by e.id`,
    args: kind ? [number, kind] : [number],
  });
  return r.rows;
}

export async function boardSnapshot() {
  const r = await db.execute(
    `select (select count(*) from board_tickets) || ':' || (select count(*) from board_ticket_events)
       || ':' || (select coalesce(sum(revision), 0) from board_tickets)
       || ':' || (select group_concat(status) from (select status from board_tickets order by number)) as s`,
  );
  return r.rows[0].s;
}

let nextNumber = 900;
/** Inserts a ticket directly (numbers from 900 up, so they never meet the seeded ones). */
export async function insertTicket({
  title,
  status = "todo",
  urgency = "medium",
  assignee = null,
  due = null,
  doneAgoS = null,
  updatedAgoS = 3600,
  by,
  number,
}) {
  const id = crypto.randomUUID();
  const n = number ?? nextNumber++;
  const t = nowS();
  await db.execute({
    sql: `insert into board_tickets (id, number, title, status, urgency, assignee_id, due_on, done_at,
            created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      n,
      title,
      status,
      urgency,
      assignee,
      due,
      status === "done" ? t - (doneAgoS ?? 3600) : null,
      by,
      t - updatedAgoS - 60,
      t - updatedAgoS,
    ],
  });
  await db.execute({
    sql: "insert into board_ticket_events (ticket_id, kind, actor_id, created_at) values (?, 'created', ?, ?)",
    args: [id, by, t - updatedAgoS - 60],
  });
  return { id, number: n };
}

export async function deleteTickets(where = "title like 'E2E%'") {
  await db.execute(`delete from board_tickets where ${where}`);
}

export const people = async () => ({
  sef: await userId("sef@arkhe.local"),
  yk: await userId("yk@arkhe.local"),
  korist: await userId("korist@arkhe.local"),
});

/** Visible ticket numbers in DOM order, optionally inside one column. */
export async function visibleCards(page, status) {
  const scope = status ? `section[data-status=${status}] ` : "";
  return page
    .locator(`${scope}[data-testid=ticket-card]`)
    .evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => Number(e.dataset.number)),
    );
}

export async function tabCounts(page) {
  return page
    .locator("nav[aria-label=Sütunlar] a")
    .evaluateAll((els) =>
      Object.fromEntries(els.map((e) => [e.dataset.status, Number(e.dataset.count)])),
    );
}

export async function noOverflow(page) {
  return page.evaluate(
    () => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth,
  );
}

/** Visible interactive elements in main under 44 px tall (inputs and textareas excluded by kind). */
export async function smallTargets(page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "main a, main button, main select, main input:not([type=hidden]), [role=menuitem]",
      ),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        // The stretched card link covers the whole card; its box is the card.
        if (e.closest("[data-testid=ticket-card]") && e.tagName === "A") return false;
        // A radio inside a chip label: the label is the target.
        if (e.type === "radio" || e.closest(".sr-only")) return false;
        return r.height < 43.5;
      })
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("aria-label") || e.name || "").trim().slice(0, 30)}(${Math.round(e.getBoundingClientRect().height)})`,
      ),
  );
}

// ---------- Budget ----------

export async function insertBudget({
  name,
  start,
  approvedBy = null,
  lines = {},
  by,
  revision = 0,
}) {
  const id = crypto.randomUUID();
  const [y, m] = start.split("-").map(Number);
  const e = y * 12 + (m - 1) + 12;
  const end = `${Math.floor(e / 12)}-${String((e % 12) + 1).padStart(2, "0")}`;
  const t = nowS();
  await db.execute({
    sql: `insert into budgets (id, name, start_month, end_month, approved_at, approved_by, revision, created_by, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, name, start, end, approvedBy ? t - D : null, approvedBy, revision, by, t - 2 * D],
  });
  for (const [category, kurus] of Object.entries(lines)) {
    await db.execute({
      sql: "insert into budget_lines (budget_id, category, amount_kurus) values (?, ?, ?)",
      args: [id, category, kurus],
    });
  }
  return id;
}

export async function insertEntry({
  kind,
  category = null,
  kurus,
  day,
  account = "bank",
  voided = false,
  by,
}) {
  const id = crypto.randomUUID();
  const t = nowS();
  await db.execute({
    sql: `insert into finance_entries (id, kind, category, amount_kurus, occurred_on, account, to_account,
            description, created_by, created_at, voided_at, voided_by, void_reason)
          values (?, ?, ?, ?, ?, ?, ?, 'E2E bütçe', ?, ?, ?, ?, ?)`,
    args: [
      id,
      kind,
      category,
      kurus,
      day,
      account,
      kind === "transfer" ? (account === "bank" ? "cash" : "bank") : null,
      by,
      t,
      voided ? t : null,
      voided ? by : null,
      voided ? "E2E iptal edildi" : null,
    ],
  });
  return id;
}

export async function deleteBudgetEntries() {
  await db.execute("delete from finance_entries where description = 'E2E bütçe'");
}

/** The Istanbul plain day `n` days from `day`. */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * D * 1000).toISOString().slice(0, 10);
}

/** D24, the same formula the report uses: round((today − start + 1) / total × 100). */
export function elapsed(start, today) {
  const [y, m] = start.split("-").map(Number);
  const from = Date.UTC(y, m - 1, 1);
  const to = Date.UTC(y + 1, m - 1, 1);
  const passed = (Date.parse(`${today}T00:00:00Z`) - from) / (D * 1000) + 1;
  return Math.min(100, Math.max(0, Math.round((passed / ((to - from) / (D * 1000))) * 100)));
}

// The fixed past fixture of ui.md §9.3, with literal kuruş.
export const PAST_PLAN = {
  donation: 100000,
  grant: 100000,
  venue: 50000,
  scores_royalties: 100000,
  travel: 100000,
  festival_fee: 100000,
  organisation: 100000,
};

/** `E2E 2019–20` (start 2019-09, approved): entries inside, on and just outside the range. */
export async function arrangePast(by) {
  const id = await insertBudget({
    name: "E2E 2019–20",
    start: "2019-09",
    approvedBy: by,
    lines: PAST_PLAN,
    by,
    revision: 1,
  });
  const e = (kind, category, kurus, day, extra = {}) =>
    insertEntry({ kind, category, kurus, day, by, ...extra });
  await e("income", "donation", 100000, "2019-09-01");
  await e("income", "donation", 20000, "2020-08-31");
  await e("income", "grant", 40000, "2020-02-29");
  await e("income", "other_income", 30000, "2019-12-15");
  await e("expense", "travel", 130000, "2019-11-10");
  await e("expense", "festival_fee", 95000, "2020-05-05");
  await e("expense", "scores_royalties", 80000, "2019-10-01");
  await e("expense", "organisation", 100000, "2020-01-20");
  await e("expense", "other_expense", 5000, "2020-03-03");
  // Excluded: the day before, the day after, a voided entry, a transfer, a (voided) opening.
  await e("income", "donation", 999900, "2019-08-31");
  await e("income", "donation", 999900, "2020-09-01");
  await e("expense", "travel", 500000, "2020-04-04", { voided: true });
  await e("transfer", null, 700000, "2020-04-05");
  await e("opening", null, 800000, "2020-04-06", { voided: true });
  return id;
}
