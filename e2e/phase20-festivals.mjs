// Phase 20: the board's festival list (spreadsheet colours, Excel export, calendar, reminders)
// and special days that every member sees.
import { createRequire } from "node:module";
import { request } from "playwright-core";
import { BASE, check, db, istanbulDate, loginAs, userId } from "./lib.mjs";
import { addDevice, at, dispatch, resetPush, rowsOf } from "./push.mjs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const NAME = "E2E Festival Deneme";
const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] ?? null;

async function cleanup() {
  await db.execute("delete from festivals where name like 'E2E Festival%'");
  await db.execute("delete from special_days where title like 'E2E Özel%'");
  await db.execute("delete from calendar_feeds where token like 'e2efestival%'");
}

export default async function run(browser) {
  await cleanup();
  try {
    await festivals(browser);
    await specialDays(browser);
    await exportBook(browser);
    await feed();
    await resetPush();
    await reminders();
  } finally {
    await resetPush();
    await cleanup();
  }
}

async function festivals(browser) {
  const yk = await loginAs(browser, "yk@arkhe.local", { mobile: true });
  await yk.goto(`${BASE}/yonetim/festivaller`);
  const seeded = await yk.getByTestId("festival").count();
  check(seeded >= 15, `the spreadsheet's festivals are in the portal (${seeded})`);
  const colours = await yk.getByTestId("festival").evaluateAll((els) =>
    els.map((e) => [e.dataset.region, e.dataset.status, getComputedStyle(e).backgroundColor]),
  );
  const bg = (region, status) => colours.find(([r, s]) => r === region && s === status)?.[2];
  check(bg("tr", "watching") === "rgb(255, 242, 204)", `Türkiye cards are the sheet's yellow (${bg("tr", "watching")})`);
  check(bg("abroad", "watching") === "rgb(201, 218, 248)", `abroad cards are the sheet's blue (${bg("abroad", "watching")})`);
  check(bg("tr", "attending") === "rgb(182, 215, 168)", `Katılıyoruz is the sheet's green (${bg("tr", "attending")})`);
  check(await yk.getByRole("list", { name: "Renkler" }).isVisible(), "a colour legend explains the cards");

  await yk.getByRole("link", { name: "Festival", exact: true }).click();
  await yk.waitForURL(`${BASE}/yonetim/festivaller/yeni`);
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.getByText("Ad boş olamaz.").waitFor();
  check(true, "a festival needs a name");
  await yk.getByLabel("Ad", { exact: true }).fill(NAME);
  await yk.getByText("Türkiye", { exact: true }).click();
  await yk.getByLabel(/^Başlangıç/).fill(istanbulDate(40));
  await yk.getByLabel(/^Bitiş/).fill(istanbulDate(38));
  await yk.getByLabel(/^Son başvuru günü/).fill(istanbulDate(7));
  await yk.getByLabel(/^Bağlantı \(/).fill("ornek-festival.org/basvuru");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.getByText("Bitiş, başlangıçtan önce olamaz.").waitFor();
  check(true, "the end cannot come before the start");
  await yk.getByLabel(/^Bitiş/).fill(istanbulDate(42));
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForURL(`${BASE}/yonetim/festivaller`);
  const row = await one("select * from festivals where name = ?", [NAME]);
  check(row?.url === "https://ornek-festival.org/basvuru" && row?.status === "watching", "a link without https gets it, the status starts as Takipte");
  const card = yk.locator(`[data-testid=festival][data-id="${row?.id}"]`);
  check((await card.getByTestId("deadline-chip").innerText()) === "7 gün kaldı", "the card counts down to the deadline");
  check((await card.getByText("Yeni", { exact: true }).count()) === 1, "a festival just added is marked Yeni");

  await yk.goto(`${BASE}/yonetim/takvim?ay=${istanbulDate(7).slice(0, 7)}&gun=${istanbulDate(7)}`);
  check((await yk.locator(`[data-testid=calendar-day] [data-key="fd-${row?.id}"]`).count()) === 1, "the deadline is on the board calendar");
  await yk.goto(`${BASE}/yonetim/takvim?ay=${istanbulDate(41).slice(0, 7)}&gun=${istanbulDate(41)}&tur=festival`);
  check((await yk.locator(`[data-testid=calendar-day] [data-key="f-${row?.id}-${istanbulDate(41)}"]`).count()) === 1, "every festival day is on the calendar, with its own filter");
  await yk.goto(`${BASE}/`);
  check(await yk.getByTestId("home-festival-deadlines").getByText(NAME).isVisible(), "the board home card lists the coming deadline");

  await yk.goto(`${BASE}/yonetim/festivaller/${row?.id}`);
  await yk.getByText("Başvurduk", { exact: true }).click();
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForURL(`${BASE}/yonetim/festivaller`);
  check((await one("select status from festivals where id = ?", [row?.id]))?.status === "applied", "the status can change to Başvurduk");
  await yk.goto(`${BASE}/`);
  check((await yk.getByTestId("home-festival-deadlines").getByText(NAME).count()) === 0, "once we applied the deadline leaves the home card");

  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  const res = await korist.goto(`${BASE}/yonetim/festivaller`);
  check(!korist.url().endsWith("/yonetim/festivaller") || res.status() >= 400, "a member cannot open the festivals");
  const xlsx = await korist.request.get(`${BASE}/yonetim/festivaller/xlsx`);
  check(xlsx.status() === 403, `a member cannot download the Excel (${xlsx.status()})`);
  await korist.goto(`${BASE}/yonetim/takvim?ay=${istanbulDate(7).slice(0, 7)}`);
  check((await korist.locator(`[data-key="fd-${row?.id}"]`).count()) === 0, "nor see them on a calendar");
  for (const p of [yk, korist]) await p.context().close();
}

async function specialDays(browser) {
  const day = istanbulDate(10);
  const sef = await loginAs(browser, "sef@arkhe.local", { mobile: true });
  await sef.goto(`${BASE}/ozel-gunler/yeni?tarih=${day}`);
  await sef.getByLabel("Ad", { exact: true }).fill("E2E Özel Gün");
  await sef.getByText("Resmi tatil", { exact: true }).click();
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForURL(new RegExp(`/ozel-gunler\\?yil=${day.slice(0, 4)}`));
  const row = await one("select * from special_days where title = 'E2E Özel Gün'");
  check(row?.day === day && row?.kind === "holiday", "a manager adds a special day");

  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  await korist.goto(`${BASE}/calismalar`);
  const link = korist.getByTestId("special-days-link");
  check((await link.innerText()).includes("E2E Özel Gün"), `the rehearsals page names the next special day (${(await link.innerText()).replace(/\s+/g, " ")})`);
  await link.click();
  await korist.waitForURL(`${BASE}/ozel-gunler`);
  check((await korist.getByTestId("special-day").filter({ hasText: "E2E Özel Gün" }).count()) >= 1, "every member sees the special days");
  check((await korist.getByRole("link", { name: "Özel gün", exact: true }).count()) === 0, "a member gets no add button");
  check((await korist.getByRole("link", { name: "Düzenle: E2E Özel Gün" }).count()) === 0, "nor edit links");
  await korist.goto(`${BASE}/ozel-gunler?yil=2027`);
  const jan1 = korist.locator('[data-testid=year-calendar] [data-day="2027-01-01"]');
  check((await jan1.getAttribute("data-kind")) === "holiday" && (await jan1.evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(242, 222, 222)", "Yılbaşı 2027 is coloured as a holiday");
  const eve = korist.locator('[data-testid=year-calendar] [data-day="2027-05-15"]');
  check((await eve.evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(252, 248, 227)", "an arife is the sheet's yellow");
  const sat = korist.locator('[data-testid=year-calendar] [data-day="2027-01-02"]');
  check((await sat.evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(232, 240, 245)", "weekends are the sheet's blue");
  check((await korist.locator('[data-testid=year-calendar] [data-day="2027-04-23"]').getAttribute("data-kind")) === "holiday", "23 Nisan, missing in the sheet, is a holiday");
  const denied = await korist.request.get(`${BASE}/ozel-gunler/${row?.id}`);
  check(!(await denied.text()).includes("Özel günü sil"), "a member cannot open the edit page");

  await sef.goto(`${BASE}/yonetim/takvim?ay=${day.slice(0, 7)}&gun=${day}`);
  check((await sef.locator(`[data-testid=calendar-day] [data-key="s-${row?.id}"]`).count()) === 1, "special days are on the board calendar too");
  check((await sef.locator(`[data-testid=calendar-grid] a[data-day="${day}"]`).evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(242, 222, 222)", "and their day is tinted");

  await sef.goto(`${BASE}/ozel-gunler/${row?.id}`);
  await sef.getByRole("button", { name: "Özel günü sil" }).click();
  await sef.getByRole("button", { name: "Sil", exact: true }).click();
  await sef.waitForURL(/\/ozel-gunler\?yil=/);
  check(!(await one("select 1 from special_days where id = ?", [row?.id])), "a manager deletes a special day");
  for (const p of [sef, korist]) await p.context().close();
}

async function exportBook(browser) {
  const yk = await loginAs(browser, "yk@arkhe.local");
  const res = await yk.request.get(`${BASE}/yonetim/festivaller/xlsx`);
  check(res.status() === 200 && res.headers()["content-type"].includes("spreadsheetml"), "the board downloads an Excel file");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.body());
  const names = wb.worksheets.map((w) => w.name);
  check(names[0] === "Festivaller" && /^Özel Günler '\d\d -'\d\d$/.test(names[1] ?? ""), `two sheets like the original (${names.join(", ")})`);
  const ws = wb.getWorksheet("Festivaller");
  const header = ws.getRow(1).values.slice(3, 8);
  check(header.join("|") === "ETKİNLİK ADI|TARİHİ|BAŞVURU|KATILIM ÜCRETİ|YER", `the same columns (${header.join("|")})`);
  const rows = [];
  ws.eachRow((r) => rows.push(r));
  const find = (text) => rows.find((r) => String(r.getCell(3).value ?? "").startsWith(text));
  const argb = (r, c = 3) => r?.getCell(c).fill?.fgColor?.argb;
  check(argb(find("Trabzon")) === "FFFFF2CC", "a Türkiye row is yellow");
  check(argb(find("Cork")) === "FFC9DAF8", "an abroad row is blue");
  check(argb(find("Korolar Maratonu")) === "FFB6D7A8" || !find("Korolar Maratonu"), "Katılıyoruz is green");
  check(argb(find(NAME)) === "FF00FF00" && find(NAME)?.getCell(1).value === "Yeni eklendi", "a new festival is bright green, flagged Yeni eklendi");
  check(find(NAME)?.getCell(8).value?.hyperlink === "https://ornek-festival.org/basvuru", "links stay clickable");
  check(find("Béla Bartók") && rows.some((r) => r.getCell(2).value === "2028"), "later years get their own heading, as 2028 did");
  check(ws.getCell("A1").value === "Türkiye" && ws.getCell("A2").value === "Yurtdışı", "the colour legend sits in column A");

  const days = wb.worksheets[1];
  let jan1 = null;
  let eve = null;
  days.eachRow((r) =>
    r.eachCell((c) => {
      const v = String(c.value ?? "");
      if (v.startsWith("Yılbaşı")) jan1 = c;
      if (v.startsWith("Kurban Bayramı arifesi")) eve = c;
    }),
  );
  check(jan1?.fill?.fgColor?.argb === "FFF2DEDE", "Özel Günler: holidays keep their colour");
  check(eve?.fill?.fgColor?.argb === "FFFCF8E3", "and an arife is yellow");
  await yk.context().close();
}

async function feed() {
  const yk = await userId("yk@arkhe.local");
  const korist = await userId("korist@arkhe.local");
  const token = (who) => `e2efestival${who}`.padEnd(43, "x");
  for (const [id, who] of [[yk, "yk"], [korist, "korist"]]) {
    await db.execute({ sql: "delete from calendar_feeds where user_id = ?", args: [id] });
    await db.execute({ sql: "insert into calendar_feeds (user_id, token) values (?, ?)", args: [id, token(who)] });
  }
  const row = await one("select id from festivals where name = ?", [NAME]);
  const anon = await request.newContext();
  const board = await (await anon.get(`${BASE}/api/takvim/${token("yk")}.ics`)).text();
  const ev = board.split("BEGIN:VEVENT").find((e) => e.includes(`UID:festival-${row?.id}@`)) ?? "";
  check(ev.includes(`DTSTART;VALUE=DATE:${istanbulDate(40).replace(/-/g, "")}`) && ev.includes(`DTEND;VALUE=DATE:${istanbulDate(43).replace(/-/g, "")}`), "a board member's feed has the festival as all-day days");
  check(board.includes(`UID:festival-deadline-${row?.id}@`), "and its deadline");
  const member = await (await anon.get(`${BASE}/api/takvim/${token("korist")}.ics`)).text();
  check(member.includes("BEGIN:VCALENDAR") && !member.includes("festival-"), "a member's feed has no festivals");
  await anon.dispose();
}

async function reminders() {
  const run = istanbulDate(1);
  const ts = (day, time) => Math.floor(Date.parse(at(day, time)) / 1000);
  const ins = (name, status, deadline, starts) =>
    db.execute({
      sql: "insert into festivals (id, name, region, status, deadline_on, starts_on, ends_on) values (?, ?, 'tr', ?, ?, ?, ?)",
      args: [crypto.randomUUID(), name, status, deadline, starts, starts],
    });
  await ins("E2E Festival Hatırlat", "watching", istanbulDate(8), null);
  await ins("E2E Festival Başvurduk", "applied", istanbulDate(8), null);
  await ins("E2E Festival Bugün", "watching", run, null);
  await ins("E2E Festival Gidiyoruz", "attending", null, istanbulDate(31));
  await ins("E2E Festival Uzak", "watching", istanbulDate(6), null);
  const [sef, yk, korist] = await Promise.all(
    ["sef@arkhe.local", "yk@arkhe.local", "korist@arkhe.local"].map(userId),
  );
  for (const u of [sef, yk, korist]) await addDevice(u);
  await db.execute("delete from notification_state where key like 'sabah-%'");
  await dispatch(`?simdi=${encodeURIComponent(at(run, "08:20"))}`);
  const rows = (await rowsOf("created_at >= ?", [ts(run, "08:00")])).filter((r) =>
    String(r.dedupe_key).startsWith("festival-"),
  );
  const lines = (user) =>
    rows
      .filter((r) => r.user_id === user)
      .map((r) => r.line)
      .sort();
  const all = (await db.execute({ sql: "select kind, line, user_id from notifications where created_at >= ?", args: [ts(run, "08:00")] })).rows;
  const said = (user, text) =>
    all.some((r) => r.user_id === user && String(r.line ?? "").includes(text));
  check(said(yk, "E2E Festival Hatırlat, son başvuru 7 gün sonra"), `7 days before an unapplied deadline the board hears it (${lines(yk).join(" | ")})`);
  check(said(sef, "E2E Festival Hatırlat, son başvuru 7 gün sonra"), "so does the conductor");
  check(said(yk, "E2E Festival Bugün, son başvuru bugün"), "and on the last day");
  check(!said(yk, "E2E Festival Başvurduk"), "once we applied the deadline reminders stop");
  check(!said(yk, "E2E Festival Uzak"), "5 days before is not a reminder day");
  check(said(yk, "E2E Festival Gidiyoruz 30 gün sonra başlıyor"), "30 days before a festival we attend: Festival yaklaşıyor");
  check(!all.some((r) => r.user_id === korist && String(r.line ?? "").includes("E2E Festival")), "members get no festival reminders");
}
