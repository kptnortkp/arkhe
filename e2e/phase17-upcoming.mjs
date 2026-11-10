// Phase 17: "Gelecek çalışmalar" (advance excuses per upcoming rehearsal, managers only) and
// past excuses shown as absences ("Gelmedi · mazeretli").
import { BASE, check, db, insertRehearsal, loginAs, userId } from "./lib.mjs";

const excuse = async (rehearsalId, email, note) =>
  db.execute({
    sql: "insert into attendance (rehearsal_id, user_id, status, method, note, recorded_by) values (?, ?, 'excused', 'self', ?, ?)",
    args: [rehearsalId, await userId(email), note, await userId(email)],
  });

const row = (page, id) => page.locator(`[data-testid=upcoming-row][data-rehearsal="${id}"]`);

export default async function run(browser) {
  const tutti = await insertRehearsal({ title: "E2E Gelecek Tutti", startOffsetMin: 3 * 1440 });
  const tenors = await insertRehearsal({
    title: "E2E Gelecek Tenor",
    startOffsetMin: 5 * 1440,
    type: "sectional",
    parts: ["tenor"],
  });
  const quiet = await insertRehearsal({ title: "E2E Gelecek Sessiz", startOffsetMin: 6 * 1440 });
  const cancelled = await insertRehearsal({ title: "E2E Gelecek İptal", startOffsetMin: 4 * 1440 });
  await db.execute({ sql: "update rehearsals set cancelled_at = unixepoch() where id = ?", args: [cancelled] });
  await excuse(tutti, "korist@arkhe.local", "Sınavım var");
  await excuse(tutti, "can.erdogan@arkhe.local", null);
  await excuse(tenors, "can.erdogan@arkhe.local", "İş seyahati");
  await excuse(cancelled, "emre.aksoy@arkhe.local", null);

  const past = await insertRehearsal({ title: "E2E Geçmiş Mazeret", startOffsetMin: -3 * 1440 });
  await excuse(past, "korist@arkhe.local", "Hastaydım");
  await db.execute({ sql: "update rehearsals set opened_at = starts_at, closed_at = ends_at where id = ?", args: [past] });

  const sef = await loginAs(browser, "sef@arkhe.local");
  await sef.goto(`${BASE}/raporlar/gelecek`);
  const t = row(sef, tutti);
  check(
    (await t.getByTestId("upcoming-count").textContent()) === "2 kişi gelemeyecek",
    "tutti row counts both excuses",
  );
  const chips = await t.getByTestId("upcoming-parts").textContent();
  check(chips.includes("A −1") && chips.includes("T −1") && !chips.includes("S −"), `part chips show the missing parts (${chips})`);
  const names = await t.getByTestId("upcoming-absences").textContent();
  check(names.includes("Can Erdoğan") && names.includes("“Sınavım var”"), "names and the excuse note are listed");
  check(
    (await row(sef, tenors).getByTestId("upcoming-count").textContent()) === "1 kişi gelemeyecek",
    "sectional row counts its tenor",
  );
  check((await row(sef, cancelled).count()) === 0, "cancelled rehearsals are left out");
  check((await row(sef, quiet).count()) === 0, "default view hides rehearsals nobody is missing");
  check((await row(sef, past).count()) === 0, "closed rehearsals are left out");
  await sef.getByRole("link", { name: "Tümü" }).click();
  await sef.waitForURL(`${BASE}/raporlar/gelecek?hepsi=1`);
  check(
    (await row(sef, quiet).getByTestId("upcoming-count").textContent()) === "Herkes gelecek görünüyor",
    "Tümü lists rehearsals without excuses too",
  );

  await sef.goto(`${BASE}/calismalar`);
  check((await sef.getByTestId("upcoming-link").textContent()).includes("mazeret bildirildi"), "Çalışmalar links managers to the report");
  const chip = (page, id) => page.locator(`a[href="/calismalar/${id}"] [data-testid=missing-chip]`);
  check((await chip(sef, tutti).textContent()) === "2 kişi yok", "the list marks how many can't come");
  check((await chip(sef, tenors).textContent()) === "1 kişi yok", "sectional rows get the chip too");
  check((await chip(sef, quiet).count()) === 0, "no chip when nobody is missing");
  await sef.goto(`${BASE}/raporlar`);
  check((await sef.getByRole("link", { name: "Gelecek çalışmalar" }).count()) === 1, "Raporlar links to the report");
  check(!(await sef.getByTestId("report-table").textContent()).includes("Mazeretli"), "report table has no separate Mazeretli column");

  const yk = await loginAs(browser, "yk@arkhe.local", { mobile: true });
  await yk.goto(`${BASE}/raporlar/gelecek`);
  check((await row(yk, tutti).count()) === 1, "board sees the report");

  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  await korist.goto(`${BASE}/raporlar/gelecek`);
  check(!korist.url().includes("/raporlar/gelecek"), "a member can't open the report");
  await korist.goto(`${BASE}/calismalar`);
  check((await korist.getByTestId("upcoming-link").count()) === 0, "members don't get the report link");
  check((await korist.getByTestId("missing-chip").count()) === 0, "members don't see the missing chips");
  check(
    (await korist.locator(`a[href="/calismalar/${tutti}"]`).textContent()).includes("Gelemeyeceğim"),
    "an upcoming excuse reads as Gelemeyeceğim",
  );
  await korist.goto(`${BASE}/calismalar?sekme=gecmis`);
  const pastRow = await korist.locator(`a[href="/calismalar/${past}"]`).textContent();
  check(pastRow.includes("Gelmedi · mazeretli"), `a past excuse reads as an absence (${pastRow})`);

  await Promise.all([sef, yk, korist].map((p) => p.context().close()));
}
