// Phase 8 B: budgets — list, create, plan editor, prefill, approve, revise and the plan-vs-actual report (AC 24–37, 41–44).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { seedBudgets, budgetSeason, BUDGET_IDS } from "../scripts/board-fixture.mjs";
import { BASE, check, db, istanbulDate } from "./lib.mjs";
import {
  actionIds,
  addDays,
  as,
  BUDGET_ACTIONS,
  callAction,
  callForm,
  deleteBudgetEntries,
  elapsed,
  goto,
  arrangePast,
  insertBudget,
  insertEntry,
  noOverflow,
  people,
  scalar,
  smallTargets,
  text,
  toast,
} from "./board.mjs";
import { csvRows } from "./mail.mjs";

const FORBIDDEN = "Bu işlem için yetkin yok.";
// Dates the server renders are compared with istanbulDate() at the check, so a run may cross midnight.
const YEAR = Number(istanbulDate().slice(0, 4));
const FREE_YEAR = YEAR + 5;
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

const PAST_CSV = [
  "Tür;Kategori;Plan;Gerçekleşen;Fark;Gerçekleşme;Durum",
  "Gelir;Bağış;1000,00;1200,00;200,00;%120;Hedefe ulaşıldı",
  "Gelir;Hibe / destek;1000,00;400,00;-600,00;%40;Hedefin altında",
  "Gelir;Diğer gelir;0,00;300,00;300,00;;Plansız gelir",
  "Gelir;Toplam;2000,00;1900,00;-100,00;%95;",
  "Gider;Salon / mekân;500,00;0,00;-500,00;%0;Bütçe içinde",
  "Gider;Nota ve telif;1000,00;800,00;-200,00;%80;Bütçe içinde",
  "Gider;Ulaşım ve konaklama;1000,00;1300,00;300,00;%130;Bütçe aşıldı",
  "Gider;Festival katılım ücreti;1000,00;950,00;-50,00;%95;Sınıra yakın",
  "Gider;Organizasyon / tanıtım;1000,00;1000,00;0,00;%100;Sınıra yakın",
  "Gider;Diğer gider;0,00;50,00;50,00;;Plansız gider",
  "Gider;Toplam;4500,00;4100,00;-400,00;%91;",
  "Net;Gelir − gider;-2500,00;-2200,00;300,00;;",
];

async function lines(page) {
  return page.locator("[data-testid=budget-line]").evaluateAll((els) =>
    els.map((e) => ({
      kind: e.dataset.kind,
      category: e.dataset.category,
      signal: e.dataset.signal,
      plan: Number(e.dataset.planKurus),
      actual: Number(e.dataset.actualKurus),
      pct: e.dataset.pct,
      planText: e.querySelector("[data-testid=line-plan]")?.textContent,
      pctText: e.querySelector("[data-testid=line-pct]")?.textContent,
      words: e.querySelector("[data-testid=line-words]")?.textContent,
      chip: e.querySelector("[data-testid=signal-chip]")?.textContent?.trim(),
      chipClass: e.querySelector("[data-testid=signal-chip]")?.className,
      bar: Boolean(e.querySelector("[data-testid=budget-bar]")),
      fill: e.querySelector("[data-fill]")?.dataset.fill,
      over: Boolean(e.querySelector("[data-over]")),
      elapsed: e.querySelector("[data-elapsed]")?.dataset.elapsed ?? null,
      labels: [...e.querySelectorAll("dt")].map((d) => d.textContent),
    })),
  );
}

