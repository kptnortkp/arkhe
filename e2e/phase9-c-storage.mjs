// Phase 9 S7/S8: retention through the daily cron, every delete path, the storage gauge, the
// quota guard and the conductor's early clean.
import { readFile } from "node:fs/promises";
import { HOMEWORK_IDS, seedHomework } from "../scripts/homework-fixture.mjs";
import { reconcileLocalUploads } from "../scripts/media-fixture.mjs";
import { actionIds, BASE, callAction, check, cleanup, consoleErrors, db, loginAs, userId } from "./lib.mjs";
import { cron, DEV_CRON_SECRET } from "./mail.mjs";
import {
  addDays,
  ago,
  all,
  auditDay,
  axe,
  createUser,
  currentTake,
  fileExists,
  go,
  insertAssignment,
  insertNote,
  insertTake,
  istanbulDay,
  layoutIssues,
  longMidi,
  launchWithMic,
  micPage,
  one,
  setHook,
  uploadRaw,
  wavBytes,
} from "./media.mjs";

const { a: A, b: B } = HOMEWORK_IDS;
const D20 =
  "Kayıt alanı şu an dolu; yükleme geçici olarak kapalı. Kaydın kaybolmadı: Kaydı indir ile telefonuna kaydet, sonra şefe başka yolla gönder.";

async function reset() {
  const e2e = "select id from assignments where piece_id in (select id from pieces where title like 'E2E%')";
  await db.batch(
    [
      `delete from assistant_notes where assignment_id in (${e2e})`,
      `delete from recordings where assignment_id in (${e2e})`,
      `delete from submissions where assignment_id in (${e2e})`,
      `delete from assignment_parts where assignment_id in (${e2e})`,
      `delete from assignments where id in (${e2e})`,
      "delete from midi_files where piece_id in (select id from pieces where title like 'E2E%')",
      "delete from pieces where title like 'E2E%'",
    ],
    "write",
  );
  await seedHomework(db, new Date());
  await db.batch(
    [
      "delete from storage_deletions",
      "delete from storage_events",
      "delete from storage_sweeps",
      "delete from login_attempts where key like 'upload:%' or key like 'listen:%' or key like 'midi%'",
    ],
    "write",
  );
  await reconcileLocalUploads(db);
}

