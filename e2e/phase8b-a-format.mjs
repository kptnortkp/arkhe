// Phase 8b, part A: access, entry points, the template pack, file format and the error preview
// (AC 1–6, 8–16, 43).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { BASE, check, cleanup, db, loginAs, newPage } from "./lib.mjs";
import {
  arrangeCast,
  checkUI,
  clipboard,
  count,
  crafted,
  craftedUndo,
  csv,
  dayFrom,
  diff,
  docFile,
  DOCS,
  fileBase,
  grantClipboard,
  H,
  importActions,
  readResult,
  setJoined,
  sha256,
  SLUGS,
  snapshot,
  win1254,
} from "./import.mjs";

const PAGES = ["/ice-aktar", ...SLUGS.map((s) => `/ice-aktar/${s}`), "/ice-aktar/gecmis"];
const TITLES = [
  "Üye geçmişi",
  "Çalışma dönemleri",
  "Çalışmalar ve yoklama",
  "Finans hareketleri",
  "Aidat dönemleri",
  "Aidat ödemeleri ve muafiyetler",
];

/** The `.md` table's column names and every backticked value of its "İzin verilen değerler" cell. */
const LIVE_HEADS = ["AİDAT DÖNEMLERİ (", "ETKİNLİKLER (", "PORTALDA ELLE GİRİLMİŞ HAREKETLER"];
/** Drops the lines the portal fills in under each live block head, up to the next blank line. */
function withoutLive(text) {
  const out = [];
  let skipping = false;
  for (const line of text.split("\n")) {
    if (skipping && line.trim() === "") skipping = false;
    if (skipping) continue;
    out.push(line);
    if (LIVE_HEADS.some((h) => line.startsWith(h))) skipping = true;
  }
  return out.join("\n");
}
const LIVE_SLUGS = ["hareketler", "aidat-odemeleri"];

function mdTable(md) {
  const rows = md
    .split("\n")
    .filter((l) => l.startsWith("| `"))
    .map((l) => l.split(" | "));
  return {
    columns: rows.map((r) => r[0].replace(/^\| `|`$/g, "")),
    codes: rows.flatMap((r) => [...(r[3] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1])),
    prompt: /```text\n([\s\S]*?)\n```/.exec(md)?.[1] ?? "",
  };
}

async function overflowAndTargets(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const small = [...document.querySelectorAll("main a, main button, main summary, main [role=tab]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || el.closest("[aria-hidden=true], .sr-only")) return false;
        // Inline text links inside running text are exempt (WCAG 2.5.8 inline exception).
        if (el.tagName === "A" && getComputedStyle(el).display === "inline") return false;
        return r.height < 43.5;
      })
      .map((el) => `${el.tagName} "${el.textContent.trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}`);
    return { overflow, small };
  });
}

