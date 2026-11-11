// Phase 19: calendar feed, per-singer piece readiness, practice notes, concert sign-up.
import { request } from "playwright-core";
import { BASE, check, db, insertRehearsal, loginAs, markOf, userId } from "./lib.mjs";
import { newPiece } from "./omr.mjs";
import { addDevice, resetPush } from "./push.mjs";

const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] ?? null;

export default async function run(browser) {
  await calendarFeed(browser);
  await readiness(browser);
  await resetPush();
  try {
    await practiceNotes(browser);
  } finally {
    await resetPush();
  }
  await concert(browser);
}

async function calendarFeed(browser) {
  const tutti = await insertRehearsal({ title: "E2E Takvim Tutti", startOffsetMin: 4 * 1440 });
  const tenors = await insertRehearsal({
    title: "E2E Takvim Tenor",
    startOffsetMin: 5 * 1440,
    type: "sectional",
    parts: ["tenor"],
  });
  const off = await insertRehearsal({ title: "E2E Takvim İptal", startOffsetMin: 6 * 1440 });
  await db.execute({ sql: "update rehearsals set cancelled_at = unixepoch() where id = ?", args: [off] });
  await db.execute({ sql: "delete from calendar_feeds where user_id = ?", args: [await userId("korist@arkhe.local")] });

  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  await korist.goto(`${BASE}/profil`);
  await korist.getByRole("button", { name: "Takvim bağlantımı oluştur" }).click();
  const webcal = await korist.getByTestId("calendar-webcal").getAttribute("href");
  check(/^webcal:\/\/.+\/api\/takvim\/[A-Za-z0-9_-]{43}\.ics$/.test(webcal), `the profile offers a webcal link (${webcal})`);
  const url = `${BASE}${new URL(webcal.replace(/^webcal:/, "http:")).pathname}`;

  const anon = await request.newContext();
  const res = await anon.get(url);
  const ics = await res.text();
  check(res.status() === 200 && res.headers()["content-type"].startsWith("text/calendar"), "the feed answers without a session");
  check(ics.includes(`UID:${tutti}@koroarkhe`) && ics.includes("SUMMARY:Arkhe · E2E Takvim Tutti"), "the feed lists my rehearsal");
  check(!ics.includes(tenors), "a sectional for another part is left out");
  const offEvent = ics.split("BEGIN:VEVENT").find((e) => e.includes(`UID:${off}@`)) ?? "";
  check(offEvent.includes("SUMMARY:İPTAL: Arkhe · E2E Takvim İptal") && offEvent.includes("STATUS:CANCELLED"), `a cancelled rehearsal stays, marked cancelled (${JSON.stringify(offEvent.slice(0, 200))})`);
  check(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "lines are folded at 75 octets");
  check((await korist.getByTestId("calendar-feed").count()) === 1, "the link stays on the profile");

  await korist.reload();
  check((await korist.getByTestId("calendar-webcal").getAttribute("href")) === webcal, "the same link shows again after a reload");
  await korist.getByRole("button", { name: "Bağlantıyı yenile" }).click();
  await korist.getByRole("button", { name: "Yenile", exact: true }).click();
  await korist.waitForFunction((old) => document.querySelector("[data-testid=calendar-webcal]")?.getAttribute("href") !== old, webcal);
  const renewed = await korist.getByTestId("calendar-webcal").getAttribute("href");
  check((await anon.get(url)).status() === 404, "the old link stops working after Yenile");
  const fresh = `${BASE}${new URL(renewed.replace(/^webcal:/, "http:")).pathname}`;
  check((await anon.get(fresh)).status() === 200, "the new link works");
  check((await anon.get(`${BASE}/api/takvim/${"x".repeat(43)}.ics`)).status() === 404, "an unknown token is 404");

  await db.execute({ sql: "update users set is_active = 0, left_at = unixepoch() where email = 'korist@arkhe.local'" });
  const left = (await anon.get(fresh)).status();
  await db.execute({ sql: "update users set is_active = 1, left_at = null where email = 'korist@arkhe.local'" });
  check(left === 404, "a member who left gets nothing");
  await anon.dispose();
  await korist.context().close();
}

