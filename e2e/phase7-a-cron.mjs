// Phase 7: the cron route, idempotency, retries and the email content (AC 1–12, 24, 32, 34, 36).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE, check, db, login, newPage, userId } from "./lib.mjs";
import {
  DEV_CRON_SECRET,
  DEV_PASSPHRASE,
  ROOT,
  cron,
  csvRows,
  insertRun,
  newEmails,
  outboxSnapshot,
  parseEml,
  removeEmails,
  resetBackup,
  runRows,
  setRecipients,
} from "./mail.mjs";

const TO = ["p7a@e2e.test", "p7b@e2e.test"];
const STALE_ERROR = "Gönderim yarıda kaldı (10 dakika içinde tamamlanmadı).";
const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
const kurus = (k) => money.format(k / 100);
const ts = (iso) => Math.floor(Date.parse(iso) / 1000);

const SINGERS = [
  { key: "s1", name: "E2E Ayla Faz", email: "p7-s1@e2e.test" },
  { key: "s2", name: "E2E Bora Faz", email: "p7-s2@e2e.test" },
  { key: "s3", name: "E2E Cem Faz", email: "p7-s3@e2e.test" },
];

async function precondition() {
  const from = ts("2024-12-31T21:00:00Z");
  const to = ts("2025-01-31T21:00:00Z");
  const r = await db.execute({
    sql: `select
      (select count(*) from rehearsals where starts_at >= ? and starts_at < ? and title not like 'E2E%') as reh,
      (select count(*) from assignments where due_at >= ? and due_at < ?) as hw,
      (select count(*) from finance_entries where occurred_on between '2025-01-01' and '2025-01-31') as fin,
      (select count(*) from dues_periods where starts_on <= '2025-01-31' and ends_on >= '2025-01-01') as dues,
      (select count(*) from users where joined_at < ? and email not like '%@e2e.test') as early`,
    args: [from, to, from, to, ts("2025-01-05T00:00:00Z")],
  });
  return r.rows[0];
}