async function axe(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ["violations"] });
    return r.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 2)
            .map((n) => n.target.join(" "))
            .join(" | ")}`,
      );
  });
}

async function reset() {
  await seedBudgets(db, new Date());
  await deleteBudgetEntries();
}

async function access(browser, ids) {
  const season = budgetSeason(new Date());
  const cur = BUDGET_IDS.current;
  for (const email of ["sef@arkhe.local", "yk@arkhe.local"]) {
    const page = await as(browser, email);
    const codes = [];
    for (const p of [
      "/finans/butce",
      "/finans/butce/yeni",
      `/finans/butce/${cur}`,
      `/finans/butce/${cur}/duzenle`,
      `/finans/butce/${cur}/bilgiler`,
    ]) {
      codes.push((await goto(page, p)).status());
    }
    check(
      codes.every((c) => c === 200),
      `AC24 ${email} opens every budget page with 200 (${codes})`,
    );
    if (email === "yk@arkhe.local") {
      await goto(page, "/finans/butce");
      const chips = await page.locator("nav[aria-label='Finans bölümleri'] a").allInnerTexts();
      check(
        chips.join(",") === "Özet,Hareketler,Aidat,Etkinlikler,Sponsorlar,Rapor,Bütçe,Ayarlar" &&
          (await page
            .locator("nav[aria-label='Finans bölümleri'] a[aria-current=page]")
            .innerText()) === "Bütçe",
        `AC24 FinanceNav shows Bütçe between Rapor and Ayarlar (${chips})`,
      );
    }
    await page.context().close();
  }
  const korist = await as(browser, "korist@arkhe.local");
  const landed = [];
  for (const p of [
    "/finans/butce",
    "/finans/butce/yeni",
    `/finans/butce/${cur}`,
    `/finans/butce/${cur}/duzenle`,
  ]) {
    await korist.goto(`${BASE}${p}`);
    await korist.waitForURL(`${BASE}/`, { timeout: 10_000 }).catch(() => {});
    landed.push(new URL(korist.url()).pathname);
  }
  check(
    landed.every((p) => p === "/"),
    `AC24 korist@ is redirected to / (${landed})`,
  );
  const snap = async () =>
    `${await scalar("select count(*) from budgets")}:${await scalar("select count(*) from budget_lines")}:${await scalar("select group_concat(coalesce(approved_at, 0)) from budgets")}`;
  const before = await snap();
  const plan = Object.fromEntries(
    [
      "dues",
      "sponsorship",
      "tickets",
      "donation",
      "grant",
      "other_income",
      "costume",
      "venue",
      "musician_fee",
      "scores_royalties",
      "travel",
      "festival_fee",
      "organisation",
      "catering",
      "refund",
      "bank_fee",
      "other_expense",
    ].map((c) => [c, "1"]),
  );
  const calls = {
    createBudget: () =>
      callForm(korist, ids.createBudget, [], {
        id: crypto.randomUUID(),
        name: "E2E korist",
        start: "2030-01",
      }),
    updateBudget: () =>
      callForm(korist, ids.updateBudget, [cur], {
        name: "E2E korist",
        start: season.current.start,
      }),
    savePlan: () =>
      callForm(korist, ids.savePlan, [cur], { ...plan, revision: "2", reason: "korist deniyor" }),
    approveBudget: () => callAction(korist, ids.approveBudget, [cur, 2]),
    deleteBudget: () => callAction(korist, ids.deleteBudget, [cur]),
    prefillPlan: () => callAction(korist, ids.prefillPlan, [cur]),
  };
  let refused = 0;
  for (const [name, call] of Object.entries(calls)) {
    const res = await call();
    if (res.includes(FORBIDDEN)) refused++;
    else console.log(`${name} did not refuse: ${res.slice(0, 200)}`);
  }
  check(
    refused === 6 && (await snap()) === before,
    `AC24 every budget action refuses korist@ and changes nothing (${refused}/6)`,
  );
  const csv = await korist.request.get(`${BASE}/finans/butce/${cur}/csv`);
  const body = await csv.text();
  check(
    csv.status() === 403 && !body.includes("Tür;Kategori"),
    `AC24 the CSV route answers korist@ with 403 (${csv.status()})`,
  );
  await korist.context().close();
  const anon = await fetch(`${BASE}/finans/butce/${cur}/csv`, { redirect: "manual" });
  const stale = await fetch(`${BASE}/finans/butce/${cur}/csv`, {
    redirect: "manual",
    headers: { cookie: "arkhe_session=e2e-not-a-session; __Host-arkhe_session=e2e-not-a-session" },
  });
  const anonBody = await anon.text();
  const staleBody = await stale.text();
  check(
    [307, 401].includes(anon.status) &&
      stale.status === 401 &&
      !anonBody.includes("Tür;") &&
      !staleBody.includes("Tür;"),
    `AC24 logged out: no CSV body (no cookie ${anon.status} → /giris, stale cookie ${stale.status})`,
  );
}

async function list(browser) {
  await reset();
  const season = budgetSeason(new Date());
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/finans/butce");
  const rows = yk.locator("[data-testid=budget-row]");
  const names = await rows.evaluateAll((els) =>
    els.map((e) => e.querySelector("a span span")?.textContent),
  );
  const first = await text(rows.nth(0));
  const second = await text(rows.nth(1));
  check(
    names[0] === season.current.name && names[1] === season.previous.name,
    `AC25 budgets newest start first (${names})`,
  );
  const [sy] = season.current.start.split("-").map(Number);
  check(
    first.includes(`Eylül ${sy} – Ağustos ${sy + 1}`) &&
      first.includes("Onaylandı") &&
      first.includes("Şu anki") &&
      !second.includes("Şu anki") &&
      /Gelir (%\d+|—) · Gider (%\d+|—) \(plana göre\)/.test(first) &&
      /Gelir (%\d+|—) · Gider (%\d+|—) \(plana göre\)/.test(second),
    `AC25 each row: range, Onaylandı, Şu anki on the current one, Gelir %x · Gider %y (plana göre) (${first})`,
  );
  check(
    (await yk.getByRole("link", { name: "Yeni bütçe" }).count()) >= 1,
    "AC25 the primary button Yeni bütçe",
  );
  await db.execute("delete from budgets");
  await goto(yk, "/finans/butce");
  const main = await text(yk.locator("main"));
  check(
    main.includes("Henüz bütçe yok.") &&
      main.includes("Sezon başında planı yaz; portal yıl boyunca gerçekleşenle karşılaştırır."),
    "AC25 the empty state",
  );
  await yk.context().close();
  await reset();
}

async function create(browser, ids) {
  await reset();
  const season = budgetSeason(new Date());
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/finans/butce/yeni");
  const month = yk.locator("#startMonth");
  const year = yk.locator("#startYear");
  const name = yk.locator("input[name=name]");
  const end = yk.locator("[data-testid=budget-end]");
  // TL1: the month after the latest budget ends, else September of this year.
  const latest = await scalar("select max(end_month) from budgets");
  const [dy, dm] = (latest ?? `${YEAR}-09`).split("-").map(Number);
  const defName =
    dm === 9
      ? `${dy}–${String((dy + 1) % 100).padStart(2, "0")} sezonu`
      : dm === 1
        ? String(dy)
        : null;
  const endYm = dm === 1 ? [dy, 12] : [dy + 1, dm - 1];
  check(
    (await month.inputValue()) === String(dm) &&
      (await year.inputValue()) === String(dy) &&
      (defName === null || (await name.inputValue()) === defName) &&
      (await text(end)).startsWith(`Bitiş: ${MONTHS[endYm[1] - 1]} ${endYm[0]}`),
    `AC26/TL1 the default start is ${dy}-${dm}, free of any budget (${await name.inputValue()})`,
  );
  await yk.getByRole("button", { name: "Oluştur" }).click();
  await yk.waitForURL(/\/duzenle$/, { timeout: 10_000 }).catch(() => {});
  const createdDefault = yk.url().endsWith("/duzenle");
  check(createdDefault, "UX P2-2 Oluştur with the defaults creates the draft, no overlap error");
  if (createdDefault) {
    await db.execute({
      sql: "delete from budgets where id = ?",
      args: [yk.url().split("/").at(-2)],
    });
  }
  await goto(yk, "/finans/butce/yeni");
  await year.selectOption(String(FREE_YEAR));
  await month.selectOption("1");
  check(
    (await name.inputValue()) === String(FREE_YEAR) &&
      (await text(end)).startsWith(`Bitiş: Aralık ${FREE_YEAR}`),
    `AC26 a January start names it ${FREE_YEAR}, ends Aralık ${FREE_YEAR}`,
  );
  await month.selectOption("3");
  check(
    (await name.inputValue()) === `Mart ${FREE_YEAR} – Şubat ${FREE_YEAR + 1}`,
    `AC26 a March start uses the range as the name (${await name.inputValue()})`,
  );
  await name.fill("E2E elle yazdım");
  await month.selectOption("1");
  check(
    (await name.inputValue()) === "E2E elle yazdım",
    "AC26 after typing, the name no longer follows the start",
  );

  const submit = () => yk.getByRole("button", { name: "Oluştur" }).click();
  await name.fill("");
  await submit();
  check(await toast(yk, "Bir ad yaz."), "AC26 Bir ad yaz.");
  await name.fill("x".repeat(41));
  await submit();
  check(
    await toast(yk, "Ad en fazla 40 karakter olabilir."),
    "AC26 Ad en fazla 40 karakter olabilir.",
  );
  await name.fill("E2E not uzun");
  await yk.locator("textarea[name=note]").fill("n".repeat(501));
  await submit();
  check(
    await toast(yk, "Not en fazla 500 karakter olabilir."),
    "AC26 Not en fazla 500 karakter olabilir.",
  );
  await yk.locator("textarea[name=note]").fill("");
  await name.fill(season.current.name);
  await submit();
  check(await toast(yk, "Bu adla bir bütçe zaten var."), "AC26 a duplicate name is refused");
  const [cy, cm] = season.current.start.split("-").map(Number);
  await year.selectOption(String(cy));
  await month.selectOption(String(cm + 1 > 12 ? 1 : cm + 1));
  await name.fill("E2E çakışan");
  await submit();
  check(
    await toast(yk, `Bu tarihler ${season.current.name} bütçesiyle çakışıyor.`),
    "AC26 an overlap names the other budget",
  );
  check(
    (await scalar("select count(*) from budgets where name like 'E2E%'")) === 0,
    "AC26 refused creates save nothing",
  );

  await year.selectOption(String(FREE_YEAR));
  await month.selectOption("1");
  await name.fill(String(FREE_YEAR));
  await submit();
  await yk.waitForURL(/\/finans\/butce\/[0-9a-f-]{36}\/duzenle$/);
  const id = yk.url().split("/").at(-2);
  check(
    await toast(yk, "Taslak oluşturuldu. Şimdi tutarları yaz."),
    "AC26 Oluştur opens the editor with the toast",
  );
  const row = (await db.execute({ sql: "select * from budgets where id = ?", args: [id] })).rows[0];
  check(
    row?.name === String(FREE_YEAR) &&
      row.start_month === `${FREE_YEAR}-01` &&
      row.approved_at === null,
    `AC26 a Taslak for January ${FREE_YEAR}`,
  );
  await goto(yk, `/finans/butce/${id}`);
  check(
    (await text(yk.locator("[data-testid=budget-range]"))) ===
      `Ocak ${FREE_YEAR} – Aralık ${FREE_YEAR}` &&
      (await text(yk.locator("[data-testid=budget-phase]"))) === "Dönem henüz başlamadı" &&
      (await yk.locator("[data-testid=budget-elapsed]").count()) === 0,
    "AC26/AC35 the future budget: Ocak – Aralık range and Dönem henüz başlamadı",
  );
  void ids;
  await yk.context().close();
  return id;
}

async function editor(browser, id) {
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, `/finans/butce/${id}/duzenle`);
  const legends = await yk.locator("fieldset legend > span:first-child").allTextContents();
  const rows = await yk
    .locator("[data-testid=plan-row]")
    .evaluateAll((els) => els.map((e) => e.dataset.category));
  check(
    legends.map((l) => l.trim().toLocaleLowerCase("tr")).join(",") === "gelir,gider" &&
      rows.length === 17 &&
      rows.slice(0, 6).join(",") === "dues,sponsorship,tickets,donation,grant,other_income",
    `AC27 two groups, Gelir (6) and Gider (11), in categories.ts order`,
  );
  const inputs = await yk
    .locator("[data-testid=plan-row] input")
    .evaluateAll((els) =>
      els.map((e) => ({ mode: e.inputMode, h: e.getBoundingClientRect().height })),
    );
  check(
    inputs.every((i) => i.mode === "decimal" && i.h >= 44),
    "AC27 every amount input is inputmode=decimal and ≥ 44 px",
  );
  await yk.fill("#plan-dues", "12.500");
  await yk.fill("#plan-tickets", "3000,50");
  await yk.fill("#plan-donation", "₺1.000");
  await yk.fill("#plan-sponsorship", "0");
  await yk.fill("#plan-grant", "0,00");
  await yk.fill("#plan-venue", "abc");
  await yk.locator("#plan-costume").focus();
  const totals = (await yk.locator("[data-testid=plan-totals]").innerText()).replace(/\s+/g, " ");
  check(
    totals.includes("Planlanan gelir ₺16.500,50") &&
      totals.includes("Planlanan gider ₺0,00") &&
      totals.includes("Planlanan net +₺16.500,50"),
    `AC27 live totals (${totals})`,
  );
  check(
    await toast(yk, "Tutarı 1.250,50 biçiminde gir."),
    "AC27 an invalid amount shows the parseAmount message inline",
  );
  const fits = await noOverflow(yk);
  await yk.locator("#plan-dues").scrollIntoViewIfNeeded();
  const save = yk.getByRole("button", { name: "Kaydet" });
  const box = await save.boundingBox();
  check(
    fits && box && box.y > 0 && box.y + box.height <= 812,
    "AC27 at 375 px no horizontal scroll and Kaydet stays reachable",
  );
  await save.click();
  await yk.waitForTimeout(1200);
  check(
    (await scalar("select count(*) from budget_lines where budget_id = ?", [id])) === 0 &&
      new URL(yk.url()).pathname.endsWith("/duzenle"),
    "AC27 with an invalid line nothing is saved",
  );
  await yk.fill("#plan-venue", "");
  await save.click();
  await yk.waitForURL(`${BASE}/finans/butce/${id}`);
  check(
    await toast(yk, "Plan kaydedildi."),
    "AC27 Kaydet returns to the report with Plan kaydedildi.",
  );
  const saved = Object.fromEntries(
    (
      await db.execute({
        sql: "select category, amount_kurus from budget_lines where budget_id = ?",
        args: [id],
      })
    ).rows.map((r) => [r.category, r.amount_kurus]),
  );
  check(
    JSON.stringify(saved) ===
      JSON.stringify({ dues: 1250000, tickets: 300050, donation: 100000 }) ||
      (saved.dues === 1250000 &&
        saved.tickets === 300050 &&
        saved.donation === 100000 &&
        Object.keys(saved).length === 3),
    `AC27 the DB has 1250000, 300050 and 100000 kuruş; no row for blank, 0 or 0,00 (${JSON.stringify(saved)})`,
  );
  check(
    (await scalar("select count(*) from budget_revisions where budget_id = ?", [id])) === 0,
    "AC31 a draft save writes no history",
  );
  await yk.context().close();
}

async function prefill(browser, by) {
  const cal = await insertBudget({
    name: "E2E 2021",
    start: "2021-01",
    lines: { tickets: 100000, donation: 200000, travel: 50000 },
    by,
  });
  const e = (kind, category, kurus, day, extra = {}) =>
    insertEntry({ kind, category, kurus, day, by, ...extra });
  await e("income", "tickets", 123456, "2021-03-10");
  await e("income", "donation", 50000, "2021-06-01");
  await e("expense", "travel", 70000, "2021-12-31");
  await e("expense", "venue", 90000, "2021-07-07", { voided: true });
  await e("transfer", null, 40000, "2021-05-05");
  await e("income", "donation", 11100, "2020-12-31");
  await e("income", "donation", 22200, "2022-01-01");
  const next = await insertBudget({ name: "E2E 2022", start: "2022-01", by });
  const empty = await insertBudget({ name: "E2E 2017", start: "2017-01", by });
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, `/finans/butce/${next}/duzenle`);
  check(
    (await text(yk.locator("main"))).includes(
      "Ocak 2021 – Aralık 2021 gerçekleşenleri yazılır, liraya yukarı yuvarlanır. Kaydetmeden önce değiştirebilirsin.",
    ),
    "AC28 the prefill hint names the prior 12 months",
  );
  await yk.getByRole("button", { name: "Önceki 12 aydan doldur" }).click();
  await yk
    .waitForFunction(() => document.querySelector("#plan-tickets")?.value !== "", null, {
      timeout: 10_000,
    })
    .catch(() => {});
  const values = await yk
    .locator("[data-testid=plan-row] input")
    .evaluateAll((els) =>
      Object.fromEntries(els.filter((e) => e.value).map((e) => [e.name, e.value])),
    );
  check(
    JSON.stringify(values) ===
      JSON.stringify({ tickets: "1.235,00", donation: "500,00", travel: "700,00" }),
    `AC28 prefill: sums of the prior year rounded up to lira; voided, transfer and out-of-window ignored (${JSON.stringify(values)})`,
  );
  await yk.reload();
  check(
    (await scalar("select count(*) from budget_lines where budget_id = ?", [next])) === 0,
    "AC28 nothing is saved until Kaydet",
  );
  await yk.locator("#plan-dues").waitFor();
  await yk.fill("#plan-dues", "5.000");
  await yk.getByRole("button", { name: "Önceki 12 aydan doldur" }).click();
  const dlg = yk.getByRole("alertdialog");
  await dlg.waitFor();
  check(
    (await text(dlg)).includes(
      "Yazdığın tutarların yerine önceki 12 ayın rakamları yazılsın mı?",
    ) && (await dlg.getByRole("button", { name: "Vazgeç" }).count()) === 1,
    "AC28 with a typed value, a confirm asks first (Vazgeç / Doldur)",
  );
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  check(
    (await yk.inputValue("#plan-dues")).startsWith("5.000"),
    "AC28 Vazgeç keeps the typed value",
  );
  await yk.getByRole("button", { name: "Önceki 12 aydan doldur" }).click();
  await yk.getByRole("alertdialog").getByRole("button", { name: "Doldur" }).click();
  await yk
    .waitForFunction(() => document.querySelector("#plan-tickets")?.value === "1.235,00", null, {
      timeout: 10_000,
    })
    .catch(() => {});
  check(
    (await yk.inputValue("#plan-dues")) === "" &&
      (await yk.inputValue("#plan-tickets")) === "1.235,00",
    "AC28 Doldur replaces the inputs",
  );
  await goto(yk, `/finans/butce/${empty}/duzenle`);
  await yk.getByRole("button", { name: "Önceki 12 aydan doldur" }).click();
  check(
    await toast(yk, "Önceki 12 ayda kayıt yok."),
    "AC28 no entries in the window: Önceki 12 ayda kayıt yok.",
  );
  await yk.context().close();
  return { cal, next, empty };
}

async function approveAndDelete(browser, ids, { id, empty }) {
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, `/finans/butce/${empty}`);
  await yk.getByRole("button", { name: "Onayla" }).click();
  const dlg = yk.getByRole("alertdialog");
  check(
    (await text(dlg)).includes("Bütçe onaylansın mı?") &&
      (await text(dlg)).includes(
        "Onaydan sonra adı ve başlangıç ayı değişmez. Tutar değişiklikleri gerekçesiyle geçmişe yazılır.",
      ),
    "AC29 the approve confirm copy",
  );
  await dlg.getByRole("button", { name: "Onayla" }).click();
  check(
    await toast(yk, "Onaylamak için plana en az bir tutar gir."),
    "AC29 an empty plan can't be approved",
  );

  // Delete the empty draft.
  const ledger = await scalar("select count(*) from finance_entries");
  await goto(yk, `/finans/butce/${empty}`);
  await yk.getByRole("button", { name: "Sil" }).click();
  const del = yk.getByRole("alertdialog");
  check(
    (await text(del)).includes("“E2E 2017” silinsin mi?") &&
      (await text(del)).includes("Plan tutarları da silinir. Kasa hareketleri etkilenmez."),
    "AC30 the draft delete confirm copy",
  );
  await del.getByRole("button", { name: "Sil" }).click();
  await yk.waitForURL(`${BASE}/finans/butce`);
  check(
    (await toast(yk, "Bütçe silindi.")) &&
      (await scalar("select count(*) from budgets where id = ?", [empty])) === 0 &&
      (await scalar("select count(*) from finance_entries")) === ledger,
    "AC30 the draft is deleted with Bütçe silindi.; ledger untouched",
  );

  // Approve the plan created through the editor.
  await goto(yk, `/finans/butce/${id}`);
  await yk.getByRole("button", { name: "Onayla" }).click();
  await yk.getByRole("alertdialog").getByRole("button", { name: "Onayla" }).click();
  check(await toast(yk, "Bütçe onaylandı."), "AC29 Bütçe onaylandı.");
  await goto(yk, `/finans/butce/${id}`);
  const main = await text(yk.locator("main"));
  check(
    (await yk.locator("[data-testid=budget-status]").getAttribute("data-status")) === "approved" &&
      /Onaylayan: Demo Yönetim · \d+ \S+ \d{4}/.test(main) &&
      (await yk.getByRole("button", { name: "Sil" }).count()) === 0 &&
      (await yk.getByRole("button", { name: "Onayla" }).count()) === 0 &&
      (await yk.getByRole("link", { name: "Planı değiştir" }).count()) === 1,
    "AC29 after approval: Onaylandı, Onaylayan, no Sil, Planı değiştir",
  );
  const lockedName = await callForm(yk, ids.updateBudget, [id], {
    name: "E2E yeni ad",
    start: `${FREE_YEAR}-01`,
    note: "",
  });
  const lockedStart = await callForm(yk, ids.updateBudget, [id], {
    name: String(FREE_YEAR),
    start: `${FREE_YEAR}-02`,
    note: "",
  });
  const noDelete = await callAction(yk, ids.deleteBudget, [id]);
  check(
    lockedName.includes("Onaylanmış bütçenin adı ve tarihleri değiştirilemez.") &&
      lockedStart.includes("Onaylanmış bütçenin adı ve tarihleri değiştirilemez.") &&
      noDelete.includes("Onaylanmış bütçe silinemez."),
    "AC29 the server refuses name/start changes and deletes on an approved budget",
  );
  await goto(yk, `/finans/butce/${id}/bilgiler`);
  check(
    (await yk.locator("#startMonth").isDisabled()) &&
      (await yk.locator("input[name=name]").getAttribute("readonly")) !== null,
    "AC29 the name and start month are no longer offered for change",
  );
  await yk.locator("textarea[name=note]").fill("E2E 2 konser, 40 korist × aylık 300 ₺");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForURL(`${BASE}/finans/butce/${id}`);
  check(
    (await scalar("select note from budgets where id = ?", [id])) ===
      "E2E 2 konser, 40 korist × aylık 300 ₺" &&
      (await scalar("select count(*) from budget_revisions where budget_id = ?", [id])) === 0 &&
      (await text(yk.locator("[data-testid=budget-note]"))).startsWith("E2E 2 konser"),
    "AC29 the note stays editable, with no history entry",
  );
  await yk.context().close();
}

async function revise(browser, ids, id) {
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, `/finans/butce/${id}/duzenle`);
  check(
    (await yk.locator("h1").innerText()) === "Planı değiştir",
    "AC31 the editor of an approved budget is titled Planı değiştir",
  );
  await yk.getByRole("button", { name: "Kaydet" }).click();
  check(
    await toast(yk, "Hiçbir tutar değişmedi."),
    "AC31 saving with no change: Hiçbir tutar değişmedi.",
  );
  const all = Object.fromEntries(
    await yk
      .locator("[data-testid=plan-row] input")
      .evaluateAll((els) => els.map((e) => [e.name, e.value])),
  );
  const direct = await callForm(yk, ids.savePlan, [id], {
    ...all,
    revision: await scalar("select revision from budgets where id = ?", [id]),
    reason: "E2E değişmeyen",
  });
  check(
    direct.includes("Hiçbir tutar değişmedi."),
    "AC31 the server refuses a no-change revision too",
  );
  await yk.fill("#plan-venue", "abc");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForTimeout(300);
  check(
    (await yk.getByRole("alertdialog").count()) === 0 &&
      (await yk.evaluate(() => document.activeElement?.id)) === "plan-venue",
    "UI P3-5 an invalid amount on an approved plan is flagged before the reason dialog opens",
  );
  await yk.fill("#plan-venue", "");
  await yk.fill("#plan-dues", "13.000");
  await yk.fill("#plan-travel", "2.600");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  const dlg = yk.getByRole("alertdialog");
  await dlg.waitFor();
  await yk.waitForTimeout(200);
  check(
    (await yk.evaluate(() => document.activeElement?.id)) === "reason",
    "UI P3-6 the revise dialog opens with the focus on Değişiklik gerekçesi",
  );
  const diff = await dlg.locator("[data-testid=revise-diff] li").allInnerTexts();
  check(
    diff.join("|") === "Aidat: ₺12.500,00 → ₺13.000,00|Ulaşım ve konaklama: ₺0,00 → ₺2.600,00",
    `AC31 the revise dialog lists the changed lines (${diff})`,
  );
  await dlg.getByLabel("Değişiklik gerekçesi").fill("abc");
  await dlg.getByRole("button", { name: "Kaydet" }).click();
  check(
    await toast(yk, "Gerekçe en az 5 karakter olmalı."),
    "AC31 Gerekçe en az 5 karakter olmalı.",
  );
  await dlg.getByLabel("Değişiklik gerekçesi").fill("E2E festival daveti geldi");
  await dlg.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForURL(`${BASE}/finans/butce/${id}`);
  const entry = yk.locator("[data-testid=budget-revision]").first();
  const entryText = await text(entry);
  check(
    /^Demo Yönetim · \d+ \S+ \d{4} \d\d:\d\d · “E2E festival daveti geldi”/.test(entryText) &&
      (await entry.locator("ul li").allInnerTexts()).join("|") ===
        "Aidat: ₺12.500,00 → ₺13.000,00|Ulaşım ve konaklama: ₺0,00 → ₺2.600,00",
    `AC31 one history entry with two lines (${entryText})`,
  );
  const dues = yk.locator("[data-testid=budget-line][data-category=dues]");
  check(
    (await dues.getAttribute("data-plan-kurus")) === "1300000" &&
      (await yk.locator("[data-testid=budget-approval]").count()) === 1,
    "AC31 the report uses the new amounts; the approval is the oldest history entry",
  );
  // Stale: two editors.
  const sef = await as(browser, "sef@arkhe.local", { phone: true });
  await goto(sef, `/finans/butce/${id}/duzenle`);
  await goto(yk, `/finans/butce/${id}/duzenle`);
  await sef.fill("#plan-tickets", "4.000");
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef
    .getByRole("alertdialog")
    .getByLabel("Değişiklik gerekçesi")
    .fill("E2E şef önce davrandı");
  await sef.getByRole("alertdialog").getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForURL(`${BASE}/finans/butce/${id}`);
  await yk.fill("#plan-catering", "100");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.getByRole("alertdialog").getByLabel("Değişiklik gerekçesi").fill("E2E yk geç kaldı");
  await yk.getByRole("alertdialog").getByRole("button", { name: "Kaydet" }).click();
  const staleToast = yk.locator("[data-sonner-toast]", {
    hasText: "Bu plan az önce değişti. Sayfayı yenile.",
  });
  await staleToast.waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    (await staleToast.count()) === 1 &&
      (await staleToast.getByRole("button", { name: "Yenile" }).count()) === 1 &&
      (await scalar(
        "select count(*) from budget_lines where budget_id = ? and category = 'catering'",
        [id],
      )) === 0,
    "AC31 a stale revision is refused with Bu plan az önce değişti. and Yenile",
  );
  await sef.context().close();
  await yk.context().close();
}

async function upcoming(browser, ids, by) {
  const season = budgetSeason(new Date());
  const start = season.current.end;
  const today = istanbulDate();
  const id = await insertBudget({
    name: "E2E sonraki sezon",
    start,
    lines: { dues: 1250000, donation: 100000, travel: 400000 },
    by,
  });
  await insertEntry({ kind: "income", category: "donation", kurus: 50000, day: today, by });
  const [sy, sm] = start.split("-").map(Number);
  for (const scheme of ["light", "dark"]) {
    const yk = await as(browser, "yk@arkhe.local", { phone: true, scheme });
    await goto(yk, `/finans/butce/${id}`);
    const summary = yk.locator("[data-testid=budget-summary]");
    const sumText = (await summary.innerText()).replace(/\s+/g, " ");
    const got = await lines(yk);
    if (scheme === "light") {
      check(
        (await summary.getAttribute("data-phase")) === "future" &&
          sumText.includes("Planlanan gelir ₺13.500,00") &&
          sumText.includes("Planlanan gider ₺4.000,00") &&
          sumText.includes("Planlanan net +₺9.500,00") &&
          (await text(yk.locator("[data-testid=budget-starts]"))).startsWith(
            `Gerçekleşenler ${MONTHS[sm - 1]} ${sy}'`,
          ) &&
          !/eksik|kaldı|Sürüyor|%/.test(sumText),
        `UX P1-1 a future budget's summary shows only the plan and when actuals start (${sumText})`,
      );
      check(
        got.length === 3 &&
          got.every(
            (l) =>
              l.signal === "upcoming" &&
              l.chip === "Başlamadı" &&
              !l.bar &&
              l.words === undefined &&
              l.pctText === undefined &&
              l.labels.join(",") === "Plan",
          ),
        `UX P1-1 future line cards: plan only, a Başlamadı chip, no bar (${JSON.stringify(got[0])})`,
      );
      // UX P2-3: one primary action on top; the rest under Bütçe işlemleri at the end.
      const top = await yk.evaluate(() => {
        const h = document.querySelector("[data-testid=budget-summary]");
        return [...document.querySelectorAll("main a, main button")]
          .filter((e) => e.offsetParent && h.compareDocumentPosition(e) & 2)
          .map((e) => e.textContent.trim())
          .filter((t) => t !== "Bütçeler");
      });
      const tools = yk.locator("section[aria-labelledby=islemler]");
      const toolNames = (await tools.locator("a:visible, button:visible").allInnerTexts()).map(
        (t) => t.trim(),
      );
      check(
        top.join(",") === "Onayla" &&
          toolNames.join(",") === "Planı düzenle,Bilgileri düzenle,CSV indir,Sil" &&
          (await yk.evaluate(() => {
            const s = document.querySelector("section[aria-labelledby=islemler]");
            return !s.nextElementSibling;
          })),
        `UX P2-3 phone: only Onayla above the summary (${top}); Bütçe işlemleri last (${toolNames})`,
      );
    }
    check(
      (await noOverflow(yk)) && (await smallTargets(yk)).length === 0,
      `AC42 ${scheme}: the future report fits 375 px, targets ≥ 44 px`,
    );
    await yk.context().close();
  }
  const page = await as(browser, "yk@arkhe.local");
  const res = await page.request.get(`${BASE}/finans/butce/${id}/csv`);
  const rows = csvRows(Buffer.from(await res.body()));
  const body = rows.filter((r) => r[1] !== "Toplam" && r[0] !== "Net" && r[0] !== "Tür");
  check(
    res.ok() && body.length === 3 && body.every((r) => r[6] === ""),
    `UX P1-1 a future budget's CSV leaves Durum empty (${body.map((r) => r[6])})`,
  );
  await page.context().close();

  // UX P2-5: the prior window is the running season, so the prefill warns it is partial.
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, `/finans/butce/${id}/duzenle`);
  const [ty, tm, td] = istanbulDate().split("-").map(Number);
  const through = `${td} ${MONTHS[tm - 1]} ${ty}`;
  const [py, pm] = season.current.start.split("-").map(Number);
  check(
    (await text(yk.locator("[data-testid=prefill-hint]"))) ===
      `${MONTHS[pm - 1]} ${py} – ${through} arası yazılır; bu dönem henüz bitmedi, rakamlar eksik olabilir.`,
    `UX P2-5 the hint names the window up to today (${await text(yk.locator("[data-testid=prefill-hint]"))})`,
  );
  await yk.getByRole("button", { name: "Önceki 12 aydan doldur" }).click();
  await yk.getByRole("alertdialog").getByRole("button", { name: "Doldur" }).click();
  check(
    await toast(
      yk,
      `Önceki dönem henüz bitmedi: yazılan rakamlar yalnızca ${through} tarihine kadarki kayıtlar.`,
    ),
    "UX P2-5 a partial prefill ends with the warning toast",
  );
  await yk.context().close();

  // The approve race: a start change bumps the revision, so an approve with the old one is stale.
  const race = await insertBudget({
    name: "E2E yarış",
    start: `${FREE_YEAR + 2}-01`,
    lines: { dues: 100000 },
    by,
  });
  const old = await scalar("select revision from budgets where id = ?", [race]);
  const ctx = await as(browser, "yk@arkhe.local");
  await callForm(ctx, ids.updateBudget, [race], {
    name: "E2E yarış",
    start: `${FREE_YEAR + 2}-02`,
    note: "",
  });
  const moved = await scalar("select start_month from budgets where id = ?", [race]);
  const refused = await callAction(ctx, ids.approveBudget, [race, old]);
  check(
    moved === `${FREE_YEAR + 2}-02` &&
      refused.includes("Bu plan az önce değişti. Sayfayı yenile.") &&
      (await scalar("select approved_at from budgets where id = ?", [race])) === null,
    "Backend P2-1 approving with the revision from before a start change gives PLAN_STALE; still a draft",
  );
  await ctx.context().close();
  await db.execute({ sql: "delete from budgets where id in (?, ?)", args: [id, race] });
}

