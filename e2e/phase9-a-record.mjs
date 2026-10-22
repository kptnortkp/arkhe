// Phase 9 S1/S2/S6: the singer records, uploads, replaces and deletes; upload hygiene; the
// fallback disclosure; faults. Runs in its own Chrome with the D27 media flags.
import { HOMEWORK_IDS, seedHomework } from "../scripts/homework-fixture.mjs";
import { reconcileLocalUploads } from "../scripts/media-fixture.mjs";
import {
  actionIds,
  BASE,
  callAction,
  check,
  cleanup,
  consoleErrors,
  db,
  login,
  loginAs,
  newPage,
  userId,
} from "./lib.mjs";
import {
  axe,
  go,
  currentTake,
  fileExists,
  insertTake,
  launchWithMic,
  layoutIssues,
  micPage,
  mp3Bytes,
  one,
  PNG,
  rawHex,
  recordingFiles,
  requestLog,
  setHook,
  uploadRaw,
  wavBytes,
  wavOfSize,
} from "./media.mjs";

const { a: A, b: B, c: C, d: D, f: F } = HOMEWORK_IDS;
const KORIST = "korist@arkhe.local";
const KAYIT = "src/app/(portal)/odevler/kayit-actions.ts";
const ODEV = "src/app/(portal)/odevler/actions.ts";
const today = () =>
  new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short" }).format(
    new Date(),
  );

async function reset() {
  await seedHomework(db, new Date());
  await db.batch(
    ["delete from storage_deletions", "delete from storage_events", "delete from login_attempts where key like 'upload:%'"],
    "write",
  );
  await reconcileLocalUploads(db);
}

