// Phase 15 A: sub-parts (Bas 1 / Bas 2). Profile + home prompt, the member form, which rehearsal
// audio is "mine", section-only homework (visibility, form note, push audience).
import { BASE, check, cleanup, db } from "./lib.mjs";
import { actionIds, as, callAction, goto, scalar, text } from "./board.mjs";
import { createUser, go, insertAssignment, micPage, wavBytes } from "./media.mjs";
import { addDevice, resetPush, rowsOf, setPref, until } from "./push.mjs";

const KORIST = "korist@arkhe.local";
const SECTION_ACTIONS = "src/app/(portal)/profil/section-actions.ts";
const B1 = "bas1@e2e.test";
const B2 = "bas2@e2e.test";
const BX = "basx@e2e.test";

const sectionOf = (email) => scalar("select voice_section from users where email = ?", [email]);

async function uploadAudio(page, pieceId, part, section, seconds) {
  const q = new URLSearchParams({ eser: pieceId, ses: part });
  if (section !== null) q.set("alt", String(section));
  const res = await page.request.post(`${BASE}/api/dosya/ses?${q}`, {
    headers: {
      Origin: BASE,
      "X-Upload-Id": crypto.randomUUID(),
      "Content-Type": "application/octet-stream",
    },
    data: wavBytes({ seconds, hz: 330, rate: 8000 }),
    failOnStatusCode: false,
  });
  return res.status();
}

export default async function run(browser) {
  await cleanup();
  try {
    await suite(browser);
  } finally {
    await db.execute({ sql: "update users set voice_section = null where email = ?", args: [KORIST] });
    await resetPush();
    await cleanup();
  }
}

async function suite(browser) {
  await profileAndPrompt(browser);
  await memberForm(browser);
  const ids = {
    b1: await createUser(B1, "E2E Bas Bir", { part: "bass" }),
    b2: await createUser(B2, "E2E Bas İki", { part: "bass" }),
    bx: await createUser(BX, "E2E Bas Belirsiz", { part: "bass" }),
  };
  await db.execute({ sql: "update users set voice_section = 1 where id = ?", args: [ids.b1] });
  await db.execute({ sql: "update users set voice_section = 2 where id = ?", args: [ids.b2] });
  await audioPick(browser);
  await sectionHomework(browser, ids);
}

// ------------------------------------------------------------------ profile and home prompt
async function profileAndPrompt(browser) {
  await db.execute({ sql: "update users set voice_section = null where email = ?", args: [KORIST] });
  const korist = await as(browser, KORIST, { phone: true });
  const prompt = korist.getByTestId("section-prompt");
  check(
    (await prompt.isVisible()) &&
      (await text(prompt.locator("h2"))) === "Alt partisyonunu seç: Alto 1 mi Alto 2 mi?",
    "sections: the home prompt asks Alto 1 or Alto 2 while no sub-part is set",
  );
  await prompt.getByRole("button", { name: "Alto 2" }).click();
  await prompt.waitFor({ state: "detached", timeout: 10000 });
  check((await sectionOf(KORIST)) === 2, "sections: one tap on the prompt saves Alto 2");
  check(
    (await text(korist.locator("header a[aria-label=Profilim]"))).includes("Alto 2"),
    "sections: the header badge reads Alto 2",
  );

  await goto(korist, "/profil");
  const picker = korist.getByTestId("section-picker");
  check(
    (await picker.getByRole("button", { name: "Alto 2" }).getAttribute("aria-pressed")) === "true" &&
      (await text(korist.locator("main h1 + div"))).includes("Alto 2"),
    "sections: Profil shows Alto 2 selected and in the badge",
  );
  await picker.getByRole("button", { name: "Alto 1" }).click();
  await until(async () => (await sectionOf(KORIST)) === 1);
  check((await sectionOf(KORIST)) === 1, "sections: Profil switches to Alto 1");
  await picker.getByRole("button", { name: "Bilmiyorum" }).click();
  await until(async () => (await sectionOf(KORIST)) === null);
  check((await sectionOf(KORIST)) === null, "sections: Bilmiyorum clears the sub-part");
  await goto(korist, "/");
  check(await korist.getByTestId("section-prompt").isVisible(), "sections: the prompt is back");

  const ids = await actionIds(SECTION_ACTIONS);
  await callAction(korist, ids.setMySection, [3]);
  check((await sectionOf(KORIST)) === null, "sections: an out-of-range value is refused");
  await korist.context().close();

  // The conductor has no part: no prompt, no picker, and the action changes nothing.
  const sef = await as(browser, "sef@arkhe.local");
  check(
    (await sef.getByTestId("section-prompt").count()) === 0,
    "sections: no home prompt for the conductor",
  );
  await goto(sef, "/profil");
  check((await sef.getByTestId("section-picker").count()) === 0, "sections: no picker without a part");
  await callAction(sef, ids.setMySection, [1]);
  check(
    (await scalar("select voice_section from users where email = 'sef@arkhe.local'")) === null,
    "sections: the action ignores a user without a voice part",
  );
  await sef.context().close();

  // A singer who already picked sees no prompt.
  const ozan = await as(browser, "ozan.yilmaz@arkhe.local", { phone: true });
  check(
    (await ozan.getByTestId("section-prompt").count()) === 0 &&
      (await text(ozan.locator("header a[aria-label=Profilim]"))).includes("Bas 1"),
    "sections: Bas 1 sees no prompt and Bas 1 in the header",
  );
  await ozan.context().close();
}

