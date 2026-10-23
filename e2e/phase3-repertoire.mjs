import { readFile } from "node:fs/promises";
import { BASE, check, db, loginAs } from "./lib.mjs";

const D = (id) => `https://drive.google.com/file/d/${id}/view`;
const ACTIONS_FILE = "src/app/(portal)/repertuvar/actions.ts";

async function pieceId(title) {
  const r = await db.execute({ sql: "select id from pieces where title = ?", args: [title] });
  return r.rows[0]?.id;
}

async function linksOf(id) {
  const r = await db.execute({
    sql: "select kind, voice_part, label, url, position from piece_links where piece_id = ? order by position",
    args: [id],
  });
  return r.rows;
}

/** Keeps the tests independent of Google/YouTube being reachable. */
async function offline(page) {
  await page.route(/https:\/\/([a-z-]+\.)*(google|youtube|youtube-nocookie)\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>stub</p>" }),
  );
  return page;
}

// The list streams in behind a loading skeleton; wait for real rows before reading it.
async function titles(page) {
  await page.locator("[data-testid=piece-row]").first().waitFor();
  return page.locator("[data-testid=piece-title]").allTextContents();
}

async function rowOf(page, title) {
  return page.locator("[data-testid=piece-row]", { hasText: title });
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function snapshot() {
  const r = await db.execute(
    "select (select group_concat(id || ':' || status || ':' || ifnull(program_position, '-') || ':' || title, '|') from (select * from pieces order by id)) as p, (select group_concat(id || ':' || position || ':' || url, '|') from (select * from piece_links order by id)) as l",
  );
  return `${r.rows[0].p}#${r.rows[0].l}`;
}

/** Action ids by exported name, from the dev server's manifest; each mapped to a page that serves it. */
async function actionIds(sampleId) {
  const manifest = JSON.parse(
    await readFile(new URL("../.next/dev/server/server-reference-manifest.json", import.meta.url)),
  );
  const ids = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.filename !== ACTIONS_FILE) continue;
    const worker = Object.keys(entry.workers).find((w) => w.includes("repertuvar"));
    const path = worker
      .replace(/^app/, "")
      .replace("/(portal)", "")
      .replace(/\/page$/, "")
      .replace("[id]", sampleId);
    ids[entry.exportedName] = { id, path };
  }
  return ids;
}

async function callAction(page, action, args) {
  return page.evaluate(
    async ({ id, path, args }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Next-Action": id,
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        body: JSON.stringify(args),
      });
      return res.text();
    },
    { ...action, args },
  );
}

export default async function phase3(browser, shots) {
  const sicut = await pieceId("Sicut Cervus");
  const bogo = await pieceId("Bogoroditse Devo");
  const gulum = await pieceId("Aman Gülüm");
  const ave = await pieceId("Ave Verum Corpus");
  const programBefore = (
    await db.execute("select id, program_position from pieces where program_position is not null")
  ).rows;

  try {
    await browse(browser, { sicut, bogo, gulum, ave }, shots);
    await manage(browser, { sicut, ave, gulum }, shots);
  } finally {
    await db.execute(
      "update pieces set program_position = null where program_position is not null",
    );
    for (const row of programBefore) {
      await db.execute({
        sql: "update pieces set program_position = ? where id = ?",
        args: [row.program_position, row.id],
      });
    }
  }
}