const recorder = (page) => page.locator("[data-recorder]");
const state = (page) => recorder(page).getAttribute("data-state");
async function waitState(page, s, timeout = 15000) {
  await page.waitForFunction(
    (want) => document.querySelector("[data-recorder]")?.getAttribute("data-state") === want,
    s,
    { timeout },
  );
}
/** Waits until no finite animation or transition is running inside `selector` (infinite pulses are fine). */
async function settled(page, selector) {
  await page
    .waitForFunction(
      (sel) => {
        const root = document.querySelector(sel);
        if (!root) return false;
        return root
          .getAnimations({ subtree: true })
          .every((a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity);
      },
      selector,
      { timeout: 5_000 },
    )
    .catch(() => {});
}
async function badge(page) {
  const el = page.locator("[data-nav-badge]").first();
  return (await el.count()) ? el.getAttribute("data-nav-badge") : null;
}
async function chip(page) {
  const b = page.locator("header [data-testid=deadline-badge]").first();
  return { tone: await b.getAttribute("data-tone"), text: (await b.textContent()).trim() };
}

async function record(page, ms = 3000) {
  await page.getByRole("button", { name: "Kayda başla" }).click();
  await waitState(page, "recording");
  await page.waitForTimeout(ms);
  await page.getByRole("button", { name: "Kaydı durdur" }).click();
  await waitState(page, "recorded");
}

async function send(page) {
  await page.getByRole("button", { name: "Kaydı gönder" }).click();
  await waitState(page, "sent");
}

async function openFallback(page) {
  const d = page.locator("#baska-yolla");
  if (!(await d.evaluate((el) => el.open))) await d.locator("summary").click();
}

async function pickFile(page, name, buffer, mimeType = "audio/wav") {
  await page.locator("[data-testid=recording-file]").setInputFiles({ name, mimeType, buffer });
}

export default async function run(_shared, shots) {
  await cleanup();
  const { browser, close } = await launchWithMic();
  try {
    await suite(browser, shots);
  } finally {
    await close();
    await cleanup();
  }
  // AC 1: cleanup leaves only the seeded files in data/uploads/recordings.
  const left = await recordingFiles();
  check(
    left.length === 6 && left.every((n) => n.startsWith("00000000-0000-4000-9001-")),
    `AC1 cleanup leaves only the 6 seeded recordings (${left.length})`,
  );
}

async function suite(browser, shots) {
  const korist = await micPage(browser, KORIST);
  const sef = await loginAs(browser, "sef@arkhe.local");
  const koristId = await userId(KORIST);

  // ------------------------------------------------------------------ AC 7, 34
  await go(korist, `${BASE}/`);
  const homeLink = korist.locator("[data-testid=home-homework] [data-testid=record-link]");
  check(
    (await homeLink.count()) === 1 &&
      /^\/odevler\/[0-9a-f-]+#kayit$/.test(await homeLink.getAttribute("href")) &&
      (await korist.locator("[data-testid=submit-row]").count()) === 0,
    "AC34 home Ödevlerim offers Kaydını yap → /odevler/<id>#kayit, no inline Teslim ettim",
  );
  await go(korist, `${BASE}/odevler`);
  const links = korist.locator("[data-testid=todo-list] [data-testid=record-link]");
  check(
    (await links.count()) === 4 &&
      (await links.first().textContent()).includes("Kaydını yap") &&
      (await korist.locator(`[data-testid=homework-row][data-id="${A}"] [data-testid=record-link]`).getAttribute("href")) ===
        `/odevler/${A}#kayit`,
    "AC34 every unsubmitted list row links Kaydını yap to #kayit",
  );

  const log = requestLog(korist);
  await go(korist, `${BASE}/odevler/${A}?k=${Date.now()}`);
  const card = korist.locator("[data-testid=singer-card]");
  check(
    (await state(korist)) === "idle" &&
      (await card.locator("text=Partisyonunu dinle").count()) === 1 &&
      (await card.locator("text=Kaydını yap").count()) === 1 &&
      (await card.locator("text=Gönderdiysen işaretle").count()) === 0,
    "AC7 idle: the two steps Partisyonunu dinle and Kaydını yap, no step 3",
  );
  const listeners = korist.locator("[data-testid=listeners]");
  check(
    (await listeners.textContent()).includes("Demo Asistan") &&
      (await listeners.locator("details").textContent()).includes(
        "Kaydını şef ve şefin atadığı dinleme asistanları dinler: Demo Asistan.",
      ) &&
      (await listeners.locator("details").textContent()).includes(
        "Ses dosyası, şef yorumundan 90 gün sonra silinir.",
      ) &&
      (await listeners.locator("summary").boundingBox()).height >= 44,
    "AC7/AC21 transparency names Demo Asistan; the D11 sentences sit in the 44 px disclosure",
  );
  check(
    (await korist.getByRole("button", { name: "Kayda başla" }).isVisible()) &&
      (await korist.getByRole("button", { name: "Dosya yükle" }).isVisible()) &&
      !log.some((r) => r.url.includes("/api/dosya/")),
    "AC7 Kayda başla and Dosya yükle; no /api/dosya request yet",
  );
  if (shots) await korist.screenshot({ path: `${shots}/p9-recorder-idle.png`, fullPage: true });

  await korist.getByRole("button", { name: "Kayda başla" }).click();
  await korist.locator("[data-testid=count-in]").waitFor();
  check(
    (await korist.locator("text=Hazırlan…").count()) === 1 &&
      ["3", "2", "1", "…"].includes((await korist.locator("[data-testid=count-in]").textContent()).trim()) &&
      (await korist.getByRole("button", { name: "Vazgeç" }).isVisible()),
    "AC7 the silent count-in Hazırlan… 3 · 2 · 1 with Vazgeç",
  );
  await waitState(korist, "recording");
  await korist.waitForTimeout(1500);
  const timer = (await korist.locator("[data-testid=rec-timer]").textContent()).trim();
  check(
    /^0:0\d \/ 10:00$/.test(timer) &&
      (await korist.getByRole("button", { name: "Kaydı durdur" }).isVisible()) &&
      (await korist.locator("[role=timer]").count()) === 1,
    `AC7 recording: timer ${timer}, Durdur (Kaydı durdur), role=timer`,
  );
  // The fake microphone's tone can take a moment to reach the analyser under load.
  await korist
    .waitForFunction(() => document.querySelector("[data-recorder]")?.getAttribute("data-level") === "ok", null, {
      timeout: 10_000,
    })
    .catch(() => {});
  check((await recorder(korist).getAttribute("data-level")) === "ok", "AC7 the level meter hears the tone");
  if (shots) await korist.screenshot({ path: `${shots}/p9-recorder-recording.png` });
  await korist.waitForTimeout(3000);
  // The take's own clock restarts if the first encoder fails; stop once it has run 5 s.
  await korist.waitForFunction(
    () => {
      const m = /^(\d+):(\d\d)/.exec(document.querySelector("[data-testid=rec-timer]")?.textContent?.trim() ?? "");
      return m !== null && Number(m[1]) * 60 + Number(m[2]) >= 5;
    },
    null,
    { timeout: 15_000 },
  );
  await korist.getByRole("button", { name: "Kaydı durdur" }).click();
  await waitState(korist, "recorded");
  check(
    (await korist.getByRole("button", { name: "Kaydını dinle" }).isVisible()) &&
      (await korist.getByRole("button", { name: "Kaydı gönder" }).isVisible()) &&
      (await korist.getByRole("button", { name: "Yeniden kaydet" }).isVisible()) &&
      !log.some((r) => r.url.includes("/api/dosya/")),
    "AC7 stopped: Dinle, Gönder, Yeniden kaydet; still no upload request",
  );
  if (shots) await korist.screenshot({ path: `${shots}/p9-recorder-recorded.png`, fullPage: true });

  await korist.route("**/api/dosya/kayit?**", async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await korist.getByRole("button", { name: "Kaydı gönder" }).click();
  await korist.locator("[role=progressbar]").waitFor({ timeout: 3000 }).catch(() => {});
  const sawProgress = (await korist.locator("[role=progressbar]").count()) > 0 || (await state(korist)) === "uploading";
  await waitState(korist, "sent");
  await korist.unroute("**/api/dosya/kayit?**");
  const sent = (await korist.locator("[data-testid=recording-sent]").textContent()).trim();
  check(
    sawProgress && new RegExp(`^Kaydın gönderildi · ${today()} \\d\\d:\\d\\d · 0:0\\d$`).test(sent),
    `AC7 Gönder shows progress, then "${sent}"`,
  );
  check(
    (await korist.getByRole("button", { name: "Değiştir" }).isVisible()) &&
      (await korist.getByRole("button", { name: "Sil" }).isVisible()) &&
      (await korist.getByRole("button", { name: "Kaydını dinle" }).isVisible()),
    "AC7 sent: Dinle, Değiştir, Sil",
  );
  const take = await currentTake(A, KORIST);
  check(
    take &&
      Number(take.size_bytes) >= 5_000 &&
      Number(take.size_bytes) <= 80_000 &&
      /^audio\/(mp4|webm|ogg)$/.test(take.content_type) &&
      /^recordings\/[0-9a-f-]{36}\.(m4a|webm|ogg)$/.test(take.storage_key) &&
      Number(take.duration_ms) >= 4000 &&
      (await fileExists(take.storage_key)),
    `AC1/AC7 one UUID-named file with key, size ${take?.size_bytes}, type ${take?.content_type}, duration ${take?.duration_ms}`,
  );
  if (shots) await korist.screenshot({ path: `${shots}/p9-recorder-sent.png`, fullPage: true });

  // ------------------------------------------------------------------ AC 8
  const c8 = await chip(korist);
  check(c8.tone === "done" && c8.text === `Teslim edildi · ${today()}`, `AC8 header chip ${c8.text}`);
  check((await badge(korist)) === "3", "AC8 korist's data-nav-badge drops 4 → 3");
  await go(korist, `${BASE}/odevler`);
  check(
    (await korist.locator(`[data-testid=done-list] [data-testid=homework-row][data-id="${A}"]`).count()) === 1,
    "AC8 A moves to TESLİM ETTİKLERİM",
  );
  const sub = await one("select method from submissions where assignment_id = ? and user_id = ?", [A, koristId]);
  check(sub?.method === "self", "AC8 submissions.method is self");
  await go(sef, `${BASE}/odevler/${A}`);
  const rosterLi = sef.locator("li", { has: sef.locator("[data-testid=roster-row]", { hasText: "Demo Korist" }) });
  const rosterTag = rosterLi.locator("[data-testid=roster-recording]");
  const rosterListen = rosterLi.locator("[data-testid=roster-listen]");
  check(
    /^Kayıt · 0:0\d$/.test((await rosterTag.textContent())?.trim()) &&
      (await rosterListen.getAttribute("href")) === `/odevler/${A}/dinle/${koristId}` &&
      (await rosterListen.getAttribute("aria-label")) === "Demo Korist: kaydı dinle",
    "AC8/AC33 roster shows Kayıt · 0:0x under the name and a chevron link to the review page for sef@",
  );
  await go(sef, `${BASE}/odevler/matris`);
  const ids = await sef.locator("[data-testid=matrix-column]").evaluateAll((els) => els.map((e) => e.dataset.id));
  const cell = await sef
    .locator("[data-testid=matrix-row][data-name='Demo Korist'] td[data-cell]")
    .nth(ids.indexOf(A))
    .getAttribute("data-cell");
  check(cell === "done", `AC8 matrix cell is done (${cell})`);

  // ------------------------------------------------------------------ AC 10
  const listenLog = requestLog(korist);
  await go(korist, `${BASE}/odevler/${A}`);
  check(!listenLog.some((r) => r.url.includes("/api/dosya/")), "AC10 no /api/dosya request before Dinle");
  await korist.getByRole("button", { name: "Kaydını dinle" }).click();
  await korist.waitForTimeout(1200);
  const audio = await korist.locator("[data-audio-player] audio").evaluate((a) => ({ src: a.src, t: a.currentTime }));
  await korist.getByRole("button", { name: "Duraklat" }).click();
  await korist.getByRole("button", { name: "Kaydını dinle" }).click();
  await korist.waitForTimeout(300);
  check(
    listenLog.filter((r) => r.url.includes(`/api/dosya/kayit/${take.id}`)).length === 1 &&
      audio.src.startsWith("blob:") &&
      audio.t > 0,
    `AC10 Dinle fetches once and plays from blob: (t=${audio.t.toFixed(2)})`,
  );

  // ------------------------------------------------------------------ review P2-2: per-file listen cap
  const capMsg = "Bu kaydı son bir saatte çok sık açtın. Biraz sonra tekrar dene.";
  const tries = await korist.evaluate(async (id) => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`/api/dosya/kayit/${id}`, { cache: "no-store" });
      out.push({ status: r.status, body: r.status === 429 ? await r.json() : null });
      if (r.status === 429) break;
    }
    return out;
  }, take.id);
  const refused = tries.at(-1);
  check(
    refused.status === 429 && refused.body?.code === "rate" && refused.body?.error === capMsg && tries.length <= 11,
    `review P2-2 the 11th listen of one take in an hour is a 429 with the per-file message (${tries.map((t) => t.status).join(",")})`,
  );
  await korist.reload();
  await korist.getByRole("button", { name: "Kaydını dinle" }).click();
  await korist.locator(`text=${capMsg}`).waitFor();
  check(true, "review P2-2 the player shows the server's cap message");
  await db.execute("delete from login_attempts where key like 'listen:%'");
  for (let i = consoleErrors.length - 1; i >= 0; i--) {
    if (consoleErrors[i].includes("status of 429")) consoleErrors.splice(i, 1);
  }

  // ------------------------------------------------------------------ AC 11
  const firstSubmitted = (await one("select submitted_at from submissions where assignment_id = ? and user_id = ?", [A, koristId])).submitted_at;
  await korist.getByRole("button", { name: "Değiştir" }).click();
  check(
    (await korist.locator("text=Yeni kaydı gönderince eskisi silinir.").count()) === 1,
    "AC11 Değiştir shows the idle controls with the replace line",
  );
  // The arranged case: the due moves into the past after the first upload.
  await db.execute({ sql: "update assignments set due_at = ? where id = ?", args: [Number(firstSubmitted) + 1, A] });
  await record(korist, 2500);
  await send(korist);
  const replacedLine = await korist.locator("text=/^Değiştirildi · /").textContent();
  const after = await one("select submitted_at from submissions where assignment_id = ? and user_id = ?", [A, koristId]);
  const takes = await db.execute({ sql: "select count(*) as n from recordings where assignment_id = ? and user_id = ? and replaced_at is null", args: [A, koristId] });
  const c11 = await chip(korist);
  check(
    replacedLine.includes(today()) &&
      Number(after.submitted_at) === Number(firstSubmitted) &&
      Number(takes.rows[0].n) === 1 &&
      !(await fileExists(take.storage_key)) &&
      c11.text.startsWith("Teslim edildi"),
    `AC11 replace: Değiştirildi · today, submitted_at kept, old file gone, one current take, still on time (${c11.text})`,
  );

  // AC 11 late: D is overdue.
  await go(korist, `${BASE}/odevler/${D}?k=${Date.now()}`);
  await pickFile(korist, "gec.wav", wavBytes({ seconds: 2 }));
  await waitState(korist, "recorded");
  await send(korist);
  const c11b = await chip(korist);
  check(c11b.text === `Geç teslim · ${today()}`, `AC11 an upload on overdue D is Geç teslim (${c11b.text})`);

  // ------------------------------------------------------------------ AC 12
  await reset();
  await go(korist, `${BASE}/odevler/${A}?k=${Date.now()}`);
  await korist.reload();
  await pickFile(korist, "ses.wav", wavBytes({ seconds: 2 }));
  await waitState(korist, "recorded");
  await send(korist);
  const t12 = await currentTake(A, KORIST);
  await korist.getByRole("button", { name: "Sil", exact: true }).click();
  const dlg = korist.getByRole("alertdialog");
  check(
    (await dlg.textContent()).includes("Kaydın silinsin mi?") && (await dlg.textContent()).includes("Teslimin de geri alınır."),
    "AC12 Sil asks Kaydın silinsin mi? / Teslimin de geri alınır.",
  );
  await dlg.getByRole("button", { name: "Sil" }).click();
  await korist.locator("text=Kaydın silindi.").waitFor();
  await waitState(korist, "idle");
  const c12 = await chip(korist);
  check(
    !(await fileExists(t12.storage_key)) &&
      !(await currentTake(A, KORIST)) &&
      c12.tone !== "done" &&
      (await badge(korist)) === "4" &&
      !(await one("select submitted_at from submissions where assignment_id = ? and user_id = ? and submitted_at is not null", [A, koristId])),
    `AC12 Sil removes the file, clears the submission (${c12.text}), badge back to 4`,
  );
  // The fallback Geri al with a take does the same.
  await pickFile(korist, "ses.wav", wavBytes({ seconds: 2 }));
  await waitState(korist, "recorded");
  await send(korist);
  const t12b = await currentTake(A, KORIST);
  await openFallback(korist);
  await korist.locator("#baska-yolla").getByRole("button", { name: "Geri al" }).click();
  await waitState(korist, "idle");
  check(
    !(await fileExists(t12b.storage_key)) && !(await currentTake(A, KORIST)),
    "AC12 the fallback Geri al withdraws the take too",
  );
  // A manager's manual mark stays when the singer deletes the take (D47), AC 36.
  const sefId = await userId("sef@arkhe.local");
  const markedAt = Math.floor(Date.now() / 1000) - 7200;
  await db.execute({
    sql: "insert into submissions (assignment_id, user_id, submitted_at, method, marked_by) values (?, ?, ?, 'manual', ?) on conflict(assignment_id, user_id) do update set submitted_at = excluded.submitted_at, method = 'manual', marked_by = excluded.marked_by",
    args: [B, koristId, markedAt, sefId],
  });
  await go(sef, `${BASE}/odevler/${B}`);
  check(
    (await sef.locator("[data-testid=roster-row]", { hasText: "Demo Korist" }).textContent()).includes("şef işaretledi"),
    "AC36 a manual mark still shows şef işaretledi",
  );
  await go(korist, `${BASE}/odevler/${B}?k=${Date.now()}`);
  check((await korist.locator("text=/^Teslim ettin · /").count()) === 1, "AC36 the singer sees Teslim ettin and can still record");
  await pickFile(korist, "ses.wav", wavBytes({ seconds: 2 }));
  await waitState(korist, "recorded");
  await send(korist);
  const s36 = await one("select submitted_at, method, marked_by from submissions where assignment_id = ? and user_id = ?", [B, koristId]);
  await go(sef, `${BASE}/odevler/${B}`);
  const rowB = sef.locator("li", { has: sef.locator("[data-testid=roster-row]", { hasText: "Demo Korist" }) });
  check(
    Number(s36.submitted_at) === markedAt &&
      s36.method === "manual" &&
      s36.marked_by === sefId &&
      (await rowB.textContent()).includes("şef işaretledi") &&
      (await rowB.locator("[data-testid=roster-recording]").count()) === 1,
    "AC36 the take attaches to the manual mark; roster shows şef işaretledi and Kayıt",
  );
  const odev = await actionIds(ODEV, B);
  const unmark = await callAction(sef, odev.setSubmissionFor, [B, koristId, false]);
  check(
    unmark.includes("Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil."),
    "AC36 the manager's Teslim edilmedi is refused while a take exists",
  );
  await go(korist, `${BASE}/odevler/${B}?k=${Date.now()}`);
  await korist.getByRole("button", { name: "Sil", exact: true }).click();
  const d36 = korist.getByRole("alertdialog");
  check((await d36.textContent()).includes("Şefin işaretlediği teslim kalır."), "AC12 the confirm says the manual mark stays");
  await d36.getByRole("button", { name: "Sil" }).click();
  await korist.locator("text=Kaydın silindi.").waitFor();
  const s12 = await one("select submitted_at, method from submissions where assignment_id = ? and user_id = ?", [B, koristId]);
  check(
    s12?.method === "manual" && Number(s12.submitted_at) === markedAt && !(await currentTake(B, KORIST)),
    "AC12 Sil on a manual mark removes only the take; the mark stays",
  );
  const unmark2 = await callAction(sef, odev.setSubmissionFor, [B, koristId, false]);
  check(!unmark2.includes("portalda kaydı var"), "AC36 once the audio is gone the unmark works");

  // ------------------------------------------------------------------ AC 13
  await reset();
  await go(korist, `${BASE}/odevler/${A}?k=${Date.now()}`);
  await pickFile(korist, "ses.wav", wavBytes({ seconds: 2 }));
  await waitState(korist, "recorded");
  await send(korist);
  const t13 = await currentTake(A, KORIST);
  const now = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: "update submissions set feedback = 'E2E kilit', feedback_by = ?, feedback_at = ? where assignment_id = ? and user_id = ?",
    args: [sefId, now, A, koristId],
  });
  await db.execute({ sql: "update recordings set commented_at = ? where id = ?", args: [now, t13.id] });
  await korist.reload();
  check(
    (await state(korist)) === "locked" &&
      (await korist.getByRole("button", { name: "Değiştir" }).count()) === 0 &&
      (await korist.getByRole("button", { name: "Sil", exact: true }).count()) === 0,
    "AC13 after the comment: locked, no Değiştir/Sil",
  );
  if (shots) await korist.screenshot({ path: `${shots}/p9-recorder-locked.png`, fullPage: true });
  const before13 = await db.execute("select count(*) as n from recordings");
  const up13 = await uploadRaw(korist, A, wavBytes({ seconds: 1 }));
  const kayit = await actionIds(KAYIT, A);
  const del13 = await callAction(korist, kayit.deleteMyRecording, [A]);
  const undo13 = await callAction(korist, (await actionIds(ODEV, A)).undoSubmission, [A]);
  const after13 = await db.execute("select count(*) as n from recordings");
  check(
    up13.status === 409 &&
      up13.json?.error === "Şef yorum yazdı; kaydını artık değiştiremezsin." &&
      del13.includes("Şef yorum yazdı; kaydını artık değiştiremezsin.") &&
      (undo13.includes("Şef yorum yazdı") || undo13.includes("geri alamazsın")) &&
      Number(after13.rows[0].n) === Number(before13.rows[0].n) &&
      (await fileExists(t13.storage_key)),
    "AC13 upload, delete and undo are refused with the lock; no row or file changes",
  );

  // ------------------------------------------------------------------ AC 14
  await reset();
  for (let i = 0; i < 4; i++) {
    await insertTake({ assignmentId: C, email: KORIST, replaced: true, submit: false, uploadedAt: now - 3600 * (5 - i) });
  }
  await go(korist, `${BASE}/odevler/${C}?k=${Date.now()}`);
  await pickFile(korist, "ses.wav", wavBytes({ seconds: 2 }));
  await waitState(korist, "recorded");
  check(
    (await korist.locator("[data-testid=upload-count]").textContent()).trim() ===
      "5 yükleme hakkından 4 tanesini kullandın. Silinen kayıtlar da sayılır." &&
      (await korist.locator("text=Bu son yükleme hakkın.").count()) === 1,
    "AC14 from the 3rd upload the count line; the 5th preview says Bu son yükleme hakkın.",
  );
  await send(korist);
  check(
    (await korist.getByRole("button", { name: "Değiştir" }).count()) === 0 &&
      (await korist.locator("text=Bu ödeve 5 kez kayıt yükledin; artık değiştiremezsin.").count()) === 1,
    "AC14 after 5 uploads Değiştir is hidden",
  );
  const six = await uploadRaw(korist, C, wavBytes({ seconds: 1 }));
  check(
    six.status === 409 && six.json?.error === "Bu ödeve en fazla 5 kez kayıt yükleyebilirsin.",
    "AC14 the 6th upload is refused (withdrawn and replaced takes count)",
  );

  // ------------------------------------------------------------------ AC 6, 58
  const rowsBefore = Number((await one("select count(*) as n from recordings")).n);
  const filesBefore = (await recordingFiles()).length;
  const noOrigin = await uploadRaw(korist, D, wavBytes({ seconds: 1 }), { origin: null });
  const evil = await uploadRaw(korist, D, wavBytes({ seconds: 1 }), { origin: "https://evil.test" });
  const png = await uploadRaw(korist, D, PNG, { contentType: "audio/mp4" });
  const text = await uploadRaw(korist, D, Buffer.from("merhaba, bu bir ses değil ".repeat(20)), { contentType: "audio/mp4" });
  const big = await uploadRaw(korist, D, wavOfSize(4_194_305));
  check(
    noOrigin.status === 403 && evil.status === 403 && noOrigin.json?.code === "origin",
    `AC6 no or foreign Origin → 403 (${noOrigin.status}, ${evil.status})`,
  );
  const wrongType =
    "Bu dosya bir ses kaydı değil ya da türü desteklenmiyor. Telefonunun ses kaydedicisinden bir kayıt seç (m4a, mp3, wav…).";
  check(
    png.status === 415 && png.json?.error === wrongType && text.status === 415 && text.json?.error === wrongType,
    "AC6 a PNG renamed and text sent as audio/mp4 are refused with the type message",
  );
  check(
    big.status === 413 &&
      big.json?.error === "Dosya en fazla 4 MB olabilir. Daha kısa bir kayıt seç ya da burada Kayda başla ile kaydet.",
    "AC6 4,194,305 bytes → the 4 MB message",
  );
  check(
    Number((await one("select count(*) as n from recordings")).n) === rowsBefore &&
      (await recordingFiles()).length === filesBefore,
    "AC6 refusals write no row and no file",
  );
  const t0 = Date.now();
  const exact = await uploadRaw(korist, D, wavOfSize(4_194_304), { contentType: "audio/mp4" });
  const took = Date.now() - t0;
  const exactRow = await currentTake(D, KORIST);
  check(
    exact.status === 201 && exactRow?.content_type === "audio/wav" && exactRow.storage_key.endsWith(".wav"),
    "AC6 4,194,304 bytes is accepted; the stored type is the detected one, not the claimed one",
  );
  check(took < 5000, `AC58 a 4 MB upload completes in under 5 s (${took} ms)`);

  // ------------------------------------------------------------------ AC 9
  await reset();
  await go(korist, `${BASE}/odevler/${C}?k=${Date.now()}`);
  const log9 = requestLog(korist);
  await pickFile(korist, "bos.m4a", Buffer.alloc(0), "audio/mp4");
  await korist.locator("text=Bu dosya boş. Başka bir kayıt seç.").waitFor();
  await pickFile(korist, "ses.wav", wavBytes({ seconds: 3 }));
  await waitState(korist, "recorded");
  check(
    (await korist.getByRole("button", { name: "Başka dosya seç" }).isVisible()) &&
      (await korist.getByRole("button", { name: "Kaydı gönder" }).isVisible()) &&
      !log9.some((r) => r.url.includes("/api/dosya/kayit")),
    "AC9 an empty file is refused locally; a WAV goes to preview (Gönder / Başka dosya seç) with no request",
  );
  await send(korist);
  check((await currentTake(C, KORIST))?.content_type === "audio/wav", "AC9 Gönder stores the WAV as audio/wav");
  await korist.getByRole("button", { name: "Değiştir" }).click();
  await pickFile(korist, "ses.mp3", mp3Bytes(), "audio/mpeg");
  await waitState(korist, "recorded");
  await send(korist);
  check((await currentTake(C, KORIST))?.content_type === "audio/mpeg", "AC9 a generated MP3 is stored as audio/mpeg");
  await korist.getByRole("button", { name: "Değiştir" }).click();
  await pickFile(korist, "ses.m4a", Buffer.from("merhaba, bu bir ses değil ".repeat(20)), "audio/mp4");
  await waitState(korist, "recorded");
  await korist.getByRole("button", { name: "Kaydı gönder" }).click();
  await korist.locator("[role=alert]", { hasText: "Bu dosya bir ses kaydı değil" }).waitFor();
  const other = korist.getByRole("button", { name: "Başka dosya seç" });
  check(
    (await korist.getByRole("button", { name: "Kaydı gönder" }).count()) === 0 &&
      (await other.evaluate((e) => e === document.activeElement && e.getBoundingClientRect().height >= 55)),
    "review P2-2 after a server refusal Gönder is gone and Başka dosya seç is the focused primary",
  );
  await pickFile(korist, "ses.wav", wavBytes({ seconds: 2 }));
  await waitState(korist, "recorded");
  check((await korist.getByRole("button", { name: "Kaydı gönder" }).count()) === 1, "review P2-2 a new pick brings Gönder back");
  // The provoked 415 is the point of this block, not console noise.
  for (let i = consoleErrors.length - 1; i >= 0; i--) {
    if (consoleErrors[i].includes("status of 415")) consoleErrors.splice(i, 1);
  }
  await send(korist);

  // ------------------------------------------------------------------ AC 15
  const f15 = await uploadRaw(korist, F, wavBytes({ seconds: 1 }));
  check(f15.status === 403 && f15.json?.error === "Bu işlem için yetkin yok.", "AC15 korist@ on F (T+B) is refused");
  await go(sef, `${BASE}/odevler/${A}`);
  check((await sef.locator("[data-recorder]").count()) === 0, "AC15 the conductor has no recorder");
  const hash = (await one("select password_hash from users where email = ?", [KORIST])).password_hash;
  await db.execute({
    sql: "insert into users (id, name, email, role, voice_part, password_hash, joined_at) values (?, 'E2E Pasif', 'pasif@e2e.test', 'member', 'alto', ?, ?)",
    args: [crypto.randomUUID(), hash, now - 100 * 86400],
  });
  const pasif = await loginAs(browser, "pasif@e2e.test");
  await db.execute("update users set is_active = 0, left_at = unixepoch() where email = 'pasif@e2e.test'");
  const rows15 = Number((await one("select count(*) as n from recordings")).n);
  const p15 = await uploadRaw(pasif, A, wavBytes({ seconds: 1 }));
  check(
    p15.status === 401 && Number((await one("select count(*) as n from recordings")).n) === rows15,
    `AC15 an inactive user's session can't upload (${p15.status})`,
  );
  await pasif.context().close();

  // ------------------------------------------------------------------ AC 35
  await reset();
  await go(korist, `${BASE}/odevler/${A}?k=${Date.now()}`);
  const fb = korist.locator("#baska-yolla");
  check(!(await fb.evaluate((d) => d.open)), "AC35 Başka yolla gönderdim is collapsed by default");
  await openFallback(korist);
  const href = await fb.locator("[data-testid=mailto]").getAttribute("href");
  check(href.startsWith("mailto:kayit@arkhe.local?subject=") && !href.includes("+"), "AC35 the Phase 4 mail link sits inside");
  await fb.getByRole("button", { name: "Teslim ettim" }).click();
  await korist.locator("text=/^Teslim ettin · /").waitFor();
  const s35 = await one("select method from submissions where assignment_id = ? and user_id = ?", [A, koristId]);
  check(s35?.method === "self" && !(await currentTake(A, KORIST)), "AC35 Teslim ettim works: method self, no recording");
  await go(sef, `${BASE}/odevler/${A}`);
  const row35 = sef.locator("li", { has: sef.locator("[data-testid=roster-row]", { hasText: "Demo Korist" }) });
  check((await row35.locator("[data-testid=roster-recording]").count()) === 0, "AC35 roster shows no Kayıt tag");
  await go(sef, `${BASE}/odevler/dinle`);
  const q35 = sef.locator(`[data-testid=queue-row][data-user="${koristId}"][data-assignment="${A}"]`);
  check((await q35.textContent()).includes("Portalda kayıt yok"), "AC35 the conductor's queue shows Portalda kayıt yok");
  await db.execute("delete from app_settings where key = 'recording_email'");
  await go(korist, `${BASE}/odevler/${B}?k=${Date.now()}`);
  await openFallback(korist);
  check(
    (await fb.locator("[data-testid=email-missing]").count()) === 1 &&
      (await fb.locator("a[href^='mailto:']").count()) === 0 &&
      (await fb.getByRole("button", { name: "Teslim ettim" }).isVisible()),
    "AC35 without Kayıt e-postası: the hint and Teslim ettim, no mailto",
  );
  await reset();

  // ------------------------------------------------------------------ AC 16
  await setHook(korist, "arkhe_e2e_recorder_limit", "3");
  await go(korist, `${BASE}/odevler/${A}?k=${Date.now()}`);
  check((await recorder(korist).getAttribute("data-max-ms")) === "3000", "AC16 the dev hook sets data-max-ms");
  await korist.getByRole("button", { name: "Kayda başla" }).click();
  await waitState(korist, "recording");
  await waitState(korist, "recorded", 10000);
  check(
    (await korist.locator("[data-testid=recorder-notice]").textContent()).trim() === "Kayıt 10 dakikada durdu." &&
      (await korist.getByRole("button", { name: "Kaydı gönder" }).isVisible()),
    "AC16 the recorder stops by itself: Kayıt 10 dakikada durdu. with Dinle/Gönder",
  );
  await setHook(korist, "arkhe_e2e_recorder_limit", null);

  // ------------------------------------------------------------------ D40, AC 47
  // In-app navigation away and back brings the unsent take back.
  await korist.locator("[data-testid=piece-link]").click();
  await korist.waitForURL(/\/repertuvar\//);
  await korist.goBack();
  await korist.locator("[data-recorder]").waitFor();
  await waitState(korist, "recorded");
  check(
    (await korist.locator("[data-testid=recorder-notice]").textContent()).includes("Gönderilmemiş bir kaydın var."),
    "D40 an unsent take survives in-app navigation (Esere git, back)",
  );
  const errorsBefore = consoleErrors.length;
  await setHook(korist, "arkhe_e2e_storage_fault", "put");
  const rows47 = Number((await one("select count(*) as n from recordings")).n);
  await korist.getByRole("button", { name: "Kaydı gönder" }).click();
  await waitState(korist, "failed");
  const msg47 = (await korist.locator("[data-testid=upload-error]").textContent()).trim();
  check(
    msg47 === "Kayıt şu an yüklenemedi. Kaydın kaybolmadı: tekrar dene ya da Kaydı indir ile telefonuna kaydet." &&
      Number((await one("select count(*) as n from recordings")).n) === rows47 &&
      (await korist.locator("#baska-yolla").evaluate((d) => d.open)),
    "AC47 put fault: the D21 message, no row, the fallback opens",
  );
  const bytes = Number(await recorder(korist).getAttribute("data-take-bytes"));
  const [download] = await Promise.all([
    korist.waitForEvent("download"),
    korist.locator("[data-testid=take-download]").click(),
  ]);
  const { stat } = await import("node:fs/promises");
  const size = (await stat(await download.path())).size;
  check(size === bytes && bytes > 0, `AC47 Kaydı indir downloads the take (${size} = ${bytes} bytes)`);
  await setHook(korist, "arkhe_e2e_storage_fault", null);
  await korist.getByRole("button", { name: "Tekrar dene" }).click();
  await waitState(korist, "sent");
  check(Boolean(await currentTake(A, KORIST)), "AC47 Tekrar dene after clearing the fault succeeds");
  await setHook(korist, "arkhe_e2e_storage_fault", "get");
  await korist.reload();
  await korist.getByRole("button", { name: "Kaydını dinle" }).click();
  await korist.locator("text=Kayıt şu an açılamıyor. Biraz sonra tekrar dene.").waitFor();
  check(true, "AC47 get fault: Dinle shows Kayıt şu an açılamıyor…");
  await setHook(korist, "arkhe_e2e_storage_fault", null);
  // The provoked 503s of the fault hooks are the point of this block, not console noise.
  for (let i = consoleErrors.length - 1; i >= errorsBefore; i--) {
    if (consoleErrors[i].includes("status of 503")) consoleErrors.splice(i, 1);
  }

  // ------------------------------------------------------------------ AC 17
  const denied = await newPage(browser, { phone: true });
  await denied.context().addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("", "NotAllowedError"));
  });
  await login(denied, KORIST);
  await denied.waitForURL(`${BASE}/`);
  await go(denied, `${BASE}/odevler/${B}?k=${Date.now()}`);
  await denied.getByRole("button", { name: "Kayda başla" }).click();
  await denied.locator("[data-testid=mic-problem]").waitFor();
  check(
    (await denied.locator("[data-testid=mic-problem]").textContent()).includes("Mikrofon izni verilmedi.") &&
      (await denied.locator("#mic-denied-desc").textContent()) ===
        "Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver ya da telefonundaki ses kaydediciyle kaydedip Dosya yükle'yi kullan.",
    "AC17 a denied microphone shows the message (the AC sentence as the accessible description)",
  );
  check(
    (await denied.locator("[data-testid=mic-problem] [aria-hidden]").count()) === 0 &&
      (await denied.locator("[data-testid=mic-problem]").getAttribute("aria-describedby")) === null,
    "review P2-7 the permission steps reach screen readers; the alert is not described twice",
  );
  await pickFile(denied, "ses.wav", wavBytes({ seconds: 2 }));
  await waitState(denied, "recorded");
  check(true, "AC17 Dosya yükle still works after a denial");
  await denied.context().close();
  const noRec = await newPage(browser, { phone: true });
  await noRec.context().addInitScript(() => {
    delete window.MediaRecorder;
  });
  await login(noRec, KORIST);
  await noRec.waitForURL(`${BASE}/`);
  await go(noRec, `${BASE}/odevler/${B}?k=${Date.now()}`);
  await noRec.locator("[data-testid=no-recorder]").waitFor();
  check(
    (await noRec.getByRole("button", { name: "Kayda başla" }).count()) === 0 &&
      (await noRec.locator("text=Bu tarayıcı kayıt yapamıyor; Dosya yükle'yi kullan.").count()) === 1,
    "AC17 without MediaRecorder: no Kayda başla, the hint instead",
  );
  await noRec.context().close();

  // ------------------------------------------------------------------ AC 57 (recorder states)
  await reset();
  for (const colorScheme of ["light", "dark"]) {
    const p = await micPage(browser, KORIST, { extra: { colorScheme } });
    await go(p, `${BASE}/odevler/${C}?k=${Date.now()}`);
    const found = [];
    const probe = async (label) => {
      await settled(p, "[data-testid=singer-card]");
      const v = [...(await axe(p, "[data-testid=singer-card]")), ...(await layoutIssues(p, "[data-testid=singer-card]"))];
      found.push(...v.map((x) => `${label}: ${x}`));
    };
    await probe("idle");
    await p.getByRole("button", { name: "Kayda başla" }).click();
    await waitState(p, "recording");
    await probe("recording");
    if (shots) await p.screenshot({ path: `${shots}/p9-recording-375-${colorScheme}.png` });
    await p.waitForTimeout(1500);
    await p.getByRole("button", { name: "Kaydı durdur" }).click();
    await waitState(p, "recorded");
    await probe("recorded");
    if (shots) await p.screenshot({ path: `${shots}/p9-recorded-375-${colorScheme}.png`, fullPage: true });
    await send(p);
    await probe("sent");
    if (shots) await p.screenshot({ path: `${shots}/p9-sent-375-${colorScheme}.png`, fullPage: true });
    const t = await currentTake(C, KORIST);
    await db.execute({
      sql: "update submissions set feedback = 'E2E', feedback_by = ?, feedback_at = ? where assignment_id = ? and user_id = ?",
      args: [sefId, Math.floor(Date.now() / 1000), C, koristId],
    });
    await db.execute({ sql: "update recordings set commented_at = ? where id = ?", args: [Math.floor(Date.now() / 1000), t.id] });
    await p.reload();
    await waitState(p, "locked");
    await probe("locked");
    check(found.length === 0, `AC57 recorder at 375 ${colorScheme}: no axe issue, overflow or <44 px target (${found.slice(0, 4)})`);
    await p.context().close();
    await reset();
  }
  check((await rawHex()).length === 0, "AC57 no raw hex colours in the Phase 9 components");
  await korist.context().close();
  await sef.context().close();
}
