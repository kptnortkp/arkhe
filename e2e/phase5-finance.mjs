import { createHash } from "node:crypto";
import { FINANCE_IDS, financeExpected, seedFinance } from "../scripts/finance-fixture.mjs";
import {
  actionIds,
  BASE,
  callAction,
  check,
  cleanup,
  db,
  loginAs,
  newPage,
  login,
} from "./lib.mjs";

const ACTIONS_FILE = "src/app/(portal)/finans/actions.ts";
const DUES_ACTIONS_FILE = "src/app/(portal)/finans/aidat/actions.ts";
const DRIVE = "https://drive.google.com/file/d/e2eFaturaDeneme/view";
const NBSP = / /g;

async function goto(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.locator("main h1").first().waitFor();
}

const kurus = async (page, testId) =>
  Number(await page.locator(`[data-testid=${testId}]`).first().getAttribute("data-kurus"));

async function monthKurus(page, kind) {
  return Number(
    await page
      .locator(`[data-testid=month-${kind}] [data-testid=money]`)
      .getAttribute("data-kurus"),
  );
}

async function balances(page) {
  await goto(page, "/finans");
  return {
    cash: await kurus(page, "balance-cash"),
    bank: await kurus(page, "balance-bank"),
    total: await kurus(page, "balance-total"),
  };
}

const text = async (locator) => ((await locator.textContent()) ?? "").replace(NBSP, " ").trim();

