// A page left open across a deploy calls an action the new build doesn't know: it reloads instead
// of claiming the connection is down.
import { BASE, check, consoleErrors, db, insertRehearsal, loginAs, markOf } from "./lib.mjs";
import { as, deleteTickets, goto, insertTicket, people, ticketRow } from "./board.mjs";

const OFFLINE = "Bağlantı yok";

/** The next server action call gets the "unrecognized action" answer a newer deploy gives. */
async function staleOnce(page) {
  let done = false;
  await page.route("**/*", (route) => {
    const req = route.request();
    if (!done && req.method() === "POST" && req.headers()["next-action"]) {
      done = true;
      return route.fulfill({
        status: 404,
        headers: { "x-nextjs-action-not-found": "1", "content-type": "text/plain" },
        body: "Server action not found.",
      });
    }
    return route.continue();
  });
  await page.evaluate(() => {
    window.__beforeReload = true;
  });
  return () => done;
}

const reloaded = (page) =>
  page
    .waitForFunction(() => !window.__beforeReload, null, { timeout: 15_000 })
    .then(
      () => true,
      () => false,
    );

// What the faked answer itself logs: the 404 and the error React reports for the form.
const PROVOKED = ["status of 404", "UnrecognizedActionError", "failed-to-find-server-action"];

export default async function phase2cStale(browser) {
  await deleteTickets("title like 'E2E Stale%'");
  const errorsBefore = consoleErrors.length;

  // Kod gir: the code entry reloads, then the same code works.
  const sef = await loginAs(browser, "sef@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  const id = await insertRehearsal({ title: "E2E Stale çalışma", startOffsetMin: -5 });
  await sef.goto(`${BASE}/calismalar/${id}`);
  await sef.getByRole("button", { name: "Yoklamayı başlat" }).click();
  await sef.waitForURL(`${BASE}/calismalar/${id}/canli`);
  const code = (await sef.getByTestId("live-code").textContent()).trim();
  await korist.goto(`${BASE}/yoklama/kod/${id}`);
  await korist.locator("#checkin-code").waitFor();
  const hit = await staleOnce(korist);
  await korist.fill("#checkin-code", code);
  check(
    (await reloaded(korist)) && hit() && !(await korist.getByText(OFFLINE).count()),
    "stale: a stale Kod gir reloads the page instead of saying Bağlantı yok",
  );
  await korist.locator("#checkin-code").waitFor();
  await korist.fill("#checkin-code", code);
  await korist.getByTestId("qr-state").waitFor();
  check(
    Boolean(await markOf(id, "korist@arkhe.local")),
    "stale: after the reload the code checks in",
  );
  await db.execute({ sql: "delete from rehearsals where id = ?", args: [id] });
  await sef.context().close();
  await korist.context().close();

  // useRunAction: Takvime ekle reloads, then works.
  const { yk } = await people();
  const ticket = await insertTicket({ title: "E2E Stale iş", by: yk, due: "2030-01-15" });
  const board = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(board, `/yonetim/${ticket.number}`);
  // The page marks the ticket seen through an action on mount; let that finish first.
  await board.waitForLoadState("networkidle");
  const runHit = await staleOnce(board);
  await board.getByRole("button", { name: "Takvime ekle" }).click();
  check(
    (await reloaded(board)) && runHit() && (await ticketRow(ticket.number)).on_calendar === 0,
    "stale: a stale button action reloads and changes nothing",
  );
  await board.getByRole("button", { name: "Takvime ekle" }).click();
  await board.getByRole("button", { name: "Takvimden çıkar" }).waitFor();
  check(
    (await ticketRow(ticket.number)).on_calendar === 1,
    "stale: after the reload the button works",
  );
  await board.context().close();

  // A form action that would reach the error page reloads instead.
  const form = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(form, "/yonetim/yeni");
  await form.fill("#title", "E2E Stale form");
  const formHit = await staleOnce(form);
  await form.getByRole("button", { name: "Kaydet" }).click();
  check(
    (await reloaded(form)) &&
      formHit() &&
      !(await form.getByText("Bir şeyler ters gitti").count()) &&
      (await form.locator("#title").count()) === 1,
    "stale: a stale form reloads to the form, not the error page",
  );
  await form.context().close();
  await deleteTickets("title like 'E2E Stale%'");
  const mine = consoleErrors.splice(errorsBefore);
  consoleErrors.push(...mine.filter((e) => !PROVOKED.some((p) => e.includes(p))));
}