// ------------------------------------------------------------------ manager member form
async function memberForm(browser) {
  const id = await createUser("uye-alt@e2e.test", "E2E Alt Partisyon", { part: "tenor" });
  await db.execute({ sql: "update users set voice_section = 2 where id = ?", args: [id] });
  const yk = await as(browser, "yk@arkhe.local");
  await go(yk, `${BASE}/uyeler/${id}`);
  const sectionGroup = () => yk.locator("fieldset", { has: yk.getByText("Alt partisyon", { exact: true }) });
  check(
    await sectionGroup().getByRole("radio", { name: "Tenor 2" }).isChecked(),
    "sections: the member form shows Tenor 2",
  );
  // Same part, untouched sub-part: the singer's own choice made meanwhile survives the save.
  await db.execute({ sql: "update users set voice_section = 1 where id = ?", args: [id] });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.getByText("Değişiklikler kaydedildi.").waitFor({ timeout: 10000 });
  check(
    (await scalar("select voice_section from users where id = ?", [id])) === 1,
    "sections: saving other fields keeps the sub-part the singer picked meanwhile",
  );

  await go(yk, `${BASE}/uyeler/${id}`);
  await yk.getByRole("radio", { name: "Bas", exact: true }).check({ force: true });
  check(
    (await sectionGroup().getByRole("radio", { name: "Bilinmiyor" }).isChecked()) &&
      (await sectionGroup().getByRole("radio", { name: "Bas 1" }).count()) === 1,
    "sections: changing the part clears the sub-part field and relabels it",
  );
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.getByText("Değişiklikler kaydedildi.").waitFor({ timeout: 10000 });
  let row = (await db.execute({ sql: "select voice_part, voice_section from users where id = ?", args: [id] })).rows[0];
  check(row.voice_part === "bass" && row.voice_section === null, "sections: part change saved with the sub-part cleared");

  await go(yk, `${BASE}/uyeler/${id}`);
  await sectionGroup().getByRole("radio", { name: "Bas 2" }).check({ force: true });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.getByText("Değişiklikler kaydedildi.").waitFor({ timeout: 10000 });
  check((await scalar("select voice_section from users where id = ?", [id])) === 2, "sections: a manager sets Bas 2");

  await go(yk, `${BASE}/uyeler/${id}`);
  await yk.getByRole("radio", { name: "Yok (sadece şef)" }).check({ force: true });
  check(
    (await sectionGroup().count()) === 0,
    "sections: without a part the sub-part field is hidden",
  );
  await yk.context().close();
}