async function toast(page, message) {
  try {
    await page.getByText(message, { exact: true }).first().waitFor({ timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function entryId(where, args = []) {
  const r = await db.execute({ sql: `select id from finance_entries where ${where}`, args });
  return r.rows[0]?.id ?? null;
}

async function ledgerSnapshot() {
  const r = await db.execute(
    "select (select group_concat(id || ifnull(voided_at, '-') || revision, '|') from (select * from finance_entries order by id)) a, (select count(*) from dues_periods) p, (select count(*) from dues_overrides) o, (select group_concat(rate) from member_dues) r, (select count(*) from events) e, (select count(*) from sponsors) s, (select value from app_settings where key = 'dues_payment_info') i",
  );
  return JSON.stringify(r.rows[0]);
}

function duesRow(page, name) {
  return page.locator(`[data-testid=dues-row][data-name="${name}"]`);
}

async function duesStatus(page, name) {
  const chip = duesRow(page, name).locator("[data-testid=dues-status]");
  return { tone: await chip.getAttribute("data-tone"), text: await text(chip) };
}

async function fillEntry(page, { kind, amount, category, account, doc, description }) {
  if (kind)
    await page
      .locator("label", { hasText: new RegExp(`^${kind}$`) })
      .first()
      .click();
  if (amount !== undefined) await page.fill("input[name=amount]", amount);
  if (category) await page.getByText(category, { exact: true }).click();
  if (account)
    await page
      .locator("fieldset", { has: page.locator("legend", { hasText: /^(Hesap|Kaynak hesap)$/ }) })
      .getByText(account, { exact: true })
      .click();
  if (doc !== undefined) await page.fill("input[name=documentUrl]", doc);
  if (description !== undefined) await page.fill("input[name=description]", description);
}

export default async function phase5(browser, shots) {
  await cleanup();
  const exp = financeExpected(new Date());
  const [m2, m1, m0] = exp.names;
  const [, ym1, ym0] = exp.months;

  const yk = await loginAs(browser, "yk@arkhe.local");
  const sef = await loginAs(browser, "sef@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");
  const phone = await loginAs(browser, "yk@arkhe.local", { mobile: true });

  // AC1 entry points
  await goto(yk, "/");
  check(
    (await yk.locator("aside nav a[href='/finans']").count()) === 1,
    "AC1 Finans is in the desktop sidebar",
  );
  await goto(phone, "/");
  check(
    (await phone.locator("[data-testid=home-kasa] a[href='/finans']").count()) > 0,
    "AC1 home Kasa card links to /finans on a phone",
  );
  const tabBar = phone.locator("nav", { has: phone.locator("a[href='/odevler']") }).last();
  check(
    (await tabBar.locator("a[href='/finans']").count()) === 0,
    "AC1 Finans is not in the 375px tab bar",
  );
  await goto(phone, "/profil");
  const managerLinks = phone.locator("[data-testid=profile-manager-links]");
  check(
    (await managerLinks.locator("a[href='/finans']").count()) === 1 &&
      (await managerLinks.locator("a[href='/raporlar']").count()) === 1,
    "AC1 /profil has Finans and Raporlar rows",
  );
  let reachable = true;
  for (const path of [
    "/finans",
    "/finans/hareketler",
    "/finans/aidat",
    "/finans/aidat/donemler",
    "/finans/etkinlikler",
    "/finans/sponsorlar",
    "/finans/rapor",
    "/finans/ayarlar",
    "/finans/yeni?tur=gelir",
  ]) {
    const res = await sef.goto(`${BASE}${path}`);
    if (res.status() !== 200 || !sef.url().includes("/finans")) reachable = false;
  }
  check(reachable, "AC1 the conductor reaches every /finans sub-route");

  // AC2 overview
  const start = await balances(yk);
  check(
    start.cash === exp.balances.cash &&
      start.bank === exp.balances.bank &&
      start.total === exp.balances.total,
    `AC2 balances match the seed (${start.cash}/${start.bank}/${start.total})`,
  );
  check(
    (await text(yk.locator("[data-testid=balance-total]"))) === "₺34.537,25" &&
      (await text(yk.locator("[data-testid=balance-cash]"))) === "₺9.650,00" &&
      (await text(yk.locator("[data-testid=balance-bank]"))) === "₺24.887,25",
    "AC2 balances are formatted ₺1.234,56",
  );
  const thisMonth = exp.report[2];
  check(
    (await monthKurus(yk, "income")) === thisMonth.income &&
      (await monthKurus(yk, "expense")) === -thisMonth.expense,
    "AC2 this month's Gelir/Gider match",
  );
  check(
    (await yk.locator("[data-testid=recent-entries] [data-testid=entry-row]").count()) === 10,
    "AC2 the last 10 entries are listed",
  );
  check(
    (await yk.locator("nav[aria-label='Finans bölümleri'] a").allTextContents()).join(",") ===
      "Özet,Hareketler,Aidat,Etkinlikler,Sponsorlar,Rapor,Bütçe,Ayarlar",
    "AC2 the finance sub-nav chips",
  );

  // AC10 undocumented expenses (before AC9 adds a document)
  await goto(yk, "/finans/hareketler?belgesiz=1");
  const undocumented = await yk
    .locator("[data-testid=entry-row]")
    .evaluateAll((els) => els.map((e) => e.dataset.id));
  const bankFee = await entryId("category = 'bank_fee'");
  check(
    undocumented.includes(FINANCE_IDS.costume) &&
      undocumented.includes(bankFee) &&
      !undocumented.includes(FINANCE_IDS.venue) &&
      (await yk.locator("[data-testid=all-months]").textContent()) === "Tüm aylar",
    "AC10 belgesiz lists costume and bank fee, not the venue, across all months",
  );

  // AC4 amount parsing (client echo and blur errors)
  await goto(yk, "/finans/yeni?tur=gider");
  const echo = yk.locator("[data-testid=amount-echo]");
  const amountCases = [
    ["1.250,5", "Kaydedilecek: ₺1.250,50"],
    ["1250.50", "Kaydedilecek: ₺1.250,50"],
    ["150.5", "Kaydedilecek: ₺150,50"],
    ["1.250", "Kaydedilecek: ₺1.250,00"],
  ];
  let echoes = true;
  for (const [input, expected] of amountCases) {
    await yk.fill("input[name=amount]", input);
    if ((await text(echo)) !== expected) {
      echoes = false;
      console.log(`echo for ${input}: ${await text(echo)}`);
    }
  }
  check(echoes, "AC4 accepted amounts echo the parsed value");
  const errorCases = [
    ["0", "Tutar sıfırdan büyük olmalı."],
    ["12,345", "Tutarı 1.250,50 biçiminde gir."],
    ["abc", "Tutarı 1.250,50 biçiminde gir."],
    ["1,250.50", "Tutarı 1.250,50 biçiminde gir."],
    ["10000000,01", "Tutar en fazla ₺10.000.000,00 olabilir."],
  ];
  let blurErrors = true;
  for (const [input, expected] of errorCases) {
    await yk.fill("input[name=amount]", input);
    await yk.locator("input[name=description]").focus();
    if ((await text(yk.locator("#amount-error"))) !== expected) {
      blurErrors = false;
      console.log(`error for ${input}: ${await text(yk.locator("#amount-error"))}`);
    }
  }
  check(blurErrors, "AC4 rejected amounts show the right message");
  await yk.fill("input[name=amount]", "");
  await yk.getByText("Salon / mekân", { exact: true }).click();
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  check(
    (await yk.locator("#amount-error").textContent({ timeout: 8000 })) === "Tutar gir.",
    "AC4 an empty amount → Tutar gir. (server)",
  );
  await yk.fill("input[name=amount]", "12,345");
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.waitForTimeout(800);
  check(
    (await text(yk.locator("#amount-error"))) === "Tutarı 1.250,50 biçiminde gir.",
    "AC4 the server rejects 12,345 too",
  );

  // AC5 validation
  await goto(yk, "/finans/yeni?tur=gelir");
  const incomeChips = await yk
    .locator("fieldset", { has: yk.locator("legend", { hasText: "Kategori" }) })
    .locator("label")
    .allTextContents();
  check(!incomeChips.includes("Aidat"), "AC5 Aidat is not offered in the generic form");
  await fillEntry(yk, { amount: "100", category: "Sponsorluk" });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  check(
    (await yk.locator("#sponsorId-error").textContent({ timeout: 8000 })) === "Sponsor seç.",
    "AC5 Sponsorluk without a sponsor → Sponsor seç.",
  );
  await yk.getByRole("button", { name: "+ Yeni sponsor" }).click();
  await yk.fill("#newSponsor", "mülkiye kitabevi");
  await yk.getByRole("button", { name: "Ekle", exact: true }).click();
  check(
    (await yk.locator("#newSponsor-error").textContent({ timeout: 8000 })) ===
      "Bu adla bir sponsor zaten var.",
    "AC5 a duplicate sponsor name (case/diacritics) is refused",
  );
  await goto(yk, "/finans/yeni?tur=gelir");
  const beforeDues = await ledgerSnapshot();
  await fillEntry(yk, { amount: "100" });
  await yk.evaluate(() => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "category";
    input.value = "dues";
    document.querySelector("main form").appendChild(input);
  });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.locator("#category-error").waitFor({ timeout: 8000 });
  check(
    (await ledgerSnapshot()) === beforeDues,
    "AC5 posting category=dues to the generic form saves nothing",
  );
  await goto(yk, "/finans/yeni?tur=gider");
  await fillEntry(yk, { amount: "100", category: "İkram", doc: "http://example.com/x" });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  check(
    (await yk.locator("#documentUrl-error").textContent({ timeout: 8000 })) ===
      "Geçerli bir https bağlantısı gir.",
    "AC5 a bad document URL is refused",
  );
  const farDate = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await yk.fill("input[name=documentUrl]", "");
  await yk.fill("input[name=occurredOn]", farDate);
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  check(
    (await yk.locator("#occurredOn-error").textContent({ timeout: 8000 })) === "Tarih çok ileride.",
    "AC5 a date beyond today + 31 → Tarih çok ileride.",
  );

  // AC3 + AC21 add an expense on Banka; the next Gelir form remembers Banka
  await goto(yk, "/finans/yeni?tur=gider&geri=/finans/hareketler");
  await fillEntry(yk, {
    amount: "1.250,50",
    category: "Salon / mekân",
    account: "Banka",
    doc: DRIVE,
    description: "E2E salon kirası",
  });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.waitForURL(`${BASE}/finans/hareketler`);
  check(await toast(yk, "Kaydedildi."), "AC3 toast Kaydedildi.");
  const afterExpense = await balances(yk);
  check(
    afterExpense.bank === start.bank - 125050 && afterExpense.cash === start.cash,
    "AC3 Banka drops by exactly ₺1.250,50, Kasa unchanged",
  );
  const salon = await entryId("description = 'E2E salon kirası'");
  await goto(yk, `/finans/${salon}`);
  check(
    (await yk.locator("[data-testid=document-link]").textContent()).includes("Belgeyi aç") &&
      (await yk.getByRole("button", { name: "Önizle" }).count()) === 1,
    "AC3 the detail shows Belgeyi aç with a Drive preview",
  );
  // A Kasa expense, then the cookie makes the next Gelir default to Kasa.
  await goto(yk, "/finans/yeni?tur=gider");
  await fillEntry(yk, { amount: "10", category: "İkram", account: "Kasa", description: "E2E çay" });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.waitForURL(`${BASE}/finans/hareketler`);
  await goto(yk, "/finans/yeni?tur=gelir");
  check(
    await yk
      .locator("fieldset", { has: yk.locator("legend", { hasText: /^Hesap$/ }) })
      .locator("input[value=cash]")
      .isChecked(),
    "AC21 the generic form remembers the last account (Kasa)",
  );
  await goto(yk, "/finans/yeni?tur=virman");
  check(
    (await yk.locator("input[name=account][value=cash]").isChecked()) &&
      (await yk.locator("input[name=toAccount][value=bank]").isChecked()),
    "AC21 a new Virman defaults Kasa → Banka",
  );

  // AC6 transfer
  const beforeTransfer = await balances(yk);
  const monthBefore = [await monthKurus(yk, "income"), await monthKurus(yk, "expense")];
  await goto(yk, "/finans/yeni?tur=virman");
  await fillEntry(yk, { amount: "500", description: "E2E zarf" });
  const target = yk.locator("fieldset", { has: yk.locator("legend", { hasText: "Hedef hesap" }) });
  await target.getByText("Kasa", { exact: true }).click();
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  check(
    (await yk.locator("#toAccount-error").textContent({ timeout: 8000 })) ===
      "Kaynak ve hedef hesap aynı olamaz.",
    "AC6 same source and target → Kaynak ve hedef hesap aynı olamaz.",
  );
  await target.getByText("Banka", { exact: true }).click();
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.waitForURL(`${BASE}/finans/hareketler`);
  await yk.waitForTimeout(500);
  const afterTransfer = await balances(yk);
  check(
    afterTransfer.cash === beforeTransfer.cash - 50000 &&
      afterTransfer.bank === beforeTransfer.bank + 50000 &&
      afterTransfer.total === beforeTransfer.total &&
      (await monthKurus(yk, "income")) === monthBefore[0] &&
      (await monthKurus(yk, "expense")) === monthBefore[1],
    "AC6 Virman moves ₺500 Kasa → Banka; Toplam and month totals unchanged",
  );
  const actions = await actionIds(ACTIONS_FILE, salon);
  const duesActions = await actionIds(DUES_ACTIONS_FILE, salon);

  // AC7 void
  const stale = await newPage(browser);
  await login(stale, "yk@arkhe.local");
  await stale.waitForURL(`${BASE}/`);
  await goto(stale, `/finans/${salon}`);
  await goto(yk, `/finans/${salon}`);
  check(
    (await yk.getByRole("button", { name: /^Sil/ }).count()) === 0,
    "AC7 no delete control on an entry",
  );
  await yk.getByRole("button", { name: "İptal et" }).click();
  const dialog = yk.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "İptal et" }).click();
  check(
    (await dialog.locator("#void-reason-error").textContent({ timeout: 8000 })) ===
      "İptal nedeni yaz (en az 5 karakter).",
    "AC7 voiding without a reason is refused",
  );
  await dialog.locator("textarea").fill("abc");
  await dialog.getByRole("button", { name: "İptal et" }).click();
  await yk.waitForTimeout(600);
  check(
    (await text(dialog.locator("#void-reason-error"))) === "İptal nedeni yaz (en az 5 karakter).",
    "AC7 a 3-character reason is refused",
  );
  await dialog.locator("textarea").fill("E2E yanlış girildi");
  await dialog.getByRole("button", { name: "İptal et" }).click();
  check(await toast(yk, "Kayıt iptal edildi."), "AC7 toast Kayıt iptal edildi.");
  await yk.locator("[data-testid=void-line]").waitFor();
  check(
    (await text(yk.locator("[data-testid=void-line]"))).includes("Demo Yönetim") &&
      (await text(yk.locator("[data-testid=void-line]"))).includes("E2E yanlış girildi"),
    "AC7 the detail shows who and why",
  );
  const afterVoid = await balances(yk);
  check(
    afterVoid.bank === afterTransfer.bank + 125050,
    "AC7 the voided expense leaves the balance",
  );
  await goto(yk, `/finans/hareketler?ay=${ym0}`);
  check(
    (await yk.locator(`[data-testid=entry-row][data-id="${salon}"]`).count()) === 0,
    "AC7 gone from the default list",
  );
  await goto(yk, `/finans/hareketler?iptal=1&ay=${ym0}`);
  const voidedRow = yk.locator(`[data-testid=entry-row][data-id="${salon}"]`);
  check(
    (await voidedRow.count()) === 1 &&
      (await voidedRow
        .locator("[data-testid=money]")
        .evaluate((e) => getComputedStyle(e).textDecorationLine)) === "line-through",
    "AC7 listed under İptal edilenler, struck through",
  );
  await goto(yk, `/finans/hareketler?iptal=1&ay=${ym1}`);
  check(
    (await yk.locator(`[data-testid=entry-row][data-id="${FINANCE_IDS.voided}"]`).count()) === 1,
    "AC7 the seeded voided catering is listed too",
  );
  await stale.getByRole("button", { name: "İptal et" }).click();
  await stale.getByRole("alertdialog").locator("textarea").fill("E2E ikinci kez");
  await stale.getByRole("alertdialog").getByRole("button", { name: "İptal et" }).click();
  check(
    await toast(stale, "Bu kayıt zaten iptal edilmiş."),
    "AC7 voiding twice → Bu kayıt zaten iptal edilmiş.",
  );
  await stale.context().close();

  // AC8 Düzelt
  const beforeFix = await balances(yk);
  await goto(yk, `/finans/${bankFee}`);
  await yk.getByRole("link", { name: "Düzelt" }).click();
  await yk.waitForURL(/duzelt=/);
  await yk.locator("[data-testid=correct-banner]").waitFor();
  await goto(yk, `/finans/${bankFee}`);
  check(
    (await yk.locator("[data-testid=void-line]").count()) === 0,
    "AC8 opening the Düzelt form and leaving changes nothing",
  );
  await goto(yk, `/finans/yeni?duzelt=${bankFee}`);
  await yk.fill("input[name=amount]", "15");
  await yk.getByRole("button", { name: "Düzeltilmiş kaydı kaydet" }).click();
  await yk.waitForURL(
    (u) => /\/finans\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(bankFee),
  );
  check(await toast(yk, "Kayıt düzeltildi."), "AC8 toast Kayıt düzeltildi.");
  check(
    (await text(yk.locator("[data-testid=replaces-link]"))).startsWith("Bu kaydın yerine: −₺12,75"),
    "AC8 the new entry shows Bu kaydın yerine",
  );
  await goto(yk, `/finans/${bankFee}`);
  check(
    (await text(yk.locator("[data-testid=void-line]"))).includes("Düzeltildi") &&
      (await text(yk.locator("[data-testid=replaced-by-link]"))).startsWith(
        "Düzeltilmiş kayıt: −₺15,00",
      ),
    "AC8 the old entry is voided with Düzeltildi and links forward",
  );
  const afterFix = await balances(yk);
  check(afterFix.bank === beforeFix.bank - 225, "AC8 Banka changes by exactly −₺2,25");
  await goto(yk, `/finans/yeni?duzelt=${bankFee}`);
  check(
    (await yk.getByRole("alert").first().textContent()).includes("Bu kayıt zaten iptal edilmiş."),
    "AC8 correcting the voided entry again is refused",
  );

  // AC9 Düzenle
  await goto(yk, `/finans/${FINANCE_IDS.costume}`);
  await yk.getByRole("button", { name: "Düzenle" }).click();
  const sheet = yk.getByRole("dialog");
  check(
    (await sheet
      .locator("input[name=amount], input[name=occurredOn], [name=account], [name=category]")
      .count()) === 0,
    "AC9 the edit sheet has no amount, date, account or category inputs",
  );
  await sheet.locator("input[name=description]").fill("E2E fular açıklaması");
  await sheet.locator("input[name=documentUrl]").fill(DRIVE);
  await sheet.getByRole("button", { name: "Kaydet" }).click();
  check(await toast(yk, "Kaydedildi."), "AC9 toast Kaydedildi.");
  await yk.locator("[data-testid=updated-line]").waitFor();
  check(
    (await text(yk.locator("[data-testid=updated-line]"))).startsWith(
      "Son düzenleme: Demo Yönetim",
    ) && (await yk.locator("[data-testid=document-link]").count()) === 1,
    "AC9 description and document saved, Son düzenleme stamped",
  );
  await goto(yk, `/finans/${FINANCE_IDS.costume}`);
  await yk.getByRole("button", { name: "Düzenle" }).click();
  await db.execute({
    sql: "update finance_entries set revision = revision + 1 where id = ?",
    args: [FINANCE_IDS.costume],
  });
  await yk.getByRole("dialog").locator("input[name=description]").fill("E2E yarış");
  await yk.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
  check(
    (await yk.getByRole("dialog").getByRole("alert").textContent({ timeout: 8000 })) ===
      "Kayıt bu arada değişti. Sayfayı yenileyip tekrar dene.",
    "AC9 a stale revision is refused",
  );

  // AC11 event P/L
  await goto(yk, `/finans/etkinlikler/${FINANCE_IDS.event}`);
  const lines = await yk.locator("[data-testid=pl-line]").allTextContents();
  const want = [
    "Bilet satışı",
    "Sponsorluk",
    "Salon / mekân",
    "Kostüm",
    "Şef / korrepetitör ücreti",
  ];
  check(
    want.every((w) => lines.some((l) => l.startsWith(w))) &&
      (await text(yk.locator("[data-testid=pl-result]"))) === "Kâr ₺4.200,00",
    "AC11 Kış Konseri shows its lines and Kâr ₺4.200,00",
  );
  await yk.getByRole("link", { name: "Gider ekle" }).click();
  await yk.waitForURL(/etkinlik=/);
  check(
    (await yk.locator("select[name=eventId]").inputValue()) === FINANCE_IDS.event,
    "AC11 Gider ekle prefills the event",
  );
  await fillEntry(yk, {
    amount: "5000",
    category: "Ulaşım ve konaklama",
    description: "E2E otobüs",
  });
  await yk.getByRole("button", { name: "Kaydet", exact: true }).click();
  await yk.waitForURL(`${BASE}/finans/etkinlikler/${FINANCE_IDS.event}`);
  await yk.waitForTimeout(500);
  const loss = yk.locator("[data-testid=pl-result]");
  check(
    (await text(loss)) === "Zarar −₺800,00" &&
      (await loss.getAttribute("class")).includes("text-absent-ink"),
    "AC11 a ₺5.000 expense turns it into Zarar −₺800,00 in red",
  );
  await yk.getByRole("button", { name: "Sil" }).click();
  await yk.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  check(
    await toast(yk, "Bu etkinliğe bağlı hareketler var."),
    "AC11 deleting an event with entries is refused",
  );

  // AC12 events from concerts
  await goto(yk, "/finans/etkinlikler");
  await yk.getByRole("button", { name: "Konserden oluştur" }).click();
  const concerts = await yk.locator("[data-testid=concert-list] button").allTextContents();
  check(
    concerts.some((c) => c.startsWith("Güz konseri")) &&
      !concerts.some((c) => c.startsWith("Kış Konseri")),
    "AC12 Konserden oluştur lists Güz konseri, not the linked Kış Konseri",
  );
  await yk.locator("[data-testid=concert-list] button", { hasText: "Güz konseri" }).click();
  const guz = (await db.execute("select id, starts_at from rehearsals where title = 'Güz konseri'"))
    .rows[0];
  const guzDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(
    new Date(Number(guz.starts_at) * 1000),
  );
  const eventSheet = yk.getByRole("dialog");
  check(
    (await eventSheet.locator("input[name=name]").inputValue()) === "Güz konseri" &&
      (await eventSheet.locator("input[name=startsOn]").inputValue()) === guzDay,
    "AC12 the form is prefilled with the concert's name and Istanbul date",
  );
  await eventSheet.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForURL(/\/finans\/etkinlikler\/[0-9a-f-]{36}$/);
  await goto(yk, "/finans/etkinlikler");
  await yk.getByRole("button", { name: "Konserden oluştur" }).click();
  check(
    (await yk.locator("[data-testid=concert-list] button", { hasText: "Güz konseri" }).count()) ===
      0 &&
      Number(
        (
          await db.execute({
            sql: "select count(*) n from events where rehearsal_id = ?",
            args: [guz.id],
          })
        ).rows[0].n,
      ) === 1,
    "AC12 one event per concert",
  );

  // AC13 dues statuses
  await goto(yk, "/finans/aidat");
  const k = await duesStatus(yk, "Demo Korist");
  const baris = await duesStatus(yk, "Barış Güneş");
  const deniz = await duesStatus(yk, "Deniz Aslan");
  check(k.text === "Ödenmedi" && k.tone === "amber", `AC13 ${m0}: korist Ödenmedi (${k.text})`);
  check(baris.text === "Muaf" && baris.tone === "muted", "AC13 Barış Güneş Muaf");
  check(
    deniz.text === "Muaf" &&
      (await text(duesRow(yk, "Deniz Aslan"))).includes("Bu dönem muaf: Bir ay yurt dışında"),
    "AC13 Deniz Aslan Muaf with the waiver reason",
  );
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[1]}`);
  const late = await duesStatus(yk, "Demo Korist");
  check(
    late.text === "Gecikti · ₺200,00 kaldı" && late.tone === "red",
    `AC13 ${m1}: korist Gecikti · ₺200,00 kaldı, red`,
  );
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[2]}&filtre=borclu`);
  const debtorStates = await yk
    .locator("[data-testid=dues-row] [data-testid=dues-status]")
    .evaluateAll((els) => els.map((e) => e.dataset.state));
  check(
    debtorStates.length === exp.currentDebtors &&
      debtorStates.every((s) => s !== "paid" && s !== "exempt"),
    `AC13 Borçlular shows ${exp.currentDebtors} rows for ${m0} (${debtorStates.length})`,
  );

  // AC16 rate change with freeze (on a fresh fixture, restored afterwards)
  await seedFinance(db, new Date());
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[2]}`);
  await duesRow(yk, "Demo Korist").getByRole("link").click();
  const memberSheet = yk.locator("[data-testid=member-sheet]");
  await memberSheet.waitFor();
  await memberSheet
    .locator("[data-testid=rate-form]")
    .getByText("İndirimli", { exact: true })
    .click();
  await memberSheet.locator("[data-testid=rate-form] input[name=note]").fill("E2E öğrenci");
  await memberSheet
    .locator("[data-testid=rate-form]")
    .getByRole("button", { name: "Kaydet" })
    .click();
  check(await toast(yk, "Aidat oranı güncellendi."), "AC16 toast Aidat oranı güncellendi.");
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[0]}`);
  const r1 = (await duesStatus(yk, "Demo Korist")).text;
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[1]}`);
  const r2 = (await duesStatus(yk, "Demo Korist")).text;
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[2]}`);
  const r3 = (await duesStatus(yk, "Demo Korist")).text;
  check(
    r1 === "Ödendi" && r2 === "Gecikti · ₺200,00 kaldı" && r3 === "Ödenmedi",
    `AC16 paid periods keep the old rate (${r1} / ${r2} / ${r3})`,
  );
  await goto(korist, "/profil");
  const koristRows = await korist.locator("[data-testid=my-dues-row]").allTextContents();
  const koristHtml = await korist.content();
  check(
    koristRows.some((r) => r.startsWith(m0) && r.includes("₺150,00") && r.includes("Ödenmedi")) &&
      koristRows.some((r) => r.startsWith(m1) && r.includes("Gecikti · ₺200,00 kaldı")) &&
      !koristHtml.includes("Oran değişikliği") &&
      !koristHtml.includes("E2E öğrenci"),
    "AC16 korist's profile shows ₺150 for the open period, never the freeze reason or note",
  );
  await goto(
    yk,
    `/finans/aidat?donem=${FINANCE_IDS.periods[1]}&uye=${await userId("korist@arkhe.local")}`,
  );
  const waiver = yk.locator("[data-testid=waiver-form]");
  await waiver.locator("input[name=reason]").fill("E2E deneme");
  await waiver.getByRole("button", { name: "Muaf tut" }).click();
  check(
    await toast(yk, "Bu döneme ödeme girilmiş; önce ödemeyi iptal et."),
    "AC16 a waiver on a period with a payment is refused",
  );
  await seedFinance(db, new Date());

  // Review fix: a saved waiver refreshes once, not in a loop
  await goto(
    yk,
    `/finans/aidat?donem=${FINANCE_IDS.periods[2]}&uye=${await userId("kaan.ozdemir@arkhe.local")}`,
  );
  const waiverForm = yk.locator("[data-testid=waiver-form]");
  await waiverForm.locator("input[name=reason]").fill("E2E uzun hastalık");
  let refreshes = 0;
  const countRsc = (r) => {
    if (r.headers()["rsc"]) refreshes += 1;
  };
  yk.on("request", countRsc);
  await waiverForm.getByRole("button", { name: "Muaf tut" }).click();
  check(await toast(yk, "Muaf tutuldu."), "Review: toast Muaf tutuldu.");
  await yk.waitForTimeout(2500);
  yk.off("request", countRsc);
  check(refreshes <= 4, `Review: saving a waiver doesn't loop (${refreshes} refreshes)`);
  await seedFinance(db, new Date());

  // AC14 multi-period payment
  const cashBefore = (await balances(yk)).cash;
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[2]}`);
  await yk.getByRole("button", { name: "Ödeme al: Demo Korist" }).click();
  const pay = yk.locator("[data-testid=payment-form]");
  await pay.waitFor();
  await pay.getByText(m0, { exact: true }).click();
  check(
    (await pay.locator("input[name=amount]").inputValue()) === "300,00" &&
      (await text(pay.locator("[data-testid=amount-echo]"))) === "Kaydedilecek: ₺300,00",
    "Review: picking another period updates the amount and its echo",
  );
  await pay.getByText("Birden fazla dönem").click();
  check(
    (await text(pay.locator("[data-testid=payment-total]"))) === "Toplam ₺500,00 (2 dönem)",
    "AC14 Toplam ₺500,00 (2 dönem)",
  );
  const clientId = await pay.locator("input[name=clientId]").inputValue();
  await pay.getByRole("button", { name: "₺500,00 al" }).click();
  const done = yk.locator("[data-testid=payment-done]");
  await done.waitFor();
  check(
    await toast(yk, `Ödeme alındı: Demo Korist · ₺500,00 (${m1}, ${m0}).`),
    "AC14 toast Ödeme alındı",
  );
  const nextButton = done.getByRole("button", { name: /^Sonraki borçlu: / });
  check(
    (await nextButton.count()) === 1 &&
      (await nextButton.evaluate((b) => b === document.activeElement)),
    "AC14 Sonraki borçlu is focused",
  );
  const koristId = await userId("korist@arkhe.local");
  const groupId = derivedId(clientId, koristId, "group");
  const paidRows = (
    await db.execute({
      sql: "select amount_kurus, payment_group_id from finance_entries where member_id = ? and created_at > unixepoch() - 120 and voided_at is null and category = 'dues' order by amount_kurus",
      args: [koristId],
    })
  ).rows;
  check(
    paidRows.length === 2 &&
      Number(paidRows[0].amount_kurus) === 20000 &&
      Number(paidRows[1].amount_kurus) === 30000 &&
      paidRows[0].payment_group_id === groupId &&
      paidRows[1].payment_group_id === groupId,
    "AC14 two entries (₺200 + ₺300) sharing one payment group derived from clientId and member",
  );
  await yk.keyboard.press("Escape");
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[1]}`);
  const p2 = (await duesStatus(yk, "Demo Korist")).text;
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[2]}`);
  const p3 = (await duesStatus(yk, "Demo Korist")).text;
  check(p2 === "Ödendi" && p3 === "Ödendi", "AC14 both periods Ödendi");
  check((await balances(yk)).cash === cashBefore + 50000, "AC14 Kasa +₺500,00");
  const groupEntry = await entryId("member_id = ? and payment_group_id = ?", [koristId, groupId]);
  await goto(yk, `/finans/${groupEntry}`);
  check(
    (await text(yk.locator("[data-testid=payment-group]"))) === `${m1}, ${m0}`,
    "AC14 the detail shows Aynı ödemede",
  );
  const ids = (
    await db.execute({
      sql: "select id from finance_entries where payment_group_id = ?",
      args: [groupId],
    })
  ).rows.map((r) => r.id);
  const derived = [FINANCE_IDS.periods[1], FINANCE_IDS.periods[2]].map((p) =>
    derivedId(clientId, koristId, p),
  );
  check(
    ids.length === 2 && derived.every((d) => ids.includes(d)),
    "AC14 entry ids derive from the clientId and member, so a replay maps onto the same rows",
  );

  // AC15 overpayment
  const elif = "Zeynep Kaya";
  const cashBefore15 = (await balances(yk)).cash;
  const snap15 = await ledgerSnapshot();
  await goto(yk, `/finans/aidat?donem=${FINANCE_IDS.periods[2]}`);
  await yk.getByRole("button", { name: `Ödeme al: ${elif}` }).click();
  const pay15 = yk.locator("[data-testid=payment-form]");
  await pay15.waitFor();
  await pay15.locator("input[name=amount]").fill("300,01");
  await pay15.getByRole("button", { name: "₺300,01 al" }).click();
  check(
    (await pay15.locator("#amount-error").textContent({ timeout: 8000 })) ===
      "Kalan borç ₺300,00; daha fazlası girilemez.",
    "AC15 paying more than remaining is refused",
  );
  await yk.keyboard.press("Escape");
  check(
    (await ledgerSnapshot()) === snap15 && (await balances(yk)).cash === cashBefore15,
    "AC15 nothing saved, Kasa unchanged",
  );

  // AC17 periods
  const [, , , ...future] = [...exp.months, ...nextMonths(exp.months[2], 2)];
  const futureNames = future.map(monthName);
  await goto(yk, "/finans/aidat/donemler");
  await yk.getByRole("button", { name: "Toplu oluştur" }).click();
  const bulk = yk.getByRole("dialog");
  await bulk.locator("input[name=fromMonth]").fill(future[0]);
  await bulk.locator("input[name=toMonth]").fill(future[1]);
  await bulk.locator("input[name=amount]").fill("350");
  await bulk.locator("input[name=reducedAmount]").fill("175");
  await bulk.getByRole("button", { name: "2 dönem oluştur" }).click();
  check(await toast(yk, "2 dönem oluşturuldu."), "AC17 toast 2 dönem oluşturuldu.");
  const created = (
    await db.execute({
      sql: "select name, due_on, amount_kurus, reduced_amount_kurus from dues_periods where name in (?, ?) order by starts_on",
      args: futureNames,
    })
  ).rows;
  check(
    created.length === 2 &&
      created[0].due_on === `${future[0]}-15` &&
      Number(created[0].amount_kurus) === 35000 &&
      Number(created[1].reduced_amount_kurus) === 17500,
    `AC17 ${futureNames.join(", ")} created, due the 15th, ₺350 / ₺175`,
  );
  await yk.waitForTimeout(500);
  await yk.getByRole("button", { name: "Toplu oluştur" }).click();
  const bulk2 = yk.getByRole("dialog");
  await bulk2.locator("input[name=fromMonth]").fill(future[0]);
  await bulk2.locator("input[name=toMonth]").fill(future[1]);
  await bulk2.locator("input[name=amount]").fill("350");
  await bulk2.getByRole("button", { name: "Dönemleri oluştur" }).click();
  check(
    (await bulk2.getByRole("alert").textContent({ timeout: 8000 })) ===
      "Bu aylar için dönem zaten var.",
    "AC17 running it again → Bu aylar için dönem zaten var.",
  );
  await yk.keyboard.press("Escape");
  await goto(yk, "/finans/aidat/donemler");
  await yk.getByRole("button", { name: "Yeni dönem" }).click();
  const one = yk.getByRole("dialog");
  await one.locator("input[name=name]").fill("E2E çakışan");
  await one.locator("input[name=startsOn]").fill(`${ym0}-10`);
  await one.locator("input[name=endsOn]").fill(`${ym0}-20`);
  await one.locator("input[name=dueOn]").fill(`${ym0}-20`);
  await one.locator("input[name=amount]").fill("100");
  await one.getByRole("button", { name: "Kaydet" }).click();
  check(
    (await one.locator("#startsOn-error").textContent({ timeout: 8000 })) ===
      `Bu tarihler ${m0} dönemiyle çakışıyor.`,
    "AC17 an overlapping period is refused",
  );
  await yk.keyboard.press("Escape");
  const m0Row = yk.locator(`[data-testid=period-row][data-name="${m0}"]`);
  await m0Row.getByRole("button", { name: /^Düzenle/ }).click();
  check(
    (await yk
      .getByRole("dialog")
      .getByText("Bu döneme ödeme girilmiş; değiştirilemez.")
      .count()) === 1 && (await yk.getByRole("dialog").locator("fieldset[disabled]").count()) === 1,
    "AC17 a period with payments can't be edited",
  );
  await yk.keyboard.press("Escape");
  const lockedTrash = m0Row.getByRole("button", {
    name: `Sil: ${m0}. Ödemesi olan dönem silinemez`,
  });
  await lockedTrash.click({ force: true });
  check(
    (await lockedTrash.getAttribute("aria-disabled")) === "true" &&
      (await lockedTrash.getAttribute("title")) === "Ödemesi olan dönem silinemez" &&
      (await yk.getByRole("alertdialog").count()) === 0,
    "AC17 deleting it is refused (trash disabled with the reason)",
  );

  // AC18 report (fresh fixture so the numbers are the seed's)
  await seedFinance(db, new Date());
  await goto(yk, "/finans/rapor");
  const rows = await yk.locator("table [data-testid=report-row]").evaluateAll((els) =>
    els.map((e) => ({
      month: e.dataset.month,
      carry: Number(e.querySelector("[data-cell=carry]").dataset.kurus),
      closing: Number(e.querySelector("[data-cell=closing]").dataset.kurus),
      income: Number(e.querySelector("[data-cell=income]").dataset.kurus),
      expense: Number(e.querySelector("[data-cell=expense]").dataset.kurus),
    })),
  );
  const chain = rows.every((r, i) => i === 0 || rows[i - 1].carry === r.closing);
  const seedRows = exp.report.every((want) => {
    const got = rows.find((r) => r.month === want.month);
    // Earlier-year months live on last year's report around January.
    if (!got) return want.month.slice(0, 4) !== exp.today.slice(0, 4);
    return (
      got.carry === want.carry &&
      got.income === want.income &&
      got.expense === want.expense &&
      got.closing === want.closing
    );
  });
  check(chain, "AC18 every Kapanış equals the next month's Devir");
  check(seedRows, "AC18 the seeded months match financeExpected");
  check(rows[0]?.closing === exp.balances.total, "AC18 the last Kapanış equals Toplam");
  await goto(yk, `/finans/rapor?hesap=kasa`);
  const kasaRows = await yk.locator("table [data-testid=report-row]").evaluateAll((els) =>
    els.map((e) => {
      const n = (c) => Number(e.querySelector(`[data-cell=${c}]`).dataset.kurus);
      return {
        month: e.dataset.month,
        ok: n("closing") === n("carry") + n("income") - n("expense") + n("transfer"),
        transfer: n("transfer"),
      };
    }),
  );
  check(
    kasaRows.every((r) => r.ok) &&
      (kasaRows.find((r) => r.month === ym1)?.transfer ?? -150000) === -150000,
    "AC18 Kasa view: Virman −₺1.500,00 in M−1 and Kapanış = Devir + Gelir − Gider + Virman",
  );

  // AC19 CSV
  const year = exp.today.slice(0, 4);
  await db.execute({
    sql: "update finance_entries set counterparty = '=HYPERLINK(\"x\")' where id = ?",
    args: [FINANCE_IDS.venue],
  });
  const csv = await yk.request.get(`${BASE}/finans/rapor/csv?from=${year}-01-01&to=${year}-12-31`);
  const body = await csv.text();
  const csvLines = body.replace(/^﻿/, "").trim().split("\r\n");
  const header = csvLines[0].replace(/"/g, "");
  const cells = (line) => line.slice(1, -1).split('";"');
  const data = csvLines.slice(1).map(cells);
  const col = (name) => header.split(";").indexOf(name);
  const sum = (name) =>
    data.reduce(
      (s, r) => s + (r[col(name)] ? Math.round(Number(r[col(name)].replace(",", ".")) * 100) : 0),
      0,
    );
  check(
    csv.headers()["content-type"].startsWith("text/csv") &&
      csv.headers()["content-disposition"].startsWith("attachment") &&
      body.startsWith("﻿"),
    "AC19 text/csv attachment with a BOM",
  );
  check(
    header ===
      "Tarih;Tür;Kategori;Açıklama;Kimden/Kime;Sponsor;Etkinlik;Üye;Aidat dönemi;Hesap;Gelir;Gider;Virman/Açılış;Belge;Kaydeden;Kayıt no",
    "AC19 the header is exactly as decided",
  );
  const transferRow = data.find((r) => r[1] === "Virman");
  check(
    !body.includes(FINANCE_IDS.voided) &&
      data.some((r) => r[col("Gider")] === "3500,00") &&
      transferRow?.[col("Hesap")] === "Kasa → Banka" &&
      transferRow?.[col("Virman/Açılış")] === "1500,00" &&
      !transferRow?.[col("Gelir")] &&
      !transferRow?.[col("Gider")],
    "AC19 no voided rows; amounts like 3500,00; the transfer only in Virman/Açılış",
  );
  const yearRows = exp.report.filter((r) => r.month.startsWith(year));
  const expectIncome = yearRows.reduce((s, r) => s + r.income, 0);
  const expectExpense = yearRows.reduce((s, r) => s + r.expense, 0);
  check(
    sum("Gelir") === expectIncome && sum("Gider") === expectExpense,
    `AC19 Σ Gelir and Σ Gider equal the report (${sum("Gelir")}/${sum("Gider")})`,
  );
  check(
    data.some((r) => r[1] === "Açılış bakiyesi") || !exp.months[0].startsWith(year),
    "AC19 openings are present",
  );
  check(body.includes(`"'=HYPERLINK(""x"")"`), "AC19 a formula-looking cell is prefixed with '");
  await goto(yk, "/finans/rapor");
  await yk.fill("input[name=from]", `${year}-06-01`);
  await yk.fill("input[name=to]", `${year}-01-01`);
  await yk.getByRole("button", { name: "CSV indir" }).click();
  check(
    (await yk.locator("#to-error").textContent({ timeout: 5000 })) ===
      "Bitiş başlangıçtan önce olamaz.",
    "AC19 an inverted range is caught inline",
  );
  const duesCsv = await (
    await yk.request.get(`${BASE}/finans/aidat/csv?donem=${FINANCE_IDS.periods[2]}`)
  ).text();
  check(
    duesCsv
      .replace(/^﻿/, "")
      .startsWith('"Ad soyad";"Partisyon";"Oran";"Borç";"Ödenen";"Kalan";"Durum"') &&
      duesCsv.includes('"Demo Korist"') &&
      !duesCsv.includes("Öğrenci") &&
      !duesCsv.includes("YK kararı"),
    "AC19 the dues CSV lists the roster without notes",
  );

  // AC20 settings
  await goto(yk, "/finans/ayarlar");
  await yk.fill("textarea[name=info]", "E2E IBAN TR11 2222");
  await yk
    .locator("[data-testid=payment-info-form]")
    .getByRole("button", { name: "Kaydet" })
    .click();
  check(await toast(yk, "Ödeme bilgisi güncellendi."), "AC20 toast Ödeme bilgisi güncellendi.");
  await goto(korist, "/profil");
  check(
    (await text(korist.locator("[data-testid=payment-info]"))) === "E2E IBAN TR11 2222",
    "AC20 korist sees the new payment info",
  );
  const opening = yk.locator("[data-testid=opening-form]");
  await opening.locator("input[name=openedOn]").fill(`${exp.months[0]}-09`);
  await opening.getByRole("button", { name: "Kaydet" }).click();
  check(
    (await opening.locator("#openedOn-error").textContent({ timeout: 8000 })) ===
      "Açılış tarihinden önce hareket var.",
    "AC20 moving the opening after the first entries is refused",
  );
  const cashBeforeOpening = (await balances(yk)).cash;
  await goto(yk, "/finans/ayarlar");
  await yk.locator("[data-testid=opening-form] input[name=cash]").fill("2.600");
  await yk.locator("[data-testid=opening-form]").getByRole("button", { name: "Kaydet" }).click();
  check(await toast(yk, "Açılış bakiyesi kaydedildi."), "AC20 toast Açılış bakiyesi kaydedildi.");
  check(
    (await balances(yk)).cash === cashBeforeOpening + 10000,
    "AC20 a new Kasa opening moves balance-cash by the difference",
  );

  // AC22–24 members
  await seedFinance(db, new Date());
  await goto(korist, "/");
  check(
    (await text(korist.locator("[data-testid=home-dues-remaining]"))) === "Kalan borcun ₺500,00",
    "AC22 korist's home shows Aidatım with ₺500,00",
  );
  await goto(korist, "/profil");
  const firstSection = await korist
    // Phase 10 D83: Bildirimler sits under Telefonuna ekle, before the content sections.
    .locator("main section:not([data-testid=install-card]):not(#bildirimler)")
    .first()
    .getAttribute("id");
  const myRows = await korist.locator("[data-testid=my-dues-row]").allTextContents();
  const status = (name) => myRows.find((r) => r.startsWith(name)) ?? "";
  check(firstSection === "aidat", "AC22 Aidatım is the first content section on /profil");
  check(
    status(m2).includes("Ödendi") &&
      status(m1).includes("Gecikti · ₺200,00 kaldı") &&
      status(m0).includes("Ödenmedi") &&
      status(m0).includes("₺300,00"),
    "AC22 per-period statuses and owed amounts",
  );
  const myPayments = await korist.locator("[data-testid=my-payments] li").count();
  check(myPayments === 2, `AC22 Ödemelerim lists only korist's two payments (${myPayments})`);
  await korist.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await korist.locator("#aidat").getByRole("button", { name: "Kopyala" }).click();
  check(await toast(korist, "Kopyalandı."), "AC22 Kopyala → Kopyalandı.");

  // AC23 members can't reach finance
  let redirected = true;
  for (const path of [
    "/finans",
    "/finans/hareketler",
    "/finans/aidat",
    "/finans/rapor",
    "/finans/ayarlar",
    `/finans/${FINANCE_IDS.venue}`,
  ]) {
    await korist.goto(`${BASE}${path}`);
    await korist
      .waitForURL((u) => !u.pathname.startsWith("/finans"), { timeout: 10000 })
      .catch(() => {});
    if (new URL(korist.url()).pathname.startsWith("/finans")) redirected = false;
  }
  check(redirected, "AC23 /finans and its sub-routes redirect a member away");
  const csvStatus = [
    (await korist.request.get(`${BASE}/finans/rapor/csv`)).status(),
    (await korist.request.get(`${BASE}/finans/aidat/csv?donem=${FINANCE_IDS.periods[2]}`)).status(),
  ];
  check(
    csvStatus.every((s) => s === 403),
    `AC23 both CSV routes return 403 (${csvStatus})`,
  );
  const anon = await browser.newContext();
  const anonStatus = (
    await anon.request.get(`${BASE}/finans/rapor/csv`, { maxRedirects: 0 })
  ).status();
  await anon.close();
  check(
    anonStatus === 401 || (anonStatus >= 300 && anonStatus < 400),
    `AC23 no session → ${anonStatus}`,
  );
  const someUser = await userId("buse.kurt@arkhe.local");
  const memberCalls = {
    [ACTIONS_FILE]: {
      createEntry: [{}, {}],
      correctEntry: [FINANCE_IDS.venue, {}, {}],
      updateEntryMeta: [FINANCE_IDS.venue, {}, {}],
      voidEntry: [FINANCE_IDS.venue, {}, {}],
      setOpeningBalances: [{}, {}],
      setPaymentInfo: [{}, {}],
      createEvent: [{}, {}],
      updateEvent: [FINANCE_IDS.event, {}, {}],
      deleteEvent: [FINANCE_IDS.event],
      createSponsor: [{}, {}],
      updateSponsor: [FINANCE_IDS.sponsor, {}, {}],
    },
    [DUES_ACTIONS_FILE]: {
      recordDuesPayment: [{}, {}],
      createDuesPeriod: [{}, {}],
      updateDuesPeriod: [FINANCE_IDS.periods[0], {}, {}],
      deleteDuesPeriod: [FINANCE_IDS.periods[0]],
      bulkCreateDuesPeriods: [{}, {}],
      setDuesRate: [someUser, {}, {}],
      setWaiver: [FINANCE_IDS.periods[0], someUser, {}, {}],
      removeWaiver: [FINANCE_IDS.periods[2], await userId("deniz.aslan@arkhe.local")],
    },
  };
  const beforeMember = await ledgerSnapshot();
  let refused = true;
  let called = 0;
  for (const [file, calls] of Object.entries(memberCalls)) {
    const ids = file === ACTIONS_FILE ? actions : duesActions;
    for (const [name, args] of Object.entries(calls)) {
      if (!ids[name]) continue;
      called += 1;
      const res = await callAction(korist, ids[name], args);
      if (!res.includes("Bu işlem için yetkin yok.")) {
        refused = false;
        console.log(`${name} did not refuse: ${res.slice(0, 160)}`);
      }
    }
  }
  check(refused && called >= 15, `AC23 every finance action refuses a member (${called} tried)`);
  check((await ledgerSnapshot()) === beforeMember, "AC23 refused actions change no rows");
  let leaked = [];
  for (const path of ["/", "/profil"]) {
    await goto(korist, path);
    const html = await korist.content();
    leaked.push(
      ...[
        "Onur Çetin",
        "Ece Demir",
        "YK kararı 2/2026",
        "Öğrenci",
        "Bir ay yurt dışında",
        "Mülkiye Kitabevi",
        "34.537",
      ].filter((s) => html.includes(s)),
    );
  }
  check(
    leaked.length === 0,
    `AC23 no other member's money data in korist's HTML (${leaked.join(", ")})`,
  );

  const ece = await loginAs(browser, "ece.demir@arkhe.local");
  await goto(ece, "/");
  const eceCard = await ece.locator("[data-testid=home-dues]").count();
  await goto(ece, "/profil");
  check(
    eceCard === 0 && (await ece.getByText("Borcun yok. Teşekkürler!").count()) === 1,
    "AC24 Ece (paid up) has no card and sees Borcun yok. Teşekkürler!",
  );
  const barisPage = await loginAs(browser, "baris.gunes@arkhe.local");
  await goto(barisPage, "/profil");
  check(
    (await barisPage.getByText("Aidattan muafsın.").count()) === 1,
    "AC24 Barış sees Aidattan muafsın.",
  );
  await goto(sef, "/profil");
  check((await sef.locator("#aidat").count()) === 0, "AC24 the conductor has no Aidatım section");
  await goto(yk, "/profil");
  check(
    (await yk.locator("#aidat").count()) === 1 &&
      (await yk.locator("#aidat").getByText("Borcun yok. Teşekkürler!").count()) === 1,
    "AC24 yk (paid up) has the section with Borcun yok",
  );

  // AC25 phones: no horizontal scroll in both themes, 44px targets on key screens
  const pages = [
    "/finans",
    "/finans/hareketler",
    "/finans/yeni?tur=gider",
    `/finans/${FINANCE_IDS.venue}`,
    "/finans/aidat",
    "/finans/aidat/donemler",
    "/finans/etkinlikler",
    `/finans/etkinlikler/${FINANCE_IDS.event}`,
    "/finans/sponsorlar",
    `/finans/sponsorlar/${FINANCE_IDS.sponsor}`,
    "/finans/rapor",
    "/finans/ayarlar",
    "/",
    "/profil",
  ];
  let scroll = true;
  let small = [];
  for (const scheme of ["light", "dark"]) {
    await phone.emulateMedia({ colorScheme: scheme });
    for (const path of pages) {
      await goto(phone, path);
      if (!(await noHorizontalScroll(phone))) {
        scroll = false;
        console.log(`horizontal scroll: ${path} (${scheme})`);
      }
      if (scheme === "light") {
        // Home and profile: only the finance cards belong to this phase.
        const scope =
          path === "/" || path === "/profil"
            ? "main :is([data-testid=home-kasa], [data-testid=home-dues], #aidat, [data-testid=profile-manager-links])"
            : "main";
        const tiny = await phone.evaluate(
          (scope) =>
            [
              ...document.querySelectorAll(
                `${scope} :is(a, button, summary, label:has(input[type=radio]))`,
              ),
            ]
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.width > 0 && r.height > 0 && r.height < 43.5 && !el.closest("p, dd, li span")
                );
              })
              .map((el) => `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 20)}`),
          scope,
        );
        if (tiny.length) small.push(`${path} → ${tiny.join(" | ")}`);
      }
      if (shots) {
        const name = path.replace(/[^a-z0-9]+/gi, "_") || "home";
        await phone.screenshot({ path: `${shots}/p5-${scheme}${name}.png`, fullPage: true });
      }
    }
  }
  await phone.emulateMedia({ colorScheme: "light" });
  check(scroll, "AC25 no page-level horizontal scroll at 390px, light and dark");
  if (small.length) console.log("small targets:", small);
  check(small.length === 0, "AC25 interactive targets are ≥ 44px");
  await goto(phone, "/finans/aidat");
  await phone.getByRole("button", { name: "Ödeme al: Demo Korist" }).click();
  await phone.locator("[data-testid=payment-form]").waitFor();
  check(await noHorizontalScroll(phone), "AC25 the payment sheet fits the phone");
  if (shots) await phone.screenshot({ path: `${shots}/p5-payment-sheet.png` });

  await cleanup();
}

async function userId(email) {
  const r = await db.execute({ sql: "select id from users where email = ?", args: [email] });
  return r.rows[0].id;
}

function nextMonths(ym, n) {
  const out = [];
  let [y, m] = ym.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

function monthName(ym) {
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${ym}-01T00:00:00Z`));
}

/** Mirrors src/lib/finance/ledger.ts derivedId. */
function derivedId(...parts) {
  const hex = createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
