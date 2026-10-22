// Phase 8b, part B: the six types end to end, preview, commit and result, per-type rules, markers,
// paging, and the samples' undo stack (AC 3, 7, 9, 17–36, 39).
import { BASE, check, cleanup, db, login, loginAs, newPage } from "./lib.mjs";
import {
  arrangeCast,
  checkUI,
  commitUI,
  count,
  crafted,
  dayFrom,
  diff,
  docFile,
  fileBase,
  H,
  importUI,
  latestBatch,
  readResult,
  setJoined,
  sha256,
  SLUGS,
  snapshot,
  undoAll,
} from "./import.mjs";

const epoch = (date, time = "00:00") => Math.floor(Date.parse(`${date}T${time}:00+03:00`) / 1000);
const idOf = async (sql, args = []) => (await db.execute({ sql, args })).rows[0]?.[0] ?? null;
const has = (r, line, text) => r.errors.some((e) => e.startsWith(`Satır ${line} `) && e.includes(text));

/** Geri al on the newest undoable batch through the log page; returns the confirm's text. */
async function undoViaUI(page) {
  await page.goto(`${BASE}/ice-aktar/gecmis`);
  await page.getByRole("button", { name: "Geri al" }).first().click();
  const dialog = page.getByRole("alertdialog");
  const text = await dialog.innerText();
  await dialog.getByRole("button", { name: "Geri al" }).click();
  await page.getByText("İçe aktarma geri alındı.").first().waitFor();
  await dialog.waitFor({ state: "hidden" });
  return text;
}

