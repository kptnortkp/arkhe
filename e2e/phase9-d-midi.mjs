// Phase 9 S9: MIDI files per piece and part, the in-browser player, the homework link-up.
import { HOMEWORK_IDS } from "../scripts/homework-fixture.mjs";
import { actionIds, BASE, callAction, check, cleanup, db, loginAs, newPage } from "./lib.mjs";
import {
  axe,
  fileExists,
  go,
  insertAssignment,
  insertMidi,
  layoutIssues,
  longMidi,
  midiBytes,
  one,
  requestLog,
  SEED_MIDI,
} from "./media.mjs";

const { a: A, b: B } = HOMEWORK_IDS;
const MIDI_ACTIONS = "src/app/(portal)/repertuvar/midi-actions.ts";
const PIECE_ACTIONS = "src/app/(portal)/repertuvar/actions.ts";
const secs = (t) => {
  const m = /^(\d+):(\d\d)/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const positionMs = async (player) => Number(await player.getAttribute("data-position-ms"));

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
  const anon = await newPage(browser);
  const ave = (await one("select id from pieces where title = 'Ave Verum Corpus'")).id;

  // ------------------------------------------------------------------ AC 4
  const alto = SEED_MIDI(2);
  const r = await korist.request.get(`${BASE}/api/dosya/midi/${alto}`, { failOnStatusCode: false });
  const dl = await korist.request.get(`${BASE}/api/dosya/midi/${alto}?indir=1`, { failOnStatusCode: false });
  const out = await anon.request.get(`${BASE}/api/dosya/midi/${alto}`, { failOnStatusCode: false });
  check(
    r.status() === 200 && r.headers()["cache-control"] === "private, max-age=604800, immutable" && out.status() === 401,
    "AC4 MIDI route: 200 with the immutable private cache for a member, 401 logged out",
  );
  check(
    dl.headers()["content-disposition"] === 'attachment; filename="Ave-Verum-Corpus-Alto.mid"',
    `AC4 ?indir=1 names Ave-Verum-Corpus-Alto.mid (${dl.headers()["content-disposition"]})`,
  );

  // ------------------------------------------------------------------ AC 50 (no tenor file yet), D59
  const emre = await loginAs(browser, "emre.aksoy@arkhe.local");
  await go(emre, `${BASE}/repertuvar/${ave}`);
  check(
    (await emre.getByTestId("midi-hero").count()) === 0 &&
      (await emre.getByRole("link", { name: /^Partisyonumu aç \(Tenor\)/ }).count()) === 1,
    "AC50 a tenor with no tenor MIDI keeps Phase 3's Drive Partisyonum hero",
  );
  await emre.context().close();
  const tenorFile = await insertMidi(ave, { part: "tenor", bytes: longMidi({ seconds: 4 }) });
  await go(korist, `${BASE}/repertuvar/${ave}`);
  const rowTitles = await korist.locator("[data-testid=midi-row]").evaluateAll((els) => els.map((e) => e.dataset.part));
  check(JSON.stringify(rowTitles) === '["tutti","alto"]', `AC50 korist@ (alto) sees Tutti and Alto, not Tenor (${rowTitles})`);
  check(
    (await korist.locator("[data-testid=midi-row]").first().textContent()).includes("MIDI · Tutti") &&
      (await korist.locator("[data-testid=midi-row]").nth(1).textContent()).includes("MIDI · Alto") &&
      (await korist.getByRole("button", { name: "Çal: MIDI · Tutti" }).count()) === 1 &&
      (await korist.getByRole("link", { name: "İndir: MIDI · Alto" }).getAttribute("href")) === `/api/dosya/midi/${alto}?indir=1`,
    "AC50 each row has Çal and İndir",
  );
  check(
    (await korist.getByTestId("midi-hero").getByRole("button").textContent()).trim() === "Partisyonumu çal (Alto)" &&
      (await korist.locator("#group-part").count()) === 1,
    "AC50 the hero is Partisyonumu çal (Alto); the Drive part stays under PARTİSYON KAYDI",
  );
  await go(korist, `${BASE}/repertuvar/${ave}?partisyon=tumu`);
  check((await korist.locator("[data-testid=midi-row]").count()) === 3, "AC50 ?partisyon=tumu lists all three");
  await go(korist, `${BASE}/repertuvar/${ave}?cal=1`);
  check((await korist.getByTestId("midi-ready").count()) === 1, "AC50 ?cal=1 opens the player ready for the tap");
  await go(korist, `${BASE}/`);
  check(
    (await korist.locator("[data-testid=midi-part-link]").getAttribute("href")) === `/repertuvar/${ave}?cal=1`,
    "D59 the home row of Ave Verum Corpus links to ?cal=1",
  );

  // ------------------------------------------------------------------ AC 51, 53 on an E2E piece
  const tuttiBytes = longMidi({ seconds: 40, names: ["Soprano", "Alto", "Tenor", "Bas"] });
  const { piece } = await insertAssignment({ dueDays: 3, title: "E2E MIDI Eseri" });
  const tutti = await insertMidi(piece, { bytes: tuttiBytes });
  const second = await insertMidi(piece, { part: "alto", label: "E2E ikinci", bytes: longMidi({ seconds: 20, names: ["Alto"] }) });
  const log = requestLog(korist);
  await go(korist, `${BASE}/repertuvar/${piece}`);
  const before = log.length;
  // The dev server ships every async chunk as a script tag; the lazy chunk is proven in e2e:prod (AC 52).
  check(
    !log.some((x) => x.url.includes("/api/dosya/midi/")) && (await korist.locator("[data-midi-player]").count()) === 0,
    "AC51 no MIDI fetch and no player before the tap",
  );
  await korist.getByRole("button", { name: "Çal: MIDI · Tutti" }).click();
  const player = korist.locator(`[data-midi-button="${tutti.id}"] [data-midi-player]`);
  await player.waitFor();
  await korist.waitForFunction((id) => document.querySelector(`[data-midi-button="${id}"] [data-midi-player]`)?.dataset.state === "playing", tutti.id);
  const after = log.slice(before);
  check(
    after.filter((x) => x.url.includes(`/api/dosya/midi/${tutti.id}`)).length === 1,
    "AC51 the file is fetched once on the tap",
  );
  await korist.waitForTimeout(1600);
  check(
    (await player.getAttribute("data-audio-state")) === "running" && secs(await korist.getByTestId("midi-position").textContent()) >= 1,
    "AC51 data-state=playing, the audio context runs, the position passes 0:01",
  );
  const tracks = player.locator("[data-track]");
  check(
    JSON.stringify(await tracks.evaluateAll((els) => els.map((e) => e.dataset.track))) === '["Soprano","Alto","Tenor","Bas"]' &&
      (await tracks.evaluateAll((els) => els.every((e) => e.getAttribute("aria-checked") === "true"))),
    "AC51 four track toggles Soprano, Alto, Tenor, Bas, all on",
  );
  check((await player.locator("text=Ses gelmiyorsa telefonun sessiz modunu kapat.").count()) === 1, "AC51 the silent-switch hint");
  await player.getByRole("button", { name: "Duraklat" }).click();
  await korist.waitForTimeout(200);
  const held = await positionMs(player);
  await korist.waitForTimeout(800);
  check((await player.getAttribute("data-state")) === "paused" && (await positionMs(player)) === held, "AC51 Duraklat holds the position");
  await player.getByRole("button", { name: "Başa dön" }).click();
  check((await korist.getByTestId("midi-position").textContent()).startsWith("0:00"), "AC51 Başa dön → 0:00");
  // Tempo: score time advances at half speed under %50 (loose).
  await player.getByRole("button", { name: "Çal" }).click();
  await korist.waitForTimeout(300);
  let p0 = await positionMs(player);
  await korist.waitForTimeout(2000);
  const full = (await positionMs(player)) - p0;
  await player.getByRole("radio", { name: "%50" }).click();
  await korist.waitForTimeout(300);
  p0 = await positionMs(player);
  await korist.waitForTimeout(2000);
  const half = (await positionMs(player)) - p0;
  check(full > 0 && half / full > 0.3 && half / full < 0.75, `AC51 %50 advances at about half speed (${half} vs ${full} ms)`);
  await player.locator("[data-track=Alto]").click();
  await korist.waitForTimeout(300);
  check(
    (await player.locator("[data-track=Alto]").getAttribute("data-muted")) === "true" && (await player.getAttribute("data-state")) === "playing",
    "AC51 unchecking Alto mutes it and keeps playing",
  );
  if (shots) await korist.screenshot({ path: `${shots}/p9-midi-player-1280.png`, fullPage: true });
  await korist.getByRole("button", { name: "Çal: E2E ikinci · Alto" }).click();
  await korist.waitForFunction((id) => document.querySelector(`[data-midi-button="${id}"] [data-midi-player]`)?.dataset.state === "playing", second.id);
  check((await player.getAttribute("data-state")) === "paused", "AC51 starting another file stops the first");
  const secondRow = korist.locator(`[data-midi-button="${second.id}"]`);
  await secondRow.getByRole("button", { name: "Kapat: E2E ikinci · Alto" }).click();
  check(
    (await secondRow.locator("[data-midi-player]").count()) === 0 &&
      (await secondRow.getByRole("button", { name: "Çal: E2E ikinci · Alto" }).count()) === 1 &&
      (await korist.getByRole("button", { name: "Kapat: MIDI · Tutti" }).count()) === 1,
    "review P3-7 an open row trigger is Kapat (no second pause); it collapses the panel",
  );

  // AC 53
  const ownHw = (await one("select id from assignments where piece_id = ?", [piece])).id;
  await go(korist, `${BASE}/odevler/${A}`);
  check(
    (await korist.locator(`[data-midi-button="${alto}"]`).getByRole("button", { name: "MIDI'yi çal" }).count()) === 1 &&
      (await korist.getByRole("link", { name: /^Partisyonumu aç \(Alto\)/ }).count()) === 1,
    "AC53 A's step 1 offers MIDI'yi çal for the Alto file, the Drive part as a text link under it",
  );
  await korist.getByRole("button", { name: "MIDI'yi çal" }).click();
  await korist.waitForFunction((id) => document.querySelector(`[data-midi-button="${id}"] [data-midi-player]`)?.dataset.state === "playing", alto);
  check(true, "AC53 MIDI'yi çal plays inline");
  await db.execute({ sql: "delete from midi_files where id = ?", args: [second.id] });
  await go(korist, `${BASE}/odevler/${ownHw}`);
  check((await korist.locator(`[data-midi-button="${tutti.id}"]`).count()) === 1, "AC53 with only a Tutti file it plays the Tutti one");
  await go(korist, `${BASE}/odevler/${B}`);
  check((await korist.getByRole("button", { name: "MIDI'yi çal" }).count()) === 0, "AC53 without MIDI there is no button");

  // ------------------------------------------------------------------ AC 49
  for (const [who, p] of [["sef", sef], ["yk", yk]]) {
    await go(p, `${BASE}/repertuvar/${piece}/duzenle`);
    check((await p.locator("h2", { hasText: "MIDI dosyaları" }).count()) === 1, `AC49 ${who}@ sees MIDI dosyaları on the edit page`);
  }
  await korist.goto(`${BASE}/repertuvar/${piece}/duzenle`);
  await korist.waitForURL((u) => !u.pathname.endsWith("/duzenle"), { timeout: 8000 }).catch(() => {});
  check(!korist.url().endsWith("/duzenle"), "AC49 korist@ can't reach the edit page");
  await go(korist, `${BASE}/repertuvar/${piece}`);
  const midiAct = await actionIds(MIDI_ACTIONS, piece);
  check(
    (await callAction(korist, midiAct.deleteMidi, [tutti.id])).includes("Bu işlem için yetkin yok.") &&
      (await callAction(korist, midiAct.uploadMidi, [piece, {}, {}])).includes("Bu işlem için yetkin yok.") &&
      Boolean(await one("select 1 from midi_files where id = ?", [tutti.id])),
    "AC49 the upload and delete actions refuse korist@",
  );
  const upload = async (name, buffer, { part, label } = {}) => {
    await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
    const form = sef.getByTestId("midi-upload");
    await sef.getByTestId("midi-file").setInputFiles({ name, mimeType: "audio/midi", buffer });
    if (part) await form.locator("label", { hasText: new RegExp(`^${part}$`) }).click();
    if (label !== undefined) await form.getByLabel("Etiket").fill(label);
    await form.getByRole("button", { name: "Yükle" }).click();
  };
  await upload("parca.mid", midiBytes({ tracks: [{ name: "Alto", notes: [[69, 0, 400, 80]] }] }), { part: "Alto", label: "Alto önde" });
  await sef.locator("[data-sonner-toast]", { hasText: "Dosya yüklendi." }).waitFor();
  await sef.locator("[data-testid=midi-editor-row]", { hasText: "Alto önde · Alto" }).waitFor();
  check(true, "AC49 the upload lists Alto önde · Alto");
  const errorOf = async () => (await sef.getByTestId("midi-file-error").textContent())?.trim();
  await upload("sahte.mid", Buffer.from("MThx not a midi file at all"));
  await sef.getByTestId("midi-file-error").waitFor();
  check((await errorOf()) === "Bu bir MIDI dosyası değil (.mid).", "AC49 bytes that aren't MThd are refused");
  const big = Buffer.concat([midiBytes({ tracks: [{ name: "x", notes: [[60, 0, 10, 80]] }] }), Buffer.alloc(1_048_577)]).subarray(0, 1_048_577);
  await upload("buyuk.mid", big);
  await sef.getByTestId("midi-file-error").waitFor();
  check((await errorOf()) === "MIDI dosyası en fazla 1 MB olabilir.", "AC49 1,048,577 bytes → MIDI dosyası en fazla 1 MB olabilir.");
  await upload("etiket.mid", midiBytes({ tracks: [{ name: "x", notes: [[60, 0, 10, 80]] }] }), { label: "e".repeat(61) });
  await sef.locator("#label-error").waitFor();
  check((await sef.locator("#label-error").textContent()) === "Etiket en fazla 60 karakter olabilir.", "AC49 a 61-character Etiket is refused");
  const count = Number((await one("select count(*) as n from midi_files where piece_id = ?", [piece])).n);
  for (let i = count; i < 20; i++) await insertMidi(piece, { bytes: midiBytes({ tracks: [{ name: "x", notes: [[60, 0, 10, 80]] }] }) });
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  check(
    (await sef.locator("text=Bir esere en fazla 20 MIDI dosyası eklenebilir.").count()) === 1,
    "AC49 at 20 files: Bir esere en fazla 20 MIDI dosyası eklenebilir.",
  );

  // ------------------------------------------------------------------ AC 57 (edit section, open player)
  for (const colorScheme of ["light", "dark"]) {
    const p = await loginAs(browser, "sef@arkhe.local", { phone: true, context: { colorScheme } });
    await go(p, `${BASE}/repertuvar/${piece}/duzenle`);
    const found = [...(await axe(p, "#midi-dosyalari")), ...(await layoutIssues(p, "#midi-dosyalari"))];
    if (shots) await p.screenshot({ path: `${shots}/p9-midi-editor-375-${colorScheme}.png`, fullPage: true });
    const k = await loginAs(browser, "korist@arkhe.local", { phone: true, context: { colorScheme } });
    await go(k, `${BASE}/repertuvar/${ave}`);
    await k.getByRole("button", { name: "Çal: MIDI · Tutti" }).click();
    await k.locator("[data-midi-player][data-state=playing]").waitFor();
    found.push(...(await axe(k, "main")), ...(await layoutIssues(k)));
    if (shots) await k.screenshot({ path: `${shots}/p9-piece-midi-375-${colorScheme}.png`, fullPage: true });
    check(found.length === 0, `AC57 MIDI editor and the open player at 375 ${colorScheme}: clean (${found.slice(0, 4)})`);
    await p.context().close();
    await k.context().close();
  }

  // ------------------------------------------------------------------ AC 54
  await db.execute({ sql: "delete from midi_files where piece_id = ? and label is null and id <> ?", args: [piece, tutti.id] });
  const labelled = await one("select id, storage_key from midi_files where piece_id = ? and label = 'Alto önde'", [piece]);
  await go(sef, `${BASE}/repertuvar/${piece}/duzenle`);
  await sef.getByRole("button", { name: "Diğer işlemler: Alto önde · Alto" }).click();
  await sef.getByRole("menuitem", { name: "Sil" }).click();
  const dlg = sef.getByRole("alertdialog");
  check((await dlg.textContent()).includes('"Alto önde" silinsin mi?'), 'AC54 Sil confirms "<etiket>" silinsin mi?');
  await dlg.getByRole("button", { name: "Sil" }).click();
  await sef.locator("[data-sonner-toast]", { hasText: "Dosya silindi." }).waitFor();
  await go(korist, `${BASE}/repertuvar/${piece}?partisyon=tumu`);
  check(
    !(await one("select 1 from midi_files where id = ?", [labelled.id])) &&
      !(await fileExists(labelled.storage_key)) &&
      (await korist.locator("[data-testid=midi-row]", { hasText: "Alto önde" }).count()) === 0,
    "AC54 the row and the file go; the detail no longer lists it",
  );
  const lone = (await insertAssignment({ dueDays: 1, title: "E2E MIDI Silinecek" })).piece;
  await db.execute({ sql: "delete from assignments where piece_id = ?", args: [lone] });
  const loneFile = await insertMidi(lone, { bytes: longMidi({ seconds: 2 }) });
  const pieceAct = await actionIds(PIECE_ACTIONS, lone);
  await callAction(sef, pieceAct.deletePiece, [lone]);
  check(
    !(await one("select 1 from pieces where id = ?", [lone])) && !(await fileExists(loneFile.key)),
    "AC54 deleting an E2E piece with MIDI files works and removes the files",
  );
  check(
    (await callAction(sef, pieceAct.deletePiece, [piece])).length > 0 && Boolean(await one("select 1 from pieces where id = ?", [piece])),
    "AC54 a piece with homework is still refused (Phase 4 rule)",
  );
  check(await fileExists(tenorFile.key), "AC50 the arranged tenor file stays until cleanup");

  for (const p of [sef, yk, korist, anon]) await p.context().close();
}