async function browse(browser, ids, shots) {
  const { sicut, bogo, gulum, ave } = ids;
  const korist = await offline(await loginAs(browser, "korist@arkhe.local"));

  // AC1 views and counts
  await korist.goto(`${BASE}/repertuvar`);
  check(
    JSON.stringify(await titles(korist)) ===
      JSON.stringify(["Aman Gülüm", "Ave Verum Corpus", "Hallelujah"]),
    "AC1 default view lists the Çalışılıyor pieces",
  );
  const chipText = await korist.locator("nav[aria-label='Repertuvar listesi'] a").allTextContents();
  check(
    chipText.join(",") === "Çalışılıyor3,Program3,Hazır2,Arşiv1,Tümü6",
    `AC1 chips show their counts (${chipText.join(",")})`,
  );
  await korist.click("nav[aria-label='Repertuvar listesi'] >> text=Hazır");
  await korist.waitForURL(/liste=hazir/);
  check(
    (await titles(korist)).join(",") === "Bogoroditse Devo,Sicut Cervus",
    "AC1 Hazır lists the ready pieces",
  );
  await korist.goto(`${BASE}/repertuvar?liste=arsiv`);
  check((await titles(korist)).join(",") === "Abendlied", "AC1 Arşiv lists the archived piece");
  await korist.goto(`${BASE}/repertuvar?liste=tumu`);
  check((await titles(korist)).length === 6, "AC1 Tümü lists every piece");

  // AC9 programme order
  await korist.goto(`${BASE}/repertuvar?liste=program`);
  check(
    (await titles(korist)).join(",") === "Sicut Cervus,Bogoroditse Devo,Aman Gülüm",
    "AC9 Program view is in programme order",
  );
  check(
    (await korist.locator("[data-testid=program-number]").allTextContents()).join(",") === "1,2,3",
    "AC9 programme pieces are numbered 1..n",
  );

  // AC2 search
  await korist.goto(`${BASE}/repertuvar?q=gulum`);
  check((await titles(korist)).join(",") === "Aman Gülüm", "AC2 'gulum' finds Aman Gülüm");
  await korist.goto(`${BASE}/repertuvar?q=Mozart`);
  check(
    (await titles(korist)).join(",") === "Ave Verum Corpus",
    "AC2 composer search finds Mozart",
  );
  await korist.goto(`${BASE}/repertuvar`);
  await korist.fill("input[name=q]", "Abendlied");
  await korist.press("input[name=q]", "Enter");
  await korist.waitForURL(/q=Abendlied/);
  check(
    (await titles(korist)).join(",") === "Abendlied" &&
      (await (await rowOf(korist, "Abendlied")).textContent()).includes("Arşiv"),
    "AC2 search finds archived pieces from the default view, with a status chip",
  );
  check(
    (await korist.textContent("[data-testid=search-summary]")).includes("tüm durumlar"),
    "AC2 search shows the all-statuses result line",
  );
  check(
    (await korist.locator("nav[aria-label='Repertuvar listesi'] a[aria-current]").count()) === 0,
    "AC2 no chip is current while searching",
  );
  await korist.goto(`${BASE}/repertuvar?q=zzzz`);
  await korist.locator("text=Eşleşen eser yok.").waitFor();
  check(true, "AC2 no match message");
  await korist.click("text=Aramayı temizle");
  await korist.waitForURL(`${BASE}/repertuvar`);
  check((await titles(korist)).length === 3, "AC2 Aramayı temizle returns to the list");

  // AC3 row meta
  const aveRow = await rowOf(korist, "Ave Verum Corpus");
  const aveMeta = await aveRow.locator("[data-testid=meta-chips]").textContent();
  check(
    aveMeta.includes("Latince") && aveMeta.includes("SATB") && aveMeta.includes("3:40"),
    "AC3 row shows language, voicing and duration 3:40",
  );
  check(
    (await (await rowOf(korist, "Aman Gülüm")).textContent()).includes(
      "Halk türküsü · düz. Koro Arkhe",
    ),
    "AC3 row shows composer and arranger",
  );

  // AC4 direct part link
  const avePart = aveRow.getByRole("link", { name: /^Partisyonum/ });
  check(
    (await avePart.getAttribute("href")) === D("seedAveAlto"),
    "AC4 Partisyonum opens the alto file",
  );
  check(
    (await avePart.getAttribute("target")) === "_blank" &&
      (await avePart.getAttribute("rel")).includes("noopener"),
    "AC4 Partisyonum opens in a new tab with noopener",
  );

  // AC5 Tutti fallback and disabled
  const gulumPart = (await rowOf(korist, "Aman Gülüm")).getByRole("link", { name: /^Partisyonum/ });
  check(
    (await gulumPart.getAttribute("href")) === D("seedGulumTutti"),
    "AC5 falls back to the Tutti file",
  );
  const hallButton = (await rowOf(korist, "Hallelujah")).getByRole("button", {
    name: "Partisyon kaydı yok",
  });
  check(await hallButton.isDisabled(), "AC5 no part file gives a disabled 'Partisyon kaydı yok'");

  // AC7 part filter on the detail page
  await korist.goto(`${BASE}/repertuvar/${sicut}`);
  const labels = async () => korist.locator("[data-testid=link-label]").allTextContents();
  // Unlabelled links are named by their part under the kind's section heading.
  const inGroup = (kind) =>
    korist
      .locator(`section[aria-labelledby=group-${kind}] [data-testid=link-label]`)
      .allTextContents();
  check(
    (await inGroup("part")).join(",") === "Alto" && (await inGroup("score")).join(",") === "Tutti",
    "AC7 default filter shows alto + Tutti only",
  );
  check(
    (await korist.locator("nav[aria-label='Partisyon filtresi'] a[aria-current]").textContent()) ===
      "Benim partisyonum (Alto)",
    "AC7 default chip is 'Benim partisyonum (Alto)'",
  );
  await korist.click("nav[aria-label='Partisyon filtresi'] >> text=Tümü");
  await korist.waitForURL(/partisyon=tumu/);
  check((await labels()).length === 6, "AC7 Tümü shows every link");
  await korist.goto(`${BASE}/repertuvar/${sicut}?partisyon=bas`);
  check(
    (await inGroup("part")).join(",") === "Bas" && (await inGroup("score")).join(",") === "Tutti",
    "AC7 ?partisyon=bas shows bass + Tutti",
  );
  check(
    (await korist.locator("nav[aria-label='Partisyon filtresi'] a[aria-current]").textContent()) ===
      "Bas",
    "AC7 a third active Bas chip appears",
  );

  // AC8 previews
  await korist.goto(`${BASE}/repertuvar/${ave}?partisyon=tumu`);
  check((await korist.locator("iframe").count()) === 0, "AC8 no iframe before Önizle");
  const preview = (kind) =>
    korist
      .locator(`section[aria-labelledby=group-${kind}] [data-testid=link-row]`)
      .first()
      .getByRole("button", { name: /Önizle/ });
  await preview("score").click();
  let frame = korist.locator("iframe");
  check(
    (await frame.getAttribute("src")) ===
      "https://drive.google.com/file/d/seedAveNota/preview?resourcekey=0-seedKey123",
    "AC8 Drive preview src keeps the resourcekey",
  );
  check(
    (await frame.getAttribute("referrerpolicy")) === "strict-origin-when-cross-origin" &&
      (await frame.getAttribute("sandbox")) === null &&
      Boolean(await frame.getAttribute("title")),
    "AC8 iframe has title and referrerpolicy, no sandbox",
  );
  check(
    await korist.locator("text=Önizleme açılmıyorsa").isVisible(),
    "AC8 Drive fallback line shows under the preview",
  );
  await preview("video").click();
  check(
    (await korist.locator("iframe").count()) === 1,
    "AC8 opening a second preview closes the first",
  );
  check(
    (await korist.locator("iframe").getAttribute("src")) ===
      "https://www.youtube-nocookie.com/embed/arkheAveV01",
    "AC8 YouTube preview uses youtube-nocookie",
  );
  await korist
    .locator("section[aria-labelledby=group-video]")
    .getByRole("button", { name: /Kapat/ })
    .click();
  check((await korist.locator("iframe").count()) === 0, "AC8 Kapat removes the iframe");
  await korist.goto(`${BASE}/repertuvar/${sicut}?partisyon=tumu`);
  await preview("video").click();
  check(
    (await korist.locator("iframe").getAttribute("src")) ===
      "https://www.youtube-nocookie.com/embed/arkheSicut1?start=45",
    "AC8 YouTube start time is kept",
  );
  await korist.goto(`${BASE}/repertuvar/${gulum}`);
  await preview("folder").click();
  check(
    (await korist.locator("iframe").getAttribute("src")) ===
      "https://drive.google.com/embeddedfolderview?id=seedGulumKlasor#list",
    "AC8 Drive folder preview",
  );

  // AC10 member has no manager controls
  await korist.goto(`${BASE}/repertuvar`);
  check((await korist.locator("text=Eser ekle").count()) === 0, "AC10 member sees no Eser ekle");
  await korist.goto(`${BASE}/repertuvar/${sicut}`);
  check(
    (await korist
      .locator("[aria-label='Eseri düzenle'], [aria-label='Diğer işlemler']")
      .count()) === 0,
    "AC10 member sees no edit or menu controls",
  );
  // The repertoire loading skeleton streams first, so the redirect may land client-side.
  await korist.goto(`${BASE}/repertuvar/yeni`);
  await korist.waitForURL(`${BASE}/`);
  check(true, "AC10 /repertuvar/yeni redirects members");
  await korist.goto(`${BASE}/repertuvar/${sicut}/duzenle`);
  await korist.waitForURL(`${BASE}/`);
  check(true, "AC10 edit page redirects members");

  // AC19 home
  await korist.goto(`${BASE}/`);
  const home = korist.locator("[data-testid=home-pieces]");
  check(
    (await korist.locator("h2", { hasText: "Çalışılan eserler" }).count()) === 1 &&
      (await home.locator("[data-testid=piece-title]").allTextContents()).join(",") ===
        "Aman Gülüm,Ave Verum Corpus,Hallelujah",
    "AC19 home lists the learning pieces",
  );
  check(
    (await home
      .getByRole("link", { name: /^Partisyonum/ })
      .first()
      .getAttribute("href")) === D("seedGulumTutti"),
    "AC19 home Partisyonum works",
  );
  check(
    (await korist.locator("text=Örnek veri").count()) === 0,
    "AC19 the sample-data pill is gone",
  );

  // AC20 CSP
  const res = await korist.request.get(`${BASE}/repertuvar`);
  const frameSrc = res
    .headers()
    ["content-security-policy"].split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("frame-src"));
  check(
    frameSrc === "frame-src https://drive.google.com https://www.youtube-nocookie.com",
    "AC20 CSP frame-src is Drive + youtube-nocookie only",
  );
  await korist.context().close();

  // AC5 chooser for a soprano
  const yk = await offline(await loginAs(browser, "yk@arkhe.local"));
  await yk.goto(`${BASE}/repertuvar?liste=hazir`);
  await (await rowOf(yk, "Bogoroditse Devo")).getByRole("button", { name: /^Partisyonum/ }).click();
  const chooser = yk.locator("[data-testid=part-chooser]");
  await chooser.waitFor();
  const options = chooser.locator("ul a");
  check(
    (await options.allTextContents())
      .map((t) => t.replace(", yeni sekmede açılır", ""))
      .join(",") === "Soprano 1,Soprano 2" &&
      (await options.nth(0).getAttribute("href")) === D("seedBogoS1") &&
      (await options.nth(1).getAttribute("href")) === D("seedBogoS2"),
    "AC5 soprano gets a chooser with Soprano 1 and Soprano 2",
  );
  await yk.context().close();

  // AC6 no voice part
  const sef = await offline(await loginAs(browser, "sef@arkhe.local"));
  await sef.goto(`${BASE}/repertuvar`);
  check(
    (await sef.locator("text=Partisyonum").count()) === 0 &&
      (await sef.locator("text=Partisyon kaydı yok").count()) === 0,
    "AC6 no Partisyonum without a voice part (list)",
  );
  await sef.goto(`${BASE}/`);
  check((await sef.locator("text=Partisyonum").count()) === 0, "AC6 no Partisyonum on home");
  await sef.goto(`${BASE}/repertuvar/${bogo}`);
  check(
    (await sef.locator("nav[aria-label='Partisyon filtresi']").count()) === 0 &&
      (await sef.locator("[data-testid=link-row]").count()) === (await linksOf(bogo)).length,
    "AC6 detail page has no part filter and shows every link",
  );
  await sef.context().close();

  // AC21 phones: no horizontal scroll, 44px targets
  const phone = await offline(await loginAs(browser, "korist@arkhe.local", { mobile: true }));
  await phone.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    "/",
    "/repertuvar",
    "/repertuvar?liste=program",
    "/repertuvar?liste=tumu",
    `/repertuvar/${sicut}?partisyon=tumu`,
    `/repertuvar/${ave}`,
  ]) {
    for (const scheme of ["light", "dark"]) {
      await phone.emulateMedia({ colorScheme: scheme });
      await phone.goto(`${BASE}${path}`);
      await phone.locator("main h1").first().waitFor();
      check(await noHorizontalScroll(phone), `AC21 no horizontal scroll on ${path} (${scheme})`);
    }
  }
  await phone.goto(`${BASE}/repertuvar`);
  await phone.locator("[data-testid=piece-row]").first().waitFor();
  if (shots) await phone.screenshot({ path: `${shots}/repertoire-mobile.png`, fullPage: true });
  const heights = await phone
    .locator(
      "nav[aria-label='Repertuvar listesi'] a, [data-testid=piece-row] a[target=_blank], [data-testid=piece-row] button",
    )
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  check(
    heights.length > 0 && heights.every((h) => h >= 43.5),
    `AC21 chips and part buttons are ≥ 44px (${heights.map(Math.round).join(",")})`,
  );
  await phone.context().close();
}

