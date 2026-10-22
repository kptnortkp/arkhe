import { HOMEWORK_IDS, seedHomework } from "../scripts/homework-fixture.mjs";
import { actionIds, BASE, callAction, check, cleanup, db, istanbulDate, loginAs } from "./lib.mjs";

const { a: A, b: B, c: C, d: D, e: E, f: F } = HOMEWORK_IDS;
const ACTIONS_FILE = "src/app/(portal)/odevler/actions.ts";
const fmt = (options) =>
  new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", ...options });
const today = () => fmt({ day: "numeric", month: "short" }).format(new Date());
const formatDue = fmt({
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

async function badge(page) {
  const el = page.locator("[data-nav-badge]").first();
  return (await el.count()) ? el.getAttribute("data-nav-badge") : null;
}

// Phase 9 (D5): the mail block and Teslim ettim sit inside the collapsed "Başka yolla gönderdim".
async function openFallback(page) {
  const d = page.locator("#baska-yolla");
  await d.waitFor();
  if (!(await d.evaluate((el) => el.open))) await d.locator("summary").click();
}

const row = (page, id) => page.locator(`[data-testid=homework-row][data-id="${id}"]`);

async function chip(locator) {
  const b = locator.locator("[data-testid=deadline-badge]").first();
  return { tone: await b.getAttribute("data-tone"), text: (await b.textContent()).trim() };
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function snapshot() {
  const r = await db.execute(
    "select (select group_concat(id || due_at || updated_at, '|') from (select * from assignments order by id)) as a, (select group_concat(assignment_id || voice_part, '|') from (select * from assignment_parts order by 1, 2)) as p, (select group_concat(assignment_id || user_id || ifnull(submitted_at, '-') || ifnull(feedback, '-'), '|') from (select * from submissions order by 1, 2)) as s, (select group_concat(value) from app_settings) as e",
  );
  return JSON.stringify(r.rows[0]);
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.locator("main h1").first().waitFor();
}

async function rosterTitles(page) {
  return page.locator("[data-testid=roster-group-title]").allTextContents();
}

export default async function phase4(browser, shots) {
  // Phase 1–3 suites ran first: drop their test users and re-anchor the clock-sensitive texts.
  await cleanup();
  const ave = (await db.execute("select id from pieces where title = 'Ave Verum Corpus'")).rows[0]
    .id;
  const sicut = (await db.execute("select id from pieces where title = 'Sicut Cervus'")).rows[0].id;

  const sef = await loginAs(browser, "sef@arkhe.local");
  const yk = await loginAs(browser, "yk@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local");

  // AC15 D's roster as seeded
  await goto(sef, `/odevler/${D}`);
  check(
    (await rosterTitles(sef)).join(",") === "Soprano · 4/7,Alto · 3/6,Tenor · 3/4,Bas · 3/5",
    "AC15 D's per-part counts match the seed",
  );
  check(
    (await sef.textContent("[data-testid=roster-total]")) === "13/22 teslim",
    "AC15 13/22 teslim",
  );
  const kaan = sef.locator("[data-testid=roster-row]", { hasText: "Kaan Özdemir" });
  check(
    (await kaan.textContent()).includes("şef işaretledi"),
    "AC15 manual mark shows 'şef işaretledi'",
  );
  check(
    (await sef.locator("[data-testid=roster-row][data-state=late]").count()) === 1 &&
      (await sef.locator("[data-testid=roster-row][data-state=missing]").count()) === 9,
    "AC15 late and overdue states",
  );
  await goto(sef, `/odevler/${D}?filtre=eksik`);
  check(
    (await sef.locator("[data-testid=roster-row]").count()) === 9,
    "AC15 Teslim etmeyenler lists the 9 missing",
  );

  // AC18 matrix
  await goto(sef, "/odevler/matris");
  const columns = await sef
    .locator("[data-testid=matrix-column]")
    .evaluateAll((els) => els.map((e) => e.dataset.id));
  check(
    columns.join(",") === [A, F, B, C, D, E].join(","),
    "AC18 matrix columns are newest-left A, F, B, C, D, E",
  );
  const koristCells = await sef
    .locator("[data-testid=matrix-row][data-name='Demo Korist'] td[data-cell]")
    .evaluateAll((els) => els.map((e) => e.dataset.cell));
  check(
    koristCells.join(",") === "pending,none,pending,pending,missing,done",
    `AC18 korist's cells (${koristCells.join(",")})`,
  );

  // AC22 manager home, AC1 badges
  await goto(sef, "/");
  check(
    (await sef.locator("[data-testid=home-homework-count]").textContent()).includes("teslim") &&
      (await sef.locator("[data-testid=home-homework]").count()) === 0,
    "AC22 the conductor sees the Ödevler card only",
  );
  check((await badge(sef)) === null, "AC1 the conductor has no badge");
  await goto(yk, "/");
  check(
    (await yk.locator("[data-testid=home-homework]").count()) === 1 &&
      (await yk.locator("[data-testid=home-manager-homework]").count()) === 1,
    "AC22 a board singer sees both cards",
  );
  check((await badge(yk)) === "2", "AC1 yk's badge is 2");
  await goto(korist, "/");
  check((await badge(korist)) === "4", "AC1 korist's badge is 4");
  const homeCard = korist.locator("[data-testid=home-homework]");
  check(
    (await homeCard.locator("[data-testid=homework-row]").getAttribute("data-id")) === D &&
      (await homeCard.locator("[data-testid=record-link]").getAttribute("href")) === `/odevler/${D}#kayit` &&
      (await homeCard.textContent()).includes("+3 ödev daha"),
    "AC22 korist's Ödevlerim shows D first with Kaydını yap and +3",
  );
  const yeni = await loginAs(browser, "yeni@arkhe.local");
  check((await badge(yeni)) === null, "AC1 yeni@ has no badge");
  const phone = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  await phone.setViewportSize({ width: 375, height: 812 });
  await goto(phone, "/");
  const tab = phone.locator("nav[aria-label='Ana menü'] a[href='/odevler']").last();
  check(
    (await tab.isVisible()) &&
      (await tab.locator("[data-nav-badge]").getAttribute("data-nav-badge")) === "4",
    "AC1 Ödevler is in the 375 px tab bar with the badge",
  );

  // AC2 list
  await goto(korist, "/odevler");
  const todo = await korist
    .locator("[data-testid=todo-list] [data-testid=homework-row]")
    .evaluateAll((els) => els.map((e) => e.dataset.id));
  check(todo.join(",") === [D, C, B, A].join(","), "AC2 Güncel lists D, C, B, A and not E or F");
  check(
    (await row(korist, A).locator("[data-testid=homework-bars]").textContent()) === "Ölçü 12–34" &&
      (await row(korist, D).locator("[data-testid=homework-bars]").textContent()) === "Tüm eser",
    "AC2 bars read Ölçü 12–34 / Tüm eser",
  );
  await goto(korist, "/odevler?liste=gecmis");
  check(
    (await row(korist, E).count()) === 1 && (await row(korist, A).count()) === 0,
    "AC2 E is under Geçmiş",
  );
  // AC8 new note dot before opening
  check(
    (await row(korist, E).locator("[data-testid=new-note]").textContent()) === "Yeni yorum",
    "AC8 E shows Yeni yorum before opening",
  );

  // AC3 seeded tones
  await goto(korist, "/odevler");
  const tones = {};
  for (const [key, id] of Object.entries({ A, B, C, D })) tones[key] = await chip(row(korist, id));
  check(
    tones.A.tone === "green" && tones.A.text === "5 gün kaldı",
    `AC3 A green 5 gün (${tones.A.text})`,
  );
  check(
    tones.B.tone === "amber" && tones.B.text === "2 gün kaldı",
    `AC3 B amber 2 gün (${tones.B.text})`,
  );
  check(
    tones.C.tone === "red" && tones.C.text === "5 saat kaldı",
    `AC3 C red 5 saat (${tones.C.text})`,
  );
  check(
    tones.D.tone === "red" && tones.D.text === "Gecikti · 2 gün",
    `AC3 D overdue (${tones.D.text})`,
  );
  check(
    (await row(korist, A).locator("[data-testid=deadline-badge] svg").count()) === 1 &&
      (await row(korist, A).textContent()).includes("Son tarih:"),
    "AC3 badges carry an icon and the absolute date",
  );

  // AC4 mail
  await goto(korist, `/odevler/${A}`);
  await openFallback(korist);
  const href = await korist.locator("[data-testid=mailto]").getAttribute("href");
  const subject = decodeURIComponent(/subject=([^&]*)/.exec(href)[1]);
  const body = decodeURIComponent(/body=([^&]*)/.exec(href)[1]);
  check(
    href.startsWith("mailto:kayit@arkhe.local?subject=") && !href.includes("+"),
    "AC4 mailto prefix, no '+'",
  );
  check(
    subject === "Arkhe ödev · Ave Verum Corpus · Ölçü 12–34 · Alto · Demo Korist" &&
      body.includes("Son tarih:"),
    `AC4 subject and body (${subject})`,
  );
  await korist.getByRole("button", { name: "Konuyu kopyala" }).click();
  await korist.locator("text=/Konu kopyalandı.|Kopyalanamadı/").first().waitFor();
  check(true, "AC4 Konuyu kopyala answers with a toast");
  check(
    (await korist.locator("text=Partisyonunu dinle").count()) === 1 &&
      (await korist.locator("text=Kaydını yap").count()) >= 1 &&
      (await korist.locator("text=Gönderdiysen işaretle").count()) === 0,
    "AC4 the two steps are shown (Phase 9 D61: step 3 is gone)",
  );
  // AC5
  check(
    (await korist.getByRole("link", { name: /^Partisyonumu aç/ }).getAttribute("href")) ===
      "https://drive.google.com/file/d/seedAveAlto/view",
    "AC5 Partisyonum opens the alto file",
  );
  check(
    (await korist.locator("[data-testid=piece-link]").getAttribute("href")) ===
      `/repertuvar/${ave}?partisyon=alto`,
    "AC5 Esere git links to the piece with the part filter",
  );

  // AC8 note on E
  await goto(korist, `/odevler/${E}`);
  const feedback = korist.locator("[data-testid=feedback]");
  const feedbackText = await feedback.textContent();
  check(
    feedbackText.includes("Şefin yorumu") &&
      feedbackText.includes("Girişler çok iyi, 20. ölçüde nefesi erken alıyorsun.") &&
      feedbackText.includes("Demo Şef ·"),
    "AC8 E shows Şefin yorumu with author and date",
  );
  check(
    (await korist.getByRole("button", { name: "Geri al" }).count()) === 0,
    "AC8 no Geri al once a note exists",
  );
  await korist.waitForTimeout(800);
  await goto(korist, "/odevler?liste=gecmis");
  check(
    (await row(korist, E).locator("[data-testid=new-note]").count()) === 0,
    "AC8 the dot is gone after opening",
  );
  const actions = await actionIds(ACTIONS_FILE, A);
  check(
    (await callAction(korist, actions.undoSubmission, [E])).includes(
      "Şef geri bildirim yazdı; teslimi geri alamazsın.",
    ),
    "AC8 the undo action is refused when a note exists",
  );

  // AC9 not my part
  await goto(korist, `/odevler/${F}`);
  check(
    (await korist.locator("[data-testid=submit-toggle]").count()) === 0 &&
      (await korist.locator("text=Bu ödev senin partisyonun için değil.").count()) === 1,
    "AC9 F has no Teslim ettim and says it isn't my part",
  );
  check(
    (await callAction(korist, actions.submitAssignment, [F])).includes("Bu işlem için yetkin yok."),
    "AC9 submitting F is refused",
  );
  const fRow = await db.execute({
    sql: "select count(*) as n from submissions s join users u on u.id = s.user_id where s.assignment_id = ? and u.email = 'korist@arkhe.local'",
    args: [F],
  });
  check(fRow.rows[0].n === 0, "AC9 nothing is written for F");

  // AC10 member has no manager controls
  await goto(korist, "/odevler");
  check(
    (await korist.locator("text=Ödev ver").count()) === 0 &&
      (await korist.locator("text=Teslim matrisi").count()) === 0 &&
      (await korist.locator("text=Kayıt e-postası").count()) === 0,
    "AC10 member sees no manager controls on /odevler",
  );
  await goto(korist, `/odevler/${D}`);
  check(
    (await korist.locator("[aria-label='Ödevi düzenle'], [data-testid=roster-row]").count()) === 0,
    "AC10 member sees no edit or roster on the detail page",
  );
  for (const path of ["/odevler/yeni", `/odevler/${A}/duzenle`, "/odevler/matris"]) {
    await korist.goto(`${BASE}${path}`);
    await korist.waitForURL(`${BASE}/`);
    check(true, `AC10 ${path} redirects members`);
  }
  const ceren = "Kaydın gelmedi, cumartesiye kadar gönderebilirsin.";
  let leaked = false;
  for (const path of ["/odevler", `/odevler/${D}`, "/"]) {
    await goto(korist, path);
    if ((await korist.content()).includes(ceren)) leaked = true;
  }
  check(!leaked, "AC10 another singer's note never reaches korist's HTML");
  const user = (email) =>
    db
      .execute({ sql: "select id from users where email = ?", args: [email] })
      .then((r) => r.rows[0].id);
  const buse = await user("buse.kurt@arkhe.local");
  const manageCalls = {
    createAssignment: [{}, {}],
    updateAssignment: [A, {}, {}],
    deleteAssignment: [A],
    setSubmissionFor: [D, buse, true],
    saveFeedback: [D, buse, {}, {}],
    setRecordingEmail: [{}, {}],
  };
  // Read again: on a fresh dev server the manager pages above compile (and register) only now.
  const manage = await actionIds(ACTIONS_FILE, A);
  const before = await snapshot();
  let refused = true;
  for (const [name, args] of Object.entries(manageCalls)) {
    const text = manage[name] ? await callAction(korist, manage[name], args) : "";
    if (!text.includes("Bu işlem için yetkin yok.")) {
      refused = false;
      console.log(`${name} did not refuse: ${text.slice(0, 160)}`);
    }
  }
  check(refused, "AC10 every manager action refuses a member");
  check((await snapshot()) === before, "AC10 refused actions change no rows");

  // AC12 no recording email
  await db.execute("delete from app_settings where key = 'recording_email'");
  await goto(korist, `/odevler/${A}`);
  await openFallback(korist);
  check(
    (await korist.locator("[data-testid=email-missing]").textContent()).includes(
      "Kayıt e-postası henüz ayarlanmadı.",
    ) &&
      (await korist.locator("a[href^='mailto:']").count()) === 0 &&
      (await korist.getByRole("button", { name: "Teslim ettim" }).isVisible()),
    "AC12 no email: a hint, no mailto, Teslim ettim still there",
  );
  await goto(sef, "/odevler");
  check(
    (await sef.locator("[data-testid=email-missing]").count()) === 1,
    "AC12 managers see the Ayarla banner",
  );
  await seedHomework(db, new Date());

  // AC16 manager mark on D
  await goto(sef, `/odevler/${D}`);
  await sef.locator("[data-testid=roster-row]", { hasText: "Buse Kurt" }).click();
  await sef.getByRole("button", { name: "Teslim edildi olarak işaretle" }).click();
  await sef.locator("text=Teslim işaretlendi.").waitFor();
  await sef.locator("[data-testid=roster-total]", { hasText: "14/22" }).waitFor();
  check(
    (
      await sef.locator("[data-testid=roster-row]", { hasText: "Buse Kurt" }).textContent()
    ).includes("şef işaretledi"),
    "AC16 marking shows 'şef işaretledi' and raises the count",
  );
  const busePage = await loginAs(browser, "buse.kurt@arkhe.local");
  await goto(busePage, `/odevler/${D}`);
  check(
    (await busePage.locator("[data-testid=submit-toggle]").getAttribute("data-state")) === "done" &&
      (await busePage.locator("text=Teslimini Demo Şef işaretledi.").count()) === 1,
    "AC16 the singer sees Teslim edildi and who marked it",
  );
  await openFallback(busePage);
  await busePage.getByRole("button", { name: "Geri al" }).click();
  await busePage.locator("[data-testid=submit-toggle][data-state=pending]").waitFor();
  await goto(sef, `/odevler/${D}`);
  check(
    (await sef.textContent("[data-testid=roster-total]")) === "13/22 teslim",
    "AC16 the singer can undo a manual mark",
  );
  await busePage.context().close();

  // AC6 submit and undo on A (detail) and B (list)
  await goto(korist, `/odevler/${A}`);
  await openFallback(korist);
  await korist.getByRole("button", { name: "Teslim ettim" }).click();
  await korist.locator("[data-testid=submit-toggle][data-state=done]").waitFor();
  await korist.waitForTimeout(500);
  await goto(korist, `/odevler/${A}`);
  await openFallback(korist);
  const doneChip = await chip(korist.locator("[data-testid=submit-toggle]"));
  check(
    doneChip.tone === "done" && doneChip.text === `Teslim edildi · ${today()}`,
    `AC6 Teslim ettim → Teslim edildi · today, after reload (${doneChip.text})`,
  );
  check((await badge(korist)) === "3", "AC6 the badge drops to 3");
  await korist.getByRole("button", { name: "Geri al" }).click();
  await korist.locator("[data-testid=submit-toggle][data-state=pending]").waitFor();
  await korist.waitForTimeout(500);
  await goto(korist, `/odevler/${A}`);
  await openFallback(korist);
  check(
    (await chip(korist.locator("[data-testid=submit-toggle]"))).tone === "green" &&
      (await badge(korist)) === "4",
    "AC6 Geri al restores green and 4",
  );
  // Phase 9 (D5, AC 34): the list row offers Kaydını yap instead of an inline Teslim ettim.
  await goto(korist, "/odevler");
  check(
    (await row(korist, B).locator("[data-testid=record-link]").getAttribute("href")) === `/odevler/${B}#kayit` &&
      (await row(korist, B).locator("[data-testid=submit-row]").count()) === 0,
    "AC6 the list row links Kaydını yap to B's recorder",
  );

  // AC7 late submit on D
  await goto(korist, `/odevler/${D}`);
  await openFallback(korist);
  await korist.getByRole("button", { name: "Teslim ettim" }).click();
  await korist.locator("[data-testid=submit-toggle][data-state=done]").waitFor();
  check(
    (await chip(korist.locator("[data-testid=submit-toggle]"))).text === `Geç teslim · ${today()}`,
    "AC7 submitting D shows Geç teslim",
  );
  await goto(sef, `/odevler/${D}`);
  check(
    (await sef
      .locator("[data-testid=roster-row]", { hasText: "Demo Korist" })
      .getAttribute("data-state")) === "late" && (await rosterTitles(sef))[1] === "Alto · 4/6",
    "AC7 the roster shows korist late and Alto 4/6",
  );
  await goto(sef, "/odevler/matris");
  const dIndex = 4;
  const lateCell = await sef
    .locator("[data-testid=matrix-row][data-name='Demo Korist'] td[data-cell]")
    .nth(dIndex)
    .getAttribute("data-cell");
  check(lateCell === "late", "AC7 the matrix shows korist late on D");

  // AC11 late joiner
  await goto(yeni, `/odevler/${D}`);
  const yeniChip = await chip(yeni.locator("[data-testid=submit-toggle]"));
  check(
    yeniChip.tone === "muted" &&
      yeniChip.text === "Son tarih geçti" &&
      (await yeni
        .locator("text=Sen katılmadan önce verildi; istersen teslim edebilirsin.")
        .count()) > 0,
    "AC11 the late joiner sees D muted with the hint",
  );
  await goto(sef, `/odevler/${D}`);
  check(
    (await sef.locator("[data-testid=roster-row]", { hasText: "Arda Tan" }).count()) === 0,
    "AC11 not listed before submitting",
  );
  await openFallback(yeni);
  await yeni.getByRole("button", { name: "Teslim ettim" }).click();
  await yeni.locator("[data-testid=submit-toggle][data-state=done]").waitFor();
  await goto(sef, `/odevler/${D}`);
  check(
    (await sef.locator("[data-testid=roster-row]", { hasText: "Arda Tan" }).textContent()).includes(
      "Sonradan katıldı",
    ) &&
      (await rosterTitles(sef))[2] === "Tenor · 4/5" &&
      (await sef.textContent("[data-testid=roster-total]")) === "15/23 teslim",
    "AC11 after submitting he's listed as Sonradan katıldı and both numbers rise",
  );
  await yeni.context().close();

  // AC17 notes: the conductor on A, the board on B
  await goto(korist, `/odevler/${A}`);
  await openFallback(korist);
  await korist.getByRole("button", { name: "Teslim ettim" }).click();
  await korist.locator("[data-testid=submit-toggle][data-state=done]").waitFor();
  async function writeNote(page, id, text) {
    await goto(page, `/odevler/${id}`);
    await page.locator("[data-testid=roster-row]", { hasText: "Demo Korist" }).click();
    await page.fill("#feedback", text);
    await page.getByRole("button", { name: "Notu kaydet" }).click();
    // Phase 9 (D63): the conductor's note is the comment.
    await page.locator("text=Yorum gönderildi.").waitFor();
  }
  await writeNote(sef, A, "E2E şef notu");
  await goto(korist, "/odevler");
  check(
    (await row(korist, A).locator("[data-testid=new-note]").count()) === 1,
    "AC17 korist sees Yeni yorum on A",
  );
  await goto(korist, `/odevler/${A}`);
  check(
    (await korist.locator("[data-testid=feedback]").textContent()).includes(
      "Şefin yorumuE2E şef notu",
    ) && (await korist.getByRole("button", { name: "Geri al" }).count()) === 0,
    "AC17 Şefin yorumu shows and Geri al is gone",
  );
  // Phase 9 (D3): the board can't write notes any more; an old board note is arranged in the DB.
  await db.execute({
    sql: "insert into submissions (assignment_id, user_id, feedback, feedback_by, feedback_at) values (?, (select id from users where email = 'korist@arkhe.local'), 'E2E yk notu', (select id from users where email = 'yk@arkhe.local'), unixepoch()) on conflict(assignment_id, user_id) do update set feedback = excluded.feedback, feedback_by = excluded.feedback_by, feedback_at = excluded.feedback_at",
    args: [B],
  });
  await goto(korist, `/odevler/${B}`);
  const ykNote = await korist.locator("[data-testid=feedback]").textContent();
  check(
    ykNote.includes("Geri bildirim") && ykNote.includes("Demo Yönetim ·"),
    "AC17 a board note is headed Geri bildirim",
  );
  await goto(sef, `/odevler/${A}`);
  await sef.locator("[data-testid=roster-row]", { hasText: "Demo Korist" }).click();
  await sef.getByRole("button", { name: "Notu sil" }).click();
  await sef.locator("text=Yorum silindi.").waitFor();
  await goto(korist, `/odevler/${A}`);
  await openFallback(korist);
  check(
    (await korist.locator("[data-testid=feedback]").count()) === 0 &&
      (await korist.getByRole("button", { name: "Geri al" }).count()) === 1,
    "AC17 Notu sil removes it and Geri al returns",
  );
  await korist.getByRole("button", { name: "Geri al" }).click();
  await korist.locator("[data-testid=submit-toggle][data-state=pending]").waitFor();

  // AC3 boundaries and AC1 9+, on an E2E piece
  const pieceE2E = crypto.randomUUID();
  await db.execute({
    sql: "insert into pieces (id, title, status) values (?, 'E2E Ödev Eseri', 'learning')",
    args: [pieceE2E],
  });
  const nowSec = Math.floor(Date.now() / 1000);
  async function insertHomework(dueOffsetSec) {
    const id = crypto.randomUUID();
    await db.batch([
      {
        sql: "insert into assignments (id, piece_id, description, due_at, created_at, updated_at) values (?, ?, 'E2E sınır', ?, ?, ?)",
        args: [id, pieceE2E, nowSec + dueOffsetSec, nowSec - 60, nowSec - 60],
      },
      { sql: "insert into assignment_parts values (?, 'alto')", args: [id] },
    ]);
    return id;
  }
  const H = 3600;
  const bounds = {
    amber: await insertHomework(72 * H - 600),
    green: await insertHomework(72 * H + 600),
    red23: await insertHomework(23 * H),
    red30: await insertHomework(30 * 60),
  };
  await goto(korist, "/odevler");
  const b1 = await chip(row(korist, bounds.amber));
  const b2 = await chip(row(korist, bounds.green));
  const b3 = await chip(row(korist, bounds.red23));
  const b4 = await chip(row(korist, bounds.red30));
  check(
    b1.tone === "amber" && b1.text === "3 gün kaldı",
    `AC3 72h−10min is amber 3 gün (${b1.text})`,
  );
  check(
    b2.tone === "green" && b2.text === "4 gün kaldı",
    `AC3 72h+10min is green 4 gün (${b2.text})`,
  );
  check(b3.tone === "red" && b3.text === "23 saat kaldı", `AC3 +23h is red 23 saat (${b3.text})`);
  check(
    b4.tone === "red" && b4.text === "1 saatten az kaldı",
    `AC3 +30min is red <1 saat (${b4.text})`,
  );
  for (let i = 0; i < 6; i++) await insertHomework(48 * H);
  await goto(korist, "/odevler");
  check(
    (await korist.locator("[data-nav-badge]").first().textContent()) === "9+",
    "AC1 more than 9 open homework reads 9+",
  );
  await db.execute({
    sql: "delete from assignment_parts where assignment_id in (select id from assignments where piece_id = ?)",
    args: [pieceE2E],
  });
  await db.execute({ sql: "delete from assignments where piece_id = ?", args: [pieceE2E] });
  await db.execute({ sql: "delete from pieces where id = ?", args: [pieceE2E] });

  // AC13 create from the piece menu
  await goto(sef, `/repertuvar/${ave}`);
  await sef.click("[aria-label='Diğer işlemler']");
  await sef.getByRole("menuitem", { name: "Ödev ver" }).click();
  await sef.waitForURL(`${BASE}/odevler/yeni?eser=${ave}`);
  check((await sef.inputValue("#pieceId")) === ave, "AC13 Ödev ver preselects the piece");

  // AC14 validation
  const form = sef.locator("main form");
  const submit = () => form.locator("button[type=submit]").click();
  await sef.fill("#barFrom", "20");
  await sef.fill("#barTo", "5");
  await submit();
  await sef.locator("text=Bitiş ölçüsü başlangıçtan küçük olamaz.").waitFor();
  check(true, "AC14 20–5 is rejected");
  await sef.fill("#barTo", "");
  await submit();
  await sef.locator("text=Ölçüleri başlangıç ve bitiş olarak gir (ör. 12–34).").waitFor();
  check(true, "AC14 a single bar is rejected");
  await form.locator("label", { hasText: "Tutti" }).click();
  await submit();
  await sef.locator("text=En az bir partisyon seç.").waitFor();
  check(true, "AC14 no part is rejected");
  await sef.selectOption("#pieceId", "");
  await submit();
  await sef.locator("text=Bir eser seç.").waitFor();
  check(true, "AC14 no piece is rejected");
  await sef.selectOption("#pieceId", ave);
  await sef.fill("#dueDate", istanbulDate(-1));
  await sef.fill("#barFrom", "");
  await form.locator("label", { hasText: "Alto" }).click();
  await submit();
  await sef.locator("text=Son tarih geçmişte olamaz.").waitFor();
  check(true, "AC14 a past date is rejected");

  // AC13 the real create (double-clicked: the client id keeps it to one row)
  await sef.fill("#barFrom", "5");
  await sef.fill("#barTo", "20");
  await form.locator("label", { hasText: "Tenor" }).click();
  const dueDate = istanbulDate(3);
  await sef.fill("#dueDate", dueDate);
  await sef.fill("#dueTime", "21:00");
  await sef.fill("#description", "E2E yeni ödev");
  await form.locator("button[type=submit]").dblclick();
  await sef.waitForURL(/\/odevler\/[0-9a-f-]{36}$/);
  await sef.locator("text=Ödev verildi.").first().waitFor();
  const created = await db.execute(
    "select id, due_at from assignments where description = 'E2E yeni ödev'",
  );
  check(created.rows.length === 1, "AC14 a double submit creates one row");
  const header = await sef.locator("main header").textContent();
  const dueText = formatDue.format(new Date(Number(created.rows[0].due_at) * 1000));
  check(
    header.includes("Ölçü 5–20") &&
      header.includes("Alto") &&
      header.includes("Tenor") &&
      header.includes(`Son tarih: ${dueText}`),
    `AC13 the detail shows bars, parts and the Istanbul due (${dueText})`,
  );
  const abend = (await db.execute("select id from pieces where title = 'Abendlied'")).rows[0].id;
  await goto(sef, `/repertuvar/${abend}`);
  await sef.click("[aria-label='Diğer işlemler']");
  check(
    (await sef.getByRole("menuitem", { name: "Ödev ver" }).count()) === 0,
    "AC13 no Ödev ver on an archived piece",
  );
  await sef.keyboard.press("Escape");

  // AC20 recording email
  await goto(sef, "/odevler");
  // Phase 9 (D60): the recording email moved into the Ayarlar menu.
  await sef.getByRole("button", { name: "Ayarlar" }).click();
  await sef.getByRole("menuitem", { name: "Kayıt e-postası…" }).click();
  await sef.fill("input[name=email]", "kayit@");
  await sef.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
  await sef.getByRole("dialog").locator("text=Geçerli bir e-posta adresi gir.").waitFor();
  check(true, "AC20 kayit@ is rejected");
  await sef.fill("input[name=email]", "kayit@koro.org");
  await sef.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
  await sef.locator("text=Kayıt e-postası güncellendi.").waitFor();
  // Phase 9 (D46): B carries the old board note, which locks it; C shows the fallback.
  await goto(korist, `/odevler/${C}`);
  await openFallback(korist);
  check(
    (await korist.locator("[data-testid=mailto]").getAttribute("href")).startsWith(
      "mailto:kayit@koro.org?subject=",
    ),
    "AC20 the mailto uses the new address",
  );

  // AC21 a piece with homework can't be deleted
  const linksBefore = (
    await db.execute({
      sql: "select count(*) as n from piece_links where piece_id = ?",
      args: [sicut],
    })
  ).rows[0].n;
  await goto(sef, `/repertuvar/${sicut}`);
  check(
    (await sef.locator("[data-testid=piece-homework] a").count()) >= 1,
    "AC21 the piece page lists its open homework",
  );
  await goto(sef, `/repertuvar/${sicut}/duzenle`);
  await sef.getByRole("button", { name: "Eseri sil" }).click();
  await sef.getByRole("alertdialog").getByRole("button", { name: "Kalıcı olarak sil" }).click();
  await sef.locator("text=Bu esere bağlı ödevler var. Silmek yerine arşivle.").waitFor();
  const linksAfter = (
    await db.execute({
      sql: "select count(*) as n from piece_links where piece_id = ?",
      args: [sicut],
    })
  ).rows[0].n;
  const stillThere = (
    await db.execute({ sql: "select count(*) as n from pieces where id = ?", args: [sicut] })
  ).rows[0].n;
  check(stillThere === 1 && linksAfter === linksBefore, "AC21 nothing is deleted");

  // AC19 edit A's due to the past, stale edit, delete
  await goto(sef, `/odevler/${A}/duzenle`);
  const other = await sef.context().newPage();
  await goto(other, `/odevler/${A}/duzenle`);
  await sef.fill("#dueDate", istanbulDate(-1));
  await sef.locator("main form button[type=submit]").click();
  await sef.waitForURL(`${BASE}/odevler/${A}`);
  await other.fill("#description", "E2E eski form");
  await other.locator("main form button[type=submit]").click();
  await other.locator("text=Ödev bu arada değişti. Sayfayı yenileyip tekrar dene.").waitFor();
  check(true, "AC19 a stale edit form is refused");
  await other.close();
  await korist.reload();
  await goto(korist, "/odevler");
  const pastA = await chip(row(korist, A));
  check(
    pastA.tone === "red" && pastA.text.startsWith("Gecikti"),
    `AC19 korist's A is now Gecikti (${pastA.text})`,
  );
  await goto(sef, `/odevler/${A}`);
  await sef.click("[aria-label='Diğer işlemler']");
  await sef.getByRole("menuitem", { name: "Sil" }).click();
  const confirm = sef.getByRole("alertdialog");
  check(
    (await confirm.textContent()).includes('"Ave Verum Corpus · Ölçü 12–34" silinsin mi?') &&
      (await confirm.textContent()).includes("teslim kaydı"),
    "AC19 the delete confirm names the homework and the submission count",
  );
  await confirm.getByRole("button", { name: "Sil" }).click();
  await sef.waitForURL(`${BASE}/odevler`);
  await sef.locator("text=Ödev silindi.").waitFor();
  check((await row(sef, A).count()) === 0, "AC19 the homework is gone from the list");
  await goto(sef, "/odevler/matris");
  check(
    (await sef.locator(`[data-testid=matrix-column][data-id="${A}"]`).count()) === 0,
    "AC19 and from the matrix",
  );

  // AC23 phones: no horizontal scroll, light and dark
  const managerPhone = await loginAs(browser, "sef@arkhe.local", { mobile: true });
  await managerPhone.setViewportSize({ width: 375, height: 812 });
  for (const [page, paths] of [
    [phone, ["/", "/odevler", "/odevler?liste=gecmis", `/odevler/${B}`, `/odevler/${E}`]],
    [
      managerPhone,
      [
        "/",
        "/odevler",
        `/odevler/${D}`,
        "/odevler/matris",
        "/odevler/yeni",
        `/odevler/${D}/duzenle`,
      ],
    ],
  ]) {
    for (const path of paths) {
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme });
        await goto(page, path);
        check(await noHorizontalScroll(page), `AC23 no horizontal scroll on ${path} (${scheme})`);
      }
    }
  }
  await goto(managerPhone, `/odevler/${D}`);
  await managerPhone.locator("[data-testid=roster-row]").first().click();
  await managerPhone.locator("#feedback").waitFor();
  check(
    await noHorizontalScroll(managerPhone),
    "AC23 no horizontal scroll with the note sheet open",
  );
  if (shots) await managerPhone.screenshot({ path: `${shots}/homework-sheet.png` });
  await managerPhone.keyboard.press("Escape");
  await goto(phone, "/odevler");
  const heights = await phone
    .locator("[data-testid=submit-row], nav[aria-label='Ödev listesi'] a")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(heights.length > 0 && heights.every((h) => h >= 43.5), "AC23 targets are ≥ 44px");

  for (const page of [sef, yk, korist, phone, managerPhone]) await page.context().close();
}