export default async function run(browser, shots) {
  await cleanup();
  await arrangeCast();
  const sef = await loginAs(browser, "sef@arkhe.local");
  const yk = await loginAs(browser, "yk@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");

  // Review P1-1/P2-1: before step 1, steps 3 and 6 warn; the member list is one tap away where the prompt needs it.
  for (const slug of SLUGS) {
    await sef.goto(`${BASE}/ice-aktar/${slug}`);
    const pre = sef.getByTestId("prerequisites");
    const warned = (await pre.count()) > 0 && (await pre.getAttribute("data-warning")) === "true";
    const needsHistory = slug === "yoklama" || slug === "aidat-odemeleri";
    check(
      warned === needsHistory &&
        (!needsHistory ||
          ((await pre.innerText()).includes("Dikkat") &&
            (await sef.getByTestId("history-warning").innerText()).includes(
              "1 · Üye geçmişi henüz aktarılmadı. Portaldaki katılım tarihleri davet günü; daha eski kayıtlar reddedilir.",
            ) &&
            (await sef.locator('[data-testid=history-warning] a[href="/ice-aktar/uyeler"]').count()) === 1)),
      `8b review ${slug}: the Önce line is a Dikkat warning only on steps 3 and 6 while step 1 is missing`,
    );
    const listLink = (await sef.getByTestId("member-list-link").count()) === 1;
    check(
      listLink === ["uyeler", "yoklama", "aidat-odemeleri"].includes(slug) &&
        (!listLink || (await sef.getByTestId("member-list-link").getAttribute("href")) === "/ice-aktar/uye-listesi"),
      `8b review ${slug}: Üye listesini indir on the type page only for steps 1, 3 and 6`,
    );
    const summary = sef.locator("summary", { hasText: "Nasıl yapılır?" });
    check((await summary.locator("svg").count()) === 1, `8b review ${slug}: Nasıl yapılır? shows a disclosure chevron`);
  }
  await sef.goto(`${BASE}/ice-aktar/aidat-odemeleri`);
  check(
    /^Dikkat · Önce:\s*0 · Açılış bakiyesi[\s\S]*1 · Üye geçmişi[\s\S]*5 · Aidat dönemleri/.test(
      (await sef.getByTestId("prerequisites").innerText()).trim(),
    ),
    "8b review step 6 lists its prerequisites in step order 0, 1, 5",
  );

  // AC 30: a row before the fixture's opening date, then the opening moved through Ayarlar.
  const early = await checkUI(sef, "hareketler", { buffer: docFile("hareketler", "csv"), name: "4-hareketler.csv" });
  check(
    early.kind === "errors" && early.errors.some((e) => e.includes("Tarih açılış bakiyesinden (") && e.includes("Önce Finans › Ayarlar'da açılış tarihini")),
    `8b AC30 a row before the opening date gives the opening message (${early.errors[0]})`,
  );
  await sef.goto(`${BASE}/finans/ayarlar`);
  await sef.locator("input[name=openedOn]").fill("2024-09-01");
  await sef.getByRole("button", { name: "Kaydet" }).first().click();
  for (let i = 0; i < 40; i++) {
    if ((await count("select count(*) from finance_entries where kind = 'opening' and voided_at is null and occurred_on = '2024-09-01'")) > 0) break;
    await sef.waitForTimeout(250);
  }
  check(
    (await count("select count(*) from finance_entries where kind = 'opening' and voided_at is null and occurred_on = '2024-09-01'")) > 0,
    "8b AC30 the opening date moved to 2024-09-01 in Finans › Ayarlar",
  );
  await db.execute("insert into events (id, name, starts_on) values ('e2e-ev-1', 'E2E Bahar Gecesi', '2024-04-01'), ('e2e-ev-2', 'E2E Bahar Gecesi', '2024-05-01')");

  // AC 7: the six samples in D1 order; plus the per-type checks on what they wrote.
  const pre = await snapshot(["import_batches"]);
  for (const slug of SLUGS) {
    const r = await importUI(sef, slug, { buffer: docFile(slug, "csv"), name: `${fileBase(slug)}.csv` });
    check(
      r.check.kind === "clean" && r.done?.kind === "done",
      `8b AC7 sample ${fileBase(slug)}.csv checks with 0 errors and imports (${r.check.kind}: ${r.check.summary} ${r.check.errors.slice(0, 2)})`,
    );
    if (slug === "uyeler") {
      check(
        r.done.summary === "İçe aktarıldı: 2 eklendi, 3 güncellendi, 0 değişmedi." &&
          r.done.text.includes("Sıradaki adımlardan önce üye listesini yeniden indir; eski üyeler artık listede.") &&
          (await sef.locator('[data-testid=import-done] a[href="/ice-aktar/uye-listesi"]').count()) === 1,
        `8b AC18 uyeler result: the sentence, the re-download hint and button (${r.done.summary})`,
      );
      const links = await sef.locator("[data-testid=import-done] a").evaluateAll((as) => as.map((a) => `${a.textContent.trim()}=${a.getAttribute("href")}`));
      check(
        links.includes("Üyeler=/uyeler") && links.includes("Aidat=/finans/aidat") && links.includes("Sıradaki: 2 · Çalışma dönemleri=/ice-aktar/donemler"),
        `8b AC18 uyeler result links and Sıradaki (${links.join(", ")})`,
      );
      const ayse = (await db.execute("select joined_at, name from users where email = 'ayse.demir@ornek.com'")).rows[0];
      check(Number(ayse.joined_at) === epoch("2019-09-01") && ayse.name === "Ayşe Demir", "8b AC21 Ayşe's joined_at is 2019-09-01 Istanbul start; the name stays");
      const z = (await db.execute("select * from users where email = 'zeynep.ak@eski.invalid'")).rows[0];
      check(
        z && z.role === "member" && Number(z.is_active) === 0 && z.password_hash === null && Number(z.left_at) === epoch("2025-02-01") - 1 && z.voice_part === "soprano",
        "8b AC23 the former member is an inactive member with no password, left_at 23:59:59 Istanbul",
      );
      check((await count("select count(*) from invites where user_id = (select id from users where email = 'zeynep.ak@eski.invalid')")) === 0, "8b AC23 no invite for the former member");
      await sef.goto(`${BASE}/uyeler?p=pasif`);
      check((await sef.locator("main").innerText()).includes("Zeynep Ak"), "8b AC23 the former member is listed among the inactive members on /uyeler");
      const zp = await newPage(browser);
      await login(zp, "zeynep.ak@eski.invalid", "arkhe-demo-2026");
      await zp.getByText("E-posta ya da şifre hatalı.").first().waitFor({ timeout: 10_000 }).catch(() => {});
      check(
        new URL(zp.url()).pathname === "/giris" && (await zp.getByText("E-posta ya da şifre hatalı.").count()) > 0,
        "8b AC23 the former member can't log in (the normal wrong-credentials message)",
      );
      await zp.context().close();
      await sef.goto(`${BASE}/ice-aktar/yoklama`);
      check(
        (await sef.getByTestId("prerequisites").getAttribute("data-warning")) === null &&
          (await sef.getByTestId("history-warning").count()) === 0,
        "8b review after step 1 the Önce line on step 3 is back to the plain style",
      );
    }
    if (slug === "donemler") {
      await sef.goto(`${BASE}/ice-aktar`);
      check(
        (await sef.locator("[data-step='3'] [data-testid=next-chip]").count()) === 1 &&
          (await sef.locator("[data-testid=next-chip]").count()) === 1,
        "8b AC3 after steps 1 and 2 the Sıradaki chip moves to step 3",
      );
      check(
        /Son aktarım: \d+ \S+ \d{4} · Demo Şef · 4 satır/.test(await sef.locator("[data-step='2'] [data-testid=step-state]").innerText()),
        "8b AC3 the imported card reads Son aktarım: <tarih> · <ad> · <n> satır",
      );
      await sef.goto(`${BASE}/raporlar`);
      check((await sef.locator("main").innerText()).includes("2024–25 Güz"), "8b AC26 imported terms appear in the /raporlar period picker");
    }
    if (slug === "yoklama") {
      check(
        r.check.warnings.some((w) => w.kind === "autoAbsent" && /\d+ çalışmada toplam \d+ beklenen kişi listede yok; Gelmedi sayılacak\./.test(w.text)) &&
          r.check.effects.length === 2,
        `8b AC28 the auto-absent warning and one effect line per rehearsal (${r.check.effects.join(" / ")})`,
      );
      const reh = (
        await db.execute(
          "select r.*, (select group_concat(voice_part) from rehearsal_parts p where p.rehearsal_id = r.id) parts from rehearsals r where r.id in (select rehearsal_id from import_items) order by starts_at",
        )
      ).rows;
      const sefId = await idOf("select id from users where email = 'sef@arkhe.local'");
      check(
        reh.length === 2 &&
          Number(reh[0].starts_at) === epoch("2024-10-08", "19:00") &&
          Number(reh[0].ends_at) === epoch("2024-10-08", "22:00") &&
          reh[0].type === "tutti" &&
          reh[0].location === "Mülkiye Salonu" &&
          Number(reh[1].starts_at) === epoch("2024-10-10", "20:00") &&
          Number(reh[1].ends_at) === epoch("2024-10-10", "21:30") &&
          reh[1].type === "sectional" &&
          String(reh[1].parts).split(",").sort().join() === "alto,soprano" &&
          reh.every((x) => Number(x.opened_at) === Number(x.starts_at) && Number(x.closed_at) === Number(x.ends_at) && x.created_by === sefId),
        "8b AC27 the rehearsals have the file's type, parts, place and times, opened_at/closed_at and created_by",
      );
      const att = (
        await db.execute({
          sql: "select u.email, a.status, a.method, a.recorded_at, a.recorded_by, a.note from attendance a join users u on u.id = a.user_id where a.rehearsal_id = ?",
          args: [reh[0].id],
        })
      ).rows;
      const by = Object.fromEntries(att.map((a) => [a.email, a]));
      check(
        by["ayse.demir@ornek.com"]?.method === "manual" &&
          Number(by["ayse.demir@ornek.com"].recorded_at) === epoch("2024-10-08", "19:00") &&
          by["ayse.demir@ornek.com"].recorded_by === sefId &&
          by["mehmet.kaya@ornek.com"]?.status === "late" &&
          by["zeynep.ak@eski.invalid"]?.status === "excused" &&
          by["zeynep.ak@eski.invalid"].note === "Sınav haftası",
        "8b AC27 each file row is a manual mark by the importer at starts_at; blank cells inherit",
      );
      check(
        by["can.yildiz@ornek.com"]?.status === "absent" &&
          by["can.yildiz@ornek.com"].method === "auto" &&
          Number(by["can.yildiz@ornek.com"].recorded_at) === epoch("2024-10-08", "22:00") &&
          !by["elif.sahin@ornek.com"] &&
          !by["burak.ozturk@eski.invalid"] &&
          !by["sef@arkhe.local"],
        "8b AC27 every other expected person is absent/auto at ends_at; nobody unexpected is recorded",
      );
      await sef.goto(`${BASE}/calismalar/${reh[0].id}`);
      check(
        (await sef.getByTestId("imported-chip").innerText()) === "İçe aktarıldı" &&
          (await sef.getByRole("button", { name: "Yoklamayı başlat" }).count()) === 0 &&
          (await sef.getByText("Yoklama kapandı").count()) > 0,
        "8b AC27/35 the imported rehearsal is closed, has no Aç button and shows İçe aktarıldı to managers",
      );
      await korist.goto(`${BASE}/calismalar/${reh[0].id}`);
      check((await korist.getByTestId("imported-chip").count()) === 0, "8b AC35 korist@ sees no marker");
      const meta = await sef.getByTestId("roster-row").evaluateAll((rows) => rows.map((x) => x.innerText));
      check(
        meta.length > 0 &&
          meta.filter((t) => t.includes("İçe aktarıldı")).length >= 2 &&
          meta.every((t) => !/Elle ·|Otomatik ·/.test(t)),
        `8b review P2-5 imported roster rows read İçe aktarıldı, never Elle/Otomatik with a time (${meta.length} rows)`,
      );
      const seeded = await idOf("select id from rehearsals where id not in (select rehearsal_id from import_items where rehearsal_id is not null) and closed_at is not null limit 1");
      await sef.goto(`${BASE}/calismalar/${seeded}`);
      check((await sef.getByTestId("imported-chip").count()) === 0, "8b AC35 a portal rehearsal has no marker");
      await sef.goto(`${BASE}/calismalar?sekme=gecmis`);
      check(
        (await sef.locator(`main a[href="/calismalar/${reh[0].id}"]`).count()) === 1,
        "8b AC27 the imported rehearsal is in the past list",
      );
      const term = await idOf("select id from terms where name = '2024–25 Güz'");
      const rep = await (await sef.request.get(`${BASE}/raporlar/csv?donem=${term}`)).text();
      const ayseLine = rep.split(/\r?\n/).find((l) => l.includes("Ayşe Demir")) ?? "";
      check(ayseLine !== "", `8b AC34 the term report CSV counts the imported rehearsals (${ayseLine.slice(0, 80)})`);
    }
    if (slug === "hareketler") {
      const preview = r.check;
      check(
        preview.warnings.some((w) => w.kind === "newSponsor" && w.text === "Yeni sponsor oluşturulacak: Kaya Matbaa"),
        "8b AC29 a new sponsor is listed in the warnings",
      );
      check(
        preview.text.includes("İçe aktarımdan sonra") &&
          preview.text.includes("Banka ekstrenle karşılaştır. Aidat ödemeleri 6. adımda eklenince bu rakam artar."),
        "8b AC30 the clean preview shows İçe aktarımdan sonra with the step-4 hint",
      );
    }
    if (slug === "hareketler" || slug === "aidat-odemeleri") {
      await sef.goto(`${BASE}/finans`);
      const cash = Number(await sef.getByTestId("balance-cash").getAttribute("data-kurus"));
      const bank = Number(await sef.getByTestId("balance-bank").getAttribute("data-kurus"));
      const [, cashAfter, , bankAfter] = r.check.balances;
      check(
        r.check.balances.length === 4 && cash === cashAfter && bank === bankAfter,
        `8b AC30/32 ${slug}: /finans shows exactly the previewed after balances (${cash}/${bank} vs ${r.check.balances})`,
      );
    }
    if (slug === "aidat-odemeleri") {
      check(r.check.text.includes("Şimdi banka ekstrenle tutmalı."), "8b AC32 the step-6 balance hint");
      const eylul = await idOf("select id from dues_periods where name = 'Eylül 2024'");
      await sef.goto(`${BASE}/finans/aidat?donem=${eylul}`);
      const stateOf = (name) => sef.locator(`[data-testid=dues-row][data-name="${name}"] [data-testid=dues-status]`).getAttribute("data-state");
      check(
        (await stateOf("Ayşe Demir")) === "paid" && (await stateOf("Mehmet Kaya")) === "paid",
        "8b AC32 payments show Ödendi; the reduced-rate member is judged on the reduced amount",
      );
      check((await stateOf("Zeynep Ak")) === "exempt", "8b AC33 the waiver shows Muaf");
      const pay = (
        await db.execute({
          sql: "select * from finance_entries where dues_period_id = ? and member_id = (select id from users where email = 'ayse.demir@ornek.com')",
          args: [eylul],
        })
      ).rows;
      check(
        pay.length === 1 && pay[0].kind === "income" && pay[0].category === "dues" && pay[0].payment_group_id === null && pay[0].account === "bank",
        "8b AC32 one income/dues entry with member, period and account, no payment group",
      );
    }
  }
  // AC 7 (cont.): the index after six imports.
  await sef.goto(`${BASE}/ice-aktar`);
  const states = await sef.locator("[data-testid=step-state]").allInnerTexts();
  check(
    states.length === 6 && states.every((s) => s.startsWith("Son aktarım:")) && (await sef.getByTestId("next-chip").count()) === 0,
    "8b AC3 with every type imported, each card shows its last import and there is no Sıradaki chip",
  );

  // AC 20: re-checking each sample is all değişmeyecek, with the same-file warning.
  const reBefore = await snapshot();
  const rechecks = [];
  for (const slug of SLUGS) {
    const r = await checkUI(sef, slug, { buffer: docFile(slug, "csv"), name: `${fileBase(slug)}.csv` });
    rechecks.push(
      r.kind === "unchanged" &&
        r.text.includes("Değişecek bir şey yok; bu dosyadaki her şey zaten portalda.") &&
        /Bu dosya \d+ \S+ \d{4} tarihinde Demo Şef tarafından aktarılmıştı\./.test(r.text) &&
        !r.commit,
    );
  }
  check(rechecks.every(Boolean), `8b AC17/20 every sample re-checks as nothing to change, with the same-file line and no button (${rechecks})`);
  check(diff(reBefore, await snapshot()).length === 0, "8b AC15/20 the re-checks wrote nothing");

  // Per-type rules, checked against the imported state (check only).
  const ruleBefore = await snapshot();
  const terms = await checkUI(sef, "donemler", {
    text: [
      H.donemler,
      "E2E Ç1;2026-03-01;2026-04-01",
      "E2E Ç2;2021-09-01;2022-01-31",
      "E2E Ç3;2022-01-15;2022-03-01",
      "E2E Uzun;2019-01-01;2020-01-05",
      "2023–24 Güz;2023-09-18;2024-01-27",
      "E2E Ç2;2021-09-01;2022-01-31",
    ].join("\n"),
  });
  check(
    has(terms, 2, "Dönemler çakışamaz.") &&
      has(terms, 4, "Dönemler çakışamaz.") &&
      has(terms, 5, "Bir dönem en fazla bir yıl olabilir.") &&
      has(terms, 6, "Bu adla farklı tarihli bir dönem var.") &&
      has(terms, 7, "Satır 3 ile aynı kayıt.") &&
      !terms.errors.some((e) => e.startsWith("Satır 3 ")),
    `8b AC26/20 term overlap (DB and file), over a year, same name other dates, in-file duplicate (${terms.errors.join(" | ")})`,
  );
  await db.execute({
    sql: "insert into rehearsals (id, type, title, location, starts_at, ends_at) values ('00000000-0000-4000-8b00-000000000001', 'tutti', 'E2E Elle', 'Salon', ?, ?)",
    args: [epoch("2023-04-04", "19:00"), epoch("2023-04-04", "21:30")],
  });
  const att = await checkUI(sef, "yoklama", {
    text: [
      H.yoklama,
      "2023-03-07;19:00;;tutti;;;;ayse.demir@ornek.com;geldi;",
      "2023-03-07;;;;;;;elif.sahin@ornek.com;geldi;",
      "2023-03-07;;;;;;;deniz.sef@ornek.com;geldi;",
      "2023-03-07;;;partisyon;;;;mehmet.kaya@ornek.com;geldi;",
      "2023-03-07;;;;;;;can.yildiz@ornek.com;geldi;Not",
      "2024-03-05;19:00;;;;;;burak.ozturk@eski.invalid;geldi;",
      "2023-03-09;19:00;;partisyon;soprano;;;mehmet.kaya@ornek.com;geldi;",
      "2023-03-10;19:00;;tutti;soprano;;;ayse.demir@ornek.com;geldi;",
      "2023-03-11;19:00;;partisyon;;;;ayse.demir@ornek.com;geldi;",
      `${dayFrom(0)};23:58;23:59;;;;;ayse.demir@ornek.com;geldi;`,
      "2024-10-08;19:00;22:00;tutti;;;Mülkiye Salonu;ayse.demir@ornek.com;gelmedi;",
      "2023-04-04;19:00;;;;;;ayse.demir@ornek.com;geldi;",
      "2023-03-07;;;;;;;ayse.demir@ornek.com;geldi;",
    ].join("\n"),
  });
  const notExpected = "Bu kişi bu çalışmada beklenmiyor (katılım/ayrılış tarihi, rol ya da partisyon).";
  check(
    has(att, 3, notExpected) && has(att, 4, notExpected) && has(att, 7, notExpected) && has(att, 8, notExpected),
    `8b AC28 joined later, conductor, left before and outside the sectional's parts are not expected (${att.errors.filter((e) => e.includes("beklenmiyor")).length})`,
  );
  check(
    has(att, 5, "Bu çalışmanın ilk satırıyla (satır 2) farklı.") &&
      has(att, 6, "Not yalnızca mazeretli satırda yazılır.") &&
      has(att, 9, "Partiler yalnızca partisyon türünde yazılır.") &&
      att.errors.some((e) => e.startsWith("Satır 10 ")) &&
      has(att, 11, "Bitmemiş bir çalışma içe aktarılamaz."),
    `8b AC28 a different tur on a later row, a note on geldi, partiler on a tutti, a sectional without parts, a rehearsal not yet ended`,
  );
  check(
    has(att, 12, "Bu çalışma daha önce farklı yoklamayla aktarıldı; önce o aktarımı geri al.") &&
      has(att, 13, "Bu saatte portalda girilmiş bir çalışma var; yoklamasını o sayfadan düzelt.") &&
      has(att, 14, "Satır 2 ile aynı kayıt."),
    `8b AC28/20 an earlier import with other rows, a portal rehearsal at the same start, an in-file duplicate (${att.errors.filter((e) => /Satır 1[234] /.test(e))})`,
  );
  await db.execute("delete from rehearsals where id = '00000000-0000-4000-8b00-000000000001'");
  const fin = await checkUI(sef, "hareketler", {
    text: [
      H.hareketler,
      "H-1;2024-09-20;gelir;aidat;100;kasa;;;;;;",
      "H-2;2024-09-20;virman;ikram;100;kasa;banka;;;;;",
      "H-3;2024-09-20;virman;;100;kasa;kasa;;;;;",
      "H-4;2024-09-20;gider;ikram;100;kasa;;;;;Yok Böyle Gece;",
      "H-5;2024-09-20;gider;ikram;100;kasa;;;;;E2E Bahar Gecesi;",
      "H-6;2024-08-20;gider;ikram;100;kasa;;;;;;",
      "20240905-1;2024-09-05;gider;salon_mekan;1600;banka;;Salon kirası Eylül;Mülkiye Vakfı;;;",
      "H-1;2024-09-21;gider;ikram;5;kasa;;;;;;",
    ].join("\n"),
  });
  check(
    has(fin, 2, "Aidat ödemelerini 6. adımdaki aidat dosyasıyla aktar.") &&
      has(fin, 3, "Virmanda kategori olmaz.") &&
      has(fin, 4, "Kaynak ve hedef hesap aynı olamaz.") &&
      has(fin, 5, "Bu adla bir etkinlik yok.") &&
      has(fin, 6, "Bu adla birden çok etkinlik var; etkinliği adından ayırt et.") &&
      has(fin, 7, "Tarih açılış bakiyesinden") &&
      has(fin, 8, "Kayıt 20240905-1, ") &&
      has(fin, 8, "tarihli aktarımda farklı içerikle var") &&
      has(fin, 9, "Satır 2 ile aynı kayıt."),
    `8b AC29/30/20 dues, category on a transfer, same account, unknown and ambiguous event, before opening, kayit_no conflict, duplicate (${fin.errors.join(" | ").slice(0, 400)})`,
  );
  const per = await checkUI(sef, "aidat-donemleri", {
    text: [
      H["aidat-donemleri"],
      "E2E Ara 2024;2024-09-15;2024-10-15;2024-09-20;300;",
      "E2E Ocak 2021;2021-01-01;2021-01-31;2021-01-10;100;100",
      "E2E Şubat 2021;2021-02-10;2021-02-28;2021-02-05;100;",
      "Eylül 2024;2024-09-01;2024-09-30;2024-09-10;350;150",
    ].join("\n"),
  });
  check(
    has(per, 2, "Bu tarihler Eylül 2024 dönemiyle çakışıyor.") &&
      has(per, 3, "İndirimli aidat tam aidattan az olmalı.") &&
      has(per, 4, "Son ödeme başlangıçtan önce olamaz.") &&
      has(per, 5, "Bu adla farklı bir aidat dönemi var."),
    `8b AC31 overlap, reduced ≥ full, due before start, same name other values (${per.errors.join(" | ")})`,
  );
  const pays = await checkUI(sef, "aidat-odemeleri", {
    text: [
      H["aidat-odemeleri"],
      "P-1;odeme;elif.sahin@ornek.com;Eylül 2024;100;2024-09-10;kasa;",
      "P-2;odeme;burak.ozturk@eski.invalid;Ekim 2024;100;2024-10-05;kasa;",
      "P-3;odeme;deniz.sef@ornek.com;Ekim 2024;100;2024-10-05;kasa;",
      "P-4;odeme;ayse.demir@ornek.com;Ekim 2024;200;2024-10-05;kasa;",
      "P-5;odeme;ayse.demir@ornek.com;Ekim 2024;200;2024-10-06;kasa;",
      "P-6;odeme;ayse.demir@ornek.com;Eylül 2024;10;2024-10-06;kasa;",
      "P-7;odeme;mehmet.kaya@ornek.com;Ekim 2024;200;2024-10-06;kasa;",
      "P-8;odeme;ayse.demir@ornek.com;Yok 2024;10;2024-10-06;kasa;",
      "P-9;odeme;ayse.demir@ornek.com;Kasim 2024;50;2024-11-05;banka;",
      "M-1;muaf;ayse.demir@ornek.com;Kasım 2024;10;;;Geçmiş borç",
      "M-2;muaf;mehmet.kaya@ornek.com;Kasım 2024;;;;x",
      "M-3;muaf;can.yildiz@ornek.com;Eylül 2024;;;;Geçmiş borç",
      "M-4;muaf;ayse.demir@ornek.com;Kasım 2024;;;;Geçmiş borç",
    ].join("\n"),
  });
  const notOwed = "Bu kişi bu dönemden sorumlu değil.";
  check(
    has(pays, 2, notOwed) && has(pays, 3, notOwed) && has(pays, 4, "sorumlu değil"),
    `8b AC32 joined later, left before and the conductor don't owe the period (${pays.errors.slice(0, 3).join(" | ")})`,
  );
  check(
    !pays.errors.some((e) => /^Satır (5|10) /.test(e)) &&
      has(pays, 6, "Kalan borç ₺100,00; daha fazlası girilemez.") &&
      has(pays, 7, "Bu dönemin borcu yok.") &&
      has(pays, 8, "Kalan borç ₺150,00; daha fazlası girilemez.") &&
      has(pays, 9, "Bu adla bir aidat dönemi yok. Dönem adları Finans › Aidat sayfasında."),
    `8b AC32 open amount counting earlier rows, nothing open, the reduced amount, unknown period; "Kasim 2024" matches Kasım (${pays.errors.slice(3, 9).join(" | ")})`,
  );
  check(
    has(pays, 11, "Muafiyet satırında tutar, tarih ve hesap boş olmalı.") &&
      has(pays, 12, "Neden yaz (en az 3 karakter).") &&
      has(pays, 13, "Bu döneme ödeme var; muafiyet verilemez.") &&
      has(pays, 14, "Bu döneme ödeme var; muafiyet verilemez."),
    `8b AC33 a waiver with an amount, without a reason, on a period paid in the DB and earlier in the file`,
  );
  const codes = await checkUI(sef, "uyeler", { text: "eposta;partisyon\nelif.sahin@ornek.com;Bas\nselin.cakir@ornek.com;bass\n" });
  check(
    codes.kind === "clean" && codes.summary.includes("2 güncellenecek") && codes.effects.every((e) => e.includes("Bas")),
    `8b AC14 Bas and bass both mean bass (${codes.effects.join(" / ")})`,
  );
  check(diff(ruleBefore, await snapshot()).length === 0, "8b AC15 the rule checks of every type wrote nothing");

  // AC 13, 14, 29 (accepted forms): a committed hareketler file.
  const g = await importUI(sef, "hareketler", {
    text: [
      H.hareketler,
      "G-1;2024-09-21;gelir;sponsorluk;1250;banka;;;;MULKIYE KITABEVI;Kis Konseri;",
      "G-2;2024-09-21;gider;Ulaşım ve konaklama;1250,5;kasa;;;;;;",
      "G-3;2024-09-21;gider;ULASIM_VE_KONAKLAMA;1250,50;kasa;;;;;;",
      "G-4;2024-09-21;gider;travel;1250.50;kasa;;;;;;",
      "G-5;2024-09-21;gider;ulaşım ve konaklama;10;kasa;;;;;;",
      "G-6;2024-09-22;gelir;sponsorluk;5;banka;;;;E2E Yeni Fırın;;",
    ].join("\n"),
  });
  check(
    g.done?.kind === "done" &&
      g.check.warnings.some((w) => w.kind === "newSponsor" && w.text === "Yeni sponsor oluşturulacak: E2E Yeni Fırın"),
    `8b AC29 only the unknown sponsor is announced as new (${g.check.warnings.map((w) => w.text)})`,
  );
  const rows = Object.fromEntries(
    (
      await db.execute(
        "select i.kayit_no, e.amount_kurus, e.category, s.name sponsor, ev.name event, u.email creator from import_items i join finance_entries e on e.id = i.finance_entry_id left join sponsors s on s.id = e.sponsor_id left join events ev on ev.id = e.event_id join users u on u.id = e.created_by where i.kayit_no like 'G-%'",
      )
    ).rows.map((r) => [r.kayit_no, r]),
  );
  check(
    Number(rows["G-1"]?.amount_kurus) === 125000 && [2, 3, 4].every((i) => Number(rows[`G-${i}`]?.amount_kurus) === 125050),
    "8b AC13 1250, 1250,5, 1250,50 and 1250.50 are stored as 125000/125050 kuruş",
  );
  check(
    [2, 3, 4, 5].every((i) => rows[`G-${i}`]?.category === "travel"),
    "8b AC14 Ulaşım ve konaklama, ULASIM_VE_KONAKLAMA, travel and ulaşım ve konaklama all map to travel",
  );
  check(
    rows["G-1"]?.sponsor === "Mülkiye Kitabevi" && rows["G-1"]?.event === "Kış Konseri" && rows["G-6"]?.sponsor === "E2E Yeni Fırın" && rows["G-1"]?.creator === "sef@arkhe.local",
    "8b AC29 the sponsor matches case- and accent-insensitively, the event by its normalised name, created_by is the importer",
  );
  const late = await importUI(sef, "yoklama", {
    text: [
      H.yoklama,
      "2023-05-02;19:00;;tutti;;;;ayse.demir@ornek.com;Geç geldi;",
      "2023-05-02;;;;;;;mehmet.kaya@ornek.com;gec;",
      "2023-05-02;;;;;;;can.yildiz@ornek.com;late;",
      "2023-05-02;;;;;;;zeynep.ak@eski.invalid;gec_geldi;",
    ].join("\n"),
  });
  check(
    late.done?.kind === "done" &&
      (await count("select count(*) from attendance where status = 'late' and rehearsal_id = (select id from rehearsals where starts_at = ?)", [epoch("2023-05-02", "19:00")])) === 4,
    "8b AC14 Geç geldi, gec, late and gec_geldi all map to late",
  );

  // AC 35: the entry marker.
  const entry = await idOf("select finance_entry_id from import_items where kayit_no = '20240905-1'");
  await sef.goto(`${BASE}/finans/${entry}`);
  check(
    (await sef.getByTestId("imported-line").innerText()) === "İçe aktarıldı · Kayıt no 20240905-1",
    "8b AC35 an imported entry shows İçe aktarıldı · Kayıt no <kayit_no>",
  );
  const handEntry = await idOf("select id from finance_entries where id not in (select finance_entry_id from import_items where finance_entry_id is not null) and kind = 'expense' limit 1");
  await sef.goto(`${BASE}/finans/${handEntry}`);
  check((await sef.getByTestId("imported-line").count()) === 0, "8b AC35 a hand-made entry has no marker");

  // AC 39: undo the whole stack through the log page, newest first.
  const dialogs = [];
  let undone = 0;
  while ((await count("select count(*) from import_batches where status = 'imported'")) > 0 && undone < 12) {
    const kind = (await latestLiveKind()) ?? "";
    const text = await undoViaUI(sef);
    dialogs.push([kind, text]);
    undone++;
  }
  const finance = dialogs.filter(([k]) => k === "entries" || k === "dues_payments");
  const other = dialogs.filter(([k]) => !(k === "entries" || k === "dues_payments"));
  check(
    dialogs.every(
      ([, t]) =>
        t.includes("Bu içe aktarma geri alınsın mı?") &&
        /^(\d+ eklenen kayıt silinir)?(, )?(\d+ güncellenen kayıt eski hâline döner)?\.$/m.test(t) &&
        /[1-9]\d* (eklenen|güncellenen)/.test(t) &&
        !/(^|\D)0 (eklenen|güncellenen)/.test(t),
    ) &&
      finance.length >= 2 &&
      finance.every(([, t]) => t.includes("İçe aktarılan hareketler tamamen silinir; bakiyeler aktarım öncesine döner.")) &&
      other.every(([, t]) => !t.includes("İçe aktarılan hareketler")),
    `8b AC38 the undo confirm text, with the finance line only on the two finance types (${dialogs.length} undone)`,
  );
  const post = await snapshot(["import_batches"]);
  check(
    diff(pre, post).length === 0,
    `8b AC39 after undoing all ${dialogs.length} batches the DB equals its state before the samples (${diff(pre, post).join("; ")})`,
  );
  check(
    (await count("select count(*) from import_batches where status = 'undone'")) === dialogs.length &&
      (await count("select count(*) from import_items")) === 0,
    "8b AC39 the batch rows stay as the audit record; their items are gone",
  );
  const again = await checkUI(sef, "donemler", { buffer: docFile("donemler", "csv"), name: "2-donemler.csv" });
  check(again.kind === "clean" && again.summary.includes("4 eklenecek"), `8b AC39 re-checking an undone file shows eklenecek again (${again.summary})`);
  const reHar = await checkUI(sef, "hareketler", { buffer: docFile("hareketler", "csv"), name: "4-hareketler.csv" });
  check(reHar.kind === "clean" && reHar.summary.includes("4 eklenecek"), "8b AC39 an undone kayit_no can be imported again");

  // AC 7 (cont.): every .md worked example checks with 0 errors against the cast (with ux §8.2's follow-up).
  const examples = SLUGS.map((slug) => ({
    slug,
    text: /```csv\n([\s\S]*?)\n```/.exec(docFile(slug, "md").toString("utf8"))[1] + "\n",
  }));
  const followUp = {
    slug: "uyeler",
    text: "eposta;katilim_tarihi;aidat_orani\nelif.sahin@ornek.com;2024-10-01;\nselin.cakir@ornek.com;2020-09-01;\nselin.aydin@ornek.com;2020-09-01;\nmehmet.kaya@ornek.com;;indirimli\n",
  };
  const exResults = [];
  for (const ex of [examples[0], followUp, ...examples.slice(1)]) {
    const r = await importUI(sef, ex.slug, { text: ex.text, paste: true });
    exResults.push(`${ex.slug}:${r.check.kind}${r.check.errors.length ? `(${r.check.errors.slice(0, 2)})` : ""}`);
  }
  check(
    exResults.every((x) => /:clean$/.test(x)),
    `8b AC7 each .md example checks with 0 errors and imports in order (${exResults.join(", ")})`,
  );
  check(
    (await db.execute("select file_name from import_batches order by id desc limit 1")).rows[0].file_name === "yapistirilan-metin.csv",
    "8b AC9 a pasted import is logged as yapistirilan-metin.csv",
  );
  await undoAll(sef);
  check((await count("select count(*) from import_batches where status = 'imported'")) === 0, "8b the example batches are undone again");

  // AC 18: confirm, batch row, no content column, swapped file, DB change, double tap, concurrency.
  const termText = `${H.donemler}\nE2E Onay Dönemi;2021-09-01;2022-01-31\nE2E Onay Baharı;2022-02-01;2022-06-30\n`;
  await checkUI(sef, "donemler", { text: termText, name: "onay.csv" });
  await sef.getByRole("button", { name: "İçe aktar (2 değişiklik)" }).click();
  const dialog = sef.getByRole("alertdialog");
  check(
    (await dialog.getByRole("heading").innerText()) === "2 değişiklik aktarılsın mı?" &&
      (await dialog.innerText()).includes("Çalışma dönemleri · onay.csv. Hepsi birden yazılır; sonra İçe aktarma geçmişi'nden geri alabilirsin.") &&
      (await dialog.getByRole("button", { name: "Vazgeç" }).count()) === 1,
    "8b AC18 İçe aktar always opens the confirm with the count, type and file name",
  );
  const batches0 = await count("select count(*) from import_batches");
  await dialog.getByRole("button", { name: "İçe aktar" }).dblclick();
  await sef.locator("[data-testid=import-result][data-kind=done]").waitFor({ timeout: 30_000 });
  check(
    (await count("select count(*) from import_batches")) === batches0 + 1 &&
      (await count("select count(*) from terms where name like 'E2E Onay%'")) === 2,
    "8b AC18 a double tap on İçe aktar creates exactly one batch",
  );
  const batch = await latestBatch();
  const cols = (await db.execute("pragma table_info(import_batches)")).rows.map((r) => r.name).sort().join();
  check(
    batch.file_name === "onay.csv" &&
      Number(batch.file_size) === Buffer.byteLength(termText) &&
      batch.file_sha256 === sha256(Buffer.from(termText)) &&
      Number(batch.added_count) === 2 &&
      cols === "added_count,created_at,created_by,file_name,file_sha256,file_size,id,kind,row_count,status,unchanged_count,undone_at,undone_by,updated_count",
    "8b AC18 one batch row with name, size, SHA-256 and counts, and no column for the content",
  );
  const shot = (await readResult(sef)).text;
  check(shot.includes("İçe aktarıldı: 2 eklendi, 0 güncellendi, 0 değişmedi."), "8b AC18 the result sentence");

  const fileA = `${H.donemler}\nE2E Takas;2020-09-01;2021-01-31\n`;
  const fileB = `${H.donemler}\nE2E Takas;2020-09-01;2021-01-30\n`;
  const beforeSwap = await snapshot();
  const swap = await crafted(sef, "commitImport", "donemler", { text: fileB, sha: sha256(Buffer.from(fileA)) });
  check(
    swap.body.includes("Dosya kontrol edildikten sonra değişti. Yeniden kontrol et.") && diff(beforeSwap, await snapshot()).length === 0,
    "8b AC18 a different file sent with the previewed hash is refused; nothing written",
  );
  const race = await Promise.all([
    crafted(sef, "commitImport", "donemler", { text: fileA, sha: sha256(Buffer.from(fileA)) }),
    crafted(yk, "commitImport", "donemler", { text: fileA, sha: sha256(Buffer.from(fileA)) }),
  ]);
  const kinds = race.map((r) => /"kind":"(\w+)"/.exec(r.body)?.[1]).sort();
  check(
    kinds.join() === "done,unchanged" && (await count("select count(*) from terms where name = 'E2E Takas'")) === 1,
    `8b AC18 two concurrent commits give one batch (${kinds})`,
  );

  const moving = `${H.hareketler}\nD-1;2024-09-10;gider;ikram;10;kasa;;;;;;\n`;
  await checkUI(sef, "hareketler", { text: moving, name: "kayan.csv" });
  await setOpeningDate("2024-09-15");
  const beforeMove = await snapshot();
  const moved = await commitUI(sef);
  check(
    moved.kind === "errors" && moved.summary.startsWith("Kontrolden sonra portalda bir şey değişti.") && moved.errors.some((e) => e.includes("Tarih açılış bakiyesinden")),
    `8b AC18 a DB change between check and commit returns the new error list (${moved.summary})`,
  );
  check(diff(beforeMove, await snapshot()).length === 0, "8b AC18 … and nothing is written");
  await setOpeningDate("2024-09-01");

  // AC 21–25: member history rules.
  await setJoined("%@ornek.com", "2019-01-01");
  const pw = await newPage(browser, { mobile: true });
  await login(pw, "selin.aydin@ornek.com");
  await pw.waitForURL(`${BASE}/`);
  const mem = await checkUI(sef, "uyeler", {
    text: [
      "eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon",
      "ayse.demir@ornek.com;Ayşe D.;2018-09-01;;",
      "selin.aydin@ornek.com;Selin Aydın;;2024-06-30;",
      "mehmet.kaya@ornek.com;Mehmet K.;;;",
    ].join("\n"),
  });
  check(
    mem.kind === "clean" &&
      mem.warnings[0]?.kind === "deactivate" &&
      mem.warnings[0].text === "1 kişi pasifleştirilecek ve oturumları kapatılacak: Selin Aydın" &&
      mem.warnings.some((w) => w.kind === "nameMismatch" && w.text === "2 kişinin adı portaldakinden farklı (ad değişmez)."),
    `8b AC17/24 deactivations come first and in full; name mismatches are one line (${mem.warnings.map((w) => w.text).join(" / ")})`,
  );
  check(
    (await sef.locator("details summary", { hasText: "Listeyi göster" }).count()) === 1 &&
      (await sef.locator("details", { hasText: "Listeyi göster" }).textContent()).includes('Ad portaldakinden farklı: "Ayşe D." ↔ "Ayşe Demir"'),
    "8b AC21 the name mismatches sit under Listeyi göster in the D7 wording",
  );
  check(
    mem.effects.some((e) => e.startsWith("Ayşe Demir: katılım 1 Oca 2019 → 1 Eyl 2018")),
    `8b AC17 effects read in plain Turkish (${mem.effects[0]})`,
  );
  await sef.getByRole("button", { name: /^İçe aktar \(/ }).click();
  check(
    (await sef.getByRole("alertdialog").innerText()).includes("1 kişi pasifleşecek ve oturumları kapanacak."),
    "8b AC18 the confirm carries the deactivation line",
  );
  await sef.getByRole("alertdialog").getByRole("button", { name: "İçe aktar" }).click();
  await sef.locator("[data-testid=import-result][data-kind=done]").waitFor();
  const selin = (await db.execute("select is_active, left_at, name from users where email = 'selin.aydin@ornek.com'")).rows[0];
  const ayse = (await db.execute("select joined_at, name from users where email = 'ayse.demir@ornek.com'")).rows[0];
  check(
    Number(selin.is_active) === 0 && Number(selin.left_at) === epoch("2024-07-01") - 1 && Number(ayse.joined_at) === epoch("2018-09-01") && ayse.name === "Ayşe Demir",
    "8b AC21/24 dates applied, the deactivated member is inactive with that left_at, names unchanged",
  );
  check(
    (await count("select count(*) from sessions where user_id = (select id from users where email = 'selin.aydin@ornek.com')")) === 0,
    "8b AC24 the deactivated member's sessions are gone",
  );
  await pw.goto(`${BASE}/`);
  check(new URL(pw.url()).pathname === "/giris", "8b AC24 the member's open browser is sent to login on the next request");
  await pw.context().close();
  const again24 = await checkUI(sef, "uyeler", { text: "eposta;ayrilis_tarihi\nselin.aydin@ornek.com;2024-05-31\n" });
  check(
    again24.kind === "clean" && !again24.warnings.some((w) => w.kind === "deactivate"),
    "8b AC24 on an inactive member it only changes the date, with no warning",
  );
  const rules = await checkUI(sef, "uyeler", {
    text: [
      "eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon",
      "elif.sahin@ornek.com;;2020-09-01;2020-01-01;",
      `selin.cakir@ornek.com;;;${dayFrom(1)};`,
      "sef@arkhe.local;;;2024-01-01;",
      "yok.kisi@ornek.com;Yok Kişi;;;",
      "eski.uye@eski.invalid;Eski Üye;2019-01-01;2020-01-01;",
    ].join("\n"),
  });
  check(
    has(rules, 2, "Ayrılış tarihi katılım tarihinden önce olamaz.") &&
      has(rules, 3, "Gelecek bir tarih olamaz.") &&
      has(rules, 4, "Kendini pasifleştiremezsin.") &&
      has(rules, 5, "Bu e-postayla üye yok. Aktif üyeleri Üyeler sayfasından davetle ekle; eski üyeler için ayrılış tarihini de yaz.") &&
      has(rules, 6, "Eski üye için partisyon gerekli."),
    `8b AC22/23 left before joined, a future date, the importer's own row, an unknown email, a former member without partisyon (${rules.errors.join(" | ").slice(0, 300)})`,
  );
  const sefJoined = (await db.execute("select joined_at from users where email = 'sef@arkhe.local'")).rows[0].joined_at;
  const sefDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(Number(sefJoined) * 1000));
  const board = `eposta;katilim_tarihi\nsef@arkhe.local;2015-09-01\ncan.yildiz@ornek.com;2016-09-01\n`;
  const asYk = await checkUI(yk, "uyeler", { text: board });
  check(
    has(asYk, 2, "Bu kişiyi yalnızca koro şefi değiştirebilir.") && has(asYk, 3, "Bu kişiyi yalnızca koro şefi değiştirebilir."),
    "8b AC25 as yk@ rows that would change the conductor or a board member are refused",
  );
  check(
    (await yk.getByTestId("board-note").innerText()).includes("Yönetim kurulu olarak yalnızca korist satırlarını değiştirebilirsin"),
    "8b AC25 board users see the board-only note on uyeler",
  );
  const asSef = await checkUI(sef, "uyeler", { text: board });
  check(asSef.kind === "clean" && (await sef.getByTestId("board-note").count()) === 0, "8b AC25 the same file passes as sef@ (no note for the conductor)");
  const unchangedYk = await checkUI(yk, "uyeler", { text: `eposta;katilim_tarihi\nsef@arkhe.local;${sefDay}\nmehmet.kaya@ornek.com;2017-09-01\n` });
  check(
    unchangedYk.kind === "clean" && unchangedYk.summary.includes("1 güncellenecek · 1 değişmeyecek"),
    `8b AC25 an unchanged conductor row is değişmeyecek for yk@ (${unchangedYk.summary})`,
  );
  await undoAll(sef);

  // AC 36: the past list pages 60 at a time, newest first.
  const todayStart = epoch(dayFrom(0));
  for (let i = 0; i < 130; i++) {
    const s = epoch("2019-01-01", "19:00") + i * 7 * 86_400;
    await db.execute({
      sql: "insert into rehearsals (id, type, title, location, starts_at, ends_at) values (?, 'tutti', ?, 'E2E Salon', ?, ?)",
      args: [crypto.randomUUID(), `E2E Sayfa ${i}`, s, s + 9000],
    });
  }
  const total = await count("select count(*) from rehearsals where starts_at < ?", [todayStart]);
  const pages = [];
  for (let n = 1; n <= Math.ceil(total / 60); n++) {
    await sef.goto(`${BASE}/calismalar?sekme=gecmis${n > 1 ? `&sayfa=${n}` : ""}`);
    const ids = await sef.locator('main ul li a[href^="/calismalar/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    pages.push({
      ids,
      newer: await sef.getByRole("link", { name: "Daha yeni" }).count(),
      older: await sef.getByRole("link", { name: "Daha eski" }).count(),
    });
  }
  const order = (
    await db.execute({ sql: "select id from rehearsals where starts_at < ? order by starts_at desc, id desc", args: [todayStart] })
  ).rows.map((r) => `/calismalar/${r.id}`);
  check(
    pages.length >= 3 &&
      pages.slice(0, -1).every((p) => p.ids.length === 60) &&
      pages.at(-1).ids.length === total - 60 * (pages.length - 1) &&
      pages.flatMap((p) => p.ids).join() === order.join(),
    `8b AC36 ${total} past rehearsals: ${pages.map((p) => p.ids.length).join(" + ")}, newest first, no repeats`,
  );
  check(
    pages[0].newer === 0 && pages[0].older === 1 && pages.at(-1).newer === 1 && pages.at(-1).older === 0 && pages[1].newer === 1 && pages[1].older === 1,
    "8b AC36 Daha yeni / Daha eski appear only where they apply",
  );
  await sef.goto(`${BASE}/calismalar?sekme=gecmis&sayfa=abc`);
  const first = await sef.locator('main ul li a[href^="/calismalar/"]').first().getAttribute("href");
  check(first === order[0], "8b AC36 a bad sayfa value shows page 1");
  if (shots) await sef.screenshot({ path: `${shots}/8b-calismalar-page2.png` });

  for (const p of [sef, yk, korist]) await p.context().close();
  await cleanup();
}

async function latestLiveKind() {
  return (await db.execute("select kind from import_batches where status = 'imported' order by id desc limit 1")).rows[0]?.kind ?? null;
}

async function setOpeningDate(date) {
  await db.execute({ sql: "update finance_entries set occurred_on = ? where kind = 'opening' and voided_at is null", args: [date] });
}