async function report(browser, by) {
  const past = await arrangePast(by);
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, `/finans/butce/${past}`);
  const got = await lines(yk);
  const byCat = Object.fromEntries(got.map((l) => [l.category, l]));
  const actual = Object.fromEntries(got.map((l) => [l.category, l.actual]));
  check(
    JSON.stringify(actual) ===
      JSON.stringify({
        donation: 120000,
        grant: 40000,
        other_income: 30000,
        venue: 0,
        scores_royalties: 80000,
        travel: 130000,
        festival_fee: 95000,
        organisation: 100000,
        other_expense: 5000,
      }),
    `AC32 actuals: first and last day in, day before/after out, leap day in, voided/transfer/opening out (${JSON.stringify(actual)})`,
  );
  check(
    got.map((l) => l.kind).join(",") ===
      "income,income,income,expense,expense,expense,expense,expense,expense",
    "AC33 income lines first, then expense; 0/0 lines hidden",
  );
  const exp = {
    donation: ["met", "Hedefe ulaşıldı", "₺200,00 fazla", "%120"],
    grant: ["short", "Hedefin altında", "₺600,00 eksik", "%40"],
    other_income: ["unplanned", "Plansız gelir", "₺300,00 fazla", "—"],
    scores_royalties: ["within", "Bütçe içinde", "₺200,00 harcanmadı", "%80"],
    festival_fee: ["near", "Sınıra yakın", "₺50,00 harcanmadı", "%95"],
    organisation: ["near", "Sınıra yakın", "Planla aynı", "%100"],
    travel: ["over", "Bütçe aşıldı", "₺300,00 aşıldı", "%130"],
    other_expense: ["unplanned", "Plansız gider", "₺50,00 aşıldı", "—"],
  };
  const wrong = Object.entries(exp).filter(([c, [s, label, words, pct]]) => {
    const l = byCat[c];
    return !l || l.signal !== s || l.chip !== label || l.words !== words || l.pctText !== pct;
  });
  check(
    wrong.length === 0,
    `AC34 signals, labels, words and % per line (${wrong.map(([c]) => `${c}:${JSON.stringify(byCat[c])}`).join(" ; ")})`,
  );
  check(
    byCat.other_income.planText === "Planlanmadı" &&
      !byCat.other_income.bar &&
      !byCat.other_expense.bar &&
      byCat.travel.bar &&
      byCat.travel.fill === "100" &&
      byCat.travel.over &&
      byCat.scores_royalties.fill === "80" &&
      !byCat.scores_royalties.over &&
      byCat.venue.planText === "₺500,00",
    "AC33 Planlanmadı and no bar on unplanned lines; bars fill min(pct,100) with an over-mark past 100",
  );
  check(
    byCat.travel.chipClass.includes("bg-absent") &&
      byCat.festival_fee.chipClass.includes("bg-late") &&
      byCat.grant.chipClass.includes("bg-late") &&
      byCat.other_expense.chipClass.includes("bg-late") &&
      byCat.donation.chipClass.includes("bg-present") &&
      byCat.scores_royalties.chipClass.includes("bg-present"),
    "AC34 tones: over alert, near/short/unplanned expense warning, met/within success",
  );
  check(
    got.every((l) => l.labels.includes("Plan") && l.labels.includes("Gerçekleşen")),
    "AC43 every number carries its label (dt)",
  );
  const totals = await yk
    .locator("[data-testid=budget-total]")
    .evaluateAll((els) =>
      els.map((e) => [e.dataset.kind, Number(e.dataset.planKurus), Number(e.dataset.actualKurus)]),
    );
  const net = yk.locator("[data-testid=budget-net]");
  check(
    JSON.stringify(totals) ===
      JSON.stringify([
        ["income", 200000, 190000],
        ["expense", 450000, 410000],
      ]) &&
      (await net.getAttribute("data-actual-kurus")) === "-220000" &&
      (await net.getAttribute("data-plan-kurus")) === "-250000" &&
      (await net.getAttribute("data-verdict")) === "better" &&
      (await text(net)).includes("Plandan iyi"),
    `AC35 ended: totals include unplanned lines; Net −₺2.200 vs −₺2.500 → Plandan iyi (${JSON.stringify(totals)})`,
  );
  check(
    (await text(yk.locator("[data-testid=budget-phase]"))) === "Dönem sonu raporu" &&
      (await yk.locator("[data-elapsed]").count()) === 0 &&
      (await yk
        .getByText(
          "Gerçekleşen: bu tarihlerde kasaya ve bankaya gerçekten giren ve çıkan para. Ödenmemiş aidat sayılmaz.",
        )
        .count()) === 1,
    "AC35 the ended heading Dönem sonu raporu, no period marker, the cash note once",
  );
  check(
    (await noOverflow(yk)) && (await smallTargets(yk)).length === 0,
    "AC42 light: the report has no horizontal scroll, targets ≥ 44 px",
  );

  // AC37 CSV.
  const dayBefore = istanbulDate();
  const res = await yk.request.get(`${BASE}/finans/butce/${past}/csv`);
  const buf = Buffer.from(await res.body());
  const raw = buf.toString("utf8");
  const disposition = res.headers()["content-disposition"] ?? "";
  check(
    [istanbulDate(), dayBefore].some((d) => disposition.includes(`arkhe-butce-2019-09-${d}.csv`)) &&
      raw.startsWith("\uFEFF") &&
      raw.includes("\r\n"),
    `AC37 filename arkhe-butce-2019-09-${istanbulDate()}.csv, BOM, CRLF (${disposition})`,
  );
  const csvLines = csvRows(buf).map((r) => r.join(";"));
  check(
    JSON.stringify(csvLines) === JSON.stringify(PAST_CSV),
    `AC37 the CSV rows, literally (${csvLines.slice(1, 3)})`,
  );
  const rows = csvRows(buf).slice(1);
  const kurus = (s) => Math.round(Number(s.replace(",", ".")) * 100);
  const mismatch = got.filter((l) => {
    const r = rows.find(
      (x) =>
        x[0] === (l.kind === "income" ? "Gelir" : "Gider") &&
        x[3] &&
        kurus(x[3]) === l.actual &&
        kurus(x[2]) === l.plan,
    );
    return !r;
  });
  check(mismatch.length === 0, "AC37 the CSV matches the report page to the kuruş");
  await yk.context().close();
  return past;
}

