// A write that fails with SQLITE_BUSY must not leave the server's pooled connection holding the
// write lock (libsql never resets the failed statement; the pool now discards that connection).
import { createClient } from "@libsql/client";
import { BOARD_ACTIONS } from "./board.mjs";
import { actionIds, BASE, callAction, check, db, login, loginAs, userId } from "./lib.mjs";

const DB_URL =
  process.env.DATABASE_URL ?? `file:${new URL("../data/arkhe.db", import.meta.url).pathname}`;

/** A separate client takes and drops the write lock: true if nobody keeps holding it. */
async function lockFree() {
  const probe = createClient({ url: DB_URL, timeout: 3000 });
  try {
    await probe.executeMultiple("BEGIN IMMEDIATE; ROLLBACK;");
    return true;
  } catch {
    return false;
  } finally {
    probe.close();
  }
}

/** Holds the write lock from the e2e process while `fn` runs, so the server's writes hit SQLITE_BUSY. */
async function whileLocked(fn) {
  const tx = await db.transaction("write");
  try {
    await tx.execute(
      "insert into login_attempts (key, attempted_at) values ('e2e-lock', unixepoch())",
    );
    await fn();
  } finally {
    await tx.rollback();
  }
}

/** A page outside the console watch: the refused writes answer 500 on purpose. */
async function unwatched(browser, email) {
  const page = await (await browser.newContext()).newPage();
  if (email) {
    await login(page, email);
    await page.waitForURL(`${BASE}/`);
  }
  return page;
}

export default async function run(browser) {
  const yk = await unwatched(browser, "yk@arkhe.local");
  const ids = await actionIds(BOARD_ACTIONS);
  await db.execute({
    sql: "delete from board_ticket_reads where user_id = ?",
    args: [await userId("yk@arkhe.local")],
  });

  const refused = await unwatched(browser);
  await whileLocked(async () => {
    // An autocommit insert (the login rate limit) and a BEGIN IMMEDIATE (writeTx) both fail.
    await login(refused, "sef@arkhe.local");
    await refused.waitForTimeout(500);
    await callAction(yk, ids.markTicketSeen, [1, 1, 1]);
  });
  await refused.context().close();

  check(await lockFree(), "DB lock: after refused writes the server holds no write lock");

  const sessions = async () =>
    Number(
      (
        await db.execute({
          sql: "select count(*) as n from sessions where user_id = ?",
          args: [await userId("sef@arkhe.local")],
        })
      ).rows[0].n,
    );
  const before = await sessions();
  const sef = await loginAs(browser, "sef@arkhe.local");
  const landed = [];
  for (const p of ["/", "/yonetim", "/finans", "/repertuvar", "/uyeler", "/yonetim/1"]) {
    await sef.goto(`${BASE}${p}`);
    landed.push(new URL(sef.url()).pathname);
  }
  check(
    landed.every((p) => p !== "/giris"),
    `DB lock: a new session is committed and every pooled connection sees it (${landed})`,
  );
  const seen = await callAction(yk, ids.markTicketSeen, [1, 1, 1]);
  const reads = await db.execute({
    sql: "select count(*) as n from board_ticket_reads where user_id = ?",
    args: [await userId("yk@arkhe.local")],
  });
  check(
    !seen.includes("SQLITE_BUSY") && Number(reads.rows[0].n) === 1,
    "DB lock: a writeTx after the lock is released commits",
  );
  check(
    (await sessions()) === before + 1 && (await lockFree()),
    "DB lock: the login's writes are visible to another process and the lock stays free",
  );
  await sef.context().close();
  await yk.context().close();
}