async function readiness(browser) {
  const piece = await newPiece("E2E Hazırlık Eseri");
  await db.execute({
    sql: "insert into piece_readiness (piece_id, user_id, level) values (?, ?, 'not_ready')",
    args: [piece, await userId("elif.yildiz@arkhe.local")],
  });
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  await korist.goto(`${BASE}/`);
  check((await korist.getByTestId("readiness-nudge").textContent()).includes("henüz işaretlemedin"), "home nudges unmarked pieces");
  await korist.goto(`${BASE}/repertuvar/${piece}`);
  const picker = korist.getByTestId("readiness-picker");
  const level = async () => (await one("select level from piece_readiness where piece_id = ? and user_id = ?", [piece, await userId("korist@arkhe.local")]))?.level ?? null;
  const waitLevel = async (want) => {
    for (let i = 0; i < 40 && (await level()) !== want; i++) await korist.waitForTimeout(100);
    return level();
  };
  await picker.getByRole("button", { name: "Kısmen" }).click();
  check((await waitLevel("partial")) === "partial", "Kısmen is saved");
  await picker.getByRole("button", { name: "Kısmen" }).click();
  check((await waitLevel(null)) === null, "tapping it again clears it");
  await picker.getByRole("button", { name: "Hazırım" }).click();
  check((await waitLevel("ready")) === "ready", "Hazırım is saved");
  await korist.reload();
  check((await picker.getByRole("button", { name: "Hazırım" }).getAttribute("aria-pressed")) === "true", "the choice shows after a reload");
  check((await korist.getByTestId("readiness-summary").count()) === 0, "a member sees no part summary");
  await korist.goto(`${BASE}/raporlar/hazirlik`);
  check(!korist.url().includes("/raporlar/hazirlik"), "a member can't open the readiness report");

  const sef = await loginAs(browser, "sef@arkhe.local");
  await sef.goto(`${BASE}/repertuvar/${piece}`);
  check((await sef.getByTestId("readiness-picker").count()) === 0, "the conductor gets no picker");
  const partText = (page, part) => page.locator(`[data-testid=readiness-summary] [data-part=${part}] [data-testid=readiness-text]`).textContent();
  check((await partText(sef, "alto")).startsWith("1 hazır ·"), `alto shows korist ready (${await partText(sef, "alto")})`);
  check((await partText(sef, "soprano")).startsWith("1 hazır değil ·"), "soprano shows Elif not ready");
  await sef.goto(`${BASE}/raporlar`);
  await sef.getByRole("link", { name: "Eser hazırlığı" }).click();
  await sef.waitForURL(`${BASE}/raporlar/hazirlik`);
  const card = sef.locator(`[data-testid=readiness-piece][data-piece="${piece}"]`);
  check((await card.locator("[data-part=alto] [data-testid=readiness-text]").textContent()).includes("1 hazır ·"), "the report lists the piece by part");

  await db.execute({ sql: "update pieces set status = 'archive', program_position = null where id = ?", args: [piece] });
  await korist.goto(`${BASE}/repertuvar/${piece}`);
  check((await korist.getByTestId("readiness-picker").count()) === 0, "an archived piece asks nothing");
  await sef.goto(`${BASE}/raporlar/hazirlik`);
  check((await card.count()) === 0, "the report leaves archived pieces out");
  await korist.context().close();
  await sef.context().close();
}

async function practiceNotes(browser) {
  const rehearsal = await insertRehearsal({ title: "E2E Not Çalışması", startOffsetMin: -1440 });
  const piece = await newPiece("E2E Not Eseri");
  for (const email of ["korist@arkhe.local", "can.erdogan@arkhe.local", "sef@arkhe.local", "elif.yildiz@arkhe.local"]) {
    await addDevice(await userId(email));
  }
  const sef = await loginAs(browser, "sef@arkhe.local");
  await sef.goto(`${BASE}/calismalar/${rehearsal}`);
  await sef.getByRole("button", { name: "Not ekle" }).click();
  await sef.getByLabel("Eser").selectOption(piece);
  await sef.getByLabel("Not", { exact: true }).fill("E2E 12–28. ölçüler, girişe dikkat.");
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef.getByTestId("practice-note").first().waitFor();
  const note = await one("select id, voice_part from practice_notes where rehearsal_id = ?", [rehearsal]);
  check(note && note.voice_part === null, "the conductor's note is for everyone");
  const pushed = await db.execute({ sql: "select u.email from notifications n join users u on u.id = n.user_id where n.dedupe_key = ?", args: [`practice_note-${note.id}`] });
  const emails = pushed.rows.map((r) => r.email);
  check(emails.includes("korist@arkhe.local") && emails.includes("can.erdogan@arkhe.local") && !emails.includes("sef@arkhe.local"), `everyone but the author is notified (${emails.length})`);

  const asistan = await loginAs(browser, "asistan@arkhe.local");
  await asistan.goto(`${BASE}/calismalar/${rehearsal}`);
  await asistan.getByRole("button", { name: "Not ekle" }).click();
  const options = await asistan.getByLabel("Kime").locator("option").allTextContents();
  check(options.join(",") === "Soprano,Alto", `an assistant writes only to their parts (${options})`);
  await asistan.getByLabel("Kime").selectOption("alto");
  await asistan.getByLabel("Not", { exact: true }).fill("E2E Altolar: 40. ölçü nefes.");
  await asistan.getByLabel("İlgili koristlere bildirim gönder").uncheck();
  await asistan.getByRole("button", { name: "Kaydet" }).click();
  await asistan.getByTestId("practice-note").nth(1).waitFor();
  const altoNote = await one("select id from practice_notes where rehearsal_id = ? and voice_part = 'alto'", [rehearsal]);
  check((await one("select count(*) as n from notifications where dedupe_key = ?", [`practice_note-${altoNote.id}`])).n === 0, "unticked, nobody is notified");

  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  const homeNotes = await korist.getByTestId("home-notes").textContent();
  check(homeNotes.includes("girişe dikkat") && homeNotes.includes("40. ölçü nefes"), "an alto sees both notes on home");
  await korist.goto(`${BASE}/calismalar/${rehearsal}`);
  check((await korist.getByRole("button", { name: "Not ekle" }).count()) === 0, "a member can't add notes");
  check((await korist.getByRole("button", { name: "Notu sil" }).count()) === 0, "a member can't delete notes");
  await korist.goto(`${BASE}/repertuvar/${piece}`);
  check((await korist.getByTestId("piece-practice-notes").textContent()).includes("girişe dikkat"), "the piece page shows its notes");

  const tenor = await loginAs(browser, "can.erdogan@arkhe.local", { mobile: true });
  await tenor.goto(`${BASE}/calismalar/${rehearsal}`);
  const tenorNotes = await tenor.getByTestId("practice-note").allTextContents();
  check(tenorNotes.length === 1 && tenorNotes[0].includes("girişe dikkat"), "a tenor doesn't see the alto note");

  await asistan.reload();
  const own = asistan.getByTestId("practice-note").filter({ hasText: "40. ölçü nefes" });
  check((await asistan.getByRole("button", { name: "Notu sil" }).count()) === 1, "an assistant can delete only their own note");
  await own.getByRole("button", { name: "Notu sil" }).click();
  await asistan.getByRole("button", { name: "Sil", exact: true }).click();
  await own.waitFor({ state: "detached" });
  check((await one("select count(*) as n from practice_notes where rehearsal_id = ?", [rehearsal])).n === 1, "the note is deleted");

  for (const p of [sef, asistan, korist, tenor]) await p.context().close();
}