/** January 2025 fixtures; returns the ids the assertions need. */
async function seedJanuary() {
  const ids = {};
  for (const s of SINGERS) {
    ids[s.key] = crypto.randomUUID();
    await db.execute({
      sql: "insert into users (id, name, email, role, voice_part, joined_at) values (?, ?, ?, 'member', 'soprano', ?)",
      args: [ids[s.key], s.name, s.email, ts("2024-06-01T09:00:00Z")],
    });
  }
  // R1 mid-month; R2 31 Jan 23:30 Istanbul (in January); R3 1 Feb 00:30 Istanbul (not in January).
  const rehearsal = async (title, startIso, marks) => {
    const id = crypto.randomUUID();
    const start = ts(startIso);
    await db.execute({
      sql: "insert into rehearsals (id, type, title, location, starts_at, ends_at, opened_at, closed_at) values (?, 'tutti', ?, 'E2E Salon', ?, ?, ?, ?)",
      args: [id, title, start, start + 9000, start - 600, start + 9000],
    });
    for (const [key, status] of Object.entries(marks)) {
      await db.execute({
        sql: "insert into attendance (rehearsal_id, user_id, status, method, recorded_at) values (?, ?, ?, 'manual', ?)",
        args: [id, ids[key], status, start],
      });
    }
    return id;
  };
  await rehearsal("E2E P7 Ocak", "2025-01-10T16:30:00Z", { s1: "present", s2: "late", s3: "absent" });
  await rehearsal("E2E P7 31 Ocak 23:30", "2025-01-31T20:30:00Z", {
    s1: "present",
    s2: "absent",
    s3: "excused",
  });
  await rehearsal("E2E P7 1 Şubat 00:30", "2025-01-31T21:30:00Z", { s1: "absent", s2: "present" });

  const pieceId = crypto.randomUUID();
  await db.execute({
    sql: "insert into pieces (id, title) values (?, 'E2E P7 Eser')",
    args: [pieceId],
  });
  ids.assignment = crypto.randomUUID();
  await db.execute({
    sql: "insert into assignments (id, piece_id, bar_from, bar_to, due_at, created_at, updated_at) values (?, ?, 1, 16, ?, ?, ?)",
    args: [
      ids.assignment,
      pieceId,
      ts("2025-01-20T17:00:00Z"),
      ts("2025-01-05T09:00:00Z"),
      ts("2025-01-05T09:00:00Z"),
    ],
  });
  await db.execute({
    sql: "insert into assignment_parts (assignment_id, voice_part) values (?, 'soprano')",
    args: [ids.assignment],
  });
  for (const [key, at] of [
    ["s1", "2025-01-18T10:00:00Z"],
    ["s2", "2025-01-22T10:00:00Z"],
  ]) {
    await db.execute({
      sql: "insert into submissions (assignment_id, user_id, submitted_at, method) values (?, ?, ?, 'self')",
      args: [ids.assignment, ids[key], ts(at)],
    });
  }

  const yk = await userId("yk@arkhe.local");
  const entry = (kind, category, amount, day, account, extra = {}) =>
    db.execute({
      sql: `insert into finance_entries (id, kind, category, amount_kurus, occurred_on, account, to_account, description, created_by, voided_at, voided_by, void_reason)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        kind,
        category,
        amount,
        day,
        account,
        extra.to ?? null,
        `E2E P7 ${kind}`,
        yk,
        extra.voided ? ts("2025-01-26T10:00:00Z") : null,
        extra.voided ? yk : null,
        extra.voided ? "E2E iptal edildi" : null,
      ],
    });
  await entry("income", "donation", 1_250_000, "2025-01-15", "bank");
  await entry("expense", "venue", 320_000, "2025-01-25", "cash");
  await entry("expense", "catering", 99_900, "2025-01-26", "cash", { voided: true });
  await entry("transfer", null, 50_000, "2025-01-27", "cash", { to: "bank" });
  ids.period = crypto.randomUUID();
  await db.execute({
    sql: "insert into dues_periods (id, name, starts_on, ends_on, due_on, amount_kurus, created_by) values (?, 'E2E Ocak 2025', '2025-01-01', '2025-01-31', '2025-01-15', 30000, ?)",
    args: [ids.period, yk],
  });
  return ids;
}

export default async function phase7Cron(browser) {
  await resetBackup();
  const created = [];
  const startSnapshot = outboxSnapshot();
  try {
    // AC1
    const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    check(
      JSON.stringify(vercel.crons) ===
        JSON.stringify([{ path: "/api/cron/aylik-yedek", schedule: "0 5 * * *" }]),
      `AC1 vercel.json declares exactly one cron (${JSON.stringify(vercel.crons)})`,
    );

    // AC2
    const preflight = await cron("");
    if (preflight.status === 503) {
      check(false, "AC2 CRON_SECRET missing from the dev env (the dev server answered 503)");
      return;
    }
    let before = outboxSnapshot();
    const noHeader = await cron("", { secret: null });
    const wrong = await cron("", { header: "Bearer wrong" });
    check(
      noHeader.status === 401 && noHeader.text === "{}" && wrong.status === 401 && wrong.text === "{}",
      `AC2 no header → ${noHeader.status} ${noHeader.text}, Bearer wrong → ${wrong.status} ${wrong.text}`,
    );
    check(
      (noHeader.headers.get("cache-control") ?? "").includes("no-store"),
      "AC2/36 a 401 answer is no-store",
    );
    await setRecipients(TO);
    const wrongWithRecipients = await cron("?bugun=2026-11-01", { header: "Bearer wrong" });
    check(
      wrongWithRecipients.status === 401 &&
        newEmails(before).length === 0 &&
        (await runRows()).length === 0,
      "AC2 a wrong bearer with recipients saved sends nothing and logs no run",
    );
    await resetBackup();
    const skipped = await cron("?bugun=2026-11-01");
    check(
      skipped.status === 200 &&
        JSON.stringify(Object.keys(skipped.json ?? {})) === '["status"]' &&
        skipped.json.status === "skipped" &&
        (skipped.headers.get("content-type") ?? "").includes("application/json") &&
        (skipped.headers.get("cache-control") ?? "").includes("no-store"),
      `AC2/36 no recipients → 200 {"status":"skipped"} only, JSON, no-store (${skipped.text})`,
    );
    check(
      (await runRows()).length === 0 && newEmails(before).length === 0,
      "AC2 no recipients → no run row, no .eml",
    );

    // AC3
    await setRecipients(TO);
    before = outboxSnapshot();
    const t0 = Date.now();
    const sent = await cron("?bugun=2026-11-01");
    const sendMs = Date.now() - t0;
    let mails = newEmails(before);
    created.push(...mails);
    let rows = await runRows();
    check(
      sent.status === 200 && sent.json?.status === "sent" && mails.length === 1,
      `AC3 ?bugun=2026-11-01 → sent, one .eml (${sent.text}, ${mails.length})`,
    );
    check(
      rows.length === 1 &&
        rows[0].trigger === "cron" &&
        rows[0].report_month === "2026-10" &&
        rows[0].status === "sent",
      `AC3 one run: cron / 2026-10 / sent (${rows.map((r) => `${r.trigger}/${r.report_month}/${r.status}`)})`,
    );
    console.log(`AC34 measured dev send: ${sendMs} ms round trip, ${rows[0]?.size_bytes} bytes`);
    check(sendMs < 60_000, `AC34 a dev send takes far below 60 s (${sendMs} ms)`);

    // AC4
    before = outboxSnapshot();
    const again = await cron("?bugun=2026-11-02");
    check(
      again.status === 200 &&
        again.json?.status === "skipped" &&
        newEmails(before).length === 0 &&
        (await runRows()).length === 1,
      `AC4 ?bugun=2026-11-02 → skipped, no .eml, no new run (${again.text})`,
    );
    const both = await Promise.all([cron("?bugun=2026-12-01"), cron("?bugun=2026-12-01")]);
    mails = newEmails(before);
    created.push(...mails);
    rows = (await runRows()).filter((r) => r.report_month === "2026-11");
    check(
      JSON.stringify(both.map((r) => r.json?.status).sort()) === '["sent","skipped"]' &&
        mails.length === 1 &&
        rows.length === 1 &&
        rows[0].status === "sent",
      `AC4 two concurrent ?bugun=2026-12-01 → ${both.map((r) => r.json?.status)}, ${mails.length} .eml, ${rows.length} run`,
    );

    // AC5
    await insertRun({ month: "2026-09", status: "failed", error: "E2E önceki hata" });
    before = outboxSnapshot();
    const retry = await cron("?bugun=2026-10-02");
    mails = newEmails(before);
    created.push(...mails);
    const sep = (await runRows()).filter((r) => r.report_month === "2026-09");
    check(
      retry.json?.status === "sent" && mails.length === 1 && sep.some((r) => r.status === "sent"),
      `AC5 a failed 2026-09 is retried by ?bugun=2026-10-02 (${retry.text})`,
    );
    await insertRun({ month: "2026-08", status: "running", ageMin: 11 });
    before = outboxSnapshot();
    const reaped = await cron("?bugun=2026-09-01");
    mails = newEmails(before);
    created.push(...mails);
    const aug = (await runRows()).filter((r) => r.report_month === "2026-08");
    check(
      reaped.json?.status === "sent" &&
        mails.length === 1 &&
        aug.some((r) => r.status === "failed" && r.error === STALE_ERROR) &&
        aug.some((r) => r.status === "sent"),
      `AC5 an 11-minute-old running 2026-08 is reaped with the stale message and resent (${aug.map((r) => r.status)})`,
    );
    await insertRun({ month: "2026-07", status: "running", ageMin: 2 });
    before = outboxSnapshot();
    const blocked = await cron("?bugun=2026-08-01");
    check(
      blocked.json?.status === "skipped" && newEmails(before).length === 0,
      `AC5 a 2-minute-old running 2026-07 blocks the retry (${blocked.text})`,
    );
    await resetBackup();
    await setRecipients(TO);
    await insertRun({ month: "2026-10", status: "failed" });
    before = outboxSnapshot();
    const abandoned = await cron("?bugun=2026-12-01");
    mails = newEmails(before);
    created.push(...mails);
    rows = await runRows();
    check(
      abandoned.json?.status === "sent" &&
        rows.some((r) => r.report_month === "2026-11" && r.status === "sent") &&
        !rows.some((r) => r.report_month === "2026-10" && r.status === "sent"),
      "AC5 abandoned month: a failed 2026-10 alone + ?bugun=2026-12-01 sends 2026-11 only",
    );

    // AC6–12: the January 2025 fixture month.
    const pre = await precondition();
    const clean = Object.values(pre).every((v) => Number(v) === 0);
    check(
      clean,
      `AC6 precondition: no non-E2E data in January 2025 and no early joiners (${JSON.stringify(pre)})`,
    );
    if (!clean) return;
    await resetBackup();
    await setRecipients(TO);
    const ids = await seedJanuary();
    before = outboxSnapshot();
    const jan = await cron("?bugun=2025-02-01");
    mails = newEmails(before);
    created.push(...mails);
    check(
      jan.json?.status === "sent" && mails.length === 1,
      `AC6 ?bugun=2025-02-01 sends January 2025 (${jan.text})`,
    );
    if (mails.length !== 1) return;
    const mail = parseEml(mails[0]);
    const att = Object.fromEntries(mail.attachments.map((a) => [a.filename, a.data]));

    // AC7
    check(
      /^"?Arkhe Portal"? <outbox@arkhe\.local>$/.test(mail.headers.from),
      `AC7 From is Arkhe Portal <outbox@arkhe.local> (${mail.headers.from})`,
    );
    const to = (mail.headers.to ?? "").split(",").map((s) => s.trim());
    check(
      JSON.stringify(to.sort()) === JSON.stringify([...TO].sort()),
      `AC7 one message To both recipients (${mail.headers.to})`,
    );
    const subject = mail.headers.subject;
    check(
      subject === "Arkhe aylık rapor ve yedek · Ocak 2025" &&
        !subject.includes("@") &&
        !subject.includes("₺"),
      `AC7 decoded Subject is exact, no @ or ₺ (${subject})`,
    );

    // AC8
    const body = mail.text;
    const backupName = mail.attachments.find((a) => a.filename.endsWith(".sql.gz.enc"))?.filename;
    const lines = [
      "Arkhe Portal'ın Ocak 2025 raporları ve koronun tüm kayıtlarının şifreli yedeği ekte.",
      "Çalışma: 2 · Ortalama devam: %50",
      "Ödev: 1 · Zamanında teslim: %33",
      `Gelir: ${kurus(1_250_000)} · Gider: ${kurus(320_000)} · Net: ${kurus(930_000)}`,
      "- arkhe-devam-2025-01.csv: kişi bazında devam",
      "- arkhe-odev-2025-01.csv: ödev teslimleri",
      "- arkhe-finans-2025-01.csv: kasa hareketleri",
      "- arkhe-aidat-2025-01.csv: aidat durumu (gönderim günü itibarıyla)",
      "CSV dosyaları telefonda ya da Excel'de açılır.",
      `Yedek dosyasını açmanız gerekmez; bu e-postayı silmeden saklayın. Portalda bir sorun olursa koronun kayıtları bu dosyadan geri getirilir. Dosya şifrelidir ve şifresi bu e-postada yoktur. Gerekirse dosyayı portalı kuran kişi açar; adımlar README'nin "Aylık yedek e-postası" bölümünde.`,
      "Ses kayıtları ve MIDI dosyaları bu yedeğe dahil değildir; kayıtlar 90 gün sonra zaten silinir.",
      "Raporlar şifresizdir; bu e-postayı koro yönetimi dışında kimseye iletmeyin.",
      "Bu e-posta her ayın 1'inde kendiliğinden gönderilir. Alıcıları koro şefi buradan değiştirir:",
      `${BASE}/yedek`,
    ];
    const missing = lines.filter((l) => !body.split("\n").includes(l));
    check(missing.length === 0, `AC8 body lines present (missing: ${missing.join(" | ")})`);
    const bodyLines = body.split("\n");
    const audioLine = bodyLines.indexOf(
      "Ses kayıtları ve MIDI dosyaları bu yedeğe dahil değildir; kayıtlar 90 gün sonra zaten silinir.",
    );
    check(
      audioLine > 0 &&
        bodyLines.slice(audioLine + 1).find((l) => l.trim() !== "") ===
          "Raporlar şifresizdir; bu e-postayı koro yönetimi dışında kimseye iletmeyin.",
      "AC42 (Phase 9) the email says audio isn't in the backup, right before Raporlar şifresizdir…",
    );
    check(
      /^arkhe-yedek-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz\.enc$/.test(backupName ?? "") &&
        body.includes(`- ${backupName}: şifreli yedek`),
      `AC8 the backup line names arkhe-yedek-YYYY-MM-DD-HHmm.sql.gz.enc (${backupName})`,
    );
    check(
      !body.includes("elle gönderildi") && !/Bu e-postayı .* elle gönderdi/.test(body),
      "AC8 an automatic send has no manual paragraph",
    );
    check(
      !/=[0-9A-F]{2}/.test(body) && body.includes("Merhaba,\n\n"),
      "AC8 plain text, decoded (no QP escapes left), one paragraph per line",
    );
    const csvTexts = mail.attachments
      .filter((a) => a.filename.endsWith(".csv"))
      .map((a) => a.data.toString("utf8"));
    const leaks = [body, ...csvTexts].filter((t) =>
      ["@arkhe.local", "@e2e.test", ...SINGERS.map((s) => s.email)].some((e) => t.includes(e)),
    );
    check(
      leaks.length === 0 && mail.attachments.length === 5,
      `AC8 five attachments; no demo or fixture email in the body or any CSV (${leaks.length})`,
    );

    // AC6 + AC9
    const yk = await newPage(browser, { phone: true });
    await login(yk, "yk@arkhe.local");
    await yk.waitForURL(`${BASE}/`);
    const devam = att["arkhe-devam-2025-01.csv"];
    const route = await (await yk.request.get(`${BASE}/raporlar/csv`)).body();
    const firstLine = (b) => b.toString("utf8").split("\r\n")[0];
    check(
      devam && firstLine(devam) === firstLine(route) && firstLine(devam).startsWith("﻿"),
      "AC9 the attendance header equals /raporlar/csv's (BOM included)",
    );
    const devamRows = csvRows(devam ?? Buffer.alloc(0));
    const s1 = devamRows.find((r) => r[0] === "E2E Ayla Faz");
    const s3 = devamRows.find((r) => r[0] === "E2E Cem Faz");
    check(
      s1?.[2] === "2" && s1?.[3] === "2" && s3?.[3] === "1",
      `AC6/9 31 Jan 23:30 counts, 1 Feb 00:30 doesn't: Ayla Geldi/Beklenen ${s1?.[2]}/${s1?.[3]}`,
    );

    // AC10
    const odev = csvRows(att["arkhe-odev-2025-01.csv"] ?? Buffer.alloc(0));
    check(
      JSON.stringify(odev[0]) ===
        JSON.stringify(["Ödev", "Eser", "Son tarih", "Ad soyad", "Partisyon", "Durum", "Teslim tarihi"]),
      "AC10 homework CSV columns",
    );
    check(
      JSON.stringify(odev.slice(1).map((r) => [r[3], r[5], r[1]])) ===
        JSON.stringify([
          ["E2E Ayla Faz", "Zamanında", "E2E P7 Eser"],
          ["E2E Bora Faz", "Geç", "E2E P7 Eser"],
          ["E2E Cem Faz", "Gecikti", "E2E P7 Eser"],
        ]),
      `AC10 exactly three rows: Zamanında, Geç, Gecikti (${odev.slice(1).map((r) => r[5])})`,
    );
    check(
      !odev.some((r) => r.join(" ").includes("Demo") || r.join(" ").includes("Elif")),
      "AC10 singers the assignment isn't for are not listed",
    );

    // AC11
    const finRoute = await (
      await yk.request.get(`${BASE}/finans/rapor/csv?from=2025-01-01&to=2025-01-31`)
    ).body();
    check(
      att["arkhe-finans-2025-01.csv"]?.equals(finRoute),
      "AC11 the finance attachment is byte-identical to /finans/rapor/csv for January 2025",
    );

    // AC12
    const aidat = csvRows(att["arkhe-aidat-2025-01.csv"] ?? Buffer.alloc(0));
    const aidatRoute = csvRows(
      await (await yk.request.get(`${BASE}/finans/aidat/csv?donem=${ids.period}`)).body(),
    );
    check(
      aidat[0]?.[0] === "Dönem" &&
        JSON.stringify(aidat[0].slice(1)) === JSON.stringify(aidatRoute[0]) &&
        aidat.length > 1 &&
        JSON.stringify(aidat.slice(1)) ===
          JSON.stringify(aidatRoute.slice(1).map((r) => ["E2E Ocak 2025", ...r])),
      `AC12 dues rows equal /finans/aidat/csv with the period prepended (${aidat.length - 1} rows)`,
    );
    await yk.context().close();

    // AC8/12 empty month
    before = outboxSnapshot();
    const empty = await cron("?bugun=2024-02-01");
    mails = newEmails(before);
    created.push(...mails);
    if (mails.length === 1) {
      const e = parseEml(mails[0]);
      const lines0 = e.text.split("\n");
      check(
        empty.json?.status === "sent" &&
          lines0.includes("Çalışma: 0 · Ortalama devam: —") &&
          lines0.includes("Ödev: 0 · Zamanında teslim: —") &&
          lines0.includes(`Gelir: ${kurus(0)} · Gider: ${kurus(0)} · Net: ${kurus(0)}`),
        "AC8 an empty month prints every summary line with zeros and —",
      );
      const csvs = e.attachments.filter((a) => a.filename.endsWith(".csv"));
      const headerOnly = csvs
        .filter((a) => !a.filename.startsWith("arkhe-devam"))
        .every((a) => csvRows(a.data).length === 1);
      const devamZero = csvRows(
        csvs.find((a) => a.filename.startsWith("arkhe-devam"))?.data ?? Buffer.alloc(0),
      )
        .slice(1)
        .every((r) => r[2] === "0" && r[3] === "0");
      check(
        e.attachments.length === 5 && csvs.length === 4 && headerOnly && devamZero,
        "AC8/12 empty month: five attachments; homework, ledger and dues header-only; attendance all zero",
      );
    } else {
      check(false, `AC8 empty month send wrote ${mails.length} .eml (${empty.text})`);
    }

    // AC24
    const errors = (await db.execute("select error from backup_runs where error is not null")).rows;
    check(
      errors.every((r) => !r.error.includes(DEV_CRON_SECRET) && !r.error.includes(DEV_PASSPHRASE)),
      `AC24 no failed row holds a secret value (${errors.length} rows checked)`,
    );

    // AC32
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const keys = [
      "SMTP_USER",
      "SMTP_PASS",
      "SMTP_FROM",
      "SMTP_HOST",
      "SMTP_PORT",
      "BACKUP_PASSPHRASE",
      "CRON_SECRET",
    ];
    check(
      keys.every((k) => example.includes(k)) &&
        !/^SMTP_\w+=/m.test(example) &&
        /^#\s*SMTP_USER=/m.test(example) &&
        example.includes(".env.development"),
      "AC32 .env.example lists the seven keys, SMTP_* commented out, points at .env.development",
    );
    const devEnv = readFileSync(path.join(ROOT, ".env.development"), "utf8");
    const devKeys = devEnv
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .sort();
    check(
      JSON.stringify(devKeys) ===
        JSON.stringify([
          "BACKUP_PASSPHRASE=dev-only-backup-passphrase",
          "CRON_SECRET=dev-only-cron-secret",
        ]) && /^#.*production/im.test(devEnv),
      "AC32 .env.development holds exactly the two dev values and a header comment",
    );
    const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
    check(
      ignore.includes("!.env.development") && ignore.some((l) => /^\/?data\/outbox\/?$/.test(l)),
      "AC32 .gitignore has !.env.development and /data/outbox/",
    );
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    check(
      /--env-file-if-exists=\.env\.development --env-file-if-exists=\.env /.test(pkg.scripts.e2e),
      "AC32 the e2e script loads .env.development before .env",
    );
  } finally {
    removeEmails(created);
    removeEmails(newEmails(startSnapshot));
    await resetBackup();
  }
}
