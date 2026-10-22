// Phase 9 S1/S3–S5: who can hear a take (the visibility matrix), assistants and their private
// notes, the conductor's queue, badge and comment, and the leak greps.
import { HOMEWORK_IDS, seedHomework } from "../scripts/homework-fixture.mjs";
import { reconcileLocalUploads } from "../scripts/media-fixture.mjs";
import { actionIds, BASE, callAction, check, cleanup, db, loginAs, newPage, userId } from "./lib.mjs";
import {
  addDays,
  go,
  ago,
  all,
  arrangeComment,
  auditDay,
  axe,
  createUser,
  insertAssignment,
  insertNote,
  insertTake,
  istanbulDay,
  layoutIssues,
  one,
  SEED_REC,
  uploadRaw,
  wavBytes,
} from "./media.mjs";

const { a: A, b: B, d: D, f: F } = HOMEWORK_IDS;
const ASST = "src/app/(portal)/odevler/asistanlar/actions.ts";
const NOTES = "src/app/(portal)/odevler/dinle/actions.ts";
const ODEV = "src/app/(portal)/odevler/actions.ts";

async function reset() {
  const e2e = "select id from assignments where piece_id in (select id from pieces where title like 'E2E%')";
  await db.batch(
    [
      `delete from assistant_notes where assignment_id in (${e2e})`,
      `delete from submissions where assignment_id in (${e2e})`,
      `delete from assignment_parts where assignment_id in (${e2e})`,
      `delete from assignments where id in (${e2e})`,
      "delete from pieces where title like 'E2E%'",
    ],
    "write",
  );
  await seedHomework(db, new Date());
  await db.batch(
    ["delete from storage_deletions", "delete from storage_events", "delete from login_attempts where key like 'upload:%' or key like 'listen:%'"],
    "write",
  );
  await reconcileLocalUploads(db);
}

async function get(page, path, headers = {}) {
  const r = await page.request.get(`${BASE}${path}`, { headers, failOnStatusCode: false, maxRedirects: 0 });
  const body = await r.text();
  // Under a loading boundary notFound() streams the 404 page with a 200 status.
  const notFound = !path.startsWith("/api/") && body.includes("Sayfa bulunamadı");
  return { status: notFound ? 404 : r.status(), headers: r.headers(), body };
}
const html = async (page, path) => (await get(page, path)).body;
const rsc = async (page, path) => (await get(page, path, { RSC: "1" })).body;

async function reviewBadge(page) {
  const b = page.locator("[data-review-badge]:visible").first();
  return (await b.count()) ? await b.getAttribute("data-review-badge") : null;
}
async function landsOn(page, path) {
  await page.goto(`${BASE}${path}`);
  // Under the /odevler loading boundary the redirect arrives in the stream, client-side.
  await page.waitForURL((u) => u.pathname !== path, { timeout: 8000 }).catch(() => {});
  return page.url().replace(BASE, "");
}

export default async function run(browser, shots) {
  await cleanup();
  try {
    await suite(browser, shots);
  } finally {
    await cleanup();
  }
}

