// Phase 10 S2/S9 UI: the Bildirimler section, devices, switches, the test button, the home nudge,
// re-sync and logout, on a fake Push stack (D88), at 375 px in both themes.
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { BASE, check, db, login, newPage, userId } from "./lib.mjs";
import { axe, go, layoutIssues, one } from "./media.mjs";
import {
  browserEndpoint,
  fakeEndpoint,
  IPHONE_UA,
  pushCalls,
  pushKeys,
  stubPush,
} from "./push-stub.mjs";

const OUTBOX = new URL("../data/push-outbox/", import.meta.url).pathname;
const USERS = ["korist@arkhe.local", "yk@arkhe.local", "sef@arkhe.local", "asistan@arkhe.local"];
const DEFAULT_TEXT =
  "Yoklama, çalışma değişikliği ve ödevler için telefonuna haber verelim. Bildirim gelmese de her şey portalda durur.";
const KORIST_GROUPS = [
  "Çalışma ve konser duyuruları",
  "Gelmedi olarak işaretlendiğimde",
  "Ödevler ve şef yorumları",
  "Repertuvar yenilikleri",
];
const QUIET = "Gece sessiz (22:00–08:00)";
const QUIET_HELP = "Bu saatlerde gelenler sabah 08:00–09:00 arası tek bildirimde gelir.";
const URGENT_HELP = "Acil yönetim işleri beklemez.";

const userIds = () => USERS.map((e) => `(select id from users where email = '${e}')`).join(", ");

async function resetPush() {
  await db.batch(
    [
      `delete from push_subscriptions where user_id in (${userIds()})`,
      `delete from notification_prefs where user_id in (${userIds()})`,
      `delete from notifications where user_id in (${userIds()})`,
      "delete from sessions where id like 'e2e-push-%'",
      "delete from notification_state where key = 'aidat-bildirimleri'",
      "delete from login_attempts where key like 'push-test:%'",
    ],
    "write",
  );
}