// ------------------------------------------------------------------ which audio is mine
async function audioPick(browser) {
  const hw = await insertAssignment({ dueDays: 3, parts: ["bass"], title: "E2E Alt Ses" });
  const sef = await as(browser, "sef@arkhe.local");
  check((await uploadAudio(sef, hw.piece, "bass", 3, 2)) === 400, "sections: alt=3 is refused");
  check((await uploadAudio(sef, hw.piece, "bass", 1, 2)) === 201, "sections: Bas 1 audio uploads");
  check((await uploadAudio(sef, hw.piece, "tutti", 1, 2)) === 201, "sections: a Tutti upload with alt uploads");
  check(
    (await scalar("select count(*) from piece_audio where piece_id = ? and voice_part is null and section is null", [hw.piece])) === 1 &&
      (await scalar("select section from piece_audio where piece_id = ? and voice_part = 'bass'", [hw.piece])) === 1,
    "sections: stored as Bas 1; Tutti never keeps a sub-part",
  );

  const heroOf = async (page) => text(page.getByTestId("audio-hero-source"));
  const b2 = await as(browser, B2, { phone: true });
  await goto(b2, `/repertuvar/${hw.piece}`);
  check((await heroOf(b2)).startsWith("Bas 1."), "sections: with only Bas 1, Bas 2 falls back to Bas 1");

  check((await uploadAudio(sef, hw.piece, "bass", 2, 2)) === 201, "sections: Bas 2 audio uploads");
  check((await uploadAudio(sef, hw.piece, "bass", null, 2)) === 201, "sections: whole-part Bas audio uploads");
  await goto(b2, `/repertuvar/${hw.piece}`);
  check((await heroOf(b2)).startsWith("Bas 2."), "sections: Bas 2 hears Bas 2");
  const order = await b2
    .locator("[data-testid=audio-row][data-part=bass]")
    .evaluateAll((rows) => rows.map((r) => r.dataset.section));
  check(JSON.stringify(order) === JSON.stringify(["2", "", "1"]), `sections: own sub-part first in the list (${order})`);

  const b1 = await as(browser, B1, { phone: true });
  await goto(b1, `/repertuvar/${hw.piece}`);
  check((await heroOf(b1)).startsWith("Bas 1."), "sections: Bas 1 hears Bas 1");
  const bx = await as(browser, BX, { phone: true });
  await goto(bx, `/repertuvar/${hw.piece}`);
  check((await heroOf(bx)).startsWith("Bas."), "sections: without a sub-part the whole-part file wins");
  await db.execute({ sql: "delete from piece_audio where piece_id = ? and voice_part = 'bass' and section is null", args: [hw.piece] });
  await goto(bx, `/repertuvar/${hw.piece}`);
  check((await heroOf(bx)).startsWith("Bas 1."), "sections: without a sub-part or a whole-part file, Bas 1 comes first");

  // The homework's play-along Partisyon button picks the same file.
  const mic = await micPage(browser, B2);
  await go(mic, `${BASE}/odevler/${hw.id}`);
  check(
    (await mic.getByTestId("along-part").getAttribute("aria-label")).startsWith("Partisyonu çal (Ses kaydı: Bas 2"),
    "sections: the homework Partisyon button plays Bas 2 for Bas 2",
  );
  await mic.context().close();

  // The manager edits a file's sub-part inline.
  const audioId = await scalar("select id from piece_audio where piece_id = ? and section = 2", [hw.piece]);
  await go(sef, `${BASE}/repertuvar/${hw.piece}/duzenle`);
  const select = sef.getByRole("combobox", { name: "Bas 2 için alt partisyon" });
  await select.selectOption("");
  await until(async () => (await scalar("select section from piece_audio where id = ?", [audioId])) === null);
  check(
    (await scalar("select section from piece_audio where id = ?", [audioId])) === null,
    "sections: the editor sets an existing file to the whole part",
  );
  for (const p of [sef, b1, b2, bx]) await p.context().close();
}

