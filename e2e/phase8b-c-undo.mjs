// Phase 8b, part C: the log, who may undo what, refused undos, the all-or-nothing fault hook,
// constraints and timings (AC 19, 37, 38, 40, 42, 44).
import { BASE, check, cleanup, db, loginAs } from "./lib.mjs";
import {
  arrangeCast,
  checkUI,
  commitUI,
  count,
  craftedUndo,
  csv,
  diff,
  H,
  importUI,
  setJoined,
  setOpening,
  snapshot,
  undoAll,
} from "./import.mjs";

const epoch = (date, time = "00:00") => Math.floor(Date.parse(`${date}T${time}:00+03:00`) / 1000);
const card = (page, id) => page.locator(`[data-testid=batch-row][data-batch="${id}"]`);
const lastId = async () => Number((await db.execute("select max(id) from import_batches")).rows[0][0]);

/** Geri al on one batch's card; returns the inline refusal, or null on success. */
async function undoCard(page, id) {
  await page.goto(`${BASE}/ice-aktar/gecmis`);
  await card(page, id).getByRole("button", { name: "Geri al" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Geri al" }).click();
  const alert = card(page, id).getByRole("alert");
  const toast = page.getByText("İçe aktarma geri alındı.").first();
  await Promise.race([alert.waitFor({ timeout: 15_000 }), toast.waitFor({ timeout: 15_000 })]).catch(() => {});
  return (await alert.count()) ? await alert.innerText() : null;
}

export default async function run(browser) {
  await cleanup();
  await arrangeCast();
  await setJoined("%@ornek.com", "2019-01-01");
  await setOpening("2020-01-01");
  const sef = await loginAs(browser, "sef@arkhe.local");
  const yk = await loginAs(browser, "yk@arkhe.local");

  // AC 37: empty state.
  await yk.goto(`${BASE}/ice-aktar/gecmis`);
  check(
    (await yk.locator("main").innerText()).includes("Henüz içe aktarma yapılmadı.") &&
      (await yk.locator('main a[href="/ice-aktar"]', { hasText: "Adımlara dön" }).count()) === 1,
    "8b AC37 the empty log reads Henüz içe aktarma yapılmadı.",
  );

  // AC 38: two batches, sef@ then yk@.
  await importUI(sef, "donemler", { text: `${H.donemler}\nE2E Log Güz;2021-09-01;2022-01-31\n`, name: "log-1.csv" });
  const a = await lastId();
  await importUI(yk, "aidat-donemleri", { text: `${H["aidat-donemleri"]}\nE2E Ocak 2021;2021-01-01;2021-01-31;2021-01-10;100;\n`, name: "log-2.csv" });
  const b = await lastId();
  await sef.goto(`${BASE}/ice-aktar/gecmis`);
  const rows = await sef.locator("[data-testid=batch-row]").evaluateAll((els) => els.map((e) => [e.dataset.batch, e.innerText]));
  const shaB = (await db.execute({ sql: "select file_sha256 from import_batches where id = ?", args: [b] })).rows[0][0];
  check(
    rows.map((r) => Number(r[0])).join() === `${b},${a}` &&
      /\d+ \S+ \d{4} \d{2}:\d{2} · Demo Yönetim/.test(rows[0][1]) &&
      rows[0][1].includes("Aidat dönemleri") &&
      rows[0][1].includes("log-2.csv") &&
      rows[0][1].includes("1 eklendi · 0 güncellendi · 0 değişmedi") &&
      rows[0][1].includes(`SHA-256 ${String(shaB).slice(0, 12)}`) &&
      rows[0][1].includes("Aktarıldı"),
    "8b AC37 newest first, with date, importer, type, file name, counts, the 12-character hash and the status",
  );
  await card(sef, b).getByRole("button", { name: "Geri al" }).waitFor({ timeout: 5000 }).catch(() => {});
  check(
    (await card(sef, b).getByRole("button", { name: "Geri al" }).count()) === 1 && (await card(sef, a).getByRole("button", { name: "Geri al" }).count()) === 0,
    "8b AC38 Geri al only on the latest batch (conductor)",
  );
  await yk.goto(`${BASE}/ice-aktar/gecmis`);
  await card(yk, b).getByRole("button", { name: "Geri al" }).waitFor({ timeout: 5000 }).catch(() => {});
  check((await card(yk, b).getByRole("button", { name: "Geri al" }).count()) === 1, "8b AC38 … and for its importer");
  const older = await craftedUndo(sef, a);
  check(older.includes("Önce daha sonraki içe aktarmayı geri al."), "8b AC38 the server refuses a batch that isn't the latest");
  check((await undoCard(yk, b)) === null, "8b AC38 yk@ undoes their own batch; toast İçe aktarma geri alındı.");
  await yk.goto(`${BASE}/ice-aktar/gecmis`);
  check(
    (await card(yk, b).innerText()).includes("Geri alındı · Demo Yönetim") &&
      (await card(yk, a).getByRole("button", { name: "Geri al" }).count()) === 0 &&
      (await card(yk, a).innerText()).includes("Bunu yalnızca yapan kişi ya da koro şefi geri alabilir."),
    "8b AC37/38 the undone card says who undid it; sef@'s batch is now latest and yk@ sees why there's no button",
  );
  const notOwner = await craftedUndo(yk, a);
  check(notOwner.includes("Bu içe aktarmayı yalnızca yapan kişi ya da koro şefi geri alabilir."), "8b AC38 yk@ can't undo sef@'s batch");
  check((await undoCard(sef, a)) === null, "8b AC38 the conductor undoes it");

  // AC 40: undo refused when something was built on it; nothing changes.
  const refusals = [];
  const refuse = async (label, arrange, want, restore) => {
    const id = await lastId();
    await arrange(id);
    const before = await snapshot();
    const msg = await undoCard(sef, id);
    const same = diff(before, await snapshot()).length === 0;
    refusals.push(label);
    check(msg !== null && msg.includes(want) && same, `8b AC40 ${label}: ${msg} (unchanged: ${same})`);
    await restore(id);
  };
  await importUI(sef, "yoklama", {
    text: `${H.yoklama}\n2023-03-07;19:00;;tutti;;;;ayse.demir@ornek.com;geldi;\n2023-03-07;;;;;;;mehmet.kaya@ornek.com;geldi;\n`,
  });
  const rid = (await db.execute("select rehearsal_id from import_items where rehearsal_id is not null")).rows[0][0];
  await refuse(
    "a corrected attendance row",
    () => db.execute({ sql: "update attendance set corrected_at = unixepoch() where rehearsal_id = ? and method = 'auto'", args: [rid] }),
    "çalışması bu aktarımdan sonra düzeltildi; geri alınamaz.",
    () => db.execute({ sql: "update attendance set corrected_at = null where rehearsal_id = ?", args: [rid] }),
  );
  await refuse(
    "an event linked to the imported rehearsal",
    () => db.execute({ sql: "insert into events (id, name, starts_on, rehearsal_id) values ('e2e-ev-u', 'E2E Bağlı', '2023-03-07', ?)", args: [rid] }),
    "çalışmasına bir etkinlik bağlanmış; geri alınamaz.",
    () => db.execute("delete from events where id = 'e2e-ev-u'"),
  );
  check((await undoCard(sef, await lastId())) === null, "8b AC40 the rehearsal batch undoes once restored");

  await importUI(sef, "hareketler", { text: `${H.hareketler}\nV-1;2023-05-05;gider;ikram;10;kasa;;E2E çay;;;;\n` });
  const eid = (await db.execute("select finance_entry_id from import_items where kayit_no = 'V-1'")).rows[0][0];
  const sefId = (await db.execute("select id from users where email = 'sef@arkhe.local'")).rows[0][0];
  await refuse(
    "an imported entry voided by hand",
    () => db.execute({ sql: "update finance_entries set voided_at = unixepoch(), voided_by = ?, void_reason = 'E2E iptal' where id = ?", args: [sefId, eid] }),
    "Kayıt V-1 bu aktarımdan sonra değişti; geri alınamaz.",
    () => db.execute({ sql: "update finance_entries set voided_at = null, voided_by = null, void_reason = null where id = ?", args: [eid] }),
  );
  check((await undoCard(sef, await lastId())) === null, "8b AC40 the entry batch undoes once restored");
  check((await count("select count(*) from finance_entries where id = ?", [eid])) === 0, "8b AC39 the undone entry is deleted, not voided (D17)");

  await importUI(sef, "uyeler", { text: "eposta;partisyon\nselin.aydin@ornek.com;soprano\n" });
  await refuse(
    "a member edited after a member-history import",
    () => db.execute("update users set voice_part = 'tenor' where email = 'selin.aydin@ornek.com'"),
    "Selin Aydın bu aktarımdan sonra değişti ya da kullanıldı; geri alınamaz.",
    () => db.execute("update users set voice_part = 'soprano' where email = 'selin.aydin@ornek.com'"),
  );
  check((await undoCard(sef, await lastId())) === null, "8b AC39 the member batch undoes and restores the part");
  check(
    (await db.execute("select voice_part from users where email = 'selin.aydin@ornek.com'")).rows[0][0] === "alto",
    "8b AC39 the previous voice part is back",
  );

  await importUI(sef, "aidat-donemleri", { text: `${H["aidat-donemleri"]}\nE2E Mart 2021;2021-03-01;2021-03-31;2021-03-10;100;\n` });
  const pid = (await db.execute("select id from dues_periods where name = 'E2E Mart 2021'")).rows[0][0];
  const ayse = (await db.execute("select id from users where email = 'ayse.demir@ornek.com'")).rows[0][0];
  await refuse(
    "a dues period that received a hand-entered payment",
    () =>
      db.execute({
        sql: "insert into finance_entries (id, kind, category, amount_kurus, occurred_on, account, member_id, dues_period_id, created_by) values ('00000000-0000-4000-8b00-0000000000e1', 'income', 'dues', 100, '2021-03-05', 'cash', ?, ?, ?)",
        args: [ayse, pid, sefId],
      }),
    "E2E Mart 2021 dönemine ödeme girilmiş; geri alınamaz.",
    () => db.execute("delete from finance_entries where id = '00000000-0000-4000-8b00-0000000000e1'"),
  );
  await refuse(
    "a dues period edited by hand",
    () => db.execute({ sql: "update dues_periods set due_on = '2021-03-11' where id = ?", args: [pid] }),
    "E2E Mart 2021 dönemi bu aktarımdan sonra değişti; geri alınamaz.",
    () => db.execute({ sql: "update dues_periods set due_on = '2021-03-10' where id = ?", args: [pid] }),
  );
  check((await undoCard(sef, await lastId())) === null, "8b AC40 the period batch undoes once restored");

  // Review P2-2: a row the treasurer already deleted by hand counts as undone, not as "changed".
  await importUI(sef, "aidat-donemleri", { text: `${H["aidat-donemleri"]}\nE2E Nisan 2021;2021-04-01;2021-04-30;2021-04-10;100;\n` });
  const periodBatch = await lastId();
  const waiver = `${H["aidat-odemeleri"]}\nM-E2E-1;muaf;ayse.demir@ornek.com;E2E Nisan 2021;;;;E2E yönetim kararı\n`;
  const waived = await importUI(sef, "aidat-odemeleri", { text: waiver, name: "muaf.csv" });
  const waiverBatch = await lastId();
  check(waived.done?.kind === "done" && waiverBatch > periodBatch, `8b review P2-2 a waiver imports (${waived.check.summary})`);
  const apr = (await db.execute("select id from dues_periods where name = 'E2E Nisan 2021'")).rows[0][0];
  // What removeWaiver does, with the composite FK's ON DELETE SET NULL spelled out.
  await db.batch([
    { sql: "update import_items set override_period_id = null, override_user_id = null where override_period_id = ? and override_user_id = ?", args: [apr, ayse] },
    { sql: "delete from dues_overrides where dues_period_id = ? and user_id = ?", args: [apr, ayse] },
  ]);
  const again = await checkUI(sef, "aidat-odemeleri", { text: waiver, name: "muaf.csv" });
  check(
    again.kind === "errors" && again.errors.some((e) => e.includes("Kayıt M-E2E-1 portalda silinmiş")),
    `8b review P2-2 re-checking a hand-deleted waiver names it as deleted, not a conflict (${again.errors[0]})`,
  );
  check((await undoCard(sef, waiverBatch)) === null, "8b review P2-2 the waiver batch undoes after Muaf kaldır");
  await db.batch([
    { sql: "update import_items set dues_period_id = null where dues_period_id = ?", args: [apr] },
    { sql: "delete from dues_periods where id = ?", args: [apr] },
  ]);
  check((await undoCard(sef, periodBatch)) === null, "8b review P2-2 the period batch undoes after Dönemi sil");
  check(
    (await count("select count(*) from import_batches where id in (?, ?) and status = 'undone'", [periodBatch, waiverBatch])) === 2,
    "8b review P2-2 both batches end up undone",
  );
  await importUI(sef, "aidat-donemleri", { text: `${H["aidat-donemleri"]}\nE2E Haziran 2021;2021-06-01;2021-06-30;2021-06-10;100;50\n` });
  const junBatch = await lastId();
  const jun = (await db.execute("select id from dues_periods where name = 'E2E Haziran 2021'")).rows[0][0];
  const mehmet = (await db.execute("select id from users where email = 'mehmet.kaya@ornek.com'")).rows[0][0];
  await db.execute({ sql: "insert or replace into member_dues (user_id, rate) values (?, 'reduced')", args: [mehmet] });
  await db.execute({
    sql: "insert into finance_entries (id, kind, category, amount_kurus, occurred_on, account, member_id, dues_period_id, created_by) values ('00000000-0000-4000-8b00-0000000000e2', 'income', 'dues', 5000, '2021-06-05', 'cash', ?, ?, ?)",
    args: [mehmet, jun, sefId],
  });
  const rate = await importUI(sef, "uyeler", { text: "eposta;aidat_orani\nmehmet.kaya@ornek.com;tam\n", name: "oran.csv" });
  const rateBatch = await lastId();
  const freeze = "select count(*) from dues_overrides where dues_period_id = ? and user_id = ? and kind = 'freeze'";
  check(
    rate.done?.kind === "done" && (await count(freeze, [jun, mehmet])) === 1,
    `8b review P2-2 a rate change after a payment pins a freeze (${rate.check.summary})`,
  );
  // What voidEntry + dropLapsedFreezes do, with the FK's SET NULL spelled out.
  await db.batch([
    { sql: "update finance_entries set voided_at = unixepoch(), voided_by = ?, void_reason = 'E2E iptal' where id = '00000000-0000-4000-8b00-0000000000e2'", args: [sefId] },
    { sql: "update import_items set override_period_id = null, override_user_id = null where override_period_id = ? and override_user_id = ?", args: [jun, mehmet] },
    { sql: "delete from dues_overrides where dues_period_id = ? and user_id = ? and kind = 'freeze'", args: [jun, mehmet] },
  ]);
  check((await undoCard(sef, rateBatch)) === null, "8b review P2-2 the rate batch undoes after the paid entry was voided");
  check(
    (await db.execute({ sql: "select rate from member_dues where user_id = ?", args: [mehmet] })).rows[0]?.[0] === "reduced",
    "8b review P2-2 the rate is back to indirimli",
  );
  await db.batch([
    "delete from finance_entries where id = '00000000-0000-4000-8b00-0000000000e2'",
    { sql: "delete from member_dues where user_id = ?", args: [mehmet] },
  ]);
  check((await undoCard(sef, junBatch)) === null, "8b review P2-2 the June period batch undoes afterwards");

  // AC 19: a commit that fails part-way leaves no row of the batch anywhere.
  const fault = [
    "kayit_no;tarih;tur;kategori;tutar;hesap;sponsor",
    ...Array.from({ length: 100 }, (_, i) => `F-${i};2023-01-${String((i % 28) + 1).padStart(2, "0")};gelir;sponsorluk;10;banka;E2E Hata Sponsoru ${i % 3}`),
  ];
  await checkUI(sef, "hareketler", { buffer: csv(fault), name: "yarim.csv" });
  await sef.context().addCookies([{ name: "arkhe_e2e_import_fault", value: "50", url: BASE }]);
  const beforeFault = await snapshot();
  const failed = await commitUI(sef);
  await sef.context().clearCookies({ name: "arkhe_e2e_import_fault" });
  check(failed.kind === "fileError" && failed.text.includes("Bir şeyler ters gitti, tekrar dene."), "8b AC19 the failed commit shows the generic error");
  check(diff(beforeFault, await snapshot()).length === 0, "8b AC19 every table is unchanged: batch, items, sponsors, entries");

  // AC 42: invalid direct writes fail at the DB.
  const throws = async (sql) => {
    try {
      await db.execute(sql);
      return false;
    } catch {
      return true;
    }
  };
  const base = `'E2E.csv', 10, '${"a".repeat(64)}', 1, 1, 0, 0, '${sefId}'`;
  const insert = (kind, extra = base, status = "'imported'") =>
    `insert into import_batches (kind, status, file_name, file_size, file_sha256, row_count, added_count, updated_count, unchanged_count, created_by) values ('${kind}', ${status}, ${extra})`;
  const bad = [
    ["an unknown type", insert("bogus")],
    ["a 63-character hash", insert("terms", `'E2E.csv', 10, '${"a".repeat(63)}', 1, 1, 0, 0, '${sefId}'`)],
    ["a negative count", insert("terms", `'E2E.csv', 10, '${"a".repeat(64)}', 1, 2, -1, 0, '${sefId}'`)],
    ["undone without undo fields", insert("terms", base, "'undone'")],
  ];
  const results = [];
  for (const [label, sql] of bad) results.push([label, await throws(sql)]);
  await db.execute(insert("entries"));
  const bid = await lastId();
  results.push([
    "an item with two targets",
    await throws(`insert into import_items (batch_id, target, action, user_id, term_id, after_json) values (${bid}, 'user', 'create', '${sefId}', 'x', '{}')`),
  ]);
  results.push([
    "a bad kayit_no",
    await throws(`insert into import_items (batch_id, target, action, finance_entry_id, kayit_scope, kayit_no) values (${bid}, 'finance_entry', 'create', 'x', 'entries', 'kayıt 1')`),
  ]);
  await db.execute({ sql: "delete from import_batches where id = ?", args: [bid] });
  check(results.every(([, t]) => t), `8b AC42 invalid direct writes are refused by the DB (${results.filter(([, t]) => !t).map(([l]) => l)})`);

  // AC 44: timings on the dev server (loose).
  const pw = (await db.execute("select password_hash from users where email = 'korist@arkhe.local'")).rows[0][0];
  const parts = ["soprano", "alto", "tenor", "bass"];
  for (let i = 0; i < 36; i++) {
    await db.execute({
      sql: "insert into users (id, name, email, role, voice_part, password_hash, joined_at) values (?, ?, ?, 'member', ?, ?, ?)",
      args: [crypto.randomUUID(), `Perf Kişi ${i}`, `perf-${i}@ornek.com`, parts[i % 4], pw, epoch("2019-01-01")],
    });
  }
  const big = [H.yoklama];
  for (let r = 0; big.length <= 5000; r++) {
    const day = new Date(Date.UTC(2021, 0, 5 + r * 7)).toISOString().slice(0, 10);
    for (let i = 0; i < 36 && big.length <= 5000; i++) big.push(`${day};${i ? "" : "19:00"};;;;;;perf-${i}@ornek.com;geldi;`);
  }
  // Warm-up so compilation isn't timed.
  await checkUI(sef, "yoklama", { text: `${H.yoklama}\n2021-01-05;19:00;;;;;;perf-0@ornek.com;geldi;\n` });
  let t = Date.now();
  const bigCheck = await checkUI(sef, "yoklama", { buffer: csv(big), name: "buyuk-yoklama.csv" });
  const checkMs = Date.now() - t;
  t = Date.now();
  const bigDone = bigCheck.kind === "clean" ? await commitUI(sef) : null;
  const commitMs = Date.now() - t;
  check(
    bigCheck.kind === "clean" && bigCheck.summary.startsWith("5000 satır okundu") && checkMs < 15_000 && bigDone?.kind === "done" && commitMs < 30_000,
    `8b AC44 5000-row yoklama: check ${checkMs} ms (< 15 s), import ${commitMs} ms (< 30 s)`,
  );
  const ledger = ["kayit_no;tarih;tur;kategori;tutar;hesap"];
  for (let i = 0; i < 2000; i++) ledger.push(`P-${i};2022-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")};gider;ikram;${(i % 90) + 10};kasa`);
  t = Date.now();
  const ledgerCheck = await checkUI(sef, "hareketler", { buffer: csv(ledger), name: "defter.csv" });
  const ledgerMs = Date.now() - t;
  check(ledgerCheck.kind === "clean" && ledgerMs < 10_000, `8b AC44 2000-row hareketler: check ${ledgerMs} ms (< 10 s)`);
  await undoAll(sef);
  for (let i = 0; i < 50; i++) {
    await db.execute(
      `insert into import_batches (kind, status, file_name, file_size, file_sha256, row_count, added_count, updated_count, unchanged_count, created_by, undone_at, undone_by) values ('terms', 'undone', 'E2E-${i}.csv', 10, '${"b".repeat(64)}', 1, 1, 0, 0, '${sefId}', unixepoch(), '${sefId}')`,
    );
  }
  const timings = [];
  for (const p of ["/ice-aktar", "/ice-aktar/gecmis"]) {
    await sef.goto(`${BASE}${p}`);
    t = Date.now();
    await sef.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" });
    timings.push([p, Date.now() - t]);
  }
  check(timings.every(([, ms]) => ms < 1000), `8b AC44 index and log with 50+ batches answer in under 1 s (${timings.map(([p, ms]) => `${p} ${ms} ms`)})`);
  await sef.goto(`${BASE}/ice-aktar/gecmis`);
  await sef.getByRole("link", { name: "Daha eski" }).waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    (await sef.locator("[data-testid=batch-row]").count()) === 50 && (await sef.getByRole("link", { name: "Daha eski" }).count()) === 1,
    "8b AC37 the log shows 50 per page with Daha eski",
  );
  await sef.goto(`${BASE}/ice-aktar/gecmis?sayfa=2`);
  await sef.getByRole("link", { name: "Daha yeni" }).waitFor({ timeout: 10_000 }).catch(() => {});
  check((await sef.getByRole("link", { name: "Daha yeni" }).count()) === 1, "8b AC37 page 2 links Daha yeni");

  for (const p of [sef, yk]) await p.context().close();
  await cleanup();
}
