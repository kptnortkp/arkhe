import {
  BASE,
  actionIds,
  callAction,
  check,
  db,
  insertRehearsal,
  loginAs,
  markOf,
  userId,
} from "./lib.mjs";
import { addDevice, resetPush } from "./push.mjs";

const REH_ACTIONS = "src/app/(portal)/calismalar/actions.ts";
const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
const exists = async (id) => Boolean(await one("select 1 from rehearsals where id = ?", [id]));

export default async function phase2bDelete(browser) {
  const yk = await loginAs(browser, "yk@arkhe.local", { mobile: true });
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });

  // A board member deletes an upcoming rehearsal; the excuse goes with it and members hear of it.
  const upcoming = await insertRehearsal({ title: "E2E Silinecek", startOffsetMin: 3 * 24 * 60 });
  await db.execute({
    sql: "insert into attendance (rehearsal_id, user_id, status, method, note, recorded_at) values (?, ?, 'excused', 'self', 'Sınav', unixepoch())",
    args: [upcoming, await userId("korist@arkhe.local")],
  });
  await addDevice(await userId("korist@arkhe.local"));
  await yk.goto(`${BASE}/calismalar/${upcoming}`);
  await yk.getByRole("button", { name: "Sil" }).click();
  const dialog = yk.getByRole("dialog");
  check(
    (await dialog.textContent()).includes("Koristlere iptal bildirimi gider."),
    "delete: the confirmation says members are notified",
  );
  await dialog.getByRole("button", { name: "Sil" }).click();
  await yk.waitForURL(`${BASE}/calismalar`);
  check(!(await exists(upcoming)), "delete: a board member deletes an upcoming rehearsal");
  check(
    (await markOf(upcoming, "korist@arkhe.local")) == null,
    "delete: the excuse is deleted with it",
  );
  let sent = [];
  for (let i = 0; i < 20 && sent.length === 0; i++) {
    sent = (
      await db.execute({
        sql: "select url, title from notifications where kind = 'rehearsal_cancelled' and tag = ?",
        args: [`calisma-${upcoming}`],
      })
    ).rows;
    if (sent.length === 0) await yk.waitForTimeout(250);
  }
  check(
    sent.length > 0 && sent.every((n) => n.url === "/calismalar" && n.title === "Çalışma iptal"),
    "delete: members get Çalışma iptal pointing at the rehearsal list",
  );

  // A rehearsal whose attendance was taken can't be deleted, not even by a crafted request.
  const taken = await insertRehearsal({ title: "E2E Silinemez", startOffsetMin: -5 });
  await db.execute({
    sql: "update rehearsals set opened_at = unixepoch() where id = ?",
    args: [taken],
  });
  await yk.goto(`${BASE}/calismalar/${taken}`);
  check(
    (await yk.getByRole("button", { name: "Sil" }).count()) === 0,
    "delete: no Sil button once attendance is open",
  );
  const ids = await actionIds(REH_ACTIONS, taken);
  await callAction(yk, ids.deleteRehearsal, [taken]);
  check(await exists(taken), "delete: the server refuses a rehearsal with attendance");

  // Members can't delete.
  const other = await insertRehearsal({ title: "E2E Korist Silemez", startOffsetMin: 24 * 60 });
  await korist.goto(`${BASE}/calismalar/${other}`);
  check(
    (await korist.getByRole("button", { name: "Sil" }).count()) === 0,
    "delete: members see no Sil button",
  );
  await callAction(korist, (await actionIds(REH_ACTIONS, other)).deleteRehearsal, [other]);
  check(await exists(other), "delete: the server refuses a member");

  // A past rehearsal that never had attendance can be deleted too (e.g. created by mistake).
  const untaken = await insertRehearsal({ title: "E2E Geçmiş Yoklamasız", startOffsetMin: -600 });
  await yk.goto(`${BASE}/calismalar/${untaken}`);
  await yk.getByRole("button", { name: "Sil" }).click();
  check(
    !(await yk.getByRole("dialog").textContent()).includes("bildirim"),
    "delete: a past rehearsal sends no notification",
  );
  await yk.getByRole("dialog").getByRole("button", { name: "Sil" }).click();
  await yk.waitForURL(`${BASE}/calismalar`);
  check(!(await exists(untaken)), "delete: a past rehearsal without attendance is deleted");

  await resetPush();
  for (const page of [yk, korist]) await page.context().close();
}
