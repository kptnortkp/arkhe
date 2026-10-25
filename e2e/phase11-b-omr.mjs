// Phase 11 B: conversion jobs, the signed workflow endpoints, drafts, publishing, the publish push,
// MIDI precedence and the workflow file (AC 3, 4, 9–15, 17–21, 26, 31).
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { actionIds, BASE, callAction, check, cleanup, db, istanbulDate, loginAs } from "./lib.mjs";
import { callForm } from "./board.mjs";
import { createUser, fileExists, go, insertAssignment, insertMidi, midiBytes, one, setHook } from "./media.mjs";
import {
  autoMidi,
  clearOutbox,
  insertJob,
  jobRow,
  latestJobOf,
  machine,
  newPiece,
  outboxEntry,
  pdfBytes,
  resultBody,
  ROOT,
  uploadScore,
} from "./omr.mjs";
import { addDevice, at, dispatch, outboxSince, removeOutbox, resetPush, setPref, until } from "./push.mjs";

const OMR_ACTIONS = "src/app/(portal)/repertuvar/omr-actions.ts";
const TITLE = "E2E OMR Eseri";
const PUSH_BODY = `${TITLE}: çalışma MIDI'si hazır. Kendi sesini seçip dinleyebilirsin.`;

export default async function run(browser, shots) {
  await cleanup();
  await resetPush();
  clearOutbox();
  try {
    await suite(browser, shots);
  } finally {
    clearOutbox();
    await resetPush();
    await db.execute("delete from login_attempts where key like 'score%'");
    await cleanup();
  }
}

const tracksOf = (names) =>
  JSON.stringify(
    names.map((name) => ({
      name,
      parts:
        name === "Kadın" ? ["soprano", "alto"] : name === "Erkek" ? ["tenor", "bass"] : { Soprano: ["soprano"], Alto: ["alto"], Tenor: ["tenor"], Bas: ["bass"] }[name] ?? [],
    })),
  );

/** An automatic MIDI row arranged directly, with its file. */
async function insertAuto(pieceId, status, names = ["Kadın", "Erkek", "Piyano"]) {
  const { id, key } = await insertMidi(pieceId, { label: "Otomatik", bytes: autoMidi(names) });
  await db.execute({
    sql: `update midi_files set auto = 1, status = ?, tracks_json = ?, measures = 12, duration_sec = 10,
            published_by = case when ? = 'published' then created_by end, published_at = case when ? = 'published' then unixepoch() end
          where id = ?`,
    args: [status, tracksOf(names), status, status, id],
  });
  return { id, key };
}

const state = (page) => page.locator("[data-omr-state]");