async function running(browser) {
  const { yk: ykId } = await people();
  const cur = BUDGET_IDS.current;
  const season = budgetSeason(new Date());
  await db.execute({
    sql: "insert into budget_lines (budget_id, category, amount_kurus) values (?, 'grant', 100000), (?, 'donation', 100000), (?, 'festival_fee', 100000)",
    args: [cur, cur, cur],
  });
  await insertEntry({
    kind: "income",
    category: "grant",
    kurus: 40000,
    day: istanbulDate(),
    by: ykId,
  });
  await insertEntry({
    kind: "income",
    category: "donation",
    kurus: 120000,
    day: `${season.current.start}-01`,
    by: ykId,
  });
  await insertEntry({
    kind: "expense",
    category: "festival_fee",
    kurus: 95000,
    day: istanbulDate(),
    by: ykId,
  });
  await insertEntry({
    kind: "income",
    category: "other_income",
    kurus: 30000,
    day: istanbulDate(),
    by: ykId,
  });
  for (const scheme of ["light", "dark"]) {
    const page = await as(browser, "yk@arkhe.local", { phone: true, scheme });
    await goto(page, `/finans/butce/${cur}`);
    const got = Object.fromEntries((await lines(page)).map((l) => [l.category, l]));
    const p = elapsed(season.current.start, istanbulDate());
    const markers = Object.values(got)
      .filter((l) => l.bar)
      .map((l) => l.elapsed);
    if (scheme === "light") {
      check(
        got.grant?.signal === "pending" &&
          got.grant.chip === "Sürüyor" &&
          got.grant.words === "₺600,00 eksik" &&
          got.donation?.signal === "met" &&
          got.festival_fee?.signal === "near",
        `AC34 running: grant 1000/400 → pending Sürüyor ₺600,00 eksik (${JSON.stringify(got.grant)})`,
      );
      const elapsedText = await text(page.locator("[data-testid=budget-elapsed]"));
      const [y, m, d] = istanbulDate().split("-").map(Number);
      check(
        (await text(page.locator("[data-testid=budget-phase]"))) === "Dönem içi durum" &&
          elapsedText === `Dönemin geçen kısmı: %${p}` &&
          (await text(page.locator("[data-testid=budget-summary]"))).includes(
            `${d} ${MONTHS[m - 1]} ${y} itibarıyla`,
          ) &&
          markers.length > 0 &&
          markers.every((v) => v === String(p)),
        `AC35 running: Dönem içi durum, ${elapsedText}, markers at ${p} (${markers.slice(0, 3)})`,
      );
      const net = page.locator("[data-testid=budget-net]");
      const totals = await page
        .locator("[data-testid=budget-total]")
        .evaluateAll((els) => els.map((e) => Number(e.dataset.actualKurus)));
      const sumIncome = Object.values(got)
        .filter((l) => l.kind === "income")
        .reduce((s, l) => s + l.actual, 0);
      const sumExpense = Object.values(got)
        .filter((l) => l.kind === "expense")
        .reduce((s, l) => s + l.actual, 0);
      check(
        (await net.getAttribute("data-verdict")) === "" &&
          (await text(net)).includes("Dönem sürüyor") &&
          !(await text(net)).includes("Plandan") &&
          totals[0] === sumIncome &&
          totals[1] === sumExpense,
        "AC35 while running: Dönem sürüyor and no verdict; totals equal the sums of the lines",
      );
    }
    const small = await smallTargets(page);
    check(
      (await noOverflow(page)) && small.length === 0,
      `AC42 ${scheme}: the running report fits at 375 px, targets ≥ 44 px (${small.slice(0, 3)})`,
    );
    for (const p2 of ["/finans/butce", `/finans/butce/${cur}/duzenle`, "/finans/butce/yeni"]) {
      await goto(page, p2);
      const s2 = await smallTargets(page);
      check(
        (await noOverflow(page)) && s2.length === 0,
        `AC42 ${scheme} ${p2}: no horizontal scroll, targets ≥ 44 px (${s2.slice(0, 3)})`,
      );
    }
    await page.context().close();
  }
}

