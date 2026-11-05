// Phase 13 B: Partisyonu çal / Tutti'yi çal on the homework page, before or during a take (then the
// voice is recorded with it); "Tutti'yi kayıtla birlikte başlat" starts Tutti with the take.
import { BASE, check, cleanup, loginAs } from "./lib.mjs";
import { go, insertAssignment, insertMidi, longMidi, micPage, wavBytes } from "./media.mjs";

const KORIST = "korist@arkhe.local";

/** Counts buffer sources (with their length) and oscillators started on the page. */
async function watchAudio(page) {
  await page.addInitScript(() => {
    window.__buffers = [];
    window.__oscillators = 0;
    const bufferStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__buffers.push(Math.round(this.buffer?.duration ?? 0));
      return bufferStart.apply(this, args);
    };
    const oscStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.__oscillators += 1;
      return oscStart.apply(this, args);
    };
  });
}

async function uploadAudio(page, pieceId, part, body) {
  const res = await page.request.post(`${BASE}/api/dosya/ses?eser=${pieceId}&ses=${part}`, {
    headers: { Origin: BASE, "X-Upload-Id": crypto.randomUUID(), "Content-Type": "application/octet-stream" },
    data: body,
    failOnStatusCode: false,
  });
  return res.status();
}

async function startTake(page) {
  await page.getByRole("button", { name: "Kayda başla" }).click();
  await page.getByRole("button", { name: "Kaydı durdur" }).waitFor({ timeout: 20000 });
}

export default async function run(browser) {
  await cleanup();
  try {
    await suite(browser);
  } finally {
    await cleanup();
  }
}

async function suite(browser) {
  const sef = await loginAs(browser, "sef@arkhe.local");
  const PART = wavBytes({ seconds: 7, hz: 330, rate: 48000 });
  const TUTTI = wavBytes({ seconds: 9, hz: 262, rate: 48000 });

  // ------------------------------------------------------------------ rehearsal audio
  const hw = await insertAssignment({ dueDays: 3, parts: ["alto"], title: "E2E Eşlik Ses" });
  const ups = [await uploadAudio(sef, hw.piece, "alto", PART), await uploadAudio(sef, hw.piece, "tutti", TUTTI)];
  check(ups.every((s) => s === 201), `play-along: the alto and Tutti audio upload (${ups})`);

  const korist = await micPage(browser, KORIST);
  await watchAudio(korist);
  let asked = 0;
  korist.on("request", (r) => {
    if (r.url().includes("/api/dosya/ses/")) asked += 1;
  });
  await go(korist, `${BASE}/odevler/${hw.id}`);
  const option = korist.getByTestId("tutti-with-take");
  check(
    (await korist.getByTestId("along-part").getAttribute("aria-label")).startsWith("Partisyonu çal (Ses kaydı: Alto") &&
      (await korist.getByTestId("along-tutti").getAttribute("aria-label")).startsWith("Tutti'yi çal") &&
      (await option.isVisible()) &&
      !(await option.locator("input[type=checkbox]").isChecked()) &&
      asked === 0,
    "play-along: both buttons and the unticked option show; nothing loads yet",
  );

  // Before a take: one at a time, the same button stops it.
  await korist.getByTestId("along-part").click();
  await korist.getByRole("button", { name: /^Partisyonu durdur/ }).waitFor({ timeout: 15000 });
  await korist.getByTestId("along-tutti").click();
  await korist.getByRole("button", { name: /^Tutti'yi durdur/ }).waitFor({ timeout: 15000 });
  check(
    (await korist.getByRole("button", { name: /^Partisyonu durdur/ }).count()) === 0 &&
      JSON.stringify(await korist.evaluate(() => window.__buffers)) === "[7,9]",
    "play-along: before a take, Partisyon then Tutti play on the page, one at a time",
  );
  await korist.getByTestId("along-tutti").click();
  await korist.getByRole("button", { name: /^Tutti'yi çal/ }).waitFor();
  check(true, "play-along: Tutti'yi durdur stops it");

  // During a take, without the option: nothing starts on its own, Tutti starts on a tap.
  await korist.evaluate(() => (window.__buffers = []));
  await startTake(korist);
  await korist.waitForTimeout(1500);
  // The fake microphone plays its own 4 s tone; the 7 s part and 9 s Tutti must not start.
  const silent = await korist.evaluate(() => window.__buffers);
  check(!silent.includes(7) && !silent.includes(9), `play-along: unticked, the take starts silent (${silent})`);
  await korist.getByTestId("along-tutti").click();
  await korist.getByRole("button", { name: /^Tutti'yi durdur/ }).waitFor({ timeout: 15000 });
  check((await korist.evaluate(() => window.__buffers)).includes(9), "play-along: Tutti'yi çal plays mid-take");
  await korist.getByRole("button", { name: "Kaydı durdur" }).click();
  await korist.getByRole("button", { name: "Kaydı gönder" }).waitFor({ timeout: 15000 });
  check(
    (await korist.getByRole("button", { name: /durdur/ }).count()) === 0,
    "play-along: stopping the take stops Tutti; the take can be sent",
  );
  check(asked === 2, `play-along: each audio file is fetched once, even across takes (${asked} requests)`);
  await korist.context().close();

  // With the option: Tutti loads in the count-in and starts with the take.
  const hw2 = await insertAssignment({ dueDays: 3, parts: ["alto"], title: "E2E Eşlik Birlikte" });
  await uploadAudio(sef, hw2.piece, "tutti", TUTTI);
  const korist2 = await micPage(browser, KORIST);
  await watchAudio(korist2);
  await go(korist2, `${BASE}/odevler/${hw2.id}`);
  check((await korist2.getByTestId("along-part").count()) === 0, "play-along: no part file, no Partisyonu çal");
  await korist2.getByTestId("tutti-with-take").locator("input[type=checkbox]").check();
  await startTake(korist2);
  await korist2.getByRole("button", { name: /^Tutti'yi durdur/ }).waitFor({ timeout: 15000 });
  check((await korist2.evaluate(() => window.__buffers)).includes(9), "play-along: ticked, Tutti starts with the take");
  await korist2.getByRole("button", { name: "Kaydı durdur" }).click();
  await korist2.context().close();

  // ------------------------------------------------------------------ MIDI fallback
  const hw3 = await insertAssignment({ dueDays: 3, parts: ["alto"], title: "E2E Eşlik MIDI" });
  await insertMidi(hw3.piece, { part: "alto", bytes: longMidi({ seconds: 10, names: ["Alto"] }) });
  const korist3 = await micPage(browser, KORIST);
  await watchAudio(korist3);
  await go(korist3, `${BASE}/odevler/${hw3.id}`);
  check(
    (await korist3.getByTestId("along-part").getAttribute("aria-label")) === "Partisyonu çal (MIDI)" &&
      (await korist3.getByTestId("along-tutti").count()) === 0 &&
      (await korist3.getByTestId("tutti-with-take").count()) === 0,
    "play-along: with only an alto MIDI, Partisyonu çal plays it and there is no Tutti",
  );
  await startTake(korist3);
  await korist3.getByTestId("along-part").click();
  await korist3.getByRole("button", { name: /^Partisyonu durdur/ }).waitFor({ timeout: 15000 });
  await korist3.waitForTimeout(1500);
  const oscillators = await korist3.evaluate(() => window.__oscillators);
  check(oscillators > 0, `play-along: the MIDI part sounds during the take (${oscillators} notes)`);
  await korist3.getByRole("button", { name: "Kaydı durdur" }).click();
  await korist3.context().close();
  await sef.context().close();
}
