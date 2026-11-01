// The Yönetim Kurulu calendar: Takvime ekle on create, on the ticket page and from the calendar.
import { BASE, check, db, istanbulDate } from "./lib.mjs";
import {
  actionIds,
  as,
  BOARD_ACTIONS,
  callAction,
  deleteTickets,
  eventsOf,
  goto,
  insertTicket,
  noOverflow,
  people,
  ticketRow,
  toast,
} from "./board.mjs";

const NEEDS_DATE = "Takvime eklemek için son tarih seç.";
const latest = async (title) =>
  (
    await db.execute({
      sql: "select * from board_tickets where title = ? order by number desc limit 1",
      args: [title],
    })
  ).rows[0];

async function dayCard(page, day, number) {
  await goto(page, `/yonetim/takvim?ay=${day.slice(0, 7)}&gun=${day}`);
  return page
    .locator(`[data-testid=calendar-day] [data-testid=ticket-card][data-number="${number}"]`)
    .count();
}

export default async function phase8cCalendar(browser) {
  await deleteTickets("title like 'E2E Takvim%'");
  const { yk } = await people();
  const day = istanbulDate(3);
  const page = await as(browser, "yk@arkhe.local", { phone: true });

  // From the calendar: Bu güne iş ekle pre-fills the day and the switch.
  await goto(page, `/yonetim/takvim?ay=${day.slice(0, 7)}&gun=${day}`);
  check(
    (await page
      .locator(`[data-testid=calendar-grid] a[data-day="${day}"]`)
      .getAttribute("aria-current")) === "date" && (await noOverflow(page)),
    "calendar: the chosen day is selected and the page fits 375 px",
  );
  await page.getByRole("link", { name: "Bu güne iş ekle" }).click();
  await page.waitForURL(/\/yonetim\/yeni\?/);
  check(
    (await page.locator("#dueOn").inputValue()) === day &&
      (await page.getByTestId("on-calendar").getAttribute("aria-checked")) === "true" &&
      (await page.getByRole("link", { name: "Takvime dön" }).count()) === 1,
    "calendar: Yeni iş from a day has that day and Takvime ekle on",
  );
  await page.fill("#title", "E2E Takvim salon");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/yonetim\/\d+$/);
  const created = await latest("E2E Takvim salon");
  check(
    created?.on_calendar === 1 && created.due_on === day,
    "calendar: the saved ticket is on the calendar on its due day",
  );
  check(
    (await page.getByTestId("ticket-calendar").textContent()).includes("Takvimde"),
    "calendar: the ticket page says Takvimde",
  );
  check((await dayCard(page, day, created.number)) === 1, "calendar: the day lists the ticket");
  check(
    Number(
      await page
        .locator(`[data-testid=calendar-grid] a[data-day="${day}"]`)
        .getAttribute("data-count"),
    ) >= 1,
    "calendar: the grid cell counts it",
  );

  // The switch without a date is refused.
  await goto(page, "/yonetim/yeni");
  await page.fill("#title", "E2E Takvim tarihsiz");
  await page.getByTestId("on-calendar").click();
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText(NEEDS_DATE).first().waitFor();
  check(!(await latest("E2E Takvim tarihsiz")), "calendar: Takvime ekle without a date is refused");

  // Takvimden çıkar, then Takvime ekle again on the ticket page.
  await goto(page, `/yonetim/${created.number}`);
  await page.getByRole("button", { name: "Takvimden çıkar" }).click();
  check(
    await toast(page, `#${created.number} takvimden çıkarıldı.`),
    "calendar: Takvimden çıkar toasts",
  );
  check(
    (await ticketRow(created.number)).on_calendar === 0 &&
      (await dayCard(page, day, created.number)) === 0,
    "calendar: a removed ticket leaves the calendar and keeps its due day",
  );
  await goto(page, `/yonetim/${created.number}`);
  await page.getByRole("button", { name: "Takvime ekle" }).click();
  check(await toast(page, `#${created.number} takvime eklendi.`), "calendar: Takvime ekle toasts");
  check(
    (await ticketRow(created.number)).on_calendar === 1,
    "calendar: it is back on the calendar",
  );

  // A ticket without a due day asks for one.
  const bare = await insertTicket({ title: "E2E Takvim bare", by: yk });
  const later = istanbulDate(10);
  await goto(page, `/yonetim/${bare.number}`);
  await page.getByRole("button", { name: "Takvime ekle" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.locator("#takvim-gun").fill(later);
  await dialog.getByRole("button", { name: "Ekle" }).click();
  await toast(page, `#${bare.number} takvime eklendi.`);
  const bareRow = await ticketRow(bare.number);
  check(
    bareRow.on_calendar === 1 &&
      bareRow.due_on === later &&
      (await eventsOf(bare.number, "due")).some((e) => e.to_value === later),
    "calendar: the picked day becomes the due day, with a thread entry",
  );

  // Removing the due day on edit takes it off the calendar.
  await goto(page, `/yonetim/${bare.number}/duzenle`);
  await page.getByRole("button", { name: "Tarihi kaldır" }).click();
  check(
    (await page.getByTestId("on-calendar").getAttribute("aria-checked")) === "false",
    "calendar: Tarihi kaldır turns the switch off",
  );
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(new RegExp(`/yonetim/${bare.number}$`));
  const cleared = await ticketRow(bare.number);
  check(
    cleared.on_calendar === 0 && cleared.due_on === null,
    "calendar: no due day, not on the calendar",
  );

  // Month navigation and the board link.
  await goto(page, `/yonetim/takvim?ay=2026-01`);
  const jan = await page.getByTestId("calendar-month").textContent();
  await page.getByRole("link", { name: "Sonraki ay" }).click();
  await page.waitForURL(/ay=2026-02/);
  check(
    /ocak 2026/i.test(jan) &&
      /şubat 2026/i.test(await page.getByTestId("calendar-month").textContent()),
    "calendar: Sonraki ay moves to the next month",
  );
  await goto(page, "/yonetim");
  const boardLink = await page
    .getByRole("link", { name: "Takvim", exact: true })
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check(boardLink, "calendar: the board links to Takvim");
  await page.context().close();

  // Members can't see it or call it.
  const korist = await as(browser, "korist@arkhe.local", { phone: true });
  await korist.goto(`${BASE}/yonetim/takvim`);
  check(
    !korist.url().includes("/yonetim/takvim"),
    "calendar: a member is sent away from /yonetim/takvim",
  );
  const ids = await actionIds(BOARD_ACTIONS, String(created.number));
  await callAction(korist, ids.setTicketCalendar, [{ number: created.number, on: false }]);
  check(
    (await ticketRow(created.number)).on_calendar === 1,
    "calendar: a member's setTicketCalendar changes nothing",
  );
  await korist.context().close();

  await deleteTickets("title like 'E2E Takvim%'");
}
