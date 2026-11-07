// Phase 11 A: the migration, the score PDF, storage bookkeeping, manual vs automatic groups
// (AC 1, 2, 5–8, 29 for the score row, 32, 33).
import { readFileSync } from "node:fs";
import { actionIds, BASE, callAction, check, cleanup, db, loginAs, newPage } from "./lib.mjs";
import { axe, createUser, fileExists, go, insertMidi, layoutIssues, midiBytes, one, PNG, setHook } from "./media.mjs";
import { autoMidi, insertJob, newPiece, pdfBytes, uploadScore } from "./omr.mjs";

const OMR_ACTIONS = "src/app/(portal)/repertuvar/omr-actions.ts";
const DEV_CRON_SECRET = process.env.CRON_SECRET ?? "dev-only-cron-secret";
const TRIGGERS = [
  "budgets_no_overlap_insert",
  "budgets_no_overlap_update",
  "issue_report_images_key_final",
  "issue_report_images_max",
  "issue_report_images_queue_on_delete",
  "midi_files_queue_on_delete",
  "piece_audio_queue_on_delete",
  "piece_scores_queue_on_delete",
  "recordings_audio_final",
  "recordings_queue_on_audio_delete",
  "recordings_queue_on_delete",
];

export default async function run(browser, shots) {
  await cleanup();
  try {
    await suite(browser, shots);
  } finally {
    await db.execute("delete from login_attempts where key like 'score%'");
    await cleanup();
  }
}

const scoreOf = (pieceId) => one("select * from piece_scores where piece_id = ?", [pieceId]);

/** An automatic MIDI row arranged directly (draft or published), with its file. */
async function insertAuto(pieceId, status, names = ["Kadın", "Erkek", "Piyano"]) {
  const { id, key } = await insertMidi(pieceId, { label: "Otomatik", bytes: autoMidi(names) });
  const tracks = JSON.stringify(names.map((name) => ({ name, parts: name === "Kadın" ? ["soprano", "alto"] : name === "Erkek" ? ["tenor", "bass"] : [] })));
  await db.execute({
    sql: `update midi_files set auto = 1, status = ?, tracks_json = ?, measures = 93, duration_sec = 161,
            published_by = case when ? = 'published' then created_by end, published_at = case when ? = 'published' then unixepoch() end
          where id = ?`,
    args: [status, tracks, status, status, id],
  });
  return { id, key };
}

