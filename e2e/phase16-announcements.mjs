// Phase 16: announcements ("Duyurular"): compose with confirm, push to the audience minus the
// sender, home card with "Tamam", parts and board audiences, important = group null + urgent,
// edit with and without a resend, soft delete, show_until, read counts, refusals and rate limit.
import { readFile } from "node:fs/promises";
import { BASE, check, db, istanbulDate, loginAs, userId } from "./lib.mjs";
import { as } from "./board.mjs";
import { all, axe, createUser, go, layoutIssues, one } from "./media.mjs";
import { addDevice, resetPush, setPref } from "./push.mjs";

const ACTIONS = "src/app/(portal)/duyurular/actions.ts";
const FORBIDDEN = "Bu işlem için yetkin yok.";
const NOT_FOUND = "Bu duyuru artık yok.";
const T1 = "E2E Yarın fotoğraf çekimi";
const BODY1 = "Lütfen Arkhe tişörtlerinizle çalışmaya geliniz.\nAyrıntılar: https://example.com/foto. Bunu açma: javascript:alert(1)";
const T2 = "E2E Soprano ve tenor provası";
const T3 = "E2E Yönetim toplantısı";
const T4 = "E2E Salon değişti";
const T5 = "E2E Dördüncü duyuru";

async function reset() {
  await db.batch(
    [
      "delete from announcements where title like 'E2E%'",
      "delete from notifications where kind = 'announcement'",
      "delete from login_attempts where key like 'announcement:%'",
    ],
    "write",
  );
}

/** Action ids of the announcement actions, each with a page path that serves it. */
async function actions(sampleId) {
  const manifest = JSON.parse(
    await readFile(new URL("../.next/dev/server/server-reference-manifest.json", import.meta.url)),
  );
  const ids = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.filename !== ACTIONS) continue;
    const worker = Object.keys(entry.workers)[0];
    const path = worker
      .replace(/^app/, "")
      .replace(/\/\([^)]+\)/g, "")
      .replace(/\/page$/, "")
      .replace("[id]", sampleId);
    ids[entry.exportedName] = { id, path: path || "/" };
  }
  return ids;
}

async function callAction(page, action, args) {
  return page.evaluate(
    async ({ id, path, args }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
        body: JSON.stringify(args),
      });
      return res.text();
    },
    { ...action, args },
  );
}

const pushesOf = (id, update = false) =>
  all(
    `select * from notifications where kind = 'announcement' and dedupe_key ${update ? "like ?" : "= ?"} order by user_id`,
    [update ? `duyuru-${id}-%` : `duyuru-${id}`],
  );
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const homeItem = (page, id) => page.locator(`[data-testid=home-announcement][data-id="${id}"]`);
const listItem = (page, id) => page.locator(`[data-testid=announcement][data-id="${id}"]`);

