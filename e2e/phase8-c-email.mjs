// Phase 8 C: the budget attachment and line in the monthly email (AC 37–39), on the file outbox.
import { seedBudgets } from "../scripts/board-fixture.mjs";
import { BASE, check, db } from "./lib.mjs";
import {
  arrangePast,
  as,
  deleteBudgetEntries,
  insertBudget,
  insertEntry,
  people,
} from "./board.mjs";
import {
  cron,
  csvRows,
  newEmails,
  outboxSnapshot,
  parseEml,
  removeEmails,
  resetBackup,
  setRecipients,
} from "./mail.mjs";

// E2E 2019–20 as of the end of February 2020: the 2020-08-31 donation, the May fee and the March
// expense don't count yet; the leap day does; the period is still running (grant Sürüyor).
const FEB_CSV = [
  "Tür;Kategori;Plan;Gerçekleşen;Fark;Gerçekleşme;Durum",
  "Gelir;Bağış;1000,00;1000,00;0,00;%100;Hedefe ulaşıldı",
  "Gelir;Hibe / destek;1000,00;400,00;-600,00;%40;Sürüyor",
  "Gelir;Diğer gelir;0,00;300,00;300,00;;Plansız gelir",
  "Gelir;Toplam;2000,00;1700,00;-300,00;%85;",
  "Gider;Salon / mekân;500,00;0,00;-500,00;%0;Bütçe içinde",
  "Gider;Nota ve telif;1000,00;800,00;-200,00;%80;Bütçe içinde",
  "Gider;Ulaşım ve konaklama;1000,00;1300,00;300,00;%130;Bütçe aşıldı",
  "Gider;Festival katılım ücreti;1000,00;0,00;-1000,00;%0;Bütçe içinde",
  "Gider;Organizasyon / tanıtım;1000,00;1000,00;0,00;%100;Sınıra yakın",
  "Gider;Toplam;4500,00;3100,00;-1400,00;%69;",
  "Net;Gelir − gider;-2500,00;-1400,00;1100,00;;",
];
const LINE = "Bütçe (E2E 2019–20, Onaylandı): gelir plana göre %85 · gider plana göre %69.";

export default async function run(browser) {
  const created = [];
  const { yk } = await people();
  try {
    await resetBackup();
    await setRecipients(["p8@e2e.test"]);
    const past = await arrangePast(yk);

    let before = outboxSnapshot();
    const sent = await cron("?bugun=2020-03-01");
    const mails = newEmails(before);
    created.push(...mails);
    check(
      sent.json?.status === "sent" && mails.length === 1,
      `AC38 ?bugun=2020-03-01 sends February 2020 (${sent.text})`,
    );
    if (mails.length === 1) {
      const mail = parseEml(mails[0]);
      const names = mail.attachments.map((a) => a.filename);
      const att = mail.attachments.find((a) => a.filename === "arkhe-butce-2020-02.csv");
      check(
        names.length === 6 && Boolean(att),
        `AC38 six attachments including arkhe-butce-2020-02.csv (${names})`,
      );
      if (att) {
        const raw = att.data.toString("utf8");
        const rows = csvRows(att.data).map((r) => r.join(";"));
        check(
          raw.startsWith("﻿") && raw.includes("\r\n"),
          "AC38 the attachment has a BOM and CRLF",
        );
        check(
          JSON.stringify(rows) === JSON.stringify(FEB_CSV),
          `AC38 actuals up to 2020-02-29 only, literally (${rows.slice(1, 4).join(" | ")})`,
        );
        const page = await as(browser, "yk@arkhe.local");
        const res = await page.request.get(`${BASE}/finans/butce/${past}/csv`);
        const route = Buffer.from(await res.body());
        const routeRaw = route.toString("utf8");
        const routeRows = csvRows(route);
        check(
          routeRaw.startsWith("﻿") &&
            routeRaw.includes("\r\n") &&
            routeRows[0].join(";") === FEB_CSV[0] &&
            routeRows.every((r) => r.length === 7) &&
            csvRows(att.data).every((r) => r.length === 7),
          "AC38 the route CSV has the same header, BOM, CRLF and column count",
        );
        await page.context().close();
      }
      const lines = mail.text.split("\n");
      const gelir = lines.findIndex((l) => l.startsWith("Gelir: "));
      check(
        lines[gelir + 1] === LINE,
        `AC39 right after Gelir: … the line ${LINE} (${lines[gelir + 1]})`,
      );
      check(
        lines.includes("- arkhe-butce-2020-02.csv: bütçe planı ve gerçekleşen") &&
          mail.headers.subject === "Arkhe aylık rapor ve yedek · Şubat 2020",
        "AC39 Ekler: names the budget file; the subject is unchanged",
      );
      const size = Number(
        (
          await db.execute(
            "select size_bytes from backup_runs where report_month = '2020-02' and status = 'sent'",
          )
        ).rows[0]?.size_bytes,
      );
      const total = mail.attachments.reduce((s, a) => s + a.data.length, 0);
      check(
        size >= total - 64,
        `AC38 the 18 MB guard counts the budget attachment (${size} ≥ ${total})`,
      );
    }

    before = outboxSnapshot();
    const none = await cron("?bugun=2018-02-01");
    const plain = newEmails(before);
    created.push(...plain);
    if (plain.length === 1) {
      const mail = parseEml(plain[0]);
      check(
        none.json?.status === "sent" &&
          mail.attachments.length === 5 &&
          !mail.attachments.some((a) => a.filename.startsWith("arkhe-butce-")) &&
          !mail.text.includes("Bütçe (") &&
          !mail.text.includes("bütçe planı"),
        `AC38/AC39 no budget covers January 2018: five attachments, no budget line (${mail.attachments.length})`,
      );
    } else {
      check(false, `AC38 ?bugun=2018-02-01 sends one email (${none.text})`);
    }

    // A formula-looking name: written as text in the plain-text body, never into the CSV.
    await insertBudget({
      name: "=2+3 sezon",
      start: "2016-01",
      lines: { donation: 100000 },
      by: yk,
    });
    await insertEntry({
      kind: "income",
      category: "donation",
      kurus: 5000,
      day: "2016-02-02",
      by: yk,
    });
    before = outboxSnapshot();
    await cron("?bugun=2016-03-01");
    const f = newEmails(before);
    created.push(...f);
    if (f.length === 1) {
      const mail = parseEml(f[0]);
      const line = mail.text.split("\n").find((l) => l.includes("=2+3 sezon"));
      const csv = mail.attachments.find((a) => a.filename === "arkhe-butce-2016-02.csv");
      check(
        line === "Bütçe (=2+3 sezon, Taslak): gelir plana göre %5 · gider planı yok." &&
          csv &&
          !csvRows(csv.data)
            .flat()
            .some((c) => c.includes("2+3")),
        `AC37/AC39 the body writes the name =2+3 sezon literally mid-line; the CSV never contains it (${line})`,
      );
    } else {
      check(false, "AC37 the formula-name send produced one email");
    }
  } finally {
    removeEmails(created);
    await resetBackup();
    await seedBudgets(db, new Date());
    await deleteBudgetEntries();
  }
}
