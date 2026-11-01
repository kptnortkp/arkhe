// The Yönetim Kurulu calendar: rehearsals, events and tickets; Ay and Liste views; type filters.
import { BASE, check, db, insertRehearsal, istanbulDate } from "./lib.mjs";
import {
  actionIds,
  as,
  BOARD_ACTIONS,
  callAction,
  callForm,
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
const EVENT_ACTIONS = "src/app/(portal)/yonetim/takvim/actions.ts";
const latest = async (title) =>
  (
    await db.execute({
      sql: "select * from board_tickets where title = ? order by number desc limit 1",
      args: [title],
    })
  ).rows[0];
const eventRow = async (title) =>
  (await db.execute({ sql: "select * from calendar_events where title = ?", args: [title] }))
    .rows[0];

const dayUrl = (day, extra = "") => `/yonetim/takvim?ay=${day.slice(0, 7)}&gun=${day}${extra}`;
const dayKeys = (page) =>
  page
    .locator("[data-testid=calendar-day] [data-testid=calendar-item]")
    .evaluateAll((els) => els.map((e) => e.dataset.key));

async function cleanup() {
  await deleteTickets("title like 'E2E Takvim%'");
  await db.execute("delete from calendar_events where title like 'E2E Takvim%'");
  await db.execute("delete from rehearsals where title like 'E2E Takvim%'");
}

export default async function phase8cCalendar(browser) {
  await cleanup();
  const { yk } = await people();
  const day = istanbulDate(3);
  const page = await as(browser, "yk@arkhe.local", { phone: true });

  // A ticket from the calendar: İş pre-fills the day and the switch.
  await goto(page, dayUrl(day));
  check(
    (await page
      .locator(`[data-testid=calendar-grid] a[data-day="${day}"]`)
      .getAttribute("aria-current")) === "date" && (await noOverflow(page)),
    "calendar: the chosen day is selected and the page fits 375 px",
  );
  await page
    .locator("[data-testid=calendar-day]")
    .getByRole("link", { name: "İş", exact: true })
    .click();
  await page.waitForURL(/\/yonetim\/yeni\?/);
  check(
    (await page.locator("#dueOn").inputValue()) === day &&
      (await page.getByTestId("on-calendar").getAttribute("aria-checked")) === "true" &&
      (await page.getByRole("link", { name: "Takvime dön" }).count()) === 1,
    "calendar: İş from a day has that day and Takvime ekle on",
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
  await goto(page, dayUrl(day));
  check(
    (await dayKeys(page)).includes(`t-${created.number}`),
    "calendar: the day lists the ticket",
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
  await goto(page, dayUrl(day));
  check(
    (await ticketRow(created.number)).on_calendar === 0 &&
      !(await dayKeys(page)).includes(`t-${created.number}`),
    "calendar: a removed ticket leaves the calendar and keeps its due day",
  );
  await goto(page, `/yonetim/${created.number}`);
  await page.getByRole("button", { name: "Takvime ekle" }).click();
  check(await toast(page, `#${created.number} takvime eklendi.`), "calendar: Takvime ekle toasts");
  check(
    (await ticketRow(created.number)).on_calendar === 1,
    "calendar: it is back on the calendar",
  );

  // A ticket without a due day asks for one; clearing the date on edit takes it off.
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

  // Events: only the title and the day are required.
  await goto(page, dayUrl(day));
  await page
    .locator("[data-testid=calendar-day]")
    .getByRole("link", { name: "Etkinlik", exact: true })
    .click();
  await page.waitForURL(/\/yonetim\/takvim\/yeni\?/);
  check(
    (await page.locator("#day").inputValue()) === day,
    "events: Etkinlik from a day has that day",
  );
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("Ad boş olamaz.").first().waitFor();
  await page.fill("#title", "E2E Takvim yönetim toplantısı");
  await page.fill("#endTime", "20:00");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("Bitiş için önce başlangıç saati seç.").first().waitFor();
  await page.fill("#endTime", "");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/yonetim\/takvim\?/);
  const plain = await eventRow("E2E Takvim yönetim toplantısı");
  check(
    plain?.kind === "other" &&
      plain.day === day &&
      plain.start_time === null &&
      plain.location === null,
    "events: a title and a day save as Diğer, all day",
  );
  check(
    await toast(page, "Etkinlik takvime eklendi."),
    "events: saving toasts Etkinlik takvime eklendi.",
  );

  await goto(page, `/yonetim/takvim/yeni?tarih=${day}`);
  await page.fill("#title", "E2E Takvim Bahar konseri");
  await page.getByText("Konser", { exact: true }).click();
  await page.fill("#startTime", "19:30");
  await page.fill("#endTime", "21:00");
  await page.fill("#location", "CRR");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/yonetim\/takvim\?/);
  const concert = await eventRow("E2E Takvim Bahar konseri");
  check(
    concert?.kind === "concert" && concert.start_time === "19:30" && concert.end_time === "21:00",
    "events: a concert keeps its kind, times and place",
  );

  // Rehearsals show up by themselves.
  const rehearsal = await insertRehearsal({ title: "E2E Takvim prova", startOffsetMin: 3 * 1440 });
  const rDay = (
    await db.execute({
      sql: "select date(starts_at, 'unixepoch', '+3 hours') as d from rehearsals where id = ?",
      args: [rehearsal],
    })
  ).rows[0].d;
  await goto(page, dayUrl(rDay));
  check(
    (await dayKeys(page)).includes(`r-${rehearsal}`),
    "calendar: a rehearsal appears on its day",
  );

  // Order on a day: all-day entries first, then by time.
  await goto(page, dayUrl(day));
  const keys = await dayKeys(page);
  const pos = (k) => keys.indexOf(k);
  check(
    pos(`e-${plain.id}`) >= 0 &&
      pos(`t-${created.number}`) >= 0 &&
      pos(`e-${concert.id}`) > pos(`e-${plain.id}`) &&
      pos(`e-${concert.id}`) > pos(`t-${created.number}`),
    `calendar: all-day entries come before the 19:30 concert (${keys.join(", ")})`,
  );

  // Filters.
  await goto(page, dayUrl(day, "&tur=konser"));
  let filtered = await dayKeys(page);
  check(
    filtered.includes(`e-${concert.id}`) &&
      !filtered.includes(`e-${plain.id}`) &&
      !filtered.includes(`t-${created.number}`),
    "filters: Konserler shows the concert only",
  );
  await goto(page, dayUrl(day, "&tur=is"));
  filtered = await dayKeys(page);
  check(
    filtered.includes(`t-${created.number}`) && !filtered.includes(`e-${concert.id}`),
    "filters: İşler shows tickets only",
  );
  await goto(page, dayUrl(rDay, "&tur=calisma"));
  filtered = await dayKeys(page);
  check(
    filtered.includes(`r-${rehearsal}`) && !filtered.includes(`e-${concert.id}`),
    "filters: Çalışmalar shows rehearsals only",
  );
  await goto(page, dayUrl(day, "&tur=diger"));
  check((await dayKeys(page)).join() === `e-${plain.id}`, "filters: Diğer shows the plain event");

  // Liste: days in order, each with its entries; the filter carries over.
  await goto(page, `/yonetim/takvim?ay=${day.slice(0, 7)}&gorunum=liste`);
  const listDays = await page
    .locator("[data-testid=calendar-list] > li")
    .evaluateAll((els) => els.map((e) => e.dataset.day));
  const sorted = [...listDays].sort();
  check(
    listDays.length > 0 &&
      JSON.stringify(listDays) === JSON.stringify(sorted) &&
      (await page
        .locator(`[data-testid=calendar-list] > li[data-day="${day}"] [data-testid=calendar-item]`)
        .count()) >= 3 &&
      (await noOverflow(page)),
    `liste: days in date order with their entries, fits 375 px (${listDays.join(", ")})`,
  );
  await page.getByRole("link", { name: "Konserler" }).click();
  await page.waitForURL(/tur=konser/);
  check(
    page.url().includes("gorunum=liste") &&
      (await page.locator(`[data-testid=calendar-list] [data-key="e-${concert.id}"]`).count()) ===
        1 &&
      (await page.locator(`[data-testid=calendar-list] [data-key="e-${plain.id}"]`).count()) === 0,
    "liste: a filter keeps the list view",
  );
  await page.getByRole("link", { name: "Ay", exact: true }).click();
  await page.waitForURL((u) => !u.searchParams.has("gorunum"));
  check((await page.getByTestId("calendar-grid").count()) === 1, "liste: Ay goes back to the grid");

  // Edit and delete an event.
  await goto(page, `/yonetim/takvim/etkinlik/${plain.id}`);
  await page.fill("#title", "E2E Takvim kurul toplantısı");
  await page.getByText("Toplantı", { exact: true }).click();
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/\/yonetim\/takvim\?/);
  const edited = await eventRow("E2E Takvim kurul toplantısı");
  check(
    edited?.id === plain.id && edited.kind === "meeting",
    "events: editing changes the title and kind",
  );
  await goto(page, `/yonetim/takvim/etkinlik/${plain.id}`);
  await page.getByRole("button", { name: "Etkinliği sil" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  await page.waitForURL(/\/yonetim\/takvim\?/);
  check(!(await eventRow("E2E Takvim kurul toplantısı")), "events: Etkinliği sil removes it");

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
  for (const path of [
    "/yonetim/takvim",
    "/yonetim/takvim/yeni",
    `/yonetim/takvim/etkinlik/${concert.id}`,
  ]) {
    await korist.goto(`${BASE}${path}`);
    check(
      !korist.url().includes("/yonetim/takvim"),
      `calendar: a member is sent away from ${path}`,
    );
  }
  const ids = await actionIds(BOARD_ACTIONS, String(created.number));
  await callAction(korist, ids.setTicketCalendar, [{ number: created.number, on: false }]);
  check(
    (await ticketRow(created.number)).on_calendar === 1,
    "calendar: a member's setTicketCalendar changes nothing",
  );
  const evIds = await actionIds(EVENT_ACTIONS, concert.id);
  await callForm(korist, evIds.createCalendarEvent, [], {
    id: crypto.randomUUID(),
    title: "E2E Takvim korist",
    day,
  });
  await callAction(korist, evIds.deleteCalendarEvent, [concert.id]);
  check(
    !(await eventRow("E2E Takvim korist")) && Boolean(await eventRow("E2E Takvim Bahar konseri")),
    "events: a member can't create or delete events",
  );
  await korist.context().close();

  await cleanup();
}
