// Phase 13 B: play-along while recording. The part's rehearsal audio (else the MIDI) loads during
// the count-in, starts with the take and stops with it.
import { BASE, check, cleanup, db, loginAs } from "./lib.mjs";
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

async function recordFor(page, ms) {
  await page.getByRole("button", { name: "Kayda başla" }).click();
  await page.waitForFunction(() => document.querySelector("[data-recorder]")?.getAttribute("data-state") === "recording", null, { timeout: 20000 }).catch(() => {});
  await page.getByRole("button", { name: "Kaydı durdur" }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(ms);
  await page.getByRole("button", { name: "Kaydı durdur" }).click();
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

  // ------------------------------------------------------------------ rehearsal audio
  const withAudio = await insertAssignment({ dueDays: 3, parts: ["alto"], title: "E2E Eşlik Ses" });
  const status = await uploadAudio(sef, withAudio.piece, "alto", wavBytes({ seconds: 7, hz: 330, rate: 48000 }));
  check(status === 201, `play-along: the alto rehearsal audio uploads (${status})`);

  const korist = await micPage(browser, KORIST);
  await watchAudio(korist);
  await go(korist, `${BASE}/odevler/${withAudio.id}`);
  const option = korist.getByTestId("play-along");
  check(
    (await option.isVisible()) &&
      (await option.locator("input[type=checkbox]").isChecked()) &&
      (await option.innerText()).includes("Ses kaydı: Alto"),
    "play-along: the option is on by default and names the alto audio",
  );
  const fetched = korist.waitForResponse((r) => r.url().includes("/api/dosya/ses/") && r.status() === 200, { timeout: 15000 }).catch(() => null);
  await recordFor(korist, 2000);
  check(Boolean(await fetched), "play-along: the audio loads during the count-in");
  const buffers = await korist.evaluate(() => window.__buffers);
  check(buffers.includes(7), `play-along: the 7 s part starts with the take (${buffers})`);
  await korist.getByRole("button", { name: "Kaydı gönder" }).waitFor({ timeout: 15000 });
  check(true, "play-along: the take finishes and can be sent");

  // Off: nothing is fetched or played.
  const offHw = await insertAssignment({ dueDays: 3, parts: ["alto"], title: "E2E Eşlik Kapalı" });
  await uploadAudio(sef, offHw.piece, "alto", wavBytes({ seconds: 7, hz: 330, rate: 48000 }));
  await go(korist, `${BASE}/odevler/${offHw.id}`);
  await korist.getByTestId("play-along").locator("input[type=checkbox]").uncheck();
  let asked = false;
  korist.on("request", (r) => {
    if (r.url().includes("/api/dosya/ses/")) asked = true;
  });
  await korist.evaluate(() => (window.__buffers = []));
  await recordFor(korist, 1500);
  const after = await korist.evaluate(() => window.__buffers);
  check(!asked && !after.includes(7), "play-along: unchecked, the part neither loads nor plays");
  await korist.context().close();

  // ------------------------------------------------------------------ MIDI fallback
  const withMidi = await insertAssignment({ dueDays: 3, parts: ["alto"], title: "E2E Eşlik MIDI" });
  await insertMidi(withMidi.piece, { part: "alto", bytes: longMidi({ seconds: 10, names: ["Alto"] }) });
  const korist2 = await micPage(browser, KORIST);
  await watchAudio(korist2);
  await go(korist2, `${BASE}/odevler/${withMidi.id}`);
  check(
    (await korist2.getByTestId("play-along").innerText()).includes("MIDI"),
    "play-along: without audio, the option plays the MIDI",
  );
  await recordFor(korist2, 2000);
  const oscillators = await korist2.evaluate(() => window.__oscillators);
  check(oscillators > 0, `play-along: the MIDI part sounds during the take (${oscillators} notes)`);
  await korist2.context().close();
  await sef.context().close();
}