async function suite(browser, shots) {
  const sef = await loginAs(browser, "sef@arkhe.local");
  const yk = await loginAs(browser, "yk@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");
  const piece = await newPiece(TITLE);
  const pdf = pdfBytes(30_000);
  check((await uploadScore(sef, piece, pdf)).status === 201, "setup: the score is uploaded");
  const acts = await actionIds(OMR_ACTIONS, piece);

  // ------------------------------------------------------------------ AC 9
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  const form = sef.getByTestId("omr-form");
  check(
    (await form.locator("legend", { hasText: "Satır düzeni" }).count()) === 1 &&
      (await form.getByLabel("Altta piyano eşliği var").isChecked()) &&
      (await form.getByText("Boş bırakırsan notadaki tempo, o da yoksa 100.").count()) === 1 &&
      (await form.getByText("Genelde 3–8 dakika sürer.", { exact: false }).count()) === 1,
    "AC9 the convert form: Satır düzeni legend, piano on by default, the §3 help",
  );
  await form.getByRole("button", { name: "MIDI'ye çevir" }).click();
  await sef.locator("#layout-error").waitFor();
  check(
    (await sef.locator("#layout-error").textContent()) === "Satır düzenini seç." && !(await latestJobOf(piece)),
    "AC9 a missing layout is a field error; no job",
  );
  await form.getByLabel("Kadın ve Erkek (iki satır)").check();
  await form.getByRole("button", { name: "MIDI'ye çevir" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Çeviri başladı." }).waitFor();
  const job = (await latestJobOf(piece)).id;
  const entry = outboxEntry(job);
  check(
    JSON.stringify(entry) === JSON.stringify({ ref: "main", inputs: { job_id: job, layout: "kadin_erkek", piano: "true", tempo: "" } }),
    `AC9 the outbox file is exactly { ref, inputs } (${JSON.stringify(entry)})`,
  );
  check(!/http|secret|token|dev-only/i.test(JSON.stringify(entry)), "AC9 no URL, token or secret in the dispatch");
  await state(sef).waitFor();
  check((await state(sef).getAttribute("data-omr-state")) === "queued" && (await state(sef).textContent()) === "Sırada…", "AC9 the status line: Sırada…");
  check(
    (await sef.getByTestId("omr-live").getAttribute("aria-live")) === "polite" &&
      (await sef.getByTestId("omr-live").textContent()) === "Sırada…" &&
      /^Demo Şef başlattı · \d\d:\d\d$/.test((await sef.getByTestId("omr-status").locator("p").nth(1).textContent()) ?? ""),
    "AC9/29 aria-live polite; {ad} başlattı · {saat}",
  );

  await sef.getByRole("button", { name: "Çeviri sürüyor…" }).waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    (await sef.getByTestId("omr-fields").getAttribute("disabled")) !== null &&
      (await sef.getByRole("button", { name: "Çeviri sürüyor…" }).isDisabled()) &&
      (await sef.getByRole("button", { name: "Değiştir" }).isDisabled()) &&
      (await sef.getByRole("button", { name: "Sil", exact: true }).first().isDisabled()) &&
      (await sef.getByTestId("score-locked").textContent()) === "Çeviri sürerken nota değiştirilemez.",
    "review P2-2 while queued: the convert form is disabled (Çeviri sürüyor…); Değiştir and Sil disabled with the reason inline",
  );
  const order = await sef.evaluate(() => {
    const auto = document.querySelector("[data-testid=midi-auto]");
    const manual = document.querySelector("[data-testid=midi-upload]");
    const nota = document.querySelector("#nota-ve-midi");
    return Boolean(auto && manual && nota?.contains(auto) && auto.compareDocumentPosition(manual) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check(order, "review P2-1 the automatic group sits in Nota ve otomatik MIDI, before the manual upload form");

  // ------------------------------------------------------------------ AC 11 (same piece, parallel)
  const again = await callForm(sef, acts.startOmr, [piece], { layout: "satb", piano: "on" });
  check(again.includes("Bu eserde zaten bir çeviri sürüyor.") && Number((await one("select count(*) as n from omr_jobs where piece_id = ?", [piece])).n) === 1, "AC11 a second start while one is active is refused");

  // ------------------------------------------------------------------ AC 3
  const unknown = crypto.randomUUID();
  const unsigned = await machine(job, "nota", null, { unsigned: true });
  const wrong = await machine(job, "nota", null, { secret: "x".repeat(40) });
  const stale = await machine(job, "nota", null, { skew: -310 });
  const future = await machine(job, "nota", null, { skew: 310 });
  const swapped = await machine(job, "durum", { state: "running" }, { signBody: Buffer.from("{}") });
  check(
    [unsigned, wrong, stale, future, swapped].every((r) => r.status === 401) && (await jobRow(job)).state === "queued",
    `AC3 401 without a signature, with a wrong one, ±5 min off, or over other bytes (${[unsigned, wrong, stale, future, swapped].map((r) => r.status)})`,
  );
  check((await machine(unknown, "nota")).status === 404 && (await machine(unknown, "durum", { state: "running" })).status === 404, "AC3 404 for an unknown job");
  const fetched = await machine(job, "nota");
  check(
    fetched.status === 200 && fetched.headers.get("content-type") === "application/pdf" && Buffer.compare(fetched.body, pdf) === 0,
    "AC3 the signed PDF fetch returns the score",
  );
  check([unsigned, fetched].every((r) => r.setCookie === null), "AC3 machine responses never set a cookie");

  // ------------------------------------------------------------------ AC 12, 13 (polling)
  const running = await machine(job, "durum", { state: "running", runId: "987654321" });
  check(running.status === 200, "AC12 a signed running status is accepted");
  await sef.locator("[data-omr-state=running]").waitFor({ timeout: 15_000 });
  check((await state(sef).textContent()) === "Çevriliyor… (0 dk)", "AC12/13 Çevriliyor… (0 dk) appears without a reload");
  check(
    (await sef.getByRole("link", { name: "GitHub'da gör" }).getAttribute("href")) === "https://github.com/kptnortkp/arkhe/actions/runs/987654321",
    "AC12 GitHub'da gör links the run, built by the portal",
  );
  const r2 = await jobRow(job);
  check(r2.state === "running" && r2.run_id === "987654321" && r2.started_at !== null, "AC12 state, run id and start time are stored");
  check((await machine(job, "durum", { state: "running", runId: "1" })).status === 409, "AC3/12 running is accepted once (409 the second time)");

  // ------------------------------------------------------------------ AC 4 (crafted bodies) on another piece
  const crafted = await newPiece("E2E OMR Bozuk");
  const tooBig = await insertJob(crafted, { state: "running" });
  const huge = await machine(tooBig, "sonuc", Buffer.alloc(2 * 1024 * 1024 + 1, 0x20));
  check(huge.status === 413 && (await jobRow(tooBig)).state === "running", "AC4 a body above 2 MB is refused (413) before parsing, nothing changes");
  await db.execute({ sql: "update omr_jobs set state = 'failed', error_kind = 'unknown', finished_at = unixepoch() where id = ?", args: [tooBig] });
  const many = Array.from({ length: 17 }, (_, i) => `Ses ${i + 1}`);
  const cases = [
    ["not a MIDI", { midi: Buffer.from("MThx nope").toString("base64"), summary: { measures: 10 } }],
    ["17 tracks", resultBody(autoMidi(many), { measures: 10 })],
    ["a 41-char name", resultBody(autoMidi(["x".repeat(41)]), { measures: 10 })],
    ["no notes", resultBody(midiBytes({ tracks: [{ name: "Bos", notes: [] }] }), { measures: 10 })],
    ["measures 0", resultBody(autoMidi(), { measures: 0 })],
    ["measures 2001", resultBody(autoMidi(), { measures: 2001 })],
    ["measures as text", resultBody(autoMidi(), { measures: "93" })],
    ["no summary", { midi: Buffer.from(autoMidi()).toString("base64") }],
    ["bad base64", { midi: "%%%", summary: { measures: 3 } }],
    ["MIDI over 1 MB", resultBody(Buffer.concat([autoMidi(), Buffer.alloc(1_048_577)]), { measures: 3 })],
  ];
  const outcomes = [];
  for (const [name, body] of cases) {
    const j = await insertJob(crafted, { state: "running" });
    const res = await machine(j, "sonuc", body);
    const row = await jobRow(j);
    outcomes.push(`${name}:${res.status}/${row.error_kind}`);
    if (!(res.status === 422 && row.state === "failed" && row.error_kind === "output_invalid")) outcomes.push("!");
  }
  const stored = Number((await one("select count(*) as n from midi_files where piece_id = ?", [crafted])).n);
  check(!outcomes.includes("!") && stored === 0, `AC4 each crafted body fails the job as output_invalid and stores nothing (${outcomes.join(", ")})`);

  // review P3: 411 without a length, no proxy CSP on machine answers, a paused store fails as storage_full.
  const noLen = await new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/omr/${job}/durum`, {
      method: "POST",
      headers: { "X-Arkhe-Timestamp": String(Math.floor(Date.now() / 1000)), "X-Arkhe-Signature": "0".repeat(64), "Transfer-Encoding": "chunked" },
    }, (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on("error", reject);
    req.end("{}");
  });
  // Next's server may add a length to a chunked body, so 411 is only asserted when it reaches us without one.
  check([411, 401].includes(noLen.status) && fetched.headers.get("content-security-policy") === null, `review P3 a chunked POST is refused; the proxy stays out of /api/omr (${noLen.status})`);
  const full = await insertJob(crafted, { state: "running" });
  await db.batch(Array.from({ length: 1900 }, () => ({ sql: "insert into storage_events (kind, area, bytes) values ('put', 'midi', 1)" })), "write");
  const paused = await machine(full, "sonuc", resultBody(autoMidi(), { measures: 3 }));
  await db.execute("delete from storage_events where kind = 'put' and bytes = 1");
  await go(sef, `${BASE}/repertuvar/${crafted}/duzenle`);
  check(
    paused.status === 507 && (await jobRow(full)).error_kind === "storage_full" &&
      (await state(sef).textContent()) === "Çeviri başarısız: Dosya alanı dolu olduğu için sonuç kaydedilemedi. Yer açılınca yeniden dene.",
    `review P3 a result while uploads are paused fails the job as storage_full (${paused.status})`,
  );
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);

  // ------------------------------------------------------------------ AC 17
  const good = autoMidi(["Kadın", "Erkek", "Piyano"], { beats: 268 });
  const accepted = await machine(job, "sonuc", resultBody(good, { measures: 93, tracks: [{ name: "x", parts: [] }], durationSec: 1, extra: "ignored" }));
  const draft1 = await one("select * from midi_files where piece_id = ? and auto = 1", [piece]);
  check(
    accepted.status === 201 &&
      (await jobRow(job)).state === "succeeded" &&
      draft1?.status === "draft" &&
      draft1.voice_part === null &&
      Number(draft1.measures) === 93 &&
      JSON.parse(draft1.tracks_json).map((t) => t.name).join(",") === "Kadın,Erkek,Piyano" &&
      !String(draft1.tracks_json).includes("ignored"),
    "AC17 a valid result: one draft with its track list and measure count; the job succeeded",
  );
  await sef.locator("[data-omr-state=succeeded]").waitFor({ timeout: 15_000 });
  const card = sef.locator(`[data-midi-draft="${draft1.id}"]`);
  await card.waitFor();
  check(
    (await state(sef).textContent()) === "Taslak hazır" &&
      (await card.locator("h3").textContent()) === "Taslak · otomatik çeviri" &&
      (await card.getByTestId("draft-summary").textContent()) === "3 ses: Kadın, Erkek, Piyano · 93 ölçü · 2:41" &&
      (await card.getByText("Otomatik çeviride yanlış nota olabilir. Notayla karşılaştırarak dinle.").count()) === 1 &&
      (await card.getByRole("link", { name: "Aç: Nota (PDF)" }).count()) === 1,
    `AC17 Taslak hazır and the draft card: ${await card.getByTestId("draft-summary").textContent()}`,
  );
  check((await sef.getByTestId("midi-auto").locator(`[data-midi-draft="${draft1.id}"]`).count()) === 1, "AC33 the draft and status live in the automatic group");
  const replay = await machine(job, "sonuc", resultBody(good, { measures: 93 }));
  check(replay.status === 409 && Number((await one("select count(*) as n from midi_files where piece_id = ? and auto = 1", [piece])).n) === 1, "AC3 a replayed result is 409 and adds no second draft");
  // A newer result replaces the undecided draft.
  const job2 = await insertJob(piece, { state: "running" });
  await machine(job2, "sonuc", resultBody(autoMidi(["Soprano", "Alto", "Tenor", "Bas", "Piyano"]), { measures: 12 }));
  const draft2 = await one("select * from midi_files where piece_id = ? and auto = 1", [piece]);
  const q1 = await one("select area from storage_deletions where storage_key = ?", [draft1.storage_key]);
  check(
    draft2.id !== draft1.id && draft2.status === "draft" && Number((await one("select count(*) as n from midi_files where piece_id = ? and auto = 1", [piece])).n) === 1 && q1?.area === "midi",
    "AC17 a newer result replaces the undecided draft (old key queued)",
  );

  // ------------------------------------------------------------------ AC 18: drafts are invisible to members
  const hw = await insertAssignment({ dueDays: 3, parts: ["alto"], title: "E2E OMR Ödev" });
  const hwDraft = await insertAuto(hw.piece, "draft", ["Soprano", "Alto", "Tenor", "Bas"]);
  await go(korist, `${BASE}/repertuvar/${hw.piece}?partisyon=tumu`);
  const hidden =
    (await korist.getByTestId("midi-auto").count()) === 0 &&
    (await korist.getByTestId("midi-hero").count()) === 0 &&
    (await korist.locator(`[data-midi-button="${hwDraft.id}"]`).count()) === 0;
  await go(korist, `${BASE}/odevler/${hw.id}`);
  const hwHidden = (await korist.getByRole("button", { name: "MIDI'yi çal" }).count()) === 0;
  const dl = await korist.request.get(`${BASE}/api/dosya/midi/${hwDraft.id}`, { failOnStatusCode: false });
  await go(korist, `${BASE}/`);
  const homeHidden = (await korist.locator(`[data-testid=midi-part-link][href="/repertuvar/${hw.piece}?cal=1"]`).count()) === 0;
  check(hidden && hwHidden && dl.status() === 404 && homeHidden, "AC18 korist@: no draft on the piece page, the hero, the homework, home, and the route says 404");
  const mgr = await sef.request.get(`${BASE}/api/dosya/midi/${hwDraft.id}?indir=1`, { failOnStatusCode: false });
  check(mgr.status() === 200 && mgr.headers()["content-disposition"].startsWith("attachment"), "AC18 a manager can play and download the draft");

  // ------------------------------------------------------------------ AC 21: precedence
  await db.execute({ sql: "delete from midi_files where id = ?", args: [hwDraft.id] });
  const auto = await insertAuto(hw.piece, "published", ["Soprano", "Alto", "Tenor", "Bas"]);
  const openPlayer = async (page, button) => {
    await button.click();
    await page.locator("[data-midi-player][data-state=playing]").first().waitFor({ timeout: 15_000 });
  };
  const levels = async (page) =>
    page.locator("[data-midi-player] [data-track]").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.track, e.dataset.level])));
  await go(korist, `${BASE}/repertuvar/${hw.piece}`);
  const hero = korist.getByTestId("midi-hero");
  const heroId1 = await hero.locator("[data-midi-button]").getAttribute("data-midi-button");
  await openPlayer(korist, hero.getByRole("button", { name: "Partisyonumu çal (Alto)" }));
  const l1 = await levels(korist);
  check(heroId1 === auto.id && l1.Alto === "100" && l1.Soprano === "30" && l1.Bas === "30", `AC21 hero without a manual file: the automatic file, Alto önde (${JSON.stringify(l1)})`);
  await go(korist, `${BASE}/odevler/${hw.id}`);
  const step = korist.locator("[data-midi-button]").first();
  const stepId1 = await step.getAttribute("data-midi-button");
  await openPlayer(korist, korist.getByRole("button", { name: "MIDI'yi çal" }));
  const s1 = await levels(korist);
  check(stepId1 === auto.id && s1.Alto === "100" && s1.Tenor === "30", "AC21 homework (2): the automatic file with my track, önde");
  const tutti = await insertMidi(hw.piece, { bytes: autoMidi(["Soprano", "Alto"]) });
  await go(korist, `${BASE}/odevler/${hw.id}`);
  check((await korist.locator("[data-midi-button]").first().getAttribute("data-midi-button")) === auto.id, "AC21 homework: the automatic file with my track beats a manual Tutti");
  await go(korist, `${BASE}/repertuvar/${hw.piece}`);
  check((await korist.getByTestId("midi-hero").locator("[data-midi-button]").getAttribute("data-midi-button")) === auto.id, "AC21 hero: a manual Tutti doesn't take the hero");
  const altoFile = await insertMidi(hw.piece, { part: "alto", bytes: autoMidi(["Alto"]) });
  await go(korist, `${BASE}/repertuvar/${hw.piece}`);
  const heroId3 = await korist.getByTestId("midi-hero").locator("[data-midi-button]").getAttribute("data-midi-button");
  await go(korist, `${BASE}/odevler/${hw.id}`);
  const stepId3 = await korist.locator("[data-midi-button]").first().getAttribute("data-midi-button");
  check(heroId3 === altoFile.id && stepId3 === altoFile.id, "AC21 (1) a manual file for my exact part wins hero and homework");
  await db.execute({ sql: "delete from midi_files where id in (?, ?)", args: [altoFile.id, auto.id] });
  const noPart = await insertAuto(hw.piece, "published", ["Piyano", "Ses 1"]);
  await go(korist, `${BASE}/repertuvar/${hw.piece}`);
  const noHero = (await korist.getByTestId("midi-hero").count()) === 0;
  await go(korist, `${BASE}/odevler/${hw.id}`);
  const stepId4 = await korist.locator("[data-midi-button]").first().getAttribute("data-midi-button");
  check(noHero && stepId4 === tutti.id, "AC21 an automatic file without my part: no hero; homework (3) plays the manual Tutti");
  await db.execute({ sql: "delete from midi_files where id = ?", args: [tutti.id] });
  await go(korist, `${BASE}/odevler/${hw.id}`);
  const stepId5 = await korist.locator("[data-midi-button]").first().getAttribute("data-midi-button");
  await openPlayer(korist, korist.getByRole("button", { name: "MIDI'yi çal" }));
  const s5 = await levels(korist);
  check(stepId5 === noPart.id && s5["Ses 1"] === "100", `AC21 homework (4): the automatic file without emphasis (${JSON.stringify(s5)})`);

  // ------------------------------------------------------------------ AC 14: timeouts without a cron
  const tp = await newPiece("E2E OMR Zaman");
  const old = await insertJob(tp, { state: "queued", createdAgoSec: 21 * 60 });
  await go(sef, `${BASE}/repertuvar/${tp}/duzenle`);
  check(
    (await jobRow(old)).error_kind === "not_started" && (await state(sef).textContent()) === "Çeviri başarısız: GitHub işi başlamadı. Biraz sonra yeniden dene.",
    "AC14 queued for 21 min → failed / not_started on read",
  );
  const long = await insertJob(tp, { state: "running", createdAgoSec: 46 * 60 });
  const late = await machine(long, "sonuc", resultBody(autoMidi(), { measures: 3 }));
  check(late.status === 409 && (await jobRow(long)).error_kind === "timeout", "AC14 running 46 min → timeout; a late result gets 409");
  await db.execute({ sql: "delete from omr_jobs where id = ?", args: [old] });
  await go(sef, `${BASE}/repertuvar/${tp}/duzenle`);
  check((await state(sef).textContent()) === "Çeviri başarısız: Çeviri 45 dakikada bitmedi. Yeniden dene.", "AC14 the timeout reason");
  const fresh = await insertJob(tp, { state: "queued", createdAgoSec: 19 * 60 });
  await go(sef, `${BASE}/repertuvar/${tp}/duzenle`);
  check((await jobRow(fresh)).state === "queued", "AC14 19 minutes queued is still queued");
  await db.execute({ sql: "update omr_jobs set state = 'failed', error_kind = 'unknown', finished_at = unixepoch() where id = ?", args: [fresh] });

  // ------------------------------------------------------------------ AC 15: failure callback, retry
  await uploadScore(sef, tp, pdfBytes());
  const fj = await insertJob(tp, { state: "running", layout: "satb" });
  await db.execute({ sql: "update omr_jobs set piano = 0, tempo = 88 where id = ?", args: [fj] });
  const mism = await machine(fj, "durum", { state: "failed", kind: "layout_mismatch", expected: 4, found: 2, message: "free text" });
  await go(sef, `${BASE}/repertuvar/${tp}/duzenle`);
  check(
    mism.status === 200 &&
      (await state(sef).textContent()) ===
        "Çeviri başarısız: Seçilen düzene uymadı: 4 ses satırı bekleniyordu, 2 bulundu. Düzeni değiştirip yeniden dene.",
    "AC15 layout_mismatch shows both numbers",
  );
  check((await machine(fj, "durum", { state: "failed", kind: "no_music" })).status === 409, "AC3 a failure for a failed job is 409");
  const uj = await insertJob(tp, { state: "running" });
  await machine(uj, "durum", { state: "failed", kind: "exploded", expected: 4, found: 2 });
  const ur = await jobRow(uj);
  await go(sef, `${BASE}/repertuvar/${tp}/duzenle`);
  check(ur.error_kind === "unknown" && ur.expected === null && (await state(sef).textContent()) === "Çeviri başarısız: Çeviri başarısız oldu. Yeniden dene.", "AC15 an unknown kind shows the generic reason, numbers dropped");
  const big = await insertJob(tp, { state: "running" });
  await machine(big, "durum", { state: "failed", kind: "layout_mismatch", expected: 99, found: 2 });
  check((await jobRow(big)).expected === null, "AC15 numbers outside 0–40 are not stored");
  await db.execute({ sql: "update omr_jobs set created_at = created_at - 5 where id in (?, ?)", args: [uj, big] });
  await db.execute({ sql: "update omr_jobs set created_at = unixepoch() where id = ?", args: [fj] });
  const retried = await callAction(sef, acts.retryOmr, [fj]);
  const nj = await latestJobOf(tp);
  const ne = outboxEntry(nj.id);
  check(
    retried.includes("Çeviri başladı.") && nj.id !== fj && nj.layout === "satb" && Number(nj.piano) === 0 && Number(nj.tempo) === 88 &&
      JSON.stringify(ne?.inputs) === JSON.stringify({ job_id: nj.id, layout: "satb", piano: "false", tempo: "88" }),
    "AC15 Yeniden dene starts a new job with the same options",
  );
  await db.execute({ sql: "update omr_jobs set state = 'failed', error_kind = 'unknown', finished_at = unixepoch() where id = ?", args: [nj.id] });

  // ------------------------------------------------------------------ AC 10: dispatch errors
  await go(sef, `${BASE}/repertuvar/${tp}/duzenle`);
  for (const [fault, kind] of [["401", "dispatch_auth"], ["403", "dispatch_auth"], ["404", "dispatch_auth"], ["500", "dispatch_failed"], ["timeout", "dispatch_failed"]]) {
    await setHook(sef, "arkhe_e2e_omr_fault", fault);
    await callForm(sef, acts.startOmr, [tp], { layout: "auto", piano: "on" });
    const r = await latestJobOf(tp);
    check(r.state === "failed" && r.error_kind === kind && !outboxEntry(r.id), `AC10 GitHub ${fault} → failed / ${kind}, no outbox file`);
  }
  await setHook(sef, "arkhe_e2e_omr_fault", null);
  await go(sef, `${BASE}/repertuvar/${tp}/duzenle`);
  check(
    (await state(sef).textContent()) === "Çeviri başarısız: GitHub'a ulaşılamadı. Biraz sonra yeniden dene." &&
      (await sef.getByRole("button", { name: "Yeniden dene" }).count()) === 1,
    "AC10 the page shows the reason and Yeniden dene",
  );

  // ------------------------------------------------------------------ AC 11: limits
  const lp = await newPiece("E2E OMR Sınır");
  await uploadScore(sef, lp, pdfBytes());
  const sefId = (await one("select id from users where email = 'sef@arkhe.local'")).id;
  const ykId = (await one("select id from users where email = 'yk@arkhe.local'")).id;
  await db.execute({ sql: "delete from omr_jobs where created_by in (?, ?)", args: [sefId, ykId] });
  for (let i = 0; i < 9; i++) await insertJob(lp, { state: "succeeded", createdBy: sefId, createdAgoSec: 5 });
  for (let i = 0; i < 3; i++) await insertJob(lp, { state: "failed", errorKind: "dispatch_failed", createdBy: sefId, createdAgoSec: 5 });
  await go(sef, `${BASE}/repertuvar/${lp}/duzenle`);
  const tenth = await callForm(sef, acts.startOmr, [lp], { layout: "satb", piano: "on" });
  const t10 = await latestJobOf(lp);
  await db.execute({ sql: "update omr_jobs set state = 'failed', error_kind = 'unknown', finished_at = unixepoch() where id = ?", args: [t10.id] });
  const eleventh = await callForm(sef, acts.startOmr, [lp], { layout: "satb", piano: "on" });
  check(tenth.includes("Çeviri başladı.") && eleventh.includes("Bugün en fazla 10 çeviri başlatabilirsin."), "AC11 the 11th start in an Istanbul day is refused; dispatch failures don't count");
  const counted = Number((await one("select count(*) as n from omr_jobs where created_at > unixepoch() - 30 * 86400 and error_kind is not 'dispatch_auth' and error_kind is not 'dispatch_failed'")).n);
  for (let i = counted; i < 40; i++) await insertJob(lp, { state: "succeeded", createdAgoSec: 10 * 86400 });
  await go(yk, `${BASE}/repertuvar/${lp}/duzenle`);
  const choir = await callForm(yk, acts.startOmr, [lp], { layout: "satb", piano: "on" });
  check(choir.includes("Bu ay için otomatik çeviri sınırı doldu (40). Elle MIDI yükleyebilirsin."), "AC11 the 41st choir-wide start in 30 days is refused");
  await db.execute({ sql: "delete from omr_jobs where piece_id = ? or created_by in (?, ?)", args: [lp, sefId, ykId] });
  const [a, b] = await Promise.all([
    callForm(sef, acts.startOmr, [lp], { layout: "satb", piano: "on" }),
    callForm(yk, acts.startOmr, [lp], { layout: "satb", piano: "on" }),
  ]);
  const wins = [a, b].filter((x) => x.includes("Çeviri başladı.")).length;
  const refused = [a, b].filter((x) => x.includes("Bu eserde zaten bir çeviri sürüyor.")).length;
  check(wins === 1 && refused === 1 && Number((await one("select count(*) as n from omr_jobs where piece_id = ?", [lp])).n) === 1, "AC11 two parallel submits: exactly one wins");

  // ------------------------------------------------------------------ AC 19, 20, 31: publish, delete, push
  const all = (await db.execute("select id, email from users where is_active = 1")).rows;
  const byId = new Map(all.map((u) => [u.id, u.email]));
  const koristId = (await one("select id from users where email = 'korist@arkhe.local'")).id;
  const offId = await createUser("repoff@e2e.test", "E2E Repertuvar Kapalı");
  const goneId = await createUser("pasifmidi@e2e.test", "E2E Pasif");
  await db.execute({ sql: "update users set is_active = 0, left_at = unixepoch() where id = ?", args: [goneId] });
  const devs = {};
  for (const id of [koristId, ykId, sefId, offId, goneId]) devs[id] = await addDevice(id, "ok");
  await setPref(offId, "repertuvar", false);
  await setPref(ykId, "gece", false);
  const today = istanbulDate(0);
  await setHook(sef, "arkhe_e2e_clock", at(today, "14:00"));
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  const since = Date.now();
  await sef.locator(`[data-midi-draft="${draft2.id}"]`).getByRole("button", { name: "Yayınla" }).click();
  const dialog = sef.getByRole("alertdialog");
  check(
    (await dialog.getByText("Yayınlansın mı?").count()) === 1 && (await dialog.getByText("Koristler hemen görür ve bildirim alır.").count()) === 1,
    "review P2-5 the first publish also confirms: Koristler hemen görür ve bildirim alır.",
  );
  await dialog.getByRole("button", { name: "Yayınla" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Yayınlandı; koristler artık görüyor." }).waitFor();
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  check((await sef.locator("[data-omr-state]").count()) === 0, "review P2-3 with the draft published, Taslak hazır is gone");
  const pub = await one("select * from midi_files where id = ?", [draft2.id]);
  check(pub.status === "published" && pub.published_by === sefId && pub.label === "Otomatik" && pub.voice_part === null, "AC19 Yayınla: the draft becomes a published Otomatik Tutti file");
  await until(() => outboxSince(since).filter((e) => e.kind === "midi_published").length >= 2);
  await new Promise((r) => setTimeout(r, 800));
  const sent = outboxSince(since).filter((e) => e.kind === "midi_published");
  const to = sent.map((e) => byId.get(e.userId) ?? e.userId).sort();
  check(JSON.stringify(to) === JSON.stringify(["korist@arkhe.local", "yk@arkhe.local"]), `AC31 exactly one per device of korist@ (default on) and yk@; not the publisher, the switched-off or the inactive user (${to})`);
  const p = sent[0]?.payload;
  check(
    p?.title === "Yeni MIDI" && p.body === PUSH_BODY && p.url === `/repertuvar/${piece}` && p.tag === `midi-${piece}`,
    `AC31 title, body (piece title only), url, tag (${JSON.stringify(p)})`,
  );
  const nrow = await one("select * from notifications where kind = 'midi_published' and user_id = ?", [koristId]);
  check(nrow.dedupe_key === `midi_published-${draft2.id}` && nrow.group_key === "repertuvar" && Number(nrow.expires_at) - Number(nrow.created_at) === 3 * 86400, "AC31 dedupe key, group, 3-day expiry");
  await go(korist, `${BASE}/repertuvar/${piece}`);
  check((await korist.getByTestId("midi-auto").locator(`[data-midi-button="${draft2.id}"]`).count()) === 1, "AC19 korist@ sees the published file at once");
  removeOutbox(sent);

  // AC 20: publishing or deleting twice
  const d3 = await insertAuto(piece, "draft");
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  const del1 = await callAction(sef, acts.deleteDraft, [d3.id]);
  const del2 = await callAction(sef, acts.deleteDraft, [d3.id]);
  const q3 = await one("select area from storage_deletions where storage_key = ?", [d3.key]);
  check(del1.includes("Taslak silindi.") && del2.includes("Dosya bulunamadı.") && q3?.area === "midi" && !(await fileExists(d3.key)), "AC20 Sil removes the draft (key queued); a second Sil: Dosya bulunamadı.");
  const d4 = await insertAuto(piece, "draft");
  await setHook(sef, "arkhe_e2e_push_fault", "throw");
  const pubA = await callAction(sef, acts.publishDraft, [d4.id]);
  const pubB = await callAction(sef, acts.publishDraft, [d4.id]);
  await setHook(sef, "arkhe_e2e_push_fault", null);
  check(
    pubA.includes("Yayınlandı; koristler artık görüyor.") && pubB.includes("Dosya bulunamadı.") && !(await one("select 1 from midi_files where id = ?", [draft2.id])),
    "AC20/19 publishing twice: the second says Dosya bulunamadı.; the previous automatic file is gone",
  );
  await new Promise((r) => setTimeout(r, 1200));
  const faulted = (await db.execute({ sql: "select status, attempts from notifications where dedupe_key = ?", args: [`midi_published-${d4.id}`] })).rows;
  check(faulted.length === 2 && faulted.every((r) => r.status === "pending"), "AC31 with the sender throwing the publish still succeeds; rows stay for a retry");
  await db.execute({ sql: "delete from notifications where dedupe_key = ?", args: [`midi_published-${d4.id}`] });

  // Quiet hours at 23:30: held for gece-on people, at once for gece-off.
  const d5 = await insertAuto(piece, "draft");
  await setHook(sef, "arkhe_e2e_clock", at(today, "23:30"));
  const since2 = Date.now();
  await callAction(sef, acts.publishDraft, [d5.id]);
  await until(() => outboxSince(since2).some((e) => e.kind === "midi_published"));
  await new Promise((r) => setTimeout(r, 800));
  const night = outboxSince(since2).filter((e) => e.kind === "midi_published").map((e) => byId.get(e.userId));
  const held = await one("select status, line from notifications where kind = 'midi_published' and user_id = ? and dedupe_key = ?", [koristId, `midi_published-${d5.id}`]);
  check(JSON.stringify(night) === JSON.stringify(["yk@arkhe.local"]) && held?.status === "held" && held.line === `Yeni MIDI: ${TITLE}`, `AC31 at 23:30 held for korist@ (Gece sessiz), at once for yk@ (${night})`);
  removeOutbox(outboxSince(since2));
  await setHook(sef, "arkhe_e2e_clock", null);

  // The next morning: korist@ gets the line; the repertoire line skips automatic files.
  const manualPiece = await newPiece("E2E Manuel MIDI Eseri");
  await db.execute("update pieces set created_at = unixepoch() - 3 * 86400 where title like 'E2E%'");
  await db.execute("update midi_files set created_at = unixepoch() - 3 * 86400 where auto = 0 and piece_id in (select id from pieces where title like 'E2E%')");
  await insertMidi(manualPiece, { bytes: autoMidi(["Bas"]) });
  await db.execute({ sql: "update midi_files set created_at = unixepoch() - 60 where piece_id = ?", args: [manualPiece] });
  await db.execute({ sql: "update midi_files set created_at = unixepoch() - 60 where id = ?", args: [d5.id] });
  const tomorrow = istanbulDate(1);
  await db.execute("delete from notification_state where key like 'sabah-%' or key = 'repertuvar-since'");
  await db.execute({ sql: "insert into notification_state (key, value) values ('repertuvar-since', ?)", args: [new Date(Date.now() - 3600_000).toISOString()] });
  await dispatch(`?simdi=${encodeURIComponent(at(tomorrow, "08:20"))}`);
  const k = await one("select status, merged_into from notifications where dedupe_key = ? and user_id = ?", [`midi_published-${d5.id}`, koristId]);
  const merged = k?.merged_into ? await one("select body from notifications where id = ?", [k.merged_into]) : null;
  check(
    k && k.status !== "held" && (k.status !== "merged" || merged?.body.includes(`Yeni MIDI: ${TITLE}`)),
    `AC31 the held item arrives in the morning (${k?.status}${merged ? `: ${merged.body.replace(/\n/g, " | ")}` : ""})`,
  );
  const rep = await one("select body from notifications where kind = 'repertoire' and user_id = ?", [koristId]);
  check(rep?.body === "E2E Manuel MIDI Eseri: 1 yeni dosya", `AC31/D114 the repertoire line counts the manual upload, not the automatic file (${rep?.body})`);

  // Deleting a draft and failed jobs send nothing.
  const quiet = (await db.execute("select count(*) as n from notifications where kind = 'midi_published'")).rows[0].n;
  check(Number(quiet) === 4, `AC31 only publishes created midi_published rows (${quiet})`);

  // ------------------------------------------------------------------ AC 26 (static)
  const wf = readFileSync(path.join(ROOT, ".github/workflows/omr.yml"), "utf8");
  const req = readFileSync(path.join(ROOT, "omr/requirements.txt"), "utf8");
  const on = /^on:\s*\n((?:[ \t]+.*\n)+)/m.exec(wf)?.[1] ?? "";
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  // A secret may only appear as an env: mapping (NAME: ${{ secrets.X }}), never inside run: text.
  const secretLines = wf.split("\n").filter((l) => l.includes("secrets."));
  const timeout = Number(/timeout-minutes:\s*(\d+)/.exec(wf)?.[1]);
  check(JSON.stringify(triggers) === '["workflow_dispatch"]', `AC26 only workflow_dispatch (${triggers})`);
  check(/permissions:\s*\n\s+contents:\s*read\s*\n/.test(wf) && timeout > 0 && timeout <= 30 && /concurrency:\s*\n\s+group:\s*omr-\$\{\{\s*inputs\.job_id\s*\}\}/.test(wf), "AC26 contents: read, timeout ≤ 30, concurrency per job id");
  check(/AUDIVERIS_VERSION:\s*"?5\.11\.0"?/.test(wf) && /sha256sum\s+(-c|--check)/.test(wf) && /AUDIVERIS_SHA256:\s*"?[0-9a-f]{64}"?/.test(wf), "AC26 Audiveris 5.11.0 pinned with a sha256 check");
  check(uses.length > 0 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), `AC26 every uses: pinned to a 40-char SHA (${uses.length})`);
  check(!/set -x/.test(wf) && !/upload-artifact/.test(wf) && secretLines.length > 0 && secretLines.every((l) => /^\s+[A-Z_]+:\s*\$\{\{\s*secrets\.[A-Z_]+\s*\}\}\s*$/.test(l)), "AC26 no set -x, no upload-artifact, no secret in run: text");
  const reqLines = req.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  const pkgs = reqLines.filter((l) => !l.trim().startsWith("--hash="));
  check(
    pkgs.length > 0 &&
      pkgs.every((l) => /^[A-Za-z0-9_.-]+==[0-9][0-9A-Za-z.]* \\$/.test(l)) &&
      reqLines.every((l, i) => !pkgs.includes(l) || /^\s+--hash=sha256:[0-9a-f]{64}/.test(reqLines[i + 1] ?? "")) &&
      /pip install[^\n]*--require-hashes -r omr\/requirements\.txt/.test(wf),
    `AC26 omr/requirements.txt pins exact versions with hashes; pip runs with --require-hashes (${pkgs.length})`,
  );
  check(
    /if: failure\(\) \|\| cancelled\(\)/.test(wf) &&
      wf.split("\n").filter((l) => l.includes("OMR_CALLBACK_SECRET: ${{ secrets.")).length === 4 &&
      (wf.match(/\/usr\/bin\/python3 -I -S \/opt\/arkhe\/portal\.py/g) ?? []).length === 4 &&
      !/^\s+OMR_CALLBACK_SECRET:/m.test(wf.split("steps:")[0]),
    "review P2-2 the secret only reaches the pinned, isolated portal client; the failure step also runs on cancel",
  );
  void shots;
}