async function concert(browser) {
  const show = await insertRehearsal({ title: "E2E Konser", startOffsetMin: 20 * 1440, type: "concert" });
  await db.execute({
    sql: "insert into attendance (rehearsal_id, user_id, status, method, note, recorded_by) values (?, ?, 'excused', 'self', 'Yurt dışındayım', ?)",
    args: [show, await userId("elif.yildiz@arkhe.local"), await userId("elif.yildiz@arkhe.local")],
  });
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  check((await korist.getByTestId("concert-prompt").textContent()).includes("E2E Konser"), "home asks about the concert");
  await korist.goto(`${BASE}/calismalar/${show}`);
  const panel = korist.getByTestId("concert-answer");
  await panel.getByRole("button", { name: "Söyleyeceğim" }).click();
  await panel.getByText("Bu konserde söyleyeceksin").waitFor();
  const signup = async () => (await one("select count(*) as n from concert_signups where rehearsal_id = ? and user_id = ?", [show, await userId("korist@arkhe.local")])).n;
  check((await signup()) === 1, "Söyleyeceğim is saved");

  await panel.getByRole("button", { name: "Söyleyemeyeceğim" }).click();
  await korist.getByRole("dialog").getByRole("button", { name: "Bildir" }).click();
  await korist.getByText("Söyleyemeyeceğini bildirdin").waitFor();
  check((await signup()) === 0 && (await markOf(show, "korist@arkhe.local"))?.method === "self", "saying no replaces the yes with an excuse");
  await korist.getByRole("button", { name: "Geri al" }).click();
  await korist.getByText("Bu konserde söyleyecek misin?").waitFor();
  check((await korist.getByRole("dialog").count()) === 0, "withdrawing doesn't reopen the excuse dialog");
  await panel.getByRole("button", { name: "Söyleyeceğim" }).click();
  await panel.getByText("Bu konserde söyleyeceksin").waitFor();
  check((await signup()) === 1 && (await markOf(show, "korist@arkhe.local")) === null, "yes again clears the excuse");
  await korist.goto(`${BASE}/`);
  check(!((await korist.getByTestId("concert-prompt").textContent().catch(() => "")) ?? "").includes("E2E Konser"), "an answered concert leaves the home prompt");

  const sef = await loginAs(browser, "sef@arkhe.local");
  await sef.goto(`${BASE}/calismalar/${show}`);
  const count = (part) => sef.locator(`[data-testid=concert-lineup] [data-part=${part}] [data-testid=lineup-count]`).textContent();
  check((await count("alto")).startsWith("1 evet · 0 hayır"), `alto lineup counts korist (${await count("alto")})`);
  check((await count("soprano")).startsWith("0 evet · 1 hayır"), "soprano lineup counts Elif's no");
  check((await sef.getByTestId("concert-lineup").textContent()).includes("Yurt dışındayım"), "the reason shows to managers");

  const plain = await insertRehearsal({ title: "E2E Konser Değil", startOffsetMin: 21 * 1440 });
  await korist.goto(`${BASE}/calismalar/${plain}`);
  check((await korist.getByTestId("concert-answer").count()) === 0 && (await korist.getByRole("button", { name: "Gelemeyeceğim" }).count()) === 1, "a rehearsal keeps the plain excuse");
  await korist.context().close();
  await sef.context().close();
}