async function manage(browser, ids, shots) {
  const { sicut, ave, gulum } = ids;
  const sef = await offline(await loginAs(browser, "sef@arkhe.local"));

  // AC11 create
  await sef.goto(`${BASE}/repertuvar/yeni`);
  await sef.click("main button[type=submit]");
  await sef.waitForSelector("text=Eser adı gerekli.");
  check(true, "AC11 empty title shows 'Eser adı gerekli.'");
  await sef.fill("input[name=title]", "E2E Deneme Eseri");
  await sef.fill("input[name=duration]", "abc");
  await sef.click("main button[type=submit]");
  await sef.waitForSelector("text=Süreyi dakika:saniye olarak gir (ör. 3:40).");
  check(true, "AC11 'abc' duration is rejected");
  await sef.fill("input[name=composer]", "E2E Besteci");
  await sef.fill("input[name=arranger]", "E2E Düzenleyen");
  await sef.fill("input[name=language]", "Latince");
  await sef.fill("input[name=voicing]", "SATB");
  await sef.fill("input[name=duration]", "4:05");
  await sef.locator("label", { hasText: "Hazır" }).click();
  await sef.fill("textarea[name=notes]", "E2E not");
  await sef.click("main button[type=submit]");
  await sef.waitForURL(/\/duzenle#baglantilar$/);
  check(
    await sef.locator("text=Eser eklendi. Şimdi bağlantılarını ekle.").isVisible(),
    "AC11 create lands on the edit page's links with a toast",
  );
  const e2e = await pieceId("E2E Deneme Eseri");
  await sef.goto(`${BASE}/repertuvar?liste=hazir`);
  check(
    (await (await rowOf(sef, "E2E Deneme Eseri")).textContent()).includes("4:05"),
    "AC11 the new piece shows under its status with 4:05",
  );
  await sef.goto(`${BASE}/repertuvar/${e2e}/duzenle`);
  await sef.fill("input[name=duration]", "4.05");
  await sef.click("form:has(input[name=title]) button[type=submit]");
  await sef.waitForSelector("text=Kaydedildi.");
  const dur = await db.execute({
    sql: "select duration_sec from pieces where id = ?",
    args: [e2e],
  });
  check(dur.rows[0].duration_sec === 245, "AC11 '4.05' is saved as 4:05");

  // AC13 folder field
  await sef.fill("input[name=driveFolderUrl]", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await sef.click("form:has(input[name=title]) button[type=submit]");
  await sef.waitForSelector("text=Bu bir Google Drive bağlantısı değil.");
  check(true, "AC13 a non-Drive link is rejected as the piece's Drive link");
  await sef.goto(`${BASE}/repertuvar/${e2e}/duzenle`);
  await sef.fill(
    "input[name=driveFolderUrl]",
    "https://drive.google.com/file/d/1ksbZrWlLz1xV-NhEhkk_bWuD-7g5zBAK/view?usp=drivesdk",
  );
  await sef.click("form:has(input[name=title]) button[type=submit]");
  await sef.waitForSelector("text=Kaydedildi.");
  const fileLink = await db.execute({
    sql: "select drive_folder_url from pieces where id = ?",
    args: [e2e],
  });
  check(
    fileLink.rows[0].drive_folder_url ===
      "https://drive.google.com/file/d/1ksbZrWlLz1xV-NhEhkk_bWuD-7g5zBAK/view",
    "AC13 a Drive file link is accepted and normalised",
  );
  await sef.goto(`${BASE}/repertuvar/${e2e}`);
  check(
    (await sef.getByRole("heading", { name: "Drive dosyası" }).count()) === 1,
    "AC13 the piece page labels a file link 'Drive dosyası'",
  );
  await db.execute({ sql: "update pieces set drive_folder_url = null where id = ?", args: [e2e] });
  await sef.goto(`${BASE}/repertuvar/${e2e}/duzenle`);

  // AC12 normalisation
  const addForm = sef.locator("form:has(#add-url)");
  async function addLink(url, { kind, part, label } = {}) {
    await sef.fill("#add-url", url);
    if (kind) await addForm.locator("label", { hasText: kind }).click();
    if (part) await addForm.locator("label", { hasText: part }).click();
    if (label) await sef.fill("#add-label", label);
    await addForm.locator("button[type=submit]").click();
  }
  await addLink("https://drive.google.com/open?id=ABC123");
  await sef.waitForSelector("text=Bağlantı eklendi.");
  await addLink("https://youtu.be/XYZ?si=foo");
  await sef.locator("[data-testid=editor-link]").nth(1).waitFor();
  let stored = await linksOf(e2e);
  check(
    stored[0]?.url === "https://drive.google.com/file/d/ABC123/view",
    "AC12 open?id= is stored as file/d/…/view",
  );
  check(
    stored[1]?.url === "https://www.youtube.com/watch?v=XYZ" && stored[1]?.kind === "video",
    "AC12 youtu.be is stored as watch?v=",
  );

  // AC13 rejections
  for (const bad of [
    "http://example.com/a",
    "javascript:alert(1)",
    "ftp://example.com/a",
    "https://drive.google.com@evil.com/x",
  ]) {
    await addLink(bad);
    await addForm.locator("text=Geçerli bir https bağlantısı gir.").waitFor();
    check(true, `AC13 '${bad}' is rejected`);
  }
  await addLink("https://drive.google.com/file/d/ABC123/view?usp=sharing");
  await addForm.locator("text=Bu bağlantı bu eserde zaten var.").waitFor();
  check(true, "AC13 a duplicate link is rejected");
  check((await linksOf(e2e)).length === 2, "AC13 rejected links are not stored");

  // AC15 derived label
  await sef.goto(`${BASE}/repertuvar/${e2e}/duzenle`);
  await addLink("https://drive.google.com/file/d/E2EAlto/view", {
    kind: "Partisyon kaydı",
    part: "Alto",
  });
  await sef.locator("[data-testid=editor-link]").nth(2).waitFor();
  check(
    (await sef.locator("[data-testid=editor-link-label]").nth(2).textContent()) ===
      "Partisyon kaydı · Alto",
    "AC15 an empty label shows the derived label",
  );
  // Labels up to 120 characters are accepted end to end (the DB CHECK used to stop at 80).
  const longLabel = "E2E uzun etiket ".padEnd(120, "x");
  await addLink("https://drive.google.com/file/d/E2ELong/view", { label: longLabel });
  await sef.locator("[data-testid=editor-link]").nth(3).waitFor();
  check(
    (await linksOf(e2e)).some((l) => l.label === longLabel),
    "review: a 120-character label is saved",
  );
  await db.execute({
    sql: "delete from piece_links where piece_id = ? and label = ?",
    args: [e2e, longLabel],
  });
  await sef.reload();

  // AC14 bulk paste
  await sef.click("text=Toplu bağlantı ekle");
  await sef.fill(
    "#bulk-text",
    Array.from({ length: 51 }, (_, i) => `https://drive.google.com/file/d/E2Ebulk${i}/view`).join(
      "\n",
    ),
  );
  await sef
    .locator("[data-testid=bulk-paste]")
    .getByRole("button", { name: "Önizle", exact: true })
    .click();
  await sef.waitForSelector("text=En fazla 50 satır yapıştırabilirsin.");
  check(true, "AC14 51 lines are refused");
  await sef.fill(
    "#bulk-text",
    [
      "Soprano 1 MIDI https://drive.google.com/file/d/E2ES1/view",
      "Alto mp3 | https://drive.google.com/file/d/E2EA1/view",
      "Tenor https://drive.google.com/file/d/E2ET1/view",
      "Nota https://drive.google.com/file/d/E2EN1/view",
      "https://youtu.be/E2EYT1",
      "not a url",
      "Eski https://drive.google.com/open?id=ABC123",
    ].join("\n"),
  );
  await sef
    .locator("[data-testid=bulk-paste]")
    .getByRole("button", { name: "Önizle", exact: true })
    .click();
  await sef.waitForSelector("[data-testid=bulk-summary]");
  check(
    (await sef.textContent("[data-testid=bulk-summary]")).startsWith("5 geçerli, 2 hatalı"),
    "AC14 preview shows 5 valid rows and the invalid and duplicate rows",
  );
  check(
    await sef
      .locator("[data-testid=bulk-paste] table >> text=Bu bağlantı bu eserde zaten var.")
      .isVisible(),
    "AC14 a duplicate of an existing link is flagged",
  );
  const table = sef.locator("[data-testid=bulk-paste] table");
  const kinds = await table
    .locator("select[aria-label$='türü']")
    .evaluateAll((els) => els.map((e) => e.value));
  const parts = await table
    .locator("select[aria-label$='partisyonu']")
    .evaluateAll((els) => els.map((e) => e.value));
  check(
    kinds.join(",") === "part,part,part,score,video" && parts.join(",") === "soprano,alto,tenor,,",
    `AC14 guessed kinds and parts (${kinds.join(",")} / ${parts.join(",")})`,
  );
  await table.locator("select[aria-label='3. satır türü']").selectOption("score");
  await sef.click("text=Kaydet (5 bağlantı)");
  await sef.waitForSelector("text=5 bağlantı eklendi.");
  stored = (await linksOf(e2e)).slice(3);
  check(
    stored.map((l) => `${l.kind}/${l.voice_part ?? "tutti"}`).join(",") ===
      "part/soprano,part/alto,score/tenor,score/tutti,video/tutti" &&
      stored[0].label === "Soprano 1 MIDI" &&
      stored[1].label === "Alto mp3",
    "AC14 exactly the 5 rows are saved in order with the edit applied",
  );

  // AC16 reorder and delete
  await sef.goto(`${BASE}/repertuvar/${e2e}/duzenle`);
  const editorLabels = () => sef.locator("[data-testid=editor-link-label]").allTextContents();
  const before = await editorLabels();
  const rows = sef.locator("[data-testid=editor-link]");
  check(
    (await rows.first().locator("[data-move=up]").isDisabled()) &&
      (await rows.last().locator("[data-move=down]").isDisabled()),
    "AC16 first up and last down are disabled",
  );
  await rows.nth(1).locator("[data-move=up]").click();
  await sef.waitForFunction(
    (first) => document.querySelector("[data-testid=editor-link-label]").textContent !== first,
    before[0],
  );
  await sef.waitForTimeout(500);
  check(
    await sef.evaluate(() => document.activeElement?.matches("[data-row] [data-move]") ?? false),
    "review: focus stays on the moved row's button after a link move",
  );
  await sef.reload();
  const after = await editorLabels();
  check(after[0] === before[1] && after[1] === before[0], "AC16 reorder persists after reload");
  await rows
    .first()
    .getByRole("button", { name: /^İşlemler/ })
    .click();
  await sef.getByRole("menuitem", { name: "Sil" }).click();
  await sef.waitForSelector("text=Bağlantı silinsin mi?");
  await sef.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  await sef.waitForSelector("text=Bağlantı silindi.");
  check((await linksOf(e2e)).length === 7, "AC16 delete removes the link after a confirm");

  // AC17 programme
  await sef.goto(`${BASE}/repertuvar/${e2e}`);
  await sef.click("[aria-label='Diğer işlemler']");
  await sef.getByRole("menuitem", { name: "Programa ekle" }).click();
  await sef.waitForSelector("text=Programda 4. sıra");
  check(true, "AC17 Programa ekle appends to the end of the programme");
  await sef.goto(`${BASE}/repertuvar?liste=program`);
  await sef.click("text=Sırayı düzenle");
  await sef.locator("[data-row] [aria-label='Yukarı taşı: E2E Deneme Eseri']").click();
  await sef.waitForTimeout(800);
  check(
    await sef.evaluate(
      () =>
        document.activeElement?.getAttribute("aria-label")?.endsWith("E2E Deneme Eseri") ?? false,
    ),
    "review: focus stays on the moved programme row",
  );
  await sef.reload();
  check(
    (await titles(sef)).join(",") === "Sicut Cervus,Bogoroditse Devo,E2E Deneme Eseri,Aman Gülüm",
    "AC17 programme reorder persists after reload",
  );
  // Archiving a programme piece asks first and takes it out of the programme.
  await sef.goto(`${BASE}/repertuvar/${e2e}`);
  await sef.click("[aria-label='Diğer işlemler']");
  await sef.getByRole("menuitem", { name: "Arşivle" }).click();
  await sef.waitForSelector("text=Arşivlenen eser programdan da çıkar.");
  await sef.getByRole("alertdialog").getByRole("button", { name: "Arşivle" }).click();
  await sef.waitForSelector("text=Arşive taşındı.");
  const archived = await db.execute({
    sql: "select status, program_position from pieces where id = ?",
    args: [e2e],
  });
  check(
    archived.rows[0].status === "archive" && archived.rows[0].program_position === null,
    "AC17 archiving a programme piece removes it from the programme",
  );
  // AC18 archive keeps links; Arşivden çıkar → Hazır
  check((await linksOf(e2e)).length === 7, "AC18 archived piece keeps its links");
  await sef.reload();
  await sef.click("[aria-label='Diğer işlemler']");
  await sef.getByRole("menuitem", { name: "Arşivden çıkar" }).click();
  await sef.waitForSelector("text=Arşivden çıkarıldı.");
  const restored = await db.execute({ sql: "select status from pieces where id = ?", args: [e2e] });
  check(restored.rows[0].status === "concert", "AC18 Arşivden çıkar puts it back under Hazır");

  await sef.goto(`${BASE}/repertuvar?liste=program`);
  await sef.click("text=Sırayı düzenle");
  await sef.click("text=Programı temizle");
  await sef.waitForSelector("text=Program temizlensin mi?");
  await sef.getByRole("alertdialog").getByRole("button", { name: "Programı temizle" }).click();
  await sef.waitForSelector("text=Program temizlendi.");
  const left = await db.execute(
    "select count(*) as n from pieces where program_position is not null",
  );
  check(left.rows[0].n === 0, "AC17 Programı temizle empties the programme");
  const member = await loginAs(browser, "korist@arkhe.local");
  await member.goto(`${BASE}/repertuvar`);
  check(
    (await member.locator("nav[aria-label='Repertuvar listesi'] >> text=Program").count()) === 0,
    "AC9 members don't see the Program chip when it's empty",
  );

  // AC10 server-side authorization: each action called as a member
  const actions = await actionIds(sicut);
  const calls = {
    createPiece: [{}, {}],
    updatePiece: [sicut, {}, {}],
    setPieceStatus: [sicut, "archive"],
    deletePiece: [sicut],
    addLink: [sicut, {}, {}],
    updateLink: [sicut, sicut, {}, {}],
    deleteLink: [sicut, sicut],
    reorderLinks: [sicut, []],
    saveBulkLinks: [sicut, {}, {}],
    addToProgram: [ave],
    removeFromProgram: [sicut],
    reorderProgram: [[]],
    clearProgram: [],
  };
  const beforeAuth = await snapshot();
  let allRefused = true;
  for (const [name, args] of Object.entries(calls)) {
    if (!actions[name]) {
      allRefused = false;
      console.log(`missing action id: ${name}`);
      continue;
    }
    const body = await callAction(member, actions[name], args);
    if (!body.includes("Bu işlem için yetkin yok.")) {
      allRefused = false;
      console.log(`${name} did not refuse: ${body.slice(0, 200)}`);
    }
  }
  check(allRefused, `AC10 all ${Object.keys(calls).length} actions refuse a member`);
  check((await snapshot()) === beforeAuth, "AC10 refused actions change no rows");
  await member.context().close();

  // AC18 delete from the edit page
  await sef.goto(`${BASE}/repertuvar/${e2e}`);
  check(
    (await sef.locator("text=Eseri sil").count()) === 0,
    "AC18 delete is not on the detail page",
  );
  await sef.goto(`${BASE}/repertuvar/${e2e}/duzenle`);
  await sef.click("text=Eseri sil");
  await sef.waitForSelector(
    'text="E2E Deneme Eseri" kalıcı olarak silinsin mi? Bağlantıları da silinir.',
  );
  await sef.getByRole("alertdialog").getByRole("button", { name: "Kalıcı olarak sil" }).click();
  await sef.waitForURL(`${BASE}/repertuvar`);
  await sef.waitForSelector("text=Eser silindi.");
  const gone = await db.execute({
    sql: "select (select count(*) from pieces where id = ?) + (select count(*) from piece_links where piece_id = ?) as n",
    args: [e2e, e2e],
  });
  check(gone.rows[0].n === 0, "AC18 delete removes the piece and its links");

  // AC21 manager screens on a phone, bulk preview open
  const phone = await offline(await loginAs(browser, "yk@arkhe.local", { mobile: true }));
  await phone.setViewportSize({ width: 375, height: 812 });
  for (const scheme of ["light", "dark"]) {
    await phone.emulateMedia({ colorScheme: scheme });
    await phone.goto(`${BASE}/repertuvar/yeni`);
    check(
      await noHorizontalScroll(phone),
      `AC21 no horizontal scroll on /repertuvar/yeni (${scheme})`,
    );
    await phone.goto(`${BASE}/repertuvar/${gulum}/duzenle`);
    await phone.click("text=Toplu bağlantı ekle");
    await phone.fill(
      "#bulk-text",
      "Soprano 1 MIDI https://drive.google.com/file/d/E2Ephone/view\nnot a url",
    );
    await phone
      .locator("[data-testid=bulk-paste]")
      .getByRole("button", { name: "Önizle", exact: true })
      .click();
    await phone.waitForSelector("[data-testid=bulk-row]");
    check(
      await noHorizontalScroll(phone),
      `AC21 no horizontal scroll on the edit page with bulk preview (${scheme})`,
    );
    if (shots && scheme === "dark")
      await phone.screenshot({ path: `${shots}/bulk-mobile-dark.png`, fullPage: true });
  }
  await phone.goto(`${BASE}/uyeler`);
  const chipHeights = await phone
    .locator("nav[aria-label='Partisyon filtresi'] a")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  check(
    chipHeights.length > 0 && chipHeights.every((h) => h >= 43.5),
    "AC21 /uyeler chips are ≥ 44px",
  );
  await phone.context().close();
  await sef.context().close();
}