async function suite(browser, shots) {
  // ------------------------------------------------------------------ AC 1
  const triggers = (await db.execute("select name from sqlite_master where type = 'trigger' order by name")).rows.map((r) => r.name);
  const applied = Number((await one("select count(*) as n from __drizzle_migrations")).n);
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries.length;
  check(applied === journal && JSON.stringify(triggers) === JSON.stringify(TRIGGERS), `AC1 every migration applied (${applied}/${journal}); the 0010 triggers plus the score and audio triggers (${triggers})`);
  const seed = await one("select count(*) as n, sum(status = 'published') as p, sum(auto) as a from midi_files where id like '00000000-0000-4000-9100-%'");
  check(Number(seed.n) === 2 && Number(seed.p) === 2 && Number(seed.a) === 0, "AC1 existing MIDI rows read as published, manual");
  const tables = (await db.execute("select sql from sqlite_master where name in ('storage_deletions', 'storage_events')")).rows.map((r) => r.sql).join(" ");
  check(tables.includes("'score'"), "AC1 storage_deletions and storage_events accept the score area");

  const sef = await loginAs(browser, "sef@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");
  const anon = await newPage(browser);
  const piece = await newPiece("E2E Nota Eseri");
  const bare = await newPiece("E2E Notasız Eser");
  const pieceTmp = await newPiece("E2E Nota Silinecek");

  const midiDel = await insertMidi(bare, { bytes: midiBytes({ tracks: [{ name: "x", notes: [[60, 0, 10, 80]] }] }) });
  await db.execute({ sql: "delete from midi_files where id = ?", args: [midiDel.id] });
  check(Boolean(await one("select 1 from storage_deletions where storage_key = ? and area = 'midi'", [midiDel.key])), "AC1 deleting a MIDI row still queues its key");

  // ------------------------------------------------------------------ AC 5 via the editor
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  check((await sef.locator("h2", { hasText: "Nota ve otomatik MIDI" }).count()) === 1, "AC5 the editor has Nota ve otomatik MIDI");
  check(
    (await sef.getByText("En fazla 4 MB, 20 sayfa. Taranmış notada 300 dpi siyah-beyaz en iyi sonucu verir.").count()) === 1,
    "AC5 the help text is the §3 copy",
  );
  await sef.getByTestId("score-file").setInputFiles({ name: "nota.png", mimeType: "application/pdf", buffer: PNG });
  await sef.getByTestId("score-upload").getByRole("button", { name: "Yükle" }).click();
  await sef.getByTestId("score-error").waitFor();
  check((await sef.getByTestId("score-error").textContent()) === "Bu dosya PDF değil.", "AC5 a renamed PNG: Bu dosya PDF değil.");
  await sef.getByTestId("score-file").setInputFiles({ name: "nota.pdf", mimeType: "application/pdf", buffer: pdfBytes(40_000) });
  await sef.getByTestId("score-upload").getByRole("button", { name: "Yükle" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Nota yüklendi." }).waitFor();
  await sef.getByTestId("score-row").waitFor();
  const first = await scoreOf(piece);
  check(first && Number(first.size_bytes) === 40_000 && (await fileExists(first.storage_key)), "AC5 Nota yüklendi.: one row, the file stored under scores/");
  check(/^scores\/[0-9a-f-]{36}\.pdf$/.test(first.storage_key) && !first.storage_key.includes(piece), "AC5 the key is scores/<uuid>.pdf");

  // AC 5 via the route
  const big = Buffer.concat([pdfBytes(4_194_304)]);
  check(big.length === 4_194_304, "AC5 fixture is exactly 4 MB");
  const over = Buffer.concat([big.subarray(0, 4_194_304 - 7), Buffer.from("A\n%%EOF")]);
  const tooBig = await uploadScore(sef, piece, Buffer.concat([over, Buffer.from("x")]));
  check(tooBig.status === 413 && tooBig.json?.error === "PDF en fazla 4 MB olabilir.", `AC5 4 MB + 1 byte → PDF en fazla 4 MB olabilir. (${tooBig.status})`);
  const png = await uploadScore(sef, piece, PNG);
  const noEof = await uploadScore(sef, piece, pdfBytes(5000).subarray(0, 4000));
  check(png.status === 415 && png.json?.error === "Bu dosya PDF değil." && noEof.status === 415, "AC5 the server sniffs too: a PNG and a PDF without %%EOF are refused");
  const noOrigin = await uploadScore(sef, piece, pdfBytes(), { origin: null });
  check(noOrigin.status === 403, "AC5 an upload without Origin is refused");
  const asMember = await uploadScore(korist, piece, pdfBytes());
  check(asMember.status === 403 && (await scoreOf(piece)).id === first.id, "AC2 a member's upload is refused with no change");
  const anonUp = await uploadScore(anon, piece, pdfBytes());
  check(anonUp.status === 401, "AC2 signed out: 401");
  const exact = await uploadScore(sef, piece, big);
  const second = await scoreOf(piece);
  const queuedOld = await one("select area, state from storage_deletions where storage_key = ?", [first.storage_key]);
  check(
    exact.status === 201 && exact.json?.replaced === true && second.id !== first.id && queuedOld?.area === "score" && !(await fileExists(first.storage_key)),
    `AC5/7 Değiştir: exactly 4 MB is accepted, the old key is queued (area score) and deleted (${exact.status}, ${queuedOld?.state})`,
  );

  // AC 5 limits: 30 per hour per manager, the upload pause.
  const sefId = (await one("select id from users where email = 'sef@arkhe.local'")).id;
  await db.execute("delete from login_attempts where key like 'score-upload:%'");
  await db.batch(Array.from({ length: 30 }, () => ({ sql: "insert into login_attempts (key) values (?)", args: [`score-upload:${sefId}`] })), "write");
  const rated = await uploadScore(sef, piece, pdfBytes());
  check(rated.status === 429 && rated.json?.error === "Çok sık yükleme yaptın. Biraz sonra tekrar dene.", "AC5 the 31st upload in an hour is refused");
  await db.execute("delete from login_attempts where key like 'score-upload:%'");
  await db.batch(Array.from({ length: 1900 }, () => ({ sql: "insert into storage_events (kind, area, bytes) values ('put', 'midi', 1)" })), "write");
  const paused = await uploadScore(sef, piece, pdfBytes());
  check(paused.status === 503 && paused.json?.code === "quota", "AC5 the Phase 9 upload pause (95%) applies");
  await db.execute("delete from storage_events where kind = 'put' and bytes = 1");

  // ------------------------------------------------------------------ AC 6
  await go(korist, `${BASE}/repertuvar/${piece}`);
  const row = korist.getByTestId("score-row");
  check((await row.count()) === 1 && (await row.textContent()).includes("Nota (PDF)") && (await row.textContent()).includes("4 MB"), "AC6 korist@ sees Nota (PDF) · size · date");
  check(
    (await row.getByRole("link", { name: "Aç: Nota (PDF)" }).getAttribute("target")) === "_blank" &&
      (await row.getByRole("link", { name: "İndir: Nota (PDF)" }).getAttribute("href")) === `/api/dosya/nota/${second.id}?indir=1`,
    "AC6 Aç opens a new tab; İndir has ?indir=1",
  );
  const gets = Number((await one("select count(*) as n from storage_events where kind = 'get' and area = 'score'")).n);
  const open = await korist.request.get(`${BASE}/api/dosya/nota/${second.id}`, { failOnStatusCode: false });
  const h = open.headers();
  check(
    open.status() === 200 &&
      h["content-type"] === "application/pdf" &&
      h["content-disposition"] === 'inline; filename="E2E-Nota-Eseri-nota.pdf"' &&
      h["x-content-type-options"] === "nosniff" &&
      h["content-security-policy"] === "default-src 'none'; sandbox" &&
      h["cache-control"].startsWith("private"),
    `AC6 Aç: application/pdf, inline with the name, nosniff, CSP sandbox, private (${h["content-disposition"]}, ${h["cache-control"]})`,
  );
  const body = await open.body();
  check(body.length === 4_194_304, "AC6 the whole file is delivered");
  const dl = await korist.request.get(`${BASE}/api/dosya/nota/${second.id}?indir=1`, { failOnStatusCode: false });
  check(dl.headers()["content-disposition"] === 'attachment; filename="E2E-Nota-Eseri-nota.pdf"', "AC6 İndir: attachment");
  const out = await anon.request.get(`${BASE}/api/dosya/nota/${second.id}`, { failOnStatusCode: false });
  check(out.status() === 401, "AC6 signed out: 401");
  const gets2 = Number((await one("select count(*) as n from storage_events where kind = 'get' and area = 'score'")).n);
  check(gets2 === gets + 2, `AC6 deliveries count as transfer (area score: ${gets} → ${gets2})`);
  const [usage] = (await db.execute(`select coalesce(sum(area is null or area = 'recording'), 0) as rr from storage_events where kind = 'get'`)).rows;
  check(Number(usage.rr) === 0, "AC6 score gets never count toward the recording playback stop");
  await go(korist, `${BASE}/repertuvar/${bare}`);
  check((await korist.getByTestId("score-row").count()) === 0, "AC6 a piece without a PDF shows no row");

  // ------------------------------------------------------------------ AC 7: stored bytes, delete, piece delete, sweep
  const stored = Number((await one("select coalesce(sum(size_bytes), 0) as s from piece_scores")).s);
  await go(sef, `${BASE}/odevler/depolama`);
  check(stored >= 4_194_304, "AC7 the stored-bytes meter's query includes piece_scores");
  await uploadScore(sef, pieceTmp, pdfBytes(10_000));
  const tmp = await scoreOf(pieceTmp);
  const pieceActs = await actionIds("src/app/(portal)/repertuvar/actions.ts", pieceTmp);
  await go(sef, `${BASE}/repertuvar/${pieceTmp}`);
  await callAction(sef, pieceActs.deletePiece, [pieceTmp]);
  const tmpQueued = await one("select area, state from storage_deletions where storage_key = ?", [tmp.storage_key]);
  check(tmpQueued?.area === "score" && !(await fileExists(tmp.storage_key)), `AC7 deleting the piece queues the score key and removes the file (${tmpQueued?.state})`);
  // Sweep: a queued key whose inline delete failed goes with the next cron run.
  const omrActs = await actionIds(OMR_ACTIONS, piece);
  const swept = await newPiece("E2E Nota Süpürme");
  await uploadScore(sef, swept, pdfBytes(5000));
  const sweptRow = await scoreOf(swept);
  await go(sef, `${BASE}/repertuvar/${swept}/duzenle`);
  await setHook(sef, "arkhe_e2e_storage_fault", "delete");
  const delRes = await callAction(sef, omrActs.deleteScore, [swept]);
  await setHook(sef, "arkhe_e2e_storage_fault", null);
  const pending = await one("select state from storage_deletions where storage_key = ?", [sweptRow.storage_key]);
  check(delRes.includes("Nota silindi.") && pending?.state === "pending" && (await fileExists(sweptRow.storage_key)), "AC7 Sil with a failing store: the key stays queued");
  await fetch(`${BASE}/api/cron/aylik-yedek`, { headers: { Authorization: `Bearer ${DEV_CRON_SECRET}` } });
  const done = await one("select state from storage_deletions where storage_key = ?", [sweptRow.storage_key]);
  check(done?.state === "done" && !(await fileExists(sweptRow.storage_key)), "AC7 the next sweep deletes it");

  // ------------------------------------------------------------------ AC 8: locked while converting
  const job = await insertJob(piece, { state: "running" });
  const locked = await uploadScore(sef, piece, pdfBytes());
  const lockedDel = await callAction(sef, omrActs.deleteScore, [piece]);
  check(
    locked.status === 409 && locked.json?.error === "Çeviri sürerken nota değiştirilemez." && lockedDel.includes("Çeviri sürerken nota değiştirilemez.") && (await scoreOf(piece)).id === second.id,
    "AC8 Değiştir and Sil are refused while a job is running",
  );
  await db.execute({ sql: "update omr_jobs set state = 'queued', started_at = null where id = ?", args: [job] });
  check((await uploadScore(sef, piece, pdfBytes())).status === 409, "AC8 also while queued");
  await db.execute({ sql: "update omr_jobs set state = 'failed', error_kind = 'unknown', finished_at = unixepoch() where id = ?", args: [job] });

  // ------------------------------------------------------------------ AC 2: member calls
  await go(korist, `${BASE}/repertuvar/${piece}`);
  const draft = await insertAuto(piece, "draft");
  const results = await Promise.all([
    callAction(korist, omrActs.deleteScore, [piece]),
    callAction(korist, omrActs.startOmr, [piece, {}, {}]),
    callAction(korist, omrActs.retryOmr, [job]),
    callAction(korist, omrActs.publishDraft, [draft.id]),
    callAction(korist, omrActs.deleteDraft, [draft.id]),
  ]);
  const draftRow = await one("select status from midi_files where id = ?", [draft.id]);
  const jobs = Number((await one("select count(*) as n from omr_jobs where piece_id = ?", [piece])).n);
  check(
    results.every((r) => r.includes("Bu işlem için yetkin yok.")) && draftRow?.status === "draft" && jobs === 1 && Boolean(await scoreOf(piece)),
    "AC2 korist@'s direct calls (score delete, convert, retry, publish, reject) are refused with no change",
  );
  const draftGet = await korist.request.get(`${BASE}/api/dosya/midi/${draft.id}`, { failOnStatusCode: false });
  const draftMgr = await sef.request.get(`${BASE}/api/dosya/midi/${draft.id}`, { failOnStatusCode: false });
  check(draftGet.status() === 404 && draftMgr.status() === 200, "AC2/18 the draft download: 404 for a member, 200 for a manager");
  await korist.goto(`${BASE}/repertuvar/${piece}/duzenle`);
  await korist.waitForURL((u) => !u.pathname.endsWith("/duzenle"), { timeout: 8000 }).catch(() => {});
  check(!korist.url().endsWith("/duzenle"), "AC2 korist@ can't open the editor");
  // Inactive users get nothing.
  await createUser("pasifnota@e2e.test", "E2E Pasif Yönetim", { role: "board" });
  const inactive = await loginAs(browser, "pasifnota@e2e.test");
  await db.execute("update users set is_active = 0, left_at = unixepoch() where email = 'pasifnota@e2e.test'");
  const r1 = await inactive.request.get(`${BASE}/api/dosya/nota/${second.id}`, { failOnStatusCode: false });
  const r2 = await uploadScore(inactive, piece, pdfBytes());
  check(r1.status() === 401 && r2.status === 401, "AC2 an inactive user gets 401 on the PDF and the upload");
  await inactive.context().close();
  await db.execute({ sql: "delete from midi_files where id = ?", args: [draft.id] });

  // ------------------------------------------------------------------ AC 32: manual uploads are independent
  for (let i = 0; i < 19; i++) await insertMidi(piece, { bytes: midiBytes({ tracks: [{ name: "x", notes: [[60, 0, 10, 80]] }] }) });
  const pub = await insertAuto(piece, "published");
  const dr = await insertAuto(piece, "draft");
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  check((await sef.getByTestId("midi-upload").count()) === 1, "AC32 with 19 manual + automatic files the upload form still shows");
  const file = async (name) => {
    await sef.getByTestId("midi-file").setInputFiles({ name, mimeType: "audio/midi", buffer: midiBytes({ tracks: [{ name: "Tutti", notes: [[60, 0, 100, 80]] }] }) });
    await sef.getByTestId("midi-upload").getByRole("button", { name: "Yükle" }).click();
  };
  await file("yirminci.mid");
  await sef.locator("[data-sonner-toast]", { hasText: "Dosya yüklendi." }).waitFor();
  const manualN = Number((await one("select count(*) as n from midi_files where piece_id = ? and auto = 0", [piece])).n);
  check(manualN === 20, "AC32 the 20th manual file is accepted");
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  check(
    (await sef.locator("text=Bir esere en fazla 20 MIDI dosyası eklenebilir.").count()) === 1,
    "AC32 at 20 manual files the editor is full",
  );
  // The 21st: the form opened at 19, a 20th arrives meanwhile, the server's pre-check refuses.
  const extra = (await one("select id from midi_files where piece_id = ? and auto = 0 and label is null and voice_part is null order by created_at desc limit 1", [piece])).id;
  await db.execute({ sql: "delete from midi_files where id = ?", args: [extra] });
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  await insertMidi(piece, { bytes: midiBytes({ tracks: [{ name: "x", notes: [[60, 0, 10, 80]] }] }) });
  await file("yirmibirinci.mid");
  await sef.locator("[data-sonner-toast]", { hasText: "Bir esere en fazla 20 MIDI dosyası eklenebilir." }).waitFor();
  check(
    Number((await one("select count(*) as n from midi_files where piece_id = ? and auto = 0", [piece])).n) === 20,
    "AC32 the 21st manual file gets MSG.midiTooMany (the server counts manual files only)",
  );
  const manualTutti = await one("select id from midi_files where piece_id = ? and auto = 0 and voice_part is null limit 1", [piece]);
  const manualBefore = (await db.execute({ sql: "select id, label, voice_part from midi_files where piece_id = ? and auto = 0 order by id", args: [piece] })).rows;
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  await sef.locator(`[data-midi-draft="${dr.id}"]`).getByRole("button", { name: "Yayınla" }).click();
  await sef.getByRole("alertdialog").getByText("Önceki otomatik MIDI silinip yerine bu gelecek.").waitFor();
  await sef.getByRole("alertdialog").getByRole("button", { name: "Yayınla" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Yayınlandı; koristler artık görüyor." }).waitFor();
  const manualAfter = (await db.execute({ sql: "select id, label, voice_part from midi_files where piece_id = ? and auto = 0 order by id", args: [piece] })).rows;
  check(
    JSON.stringify(manualAfter) === JSON.stringify(manualBefore) && !(await one("select 1 from midi_files where id = ?", [pub.id])),
    "AC32 publishing replaces the automatic file and never touches a manual one",
  );
  check(Boolean(manualTutti), "AC32 a manual Tutti file exists next to the automatic one");
  const storedAll = Number((await one("select coalesce(sum(size_bytes), 0) as s from midi_files where piece_id = ?", [piece])).s);
  check(storedAll > 0, "AC32 storage still counts every file");

  // ------------------------------------------------------------------ AC 33: separate, labelled groups
  await go(korist, `${BASE}/repertuvar/${piece}?partisyon=tumu`);
  const autoGroup = korist.getByTestId("midi-auto");
  check(
    (await autoGroup.count()) === 1 &&
      (await autoGroup.locator("h2").textContent()) === "Otomatik oluşturulan" &&
      (await autoGroup.getByText("Otomatik", { exact: true }).count()) === 1 &&
      (await autoGroup.textContent()).includes("Nota PDF'inden otomatik oluşturuldu ·") &&
      (await korist.getByTestId("midi-list").locator(`[data-midi-button="${dr.id}"]`).count()) === 0,
    "AC33 the automatic file is under Otomatik oluşturulan with the Otomatik badge, never in MIDI",
  );
  await go(korist, `${BASE}/repertuvar/${piece}?partisyon=bas`);
  check((await korist.getByTestId("midi-auto").count()) === 1, "AC33/D118 the part filter never hides the automatic file");
  const onlyAuto = await newPiece("E2E Yalnız Otomatik");
  await insertAuto(onlyAuto, "published");
  await go(korist, `${BASE}/repertuvar/${onlyAuto}`);
  check((await korist.getByTestId("midi-auto").count()) === 1 && (await korist.getByTestId("midi-list").count()) === 0, "AC33 only an automatic file: only that group");
  await go(korist, `${BASE}/repertuvar/${bare}`);
  check((await korist.getByTestId("midi-auto").count()) === 0 && (await korist.getByTestId("midi-list").count()) === 0, "AC33 neither: neither group");
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  check(
    (await sef.getByTestId("midi-auto").count()) === 1 &&
      (await sef.getByTestId("midi-auto").getByTestId("auto-published").textContent()).startsWith("Otomatik · Demo Şef yayınladı ·"),
    `AC19/33 the editor's automatic group: Otomatik · {ad} yayınladı · {tarih} (${await sef.getByTestId("auto-published").textContent()})`,
  );
  check(
    (await sef.getByText("Otomatik oluşturulan MIDI elle eklediklerini etkilemez.").count()) === 1,
    "AC33 the manual group's help line",
  );

  // ------------------------------------------------------------------ AC 29 (score row, piece page, editor)
  for (const colorScheme of ["light", "dark"]) {
    const k = await loginAs(browser, "korist@arkhe.local", { phone: true, context: { colorScheme } });
    await go(k, `${BASE}/repertuvar/${piece}?partisyon=tumu`);
    const found = [...(await axe(k, "main")), ...(await layoutIssues(k))];
    if (shots) await k.screenshot({ path: `${shots}/p11-piece-375-${colorScheme}.png`, fullPage: true });
    const s = await loginAs(browser, "sef@arkhe.local", { phone: true, context: { colorScheme } });
    await go(s, `${BASE}/repertuvar/${piece}/duzenle`);
    found.push(...(await axe(s, "#nota-ve-midi")), ...(await axe(s, "#midi-dosyalari")), ...(await layoutIssues(s, "#nota-ve-midi")), ...(await layoutIssues(s, "[data-testid=midi-auto]")));
    if (shots) await s.screenshot({ path: `${shots}/p11-editor-375-${colorScheme}.png`, fullPage: true });
    check(found.length === 0, `AC29 piece page and editor at 375 ${colorScheme}: clean (${found.slice(0, 4)})`);
    await k.context().close();
    await s.context().close();
  }
}