async function ledgerAgreement(browser, cal) {
  const page = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(page, `/finans/butce/${cal}`);
  const totals = await page
    .locator("[data-testid=budget-total]")
    .evaluateAll((els) => els.map((e) => Number(e.dataset.actualKurus)));
  await goto(page, "/finans/rapor?yil=2021&hesap=toplam");
  const inc = Number(await page.locator("[data-testid=year-income]").getAttribute("data-kurus"));
  const exp = Number(await page.locator("[data-testid=year-expense]").getAttribute("data-kurus"));
  check(
    totals[0] === inc && totals[1] === exp && inc === 173456 && exp === 70000,
    `AC36 a January budget agrees with /finans/rapor for 2021 (${totals} vs ${inc}/${exp})`,
  );
  await goto(page, `/finans/butce/${cal}`);
  const v2 = await axe(page);
  await goto(page, `/finans/butce/${cal}/duzenle`);
  const v3 = await axe(page);
  check(
    v2.length === 0 && v3.length === 0,
    `AC43 axe: no serious violations on the report and the editor (${[...v2, ...v3].slice(0, 3)})`,
  );
  await page.context().close();
}

async function formula(browser, by) {
  const id = await insertBudget({
    name: "=2+3 sezon",
    start: "2016-01",
    lines: { donation: 100000 },
    by,
  });
  await insertEntry({ kind: "income", category: "donation", kurus: 5000, day: "2016-02-02", by });
  const page = await as(browser, "yk@arkhe.local");
  const res = await page.request.get(`${BASE}/finans/butce/${id}/csv`);
  const cells = csvRows(Buffer.from(await res.body())).flat();
  check(
    res.ok() && !cells.some((c) => c.includes("2+3")) && cells.every((c) => !/^[=+@]/.test(c)),
    "AC37 the budget name (=2+3 sezon) is not written into the CSV, and no cell starts a formula",
  );
  await page.context().close();
  await db.execute({ sql: "delete from budgets where id = ?", args: [id] });
}