/** Fills the compose form as the page's manager and confirms; returns the dialog text. */
async function compose(page, { title, body, parts, important = false }) {
  await go(page, `${BASE}/duyurular/yeni`);
  await page.fill("input[name=title]", title);
  await page.fill("textarea[name=body]", body);
  if (parts) {
    await page.locator("label:has(input[name=audience][value=parts])").click();
    for (const p of parts) await page.locator(`label:has(input[name=parts][value=${p}])`).click();
  }
  if (important) await page.locator("input[name=important]").check();
  await page.getByRole("button", { name: "Duyuruyu gönder", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  const text = (await dialog.textContent()) ?? "";
  await dialog.getByRole("button", { name: "Gönder", exact: true }).click();
  await page.waitForURL(/\/duyurular#[0-9a-f-]{36}$/, { timeout: 15000 });
  return text;
}

export default async function run(browser) {
  await reset();
  const ykId = await userId("yk@arkhe.local");
  const sefId = await userId("sef@arkhe.local");
  const koristId = await userId("korist@arkhe.local");
  // An inactive soprano: never counted, never notified.
  const goneId = await createUser("eski.duyuru@e2e.test", "E2E Ayrılan Soprano", { part: "soprano" });
  await db.execute({ sql: "update users set is_active = 0, left_at = unixepoch() where id = ?", args: [goneId] });
  await addDevice(goneId);
  const active = (await all("select id, role, voice_part from users where is_active = 1 and left_at is null"));
  const activeIds = active.map((u) => u.id);
  for (const id of activeIds) await addDevice(id);

  // --- compose as the board member (phone): counter, preview, default day, confirm count
  const yk = await loginAs(browser, "yk@arkhe.local", { phone: true });
  await go(yk, `${BASE}/duyurular/yeni`);
  check(
    (await yk.locator("input[name=showUntil]").inputValue()) === istanbulDate(7) &&
      (await yk.locator("input[name=audience][value=all]").isChecked()),
    "compose defaults: Herkes, shown on home until today + 7",
  );
  await yk.fill("input[name=title]", T1);
  await yk.fill("textarea[name=body]", BODY1);
  const counter = await yk.locator("[data-testid=announcement-body-count]").textContent();
  const preview = await yk.locator("[data-testid=announcement-preview]").textContent();
  check(counter === `${[...BODY1].length}/1000` && preview.includes(T1) && preview.includes("Lütfen Arkhe"), `counter and push preview follow the text (${counter})`);
  const text1 = await compose(yk, { title: T1, body: BODY1 });
  check(text1.includes(`${activeIds.length - 1} kişiye bildirim gidecek.`), `the confirm names the head count (${text1})`);
  const a1 = await one("select * from announcements where title = ?", [T1]);
  check(
    a1 && a1.audience === "all" && a1.important === 0 && a1.created_by === ykId && a1.show_until === istanbulDate(7) && a1.body === BODY1,
    "the announcement is stored with audience all and the default day",
  );
  const p1 = await pushesOf(a1.id);
  check(
    sameSet(p1.map((p) => p.user_id), activeIds.filter((id) => id !== ykId)) &&
      p1.every((p) => p.group_key === "calisma" && p.urgent === 0 && p.title === T1 && p.url === `/duyurular#${a1.id}` && p.body === BODY1),
    `every active member but the sender has a push row in calisma (${p1.length}/${activeIds.length - 1})`,
  );
  check(!p1.some((p) => p.user_id === goneId), "an inactive member gets nothing");

  // --- list: line breaks, safe links, manager facts
  const item = listItem(yk, a1.id);
  const link = item.locator("a[href='https://example.com/foto']");
  check(
    (await link.count()) === 1 &&
      (await link.getAttribute("target")) === "_blank" &&
      (await link.getAttribute("rel")) === "noopener noreferrer" &&
      (await item.locator("a[href^='javascript']").count()) === 0,
    "an http(s) URL becomes a new-tab link without the trailing dot; javascript: stays text",
  );
  check((await item.locator("[data-testid=announcement-body]").evaluate((e) => e.innerText)).includes("geliniz.\nAyrıntılar"), "line breaks are kept");
  check(
    (await item.locator("[data-testid=announcement-reads]").textContent()) === `Okuyan: 0/${activeIds.length - 1}` &&
      (await item.textContent()).includes("Demo Yönetim") && (await item.textContent()).includes("Kime: Herkes"),
    "the manager sees sender, audience and Okuyan 0/N",
  );

  // --- home card above the hero, Tamam for that user only
  const korist = await loginAs(browser, "korist@arkhe.local", { phone: true });
  await go(korist, `${BASE}/`);
  const card = homeItem(korist, a1.id);
  const cardBox = await card.boundingBox();
  const heroBox = await korist.locator("section[aria-label='Sıradaki çalışma']").boundingBox();
  check(cardBox && heroBox && cardBox.y < heroBox.y, "korist@ sees the home card above the hero");
  check((await korist.locator("[data-testid=home-announcements] a[href='/duyurular']").count()) >= 1, "the card links to Tüm duyurular");
  await go(yk, `${BASE}/`);
  check((await homeItem(yk, a1.id).count()) === 0, "the sender has no card for their own announcement");
  const sef = await loginAs(browser, "sef@arkhe.local");
  check((await homeItem(sef, a1.id).count()) === 1, "sef@ sees the card");
  await card.getByRole("button", { name: /Tamam/ }).click();
  await card.waitFor({ state: "detached" });
  await korist.waitForTimeout(500);
  await go(korist, `${BASE}/`);
  check(
    (await homeItem(korist, a1.id).count()) === 0 && Boolean(await one("select 1 from announcement_reads where announcement_id = ? and user_id = ?", [a1.id, koristId])),
    "Tamam hides the card for korist@ and survives a reload",
  );
  await go(sef, `${BASE}/`);
  check((await homeItem(sef, a1.id).count()) === 1, "Tamam is per user: sef@ still sees it");
  await go(yk, `${BASE}/duyurular`);
  check(
    (await listItem(yk, a1.id).locator("[data-testid=announcement-reads]").textContent()) === `Okuyan: 1/${activeIds.length - 1}`,
    "Okuyan counts the read",
  );

  // --- parts audience (conductor, S + T)
  const partsAudience = active.filter((u) => u.role !== "member" || ["soprano", "tenor"].includes(u.voice_part)).map((u) => u.id);
  const text2 = await compose(sef, { title: T2, body: "Cumartesi 14:00, küçük salon.", parts: ["soprano", "tenor"] });
  check(text2.includes(`${partsAudience.length - 1} kişiye bildirim gidecek.`), `parts: the confirm counts S + T + managers (${text2})`);
  const a2 = await one("select * from announcements where title = ?", [T2]);
  const parts2 = (await all("select voice_part from announcement_parts where announcement_id = ? order by voice_part", [a2.id])).map((r) => r.voice_part);
  check(a2.audience === "parts" && parts2.join() === "soprano,tenor", `parts rows stored (${parts2})`);
  const p2 = await pushesOf(a2.id);
  check(
    sameSet(p2.map((p) => p.user_id), partsAudience.filter((id) => id !== sefId)) && p2.some((p) => p.user_id === ykId) && !p2.some((p) => p.user_id === koristId),
    `parts reach only sopranos, tenors and managers (${p2.length})`,
  );
  await go(korist, `${BASE}/duyurular`);
  check(
    (await listItem(korist, a2.id).count()) === 0 && (await listItem(korist, a1.id).count()) === 1,
    "an alto doesn't see the S + T announcement in the list",
  );
  await go(korist, `${BASE}/`);
  check((await homeItem(korist, a2.id).count()) === 0, "nor on the home page");
  const elif = await loginAs(browser, "elif.yildiz@arkhe.local", { phone: true });
  check((await homeItem(elif, a2.id).count()) === 1, "a soprano sees it on the home page");
  await elif.context().close();

  // --- refusals for a member
  const ids = await actions(a1.id);
  check(Boolean(ids.createAnnouncement && ids.updateAnnouncement && ids.deleteAnnouncement && ids.markAnnouncementRead), "all four actions are in the manifest");
  const countBefore = Number((await one("select count(*) as n from announcements")).n);
  const refusedCreate = await callAction(korist, ids.createAnnouncement, [{ title: "E2E Korist duyurusu", body: "x", audience: "all", parts: [], important: true, showUntil: istanbulDate(1) }]);
  const refusedEdit = await callAction(korist, ids.updateAnnouncement, [{ id: a1.id, title: "E2E Ele geçirildi", body: "x", important: false, showUntil: istanbulDate(1), resend: true }]);
  const refusedDelete = await callAction(korist, ids.deleteAnnouncement, [a1.id]);
  const foreignRead = await callAction(korist, ids.markAnnouncementRead, [a2.id]);
  check(
    [refusedCreate, refusedEdit, refusedDelete].every((r) => r.includes(FORBIDDEN)) &&
      Number((await one("select count(*) as n from announcements")).n) === countBefore &&
      (await one("select title, deleted_at from announcements where id = ?", [a1.id])).title === T1 &&
      (await one("select deleted_at from announcements where id = ?", [a1.id])).deleted_at === null,
    "create, edit and delete refuse korist@ and change nothing",
  );
  check(
    foreignRead.includes(NOT_FOUND) && !(await one("select 1 from announcement_reads where announcement_id = ? and user_id = ?", [a2.id, koristId])),
    "korist@ can't mark an announcement not addressed to them as read",
  );
  const landing = async (path) => {
    await korist.goto(`${BASE}${path}`);
    return new URL(korist.url()).pathname;
  };
  check(
    (await landing("/duyurular/yeni")) === "/" && (await landing(`/duyurular/${a1.id}/duzenle`)) === "/",
    "korist@ is sent home from /duyurular/yeni and the edit page",
  );
  await go(korist, `${BASE}/duyurular`);
  check(
    (await korist.locator("[data-testid=announcement-new], [data-testid=announcement-edit], [data-testid=announcement-delete], [data-testid=announcement-reads]").count()) === 0,
    "korist@'s list has no Yeni duyuru, Düzenle, Sil or Okuyan",
  );

  // --- board audience, normal
  const r3 = await callAction(yk, ids.createAnnouncement, [{ title: T3, body: "Salı 20:00, çevrim içi.", audience: "board", parts: ["alto"], important: false, showUntil: istanbulDate(3) }]);
  const a3 = await one("select * from announcements where title = ?", [T3]);
  const p3 = await pushesOf(a3?.id);
  // Other suites may leave extra managers with devices: check roles, not a fixed count.
  const managerIds = (await all("select id from users where role in ('conductor', 'board') and is_active = 1")).map((r) => r.id);
  check(
    r3.includes('"ok":true') && a3.audience === "board" && !(await one("select 1 from announcement_parts where announcement_id = ?", [a3.id])) &&
      p3.length >= 1 && p3.some((r) => r.user_id === sefId) &&
      p3.every((r) => managerIds.includes(r.user_id) && r.user_id !== ykId && r.group_key === "calisma"),
    `board audience reaches only the other managers; stray parts are dropped (${p3.length})`,
  );
  await go(korist, `${BASE}/duyurular`);
  check((await listItem(korist, a3.id).count()) === 0, "a member never sees a board announcement");

  // --- important: group null + urgent, delivered even with calisma switched off
  await setPref(koristId, "calisma", false);
  await compose(yk, { title: T4, body: "Bu akşamki çalışma B salonunda.", important: true });
  const a4 = await one("select * from announcements where title = ?", [T4]);
  const p4 = await pushesOf(a4.id);
  const koristP4 = p4.find((p) => p.user_id === koristId);
  check(
    a4.important === 1 && p4.length === activeIds.length - 1 && p4.every((p) => p.group_key === null && p.urgent === 1 && p.status !== "held"),
    `important: group null, urgent, never held for quiet hours (${p4.length})`,
  );
  check(Boolean(koristP4), "important reaches korist@ with calisma switched off");
  const r5 = await callAction(yk, ids.createAnnouncement, [{ title: T5, body: "Normal bir duyuru.", audience: "all", parts: [], important: false, showUntil: istanbulDate(2) }]);
  const a5 = await one("select * from announcements where title = ?", [T5]);
  const p5 = await pushesOf(a5.id);
  check(r5.includes('"ok":true') && !p5.some((p) => p.user_id === koristId) && p5.length === activeIds.length - 2, "a normal one respects the calisma switch");
  await go(korist, `${BASE}/`);
  check((await homeItem(korist, a4.id).getAttribute("data-important")) === "true", "the important card is marked (red tokens)");
  check((await homeItem(korist, a4.id).locator("[data-testid=announcement-important]").textContent())?.includes("Acil"), "with the Acil chip");

  // --- home: at most 3, then "N duyuru daha"; sef@ has a1, a3, a4, a5 unread
  await go(sef, `${BASE}/`);
  const shown = await sef.locator("[data-testid=home-announcement]").evaluateAll((els) => els.map((e) => e.dataset.id));
  check(
    shown.length === 3 && shown[0] === a5.id && shown.includes(a4.id) && shown.includes(a3.id) &&
      (await sef.locator("[data-testid=home-announcements-more]").textContent()) === "1 duyuru daha",
    `home shows the newest 3 and "1 duyuru daha" (${shown.length})`,
  );

  // --- edit without a resend: no push
  const before1 = (await pushesOf(a1.id)).length;
  await go(yk, `${BASE}/duyurular/${a1.id}/duzenle`);
  check((await yk.locator("[data-testid=announcement-audience]").textContent()).includes("Herkes") && (await yk.locator("input[name=audience]").count()) === 0, "the audience can't be changed on edit");
  await yk.fill("input[name=title]", `${T1} 18:00`);
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.waitForURL(/\/duyurular#/);
  await yk.waitForTimeout(500);
  check(
    (await one("select title from announcements where id = ?", [a1.id])).title === `${T1} 18:00` &&
      (await pushesOf(a1.id)).length === before1 && (await pushesOf(a1.id, true)).length === 0,
    "an edit without Değişikliği tekrar bildir sends nothing",
  );
  // --- edit with a resend
  await go(yk, `${BASE}/duyurular/${a1.id}/duzenle`);
  await yk.locator("input[name=resend]").check();
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  const dialog = yk.getByRole("alertdialog");
  await dialog.waitFor();
  const resendText = await dialog.textContent();
  await dialog.getByRole("button", { name: "Kaydet ve bildir" }).click();
  await yk.waitForURL(/\/duyurular#/);
  const upd = await pushesOf(a1.id, true);
  check(
    resendText.includes(`${activeIds.length - 1} kişiye bildirim gidecek.`) &&
      upd.length === activeIds.length - 2 && // korist@ has calisma off
      upd.every((p) => p.title === "Duyuru güncellendi" && p.body.startsWith(`${T1} 18:00: Lütfen`) && /^duyuru-[0-9a-f-]{36}-\d+$/.test(p.dedupe_key)),
    `with the box ticked the update is sent as Duyuru güncellendi (${upd.length})`,
  );

  // --- show_until in the past: off the home page, still in the list
  await db.execute({ sql: "update announcements set show_until = ? where id = ?", args: [istanbulDate(-1), a4.id] });
  await go(korist, `${BASE}/`);
  check((await homeItem(korist, a4.id).count()) === 0, "a past show_until hides the home card");
  await go(korist, `${BASE}/duyurular`);
  check((await listItem(korist, a4.id).count()) === 1, "but keeps it in the list");
  const pastEdit = await callAction(yk, ids.updateAnnouncement, [{ id: a4.id, title: T4, body: "Bu akşamki çalışma B salonunda.", important: true, showUntil: istanbulDate(-1), resend: false }]);
  const farEdit = await callAction(yk, ids.updateAnnouncement, [{ id: a4.id, title: T4, body: "x", important: true, showUntil: istanbulDate(61), resend: false }]);
  check(pastEdit.includes('"ok":true') && farEdit.includes("en fazla 60 gün"), "an edit may keep a past day but not go past today + 60");

  // --- delete (soft) from the list with confirm
  await go(yk, `${BASE}/duyurular`);
  await listItem(yk, a1.id).locator("[data-testid=announcement-delete]").click();
  const del = yk.getByRole("alertdialog");
  await del.waitFor();
  await del.getByRole("button", { name: "Sil", exact: true }).click();
  await listItem(yk, a1.id).waitFor({ state: "detached" });
  check((await one("select deleted_at from announcements where id = ?", [a1.id])).deleted_at !== null, "delete is a soft delete");
  await go(sef, `${BASE}/`);
  await go(korist, `${BASE}/duyurular`);
  check((await homeItem(sef, a1.id).count()) === 0 && (await listItem(korist, a1.id).count()) === 0, "a deleted announcement leaves the home card and the list");
  const readDeleted = await callAction(sef, ids.markAnnouncementRead, [a1.id]);
  check(readDeleted.includes(NOT_FOUND), "a deleted announcement can't be marked read");

  // --- validation and rate limit (20 a day per manager)
  const bad = await callAction(yk, ids.createAnnouncement, [{ title: "  ab ", body: "   ", audience: "parts", parts: [], important: false, showUntil: istanbulDate(61) }]);
  check(bad.includes("en az 3 karakter") && bad.includes("Duyuru metnini yaz."), "short title and empty text are refused");
  const noParts = await callAction(yk, ids.createAnnouncement, [{ title: "E2E Partisyonsuz", body: "x", audience: "parts", parts: [], important: false, showUntil: istanbulDate(1) }]);
  check(noParts.includes("En az bir partisyon seç."), "parts without a part is refused");
  const used = Number((await one("select count(*) as n from login_attempts where key = ?", [`announcement:${ykId}`])).n);
  for (let i = used; i < 20; i++) {
    await db.execute({ sql: "insert into login_attempts (key) values (?)", args: [`announcement:${ykId}`] });
  }
  const n0 = Number((await one("select count(*) as n from announcements where created_by = ?", [ykId])).n);
  const limited = await callAction(yk, ids.createAnnouncement, [{ title: "E2E Yirmi birinci", body: "x", audience: "all", parts: [], important: false, showUntil: istanbulDate(1) }]);
  check(
    limited.includes("Bugün çok fazla duyuru gönderdin.") && Number((await one("select count(*) as n from announcements where created_by = ?", [ykId])).n) === n0,
    "the 21st announcement of the day is refused",
  );
  const sefOk = await callAction(sef, ids.createAnnouncement, [{ title: "E2E Şefin duyurusu", body: "x", audience: "board", parts: [], important: false, showUntil: istanbulDate(1) }]);
  check(sefOk.includes('"ok":true'), "the limit is per manager");

  // --- 375 px layout and axe, light and dark
  await go(yk, `${BASE}/duyurular/yeni`);
  await yk.locator("label:has(input[name=audience][value=parts])").click();
  await yk.locator("input[name=important]").check();
  const composeIssues = [...(await axe(yk, "main")), ...(await layoutIssues(yk))];
  await go(yk, `${BASE}/duyurular`);
  const listIssues = [...(await axe(yk, "main")), ...(await layoutIssues(yk))];
  check(composeIssues.length === 0 && listIssues.length === 0, `compose and list are clean at 375 px (${[...composeIssues, ...listIssues]})`);
  await db.execute({ sql: "update announcements set show_until = ? where id = ?", args: [istanbulDate(1), a4.id] });
  const homeIssues = {};
  for (const scheme of ["light", "dark"]) {
    const p = await as(browser, "korist@arkhe.local", { phone: true, scheme });
    await homeItem(p, a4.id).waitFor();
    homeIssues[scheme] = [...(await axe(p, "[data-testid=home-announcements]")), ...(await layoutIssues(p, "[data-testid=home-announcements]"))];
    await p.context().close();
  }
  check(homeIssues.light.length === 0 && homeIssues.dark.length === 0, `the home card (important and normal) is clean in both themes (${homeIssues.light} | ${homeIssues.dark})`);

  // --- entry points
  await go(korist, `${BASE}/profil`);
  check((await korist.locator("[data-testid=profile-announcements] a[href='/duyurular']").count()) === 1, "Profil has a Duyurular row");
  const desk = await loginAs(browser, "korist@arkhe.local");
  check((await desk.locator("aside a[href='/duyurular']").count()) === 1, "the desktop sidebar has Duyurular");
  const bar = await korist.locator("nav.fixed[aria-label='Ana menü'] a[href='/duyurular']").count();
  check(bar === 0, "the mobile bottom bar stays as it was");

  for (const p of [yk, korist, sef, desk]) await p.context().close();
  await reset();
  await resetPush();
}
