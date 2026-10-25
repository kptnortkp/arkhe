// Phase 11 S5: the player's Turkish track names, Kadın/Erkek mapping, per-track levels and `önde`.
import { BASE, check, cleanup, loginAs } from "./lib.mjs";
import { axe, go, insertAssignment, insertMidi, layoutIssues, midiBytes } from "./media.mjs";

/** A multi-track MIDI: `[name, velocity]` per track, `seconds` of quarter notes at 60 bpm. */
function tracksMidi(spec, seconds = 30) {
  return midiBytes({
    bpm: 60,
    tracks: spec.map(([name, vel], i) => ({
      name,
      notes: Array.from({ length: seconds }, (_, k) => [52 + i * 5, k * 480, 450, vel]),
    })),
  });
}

/** The same MIDI with the first `from` byte sequence swapped for raw `to` bytes (a Latin-1 name). */
function patchName(bytes, from, to) {
  const at = bytes.indexOf(Buffer.from(from, "latin1"));
  return Buffer.concat([bytes.subarray(0, at), Buffer.from(to), bytes.subarray(at + to.length)]);
}

export default async function run(browser, shots) {
  await cleanup();
  try {
    await suite(browser, shots);
  } finally {
    await cleanup();
  }
}

async function open(page, id) {
  await page.locator(`[data-midi-button="${id}"]`).getByRole("button", { name: /^Çal:/ }).click();
  await page.waitForFunction(
    (x) => document.querySelector(`[data-midi-button="${x}"] [data-midi-player]`)?.dataset.state === "playing",
    id,
  );
  return page.locator(`[data-midi-button="${id}"] [data-midi-player]`);
}

const mixOf = (player) =>
  player.locator("[data-track]").evaluateAll((els) =>
    els.map((e) => `${e.dataset.track}:${e.dataset.muted === "true" ? "off" : "on"}:${e.dataset.level}`).join(" "),
  );