async function constraints(by) {
  const id = await insertBudget({
    name: "E2E kısıt",
    start: "2014-01",
    lines: { donation: 100 },
    by,
  });
  const bad = [
    [
      "zero line",
      `insert into budget_lines (budget_id, category, amount_kurus) values ('${id}', 'grant', 0)`,
    ],
    [
      "duplicate line",
      `insert into budget_lines (budget_id, category, amount_kurus) values ('${id}', 'donation', 5)`,
    ],
    [
      "bad category",
      `insert into budget_lines (budget_id, category, amount_kurus) values ('${id}', 'pizza', 5)`,
    ],
    [
      "bad month",
      `insert into budgets (id, name, start_month, end_month, created_by) values ('${crypto.randomUUID()}', 'E2E ay', '2013-13', '2014-13', '${by}')`,
    ],
    [
      "approval pair",
      `insert into budgets (id, name, start_month, end_month, approved_at, created_by) values ('${crypto.randomUUID()}', 'E2E çift', '2012-01', '2013-01', 1, '${by}')`,
    ],
    [
      "overlap",
      `insert into budgets (id, name, start_month, end_month, created_by) values ('${crypto.randomUUID()}', 'E2E üst üste', '2014-06', '2015-06', '${by}')`,
    ],
    [
      "long name",
      `insert into budgets (id, name, start_month, end_month, created_by) values ('${crypto.randomUUID()}', '${"x".repeat(41)}', '2011-01', '2012-01', '${by}')`,
    ],
  ];
  const passed = [];
  for (const [name, sql] of bad) {
    try {
      await db.execute(sql);
      passed.push(name);
    } catch {}
  }
  check(passed.length === 0, `AC41 invalid budget writes fail at the DB (${passed})`);
  await db.execute({ sql: "delete from budgets where id = ?", args: [id] });
  check(
    (await scalar("select count(*) from budget_lines where budget_id = ?", [id])) === 0,
    "AC41 lines cascade with their budget",
  );
}