export default async function run(browser, shots) {
  await cleanup();
  await arrangeCast();
  await setJoined("%@ornek.com", "2019-01-01");

  const sef = await loginAs(browser, "sef@arkhe.local");
  const yk = await loginAs(browser, "yk@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");
  await grantClipboard(yk);

  // AC 1: managers only, on the server.
  for (const [who, page] of [["sef", sef], ["yk", yk]]) {
    const statuses = [];
    for (const p of PAGES) statuses.push((await page.goto(`${BASE}${p}`)).status());
    check(statuses.every((s) => s === 200), `8b AC1 ${who}@ gets 200 on the 8 import pages (${statuses})`);
  }
  const landed = [];
  for (const p of PAGES) {
    await korist.goto(`${BASE}${p}`);
    // Pages with a loading.tsx stream first, so the redirect lands client-side.
    await korist.waitForURL(`${BASE}/`, { timeout: 10_000 }).catch(() => {});
    landed.push(new URL(korist.url()).pathname);
  }
  check(landed.every((p) => p === "/"), `8b AC1 korist@ is redirected to / from every import page (${landed})`);
  const anon = await newPage(browser);
  const anonRes = [];
  for (const p of [...PAGES, "/ice-aktar/uyeler/ornek", "/ice-aktar/uyeler/talimat", "/ice-aktar/uye-listesi"]) {
    const res = await anon.request.get(`${BASE}${p}`, { maxRedirects: 0 });
    anonRes.push([307, 303, 302].includes(res.status()) && (res.headers().location ?? "").includes("/giris"));
  }
  check(anonRes.every(Boolean), "8b AC1 logged-out requests to pages and downloads go to the login page");
  await anon.context().close();
  const koristDownloads = [];
  for (const p of ["/ice-aktar/yoklama/ornek", "/ice-aktar/yoklama/talimat", "/ice-aktar/uye-listesi"]) {
    const res = await korist.request.get(`${BASE}${p}`);
    const body = await res.text();
    koristDownloads.push(res.status() === 403 && body.startsWith("{") && !body.includes("eposta"));
  }
  check(koristDownloads.every(Boolean), "8b AC1 the three download routes answer korist@ with the JSON 403 and no file");

  await importActions(sef);
  const text = `${H.donemler}\nE2E Yetki Dönem;2021-09-01;2022-01-31\n`;
  const before = await snapshot();
  const kc = await crafted(korist, "checkImport", "donemler", { text });
  const kk = await crafted(korist, "commitImport", "donemler", { text, sha: sha256(Buffer.from(text)) });
  const ku = await craftedUndo(korist, 1);
  check(
    [kc.body, kk.body, ku].every((b) => b.includes("Bu işlem için yetkin yok.")),
    "8b AC1 korist@'s check, import and undo calls are refused with Bu işlem için yetkin yok.",
  );
  check(diff(before, await snapshot()).length === 0, "8b AC1 korist@'s calls wrote nothing");

  // AC 2: entry points; no nav entry.
  for (const [who, page] of [["sef", sef], ["yk", yk]]) {
    const found = [];
    for (const p of ["/profil", "/yedek", "/finans/ayarlar"]) {
      await page.goto(`${BASE}${p}`);
      const link = page.locator('main a[href="/ice-aktar"]', { hasText: "Veri içe aktar" });
      // The page streams in after its loading state.
      await link.first().waitFor({ timeout: 10_000 }).catch(() => {});
      found.push(await link.count());
    }
    check(found.every((n) => n === 1), `8b AC2 ${who}@ sees Veri içe aktar on Profil, Yedekleme and Ayarlar (${found})`);
  }
  await korist.goto(`${BASE}/profil`);
  check((await korist.locator('a[href="/ice-aktar"]').count()) === 0, "8b AC2 korist@'s Profil has no import link");
  for (const phone of [true, false]) {
    const p = await loginAs(browser, "yk@arkhe.local", { phone });
    await p.goto(`${BASE}/`);
    check(
      (await p.locator('nav a[href^="/ice-aktar"]').count()) === 0,
      `8b AC2 neither sidebar nor bottom bar links to /ice-aktar (${phone ? 375 : 1280} px)`,
    );
    await p.context().close();
  }

  // AC 3: the index.
  await yk.goto(`${BASE}/ice-aktar`);
  await yk.getByRole("heading", { name: "Adımlar" }).waitFor();
  const index = await yk.locator("main").innerText();
  check(
    index.includes("Eski kayıtlarını (Excel, Sheets, kâğıt) toplu olarak portala aktar. Önce dosyanı kontrol ederiz, hiçbir şey yazılmaz; sonra tek seferde aktarırsın."),
    "8b AC3 index has the title and the intro",
  );
  check(
    (await yk.getByTestId("backup-line").innerText()).includes("Henüz yedek yok.") &&
      (await yk.getByTestId("backup-line").locator('a[href="/yedek"]').count()) === 1,
    "8b AC3 backup line: Henüz yedek yok. with a link to /yedek",
  );
  check(
    (await yk.locator('a[href="/ice-aktar/uye-listesi"]', { hasText: "Üye listesini indir" }).count()) === 1,
    "8b AC3 index offers Üye listesini indir",
  );
  check(
    /Açılış: \d{1,2} \S+ \d{4} · Kasa ₺[\d.,]+ · Banka ₺[\d.,]+/.test(await yk.getByTestId("opening-line").innerText()) &&
      (await yk.locator('a[href="/finans/ayarlar"]', { hasText: "Ayarlar'a git" }).count()) === 1,
    `8b AC3 step 0 shows the opening balance and Ayarlar'a git (${await yk.getByTestId("opening-line").innerText()})`,
  );
  const cards = await yk.locator("[data-testid=step-card]").evaluateAll((els) =>
    els.map((e) => ({ step: e.dataset.step, text: e.innerText, href: e.querySelector("a")?.getAttribute("href") })),
  );
  check(
    cards.map((c) => c.step).join() === "0,1,2,3,4,5,6" &&
      TITLES.every((t, i) => cards[i + 1].text.includes(t) && cards[i + 1].href === `/ice-aktar/${SLUGS[i]}`),
    "8b AC3 seven step cards in D1 order, each type linking to its page",
  );
  check(
    cards.slice(1).every((c) => c.text.includes("Henüz aktarılmadı")),
    "8b AC3 every type reads Henüz aktarılmadı on a clean DB",
  );
  check(
    (await yk.getByTestId("next-chip").count()) === 1 &&
      (await yk.locator("[data-step='1'] [data-testid=next-chip]").count()) === 1,
    "8b AC3 the Sıradaki chip sits on step 1 when nothing is imported",
  );
  check(
    (await yk.locator('a[href="/ice-aktar/gecmis"]', { hasText: "İçe aktarma geçmişi" }).count()) === 1,
    "8b AC3 index links İçe aktarma geçmişi",
  );

  // AC 4: member list download, including a formula-looking name, and its round trip.
  await db.execute({
    sql: "insert into users (id, name, email, role, voice_part, joined_at) values (?, ?, 'formul@ornek.com', 'member', 'alto', unixepoch('2019-01-01'))",
    args: [crypto.randomUUID(), '=HYPERLINK("http://x")'],
  });
  const list = await sef.request.get(`${BASE}/ice-aktar/uye-listesi`);
  const listBody = await list.body();
  const listText = listBody.toString("utf8");
  const listLines = listText.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  const users = await count("select count(*) from users");
  check(
    listBody[0] === 0xef && listBody[1] === 0xbb && listBody[2] === 0xbf && listText.includes("\r\n"),
    "8b AC4 member list is UTF-8 with BOM and CRLF",
  );
  check(
    /filename="arkhe-uyeler-\d{4}-\d{2}-\d{2}\.csv"/.test(list.headers()["content-disposition"] ?? ""),
    `8b AC4 file name arkhe-uyeler-<date>.csv (${list.headers()["content-disposition"]})`,
  );
  const unq = (l) => l.split(";").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
  check(
    unq(listLines[0]).join(";") === "eposta;ad;partisyon;rol;durum;katilim_tarihi;ayrilis_tarihi;aidat_orani" &&
      listLines.length - 1 === users,
    `8b AC4 header and one row per user (${listLines.length - 1}/${users})`,
  );
  const sefRow = unq(listLines.find((l) => l.includes("sef@arkhe.local")));
  const aliRow = unq(listLines.find((l) => l.includes("ayse.demir@ornek.com")));
  check(
    sefRow[3] === "sef" && sefRow[4] === "aktif" && aliRow[2] === "alto" && aliRow[3] === "korist" && aliRow[5] === "2019-01-01" && aliRow[6] === "" && sefRow[7] === "" && aliRow[7] === "tam",
    `8b AC4 codes and dates in import format (${aliRow.join("|")})`,
  );
  const formula = unq(listLines.find((l) => l.includes("formul@ornek.com")));
  check(formula[1].startsWith("'="), `8b AC4 a =HYPERLINK name doesn't start a formula (${formula[1]})`);
  const roundTrip = listLines.map((l) => {
    const c = l.split(";");
    return [c[0], c[1], c[2], c[5], c[6]].join(";");
  });
  roundTrip[0] = "eposta;ad;partisyon;katilim_tarihi;ayrilis_tarihi";
  const rt = await checkUI(sef, "uyeler", { text: roundTrip.join("\n"), name: "uye-listesi.csv" });
  check(
    rt.kind === "unchanged",
    `8b AC4 the member list (without rol, durum) checks as all değişmeyecek (${rt.kind}: ${rt.summary} ${rt.errors.slice(0, 2)})`,
  );
  await db.execute("delete from users where email = 'formul@ornek.com'");

  // AC 5, 6, 8: type pages, repo docs = page = parser, the prompt.
  const readme = readFileSync(new URL("README.md", DOCS), "utf8");
  check(
    SLUGS.every((s) => readme.includes(`${fileBase(s)}.csv`)) &&
      TITLES.every((t) => readme.includes(t)) &&
      readme.indexOf("Üye geçmişi") < readme.indexOf("Aidat ödemeleri") &&
      readme.includes("bugünkü bakiye değil") &&
      readme.includes("para iki kez sayılır"),
    "8b AC6 README has the D1 order and the opening-balance warning",
  );
  for (const [i, slug] of SLUGS.entries()) {
    const md = docFile(slug, "md").toString("utf8");
    const sample = docFile(slug, "csv");
    const table = mdTable(md);
    const header = sample.toString("utf8").replace(/^﻿/, "").split("\r\n")[0];
    for (const [route, file] of [["ornek", sample], ["talimat", docFile(slug, "md")]]) {
      const res = await yk.request.get(`${BASE}/ice-aktar/${slug}/${route}`);
      const body = await res.body();
      const live = route === "talimat" && LIVE_SLUGS.includes(slug);
      const same = live
        ? withoutLive(body.toString("utf8")) === withoutLive(file.toString("utf8")) &&
          LIVE_HEADS.some((h) => body.toString("utf8").includes(h)) &&
          !body.toString("utf8").includes("<Portaldaki")
        : Buffer.compare(body, file) === 0;
      check(
        res.status() === 200 && same && (res.headers()["content-type"] ?? "").includes("charset=utf-8"),
        `8b AC6 ${slug}/${route} ${live ? "matches outside the live lists, which are filled in," : "is byte-identical to"} docs/ice-aktarma/${fileBase(slug)}.${route === "ornek" ? "csv" : "md"}`,
      );
    }
    check(
      table.columns.join(";") === header && header === H[slug],
      `8b AC6 ${slug}: .md table columns = sample header = parser header`,
    );

    const page = yk;
    await page.goto(`${BASE}/ice-aktar/${slug}`);
    // The step streams in after the loading state; read it once the form is there.
    await page.getByRole("button", { name: "Kontrol et" }).waitFor();
    const main = await page.locator("main").innerText();
    const rows = await page.locator("[data-testid=column-row]").count();
    check(
      main.includes(`ADIM ${i + 1} / 6`) && (await page.locator("h1").innerText()) === TITLES[i] && rows === header.split(";").length,
      `8b AC5 ${slug}: step, title and one column row per column (${rows})`,
    );
    const ths = await page.locator("table thead th").allInnerTexts();
    check(
      ["Sütun", "Zorunlu", "Biçim", "İzin verilen değerler", "Örnek"].every((h) => ths.includes(h)),
      `8b AC5 ${slug}: the column table has the AC 5 headers`,
    );
    check(
      (await page.locator(`a[href="/ice-aktar/${slug}/ornek"]`, { hasText: "Örnek dosyayı indir" }).count()) === 1 &&
        (await page.locator(`a[href="/ice-aktar/${slug}/talimat"]`, { hasText: "Talimatı indir" }).count()) === 1 &&
        (await page.getByRole("tab", { name: "Dosya seç" }).count()) === 1 &&
        (await page.getByRole("tab", { name: "Metni yapıştır" }).count()) === 1 &&
        (await page.getByLabel("Dosya seç (.csv)").count()) === 1 &&
        (await page.getByRole("button", { name: "Kontrol et" }).count()) === 1,
      `8b AC5 ${slug}: downloads, both tabs, the labelled file input and Kontrol et`,
    );
    {
      await page.getByRole("button", { name: "Yapay zekâ talimatını kopyala" }).click();
      await page.getByText("Talimat kopyalandı.").first().waitFor();
      const prompt = await clipboard(page);
      const livePrompt = LIVE_SLUGS.includes(slug);
      check(
        livePrompt
          ? withoutLive(prompt.trimEnd()) === withoutLive(table.prompt) &&
              LIVE_HEADS.some((h) => prompt.includes(h)) &&
              !prompt.includes("<Portaldaki")
          : prompt.trimEnd() === table.prompt,
        `8b AC5/6 ${slug}: the copied prompt equals the .md prompt${livePrompt ? " outside the filled-in lists" : ""}`,
      );
      const eski =
        slug === "uyeler"
          ? prompt.includes("ad.soyad@eski.invalid yaz")
          : ["yoklama", "aidat-odemeleri"].includes(slug)
            ? prompt.includes("@eski.invalid") && prompt.includes("yeniden indir") && prompt.includes("adres uydurma")
            : !prompt.includes("@eski.invalid");
      check(
        prompt.includes(`\n${header}\n`) &&
          prompt.includes("noktalı virgül (;)") &&
          prompt.includes("UTF-8") &&
          ["2024-10-08", "19:00", "1250,50"].every((x) => prompt.includes(x)) &&
          table.codes.filter((c) => /^[a-z_+]+$/.test(c)).every((c) => prompt.includes(c)) &&
          table.columns.every((c) => prompt.includes(c)) &&
          prompt.includes("uydurma") &&
          prompt.includes("Atladıklarım") &&
          eski,
        `8b AC8 ${slug}: the prompt has the header, ; and UTF-8, the format examples, every code, the no-invent, @eski.invalid and skipped rules`,
      );
    }
  }
  const phone = await loginAs(browser, "yk@arkhe.local", { phone: true });
  await phone.goto(`${BASE}/ice-aktar/hareketler`);
  check(
    (await phone.locator("[data-testid=column-card]").count()) === 12 &&
      (await overflowAndTargets(phone)).overflow <= 0,
    "8b AC5 at 375 px the column table is stacked cards with no horizontal scroll",
  );

  // AC 9: encodings, delimiters and line endings give one preview; paste = upload; refusals.
  const semi = [H.donemler, "\"E2E Güz; A\";2021-09-01;2022-01-31", "E2E Bahar;2022-02-01;2022-06-30"];
  const comma = ["ad,baslangic,bitis", "\"E2E Güz; A\",2021-09-01,2022-01-31", "E2E Bahar,2022-02-01,2022-06-30"];
  const variants = [
    ["bom-lf", csv(semi, { bom: true })],
    ["nobom-lf", csv(semi)],
    ["bom-crlf", csv(semi, { bom: true, eol: "\r\n" })],
    ["comma-crlf", csv(comma, { eol: "\r\n" })],
  ];
  const previews = [];
  for (const [name, buffer] of variants) {
    const r = await checkUI(yk, "donemler", { buffer, name: `${name}.csv` });
    previews.push(`${r.kind}|${r.summary}|${r.effects.join("/")}`);
  }
  const pasted = await checkUI(yk, "donemler", { text: semi.join("\n"), paste: true });
  previews.push(`${pasted.kind}|${pasted.summary}|${pasted.effects.join("/")}`);
  check(
    new Set(previews).size === 1 && previews[0].startsWith("clean|2 satır okundu · 2 eklenecek"),
    `8b AC9 BOM/no BOM, ; and , (quoted ;), LF and CRLF, and pasted text give one preview (${[...new Set(previews)].join(" ≠ ")})`,
  );
  check(pasted.text.includes("yapistirilan-metin.csv"), "8b AC9 pasted text is checked as yapistirilan-metin.csv");
  const r1254 = await checkUI(yk, "uyeler", { buffer: win1254(`${H.uyeler}\nayse.demir@ornek.com;Ayşe Demir;;;;\n`), name: "excel.csv" });
  check(
    r1254.kind === "fileError" &&
      r1254.text.includes(`Dosya UTF-8 değil. Excel'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan UTF-8 iste.`) &&
      r1254.text.includes("Hiçbir şey yazılmadı."),
    "8b AC9 a Windows-1254 file is refused as a whole",
  );
  const multi = await checkUI(yk, "uyeler", {
    text: `${H.uyeler}\nayse.demir@ornek.com;Ayşe Demir;;;;\nmehmet.kaya@ornek.com;"Mehmet\r\nKaya";;;;\n`,
  });
  check(multi.text.includes("Satır 3: Hücrede satır sonu olamaz."), "8b AC9 a quoted line break: Satır 3: Hücrede satır sonu olamaz.");
  const xlsx = await checkUI(yk, "uyeler", { buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]), name: "kayit.xlsx" });
  check(
    xlsx.text.includes(`Bu bir Excel dosyası. Excel'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan CSV iste.`),
    "8b AC9 an .xlsx file is refused with the Excel message",
  );

  // AC 10: header.
  const unknown = await checkUI(yk, "uyeler", { text: "e-posta;ad\nayse.demir@ornek.com;Ayşe\n" });
  check(
    unknown.kind === "fileError" && unknown.text.includes('Bilinmeyen sütun: "e-posta". Geçerli sütunlar: eposta, ad,') && unknown.errors.length === 0,
    "8b AC10 an unknown column is refused with the valid list, with no row checks",
  );
  check(
    unknown.text.includes("Geçerli sütunlar:") && (await yk.getByRole("button", { name: "Başlığı kopyala" }).count()) >= 1,
    "8b AC10 the header error offers the valid header and Başlığı kopyala",
  );
  const dup = await checkUI(yk, "uyeler", { text: "eposta;EPosta\nayse.demir@ornek.com;ayse.demir@ornek.com\n" });
  check(dup.text.includes('"eposta" sütunu iki kez var.'), "8b AC10 a duplicate column is refused");
  const missing = await checkUI(yk, "yoklama", { text: "tarih;eposta\n2024-10-08;ayse.demir@ornek.com\n" });
  check(missing.text.includes('Zorunlu sütun eksik: "durum".'), "8b AC10 a missing required column is refused");
  const loose = await checkUI(yk, "uyeler", { text: "Katılım tarihi;KATILIM_TARIHI_YOK\n" });
  check(loose.kind === "fileError", "8b AC10 (control) a nonsense header is still refused");
  const shuffled = await checkUI(yk, "uyeler", { text: "KATILIM_TARIHI;EPosta\n2018-09-01;ayse.demir@ornek.com\n" });
  check(
    shuffled.kind === "clean" && shuffled.summary.includes("1 güncellenecek"),
    `8b AC10 shuffled, upper-case headers with optional columns left out are accepted (${shuffled.summary})`,
  );

  // Review backend P2-1: header problems are capped, and a wide or blank header can't stall the server.
  const messagesShown = () => yk.locator("[data-testid=import-result] section").first().locator("span.block").count();
  const many = await checkUI(yk, "uyeler", {
    text: `eposta;${Array.from({ length: 20 }, (_, i) => `x${i}`).join(";")}\nayse.demir@ornek.com${";".repeat(20)}\n`,
  });
  const manyShown = await messagesShown();
  check(
    many.kind === "fileError" && manyShown >= 2 && manyShown <= 21,
    `8b review P2-1 twenty unknown columns give at most about 20 messages (${manyShown})`,
  );
  const wideHeader = `eposta;${Array.from({ length: 3000 }, (_, i) => `bilinmeyen_${i}`).join(";")}\n`;
  let t0 = Date.now();
  const wide = await checkUI(yk, "uyeler", { text: wideHeader + "ayse.demir@ornek.com\n" });
  const wideShown = await messagesShown();
  check(
    wide.kind === "fileError" && wideShown <= 21 && wide.text.length < 20_000 && Date.now() - t0 < 10_000,
    `8b review P2-1 a 3000-column unknown header is refused with ${wideShown} messages (${wide.text.length} chars, ${Date.now() - t0} ms)`,
  );
  const blank = [`ad${";".repeat(16_000)}`, ...Array.from({ length: 16_000 }, () => "x")].join("\n") + "\n";
  t0 = Date.now();
  const blankRes = await crafted(yk, "checkImport", "donemler", { text: blank, fileName: "genis.csv" });
  const blankMs = Date.now() - t0;
  check(
    blankRes.status === 200 && blankRes.body.length < 20_000 && blankMs < 1_000,
    `8b review P2-1 a 16k-wide blank header with 16k rows answers fast and small (${blankMs} ms, ${blankRes.body.length} bytes)`,
  );

  // AC 11: limits and empty files.
  await yk.goto(`${BASE}/ice-aktar/uyeler`);
  await yk.locator("[data-testid=import-result][data-ready]").waitFor({ state: "attached" });
  await yk.setInputFiles("#import-file", { name: "buyuk.csv", mimeType: "text/csv", buffer: Buffer.alloc(1_048_577, 0x61) });
  await yk.locator("[data-testid=import-result][data-kind=fileError]").waitFor();
  check(
    (await readResult(yk)).text.includes("Dosya en fazla 1 MB olabilir.") &&
      (await yk.getByRole("button", { name: "Kontrol et" }).isDisabled()),
    "8b AC11 the browser refuses 1,048,577 bytes before uploading",
  );
  const bigServer = await crafted(yk, "checkImport", "uyeler", { text: "a".repeat(1_048_577) });
  check(bigServer.body.includes("Dosya en fazla 1 MB olabilir."), "8b AC11 the server refuses 1,048,577 bytes as well");
  const rows5001 = [H.uyeler, ...Array.from({ length: 5001 }, (_, i) => `kisi${i}@ornek.com;;;;;`)];
  const tooMany = await checkUI(yk, "uyeler", { buffer: csv(rows5001) });
  check(
    tooMany.text.includes("En fazla 5000 satır aktarılabilir; dosyayı (örneğin sezonlara) böl."),
    "8b AC11 5001 data rows are refused",
  );
  for (const [label, buffer] of [
    ["header only", csv([H.uyeler])],
    ["empty", Buffer.alloc(0)],
    ["BOM only", Buffer.from("﻿")],
  ]) {
    const r = await checkUI(yk, "uyeler", { buffer, name: `${label.replace(" ", "-")}.csv` });
    check(r.text.includes("Dosyada veri satırı yok."), `8b AC11 ${label} file → Dosyada veri satırı yok.`);
  }
  const blanks = await checkUI(yk, "uyeler", {
    text: `eposta;katilim_tarihi\nayse.demir@ornek.com;2019-01-01\nmehmet.kaya@ornek.com;2019-01-01\n\n;\nelif.sahin@ornek.com;2019-01-01\nselin.cakir@ornek.com;2019-02-30\n`,
  });
  check(
    blanks.errors.length === 1 && blanks.errors[0] === "Satır 7 · katilim_tarihi: Bu tarih takvimde yok.",
    `8b AC11 blank lines are skipped and the error still reads Satır 7 (${blanks.errors})`,
  );

  // AC 12: dates and times, one case per row.
  const tomorrow = dayFrom(1);
  const dates = [
    "2024-10-08;19:00;;;;;;ayse.demir@ornek.com;geldi;",
    "08.10.2024;;;;;;;mehmet.kaya@ornek.com;geldi;",
    "8.10.2024;;;;;;;elif.sahin@ornek.com;geldi;",
    "2025-02-30;;;;;;;ayse.demir@ornek.com;geldi;",
    "07/10/2024;;;;;;;ayse.demir@ornek.com;geldi;",
    "7 Ekim 2024;;;;;;;ayse.demir@ornek.com;geldi;",
    "24-10-07;;;;;;;ayse.demir@ornek.com;geldi;",
    `${tomorrow};;;;;;;ayse.demir@ornek.com;geldi;`,
    "1999-12-31;;;;;;;ayse.demir@ornek.com;geldi;",
    "2024-10-15;9:30;;;;;;ayse.demir@ornek.com;geldi;",
    "2024-10-16;19:00:00;;;;;;ayse.demir@ornek.com;geldi;",
    "2024-10-17;7 pm;;;;;;ayse.demir@ornek.com;geldi;",
    "2024-10-18;25:00;;;;;;ayse.demir@ornek.com;geldi;",
  ];
  const before12 = await snapshot();
  const dr = await checkUI(yk, "yoklama", { text: [H.yoklama, ...dates].join("\n") });
  const fmt = "Tarihi 2025-10-07 ya da 07.10.2025 biçiminde yaz.";
  const wantDates = [
    "Satır 5 · tarih: Bu tarih takvimde yok.",
    `Satır 6 · tarih: ${fmt}`,
    `Satır 7 · tarih: ${fmt}`,
    `Satır 8 · tarih: ${fmt}`,
    "Satır 9 · tarih: Gelecek bir tarih olamaz.",
    "Satır 10 · tarih: Tarih 2000'den önce olamaz.",
    "Satır 13 · baslangic: Saati 19:30 biçiminde yaz.",
    "Satır 14 · baslangic: Saati 19:30 biçiminde yaz.",
  ];
  check(
    wantDates.every((w) => dr.errors.includes(w)) && !dr.errors.some((e) => /Satır (2|3|4|11|12) /.test(e)),
    `8b AC12 per-row date and time messages; 2024-10-08, 08.10.2024, 8.10.2024, 9:30 and 19:00:00 pass (${dr.errors.join(" | ")})`,
  );
  const same = await checkUI(yk, "yoklama", { text: [H.yoklama, ...dates.slice(0, 3)].join("\n") });
  check(
    same.kind === "clean" && same.effects.length === 1,
    `8b AC12 three spellings of 8 Oct 2024 are one rehearsal (${same.effects.join(" / ")})`,
  );

  // AC 13 + 14 (refusals): amounts and codes.
  const HR = H.hareketler;
  const amounts = ["1.250", "1.250,00", "1,250.00", "₺1250", "1250 TL", "-50", "12,345", "abc"];
  const amountRows = amounts.map((a, i) => `A-${i};2024-09-05;gider;ikram;"${a}";kasa;;;;;;`);
  amountRows.push("A-zero;2024-09-05;gider;ikram;0;kasa;;;;;;", "A-max;2024-09-05;gider;ikram;10000000,01;kasa;;;;;;");
  amountRows.push("A-code;2024-09-05;gider;seyahat;10;kasa;;;;;;");
  const ar = await checkUI(yk, "hareketler", { text: [HR, ...amountRows].join("\n") });
  const amountMsg = "Tutarı 1250,50 biçiminde yaz: binlik ayırıcı, ₺ ve boşluk yok.";
  check(
    amounts.every((_, i) => ar.errors.includes(`Satır ${i + 2} · tutar: ${amountMsg}`)),
    `8b AC13 eight ambiguous amounts are refused (${ar.errors.filter((e) => e.includes("tutar")).length})`,
  );
  check(
    ar.errors.includes("Satır 10 · tutar: Tutar sıfırdan büyük olmalı.") &&
      ar.errors.includes("Satır 11 · tutar: Tutar en fazla ₺10.000.000,00 olabilir."),
    "8b AC13 zero and over the maximum get the UI's messages",
  );
  check(
    ar.errors.some((e) => e.startsWith('Satır 12 · kategori: "seyahat" geçerli değil. Şunlardan biri olmalı: ') && e.includes("ulasim_ve_konaklama")),
    "8b AC14 an unknown code lists the canonical codes",
  );
  check(diff(before12, await snapshot()).length === 0, "8b AC15 the broken checks above wrote nothing");

  // AC 16: the error preview, 120 and 1200 errors.
  await grantClipboard(yk);
  const bad = (n) =>
    [
      H.yoklama,
      ...Array.from({ length: n }, (_, i) => {
        const day = new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10);
        return `${day};19:00;;;;;;ayse.demir@ornek.com;uçtu;`;
      }),
    ].join("\n");
  const e120 = await checkUI(yk, "yoklama", { text: bad(120) });
  check(
    e120.kind === "errors" &&
      e120.summary === "120 satır okundu · 120 hata. Hiçbir şey yazılmadı. Dosyayı düzeltip yeniden yükle.",
    `8b AC16 the error summary sentence (${e120.summary})`,
  );
  const total120 = Number(/· (\d+) hata/.exec(e120.summary)?.[1]);
  check(
    e120.errors.length === 100 && e120.more === `ve ${total120 - 100} hata daha (ilk 1000'i kopyalanır)` && !e120.commit,
    `8b AC16 100 errors shown, ${e120.more}, no İçe aktar`,
  );
  await yk.getByRole("button", { name: "Hataları kopyala" }).click();
  await yk.getByText("Hatalar kopyalandı.").first().waitFor();
  const copied = (await clipboard(yk)).split("\n");
  check(
    copied[0].startsWith("Portal bu CSV dosyasında aşağıdaki hataları buldu.") &&
      copied[1] === "" &&
      copied.length === 2 + total120 &&
      copied[2].startsWith("Satır 2 · "),
    `8b AC16 the copy holds the preface, a blank line and all ${total120} errors (${copied.length - 2})`,
  );
  check(
    (await yk.locator("ol[aria-label=Hatalar] > li").count()) === 101,
    "8b AC43 the error list is a real list",
  );
  const e1200 = await checkUI(yk, "uyeler", {
    text: [H.uyeler, ...Array.from({ length: 1200 }, (_, i) => `yok${i}@ornek.com;;;;;`)].join("\n"),
  });
  await yk.getByRole("button", { name: "Hataları kopyala" }).click();
  await yk.getByText("Hatalar kopyalandı.").first().waitFor();
  const copied1200 = (await clipboard(yk)).split("\n");
  check(
    e1200.summary.includes("1200 hata") &&
      copied1200.length === 2 + 1000 + 1 &&
      copied1200.at(-1) === "İlk 1000 hata listelendi; dosyayı düzeltip yeniden kontrol et.",
    `8b AC16 1200 errors: 1000 copied plus the closing line (${copied1200.length - 2})`,
  );

  // AC 43: phone, themes, accessibility.
  for (const scheme of ["light", "dark"]) {
    const p = await loginAs(browser, "yk@arkhe.local", { phone: true, context: { colorScheme: scheme } });
    const problems = [];
    const visit = async (label) => {
      const r = await overflowAndTargets(p);
      if (r.overflow > 0) problems.push(`${label} overflow ${r.overflow}`);
      if (r.small.length) problems.push(`${label} small: ${r.small.slice(0, 3).join(", ")}`);
      if (shots) await p.screenshot({ path: `${shots}/8b-${label}-${scheme}.png`, fullPage: true });
    };
    await p.goto(`${BASE}/ice-aktar`);
    await visit("index");
    for (const slug of SLUGS) {
      await p.goto(`${BASE}/ice-aktar/${slug}`);
      await visit(slug);
    }
    await checkUI(p, "yoklama", { text: bad(120) });
    await visit("errors");
    await checkUI(p, "donemler", { text: semi.join("\n") });
    await visit("clean");
    await p.goto(`${BASE}/ice-aktar/gecmis`);
    await visit("gecmis");
    check(problems.length === 0, `8b AC43 375 px ${scheme}: no horizontal scroll, controls ≥ 44 px (${problems.join("; ")})`);
    await p.context().close();
  }
  await yk.goto(`${BASE}/ice-aktar/uyeler`);
  await yk.getByRole("tab", { name: "Metni yapıştır" }).click();
  check(
    (await yk.locator("[role=status][data-testid=import-summary]").count()) === 1 &&
      (await yk.getByLabel("CSV metni", { exact: true }).count()) === 1,
    "8b AC43 the summary is a status region and the paste textarea is labelled CSV metni",
  );
  let hex = "";
  try {
    hex = execFileSync("grep", ["-rnE", "#[0-9a-fA-F]{3,8}\\b", "src/components/import", "src/app/(portal)/ice-aktar", "src/components/pager.tsx"], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
  } catch {}
  check(hex.trim() === "", `8b AC43 no raw hex colours in the import UI (${hex.trim().slice(0, 120)})`);

  await phone.context().close();
  for (const p of [sef, yk, korist]) await p.context().close();
  await cleanup();
}