async function suite(browser, shots) {
  const ids = {
    korist: await userId("korist@arkhe.local"),
    asistan: await userId("asistan@arkhe.local"),
    melis: await userId("melis.aydin@arkhe.local"),
    defne: await userId("defne.arslan@arkhe.local"),
    emre: await userId("emre.aksoy@arkhe.local"),
    ayse: await userId("ayse.ozturk@arkhe.local"),
  };
  const sef = await loginAs(browser, "sef@arkhe.local");
  const yk = await loginAs(browser, "yk@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");
  const asistan = await loginAs(browser, "asistan@arkhe.local");
  const anon = await newPage(browser);

  // ------------------------------------------------------------------ AC 22 (seed counts)
  await go(asistan, `${BASE}/odevler/dinle`);
  const rows = asistan.locator("[data-testid=queue-row]");
  const names = await rows.evaluateAll((els) => els.map((e) => e.textContent));
  const sql = await one(`
    select count(*) as n from recordings r join submissions s on s.assignment_id = r.assignment_id and s.user_id = r.user_id
    join users u on u.id = r.user_id
    where r.replaced_at is null and r.audio_deleted_at is null and s.submitted_at is not null and s.feedback is null
      and u.voice_part in ('soprano', 'alto') and r.user_id <> ?
      and not exists (select 1 from assistant_notes n where n.assignment_id = r.assignment_id and n.singer_id = r.user_id
                      and n.assistant_id = ? and n.recording_id = r.id)`, [ids.asistan, ids.asistan]);
  check(
    names.length === 3 && Number(sql.n) === 3 &&
      names.some((t) => t.includes("Melis Aydın")) &&
      names.some((t) => t.includes("Nazlı Koç") && t.includes("Geç")) &&
      names.some((t) => t.includes("Defne Arslan")) &&
      !names.some((t) => t.includes("Emre Aksoy") || t.includes("Portalda kayıt yok")),
    `AC22 asistan@'s Dinlenecek lists the 3 seeded S/A takes, Geç on Nazlı, no tenor/no-take rows (${names.length}, SQL ${sql.n})`,
  );
  check(
    (await asistan.locator("[data-testid=queue-group] h2").first().textContent()).includes("Sicut Cervus") &&
      /\d:\d\d · /.test(names[0] ?? ""),
    "AC22 grouped by homework; each row has duration and upload date",
  );
  await go(asistan, `${BASE}/`);
  check(
    (await asistan.locator("[data-testid=home-review-line]").textContent()) === "Dinleme kuyruğun: 3 kayıt",
    "AC22 the home card says Dinleme kuyruğun: 3 kayıt",
  );
  await go(asistan, `${BASE}/odevler`);
  check(
    (await asistan.locator("[data-testid=listen-link]").textContent()).trim() === "Dinleme3",
    "AC22 the /odevler header shows Dinleme with a pill of 3",
  );

  // ------------------------------------------------------------------ AC 27 (seed counts, badge)
  await go(sef, `${BASE}/odevler/dinle`);
  const chips = await sef.locator("nav[aria-label='Dinleme listesi'] a").allTextContents();
  check(
    chips[0] === "Yorum bekleyen17" && chips[1] === "Asistan notlu1" && chips[2] === "Yorumlananlar" &&
      (await sef.locator("[data-testid=queue-row]").count()) === 17,
    `AC27 sef@'s chips Yorum bekleyen 17 · Asistan notlu 1 · Yorumlananlar (${chips})`,
  );
  await go(sef, `${BASE}/odevler/dinle?filtre=asistan-notlu`);
  check(
    (await sef.locator("[data-testid=queue-row]").count()) === 1 &&
      (await sef.locator("[data-testid=queue-row]").textContent()).includes("1 asistan notu"),
    "AC27 Asistan notlu lists the one noted take with 1 asistan notu",
  );
  await go(sef, `${BASE}/odevler/dinle?filtre=yorumlanan`);
  check(
    (await sef.locator("[data-testid=queue-row]").count()) === 2 &&
      (await sef.locator("text=Son 100 kayıt gösteriliyor.").count()) === 0,
    "AC27 Yorumlananlar lists 2, no cut notice",
  );
  check((await reviewBadge(sef)) === "1", "AC27 sef@'s Ödevler carries data-review-badge=1 at 1280");
  check(
    (await sef.locator("a[href='/odevler'] .sr-only").first().textContent()).includes(", 1 kayıt asistan notuyla bekliyor") &&
      (await sef.locator("[data-nav-badge]").count()) === 0,
    "AC27 the badge's accessible text; sef@ still has no data-nav-badge",
  );
  const sefPhone = await loginAs(browser, "sef@arkhe.local", { phone: true });
  check((await reviewBadge(sefPhone)) === "1", "AC27 the same badge on the 375 px bottom bar");
  for (const [who, p] of [["korist", korist], ["yk", yk], ["asistan", asistan]]) {
    await go(p, `${BASE}/odevler`);
    check((await p.locator("[data-review-badge]").count()) === 0, `AC27 ${who}@ has no data-review-badge`);
  }
  await go(sef, `${BASE}/`);
  const homeLine = (await sef.locator("[data-testid=home-review-line]").textContent()).match(/^(\d+) kayıt dinlenmeyi bekliyor · 1 asistan notlu$/);
  const homeExtra = (await sef.locator("[data-testid=home-review-extra]").textContent())?.match(/^(\d+) teslimde portalda kayıt yok\.$/);
  check(
    Boolean(homeLine && homeExtra) &&
      Number(homeLine[1]) > 0 &&
      Number(homeLine[1]) + Number(homeExtra[1]) === 17 &&
      (await sef.locator("[data-testid=home-review] a[href='/odevler/dinle']").count()) === 1,
    `AC27 + review P2-4 the home card counts only takes with audio, the no-recording submissions on a second line (${homeLine?.[1]} + ${homeExtra?.[1]})`,
  );
  await go(sef, `${BASE}/odevler/dinle`);
  const audioOrder = await sef.locator("[data-testid=queue-group]").evaluateAll((groups) =>
    groups.map((g) => [...g.querySelectorAll("[data-testid=queue-row]")].map((r) => (r.textContent.includes("Portalda kayıt yok") ? 1 : 0)).join("")),
  );
  check(
    audioOrder.length > 0 && audioOrder.every((o) => !o.includes("10")),
    `review P2-4 inside each homework group rows with audio come first (${audioOrder.join(" ")})`,
  );
  const startHref = await sef.getByTestId("queue-start").getAttribute("href");
  const firstAudio = await sef.locator("[data-testid=queue-row]", { hasNotText: "Portalda kayıt yok" }).first().getAttribute("href");
  check(startHref === firstAudio, `review P2-4 Dinlemeye başla opens the first row with audio (${startHref})`);
  // A no-take submission on homework due 31 days ago isn't listed (D50).
  const old = await insertAssignment({ dueDays: -31 });
  await db.execute({
    sql: "insert into submissions (assignment_id, user_id, submitted_at, method) values (?, ?, ?, 'self')",
    args: [old.id, ids.korist, ago(32)],
  });
  await go(sef, `${BASE}/odevler/dinle`);
  check(
    (await sef.locator(`[data-testid=queue-row][data-assignment="${old.id}"]`).count()) === 0,
    "AC27 a Portalda kayıt yok submission due 31 days ago isn't listed",
  );
  // 9+ (arranged notes on ten waiting rows).
  const waiting = await all(`
    select s.assignment_id as a, s.user_id as u from submissions s
    join recordings r on r.assignment_id = s.assignment_id and r.user_id = s.user_id and r.replaced_at is null and r.audio_deleted_at is null
    where s.feedback is null and s.submitted_at is not null`);
  const extra = [];
  for (let i = 0; i < 10; i++) {
    const t = await insertAssignment({ dueDays: 3, title: `E2E Rozet ${i}` });
    await insertTake({ assignmentId: t.id, email: "korist@arkhe.local", withFile: false });
    await insertNote(t.id, ids.korist, ids.asistan, "E2E rozet");
    extra.push(t.id);
  }
  await sef.reload();
  check((await sef.locator("[data-review-badge]:visible").first().textContent()) === "9+", `AC27 above 9 the badge reads 9+ (${waiting.length} seeded)`);
  await reset();

  // ------------------------------------------------------------------ AC 18
  await go(sef, `${BASE}/odevler/asistanlar`);
  const seeded = sef.locator("[data-testid=assistant-row]", { hasText: "Demo Asistan" });
  check(
    (await seeded.count()) === 1 && (await seeded.locator("[data-testid=assistant-scope]").textContent()) === "Soprano, Alto",
    "AC18 /odevler/asistanlar lists Demo Asistan · Soprano, Alto",
  );
  for (const [who, p] of [["yk", yk], ["korist", korist], ["asistan", asistan]]) {
    check((await landsOn(p, "/odevler/asistanlar")) === "/odevler", `AC18 ${who}@ is redirected to /odevler`);
  }
  await go(korist, `${BASE}/odevler`);
  const asstActions = await actionIds(ASST, A);
  const before18 = Number((await one("select count(*) as n from listening_assistants")).n);
  const refused = [
    await callAction(yk, asstActions.addAssistant, [{}, {}]),
    await callAction(korist, asstActions.updateAssistant, [ids.asistan, {}, {}]),
    await callAction(asistan, asstActions.removeAssistant, [ids.asistan]),
  ];
  check(
    refused.every((t) => t.includes("Bu işlem için yetkin yok.")) &&
      Number((await one("select count(*) as n from listening_assistants")).n) === before18,
    "AC18 the actions refuse non-conductors and write nothing",
  );

  // ------------------------------------------------------------------ AC 19
  const helperId = await createUser("yardimci@e2e.test", "E2E Yardımcı", { part: "alto" });
  await createUser("pasifasist@e2e.test", "E2E Pasif Aday", { part: "alto" });
  await db.execute("update users set is_active = 0, left_at = unixepoch() where email = 'pasifasist@e2e.test'");
  await sef.reload();
  await sef.getByRole("button", { name: "Asistan ekle" }).first().click();
  const sheet = sef.getByRole("dialog");
  await sheet.waitFor();
  const pickerNames = await sheet.locator("label:has(input[name=userId])").allTextContents();
  check(
    pickerNames.some((t) => t.includes("E2E Yardımcı")) &&
      !pickerNames.some((t) => t.includes("Demo Şef") || t.includes("Demo Asistan") || t.includes("E2E Pasif Aday")),
    "AC19 the picker lists active member/board users, not the conductor, assistants or inactive users",
  );
  await sheet.getByPlaceholder("İsim ara").fill("Yardım");
  await sheet.locator("label", { hasText: "E2E Yardımcı" }).click();
  const scopeSet = sheet.locator("fieldset", { hasText: "Hangi partisyonları dinlesin?" });
  await scopeSet.locator("label", { hasText: /^Alto$/ }).click();
  await sheet.getByRole("button", { name: "Ekle" }).click();
  await sheet.locator("text=En az bir partisyon seç.").waitFor();
  check(true, "AC19 no part and Tüm partisyonlar off → En az bir partisyon seç.");
  await scopeSet.locator("label", { hasText: "Tüm partisyonlar" }).click();
  await sheet.getByRole("button", { name: "Ekle" }).click();
  const helperRow = sef.locator(`[data-testid=assistant-row][data-user="${helperId}"]`);
  await helperRow.waitFor();
  check((await helperRow.locator("[data-testid=assistant-scope]").textContent()) === "Tüm partisyonlar", "AC19 added with Tüm partisyonlar");
  await helperRow.getByRole("button", { name: /İşlemler/ }).click();
  await sef.getByRole("menuitem", { name: "Düzenle" }).click();
  const edit = sef.getByRole("dialog");
  await edit.locator("fieldset label", { hasText: /^Bas$/ }).click();
  await edit.getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForFunction(
    (id) => document.querySelector(`[data-testid=assistant-row][data-user="${id}"] [data-testid=assistant-scope]`)?.textContent === "Bas",
    helperId,
  );
  check(true, "AC19 editing to Bas only shows Bas");
  // Back to all parts for the leak checks below.
  await db.execute({ sql: "delete from listening_assistants where user_id = ?", args: [helperId] });
  for (const p of ["soprano", "alto", "tenor", "bass"]) {
    await db.execute({
      sql: "insert into listening_assistants (user_id, voice_part, created_by, created_at) values (?, ?, (select id from users where email = 'sef@arkhe.local'), unixepoch())",
      args: [helperId, p],
    });
  }

  // ------------------------------------------------------------------ AC 3 (visibility matrix)
  const take = await insertTake({ assignmentId: A, email: "korist@arkhe.local", uploadedAt: ago(0, 2) });
  const otherAlto = await loginAs(browser, "melis.aydin@arkhe.local");
  const tenorAsstId = await createUser("tenorasist@e2e.test", "E2E Tenor Asistan", { part: "bass" });
  await db.execute({
    sql: "insert into listening_assistants (user_id, voice_part, created_by, created_at) values (?, 'tenor', (select id from users where email = 'sef@arkhe.local'), unixepoch())",
    args: [tenorAsstId],
  });
  const tenorAsst = await loginAs(browser, "tenorasist@e2e.test");
  const url = `/api/dosya/kayit/${take.id}`;
  const matrix = [];
  for (const [who, p, want] of [
    ["korist (owner)", korist, 200],
    ["sef", sef, 200],
    ["asistan", asistan, 200],
    ["yk", yk, 404],
    ["another alto", otherAlto, 404],
    ["tenor-only assistant", tenorAsst, 404],
    ["logged out", anon, 401],
  ]) {
    const r = await get(p, url);
    const okHeaders =
      want !== 200 ||
      (r.headers["content-type"] === "audio/wav" &&
        r.headers["x-content-type-options"] === "nosniff" &&
        r.headers["cache-control"] === "private, no-store" &&
        r.headers["content-security-policy"] === "default-src 'none'; sandbox");
    const emptyBody = want === 200 || r.body === "";
    matrix.push(`${who}:${r.status}`);
    check(r.status === want && okHeaders && emptyBody, `AC3 ${who} gets ${want} on the alto take (${r.status})`);
  }
  const dl = async (p) => get(p, `${url}?indir=1`);
  const [dlKorist, dlSef, dlAsistan] = [await dl(korist), await dl(sef), await dl(asistan)];
  check(
    dlKorist.status === 200 &&
      /^attachment; filename="[A-Za-z0-9-]+\.wav"$/.test(dlKorist.headers["content-disposition"]) &&
      dlSef.status === 200 &&
      dlAsistan.status === 404,
    "AC3 ?indir=1: attachment for the owner and sef@, 404 for asistan@ (D44)",
  );
  // His own tenor take: 200 only as the owner, never in his queue, even with all parts.
  const own = await insertTake({ assignmentId: F, email: "asistan@arkhe.local", uploadedAt: ago(0, 2) });
  for (const p of ["tenor", "bass"]) {
    await db.execute({
      sql: "insert or ignore into listening_assistants (user_id, voice_part, created_by, created_at) values (?, ?, (select id from users where email = 'sef@arkhe.local'), unixepoch())",
      args: [ids.asistan, p],
    });
  }
  await go(asistan, `${BASE}/odevler/dinle`);
  check(
    (await get(asistan, `/api/dosya/kayit/${own.id}`)).status === 200 &&
      (await asistan.locator(`[data-testid=queue-row][data-user="${ids.asistan}"]`).count()) === 0 &&
      (await get(asistan, `/odevler/${F}/dinle/${ids.asistan}`)).status === 404,
    "AC3/AC20 asistan@'s own take: 200 as owner, not in his queue, review 404, even with all parts",
  );
  await db.execute({ sql: "delete from listening_assistants where user_id = ? and voice_part in ('tenor', 'bass')", args: [ids.asistan] });

  // After the comment the assistant loses the audio (D43); deleting it gives it back.
  await arrangeComment(A, ids.korist, "E2E geçici yorum");
  check((await get(asistan, url)).status === 404 && (await get(korist, url)).status === 200, "AC3 after sef@'s comment asistan@ gets 404 (owner still 200)");
  await db.execute({ sql: "update submissions set feedback = null, feedback_by = null, feedback_at = null where assignment_id = ? and user_id = ?", args: [A, ids.korist] });
  await db.execute({ sql: "update recordings set commented_at = null where id = ?", args: [take.id] });
  check((await get(asistan, url)).status === 200, "AC3 after the comment is deleted, 200 again");

  // ------------------------------------------------------------------ AC 2
  const leaks = [];
  for (const [who, p, paths] of [
    ["korist", korist, ["/", "/odevler", `/odevler/${A}`, `/repertuvar/${(await one("select id from pieces where title = 'Ave Verum Corpus'")).id}`]],
    ["asistan", asistan, ["/odevler/dinle", `/odevler/${A}/dinle/${ids.korist}`]],
    ["sef", sef, ["/odevler/dinle", `/odevler/${A}`, `/odevler/${A}/dinle/${ids.korist}`]],
    ["yk", yk, [`/odevler/${A}`, "/odevler"]],
  ]) {
    for (const path of paths) {
      for (const body of [await html(p, path), await rsc(p, path)]) {
        if (/recordings\/[0-9a-f-]{36}\.|(?<!dosya\/)midi\/[0-9a-f-]{36}\.mid|data\/uploads|blob\.vercel-storage\.com/.test(body)) leaks.push(`${who} ${path}`);
      }
    }
  }
  check(leaks.length === 0, `AC2 no storage key, data/uploads path or Blob host in any HTML/RSC (${leaks})`);
  check(
    (await get(korist, `/data/uploads/${take.key}`)).status === 404 && (await get(korist, `/uploads/${take.key}`)).status === 404,
    "AC2 data/uploads isn't served by Next",
  );

  // ------------------------------------------------------------------ AC 3 removal, AC 19 Kaldır, AC 21
  await go(sef, `${BASE}/odevler/asistanlar`);
  const demoRow = sef.locator(`[data-testid=assistant-row][data-user="${ids.asistan}"]`);
  await demoRow.getByRole("button", { name: /İşlemler/ }).click();
  await sef.getByRole("menuitem", { name: "Kaldır" }).click();
  const confirm = sef.getByRole("alertdialog");
  check(
    (await confirm.textContent()).includes("Demo Asistan artık kayıt dinleyemeyecek. Yazdığı notlar şefte kalır."),
    "AC19 Kaldır confirms with the PO sentence",
  );
  await confirm.getByRole("button", { name: "Kaldır" }).click();
  await demoRow.waitFor({ state: "detached" });
  check(
    (await get(asistan, url)).status === 404 &&
      (await landsOn(asistan, "/odevler/dinle")) === "/odevler" &&
      (await get(asistan, `/odevler/${D}/dinle/${ids.melis}`)).status === 404 &&
      Boolean(await one("select 1 from assistant_notes where assistant_id = ?", [ids.asistan])),
    "AC3/AC19 removed: audio 404 at once, queue redirects, review 404; his notes stay",
  );
  await go(korist, `${BASE}/odevler/${A}`);
  const lonely = await korist.locator("[data-testid=listeners]").textContent();
  check(lonely.includes("E2E Yardımcı") && !lonely.includes("Demo Asistan"), "AC21 after removal korist@ no longer sees Demo Asistan");
  await db.execute(`delete from listening_assistants where user_id = '${helperId}'`);
  await korist.reload();
  check((await korist.locator("[data-testid=listeners]").textContent()).includes("Kaydını yalnızca şef dinler."), "AC21 with nobody left: Kaydını yalnızca şef dinler.");
  await reset();
  await db.execute({
    sql: "insert into listening_assistants (user_id, voice_part, created_by, created_at) select ?, p, (select id from users where email = 'sef@arkhe.local'), unixepoch() from (select 'soprano' as p union all select 'alto' union all select 'tenor' union all select 'bass')",
    args: [helperId],
  });

  // ------------------------------------------------------------------ AC 21 (tenor)
  const emre = await loginAs(browser, "emre.aksoy@arkhe.local");
  await db.execute(`delete from listening_assistants where user_id = '${helperId}' and voice_part = 'tenor'`);
  await go(emre, `${BASE}/odevler/${A}`);
  const tenorText = await emre.locator("[data-testid=listeners]").textContent();
  check(
    tenorText.includes("Kaydını yalnızca şef dinler.") && tenorText.includes("Ses dosyası, şef yorumundan 90 gün sonra silinir."),
    "AC21 a tenor sees Kaydını yalnızca şef dinler. and the retention sentence",
  );
  await emre.context().close();

  // ------------------------------------------------------------------ AC 23
  await go(asistan, `${BASE}/odevler/dinle`);
  await asistan.locator("[data-testid=queue-row]", { hasText: "Melis Aydın" }).click();
  await asistan.waitForURL(/\/dinle\//);
  await asistan.getByRole("button", { name: "Kaydı dinle" }).click();
  await asistan.waitForFunction(() => document.querySelector("[data-audio-player]")?.dataset.state === "playing");
  const note = "Girişte tempo kaçıyor, 12. ölçüde nefes erken.";
  await asistan.fill("#note", "x".repeat(1001));
  await asistan.getByRole("button", { name: "Kaydet" }).click();
  await asistan.locator("text=Not en fazla 1000 karakter olabilir.").first().waitFor();
  check(true, "AC23 over 1000 characters: Not en fazla 1000 karakter olabilir.");
  await asistan.fill("#note", note);
  await asistan.getByRole("button", { name: "Kaydet" }).click();
  await asistan.locator("text=Notun kaydedildi.").waitFor();
  const saved = await one("select body from assistant_notes where singer_id = ? and assistant_id = ? and assignment_id = ?", [ids.melis, ids.asistan, D]);
  check(saved?.body === note, "AC23 Kaydet stores the note and toasts Notun kaydedildi.");
  await go(asistan, `${BASE}/odevler/dinle?filtre=notlarim`);
  check(
    (await asistan.locator("[data-testid=queue-row]", { hasText: "Melis Aydın" }).count()) === 1,
    "AC23 the item moves to Not yazdıklarım",
  );
  await go(asistan, `${BASE}/odevler/${D}/dinle/${ids.melis}?filtre=dinlenecek`);
  await asistan.fill("#note", `${note} Düzeltme.`);
  await asistan.getByRole("button", { name: "Güncelle" }).click();
  await asistan.locator("text=Notun kaydedildi.").first().waitFor();
  await asistan.getByTestId("review-next").click();
  await asistan.waitForURL((u) => !u.pathname.includes(ids.melis));
  check(asistan.url().includes("/dinle/") && asistan.url().includes("filtre=dinlenecek"), "AC23 Sonraki opens the next Dinlenecek item");
  await go(asistan, `${BASE}/odevler/${D}/dinle/${ids.melis}`);
  await asistan.getByRole("button", { name: "Notu sil" }).click();
  await asistan.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  await asistan.locator("text=Notun silindi.").waitFor();
  check(
    !(await one("select 1 from assistant_notes where singer_id = ? and assistant_id = ? and assignment_id = ?", [ids.melis, ids.asistan, D])),
    "AC23 Notu sil deletes it",
  );

  // ------------------------------------------------------------------ AC 33 (Sonraki to the end), guard
  await go(asistan, `${BASE}/odevler/dinle`);
  await asistan.getByTestId("queue-start").click();
  await asistan.waitForURL(/\/dinle\/[0-9a-f-]{36}/);
  await asistan.locator("[data-testid=review-footer]").waitFor();
  let hops = 0;
  while ((await asistan.getByTestId("review-next").count()) && hops < 10) {
    const from = asistan.url();
    await asistan.getByTestId("review-next").click();
    await asistan.waitForURL((u) => u.href !== from);
    await asistan.locator("[data-testid=review-footer]").waitFor();
    hops++;
  }
  check(
    hops === 2 && (await asistan.getByTestId("review-end").textContent()).includes("Bu listede başka kayıt yok."),
    `AC33 Sonraki walks the chip to the end, then Bu listede başka kayıt yok. (${hops} hops)`,
  );
  await go(asistan, `${BASE}/odevler/dinle`);
  await asistan.getByTestId("queue-start").click();
  await asistan.waitForURL(/\/dinle\//);
  await asistan.fill("#note", "yarım kalan not");
  await asistan.getByTestId("review-next").click();
  const guard = asistan.getByRole("alertdialog");
  check(
    (await guard.textContent()).includes("Notun kaydedilmedi. Kaydetmeden geçilsin mi?") &&
      (await guard.getByRole("button", { name: "Kal" }).count()) === 1,
    "D41 unsaved note: Sonraki asks Notun kaydedilmedi… (Kal / Geç)",
  );
  await asistan.waitForFunction(() => document.activeElement?.textContent?.trim() === "Kal");
  check(
    (await guard.getByRole("button", { name: "Geç" }).evaluate((e) => e.className.includes("text-absent-ink"))),
    "review P2-1 Kal is the focused primary, Geç the soft outline",
  );
  const here = asistan.url();
  await guard.getByRole("button", { name: "Kal" }).click();
  check(asistan.url() === here && (await asistan.inputValue("#note")) === "yarım kalan not", "D41 Kal keeps the text and the page");

  // ------------------------------------------------------------------ AC 24, 25, 28, 30 on korist@'s take
  const kt = await insertTake({ assignmentId: A, email: "korist@arkhe.local", uploadedAt: ago(0, 3) });
  const markA = `E2E-NOTE-A-${crypto.randomUUID()}`;
  const markB = `E2E-NOTE-B-${crypto.randomUUID()}`;
  const markC = `E2E-COMMENT-${crypto.randomUUID()}`;
  await insertNote(A, ids.korist, ids.asistan, markA);
  await insertNote(A, ids.korist, helperId, markB);
  const helper = await loginAs(browser, "yardimci@e2e.test");
  const reviewA = `/odevler/${A}/dinle/${ids.korist}`;
  const asView = (await html(asistan, reviewA)) + (await rsc(asistan, reviewA));
  const helperView = (await html(helper, reviewA)) + (await rsc(helper, reviewA));
  check(
    asView.includes(markA) && !asView.includes(markB) && !asView.includes("E2E Yardımcı") &&
      helperView.includes(markB) && !helperView.includes(markA) && !helperView.includes("Demo Asistan"),
    "AC24 each assistant's page holds only their own note: no other text, author or count",
  );
  // AC 28: both notes for sef@, Yoruma ekle, the 1000 cap and the guard.
  await go(sef, `${BASE}${reviewA}?filtre=bekleyen`);
  const sefNotes = sef.locator("[data-testid=assistant-note]");
  check(
    (await sefNotes.count()) === 2 &&
      (await sefNotes.allTextContents()).some((t) => t.includes("Demo Asistan") && t.includes(markA)) &&
      (await sefNotes.allTextContents()).some((t) => t.includes("E2E Yardımcı") && t.includes(markB)),
    "AC28 sef@ sees both notes with author and date",
  );
  check(
    (await sef.locator("#comment-help").textContent()) === "Gönderdiğin an Demo Korist görür. Asistan notları ona gitmez.",
    "AC28 Yorumun with the D63 help line",
  );
  await sefNotes.first().getByRole("button", { name: "Yoruma ekle" }).click();
  check((await sef.inputValue("#comment")).includes(markA), "AC28 Yoruma ekle appends the note text to Yorumun");
  await sef.fill("#comment", "y".repeat(990));
  const second = sefNotes.nth(1);
  check(
    (await second.getByRole("button", { name: "Yoruma ekle" }).isDisabled()) &&
      (await second.locator("text=Yorum 1000 karakteri geçer.").count()) === 1,
    "AC28 Yoruma ekle is disabled with Yorum 1000 karakteri geçer. when it would pass 1000",
  );
  await sef.fill("#comment", `${markC} Güzel giriş.`);
  if ((await sef.getByTestId("review-next").count()) > 0) {
    await sef.getByTestId("review-next").click();
    check(
      (await sef.getByRole("alertdialog").textContent()).includes("Yorumun gönderilmedi. Yine de sonrakine geçilsin mi?"),
      "AC28 unsent text: Sonraki asks Yorumun gönderilmedi…",
    );
    await sef.getByRole("alertdialog").getByRole("button", { name: "Kal" }).click();
    await sef.getByRole("alertdialog").waitFor({ state: "hidden" });
  }
  const badgeBefore = Number(await reviewBadge(sef));
  await sef.getByRole("button", { name: "Yorumu gönder" }).click();
  await sef
    .locator("[data-sonner-toast]", { hasText: "Yorum gönderildi." })
    .waitFor({ timeout: 15000 })
    .catch(async () => {
      throw new Error(`AC28 send: ${await sef.locator("[data-sonner-toast]").allTextContents()} / ${await sef.inputValue("#comment")}`);
    });
  const expectedDay = addDays(istanbulDay(Math.floor(Date.now() / 1000)), 90);
  await sef.getByTestId("comment-sent").waitFor();
  check(
    (await sef.getByTestId("comment-sent").textContent()).includes(`Bu kayıt ${auditDay(expectedDay)} tarihinde silinecek.`),
    `AC28 the page shows Bu kayıt ${auditDay(expectedDay)} tarihinde silinecek.`,
  );
  check(Number((await reviewBadge(sef)) ?? 0) === badgeBefore - 1, "AC28 the review badge drops by 1");
  await go(sef, `${BASE}/odevler/dinle`);
  check((await sef.locator(`[data-testid=queue-row][data-user="${ids.korist}"][data-assignment="${A}"]`).count()) === 0, "AC28 the item leaves Yorum bekleyen");
  await go(korist, `${BASE}/odevler`);
  check((await korist.locator(`[data-testid=homework-row][data-id="${A}"] [data-testid=new-note]`).count()) === 1, "AC28 korist@ sees Yeni yorum");
  await go(korist, `${BASE}/odevler/${A}`);
  const fb = await korist.locator("[data-testid=feedback]").textContent();
  check(fb.includes("Şefin yorumu") && fb.includes(markC) && fb.includes("Demo Şef ·"), "AC28 korist@ reads Şefin yorumu with Demo Şef · <tarih>");

  // AC 24/25: after the comment.
  const asAfter = (await html(asistan, reviewA)) + (await rsc(asistan, reviewA));
  const helperAfter = (await html(helper, reviewA)) + (await rsc(helper, reviewA));
  check(
    !asAfter.includes(markC) && !helperAfter.includes(markC) && asAfter.includes("Şef yorumunu gönderdi."),
    "AC24 neither assistant page holds the comment text; they see Şef yorumunu gönderdi.",
  );
  await go(asistan, `${BASE}${reviewA}`);
  check(
    (await asistan.locator("[data-audio-player]").count()) === 0 &&
      (await asistan.getByTestId("note-locked").textContent()).includes(markA) &&
      (await get(asistan, `/api/dosya/kayit/${kt.id}`)).status === 404,
    "AC25 the assistant's page: read-only note, no player, audio 404",
  );
  const noteActions = await actionIds(NOTES, A);
  const del25 = await callAction(asistan, noteActions.deleteAssistantNote, [A, ids.korist]);
  check(del25.includes("Şef yorumunu gönderdi; artık not eklenemez.") && Boolean(await one("select 1 from assistant_notes where assistant_id = ? and singer_id = ? and assignment_id = ?", [ids.asistan, ids.korist, A])), "AC25 the note actions refuse with the lock and change nothing");
  await go(asistan, `${BASE}/odevler/dinle`);
  check((await asistan.locator(`[data-testid=queue-row][data-user="${ids.korist}"]`).count()) === 0, "AC25 the item left asistan@'s Dinlenecek");

  // AC 30: the singer never sees notes; nor does the board.
  const leak30 = [];
  for (const path of ["/", "/odevler", `/odevler/${A}`]) {
    for (const body of [await html(korist, path), await rsc(korist, path)]) {
      if ([markA, markB, "E2E Yardımcı", "asistan notu"].some((m) => body.includes(m))) leak30.push(path);
    }
  }
  const head30 = await get(korist, `/api/dosya/kayit/${kt.id}`);
  check(
    leak30.length === 0 && !JSON.stringify(head30.headers).includes("E2E-NOTE"),
    `AC30 korist@'s pages and the audio headers hold no note marker, author or count (${leak30})`,
  );
  check(
    (await get(korist, reviewA)).status === 404 &&
      (await get(yk, reviewA)).status === 404 &&
      (await callAction(korist, noteActions.deleteAssistantNote, [A, ids.korist])).includes("Bu işlem için yetkin yok.") &&
      (await callAction(yk, noteActions.deleteAssistantNote, [A, ids.korist])).includes("Bu işlem için yetkin yok."),
    "AC30 the review page is 404 and note actions refuse for korist@ and yk@",
  );
  const yk30 = (await html(yk, `/odevler/${A}`)) + (await rsc(yk, `/odevler/${A}`));
  check(![markA, markB].some((m) => yk30.includes(m)), "AC30/D45 the board never sees assistant notes");

  // ------------------------------------------------------------------ AC 31
  const del31 = (await one("select delete_on from recordings where id = ?", [kt.id])).delete_on;
  await go(sef, `${BASE}${reviewA}`);
  await sef.fill("#comment", `${markC} Düzenlendi.`);
  await sef.getByRole("button", { name: "Güncelle" }).click();
  await sef.locator("text=Yorum güncellendi.").waitFor();
  const s31 = await one("select feedback_seen_at, feedback from submissions where assignment_id = ? and user_id = ?", [A, ids.korist]);
  check(
    s31.feedback_seen_at === null && (await one("select delete_on from recordings where id = ?", [kt.id])).delete_on === del31,
    "AC31 editing revives Yeni yorum and keeps the deletion date",
  );
  await sef.getByRole("button", { name: "Yorumu sil" }).click();
  const c31 = sef.getByRole("alertdialog");
  check((await c31.textContent()).includes("Demo Korist artık bu yorumu görmez ve kaydını yeniden değiştirebilir."), "AC31 Yorumu sil confirm");
  await c31.getByRole("button", { name: "Sil" }).click();
  await sef.locator("text=Yorum silindi.").waitFor();
  const r31 = await one("select delete_on, commented_at, uploaded_at from recordings where id = ?", [kt.id]);
  check(
    r31.commented_at === null && r31.delete_on === addDays(istanbulDay(Number(r31.uploaded_at)), 120),
    "AC31 Yorumu sil clears the comment; the 120-day rule applies again",
  );
  await go(korist, `${BASE}/odevler/${A}`);
  check((await korist.getByRole("button", { name: "Değiştir" }).count()) === 1, "AC31 the singer's Değiştir is back");
  await go(asistan, `${BASE}/odevler/dinle?filtre=notlarim`);
  const back = await asistan.locator(`[data-testid=queue-row][data-user="${ids.korist}"]`).count();
  check(back >= 1, `AC25/AC31 the item is back in the queues (${back})`);

  // TL1 (D54 amendment): clearing the comment on a take older than 120 days keeps it until tomorrow.
  const nowSec = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: "update recordings set uploaded_at = ?, delete_on = ? where id = ?",
    args: [nowSec - 130 * 86400, addDays(istanbulDay(nowSec), 5), kt.id],
  });
  await go(sef, `${BASE}${reviewA}`);
  await sef.fill("#comment", `${markC} TL1`);
  await sef.getByRole("button", { name: "Yorumu gönder" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Yorum gönderildi." }).waitFor();
  await sef.getByRole("button", { name: "Yorumu sil" }).click();
  await sef.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  await sef.locator("text=Yorum silindi.").waitFor();
  const tl1 = await one("select delete_on, commented_at from recordings where id = ?", [kt.id]);
  check(
    tl1.commented_at === null && tl1.delete_on === addDays(istanbulDay(nowSec), 1),
    `TL1 clearing the comment on a 130-day-old take sets delete_on to tomorrow, not the past (${tl1.delete_on})`,
  );
  await db.execute({ sql: "update recordings set uploaded_at = ?, delete_on = ? where id = ?", args: [r31.uploaded_at, r31.delete_on, kt.id] });

  // ------------------------------------------------------------------ AC 26
  const re = await uploadRaw(korist, A, wavBytes({ seconds: 2 }));
  await go(asistan, `${BASE}/odevler/dinle`);
  const retake = asistan.locator(`[data-testid=queue-row][data-user="${ids.korist}"]`);
  check(re.status === 201 && (await retake.textContent()).includes("Yeni kayıt"), "AC26 a re-take reappears in Dinlenecek with Yeni kayıt");
  await go(asistan, `${BASE}${reviewA}`);
  await go(sef, `${BASE}${reviewA}`);
  check(
    (await asistan.locator("text=Önceki kayda yazıldı").count()) === 1 &&
      (await sef.locator("[data-testid=assistant-note]", { hasText: markA }).locator("text=Önceki kayda yazıldı").count()) === 1,
    "AC26 the old note shows Önceki kayda yazıldı to him and to sef@",
  );

  // ------------------------------------------------------------------ AC 29
  const defne = `/odevler/${D}/dinle/${ids.defne}`;
  await go(sef, `${BASE}${defne}`);
  check((await sef.locator("text=Bu kayda asistan notu yok.").count()) === 1, "AC29 a take with zero notes");
  await sef.fill("#comment", "E2E notsuz yorum");
  await sef.getByRole("button", { name: "Yorumu gönder" }).click();
  await sef.locator("text=Yorum gönderildi.").first().waitFor();
  const noTake = await one(`
    select s.user_id as u from submissions s join users x on x.id = s.user_id
    where s.assignment_id = ? and s.submitted_at is not null and s.feedback is null
      and not exists (select 1 from recordings r where r.assignment_id = s.assignment_id and r.user_id = s.user_id)
    limit 1`, [D]);
  await go(sef, `${BASE}/odevler/${D}/dinle/${noTake.u}`);
  check((await sef.getByTestId("no-take").count()) === 1, "AC29 a Portalda kayıt yok submission opens with the no-take box");
  await sef.fill("#comment", "E2E kayıtsız yorum");
  await sef.getByRole("button", { name: "Yorumu gönder" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Yorum gönderildi." }).waitFor();
  const both = await all("select feedback from submissions where assignment_id = ? and user_id in (?, ?)", [D, ids.defne, noTake.u]);
  check(both.length === 2 && both.every((r) => r.feedback?.startsWith("E2E")), "AC29 both comments reach their singers");

  // ------------------------------------------------------------------ AC 32
  await go(yk, `${BASE}/odevler/${B}`);
  await yk.locator("[data-testid=roster-row]").first().click();
  check((await yk.locator("#feedback").count()) === 0, "AC32 yk@'s roster sheet has no note field");
  const odev = await actionIds(ODEV, B);
  check(
    (await callAction(yk, odev.saveFeedback, [B, ids.korist, {}, {}])).includes("Geri bildirimi yalnızca şef yazar."),
    "AC32 saveFeedback as yk@ is refused",
  );
  await db.execute({
    sql: "insert into submissions (assignment_id, user_id, submitted_at, method) values (?, ?, unixepoch() - 600, 'self') on conflict do nothing",
    args: [B, ids.korist],
  });
  await arrangeComment(B, ids.korist, "E2E eski yönetim notu", { byEmail: "yk@arkhe.local" });
  await go(korist, `${BASE}/odevler/${B}`);
  check((await korist.locator("[data-testid=feedback]").textContent()).includes("Geri bildirim"), "AC32 an old board note still shows under Geri bildirim");
  await go(sef, `${BASE}/odevler/${B}/dinle/${ids.korist}`);
  check(
    (await sef.inputValue("#comment")) === "E2E eski yönetim notu" &&
      (await sef.locator("text=Bu not Demo Yönetim tarafından yazıldı.").count()) === 1,
    "AC32 sef@ can edit the board note (prefilled, attributed)",
  );

  // ------------------------------------------------------------------ AC 33 (roster for yk)
  await go(yk, `${BASE}/odevler/${D}`);
  const ykTag = yk.locator("[data-testid=roster-recording]").first();
  check(
    (await ykTag.count()) === 1 &&
      (await ykTag.evaluate((e) => e.tagName)) === "SPAN" &&
      (await yk.locator("[data-testid=roster-listen]").count()) === 0 &&
      (await get(yk, `/odevler/${D}/dinle/${ids.ayse}`)).status === 404,
    "AC33 for yk@ the Kayıt tag is plain text and the review URL is 404",
  );

  // ------------------------------------------------------------------ AC 20
  await reset();
  await db.execute(`delete from listening_assistants where user_id = '${helperId}'`);
  await db.execute({ sql: "update users set voice_part = 'tenor' where id = ?", args: [ids.defne] });
  await go(asistan, `${BASE}/odevler/dinle`);
  check(
    (await asistan.locator(`[data-testid=queue-row][data-user="${ids.defne}"]`).count()) === 0 &&
      (await get(asistan, `/odevler/${D}/dinle/${ids.defne}`)).status === 404 &&
      (await get(asistan, `/api/dosya/kayit/${SEED_REC(5)}`)).status === 404,
    "AC20 a soprano moved to tenor leaves his queue; review and audio 404",
  );
  await db.execute({ sql: "update users set voice_part = 'soprano' where id = ?", args: [ids.defne] });
  await db.execute({ sql: "update users set role = 'conductor', voice_part = null where id = ?", args: [ids.asistan] });
  await go(asistan, `${BASE}/odevler/dinle`);
  check((await asistan.locator("text=Koristlere yorumunu buradan yaz.").count()) === 1, "AC20 made conductor he gets the conductor's view");
  await db.execute({ sql: "update users set role = 'member', voice_part = 'tenor' where id = ?", args: [ids.asistan] });

  // ------------------------------------------------------------------ AC 57
  await reset();
  for (const colorScheme of ["light", "dark"]) {
    const found = [];
    for (const [email, paths] of [
      ["sef@arkhe.local", ["/odevler/dinle", `/odevler/${D}/dinle/${ids.ayse}?filtre=bekleyen`, "/odevler/asistanlar", `/odevler/${D}`]],
      ["asistan@arkhe.local", ["/odevler/dinle", `/odevler/${D}/dinle/${ids.melis}`]],
      ["yk@arkhe.local", [`/odevler/${D}`]],
    ]) {
      const p = await loginAs(browser, email, { phone: true, context: { colorScheme } });
      for (const path of paths) {
        await go(p, `${BASE}${path}`);
        found.push(...[...(await axe(p, "main")), ...(await layoutIssues(p))].map((x) => `${path}: ${x}`));
        if (shots) await p.screenshot({ path: `${shots}/p9-${email.split("@")[0]}-${path.split("/").slice(2, 4).join("-").replace(/[?=]/g, "_")}-375-${colorScheme}.png`, fullPage: true });
      }
      await p.context().close();
    }
    check(found.length === 0, `AC57 queue, review, asistanlar and the roster (no name cut to a few letters) at 375 ${colorScheme}: clean (${found.slice(0, 4)})`);
  }
  if (shots) {
    await go(sef, `${BASE}/odevler/${D}/dinle/${ids.ayse}`);
    await sef.screenshot({ path: `${shots}/p9-review-1280.png`, fullPage: true });
    await go(sef, `${BASE}/odevler/dinle`);
    await sef.screenshot({ path: `${shots}/p9-queue-1280.png`, fullPage: true });
  }

  for (const p of [sef, yk, korist, asistan, anon, sefPhone, otherAlto, tenorAsst, helper]) await p.context().close();
}
