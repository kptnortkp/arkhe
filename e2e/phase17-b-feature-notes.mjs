// Phase 17b: feature notes ("yenilik bildirimi"): a new build publishes each note once as an
// announcement from the IT user and pushes it to the note's audience minus the sender.
import { createHash } from "node:crypto";
import { BASE, check, db, loginAs, userId } from "./lib.mjs";
import { addDevice, resetPush, rowsOf, until } from "./push.mjs";

const { FEATURE_NOTES } = await import("../src/lib/announcements/feature-notes.ts");

function noteId(key) {
  const h = createHash("sha256").update(`feature-note:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const ids = FEATURE_NOTES.map((n) => noteId(n.key));
const forget = () =>
  db.batch(
    [
      `delete from announcements where id in (${ids.map(() => "?").join(",")})`,
      "delete from notifications where kind = 'announcement'",
      "delete from notification_state where key = 'surum'",
    ].map((sql, i) => (i === 0 ? { sql, args: ids } : sql)),
    "write",
  );

const health = (cookie) =>
  fetch(`${BASE}/api/saglik`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.status);

export default async function run(browser) {
  await resetPush();
  await forget();
  const note = FEATURE_NOTES.find((n) => n.audience === "board");
  check(Boolean(note), "there is a board note to publish");
  if (!note) return;
  const id = noteId(note.key);
  const [sef, yk, korist] = await Promise.all(
    ["sef@arkhe.local", "yk@arkhe.local", "korist@arkhe.local"].map(userId),
  );
  for (const u of [sef, yk, korist]) await addDevice(u);

  await health("arkhe_e2e_commit=aaaaaaa1111111");
  await new Promise((r) => setTimeout(r, 1000));
  check(!(await db.execute({ sql: "select 1 from announcements where id = ?", args: [id] })).rows.length, "without the opt-in a build publishes no notes");

  await health("arkhe_e2e_commit=bbbbbbb2222222; arkhe_e2e_feature_notes=1");
  const row = await until(async () => (await db.execute({ sql: "select * from announcements where id = ?", args: [id] })).rows[0]);
  check(row?.audience === "board" && row?.created_by === yk && row?.title === note.title, "a new build publishes the note from the IT user");
  const pushes = await until(async () => {
    const r = await rowsOf("kind = 'announcement' and dedupe_key = ?", [`duyuru-${id}`]);
    return r.length ? r : null;
  });
  const to = new Set((pushes ?? []).map((p) => p.user_id));
  check(to.has(sef) && !to.has(yk) && !to.has(korist), `the push reaches the board audience minus the sender (${to.size})`);

  await health("arkhe_e2e_commit=ccccccc3333333; arkhe_e2e_feature_notes=1");
  await new Promise((r) => setTimeout(r, 1200));
  const again = await db.execute({ sql: "select count(*) as n from announcements where id = ?", args: [id] });
  const pushesAgain = await rowsOf("kind = 'announcement' and dedupe_key = ?", [`duyuru-${id}`]);
  check(Number(again.rows[0].n) === 1 && pushesAgain.length === (pushes ?? []).length, "a later build never sends the same note again");

  const sefPage = await loginAs(browser, "sef@arkhe.local", { mobile: true });
  await sefPage.goto(`${BASE}/duyurular`);
  check(await sefPage.getByText(note.title).first().isVisible(), "the conductor finds the note under Duyurular");
  const koristPage = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  await koristPage.goto(`${BASE}/duyurular`);
  check((await koristPage.getByText(note.title).count()) === 0, "a member doesn't see a board note");

  for (const p of [sefPage, koristPage]) await p.context().close();
  await forget();
  await resetPush();
}
