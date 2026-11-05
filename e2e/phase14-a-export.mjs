// Phase 14 A: reports download as Excel and PDF next to CSV, from the same table, manager-only.
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { FINANCE_IDS } from "../scripts/finance-fixture.mjs";
import { BASE, check, cleanup, db, login, loginAs, newPage } from "./lib.mjs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HEADER_ROW = 4;

export default async function run(browser) {
  await cleanup();
  try {
    await suite(browser);
  } finally {
    await cleanup();
  }
}

async function readXlsx(body) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body);
  const ws = wb.worksheets[0];
  const header = ws.getRow(HEADER_ROW).values.slice(1);
  const rows = [];
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) rows.push(ws.getRow(r).values.slice(1));
  return { ws, header, rows };
}

/** CSV body → rows of cell strings (the CSVs here never hold ";" inside a cell). */
function csvRows(text) {
  return text
    .replace(/^﻿/, "")
    .trim()
    .split("\r\n")
    .map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"')));
}

async function suite(browser) {
  const yk = await loginAs(browser, "yk@arkhe.local");
  const year = new Date().getFullYear();
  const budget = (await db.execute("select id from budgets order by start_month desc limit 1"))
    .rows[0].id;
  const reports = [
    { name: "attendance", base: "/raporlar", query: "" },
    { name: "ledger", base: "/finans/rapor", query: `from=${year}-01-01&to=${year}-12-31` },
    { name: "dues", base: "/finans/aidat", query: `donem=${FINANCE_IDS.periods[2]}` },
    { name: "budget", base: `/finans/butce/${budget}`, query: "" },
  ];

  for (const r of reports) {
    const url = (f) => `${BASE}${r.base}/${f}${r.query ? `?${r.query}` : ""}`;
    const [csv, xlsx, pdf] = await Promise.all(
      ["csv", "xlsx", "pdf"].map((f) => yk.request.get(url(f))),
    );
    const xBody = await xlsx.body();
    const pBody = await pdf.body();
    check(
      xlsx.status() === 200 &&
        xlsx.headers()["content-type"] === XLSX_TYPE &&
        /attachment; filename="[^"]+\.xlsx"/.test(xlsx.headers()["content-disposition"]) &&
        xBody.subarray(0, 2).toString() === "PK",
      `${r.name}: Excel downloads as an .xlsx attachment`,
    );
    check(
      pdf.status() === 200 &&
        pdf.headers()["content-type"] === "application/pdf" &&
        /filename="[^"]+\.pdf"/.test(pdf.headers()["content-disposition"]) &&
        pBody.subarray(0, 5).toString() === "%PDF-",
      `${r.name}: PDF downloads as a .pdf attachment`,
    );
    const doc = await PDFDocument.load(pBody);
    check(
      doc.getPageCount() >= 1 && doc.getTitle()?.length > 0,
      `${r.name}: the PDF opens (${doc.getPageCount()} pages)`,
    );

    const csvData = csvRows(await csv.text());
    const { header, rows } = await readXlsx(xBody);
    check(
      JSON.stringify(header) === JSON.stringify(csvData[0]) && rows.length === csvData.length - 1,
      `${r.name}: Excel has the CSV's header and ${rows.length} rows`,
    );
    if (r.name === "attendance") {
      const { ws } = await readXlsx(xBody);
      const warnCol = header.indexOf("Uyarı") + 1;
      const pctCol = header.indexOf("Yüzde") + 1;
      const tones = { DDF2E3: "ok", FDE3C4: "near", F8D0CC: "over" };
      const seen = new Set();
      let consistent = true;
      for (let i = 0; i < rows.length; i++) {
        const row = ws.getRow(HEADER_ROW + 1 + i);
        const tone = tones[row.getCell(1).fill?.fgColor?.argb?.slice(2)];
        seen.add(tone);
        const warned = row.getCell(warnCol).value === "Evet";
        const pctValue = row.getCell(pctCol).value;
        if (warned !== (tone === "over")) consistent = false;
        if (tone === "ok" && typeof pctValue === "number" && pctValue < 70) consistent = false;
      }
      check(
        consistent,
        "attendance: red rows are exactly the Uyarı rows; green rows are at %70 or more",
      );
      check(seen.has("ok") && seen.has("over"), `attendance: Excel rows are tinted (${[...seen]})`);
      check(
        String(ws.getCell(2, 1).value).includes(
          "Turuncu: bir devamsızlık daha olursa sınırı geçer",
        ),
        "attendance: the legend is under the title",
      );
    }
    if (r.name === "ledger") {
      const col = header.indexOf("Gelir");
      const csvSum = csvData
        .slice(1)
        .reduce((s, row) => s + Math.round(Number((row[col] || "0").replace(",", ".")) * 100), 0);
      const xSum = rows.reduce(
        (s, row) => s + Math.round((typeof row[col] === "number" ? row[col] : 0) * 100),
        0,
      );
      check(
        csvSum > 0 && csvSum === xSum,
        `ledger: Excel amounts are numbers summing to the CSV (${xSum / 100})`,
      );
      const dateCell = rows[0][header.indexOf("Tarih")];
      check(dateCell instanceof Date, "ledger: Excel dates are real dates");
      const formula = rows.some((row) =>
        row.some((v) => typeof v === "object" && v && "formula" in v),
      );
      check(!formula, "ledger: a formula-looking description stays text in Excel");
    }
  }

  // Toplu rapor: one workbook / one PDF with every area, from the first record to today.
  const fullX = await yk.request.get(`${BASE}/raporlar/toplu/xlsx`);
  const fullP = await yk.request.get(`${BASE}/raporlar/toplu/pdf`);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await fullX.body());
  const names = book.worksheets.map((w) => w.name);
  const expectedNames = [
    "Özet",
    "Üyeler",
    "Devam (tümü)",
    "Devam (dönemler)",
    "Ödevler",
    "Muhasebe",
    "Aidat",
    "Bütçeler",
    "Repertuvar",
  ];
  check(
    fullX.status() === 200 && JSON.stringify(names) === JSON.stringify(expectedNames),
    `toplu: Excel has one sheet per area (${names})`,
  );
  check(
    /filename\*=UTF-8''arkhe-toplu-rapor-\d{4}-\d{2}-\d{2}\.xlsx/.test(
      fullX.headers()["content-disposition"],
    ),
    "toplu: the file is named arkhe-toplu-rapor-<today>.xlsx",
  );
  const sheetRows = (name) => book.getWorksheet(name).rowCount - HEADER_ROW;
  const liveEntries = Number(
    (await db.execute("select count(*) as n from finance_entries where voided_at is null")).rows[0]
      .n,
  );
  check(
    sheetRows("Muhasebe") === liveEntries,
    `toplu: Muhasebe holds every live entry (${sheetRows("Muhasebe")}/${liveEntries})`,
  );
  const users = Number((await db.execute("select count(*) as n from users")).rows[0].n);
  check(
    sheetRows("Üyeler") === users,
    `toplu: Üyeler lists every user (${sheetRows("Üyeler")}/${users})`,
  );
  const summary = book.getWorksheet("Özet");
  const summaryMap = new Map();
  summary.eachRow(
    (row, r) => r > HEADER_ROW && summaryMap.set(row.getCell(1).value, row.getCell(2).value),
  );
  const ledgerSheet = book.getWorksheet("Muhasebe");
  const ledgerHeader = ledgerSheet.getRow(HEADER_ROW).values.slice(1);
  let incomeSum = 0;
  ledgerSheet.eachRow((row, r) => {
    const v = row.getCell(ledgerHeader.indexOf("Gelir") + 1).value;
    if (r > HEADER_ROW && typeof v === "number") incomeSum += Math.round(v * 100);
  });
  check(
    Math.round(summaryMap.get("Toplam gelir") * 100) === incomeSum && incomeSum > 0,
    `toplu: Özet's Toplam gelir equals the Muhasebe sheet (${incomeSum / 100})`,
  );
  let tinted = 0;
  book.getWorksheet("Devam (dönemler)").eachRow((row, r) => {
    if (r > HEADER_ROW && row.getCell(1).fill?.fgColor?.argb) tinted++;
  });
  check(tinted > 0, `toplu: per-term attendance rows are tinted too (${tinted})`);
  const fullDoc = await PDFDocument.load(await fullP.body());
  check(
    fullP.status() === 200 && fullDoc.getPageCount() >= expectedNames.length,
    `toplu: the PDF has a section per area (${fullDoc.getPageCount()} pages)`,
  );

  // Bad input and permissions behave as the CSV route does.
  check(
    (await yk.request.get(`${BASE}/finans/rapor/pdf?from=2026-02-01&to=2026-01-01`)).status() ===
      400,
    "an inverted range is a 400 for PDF too",
  );
  check(
    (await yk.request.get(`${BASE}/finans/aidat/xlsx?donem=nope`)).status() === 404,
    "an unknown dues period is a 404 for Excel",
  );
  const korist = await loginAs(browser, "korist@arkhe.local");
  const memberStatuses = await Promise.all(
    [
      "/raporlar/xlsx",
      "/raporlar/pdf",
      "/finans/rapor/xlsx",
      `/finans/butce/${budget}/pdf`,
      "/raporlar/toplu/xlsx",
      "/raporlar/toplu/pdf",
    ].map(async (p) => (await korist.request.get(`${BASE}${p}`)).status()),
  );
  check(
    memberStatuses.every((s) => s === 403),
    `members get 403 for Excel/PDF (${memberStatuses})`,
  );
  const anon = await fetch(`${BASE}/finans/aidat/pdf?donem=${FINANCE_IDS.periods[2]}`, {
    redirect: "manual",
  });
  const toLogin =
    anon.status >= 300 && anon.status < 400 && anon.headers.get("location")?.includes("/giris");
  check(anon.status === 401 || toLogin, `signed out gets no file (${anon.status})`);

  // The İndir menu on a phone: three options pointing at the three formats.
  const phone = await loginAs(browser, "sef@arkhe.local", { mobile: true });
  await phone.goto(`${BASE}/raporlar`);
  await phone.getByTestId("export-menu").click();
  const hrefs = await Promise.all(
    ["xlsx", "pdf", "csv"].map((f) => phone.getByTestId(`export-${f}`).getAttribute("href")),
  );
  check(
    hrefs.every((h, i) => h?.startsWith(`/raporlar/${["xlsx", "pdf", "csv"][i]}?donem=`)),
    `İndir menu offers Excel, PDF, CSV with the period (${hrefs})`,
  );
  const [download] = await Promise.all([
    phone.waitForEvent("download"),
    phone.getByTestId("export-pdf").click(),
  ]);
  check(
    download.suggestedFilename().endsWith(".pdf"),
    `the PDF option downloads ${download.suggestedFilename()}`,
  );

  const card = phone.getByTestId("full-report");
  check(
    (await card.getByRole("link", { name: "Excel" }).getAttribute("href")) ===
      "/raporlar/toplu/xlsx" &&
      (await card.getByRole("link", { name: "PDF" }).getAttribute("href")) ===
        "/raporlar/toplu/pdf",
    "toplu: the Raporlar page offers the full report as Excel and PDF",
  );
  const fits = await phone.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  check(fits, "toplu: the Raporlar page still fits a phone");

  for (const p of [yk, korist, phone]) await p.context().close();

  await homeScreenApp(browser, budget);
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/** iOS home-screen app: a file opened by navigation has no way back, so downloads go to the share sheet. */
async function homeScreenApp(browser, budget) {
  const page = await newPage(browser, { phone: true, context: { userAgent: IPHONE_UA } });
  await page.context().addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => {
      for (const f of files) window.__shared.push({ name: f.name, size: f.size });
    };
  });
  await login(page, "yk@arkhe.local");
  await page.waitForURL(`${BASE}/`);
  // Each page load starts an empty list.
  const shared = async () => {
    await page.waitForFunction(() => window.__shared.length > 0);
    return page.evaluate(() => window.__shared.at(-1));
  };

  const cases = [
    [
      "/raporlar",
      async () => {
        await page.locator("[data-testid=export-menu]:visible").click();
        await page.getByTestId("export-xlsx").click();
      },
      /^arkhe-devam-.*\.xlsx$/,
    ],
    [
      "/raporlar",
      () => page.getByTestId("full-report").getByRole("link", { name: "PDF" }).click(),
      /^arkhe-toplu-rapor-.*\.pdf$/,
    ],
    [
      `/finans/butce/${budget}`,
      async () => {
        await page.locator("[data-testid=export-menu]:visible").click();
        await page.getByTestId("export-pdf").click();
      },
      /^arkhe-butce-.*\.pdf$/,
    ],
    [
      "/finans/rapor",
      () => page.locator("#disa-aktar").getByRole("button", { name: "Excel" }).click(),
      /^arkhe-finans-.*\.xlsx$/,
    ],
    [
      "/ice-aktar",
      () => page.getByRole("link", { name: "Üye listesini indir" }).click(),
      /^arkhe-uyeler-.*\.csv$/,
    ],
  ];
  for (const [path, click, name] of cases) {
    await page.goto(`${BASE}${path}`);
    await click();
    const file = await shared();
    check(
      name.test(file.name) && file.size > 0 && new URL(page.url()).pathname === path,
      `home-screen app: ${path} hands ${file.name} to the share sheet and stays on the page`,
    );
  }
  await page.context().close();
}