// ------------------------------------------------------------------ section-only homework
async function sectionHomework(browser, ids) {
  const hw = await insertAssignment({ dueDays: 4, parts: ["bass:1", "alto"], title: "E2E Bas Bir Ödevi" });
  const listed = async (email) => {
    const page = await as(browser, email, { phone: true });
    await goto(page, "/odevler");
    const seen = (await page.getByText("E2E Bas Bir Ödevi").count()) > 0;
    await goto(page, `/odevler/${hw.id}`);
    const note = await page.getByTestId("not-my-part").count() ? await text(page.getByTestId("not-my-part")) : "";
    const header = await text(page.locator("main header"));
    await page.context().close();
    return { seen, note, header };
  };
  const one = await listed(B1);
  const two = await listed(B2);
  const unset = await listed(BX);
  check(one.seen && one.header.includes("Bas 1") && !one.note, "sections: Bas 1 sees the Bas 1 homework, labelled Bas 1");
  check(!two.seen && two.note === "Bu ödev senin partisyonun için değil.", "sections: Bas 2 doesn't see it");
  check(
    !unset.seen && unset.note.startsWith("Bu ödev Bas 1 için. Alt partisyonunu Profil"),
    "sections: a bass without a sub-part doesn't see it and is pointed to Profil",
  );

  // The form: narrowing Bas shows how many basses have no sub-part, and saves bass:1.
  const yk = await as(browser, "yk@arkhe.local");
  await go(yk, `${BASE}/odevler/yeni?eser=${hw.piece}`);
  const missing = await scalar(
    "select count(*) from users where voice_part = 'bass' and voice_section is null and left_at is null and is_active = 1 and role in ('member','board')",
  );
  check(
    (await yk.getByTestId("unsectioned-bass").count()) === 0,
    "sections: no note while Bas is the whole part",
  );
  await yk.getByTestId("section-bass").getByText("1", { exact: true }).click();
  check(
    (await text(yk.getByTestId("unsectioned-bass"))) ===
      `Bas'ta ${missing} kişi alt partisyon seçmemiş; bu ödevi görmeyecekler.`,
    `sections: the form notes ${missing} basses without a sub-part`,
  );
  const people = (await db.execute("select id, email, voice_part, voice_section, role from users where is_active = 1 and left_at is null")).rows;
  await resetPush();
  for (const u of people) {
    await addDevice(u.id, "ok");
    await setPref(u.id, "gece", false);
  }
  await yk.getByRole("button", { name: "Ödevi ver" }).click();
  await yk.waitForURL(/\/odevler\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const created = yk.url().split("/").pop();
  const rows = (await db.execute({ sql: "select voice_part, section from assignment_parts where assignment_id = ? order by voice_part", args: [created] })).rows;
  check(
    rows.length === 4 && rows.find((r) => r.voice_part === "bass").section === 1 && rows.filter((r) => r.section === null).length === 3,
    "sections: the form stores Bas narrowed to 1, the rest whole",
  );
  check((await text(yk.locator("main header"))).includes("Bas 1"), "sections: the detail shows Bas 1");

  const want = new Set(
    people
      .filter((u) => u.role !== "conductor" && u.email !== "yk@arkhe.local" && u.voice_part && (u.voice_part !== "bass" || u.voice_section === 1))
      .map((u) => u.id),
  );
  await until(async () => (await rowsOf("kind = 'homework_new' and url = ?", [`/odevler/${created}`])).length >= want.size);
  const got = new Set((await rowsOf("kind = 'homework_new' and url = ?", [`/odevler/${created}`])).map((r) => r.user_id));
  check(
    got.size === want.size && [...want].every((x) => got.has(x)) && got.has(ids.b1) && !got.has(ids.b2) && !got.has(ids.bx),
    `sections: Yeni ödev reaches Bas 1 and the other parts, not Bas 2 or unset basses (${got.size}/${want.size})`,
  );
  await db.execute({ sql: "delete from submissions where assignment_id = ?", args: [created] });
  await db.execute({ sql: "delete from assignment_parts where assignment_id = ?", args: [created] });
  await db.execute({ sql: "delete from assignments where id = ?", args: [created] });
  await yk.context().close();
}
