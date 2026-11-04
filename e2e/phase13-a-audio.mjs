// Phase 13 A: rehearsal audio of a piece (Ses kayıtları): upload, guard rails, playback, the editor
// queue, delete and the piece cascade.
import { BASE, check, cleanup, db, loginAs } from "./lib.mjs";
import { fileExists, go, mp3Bytes, one, PNG, wavOfSize } from "./media.mjs";
import { newPiece } from "./omr.mjs";

const UPLOAD_ID_HEADER = "X-Upload-Id";
const MAX_BYTES = 4_194_304;

async function upload(page, pieceId, body, { part = "tutti", label, uploadId = crypto.randomUUID(), origin = BASE } = {}) {
  const q = new URLSearchParams({ eser: pieceId, ses: part });
  if (label) q.set("etiket", label);
  const headers = { "Content-Type": "application/octet-stream", [UPLOAD_ID_HEADER]: uploadId };
  if (origin) headers.Origin = origin;
  const res = await page.request.post(`${BASE}/api/dosya/ses?${q}`, { headers, data: body, failOnStatusCode: false });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json, uploadId };
}

const rowOf = (id) => one("select * from piece_audio where id = ?", [id]);

export default async function run(browser) {
  await cleanup();
  try {
    await suite(browser);
  } finally {
    await db.execute("delete from login_attempts where key like 'audio%'");
    await cleanup();
  }
}