async function outboxFiles() {
  try {
    return (await readdir(OUTBOX)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/** Removes outbox files this suite produced (sends to its users). */
async function clearOutbox(before) {
  const ids = new Set((await Promise.all(USERS.map((e) => userId(e)))).map(String));
  for (const f of await outboxFiles()) {
    if (before.has(f)) continue;
    const json = JSON.parse(await readFile(path.join(OUTBOX, f), "utf8").catch(() => "{}"));
    if (ids.has(String(json.userId))) await rm(path.join(OUTBOX, f), { force: true });
  }
}

/** A device row on another (fake) login session of `email`. */
async function arrangeDevice(email, { label = "Android · Chrome", result = "ok" } = {}) {
  const uid = await userId(email);
  const session = `e2e-push-${crypto.randomUUID()}`;
  const id = crypto.randomUUID();
  const keys = pushKeys();
  await db.execute({
    sql: "insert into sessions (id, user_id, expires_at) values (?, ?, unixepoch() + 86400)",
    args: [session, uid],
  });
  await db.execute({
    sql: "insert into push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, label, created_at) values (?, ?, ?, ?, ?, ?, ?, unixepoch() - 86400 * 3)",
    args: [id, uid, session, fakeEndpoint(result), keys.p256dh, keys.auth, label],
  });
  return id;
}

async function phone(browser, email, stub = {}, context = {}) {
  const page = await newPage(browser, { phone: true, context });
  await stubPush(page.context(), stub);
  await login(page, email);
  await page.waitForURL(`${BASE}/`);
  return page;
}

const section = (page) => page.locator("#bildirimler");
const stateOf = (page) =>
  page.locator("[data-testid=push-device]:not([data-state=loading])").getAttribute("data-state");
const stateText = (page) => page.getByTestId("push-state-text").textContent();
const switchLabels = (page) =>
  page
    .locator("[data-testid=push-pref]")
    .evaluateAll((els) => els.map((el) => el.querySelector("span > span")?.textContent?.trim()));
const toast = (page, text) =>
  page
    .locator("[data-sonner-toast]", { hasText: text })
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
const rows = (page) => page.getByTestId("push-device-row");
const nudge = (page) => page.getByTestId("push-nudge");

async function profile(page) {
  await go(page, `${BASE}/profil`);
  await page.locator("[data-testid=push-device]:not([data-state=loading])").waitFor();
}

export default async function run(browser, shots) {
  await resetPush();
  const before = new Set(await outboxFiles());
  try {
    await suite(browser, shots);
  } finally {
    await clearOutbox(before);
    await resetPush();
  }
}

async function suite(browser, shots) {
  // ------------------------------------------------------------------ AC 11, 19: nothing asked on load
  const k = await phone(browser, "korist@arkhe.local");
  await nudge(k)
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  const nudgeText =
    (await nudge(k)
      .textContent()
      .catch(() => "")) ?? "";
  check(
    (await nudge(k)
      .getAttribute("data-mode")
      .catch(() => null)) === "ask" &&
      nudgeText.includes("Yoklama açılınca haber verelim mi?") &&
      nudgeText.includes(
        "Çalışma değişikliği, yoklama ve ödevler için telefonuna bildirim gönderelim.",
      ) &&
      (await nudge(k).getByRole("button", { name: "Bildirimleri aç" }).count()) === 1 &&
      (await nudge(k).getByRole("button", { name: "Şimdi değil" }).count()) === 1,
    "AC19 / shows the nudge card with its title, body and both buttons",
  );
  await profile(k);
  const calls0 = await pushCalls(k);
  check(
    calls0.requestPermission === 0 && calls0.subscribe === 0,
    `AC11 loading / and /profil never asks for permission or subscribes (${JSON.stringify(calls0)})`,
  );
  check(
    (await stateOf(k)) === "default" &&
      (await stateText(k)) === DEFAULT_TEXT &&
      (await section(k).getByRole("button", { name: "Bildirimleri aç" }).count()) === 1,
    "AC10 not asked yet: the intro and Bildirimleri aç",
  );
  check(
    JSON.stringify(await switchLabels(k)) === JSON.stringify([...KORIST_GROUPS, QUIET]),
    `AC16 korist@ sees exactly the four §4 switches plus quiet hours (${await switchLabels(k)})`,
  );
  const defaults = await k
    .locator("[data-testid=push-pref] [role=switch]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-checked")));
  check(
    JSON.stringify(defaults) === JSON.stringify(["true", "false", "true", "false", "true"]),
    `AC16/17 defaults: Çalışma on, Gelmedi off, Ödevler on, Repertuvar off, Gece sessiz on (${defaults})`,
  );
  const sectionText = (await section(k).textContent()) ?? "";
  check(
    sectionText.includes("Bildirimleri bir cihazda açınca bu ayarlar geçerli olur.") &&
      sectionText.includes(QUIET_HELP) &&
      !sectionText.includes(URGENT_HELP),
    "AC16/17 no device: the hint shows; quiet help without the manager line for korist@",
  );
  const testBtn = section(k).getByRole("button", { name: "Deneme bildirimi gönder" });
  check(
    (await testBtn.isDisabled()) &&
      (await testBtn.getAttribute("aria-describedby")) &&
      sectionText.includes("Önce bu cihazda bildirimleri aç."),
    "AC18 no device: Deneme bildirimi gönder is disabled with Önce bu cihazda bildirimleri aç.",
  );

  // ------------------------------------------------------------------ AC 11: the tap
  await section(k).getByRole("button", { name: "Bildirimleri aç" }).click();
  await k.locator("[data-testid=push-device][data-state=on]").waitFor();
  const calls1 = await pushCalls(k);
  const endpoint = await browserEndpoint(k);
  const row = await one(
    "select p.id, p.label from push_subscriptions p join users u on u.id = p.user_id where u.email = 'korist@arkhe.local' and p.endpoint = ?",
    [endpoint],
  );
  check(
    calls1.requestPermission === 1 && calls1.subscribe === 1 && Boolean(row),
    `AC11 Bildirimleri aç asks, subscribes and saves the subscription (${JSON.stringify(calls1)})`,
  );
  check(
    (await toast(k, "Bu cihazda bildirimler açık.")) &&
      (await stateText(k)) === "Bu cihazda bildirimler açık." &&
      (await section(k).getByRole("button", { name: "Bu cihazda kapat" }).count()) === 1,
    "AC10 on: Bu cihazda bildirimler açık. with Bu cihazda kapat",
  );
  await rows(k).first().waitFor();
  const rowText = ((await rows(k).first().textContent()) ?? "").replace(/\s+/g, " ");
  check(
    (await rows(k).count()) === 1 &&
      /^(Mac|Windows|Linux) · Chrome/.test(rowText) &&
      rowText.includes("Bu cihaz") &&
      /Eklendi \S+ \d{1,2} \S+/.test(rowText) &&
      (await rows(k)
        .first()
        .getByRole("button", { name: /^Kaldır/ })
        .count()) === 0,
    `AC11 Cihazların lists <cihaz> · <tarayıcı>, Bu cihaz and Eklendi {gün} (${rowText})`,
  );

  // ------------------------------------------------------------------ AC 19: subscribed → no nudge
  await go(k, `${BASE}/`);
  await k.waitForTimeout(500);
  check((await nudge(k).count()) === 0, "AC19 a subscribed browser never sees the nudge");

  // ------------------------------------------------------------------ AC 18: test button
  await profile(k);
  await section(k).getByRole("button", { name: "Deneme bildirimi gönder" }).click();
  check(
    await toast(k, "Deneme bildirimi gönderildi (1 cihaz)."),
    "AC18 Deneme bildirimi gönderildi (1 cihaz).",
  );
  const goneId = await arrangeDevice("korist@arkhe.local", {
    label: "iPhone · Safari",
    result: "gone",
  });
  await profile(k);
  check(
    (await rows(k).count()) === 2 &&
      (await k.getByRole("button", { name: "Kaldır: iPhone · Safari" }).count()) === 1,
    "AC12 another device is listed with its own Kaldır",
  );
  await section(k).getByRole("button", { name: "Deneme bildirimi gönder" }).click();
  const sent2 = await toast(k, /Deneme bildirimi gönderildi \(\d cihaz\)\./);
  const warned = await toast(k, "1 cihaz artık bildirim almıyor; listeden kaldırıldı.");
  check(
    sent2 && warned && !(await one("select 1 from push_subscriptions where id = ?", [goneId])),
    "AC18 a /gone device is removed and the toast says so",
  );
  await profile(k);
  check((await rows(k).count()) === 1, "AC18 the removed device leaves the list");

  // ------------------------------------------------------------------ AC 12: Kaldır with confirm
  const otherId = await arrangeDevice("korist@arkhe.local", { label: "Android · Chrome" });
  await profile(k);
  await k.getByRole("button", { name: "Kaldır: Android · Chrome" }).click();
  const dialog = k.getByRole("alertdialog");
  await dialog.waitFor();
  const dialogText = (await dialog.textContent()) ?? "";
  check(
    dialogText.includes("Android · Chrome kaldırılsın mı?") &&
      dialogText.includes("Bu cihaza artık bildirim gitmez."),
    "AC12 Kaldır confirms {cihaz} kaldırılsın mı? / Bu cihaza artık bildirim gitmez.",
  );
  await dialog.getByRole("button", { name: "Kaldır" }).click();
  await toast(k, "Cihaz kaldırıldı.");
  await k.waitForTimeout(300);
  check(
    !(await one("select 1 from push_subscriptions where id = ?", [otherId])) &&
      (await k.getByRole("button", { name: "Kaldır: Android · Chrome" }).count()) === 0,
    "AC12 the device row is deleted and leaves the list",
  );

  // ------------------------------------------------------------------ AC 18: rate limit (5 per 10 min)
  let limited = false;
  for (let i = 0; i < 5 && !limited; i++) {
    await section(k).getByRole("button", { name: "Deneme bildirimi gönder" }).click();
    limited = await k
      .locator("[data-sonner-toast]", { hasText: "Çok sık denedin. Biraz sonra tekrar dene." })
      .first()
      .waitFor({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
  }
  check(limited, "AC18 the 6th test within 10 minutes: Çok sık denedin. Biraz sonra tekrar dene.");

  // ------------------------------------------------------------------ AC 16: a switch saves at once
  const odev = k.getByRole("switch", { name: /Ödevler ve şef yorumları/ });
  await odev.click();
  const saved = await toast(k, "Kaydedildi.");
  await profile(k);
  const pref = await one(
    "select enabled from notification_prefs where key = 'odev' and user_id = (select id from users where email = 'korist@arkhe.local')",
  );
  check(
    saved &&
      (await k
        .getByRole("switch", { name: /Ödevler ve şef yorumları/ })
        .getAttribute("aria-checked")) === "false" &&
      Number(pref?.enabled) === 0,
    "AC16 Ödevler ve şef yorumları off: Kaydedildi., survives a reload, stored",
  );
  await k.getByRole("switch", { name: /Ödevler ve şef yorumları/ }).click();
  await toast(k, "Kaydedildi.");
  const quietSwitch = k.getByRole("switch", { name: /Gece sessiz/ });
  check(
    (await quietSwitch.getAttribute("aria-describedby")) !== null,
    "AC54 the quiet switch is described by its help text",
  );

  // ------------------------------------------------------------------ AC 23: re-sync
  await db.execute({ sql: "delete from push_subscriptions where endpoint = ?", args: [endpoint] });
  await go(k, `${BASE}/`);
  await k.waitForTimeout(800);
  const throttled = !(await one("select 1 from push_subscriptions where endpoint = ?", [endpoint]));
  await k.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("arkhe-push-sync"));
    s.at -= 25 * 60 * 60 * 1000;
    localStorage.setItem("arkhe-push-sync", JSON.stringify(s));
  });
  await go(k, `${BASE}/`);
  let back = false;
  for (let i = 0; i < 20 && !back; i++) {
    back = Boolean(await one("select 1 from push_subscriptions where endpoint = ?", [endpoint]));
    if (!back) await k.waitForTimeout(250);
  }
  check(
    throttled && back,
    `AC23 a lost row comes back on load once the daily stamp is old, not before (${throttled}, ${back})`,
  );
  const callsAfterSync = await pushCalls(k);
  check(
    callsAfterSync.requestPermission === 0 && callsAfterSync.subscribe === 0,
    "AC23 the re-sync never prompts or subscribes again",
  );

  // ------------------------------------------------------------------ AC 12: Bu cihazda kapat
  await profile(k);
  await section(k).getByRole("button", { name: "Bu cihazda kapat" }).click();
  await k.locator("[data-testid=push-device][data-state=default]").waitFor();
  check(
    (await toast(k, "Bu cihazda bildirimler kapandı.")) &&
      (await browserEndpoint(k)) === null &&
      !(await one("select 1 from push_subscriptions where endpoint = ?", [endpoint])),
    "AC12 Bu cihazda kapat unsubscribes the browser and deletes the row",
  );

  // ------------------------------------------------------------------ AC 15: logout drops the browser's subscription
  await section(k).getByRole("button", { name: "Bildirimleri aç" }).click();
  await k.locator("[data-testid=push-device][data-state=on]").waitFor();
  const ep2 = await browserEndpoint(k);
  await k.getByRole("button", { name: "Çıkış yap" }).first().click();
  await k.waitForURL(/\/giris/);
  check(
    ep2 &&
      (await browserEndpoint(k)) === null &&
      !(await one("select 1 from push_subscriptions where endpoint = ?", [ep2])),
    "AC15 logout unsubscribes this browser and its row goes",
  );
  await k.context().close();

  // ------------------------------------------------------------------ AC 19: Şimdi değil
  const n = await phone(browser, "korist@arkhe.local");
  await nudge(n).waitFor();
  await nudge(n).getByRole("button", { name: "Şimdi değil" }).click();
  await go(n, `${BASE}/`);
  await n.waitForTimeout(500);
  const stamp = await n.evaluate(() => Number(localStorage.getItem("arkhe-push-nudge-hidden")));
  check(
    (await nudge(n).count()) === 0 && stamp > Date.now() - 60_000,
    "AC19 Şimdi değil hides the card on this browser (30-day stamp)",
  );
  await n.evaluate(() =>
    localStorage.setItem("arkhe-push-nudge-hidden", String(Date.now() - 31 * 86_400_000)),
  );
  await go(n, `${BASE}/`);
  check(
    await nudge(n)
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false),
    "AC19 after 30 days the card returns",
  );
  await n.context().close();

  // ------------------------------------------------------------------ AC 10: the other states
  const states = [
    {
      name: "unsupported",
      stub: { mode: "unsupported" },
      text: "Bu tarayıcı bildirim göstermiyor. Android'de Chrome'u, iPhone'da ana ekrana eklenmiş Arkhe'yi kullan.",
    },
    {
      name: "ios-install",
      stub: {},
      ctx: { userAgent: IPHONE_UA },
      text: "iPhone'da bildirim almak için önce Arkhe'yi ana ekrana ekle, sonra ana ekrandaki Arkhe'yi açıp buraya gel.",
    },
    {
      name: "ios-old",
      stub: { mode: "ios-old", standalone: true },
      ctx: { userAgent: IPHONE_UA },
      text: "Bildirim için iOS 16.4 ya da daha yeni bir sürüm gerekiyor.",
    },
    {
      name: "denied",
      stub: { permission: "denied" },
      text: "Bildirim izni kapalı. Telefonunun ayarlarından Arkhe'ye bildirim izni ver, sonra bu sayfayı yenile.",
    },
  ];
  for (const s of states) {
    const p = await phone(browser, "korist@arkhe.local", s.stub, s.ctx);
    await p.waitForTimeout(500);
    const nudgeMode = await nudge(p)
      .getAttribute("data-mode", { timeout: 1000 })
      .catch(() => null);
    let nudgeOk = s.name === "ios-install" ? nudgeMode === "ios" : nudgeMode === null;
    if (s.name === "ios-install" && nudgeOk) {
      const body = (await nudge(p).textContent()) ?? "";
      const how = nudge(p).getByRole("link", { name: "Nasıl?" });
      nudgeOk =
        body.includes("iPhone'da önce Arkhe'yi ana ekrana ekle.") &&
        (await how.getAttribute("href")) === "/profil#bildirimler" &&
        (await nudge(p).getByRole("button", { name: "Bildirimleri aç" }).count()) === 0;
    }
    check(
      nudgeOk,
      `AC19 ${s.name}: ${s.name === "ios-install" ? "the iPhone nudge with Nasıl? → /profil#bildirimler" : "no nudge card"}`,
    );
    await profile(p);
    const txt = (await section(p).textContent()) ?? "";
    check(
      (await stateOf(p)) === s.name &&
        (await stateText(p)) === s.text &&
        (await section(p).getByRole("button", { name: "Bildirimleri aç" }).count()) === 0 &&
        (s.name !== "ios-install" || txt.includes("“Ana Ekrana Ekle”ye dokun.")),
      `AC10 ${s.name}: ${s.text.slice(0, 40)}… and no Bildirimleri aç`,
    );
    await p.context().close();
  }

  // ------------------------------------------------------------------ AC 16, 17: other roles
  const roles = [
    [
      "asistan@arkhe.local",
      [...KORIST_GROUPS.slice(0, 3), "Dinleme kuyruğu", "Repertuvar yenilikleri"],
      false,
    ],
    ["yk@arkhe.local", [...KORIST_GROUPS.slice(0, 4), "Yönetim işleri", "Bütçe"], true],
    [
      "sef@arkhe.local",
      [
        "Çalışma ve konser duyuruları",
        "Dinleme kuyruğu",
        "Repertuvar yenilikleri",
        "Yönetim işleri",
        "Bütçe",
        "Yedek ve depolama uyarıları",
      ],
      true,
    ],
  ];
  for (const [email, expected, manager] of roles) {
    const p = await phone(browser, email);
    await profile(p);
    const labels = await switchLabels(p);
    const text = (await section(p).textContent()) ?? "";
    check(
      JSON.stringify(labels) === JSON.stringify([...expected, QUIET]) &&
        text.includes(URGENT_HELP) === manager,
      `AC16/17 ${email} sees ${expected.length} groups${manager ? " and Acil yönetim işleri beklemez." : ""} (${labels})`,
    );
    await p.context().close();
  }

  // ------------------------------------------------------------------ AC 43 (UI): the choir dues switch
  const sef = await phone(browser, "sef@arkhe.local");
  await go(sef, `${BASE}/finans/ayarlar`);
  const dues = sef.getByRole("switch", { name: /Aidat bildirimleri/ });
  const duesText = (await sef.getByTestId("dues-push").textContent()) ?? "";
  check(
    (await dues.getAttribute("aria-checked")) === "false" &&
      duesText.includes(
        "Yönetim kurulu açarsa koristlere aidat dönemi başlangıcında ve ödenmemiş aidat için ayda en fazla bir hatırlatma gider. Tutar yazılmaz.",
      ),
    "AC43 /finans/ayarlar has Aidat bildirimleri, off, with its help text",
  );
  await dues.click();
  await toast(sef, "Kaydedildi.");
  const kd = await phone(browser, "korist@arkhe.local");
  await profile(kd);
  check(
    (await switchLabels(kd)).includes("Aidat hatırlatmaları"),
    "AC16/43 with the board switch on, korist@ sees Aidat hatırlatmaları",
  );

  // ------------------------------------------------------------------ AC 54: 375 px, both themes
  const found = [];
  for (const colorScheme of ["light", "dark"]) {
    const pages = [];
    const p = await phone(browser, "yk@arkhe.local", {}, { colorScheme });
    await arrangeDevice("yk@arkhe.local", { label: "Android · Chrome" });
    pages.push(p);
    await nudge(p).waitFor();
    found.push(
      ...(await axe(p, "[data-testid=push-nudge]")).map((v) => `${colorScheme} nudge ${v}`),
    );
    found.push(
      ...(await layoutIssues(p, "[data-testid=push-nudge]")).map(
        (v) => `${colorScheme} nudge ${v}`,
      ),
    );
    if (shots) await nudge(p).screenshot({ path: `${shots}/p10-nudge-375-${colorScheme}.png` });
    await profile(p);
    const check1 = async (label) => {
      found.push(...(await axe(p, "#bildirimler")).map((v) => `${colorScheme} ${label} ${v}`));
      found.push(
        ...(await layoutIssues(p, "#bildirimler")).map((v) => `${colorScheme} ${label} ${v}`),
      );
      if (shots)
        await section(p).screenshot({
          path: `${shots}/p10-profile-${label}-375-${colorScheme}.png`,
        });
    };
    await check1("default");
    await section(p).getByRole("button", { name: "Bildirimleri aç" }).click();
    await p.locator("[data-testid=push-device][data-state=on]").waitFor();
    await profile(p);
    await check1("on");
    for (const s of states) {
      const q = await phone(browser, "korist@arkhe.local", s.stub, { colorScheme, ...s.ctx });
      pages.push(q);
      await profile(q);
      found.push(...(await axe(q, "#bildirimler")).map((v) => `${colorScheme} ${s.name} ${v}`));
      found.push(
        ...(await layoutIssues(q, "#bildirimler")).map((v) => `${colorScheme} ${s.name} ${v}`),
      );
      if (shots)
        await section(q).screenshot({
          path: `${shots}/p10-profile-${s.name}-375-${colorScheme}.png`,
        });
    }
    const f = await phone(browser, "sef@arkhe.local", {}, { colorScheme });
    pages.push(f);
    await go(f, `${BASE}/finans/ayarlar`);
    found.push(...(await axe(f, "[data-testid=dues-push]")).map((v) => `${colorScheme} dues ${v}`));
    found.push(...(await layoutIssues(f)).map((v) => `${colorScheme} dues ${v}`));
    if (shots)
      await f.screenshot({
        path: `${shots}/p10-finans-ayarlar-375-${colorScheme}.png`,
        fullPage: true,
      });
    // Desktop shots for the review.
    if (shots) {
      const d = await newPage(browser, { context: { colorScheme } });
      await stubPush(d.context());
      await login(d, "yk@arkhe.local");
      await d.waitForURL(`${BASE}/`);
      await profile(d);
      await d.screenshot({
        path: `${shots}/p10-profile-desktop-${colorScheme}.png`,
        fullPage: true,
      });
      pages.push(d);
    }
    for (const x of pages) await x.context().close();
    await db.execute(
      "delete from push_subscriptions where user_id = (select id from users where email = 'yk@arkhe.local')",
    );
  }
  check(
    found.length === 0,
    `AC54 Bildirimler, nudge and dues switch at 375 light/dark: axe and layout clean (${found.slice(0, 6)})`,
  );

  const switches = await kd
    .locator("#bildirimler [role=switch]")
    .evaluateAll((els) =>
      els.every(
        (el) => el.getAttribute("aria-checked") !== null && el.getAttribute("aria-labelledby"),
      ),
    );
  check(switches, "AC54 every switch is role=switch with aria-checked and a label");
  await kd.context().close();
  await sef.context().close();

  // ------------------------------------------------------------------ AC 54: tokens only
  const dir = new URL("../src/components/notifications/", import.meta.url).pathname;
  const hex = [];
  for (const f of await readdir(dir)) {
    const src = await readFile(path.join(dir, f), "utf8");
    if (/#[0-9a-fA-F]{3,8}\b/.test(src)) hex.push(f);
  }
  check(hex.length === 0, `AC54 no raw hex colours in src/components/notifications (${hex})`);
}