/** In-flight holds count toward stored bytes (quota.ts), so they fill the meter without files. */
async function fillStorage(bytes) {
  const rows = [];
  for (let left = bytes; left > 0; left -= 4_194_304) {
    rows.push({
      sql: "insert into storage_deletions (storage_key, area, size_bytes, not_before) values (?, 'recording', ?, unixepoch() + 3600)",
      args: [`recordings/${crypto.randomUUID()}.wav`, Math.min(left, 4_194_304)],
    });
  }
  await db.batch(rows, "write");
}
async function addEvents(kind, n, bytes = 1) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ sql: "insert into storage_events (kind, bytes) values (?, ?)", args: [kind, bytes] });
  for (let i = 0; i < rows.length; i += 500) await db.batch(rows.slice(i, i + 500), "write");
}
async function storedBytes() {
  return Number(
    (
      await one(`select (select coalesce(sum(size_bytes), 0) from recordings where audio_deleted_at is null)
        + (select coalesce(sum(size_bytes), 0) from midi_files)
        + (select coalesce(sum(size_bytes), 0) from storage_deletions where state = 'pending') as s`)
    ).s,
  );
}
async function cronWithFault(fault) {
  const res = await fetch(`${BASE}/api/cron/aylik-yedek`, {
    headers: { Authorization: `Bearer ${DEV_CRON_SECRET}`, Cookie: `arkhe_e2e_storage_fault=${fault}` },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(page, path) {
  const r = await page.request.get(`${BASE}${path}`, { failOnStatusCode: false });
  return { status: r.status(), body: await r.text() };
}

export default async function run(browser, shots) {
  await cleanup();
  try {
    await suite(browser, shots);
  } finally {
    await cleanup();
  }
}

async function suite(browser, shots) {
  const sef = await loginAs(browser, "sef@arkhe.local");
  const yk = await loginAs(browser, "yk@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");
  const asistan = await loginAs(browser, "asistan@arkhe.local");
  const koristId = await userId("korist@arkhe.local");
  const asistanId = await userId("asistan@arkhe.local");
  const today = istanbulDay(Math.floor(Date.now() / 1000));

  // ------------------------------------------------------------------ AC 38, 39, 41
  const commented = await insertTake({
    assignmentId: A,
    email: "korist@arkhe.local",
    uploadedAt: ago(100),
    commentedAt: ago(91),
    deleteOn: addDays(today, -1),
  });
  await insertNote(A, koristId, asistanId, "E2E retention notu");
  await db.execute({
    sql: "update submissions set feedback = 'E2E kalıcı yorum', feedback_by = (select id from users where email = 'sef@arkhe.local'), feedback_at = ? where assignment_id = ? and user_id = ?",
    args: [ago(91), A, koristId],
  });
  const old1 = await insertAssignment({ dueDays: -125 });
  const old2 = await insertAssignment({ dueDays: -122 });
  const t121 = await insertTake({ assignmentId: old1.id, email: "korist@arkhe.local", uploadedAt: ago(121) });
  const t119 = await insertTake({ assignmentId: old2.id, email: "korist@arkhe.local", uploadedAt: ago(119) });
  const sweepsBefore = Number((await one("select count(*) as n from storage_sweeps")).n);
  const run1 = await cron("");
  const r38 = await one("select audio_deleted_at, deleted_reason from recordings where id = ?", [commented.id]);
  check(
    !(await fileExists(commented.key)) && r38.audio_deleted_at !== null && r38.deleted_reason === "retention",
    "AC38 the cron deletes the file of a take whose delete_on was yesterday",
  );
  const kept = await one("select feedback from submissions where assignment_id = ? and user_id = ?", [A, koristId]);
  const notes = await one("select count(*) as n from assistant_notes where assignment_id = ? and singer_id = ?", [A, koristId]);
  check(kept.feedback === "E2E kalıcı yorum" && Number(notes.n) === 1, "AC38 the submission, the comment and the notes stay");
  await go(korist, `${BASE}/odevler/${A}`);
  const gone = `Ses dosyası silindi (${auditDay(today)}). Yorumlar duruyor.`;
  check(
    (await korist.getByTestId("audio-gone").textContent()).trim() === gone &&
      (await korist.getByRole("button", { name: "Kaydını dinle" }).count()) === 0,
    `AC38 korist@ sees "${gone}" and no Dinle`,
  );
  await go(sef, `${BASE}/odevler/${A}/dinle/${koristId}`);
  check(
    (await sef.getByTestId("audio-gone").count()) === 1 && (await sef.locator("[data-testid=assistant-note]").count()) === 1,
    "AC38 sef@'s review page shows the same, with the notes",
  );
  check((await get(korist, `/api/dosya/kayit/${commented.id}`)).status === 410, "AC38 the route answers 410");
  check(
    !(await fileExists(t121.key)) && (await fileExists(t119.key)),
    "AC39 the 121-day uncommented take goes, the 119-day one stays",
  );
  const sweep = await one("select * from storage_sweeps order by id desc limit 1");
  check(
    JSON.stringify(Object.keys(run1.json ?? {})) === '["status"]' &&
      Number((await one("select count(*) as n from storage_sweeps")).n) === sweepsBefore + 1 &&
      Number(sweep.deleted) >= 2,
    `AC41 the cron reply is exactly {status}; the sweep wrote its row (${sweep.deleted} deleted)`,
  );
  await go(sef, `${BASE}/odevler/depolama`);
  check(
    (await sef.getByTestId("last-sweep").textContent()).endsWith(` · ${sweep.deleted} dosya silindi`),
    "AC41 /odevler/depolama shows Son temizlik: <tarih> · <n> dosya silindi",
  );

  // ------------------------------------------------------------------ AC 40 (+ AC 41 with the delete fault)
  await reset();
  const victim = await insertTake({ assignmentId: B, email: "korist@arkhe.local", uploadedAt: ago(0, 2) });
  await setHook(sef, "arkhe_e2e_storage_fault", "delete");
  await go(sef, `${BASE}/odevler/${B}/dinle/${koristId}`);
  await sef.getByRole("button", { name: "Kaydı sil" }).click();
  const dlg = sef.getByRole("alertdialog");
  check(
    (await dlg.textContent()).includes('"Demo Korist" kaydı silinsin mi?') &&
      (await dlg.textContent()).includes("Ses dosyası hemen silinir. Teslim, notlar ve yorum kalır."),
    "AC40 the conductor's Kaydı sil confirm (D48)",
  );
  await dlg.getByRole("button", { name: "Sil" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Ses dosyası silindi." }).waitFor();
  const q = await one("select state, last_error from storage_deletions where storage_key = ?", [victim.key]);
  const subB = await one("select submitted_at from submissions where assignment_id = ? and user_id = ?", [B, koristId]);
  check(
    (await fileExists(victim.key)) && q?.state === "pending" && q.last_error === "fault" && subB?.submitted_at !== null,
    "AC40 with the delete fault the action succeeds, the file stays queued, the submission stays",
  );
  await setHook(sef, "arkhe_e2e_storage_fault", null);
  const sweeps41 = Number((await one("select count(*) as n from storage_sweeps")).n);
  const faulted = await cronWithFault("delete");
  check(
    faulted.status === 200 &&
      JSON.stringify(Object.keys(faulted.json ?? {})) === '["status"]' &&
      Number((await one("select count(*) as n from storage_sweeps")).n) === sweeps41 + 1,
    `AC41 with the delete fault the cron still answers exactly {status} and records a sweep (${faulted.json?.status})`,
  );
  check(await fileExists(victim.key), "AC41 the faulted sweep leaves the file queued");
  await cron("");
  check(!(await fileExists(victim.key)), "AC40 the next sweep removes it");

  // Deleting a homework with takes: the confirm names them, the files go.
  const hw = await insertAssignment({ dueDays: 5 });
  const h1 = await insertTake({ assignmentId: hw.id, email: "korist@arkhe.local" });
  await go(sef, `${BASE}/odevler/${hw.id}`);
  await sef.getByRole("button", { name: "Diğer işlemler" }).click();
  await sef.getByRole("menuitem", { name: "Sil" }).click();
  const del = sef.getByRole("alertdialog");
  check(
    (await del.textContent()).includes("1 teslim kaydı, 1 ses kaydı ve notlar da silinir."),
    "AC40 the homework delete confirm says <n> teslim kaydı, <k> ses kaydı ve notlar da silinir.",
  );
  await del.getByRole("button", { name: "Sil" }).click();
  await sef.waitForURL(`${BASE}/odevler`);
  check(!(await fileExists(h1.key)), "AC40 deleting the homework deletes its audio");

  // ------------------------------------------------------------------ AC 43
  await reset();
  await go(sef, `${BASE}/odevler/depolama`);
  const used = await storedBytes();
  const meterNow = await sef.locator("[data-key=storage] [role=meter]").getAttribute("aria-valuenow");
  const counts = await one(`select (select count(*) from storage_events where kind = 'put' and at > unixepoch() - 2592000) as u,
    (select count(*) from storage_events where kind = 'get' and at > unixepoch() - 2592000) as r,
    (select 2 * coalesce(sum(bytes), 0) from storage_events where kind = 'get' and at > unixepoch() - 2592000) as t`);
  const valueNow = async (key) => Number(await sef.locator(`[data-key=${key}] [role=meter]`).getAttribute("aria-valuenow"));
  check(
    Number(meterNow) === Math.floor((used / 1e9) * 100) &&
      (await valueNow("uploads")) === Math.floor((Number(counts.u) / 2000) * 100) &&
      (await valueNow("reads")) === Math.floor((Number(counts.r) / 10000) * 100) &&
      (await valueNow("transfer")) === Math.floor((Number(counts.t) / 1e10) * 100),
    "AC43 the four meters match SQL over our tables",
  );
  const value = (await sef.locator("[data-key=storage] [data-testid=meter-value]").textContent()).trim();
  check(/^[\d,.]+ (KB|MB|GB) \/ 1 GB$/.test(value), `AC43 format <used> / <limit>, the percentage only once at the top (${value})`);
  check(
    (await sef.locator("text=Kayıtlar şef yorumundan 90 gün sonra, yorumsuz kayıtlar yüklendikten 120 gün sonra kendiliğinden silinir.").count()) === 1 &&
      (await sef.locator("text=Sayılar portalın kendi kayıtlarından hesaplanır; Vercel panelindeki değerlerle küçük farklar olabilir.").count()) === 1,
    "AC43 the D19 explanation lines",
  );
  await go(yk, `${BASE}/odevler/depolama`);
  check((await yk.locator("[role=meter]").count()) === 4, "AC43 yk@ sees the gauge too");
  for (const [who, p] of [["korist", korist], ["asistan", asistan]]) {
    await p.goto(`${BASE}/odevler/depolama`);
    await p.waitForURL((u) => u.pathname !== "/odevler/depolama", { timeout: 8000 }).catch(() => {});
    check(p.url() === `${BASE}/odevler`, `AC43 ${who}@ is redirected to /odevler`);
  }

  // ------------------------------------------------------------------ AC 44
  await fillStorage(810_000_000 - (await storedBytes()) + 1_000_000);
  for (const [who, p] of [["sef", sef], ["yk", yk]]) {
    for (const path of ["/odevler", "/"]) {
      await go(p, `${BASE}${path}`);
      const b = p.getByTestId("storage-banner");
      check(
        (await b.count()) === 1 && (await b.textContent()).includes("Kayıt alanı %81 dolu. Depolama sayfasına bak."),
        `AC44 ${who}@ sees the 81% banner on ${path}`,
      );
    }
  }
  await go(korist, `${BASE}/odevler`);
  check((await korist.getByTestId("storage-banner").count()) === 0, "AC44 korist@ doesn't");
  await go(sef, `${BASE}/odevler/depolama`);
  const warn = sef.locator("[data-key=storage]");
  check(
    (await warn.getAttribute("data-state")) === "warn" && (await warn.textContent()).includes("Dolmak üzere"),
    "AC44 the Depolama meter shows the warning state with text",
  );
  if (shots) await sef.screenshot({ path: `${shots}/p9-depolama-1280.png`, fullPage: true });

  // ------------------------------------------------------------------ AC 45
  await fillStorage(950_000_000 - (await storedBytes()) + 1_000_000);
  const rows45 = Number((await one("select count(*) as n from recordings")).n);
  const refused = await uploadRaw(korist, B, wavBytes({ seconds: 1 }));
  check(
    refused.status === 503 && refused.json?.code === "quota" && refused.json.error === D20 &&
      Number((await one("select count(*) as n from recordings")).n) === rows45,
    "AC45 at 95% storage korist@'s upload is refused with the D20 message; nothing written",
  );
  const micBrowser = await launchWithMic();
  const mic = await micPage(micBrowser.browser, "korist@arkhe.local", { phone: true });
  await go(mic, `${BASE}/odevler/${B}`);
  check(
    (await mic.locator("#baska-yolla").evaluate((d) => d.open)) &&
      (await mic.getByTestId("uploads-paused").count()) === 1 &&
      (await mic.getByRole("button", { name: "Dosya yükle" }).count()) === 0,
    "AC45 the fallback disclosure is open, the paused note shows, Dosya yükle is hidden",
  );
  await mic.getByRole("button", { name: "Kayda başla" }).click();
  await mic.waitForFunction(() => document.querySelector("[data-recorder]")?.dataset.state === "recording", null, { timeout: 15000 });
  await mic.waitForTimeout(1500);
  await mic.getByRole("button", { name: "Kaydı durdur" }).click();
  await mic.waitForFunction(() => document.querySelector("[data-recorder]")?.dataset.state === "recorded");
  check(
    (await mic.getByTestId("take-download").count()) === 1 && (await mic.getByRole("button", { name: "Kaydı gönder" }).count()) === 0,
    "AC45 the in-page take offers Kaydı indir instead of Gönder",
  );
  await micBrowser.close();
  const ave = (await one("select id from pieces where title = 'Ave Verum Corpus'")).id;
  await go(sef, `${BASE}/repertuvar/${ave}/duzenle`);
  await sef.getByTestId("midi-file").setInputFiles({ name: "tenor.mid", mimeType: "audio/midi", buffer: longMidi({ seconds: 4 }) });
  await sef.getByTestId("midi-upload").getByRole("button", { name: "Yükle" }).click();
  await sef.locator("[data-testid=midi-upload] [role=alert]", { hasText: "Dosya alanı dolu; yeni dosya yüklenemiyor." }).waitFor();
  check(true, "AC45 a MIDI upload by sef@ is refused with Dosya alanı dolu; yeni dosya yüklenemiyor.");
  const seededTake = await currentTake(HOMEWORK_IDS.d, "melis.aydin@arkhe.local");
  check((await get(sef, `/api/dosya/kayit/${seededTake.id}`)).status === 200, "AC45 listening still works");
  await db.execute("delete from storage_deletions");
  await addEvents("put", 1900);
  const byCount = await uploadRaw(korist, B, wavBytes({ seconds: 1 }));
  check(byCount.status === 503 && byCount.json?.code === "quota", "AC45 the same at 95% of the upload count");
  await db.execute("delete from storage_events");

  // ------------------------------------------------------------------ AC 46
  await addEvents("get", 1193, 4_194_304);
  const playSef = await sef.request.get(`${BASE}/api/dosya/kayit/${seededTake.id}`, { failOnStatusCode: false });
  const midi = await get(korist, `/api/dosya/midi/00000000-0000-4000-9100-000000000001`);
  check(
    playSef.status() === 503 && (await playSef.json()).code === "quota" && midi.status === 200,
    "AC46 at 100% transfer recording playback is refused (quota); MIDI still plays",
  );
  await go(sef, `${BASE}/odevler/${HOMEWORK_IDS.d}/dinle/${await userId("melis.aydin@arkhe.local")}`);
  check(
    (await sef.locator("text=Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).").count()) >= 1 &&
      (await sef.getByRole("button", { name: "Kaydı dinle" }).isDisabled()),
    "AC46 the player says Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).",
  );
  await db.execute("delete from storage_events");
  // The provoked 503s are part of the arrangement.
  for (let i = consoleErrors.length - 1; i >= 0; i--) {
    if (consoleErrors[i].includes("status of 503")) consoleErrors.splice(i, 1);
  }

  // ------------------------------------------------------------------ AC 48
  await reset();
  const singers = [];
  for (let i = 0; i < 3; i++) singers.push(await createUser(`erken${i}@e2e.test`, `E2E Erken ${i}`));
  const hw48 = await insertAssignment({ dueDays: -40 });
  const mk = async (i, commentDays) => {
    const t = await insertTake({
      assignmentId: hw48.id,
      email: `erken${i}@e2e.test`,
      uploadedAt: ago(45),
      commentedAt: commentDays === null ? null : ago(commentDays),
    });
    if (commentDays !== null) {
      await db.execute({
        sql: "update submissions set feedback = 'E2E erken', feedback_by = (select id from users where email = 'sef@arkhe.local'), feedback_at = ? where assignment_id = ? and user_id = ?",
        args: [ago(commentDays), hw48.id, t.user],
      });
    }
    return t;
  };
  const e31 = await mk(0, 31);
  const e29 = await mk(1, 29);
  const eNone = await mk(2, null);
  await go(sef, `${BASE}/odevler/depolama`);
  const early = sef.getByRole("button", { name: /^Yorumlanmış kayıtlardan 30 günden eskileri şimdi sil \(1 kayıt, / });
  check((await early.count()) === 1, "AC48 sef@ sees the early-clean button (1 kayıt, <MB>)");
  await go(yk, `${BASE}/odevler/depolama`);
  check((await yk.locator("#yer-ac").count()) === 0, "AC48 yk@ doesn't");
  const depAct = await actionIds("src/app/(portal)/odevler/depolama/actions.ts", "x");
  check((await callAction(yk, depAct.earlyClean, [])).includes("Bu işlem için yetkin yok."), "AC48 the action refuses yk@");
  await early.click();
  await sef.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "kayıt silindi." }).waitFor();
  const r48 = await all("select id, deleted_reason from recordings where id in (?, ?, ?)", [e31.id, e29.id, eNone.id]);
  const by = Object.fromEntries(r48.map((r) => [r.id, r.deleted_reason]));
  check(
    by[e31.id] === "early" && by[e29.id] === null && by[eNone.id] === null &&
      !(await fileExists(e31.key)) && (await fileExists(e29.key)) &&
      (await one("select feedback from submissions where assignment_id = ? and user_id = ?", [hw48.id, e31.user])).feedback === "E2E erken",
    "AC48 exactly the take commented 31 days ago loses its audio; younger and uncommented keep theirs; the comment stays",
  );

  // ------------------------------------------------------------------ AC 58
  await reset();
  const many = [];
  for (let i = 0; i < 40; i++) many.push(await createUser(`yuk${i}@e2e.test`, `E2E Yük ${String(i).padStart(2, "0")}`, { part: i % 2 ? "alto" : "soprano" }));
  const helper = await createUser("yukasist@e2e.test", "E2E Yük Asistan", { part: "tenor" });
  const hws = [];
  for (let k = 0; k < 5; k++) hws.push((await insertAssignment({ dueDays: k + 1, title: `E2E Yük ${k}` })).id);
  const stmts = [];
  for (const hwId of hws) {
    for (const u of many) {
      const rid = crypto.randomUUID();
      const up = ago(1);
      stmts.push(
        {
          sql: "insert into submissions (assignment_id, user_id, submitted_at, method) values (?, ?, ?, 'self')",
          args: [hwId, u, up],
        },
        {
          sql: "insert into recordings (id, assignment_id, user_id, storage_key, content_type, size_bytes, duration_ms, uploaded_at, delete_on) values (?, ?, ?, ?, 'audio/wav', 48044, 3000, ?, ?)",
          args: [rid, hwId, u, `recordings/${crypto.randomUUID()}.wav`, up, addDays(today, 119)],
        },
        ...[asistanId, helper].map((a) => ({
          sql: "insert into assistant_notes (assignment_id, singer_id, assistant_id, recording_id, body, created_at, updated_at) values (?, ?, ?, ?, 'E2E yük notu', ?, ?)",
          args: [hwId, u, a, rid, up, up],
        })),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400), "write");
  // Dev mode compiles and garbage-collects at random moments: warm up, then take the best of three.
  const timed = async (page, path) => {
    await page.request.get(`${BASE}${path}`);
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await page.request.get(`${BASE}${path}`);
      best = Math.min(best, Date.now() - t0);
    }
    return best;
  };
  const tq = await timed(sef, "/odevler/dinle");
  const ta = await timed(asistan, "/odevler/dinle");
  const tg = await timed(sef, "/odevler/depolama");
  check(tq < 1000 && ta < 1000 && tg < 1000, `AC58 with 200 takes and 400 notes: queue ${tq} ms, assistant ${ta} ms, depolama ${tg} ms`);

  // ------------------------------------------------------------------ AC 42 (README), AC 57
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  check(
    readme.includes("Ses kayıtları ve MIDI dosyaları bu yedeğe dahil değildir; kayıtlar 90 gün sonra zaten silinir."),
    "AC42 the README's backup section has the D22 sentence",
  );
  await reset();
  for (const colorScheme of ["light", "dark"]) {
    const p = await loginAs(browser, "sef@arkhe.local", { phone: true, context: { colorScheme } });
    await go(p, `${BASE}/odevler/depolama`);
    const issues = [...(await axe(p, "main")), ...(await layoutIssues(p))];
    if (shots) await p.screenshot({ path: `${shots}/p9-depolama-375-${colorScheme}.png`, fullPage: true });
    check(issues.length === 0, `AC57 /odevler/depolama at 375 ${colorScheme}: clean (${issues.slice(0, 4)})`);
    await p.context().close();
  }
  for (const p of [sef, yk, korist, asistan]) await p.context().close();
}