async function perf(browser, past, by) {
  const statements = [];
  for (let i = 0; i < 5000; i++) {
    const day = addDays("2019-09-01", i % 360);
    statements.push({
      sql: `insert into finance_entries (id, kind, category, amount_kurus, occurred_on, account, description, created_by)
            values (?, ?, ?, ?, ?, 'bank', 'E2E bütçe', ?)`,
      args: [
        crypto.randomUUID(),
        i % 2 ? "income" : "expense",
        i % 2 ? "tickets" : "catering",
        100 + i,
        day,
        by,
      ],
    });
  }
  await db.batch(statements, "write");
  const page = await as(browser, "yk@arkhe.local");
  await page.goto(`${BASE}/finans/butce/${past}`);
  const s = Date.now();
  const res = await page.request.get(`${BASE}/finans/butce/${past}`);
  const ms = Date.now() - s;
  check(res.ok() && ms < 1000, `AC44 a report over 5000 entries answers in ${ms} ms (< 1 s)`);
  await page.context().close();
  const plan = (
    await db.execute(
      "explain query plan select category, sum(amount_kurus) from finance_entries where kind in ('income','expense') and voided_at is null and occurred_on >= '2019-09-01' and occurred_on < '2020-09-01' group by category",
    )
  ).rows
    .map((r) => r.detail)
    .join(" | ");
  check(
    plan.includes("fe_occurred_idx") && !/SCAN finance_entries(?! USING)/.test(plan),
    `AC44 the actuals query uses fe_occurred_idx (${plan})`,
  );
}