async function suite(browser) {
  const pieceId = await newPiece("E2E Ses Eseri");
  const sef = await loginAs(browser, "sef@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });

  // ------------------------------------------------------------------ upload
  const alto = await upload(sef, pieceId, mp3Bytes(), { part: "alto", label: "Hızlı" });
  const altoRow = await rowOf(alto.uploadId);
  check(
    alto.status === 201 && altoRow?.voice_part === "alto" && altoRow.label === "Hızlı" && altoRow.content_type === "audio/mpeg",
    `audio: a manager uploads an mp3 for Alto (${alto.status})`,
  );
  check(altoRow && (await fileExists(altoRow.storage_key)), "audio: the file is in the store under recordings/");
  const replay = await upload(sef, pieceId, mp3Bytes(), { part: "alto", uploadId: alto.uploadId });
  const n = Number((await one("select count(*) as n from piece_audio where piece_id = ?", [pieceId])).n);
  check(replay.status === 200 && n === 1, "audio: a retried upload id is a no-op");
  const sop = await upload(sef, pieceId, mp3Bytes(), { part: "soprano" });
  const tutti = await upload(sef, pieceId, wavOfSize(4000));
  check(sop.status === 201 && tutti.status === 201, "audio: a Soprano mp3 and a Tutti wav upload");

  // ------------------------------------------------------------------ guard rails
  check((await upload(korist, pieceId, mp3Bytes())).status === 403, "audio: a member can't upload");
  check((await upload(sef, pieceId, mp3Bytes(), { origin: "https://evil.example" })).status === 403, "audio: a cross-origin upload is refused");
  const png = await upload(sef, pieceId, PNG);
  check(png.status === 415 && png.json?.error?.includes("ses kaydı değil"), "audio: a PNG is refused as not audio");
  const big = await upload(sef, pieceId, wavOfSize(MAX_BYTES + 1));
  check(big.status === 413 && big.json?.error?.includes("4 MB"), "audio: a file over 4 MB is refused");
  check((await upload(sef, pieceId, mp3Bytes(), { part: "piccolo" })).status === 400, "audio: an unknown part is refused");
  check((await upload(sef, crypto.randomUUID(), mp3Bytes())).status === 404, "audio: an unknown piece is refused");

  // ------------------------------------------------------------------ playback
  const get = await korist.request.get(`${BASE}/api/dosya/ses/${alto.uploadId}`, { failOnStatusCode: false });
  check(
    get.status() === 200 && get.headers()["content-type"] === "audio/mpeg" && get.headers()["cache-control"].includes("immutable"),
    "audio: a member gets the file, cacheable for a week",
  );
  const dl = await korist.request.get(`${BASE}/api/dosya/ses/${alto.uploadId}?indir=1`, { failOnStatusCode: false });
  check(/attachment; filename="E2E-Ses-Eseri-Hizli\.mp3"/.test(dl.headers()["content-disposition"] ?? ""), `audio: İndir names the file (${dl.headers()["content-disposition"]})`);
  const anon = await browser.newContext();
  const anonRes = await anon.request.get(`${BASE}/api/dosya/ses/${alto.uploadId}`, { failOnStatusCode: false });
  check(anonRes.status() === 401, "audio: signed out gets 401");
  await anon.close();
  const event = await one("select area from storage_events where kind = 'get' order by id desc limit 1");
  check(event?.area === "recording", "audio: a delivery counts toward the recording playback meter");

  // ------------------------------------------------------------------ detail page
  await go(korist, `${BASE}/repertuvar/${pieceId}`);
  const parts = await korist.locator("[data-testid=audio-row]").evaluateAll((els) => els.map((e) => e.dataset.part));
  check(JSON.stringify(parts) === JSON.stringify(["tutti", "alto"]), `audio: the alto member sees Tutti and Alto by default (${parts})`);
  await go(korist, `${BASE}/repertuvar/${pieceId}?partisyon=tumu`);
  check((await korist.locator("[data-testid=audio-row]").count()) === 3, "audio: Tümü shows every part");
  const fetched = korist.waitForResponse((r) => r.url().includes(`/api/dosya/ses/`) && r.status() === 200, { timeout: 10000 }).catch(() => null);
  await korist.getByRole("button", { name: /^Dinle: Hızlı$/ }).click();
  check(Boolean(await fetched), "audio: Dinle fetches the file");

  // ------------------------------------------------------------------ editor queue
  await go(sef, `${BASE}/repertuvar/${pieceId}/duzenle#ses-kayitlari`);
  await sef.getByTestId("audio-file").setInputFiles([
    { name: "Tenor - Yavaş - E2E Ses Eseri.mp3", mimeType: "audio/mpeg", buffer: mp3Bytes() },
    { name: "Toplu - E2E Ses Eseri.mp3", mimeType: "audio/mpeg", buffer: mp3Bytes() },
    { name: "Bas büyük.wav", mimeType: "audio/wav", buffer: wavOfSize(MAX_BYTES + 10) },
  ]);
  const queue = sef.getByTestId("audio-queue-row");
  const tenorPart = await sef.getByLabel("Partisyon: Tenor - Yavaş - E2E Ses Eseri.mp3").inputValue();
  const tenorLabel = await sef.getByLabel("Etiket: Tenor - Yavaş - E2E Ses Eseri.mp3").inputValue();
  const topluPart = await sef.getByLabel("Partisyon: Toplu - E2E Ses Eseri.mp3").inputValue();
  check(tenorPart === "tenor" && tenorLabel === "Tenor - Yavaş" && topluPart === "tutti", `audio: part and label come from the file name (${tenorPart}, ${tenorLabel}, ${topluPart})`);
  check(
    (await queue.nth(2).getAttribute("data-state")) === "failed" && (await queue.nth(2).innerText()).includes("4 MB"),
    "audio: an oversized file is flagged before upload",
  );
  await sef.getByRole("button", { name: "2 dosyayı yükle" }).click();
  await sef.locator("[data-testid=audio-queue-row][data-state=done]").nth(1).waitFor({ timeout: 20000 });
  await sef.getByTestId("audio-editor-row").nth(4).waitFor({ timeout: 10000 });
  check((await sef.getByTestId("audio-editor-row").count()) === 5, "audio: the queue uploads both files and the list shows them");

  // ------------------------------------------------------------------ delete
  await sef.getByRole("button", { name: "Diğer işlemler: Hızlı" }).click();
  await sef.getByRole("menuitem", { name: "Sil" }).click();
  await sef.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  await sef.getByTestId("audio-editor-row").nth(4).waitFor({ state: "detached", timeout: 10000 });
  const gone = await rowOf(alto.uploadId);
  const queued = await one("select state from storage_deletions where storage_key = ?", [altoRow.storage_key]);
  check(!gone && queued !== null && !(await fileExists(altoRow.storage_key)), `audio: Sil removes the row and the file (${queued?.state})`);

  // ------------------------------------------------------------------ cap and cascade
  const many = Array.from({ length: 21 }, () => ({
    sql: "insert into piece_audio (id, piece_id, storage_key, content_type, size_bytes, created_by) values (?, ?, ?, 'audio/mpeg', 1000, (select id from users where email = 'sef@arkhe.local'))",
    args: [crypto.randomUUID(), pieceId, `recordings/${crypto.randomUUID()}.mp3`],
  }));
  await db.batch(many, "write");
  const capped = await upload(sef, pieceId, mp3Bytes());
  check(capped.status === 409 && capped.json?.error?.includes("25"), `audio: the 26th file is refused (${capped.status})`);
  const keys = (await db.execute({ sql: "select storage_key from piece_audio where piece_id = ?", args: [pieceId] })).rows.map((r) => r.storage_key);
  await db.execute({ sql: "delete from pieces where id = ?", args: [pieceId] });
  const pending = Number((await one(`select count(*) as n from storage_deletions where storage_key in (${keys.map(() => "?").join(",")})`, keys)).n);
  check(pending === keys.length, `audio: deleting the piece queues every file (${pending}/${keys.length})`);

  await sef.context().close();
  await korist.context().close();
}