async function suite(browser, shots) {
  const { piece } = await insertAssignment({ dueDays: 5, title: "E2E Oynatıcı Eseri" });
  const ke = await insertMidi(piece, {
    label: "E2E Kadın Erkek",
    bytes: tracksMidi([["Kadın", 96], ["Erkek", 96], ["Piyano", 64]]),
  });
  const latin = await insertMidi(piece, {
    label: "E2E Latin",
    // 0xFD alone is not valid UTF-8: the old Latin-1 reading (ý) stays.
    bytes: patchName(tracksMidi([["KadXn", 96], ["Tenor", 96]], 4), "KadXn", [0x4b, 0x61, 0x64, 0xfd, 0x6e]),
  });
  const mixed = await insertMidi(piece, {
    label: "E2E Karışık",
    bytes: tracksMidi([["Soprano", 96], ["Kadınlar", 96], ["Bas 1", 96], ["Bas 2", 96], ["Piano", 64]], 8),
  });

  // ------------------------------------------------------------------ AC 22, 23, 24 as a bass
  const bass = await loginAs(browser, "ozan.yilmaz@arkhe.local");
  await go(bass, `${BASE}/repertuvar/${piece}`);
  let player = await open(bass, ke.id);
  check(
    (await mixOf(player)) === "Kadın:on:100 Erkek:on:100 Piyano:on:50",
    `AC22/24 UTF-8 names Kadın, Erkek, Piyano; the piano starts at 50 (${await mixOf(player)})`,
  );
  check(
    (await player.getByRole("checkbox", { name: /Piyano.*%50/ }).count()) === 1,
    "AC24 the piano chip says %50 in text",
  );
  const presets = await player.locator("[data-preset]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check(
    JSON.stringify(presets) === '["Yalnız Bas","Bas önde","Bassız (sen söyle)"]',
    `AC23 a bass gets Yalnız Bas, Bas önde, Bassız (sen söyle) on a Kadın/Erkek/Piyano file (${presets})`,
  );
  await player.getByRole("button", { name: "Yalnız Bas" }).click();
  check(
    (await mixOf(player)) === "Kadın:off:100 Erkek:on:100 Piyano:off:50" &&
      (await player.getByRole("button", { name: "Yalnız Bas" }).getAttribute("aria-pressed")) === "true",
    `AC23 Yalnız Bas leaves only Erkek on (${await mixOf(player)})`,
  );
  await player.getByRole("button", { name: "Bas önde" }).click();
  check(
    (await mixOf(player)) === "Kadın:on:30 Erkek:on:100 Piyano:on:30" &&
      (await player.getByRole("button", { name: "Bas önde" }).getAttribute("aria-pressed")) === "true" &&
      (await player.getByRole("button", { name: "Yalnız Bas" }).getAttribute("aria-pressed")) === "false",
    `AC24 Bas önde: Erkek 100, the rest 30 (${await mixOf(player)})`,
  );
  if (shots) await bass.screenshot({ path: `${shots}/p11-player-1280.png`, fullPage: true });
  await player.locator("[data-track=Piyano]").click();
  check((await mixOf(player)) === "Kadın:on:30 Erkek:on:100 Piyano:off:30", "AC24 a chip turns off and keeps its level");
  await player.locator("[data-track=Piyano]").click();
  check(
    (await mixOf(player)) === "Kadın:on:30 Erkek:on:100 Piyano:on:30" && (await player.getAttribute("data-state")) === "playing",
    "AC24 and back on at the same level, still playing",
  );
  await player.getByRole("button", { name: "Bassız (sen söyle)" }).click();
  check(
    (await mixOf(player)) === "Kadın:on:100 Erkek:off:100 Piyano:on:50",
    `AC23 Bassız mutes Erkek, the rest back to their start levels (${await mixOf(player)})`,
  );

  // AC 22 Latin-1 fallback; AC 23 several tracks of my part, exact names over Kadınlar
  player = await open(bass, latin.id);
  check(
    (await mixOf(player)) === "Kadýn:on:100 Tenor:on:100",
    `AC22 a name that isn't valid UTF-8 keeps its Latin-1 reading (${await mixOf(player)})`,
  );
  player = await open(bass, mixed.id);
  await player.getByRole("button", { name: "Yalnız Bas" }).click();
  check(
    (await mixOf(player)) === "Soprano:off:100 Kadınlar:off:100 Bas 1:on:100 Bas 2:on:100 Piano:off:50",
    `AC23 Yalnız Bas keeps both Bas tracks on (${await mixOf(player)})`,
  );
  await bass.context().close();

  // ------------------------------------------------------------------ AC 23 as a soprano and an alto
  const sop = await loginAs(browser, "yk@arkhe.local");
  await go(sop, `${BASE}/repertuvar/${piece}`);
  player = await open(sop, ke.id);
  await player.getByRole("button", { name: "Yalnız Soprano" }).click();
  check(
    (await mixOf(player)) === "Kadın:on:100 Erkek:off:100 Piyano:off:50",
    "AC23 a soprano's Yalnız Soprano acts on the Kadın track",
  );
  await player.getByRole("button", { name: "Sopranosuz (sen söyle)" }).click();
  check((await mixOf(player)) === "Kadın:off:100 Erkek:on:100 Piyano:on:50", "AC23 Sopranosuz turns Kadın off");
  player = await open(sop, mixed.id);
  await player.getByRole("button", { name: "Soprano önde" }).click();
  check(
    (await mixOf(player)) === "Soprano:on:100 Kadınlar:on:30 Bas 1:on:30 Bas 2:on:30 Piano:on:30",
    `AC23 the exact Soprano track wins over Kadınlar (${await mixOf(player)})`,
  );
  await sop.context().close();

  // ------------------------------------------------------------------ AC 29 the player at 375 px
  for (const colorScheme of ["light", "dark"]) {
    const k = await loginAs(browser, "korist@arkhe.local", { phone: true, context: { colorScheme } });
    await go(k, `${BASE}/repertuvar/${piece}`);
    player = await open(k, ke.id);
    await player.getByRole("button", { name: "Alto önde" }).click();
    const found = [...(await axe(k, "main")), ...(await layoutIssues(k))];
    if (shots) await player.screenshot({ path: `${shots}/p11-player-375-${colorScheme}.png` });
    check(found.length === 0, `AC29 the player with presets at 375 ${colorScheme}: clean (${found.slice(0, 4)})`);
    await k.context().close();
  }
}