export default async function run(browser) {
  await reset();
  const { yk } = await people();
  const warm = await as(browser, "yk@arkhe.local");
  for (const p of [
    "/finans/butce",
    "/finans/butce/yeni",
    `/finans/butce/${BUDGET_IDS.current}`,
    `/finans/butce/${BUDGET_IDS.current}/duzenle`,
    `/finans/butce/${BUDGET_IDS.current}/bilgiler`,
  ]) {
    await goto(warm, p);
  }
  await warm.context().close();
  const ids = await actionIds(BUDGET_ACTIONS, BUDGET_IDS.current);
  check(
    [
      "createBudget",
      "updateBudget",
      "savePlan",
      "approveBudget",
      "deleteBudget",
      "prefillPlan",
    ].every((n) => ids[n]),
    `Phase 8 setup: all budget actions are registered (${Object.keys(ids)})`,
  );
  try {
    await access(browser, ids);
    await list(browser);
    const id = await create(browser, ids);
    await editor(browser, id);
    const f = await prefill(browser, yk);
    await approveAndDelete(browser, ids, { id, empty: f.empty });
    await revise(browser, ids, id);
    await upcoming(browser, ids, yk);
    const past = await report(browser, yk);
    await running(browser);
    await ledgerAgreement(browser, f.cal);
    await formula(browser, yk);
    await constraints(yk);
    await perf(browser, past, yk);
  } finally {
    await reset();
  }
}
