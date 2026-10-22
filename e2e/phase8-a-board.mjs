// Phase 8 A: the Yönetim Kurulu board, tickets, moves, comments, "Yeni" and the archive (AC 1–23, 41–44).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { seedBoard } from "../scripts/board-fixture.mjs";
import { BASE, check, db, istanbulDate, login, newPage } from "./lib.mjs";
import {
  actionIds,
  as,
  BOARD_ACTIONS,
  boardSnapshot,
  callAction,
  callForm,
  deleteTickets,
  eventsOf,
  goto,
  insertTicket,
  noOverflow,
  people,
  scalar,
  smallTargets,
  tabCounts,
  text,
  ticketRow,
  toast,
  visibleCards,
} from "./board.mjs";

const FORBIDDEN = "Bu işlem için yetkin yok.";
const STALE = "Bu iş az önce değişti. Sayfayı yenile.";
const D = 86_400;
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

async function reset() {
  await seedBoard(db, new Date());
  await db.execute("delete from login_attempts where key like 'board-%'");
}

async function badge(page) {
  // The visible copy: the bottom bar on the phone, the sidebar on desktop.
  const b = page.locator("[data-board-badge]:visible").first();
  return (await b.count()) ? await b.getAttribute("data-board-badge") : null;
}

async function waitSeen(page, number) {
  const seen = page
    .waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes(`/yonetim/${number}`),
      {
        timeout: 10_000,
      },
    )
    .catch(() => null);
  await goto(page, `/yonetim/${number}`);
  await seen;
  await page.waitForTimeout(300);
}

async function openMove(page, number) {
  await page.getByRole("button", { name: `#${number} taşı` }).click();
  return page.getByRole("menu");
}

async function axe(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: true } },
    });
    return r.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 2)
            .map((n) => n.target.join(" "))
            .join(" | ")}`,
      );
  });
}

async function access(browser, ids) {
  for (const email of ["sef@arkhe.local", "yk@arkhe.local"]) {
    const page = await as(browser, email);
    const codes = [];
    for (const p of [
      "/yonetim",
      "/yonetim/arsiv",
      "/yonetim/yeni",
      "/yonetim/1",
      "/yonetim/1/duzenle",
    ]) {
      codes.push((await goto(page, p)).status());
    }
    check(
      codes.every((c) => c === 200),
      `AC1 ${email} opens the board pages with 200 (${codes})`,
    );
    await page.context().close();
  }
  const korist = await as(browser, "korist@arkhe.local");
  const landed = [];
  for (const p of [
    "/yonetim",
    "/yonetim/arsiv",
    "/yonetim/yeni",
    "/yonetim/1",
    "/yonetim/1/duzenle",
  ]) {
    await korist.goto(`${BASE}${p}`);
    // With a loading.tsx the redirect arrives in the stream, after load.
    await korist.waitForURL(`${BASE}/`, { timeout: 10_000 }).catch(() => {});
    landed.push(new URL(korist.url()).pathname);
  }
  check(
    landed.every((p) => p === "/"),
    `AC1 korist@ is redirected to / from every board page (${landed})`,
  );
  const before = await boardSnapshot();
  const { sef } = await people();
  const calls = {
    createTicket: ["form", [], { id: crypto.randomUUID(), title: "E2E korist", urgency: "medium" }],
    updateTicket: [
      "form",
      [1],
      {
        title: "E2E korist",
        description: "",
        assigneeId: "",
        urgency: "low",
        dueOn: "",
        revision: "0",
      },
    ],
    addComment: ["form", [1], { clientKey: crypto.randomUUID(), body: "E2E korist" }],
    moveTicket: ["plain", [{ number: 1, from: "todo", to: "done" }]],
    deleteTicket: ["plain", [1]],
    deleteComment: ["plain", [1]],
  };
  let refused = 0;
  for (const [name, [kind, args, fields]] of Object.entries(calls)) {
    if (!ids[name]) continue;
    const res =
      kind === "form"
        ? await callForm(korist, ids[name], args, fields)
        : await callAction(korist, ids[name], args);
    if (res.includes(FORBIDDEN)) refused++;
    else console.log(`${name} did not refuse: ${res.slice(0, 200)}`);
  }
  const seen = ids.markTicketSeen
    ? await callAction(korist, ids.markTicketSeen, [1, 999, 999])
    : "";
  check(
    refused === Object.keys(calls).length && seen.includes('"changed":false'),
    `AC1 every board action refuses korist@ with ${FORBIDDEN} (${refused}/${Object.keys(calls).length}; markTicketSeen → changed:false)`,
  );
  check((await boardSnapshot()) === before, "AC1 the refused calls change no board row");
  void sef;
  await goto(korist, "/");
  const html = await korist.content();
  check(
    (await korist.locator("[data-testid=home-board]").count()) === 0 &&
      !html.includes("Bahar konseri") &&
      !html.includes("Festival başvurusu"),
    "AC3 korist@ sees no board card and the home HTML holds no ticket title",
  );
  await korist.context().close();
}

async function navigation(browser) {
  const labels = async (page) =>
    (await page.locator("nav.fixed[aria-label='Ana menü'] a").allInnerTexts()).map((t) =>
      t
        .replace(/,.*$/s, "")
        .replace(/\s+/g, " ")
        .replace(/^(\d+|9\+) /, "")
        .trim(),
    );
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  const bar = await labels(yk);
  check(
    bar.join(",") === "Ana sayfa,Çalışmalar,Repertuvar,Ödevler,Yönetim" &&
      (await yk.locator("nav.fixed[aria-label='Ana menü'] a").nth(4).getAttribute("href")) ===
        "/yonetim" &&
      (await noOverflow(yk)),
    `AC2 the 375 px manager bar is Ana sayfa · Çalışmalar · Repertuvar · Ödevler · Yönetim (${bar})`,
  );
  await goto(yk, "/yonetim");
  const headerUyeler = yk.locator("main a[href='/uyeler']").first();
  await goto(yk, "/");
  const cardUyeler = yk.locator("[data-testid=home-board] a[href='/uyeler']");
  const cardOk = await cardUyeler.isVisible();
  await goto(yk, "/yonetim");
  check(
    (await headerUyeler.isVisible()) && cardOk && (await text(headerUyeler)) === "Üyeler",
    "AC2 on the phone Üyeler is linked from the board header and the home card footer",
  );
  await goto(yk, "/yonetim/2");
  check(
    (await yk.locator("nav.fixed a[href='/yonetim']").getAttribute("aria-current")) === "page",
    "AC2 the Yönetim tab has aria-current=page on a ticket page",
  );
  await yk.context().close();

  const korist = await as(browser, "korist@arkhe.local", { phone: true });
  const kb = await labels(korist);
  check(
    kb.join(",") === "Ana sayfa,Çalışmalar,Repertuvar,Ödevler",
    `AC2 korist@'s bar is unchanged, 4 tabs (${kb})`,
  );
  await korist.context().close();

  const desk = await as(browser, "sef@arkhe.local");
  await goto(desk, "/yonetim/arsiv");
  const side = desk.locator("aside nav[aria-label='Ana menü'] a");
  const names = (await side.allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
  const i = names.indexOf("Yönetim Kurulu");
  check(
    i > 0 && names[i - 1] === "Finans" && names[i + 1] === "Üyeler",
    `AC2 the sidebar has Yönetim Kurulu between Finans and Üyeler (${names})`,
  );
  check(
    (await desk.locator("aside a[href='/yonetim']").getAttribute("aria-current")) === "page",
    "AC2 the sidebar entry has aria-current=page on /yonetim/arsiv",
  );
  await desk.context().close();
  const kd = await as(browser, "korist@arkhe.local");
  check(
    (await kd.locator("aside a[href='/yonetim']").count()) === 0,
    "AC2 korist@'s sidebar has no Yönetim Kurulu",
  );
  await kd.context().close();
}

async function home(browser) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/");
  const card = yk.locator("[data-testid=home-board]");
  const position = await yk.evaluate(() => {
    const hero = document.querySelector("section[aria-label='Sıradaki çalışma']");
    return hero?.nextElementSibling?.getAttribute("data-testid");
  });
  check(position === "home-board", `AC3 the home card sits directly below the hero (${position})`);
  const summary = yk.locator("[data-testid=home-board-summary]");
  check(
    (await text(summary)) === "Sana atanan 2 açık iş · 1 yeni · 1 acil" &&
      (await summary.getAttribute("href")) === "/yonetim?kim=ben" &&
      (await card.getAttribute("data-open")) === "2",
    `AC3 yk@: ${await text(summary)} → /yonetim?kim=ben`,
  );
  check(
    (await text(yk.locator("[data-testid=home-board-top]"))).includes(
      "#1 Bahar konseri için salon rezervasyonu",
    ),
    "AC3 the card shows the first assigned ticket in board order (#1)",
  );
  await yk.context().close();

  const { sef, yk: ykId } = await people();
  await db.execute({
    sql: "update board_tickets set assignee_id = ? where assignee_id = ? and status <> 'done'",
    args: [ykId, sef],
  });
  const s = await as(browser, "sef@arkhe.local", { phone: true });
  await goto(s, "/");
  const sc = s.locator("[data-testid=home-board]");
  check(
    (await text(sc)).includes("Sana atanmış açık iş yok.") &&
      (await sc.getByRole("link", { name: "Panoya git" }).getAttribute("href")) === "/yonetim",
    "AC3 with nothing assigned: Sana atanmış açık iş yok. and Panoya git → /yonetim",
  );
  await s.context().close();
  await reset();
}

async function mobileBoard(browser) {
  await reset();
  for (const scheme of ["light", "dark"]) {
    const yk = await as(browser, "yk@arkhe.local", { phone: true, scheme });
    await goto(yk, "/yonetim");
    const nav = yk.locator("nav[aria-label=Sütunlar]");
    const names = await nav.locator("a").evaluateAll((els) => els.map((e) => e.innerText));
    const acc = [];
    for (const n of ["Yapılacak, 2 iş", "Devam ediyor, 1 iş", "Takıldı, 1 iş", "Bitti, 1 iş"]) {
      acc.push(await nav.getByRole("link", { name: n, exact: true }).count());
    }
    check(
      acc.every((c) => c === 1) &&
        JSON.stringify(await tabCounts(yk)) ===
          JSON.stringify({ todo: 2, in_progress: 1, blocked: 1, done: 1 }),
      `AC4 ${scheme}: four tabs with data-count and names "<Sütun>, <n> iş" (${names.length})`,
    );
    const newBtn = yk.getByRole("link", { name: "Yeni iş", exact: true });
    check(
      (await yk.locator("h1").innerText()) === "Yönetim Kurulu" &&
        (await newBtn.boundingBox()).height >= 44,
      `AC4 ${scheme}: title Yönetim Kurulu and a ≥ 44 px Yeni iş`,
    );
    check(
      (await nav.locator("a[aria-current]").getAttribute("data-status")) === "todo" &&
        JSON.stringify(await visibleCards(yk)) === "[1,4]",
      `AC4 ${scheme}: Yapılacak is the default and only its cards show`,
    );
    const shown = {};
    for (const [status, slug] of [
      ["in_progress", "devam"],
      ["blocked", "takildi"],
      ["done", "bitti"],
    ]) {
      await nav.locator(`a[data-status=${status}]`).click();
      await yk.waitForTimeout(150);
      shown[status] = {
        url: new URL(yk.url()).searchParams.get("sutun") === slug,
        cards: await visibleCards(yk),
        fits: await noOverflow(yk),
        small: await smallTargets(yk),
      };
    }
    check(
      shown.in_progress.url &&
        JSON.stringify(shown.in_progress.cards) === "[2]" &&
        JSON.stringify(shown.blocked.cards) === "[3]" &&
        JSON.stringify(shown.done.cards) === "[5]",
      `AC4 ${scheme}: each tab sets ?sutun= and shows only its column (${JSON.stringify(shown)})`,
    );
    await yk.reload();
    await yk.locator("h1").waitFor();
    check(
      JSON.stringify(await visibleCards(yk)) === "[5]" &&
        (await nav.locator("a[aria-current]").getAttribute("data-status")) === "done",
      `AC4 ${scheme}: the tab survives a reload`,
    );
    const fits = Object.values(shown).every((s) => s.fits) && (await noOverflow(yk));
    check(fits, `AC4/AC42 ${scheme}: no horizontal scroll on any tab`);
    const small = Object.values(shown).flatMap((s) => s.small);
    check(small.length === 0, `AC42 ${scheme}: every board target ≥ 44 px (${small.slice(0, 4)})`);
    await yk.context().close();
  }
}

async function wideBoard(browser) {
  for (const width of [1280, 1024, 768]) {
    const page = await as(browser, "yk@arkhe.local", { width });
    await goto(page, "/yonetim");
    const nav = await page.locator("nav[aria-label=Sütunlar]").isVisible();
    const sections = await page
      .locator("section[data-status]")
      .evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).length);
    if (width === 1280) {
      const heads = await page
        .locator("section[data-status] h2")
        .evaluateAll((els) =>
          els
            .filter((e) => e.getBoundingClientRect().height > 1)
            .map((e) => e.innerText.replace(/\s+/g, " ")),
        );
      check(
        !nav &&
          sections === 4 &&
          heads.join("|") === "Yapılacak 2|Devam ediyor 1|Takıldı 1|Bitti 1",
        `AC5 1280 px: four columns with h2 and count, no Sütunlar nav (${heads})`,
      );
      const regions = [];
      for (const n of ["Yapılacak 2", "Devam ediyor 1", "Takıldı 1", "Bitti 1"]) {
        regions.push(await page.getByRole("region", { name: n }).count());
      }
      check(
        regions.every((r) => r === 1),
        "AC43 the xl columns are sections labelled by their h2",
      );
    } else {
      check(
        nav && sections === 1,
        `AC5 ${width} px: the Sütunlar nav and one column (${sections})`,
      );
    }
    await page.context().close();
  }
}

async function cards(browser) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(yk, "/yonetim");
  const c2 = yk.locator("[data-testid=ticket-card][data-number='2']");
  const c1 = yk.locator("[data-testid=ticket-card][data-number='1']");
  const c4 = yk.locator("[data-testid=ticket-card][data-number='4']");
  const c2text = await text(c2);
  check(
    (await c2.getAttribute("data-status")) === "in_progress" &&
      (await c2.getAttribute("data-urgency")) === "high" &&
      (await c2.locator("[data-overdue=true]").count()) === 1 &&
      /Gecikti · \d+ \S+/.test(c2text) &&
      (await text(c2.locator("[data-testid=comment-count]"))) === "2 yorum" &&
      c2text.includes("Yüksek") &&
      c2text.includes("Demo Yönetim") &&
      c2text.includes("#2"),
    `AC6 #2: number, title, Yüksek, Gecikti, 2 comments, assignee (${c2text})`,
  );
  const overdueColor = await c2
    .locator("[data-overdue=true]")
    .evaluate((e) => e.className.includes("text-absent-ink"));
  const urgentChip = await c1
    .locator("[data-testid=urgency-chip]")
    .evaluate((e) => e.className.includes("bg-absent"));
  const highChip = await c2
    .locator("[data-testid=urgency-chip]")
    .evaluate((e) => e.className.includes("text-late-ink"));
  check(
    overdueColor && urgentChip && highChip,
    "AC6 Acil uses the alert tone, Yüksek the warning tone, Gecikti alert",
  );
  check(
    (await c1.getAttribute("data-new")) === "true" &&
      (await c1.getByRole("link", { name: /, yeni$/ }).count()) === 1 &&
      (await c1.locator("a").first().getAttribute("href")) === "/yonetim/1",
    "AC6 #1 shows the Yeni dot with the accessible text yeni; the card links to /yonetim/1",
  );
  check((await text(c4)).includes("Atanmadı"), "AC6 an unassigned card shows Atanmadı");
  const clamp = await c1.locator("h3 a").evaluate((e) => getComputedStyle(e).webkitLineClamp);
  check(clamp === "2", `AC6 the title is clamped to 2 lines (${clamp})`);
  await yk.context().close();
}

async function order(browser) {
  await reset();
  const { yk } = await people();
  const today = istanbulDate();
  const plus = (n) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + n * D * 1000).toISOString().slice(0, 10);
  const a = await insertTicket({
    title: "E2E sıra low",
    status: "blocked",
    urgency: "low",
    by: yk,
  });
  const b = await insertTicket({
    title: "E2E sıra acil tarihsiz",
    status: "blocked",
    urgency: "urgent",
    by: yk,
  });
  const c = await insertTicket({
    title: "E2E sıra acil geç",
    status: "blocked",
    urgency: "urgent",
    due: plus(9),
    by: yk,
  });
  const d = await insertTicket({
    title: "E2E sıra acil erken",
    status: "blocked",
    urgency: "urgent",
    due: plus(2),
    by: yk,
  });
  const e = await insertTicket({
    title: "E2E sıra orta yeni",
    status: "blocked",
    urgency: "medium",
    updatedAgoS: 60,
    by: yk,
  });
  const f = await insertTicket({
    title: "E2E bitti eski",
    status: "done",
    doneAgoS: 3 * D,
    by: yk,
  });
  const g = await insertTicket({ title: "E2E bitti yeni", status: "done", doneAgoS: 60, by: yk });
  const page = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(page, "/yonetim");
  const blocked = await visibleCards(page, "blocked");
  const expected = [d.number, c.number, b.number, e.number, 3, a.number];
  check(
    JSON.stringify(blocked) === JSON.stringify(expected),
    `AC7 urgency, then due (none last), then most recently updated (${blocked} vs ${expected})`,
  );
  const done = await visibleCards(page, "done");
  check(
    JSON.stringify(done) === JSON.stringify([g.number, f.number, 5]),
    `AC7 Bitti is newest done_at first (${done})`,
  );
  await page.context().close();
  await deleteTickets();
}

async function filters(browser) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim?kim=ben");
  const counts = await tabCounts(yk);
  check(
    counts.todo === 1 && counts.in_progress === 1 && counts.blocked === 0 && counts.done === 0,
    `AC9 kim=ben: only yk@'s 2 tickets in the counts (${JSON.stringify(counts)})`,
  );
  check(
    (await yk.locator("nav[aria-label=Kişi] a[aria-current=page]").innerText()).startsWith(
      "Bana atananlar",
    ),
    "AC9 the active Bana atananlar chip has aria-current",
  );
  await goto(yk, "/yonetim?kim=ben&aciliyet=acil");
  const narrowed = await tabCounts(yk);
  const trigger = yk.getByRole("button", { name: /Acil/ }).first();
  const clear = yk.getByRole("link", { name: "Aciliyet filtresini kaldır" });
  check(
    narrowed.todo === 1 &&
      narrowed.in_progress === 0 &&
      JSON.stringify(await visibleCards(yk)) === "[1]",
    `AC9 aciliyet=acil narrows further (${JSON.stringify(narrowed)})`,
  );
  check(
    (await text(trigger)) === "Aciliyet: Acil" &&
      (await clear.boundingBox()).height >= 44 &&
      new URL(await clear.getAttribute("href"), BASE).searchParams.get("aciliyet") === null &&
      new URL(await clear.getAttribute("href"), BASE).searchParams.get("kim") === "ben",
    "AC9 below lg the trigger shows Acil, with a 44 px × link Aciliyet filtresini kaldır",
  );
  await goto(yk, "/yonetim");
  await yk.getByRole("button", { name: "Aciliyet: Tümü" }).click();
  await yk.getByRole("menuitem").first().waitFor();
  const items = await yk.getByRole("menuitem").allInnerTexts();
  const current = await yk.locator("[role=menuitem][aria-current=page]").innerText();
  check(
    items.map((t) => t.trim()).join(",") === "Tümü,Acil,Yüksek,Orta,Düşük" &&
      current.trim() === "Tümü",
    `AC9 the urgency dropdown holds 5 links, Tümü current (${items})`,
  );
  await yk.keyboard.press("Escape");
  await goto(yk, "/yonetim?aciliyet=xyz&kim=nobody");
  const all = await tabCounts(yk);
  check(
    JSON.stringify(all) === JSON.stringify({ todo: 2, in_progress: 1, blocked: 1, done: 1 }),
    `AC9 unknown values are ignored (${JSON.stringify(all)})`,
  );
  await yk.context().close();
  const wide = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(wide, "/yonetim?aciliyet=yuksek");
  const chips = await wide.locator("nav[aria-label=Aciliyet] a").allInnerTexts();
  check(
    chips.join(",") === "Tümü,Acil,Yüksek,Orta,Düşük" &&
      (await wide.locator("nav[aria-label=Aciliyet] a[aria-current=page]").innerText()) ===
        "Yüksek" &&
      JSON.stringify(await visibleCards(wide)) === "[2]",
    `AC9 from lg the urgency chips are inline with Tümü (${chips})`,
  );
  await wide.context().close();
}

async function emptyStates(browser) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim?sutun=takildi&kim=ben");
  const sec = yk.locator("section[data-status=blocked]");
  check(
    (await text(sec)).includes("Bu filtreye uyan iş yok.") &&
      (await sec.getByRole("link", { name: "Filtreleri temizle" }).getAttribute("href")) ===
        "/yonetim?sutun=takildi",
    "AC8 a filter with no match: Bu filtreye uyan iş yok. + Filtreleri temizle → /yonetim?sutun=takildi",
  );
  await db.execute("update board_tickets set status = 'todo' where status = 'blocked'");
  await goto(yk, "/yonetim?sutun=takildi");
  check(
    (await text(sec)).includes("Bu sütunda iş yok."),
    "AC8 an empty column: Bu sütunda iş yok.",
  );
  await db.execute("delete from board_tickets");
  await goto(yk, "/yonetim");
  const main = await text(yk.locator("main"));
  check(
    main.includes("Panoda henüz iş yok.") &&
      main.includes(
        "Kurulun yapacağı işleri buraya yaz. Her işin bir numarası olur; WhatsApp'ta “12 numaralı iş” diye paylaşabilirsin.",
      ) &&
      (await yk.locator("nav[aria-label=Sütunlar]").count()) === 0,
    "AC8 an empty board: Panoda henüz iş yok. with the hint",
  );
  await yk.context().close();
  await reset();
}

async function createAndValidate(browser, ids) {
  await reset();
  const { sef, yk: ykId, korist } = await people();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim/yeni?sutun=takildi");
  check(
    (await yk.locator("input[name=status][value=blocked]").isChecked()) &&
      (await yk.locator("input[name=urgency][value=medium]").isChecked()),
    "AC10 the form defaults: Aciliyet Orta, Durum from ?sutun= (Takıldı)",
  );
  await goto(yk, "/yonetim/yeni");
  const options = await yk.locator("select[name=assigneeId] option").allInnerTexts();
  const managers = (
    await db.execute(
      "select name from users where is_active = 1 and role in ('conductor','board') order by name",
    )
  ).rows.map((r) => r.name);
  check(
    options[0] === "Atanmadı" &&
      JSON.stringify(options.slice(1).sort()) === JSON.stringify([...managers].sort()),
    `AC11 Sorumlu offers Atanmadı, then exactly the active managers (${options})`,
  );
  check(
    (await yk.locator("input[name=status][value=todo]").isChecked()) &&
      (await yk.locator("input[name=dueOn]").getAttribute("type")) === "date",
    "AC10 Durum defaults to Yapılacak; Son tarih is a native date input",
  );
  await yk.getByRole("button", { name: "Bana ata" }).click();
  check(
    (await yk.locator("select[name=assigneeId]").inputValue()) === ykId,
    "AC10 Bana ata sets Sorumlu to me",
  );

  // Validation, values kept.
  await yk.fill("input[name=title]", "ab");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  check(await toast(yk, "Başlık en az 3 karakter olmalı."), "AC10 Başlık en az 3 karakter olmalı.");
  check(
    (await yk.locator("input[name=title]").inputValue()) === "ab",
    "AC10 the typed value is kept",
  );
  await yk.fill("input[name=title]", "x".repeat(121));
  await yk.getByRole("button", { name: "Kaydet" }).click();
  check(
    await toast(yk, "Başlık en fazla 120 karakter olabilir."),
    "AC10 Başlık en fazla 120 karakter olabilir.",
  );
  await yk.fill("input[name=title]", "E2E geçerli başlık");
  await yk.locator("textarea[name=description]").fill("y".repeat(4001));
  await yk.getByRole("button", { name: "Kaydet" }).click();
  check(
    await toast(yk, "Açıklama en fazla 4000 karakter olabilir."),
    "AC10 Açıklama en fazla 4000 karakter olabilir.",
  );
  const badDate = await callForm(yk, ids.createTicket, [], {
    id: crypto.randomUUID(),
    title: "E2E tarih",
    urgency: "medium",
    dueOn: "2026-02-30",
  });
  check(
    badDate.includes("Geçerli bir tarih seç."),
    "AC10 an impossible date: Geçerli bir tarih seç.",
  );
  const badAssignee = await callForm(yk, ids.createTicket, [], {
    id: crypto.randomUUID(),
    title: "E2E korist sorumlu",
    urgency: "medium",
    assigneeId: korist,
  });
  check(
    badAssignee.includes("Bu kişi sorumlu olarak seçilemez."),
    "AC11 a member as assignee is refused",
  );
  check(
    (await scalar("select count(*) from board_tickets where title like 'E2E%'")) === 0,
    "AC10 invalid submits save nothing",
  );

  // Create.
  await goto(yk, "/yonetim/yeni");
  await yk.fill("input[name=title]", "  E2E Bahar provası için salon  ");
  await yk.locator("select[name=assigneeId]").selectOption(sef);
  await yk.locator("textarea[name=description]").fill("Satır bir\nSatır iki");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForURL(/\/yonetim\/\d+$/);
  const n = Number(new URL(yk.url()).pathname.split("/").pop());
  const row = await ticketRow(n);
  const first = (await eventsOf(n))[0];
  check(
    n === 7 &&
      row.title === "E2E Bahar provası için salon" &&
      row.assignee_id === sef &&
      row.created_by === ykId &&
      row.status === "todo" &&
      row.urgency === "medium" &&
      row.description === "Satır bir\nSatır iki",
    `AC10 Kaydet creates #7 with the trimmed title, assignee sef@ and defaults (#${n})`,
  );
  check(await toast(yk, `#${n} açıldı.`), `AC10 the toast #${n} açıldı.`);
  check(
    first?.kind === "created" &&
      (await text(yk.locator("[data-testid=thread] li").first())).startsWith(
        "Demo Yönetim bu işi açtı.",
      ),
    "AC10 the creation system entry is the first thread item",
  );
  check(
    (await yk.locator("[data-testid=ticket-description]").innerText()).includes(
      "Satır bir\nSatır iki",
    ),
    "AC12 the description keeps its line breaks",
  );
  await yk.context().close();
}

async function formerManager(browser) {
  await reset();
  const { sef } = await people();
  const uid = crypto.randomUUID();
  await db.execute({
    sql: "insert into users (id, name, email, role, voice_part) values (?, 'Eski Kurulcu', 'p8former@e2e.test', 'board', 'alto')",
    args: [uid],
  });
  const t = await insertTicket({ title: "E2E eski kurulcunun işi", assignee: uid, by: sef });
  await db.execute({ sql: "update users set role = 'member' where id = ?", args: [uid] });
  const page = await as(browser, "sef@arkhe.local", { width: 1280 });
  await goto(page, "/yonetim");
  const card = await text(page.locator(`[data-testid=ticket-card][data-number='${t.number}']`));
  await goto(page, `/yonetim/${t.number}/duzenle`);
  const opts = await page.locator("select[name=assigneeId] option").allInnerTexts();
  const selected = await page.locator("select[name=assigneeId]").inputValue();
  check(
    card.includes("Eski Kurulcu (kurulda değil)") &&
      opts.includes("Eski Kurulcu (kurulda değil)") &&
      selected === uid,
    `AC11 a demoted assignee keeps the name with (kurulda değil), offered only as the current value`,
  );
  await page.context().close();
  await deleteTickets();
  await db.execute({ sql: "delete from users where id = ?", args: [uid] });
}

async function detail(browser) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim/2");
  const facts = await text(yk.locator("[data-testid=ticket-facts]"));
  check(
    (await yk.locator("h1").innerText()) === "Festival başvurusu: katılım ücretini sor" &&
      (await text(yk.locator("[data-testid=ticket-number]"))) === "#2" &&
      (await yk.getByRole("button", { name: /^Durum: Devam ediyor/ }).count()) === 1 &&
      facts.includes("Yüksek") &&
      facts.includes("Demo Yönetim") &&
      facts.includes("Gecikti") &&
      /Açan: Demo Yönetim · \d+ \S+ \d{4}/.test(facts) &&
      /Son değişiklik: Demo Yönetim · \d+ \S+ \d{4} \d\d:\d\d/.test(facts),
    `AC12 #2 shows number, title, status, urgency, assignee, due, Açan and Son değişiklik (${facts})`,
  );
  const kinds = await yk
    .locator("[data-testid=thread] > li")
    .evaluateAll((els) => els.map((e) => e.dataset.kind));
  check(
    kinds.join(",") === "system,system,comment,comment" &&
      (await yk.locator("label", { hasText: "Yorum ekle" }).count()) === 1,
    `AC12 the thread is oldest first, then the comment box (${kinds})`,
  );
  check(
    (await yk.getByRole("link", { name: "Panoya dön" }).getAttribute("href")) ===
      "/yonetim?sutun=devam",
    "AC12 Panoya dön → /yonetim?sutun=devam",
  );
  await goto(yk, "/yonetim/4");
  const f4 = await text(yk.locator("[data-testid=ticket-facts]"));
  check(
    f4.includes("Son tarih yok") && !f4.includes("Son değişiklik"),
    "AC12 #4: Son tarih yok and no Son değişiklik",
  );
  const r1 = await yk.request.get(`${BASE}/yonetim/9999`);
  const r2 = await yk.request.get(`${BASE}/yonetim/abc`);
  check(
    r1.status() === 404 && r2.status() === 404,
    `AC12 /yonetim/9999 and /yonetim/abc → 404 (${r1.status()}, ${r2.status()})`,
  );
  await yk.context().close();
}

async function edit(browser, ids) {
  await reset();
  const sef = await as(browser, "sef@arkhe.local", { phone: true });
  const before = (await eventsOf(2)).length;
  await goto(sef, "/yonetim/2/duzenle");
  await sef.fill("input[name=title]", "Festival başvurusu: ücreti ve tarihleri sor");
  await sef.locator("label", { has: sef.locator("input[name=urgency][value=urgent]") }).click();
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForURL(`${BASE}/yonetim/2`);
  const after = await eventsOf(2);
  const added = after.slice(before);
  check(
    added.length === 1 &&
      added[0].kind === "urgency" &&
      added[0].from_value === "high" &&
      added[0].to_value === "urgent",
    `AC13 sef@ edits yk@'s ticket: exactly one urgency entry, none for the title (${added.map((e) => e.kind)})`,
  );
  check(await toast(sef, "Kaydedildi."), "AC13 the toast Kaydedildi.");
  const facts = await text(sef.locator("[data-testid=ticket-facts]"));
  const thread = await text(sef.locator("[data-testid=thread]"));
  check(
    facts.includes("Son değişiklik: Demo Şef") &&
      thread.includes("Demo Şef aciliyeti Yüksek → Acil olarak değiştirdi."),
    "AC13/AC17 Son değişiklik names Demo Şef; the urgency sentence is in the thread",
  );
  check(
    (await sef.locator("[data-kind=system] button").count()) === 0,
    "AC17 system entries have no delete control",
  );

  // Assignee and due entries, in order.
  const today = istanbulDate();
  const d1 = new Date(Date.parse(`${today}T00:00:00Z`) + 20 * D * 1000).toISOString().slice(0, 10);
  const d2 = new Date(Date.parse(`${today}T00:00:00Z`) + 27 * D * 1000).toISOString().slice(0, 10);
  const short = (d) =>
    new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Istanbul",
    }).format(new Date(`${d}T12:00:00Z`));
  await goto(sef, "/yonetim/4/duzenle");
  await sef.locator("select[name=assigneeId]").selectOption({ label: "Demo Yönetim" });
  await sef.fill("input[name=dueOn]", d1);
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForURL(`${BASE}/yonetim/4`);
  await goto(sef, "/yonetim/4/duzenle");
  await sef.fill("input[name=dueOn]", d2);
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForURL(`${BASE}/yonetim/4`);
  await goto(sef, "/yonetim/4/duzenle");
  await sef.getByRole("button", { name: "Tarihi kaldır" }).click();
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForURL(`${BASE}/yonetim/4`);
  const sentences = await sef
    .locator("[data-kind=system] [data-testid=system-text]")
    .allInnerTexts();
  const expected = [
    "Demo Şef bu işi açtı.",
    "Demo Şef sorumluyu Atanmadı → Demo Yönetim olarak değiştirdi.",
    `Demo Şef son tarih koydu: ${short(d1)}.`,
    `Demo Şef son tarihi ${short(d1)} → ${short(d2)} olarak değiştirdi.`,
    "Demo Şef son tarihi kaldırdı.",
  ];
  check(
    JSON.stringify(sentences) === JSON.stringify(expected),
    `AC17 assignee and due-date sentences in order (${sentences.join(" | ")})`,
  );
  const timed = await sef.locator("[data-kind=system] time").count();
  check(timed === sentences.length, "AC17 every system entry has a tr-TR timestamp");

  // Stale: two editors.
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(sef, "/yonetim/4/duzenle");
  await goto(yk, "/yonetim/4/duzenle");
  await sef.fill("input[name=title]", "E2E sef kazandı");
  await sef.getByRole("button", { name: "Kaydet" }).click();
  await sef.waitForURL(`${BASE}/yonetim/4`);
  await yk.fill("input[name=title]", "E2E yk geç kaldı");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  const alert = yk.locator("[role=alert]", { hasText: STALE });
  await alert.waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    (await alert.count()) === 1 &&
      (await alert.getByRole("button", { name: "Yenile" }).count()) === 1 &&
      (await ticketRow(4)).title === "E2E sef kazandı",
    "AC13 a stale edit is refused with the message and Yenile; nothing is saved",
  );
  await alert.getByRole("button", { name: "Yenile" }).click();
  await yk
    .waitForFunction(
      () => document.querySelector("input[name=title]")?.value === "E2E sef kazandı",
      null,
      { timeout: 10_000 },
    )
    .catch(() => {});
  check(
    (await yk.locator("input[name=title]").inputValue()) === "E2E sef kazandı",
    "AC13 Yenile reloads the editor with the current values",
  );
  // A move after the editor opened makes it stale too.
  await goto(yk, "/yonetim/4/duzenle");
  const moved = await callAction(sef, ids.moveTicket, [
    { number: 4, from: "todo", to: "in_progress" },
  ]);
  await yk.fill("input[name=title]", "E2E taşındıktan sonra");
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await alert.waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    moved.includes("sütununa taşındı") &&
      (await alert.count()) === 1 &&
      (await ticketRow(4)).title === "E2E sef kazandı",
    "AC13 a move after the editor opened makes the save stale",
  );
  await sef.context().close();
  await yk.context().close();
}

async function remove(browser, ids) {
  await reset();
  const { sef, yk: ykId } = await people();
  const own = await insertTicket({ title: "E2E yk silinecek", by: ykId, number: 7 });
  await db.execute("update board_ticket_seq set last_number = 7");
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, `/yonetim/${own.number}`);
  const endDelete = yk.getByRole("button", { name: "İşi sil", exact: true });
  const lastBox = await yk.evaluate(() => {
    const els = [...document.querySelectorAll("main button, main a, main textarea")].filter(
      (e) => e.offsetParent,
    );
    return els.at(-1)?.textContent?.trim();
  });
  check(
    (await endDelete.isVisible()) &&
      (await yk.getByRole("button", { name: "Sil", exact: true }).count()) === 0 &&
      lastBox === "İşi sil",
    `UX P2-6 on the phone delete is the ghost İşi sil at the end of the page (${lastBox})`,
  );
  await endDelete.click();
  const dialog = yk.getByRole("alertdialog");
  check(
    (await text(dialog)).includes(`#${own.number} silinsin mi?`) &&
      (await text(dialog)).includes("İş ve tüm yorumları kalıcı olarak silinir.") &&
      (await dialog.getByRole("button", { name: "Vazgeç" }).count()) === 1,
    "AC14 the confirm reads #N silinsin mi? / İş ve tüm yorumları kalıcı olarak silinir.",
  );
  await dialog.getByRole("button", { name: "Sil" }).click();
  await yk.waitForURL(`${BASE}/yonetim`);
  check(
    (await toast(yk, `#${own.number} silindi.`)) && !(await ticketRow(own.number)),
    `AC14 yk@ deletes their own ticket → /yonetim with #${own.number} silindi.`,
  );
  await goto(yk, "/yonetim/1");
  check(
    (await yk.getByRole("button", { name: /^(Sil|İşi sil)$/ }).count()) === 0,
    "AC14 yk@ sees no Sil on sef@'s ticket",
  );
  const denied = await callAction(yk, ids.deleteTicket, [1]);
  check(
    denied.includes("Bu işi yalnızca açan kişi ya da koro şefi silebilir.") && (await ticketRow(1)),
    "AC14 a direct delete of sef@'s ticket by yk@ is refused",
  );
  const s = await as(browser, "sef@arkhe.local", { phone: true });
  const ykTicket = await ticketRow(2);
  check(ykTicket.created_by === ykId, "AC14 precondition: #2 was opened by yk@");
  await goto(s, "/yonetim/2");
  await s.getByRole("button", { name: "İşi sil", exact: true }).click();
  await s.getByRole("alertdialog").getByRole("button", { name: "Sil" }).click();
  await s.waitForURL(`${BASE}/yonetim`);
  check(!(await ticketRow(2)), "AC14 the conductor deletes yk@'s ticket");
  // High-water number: delete the highest, the next one is never reused.
  const high = Number(await scalar("select max(number) from board_tickets"));
  await callAction(s, ids.deleteTicket, [high]);
  await goto(s, "/yonetim/yeni");
  await s.fill("input[name=title]", "E2E numara sırası");
  await s.getByRole("button", { name: "Kaydet" }).click();
  await s.waitForURL(/\/yonetim\/\d+$/);
  const next = Number(new URL(s.url()).pathname.split("/").pop());
  check(
    next === 8 && next > high,
    `AC14 after deleting #${high} (and #7 earlier) the next ticket is #${next}`,
  );
  void sef;
  await yk.context().close();
  await s.context().close();
}

async function moves(browser) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim");
  const trigger = yk.getByRole("button", { name: "#4 taşı" });
  check((await trigger.boundingBox()).height >= 44, "AC15 Taşı is ≥ 44 px with the name #4 taşı");
  const menu = await openMove(yk, 4);
  await menu.getByRole("menuitem").first().waitFor();
  const items = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
  check(
    items.join(",") === "Devam ediyor,Takıldı,Bitti",
    `AC15 the menu offers the other three columns (${items})`,
  );
  await menu.getByRole("menuitem", { name: "Takıldı" }).click();
  check(
    await toast(yk, "#4 Takıldı sütununa taşındı."),
    "AC15 the toast #4 Takıldı sütununa taşındı.",
  );
  await yk
    .waitForFunction(
      () =>
        document.querySelector("nav[aria-label=Sütunlar] a[data-status=blocked]")?.dataset.count ===
        "2",
      null,
      { timeout: 10_000 },
    )
    .catch(() => {});
  const counts = await tabCounts(yk);
  check(
    counts.todo === 1 && counts.blocked === 2 && (await ticketRow(4)).status === "blocked",
    `AC15 both counts update and the DB says blocked (${JSON.stringify(counts)})`,
  );
  await yk
    .locator("[data-sonner-toast]", { hasText: "#4 Takıldı" })
    .getByRole("button", { name: "Göster" })
    .click();
  await yk.waitForURL(/sutun=takildi/);
  await yk.waitForTimeout(300);
  check((await visibleCards(yk)).includes(4), "AC15 Göster opens ?sutun=takildi with the card");
  await (await openMove(yk, 4)).getByRole("menuitem", { name: "Bitti" }).click();
  await toast(yk, "#4 Bitti sütununa taşındı.");
  const done = await ticketRow(4);
  await yk.waitForTimeout(300);
  await yk.goto(`${BASE}/yonetim?sutun=bitti`);
  await (await openMove(yk, 4)).getByRole("menuitem", { name: "Yapılacak" }).click();
  await toast(yk, "#4 Yapılacak sütununa taşındı.");
  const back = await ticketRow(4);
  check(
    done.done_at !== null && back.done_at === null,
    "AC15 moving to Bitti sets done_at; moving out clears it",
  );
  await yk.context().close();

  // Keyboard only, at 1280.
  const desk = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(desk, "/yonetim");
  await desk.getByRole("button", { name: "#3 taşı" }).focus();
  await desk.keyboard.press("Enter");
  await desk.getByRole("menu").waitFor();
  for (let i = 0; i < 4; i++) {
    const focused = await desk.evaluate(() => document.activeElement?.textContent?.trim());
    if (focused === "Devam ediyor") break;
    await desk.keyboard.press("ArrowDown");
  }
  await desk.keyboard.press("Enter");
  check(
    (await toast(desk, "#3 Devam ediyor sütununa taşındı.")) &&
      (await ticketRow(3)).status === "in_progress",
    "AC15 a keyboard-only move (Enter, arrows, Enter) at 1280",
  );
  // #3 was alone in Takıldı: at xl the column heading takes the focus.
  const deskFocus = await desk.evaluate(() => document.activeElement?.id ?? "");
  check(
    deskFocus === "sutun-takildi",
    `AC15 after the last card leaves, focus is on its column heading (${deskFocus})`,
  );
  await desk.context().close();

  // Below xl the heading is sr-only, so the last card's move focuses the visible tab.
  await reset();
  const kb = await as(browser, "yk@arkhe.local", { width: 1024 });
  await goto(kb, "/yonetim?sutun=takildi");
  await kb.getByRole("button", { name: "#3 taşı" }).focus();
  await kb.keyboard.press("Enter");
  await kb.getByRole("menu").waitFor();
  for (let i = 0; i < 4; i++) {
    const focused = await kb.evaluate(() => document.activeElement?.textContent?.trim());
    if (focused === "Bitti") break;
    await kb.keyboard.press("ArrowDown");
  }
  await kb.keyboard.press("Enter");
  await toast(kb, "#3 Bitti sütununa taşındı.");
  const tabFocus = await kb.evaluate(() => {
    const a = document.activeElement;
    return a?.closest("nav[aria-label=Sütunlar]") ? a.getAttribute("data-status") : a?.tagName;
  });
  check(
    tabFocus === "blocked",
    `UI P3-3 below xl the focus lands on the Takıldı tab (${tabFocus})`,
  );
  // A card with a neighbour: focus moves to the next card's title link.
  await goto(kb, "/yonetim");
  await kb.getByRole("button", { name: "#1 taşı" }).focus();
  await kb.keyboard.press("Enter");
  await kb.getByRole("menu").waitFor();
  await kb.keyboard.press("Enter");
  await toast(kb, "#1 Devam ediyor sütununa taşındı.");
  const neighbour = await kb.evaluate(
    () =>
      document.activeElement?.closest("[data-testid=ticket-card]")?.getAttribute("data-number") ??
      "",
  );
  check(neighbour === "4", `AC15 focus moves to the neighbouring card #4 (${neighbour})`);
  await kb.context().close();
  await reset();

  // Detail page: the Durum menu.
  const det = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(det, "/yonetim/4");
  await det.evaluate(() => (window.__noReload = true));
  const statusBefore = (await eventsOf(4, "status")).length;
  const btn = det.getByRole("button", { name: /^Durum: Yapılacak/ });
  await btn.focus();
  await det.keyboard.press("ArrowDown");
  await det.waitForTimeout(800);
  check(
    (await ticketRow(4)).status === "todo",
    "AC16 one arrow press alone never moves the ticket",
  );
  await det.keyboard.press("Escape");
  await btn.focus();
  await det.keyboard.press("Enter");
  await det.getByRole("menu").waitFor();
  for (let i = 0; i < 4; i++) {
    const focused = await det.evaluate(() => document.activeElement?.textContent?.trim());
    if (focused === "Takıldı") break;
    await det.keyboard.press("ArrowDown");
  }
  await det.keyboard.press("Enter");
  check(
    await toast(det, "#4 Takıldı sütununa taşındı."),
    "AC16 the Durum menu gives the same toast",
  );
  await det
    .getByRole("button", { name: /^Durum: Takıldı/ })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  const thread = await text(det.locator("[data-testid=thread]"));
  check(
    (await det.evaluate(() => window.__noReload === true)) &&
      thread.includes("Demo Yönetim durumu Yapılacak → Takıldı olarak değiştirdi.") &&
      (await eventsOf(4, "status")).length === statusBefore + 1,
    "AC16/AC17 the new system entry appears without a full reload",
  );
  const detFocus = await det.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  check(
    detFocus.startsWith("Durum: Takıldı"),
    `AC15 after a detail-page move the focus stays on the Durum button (${detFocus})`,
  );
  await det.context().close();
}

async function concurrent(browser) {
  await reset();
  const sef = await as(browser, "sef@arkhe.local", { width: 1280 });
  const yk = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(sef, "/yonetim");
  await goto(yk, "/yonetim");
  await (await openMove(sef, 4)).getByRole("menuitem", { name: "Devam ediyor" }).click();
  await toast(sef, "#4 Devam ediyor sütununa taşındı.");
  await (await openMove(yk, 4)).getByRole("menuitem", { name: "Takıldı" }).click();
  const staleToast = yk.locator("[data-sonner-toast]", { hasText: STALE });
  await staleToast.waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    (await staleToast.count()) === 1 &&
      (await staleToast.getByRole("button", { name: "Yenile" }).count()) === 1,
    "AC18 the stale move gets the error toast with Yenile",
  );
  check(
    (await ticketRow(4)).status === "in_progress" && (await eventsOf(4, "status")).length === 1,
    "AC18 the ticket stays Devam ediyor with exactly one status entry",
  );
  await sef.context().close();
  await yk.context().close();
}

async function comments(browser, ids) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim/4");
  const box = yk.getByLabel("Yorum ekle");
  check(
    (await box.getAttribute("placeholder")) === "Yorum yaz…",
    "AC19/AC43 the comment box is labelled, placeholder Yorum yaz…",
  );
  await box.fill("E2E ilk satır\nikinci satır");
  await yk.getByRole("button", { name: "Gönder" }).click();
  await yk.locator("[data-kind=comment]").last().waitFor({ timeout: 10_000 });
  const last = yk.locator("[data-kind=comment]").last();
  const body = await last.locator("[data-testid=comment-body]").innerText();
  check(
    body === "E2E ilk satır\nikinci satır" &&
      (await text(last)).includes("Demo Yönetim") &&
      /\d+ \S+ \d\d:\d\d/.test(await text(last.locator("time"))),
    `AC19 the comment appears at the end with the author, the time and its line break`,
  );
  await yk
    .waitForFunction(() => document.querySelector("#yorum")?.value === "", null, { timeout: 5000 })
    .catch(() => {});
  check((await box.inputValue()) === "", "AC19 the box clears");
  await goto(yk, "/yonetim");
  check(
    (await text(
      yk.locator("[data-testid=ticket-card][data-number='4'] [data-testid=comment-count]"),
    )) === "1 yorum",
    "AC19 the card's comment count goes up",
  );
  await goto(yk, "/yonetim/4");
  const count = async () =>
    Number(
      await scalar(
        "select count(*) from board_ticket_events e join board_tickets t on t.id = e.ticket_id where t.number = 4 and e.kind = 'comment'",
      ),
    );
  const n0 = await count();
  await box.fill("E2E çift tık");
  await yk.getByRole("button", { name: "Gönder" }).dblclick();
  await yk.waitForTimeout(1500);
  check(
    (await count()) === n0 + 1,
    `AC19 a double tap creates one comment (${(await count()) - n0})`,
  );
  await box.fill("   ");
  await yk.getByRole("button", { name: "Gönder" }).click();
  check(await toast(yk, "Yorum boş olamaz."), "AC19 Yorum boş olamaz.");
  await box.fill("z".repeat(2001));
  await yk.getByRole("button", { name: "Gönder" }).click();
  check(
    await toast(yk, "Yorum en fazla 2000 karakter olabilir."),
    "AC19 Yorum en fazla 2000 karakter olabilir.",
  );
  check((await count()) === n0 + 1, "AC19 refused comments save nothing");

  // AC20
  await goto(yk, "/yonetim/4");
  const mine = yk.locator("[data-kind=comment]").last();
  const id = Number(await mine.getAttribute("data-id"));
  const delNames = await yk
    .locator("[data-kind=comment] button")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check(
    delNames.length > 0 &&
      delNames.every((n) => /^.+ yorumunu sil, .+/.test(n ?? "")) &&
      new Set(delNames).size === delNames.length,
    `UI P3-8 every comment delete button has its own name (${delNames})`,
  );
  await mine.getByRole("button", { name: /yorumunu sil/ }).click();
  const dlg = yk.getByRole("alertdialog");
  check((await text(dlg)).includes("Yorum silinsin mi?"), "AC20 the confirm Yorum silinsin mi?");
  await dlg.getByRole("button", { name: "Sil" }).click();
  await yk.waitForTimeout(800);
  check(
    !(await scalar("select id from board_ticket_events where id = ?", [id])),
    "AC20 the author deletes a fresh comment",
  );
  const older = Number(await yk.locator("[data-kind=comment]").first().getAttribute("data-id"));
  await db.execute({
    sql: "update board_ticket_events set created_at = created_at - 960 where id = ?",
    args: [older],
  });
  await goto(yk, "/yonetim/4");
  check(
    (await yk.locator(`[data-kind=comment][data-id='${older}'] button`).count()) === 0,
    "AC20 after 15 minutes the Sil button is gone",
  );
  const late = await callAction(yk, ids.deleteComment, [older]);
  check(
    late.includes("Yorum 15 dakika geçtikten sonra silinemez."),
    "AC20 a direct late delete is refused",
  );
  // sef@ on yk@'s fresh comment.
  await goto(yk, "/yonetim/4");
  await box.fill("E2E yk taze");
  await yk.getByRole("button", { name: "Gönder" }).click();
  await yk.waitForTimeout(800);
  const fresh = Number(
    await scalar("select max(id) from board_ticket_events where kind = 'comment'"),
  );
  const sef = await as(browser, "sef@arkhe.local", { phone: true });
  await goto(sef, "/yonetim/4");
  const others = await sef.locator(`[data-kind=comment][data-id='${fresh}'] button`).count();
  const notOwn = await callAction(sef, ids.deleteComment, [fresh]);
  check(
    others === 0 && notOwn.includes("Yalnızca kendi yorumunu silebilirsin."),
    "AC20 sef@ sees no Sil on yk@'s comment; a direct call is refused",
  );
  await sef.context().close();

  // AC21 text safety.
  let dialogs = 0;
  yk.on("dialog", async (d) => {
    dialogs++;
    await d.dismiss();
  });
  const evil = "<img src=x onerror=alert(1)>";
  await goto(yk, "/yonetim/yeni");
  await yk.fill("input[name=title]", `E2E ${evil}`);
  await yk
    .locator("textarea[name=description]")
    .fill(`<script>alert(2)</script> <b>kalın</b> javascript:alert(3)`);
  await yk.getByRole("button", { name: "Kaydet" }).click();
  await yk.waitForURL(/\/yonetim\/\d+$/);
  await box.fill(evil);
  await yk.getByRole("button", { name: "Gönder" }).click();
  await yk.locator("[data-kind=comment]").last().waitFor({ timeout: 10_000 });
  await yk.reload();
  await yk.waitForTimeout(500);
  check(
    dialogs === 0 &&
      (await yk.locator("h1").innerText()) === `E2E ${evil}` &&
      (await yk.locator("[data-testid=comment-body]").last().innerText()) === evil &&
      (await yk.locator("[data-testid=ticket-description]").innerText()).includes("<b>kalın</b>") &&
      (await yk.locator("main img[src=x], main b").count()) === 0,
    "AC21 titles, descriptions and comments render as literal text; no dialog fires",
  );
  await yk.context().close();
}

async function fresh(browser, ids) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim");
  const tab = yk.locator("nav.fixed a[href='/yonetim']");
  check(
    (await badge(yk)) === "1" &&
      (await tab.locator("[data-board-badge]").getAttribute("data-board-badge")) === "1" &&
      (await tab.innerText()).includes(", 1 yeni iş") &&
      (await yk.locator("[data-testid=ticket-card][data-number='1']").getAttribute("data-new")) ===
        "true",
    "AC22 the seeded new ticket: badge 1 on Yönetim (with , 1 yeni iş) and the Yeni dot",
  );
  await goto(yk, "/");
  check(
    (await yk.locator("[data-testid=home-board]").getAttribute("data-new")) === "1",
    "AC22 the home card agrees (1 yeni)",
  );
  const sefPage = await as(browser, "sef@arkhe.local", { width: 1280 });
  await goto(sefPage, "/yonetim");
  check(
    (await sefPage
      .locator("[data-testid=ticket-card][data-number='1']")
      .getAttribute("data-new")) === null && (await badge(sefPage)) === null,
    "AC22 sef@ sees no Yeni on yk@'s ticket",
  );
  await waitSeen(yk, 1);
  await goto(yk, "/yonetim");
  check(
    (await badge(yk)) === null &&
      (await yk.locator("[data-testid=ticket-card][data-number='1']").getAttribute("data-new")) ===
        null,
    "AC22 opening the detail clears it, and it stays cleared after a reload",
  );
  const add = async (page, body) =>
    callForm(page, ids.addComment, [1], { clientKey: crypto.randomUUID(), body });
  await add(sefPage, "E2E şeften yorum");
  await goto(yk, "/yonetim");
  check((await badge(yk)) === "1", "AC22 sef@ comments → 1 again");
  await waitSeen(yk, 1);
  await add(yk, "E2E kendi yorumum");
  await goto(yk, "/yonetim");
  check((await badge(yk)) === null, "AC22 yk@'s own comment never marks it new");
  // sef@ comments, yk@ acts (moves): acting counts as seeing.
  await add(sefPage, "E2E bir daha");
  await callAction(yk, ids.moveTicket, [{ number: 1, from: "todo", to: "in_progress" }]);
  await goto(yk, "/yonetim");
  check((await badge(yk)) === null, "AC22 acting on a ticket (a move) clears it as opening does");
  // A deleted comment marks nothing new.
  await add(sefPage, "E2E silinecek");
  await waitSeen(yk, 1);
  const last = Number(
    await scalar("select max(id) from board_ticket_events where kind = 'comment'"),
  );
  await callAction(sefPage, ids.deleteComment, [last]);
  await goto(yk, "/yonetim");
  check((await badge(yk)) === null, "AC22 deleting a comment marks nothing new");
  // 9+.
  const { sef, yk: ykId } = await people();
  for (let i = 0; i < 10; i++)
    await insertTicket({ title: `E2E yeni ${i}`, assignee: ykId, by: sef });
  await goto(yk, "/yonetim");
  check(
    (await yk.locator("nav.fixed [data-board-badge]").innerText()) === "9+" &&
      (await yk.locator("[data-nav-badge]").first().getAttribute("data-nav-badge")) !== "10",
    "AC22 above 9 the badge reads 9+; data-nav-badge stays homework-only",
  );
  await deleteTickets();
  await yk.context().close();
  await sefPage.context().close();
}

async function archive(browser) {
  await reset();
  const { sef } = await people();
  const page = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(page, "/yonetim");
  const done = await visibleCards(page, "done");
  const archLink = page.locator("section[data-status=done] a[href='/yonetim/arsiv']");
  check(
    !done.includes(6) &&
      (await archLink.count()) === 1 &&
      (await page.locator("main a[href='/yonetim/arsiv']").count()) >= 2,
    `AC23 the 40-day-old #6 is not in Bitti; Arşiv is linked from Bitti and the header (${done})`,
  );
  await goto(page, "/yonetim/arsiv");
  check(
    (await page.locator("[data-testid=archive-row][data-number='6']").count()) === 1,
    "AC23 #6 is on /yonetim/arsiv",
  );
  const d29 = await insertTicket({
    title: "E2E 29 gün",
    status: "done",
    doneAgoS: 29 * D,
    by: sef,
  });
  const d31 = await insertTicket({
    title: "E2E 31 gün",
    status: "done",
    doneAgoS: 31 * D,
    by: sef,
  });
  await goto(page, "/yonetim");
  const onBoard = await visibleCards(page, "done");
  await goto(page, "/yonetim/arsiv");
  const arch = await page
    .locator("[data-testid=archive-row]")
    .evaluateAll((els) => els.map((e) => Number(e.dataset.number)));
  check(
    onBoard.includes(d29.number) &&
      !onBoard.includes(d31.number) &&
      arch.includes(d31.number) &&
      !arch.includes(d29.number),
    "AC23 29 days → on the board; 31 days → archived",
  );
  let oldest;
  for (let i = 0; i < 49; i++) {
    oldest = await insertTicket({
      title: `E2E arşiv ${i}`,
      status: "done",
      doneAgoS: (32 + i) * D,
      by: sef,
    });
  }
  await goto(page, "/yonetim/arsiv");
  const p1 = await page
    .locator("[data-testid=archive-row]")
    .evaluateAll((els) => els.map((e) => Number(e.dataset.number)));
  const older = page.getByRole("link", { name: "Daha eski" });
  check(
    p1.length === 50 && p1[0] === d31.number && (await older.count()) === 1,
    `AC23 page 1 holds 50, newest first (${p1.length})`,
  );
  await older.click();
  await page.waitForURL(/sayfa=2/);
  const p2 = await page
    .locator("[data-testid=archive-row]")
    .evaluateAll((els) => els.map((e) => Number(e.dataset.number)));
  check(
    p2.length === 1 &&
      p2[0] === oldest.number &&
      (await page.getByRole("link", { name: "Daha yeni" }).count()) === 1,
    `AC23 page 2 has the rest (the oldest) with Daha yeni (${p2})`,
  );
  await goto(page, "/yonetim/6");
  await page.getByRole("button", { name: /^Durum: Bitti/ }).click();
  await page.getByRole("menuitem", { name: "Yapılacak" }).click();
  await toast(page, "#6 Yapılacak sütununa taşındı.");
  await goto(page, "/yonetim");
  check(
    (await visibleCards(page, "todo")).includes(6),
    "AC23 an archived ticket reopens into Yapılacak",
  );
  await db.execute("delete from board_tickets where status = 'done'");
  await goto(page, "/yonetim/arsiv");
  check(
    (await text(page.locator("main"))).includes("Arşivde iş yok."),
    "AC23 the empty archive: Arşivde iş yok.",
  );
  await page.context().close();
  await reset();
}

async function constraints() {
  const { sef } = await people();
  const tid = (await ticketRow(1)).id;
  const bad = [
    [
      "status",
      `insert into board_tickets (id, number, title, status, created_by) values ('${crypto.randomUUID()}', 990, 'E2E kötü', 'bogus', '${sef}')`,
    ],
    [
      "urgency",
      `insert into board_tickets (id, number, title, urgency, created_by) values ('${crypto.randomUUID()}', 991, 'E2E kötü', 'panic', '${sef}')`,
    ],
    [
      "title",
      `insert into board_tickets (id, number, title, created_by) values ('${crypto.randomUUID()}', 992, 'ab', '${sef}')`,
    ],
    [
      "number",
      `insert into board_tickets (id, number, title, created_by) values ('${crypto.randomUUID()}', 1, 'E2E aynı numara', '${sef}')`,
    ],
    [
      "done_at",
      `insert into board_tickets (id, number, title, status, created_by) values ('${crypto.randomUUID()}', 993, 'E2E bitti', 'done', '${sef}')`,
    ],
    [
      "comment",
      `insert into board_ticket_events (ticket_id, kind, actor_id, body) values ('${tid}', 'comment', '${sef}', '   ')`,
    ],
    [
      "system body",
      `insert into board_ticket_events (ticket_id, kind, actor_id, body) values ('${tid}', 'status', '${sef}', 'x')`,
    ],
  ];
  const passed = [];
  for (const [name, sql] of bad) {
    try {
      await db.execute(sql);
      passed.push(name);
    } catch {}
  }
  check(passed.length === 0, `AC41 invalid board writes fail at the DB (${passed})`);
  await deleteTickets("title like 'E2E%'");
}

async function quality(browser) {
  await reset();
  const { sef, yk } = await people();
  const t = await ticketRow(3);
  for (let i = 0; i < 10; i++) {
    await db.execute({
      sql: "insert into board_ticket_events (ticket_id, kind, actor_id, body, created_at) values (?, 'comment', ?, ?, unixepoch() - 3000 + ?)",
      args: [
        t.id,
        i % 2 ? sef : yk,
        `E2E yorum ${i}: ${"uzun bir cümle ".repeat(i + 1)}https://drive.google.com/drive/folders/${"x".repeat(60)}`,
        i,
      ],
    });
  }
  for (const scheme of ["light", "dark"]) {
    const page = await as(browser, "sef@arkhe.local", { phone: true, scheme });
    for (const p of ["/yonetim/3", "/yonetim/yeni", "/yonetim/arsiv"]) {
      await goto(page, p);
      const small = await smallTargets(page);
      check(
        (await noOverflow(page)) && small.length === 0,
        `AC42 ${scheme} ${p}: no horizontal scroll, every target ≥ 44 px (${small.slice(0, 4)})`,
      );
    }
    await page.context().close();
  }
  const kb = await as(browser, "yk@arkhe.local", { width: 1280 });
  await goto(kb, "/yonetim");
  await kb.locator("main").click({ position: { x: 5, y: 5 } });
  let ring = "none";
  for (let i = 0; i < 25; i++) {
    await kb.keyboard.press("Tab");
    const info = await kb.evaluate(() => {
      const el = document.activeElement;
      const card = el?.closest("[data-testid=ticket-card]");
      if (!card || el.tagName !== "A") return null;
      return getComputedStyle(card).boxShadow;
    });
    if (info) {
      ring = info;
      break;
    }
  }
  check(
    ring !== "none" && ring !== "",
    `AC42 a focused card shows a focus ring (${ring.slice(0, 40)})`,
  );
  const v1 = await axe(kb);
  await goto(kb, "/yonetim/3");
  const v2 = await axe(kb);
  check(
    v1.length === 0 && v2.length === 0,
    `AC43 axe: no serious violations on /yonetim and a detail (${[...v1, ...v2].slice(0, 3)})`,
  );
  await goto(kb, "/yonetim/3");
  await kb.getByRole("button", { name: /^Durum:/ }).click();
  const menuName = await kb
    .getByRole("menu")
    .evaluate((m) => m.getAttribute("aria-labelledby") || m.getAttribute("aria-label"));
  check(Boolean(menuName), "AC43 the status menu has an accessible name");
  await kb.keyboard.press("Escape");
  await kb.context().close();

  // No raw hex colours in the new components and pages.
  const root = new URL("..", import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx|ts)$/.test(f)) files.push(p);
    }
  };
  for (const d of [
    "src/components/board",
    "src/components/budget",
    "src/app/(portal)/yonetim",
    "src/app/(portal)/finans/butce",
  ]) {
    walk(path.join(root, d));
  }
  const hex = files.filter((f) =>
    /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(f, "utf8").replace(/#\$\{/g, "")),
  );
  check(
    files.length > 10 && hex.length === 0,
    `AC42 no raw hex colour in ${files.length} new files (${hex})`,
  );
}

async function perf(browser) {
  await reset();
  const { sef, yk } = await people();
  const statements = [];
  const ids = [];
  const t = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 300; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    const archived = i < 200;
    statements.push({
      sql: `insert into board_tickets (id, number, title, status, urgency, assignee_id, done_at, created_by, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        1000 + i,
        `E2E perf ${i}`,
        archived ? "done" : ["todo", "in_progress", "blocked"][i % 3],
        ["low", "medium", "high", "urgent"][i % 4],
        i % 2 ? yk : sef,
        archived ? t - 60 * D : null,
        sef,
        t - D,
        t - i,
      ],
    });
  }
  for (let i = 0; i < 2000; i++) {
    statements.push({
      sql: "insert into board_ticket_events (ticket_id, kind, actor_id, body) values (?, 'comment', ?, ?)",
      args: [ids[200 + (i % 100)], i % 2 ? sef : yk, `E2E perf yorum ${i}`],
    });
  }
  await db.batch(statements, "write");
  const page = await as(browser, "yk@arkhe.local", { width: 1280 });
  const time = async (p) => {
    await page.goto(`${BASE}${p}`);
    const s = Date.now();
    const res = await page.request.get(`${BASE}${p}`);
    return { ms: Date.now() - s, ok: res.ok() };
  };
  const board = await time("/yonetim");
  const det = await time("/yonetim/1250");
  check(
    board.ok && det.ok && board.ms < 1000 && det.ms < 1000,
    `AC44 300 tickets / 2000 comments: /yonetim ${board.ms} ms, a detail ${det.ms} ms (< 1 s)`,
  );
  await page.context().close();
  await reset();
}

async function rateLimits(browser, ids) {
  await reset();
  const { yk: ykId } = await people();
  const yk = await as(browser, "yk@arkhe.local");
  const fill = async (key, n) => {
    for (let i = 0; i < n; i++) {
      await db.execute({
        sql: "insert into login_attempts (key, attempted_at) values (?, unixepoch())",
        args: [key],
      });
    }
  };
  const tickets = async () => Number(await scalar("select count(*) from board_tickets"));
  await fill(`board-create:${ykId}`, 29);
  const before = await tickets();
  const invalid = await callForm(yk, ids.createTicket, [], {
    id: crypto.randomUUID(),
    title: "E",
    urgency: "medium",
  });
  const attempts = Number(
    await scalar("select count(*) from login_attempts where key = ?", [`board-create:${ykId}`]),
  );
  check(
    invalid.includes("Başlık en az 3 karakter olmalı.") && attempts === 29,
    `AC10 a validation failure doesn't count toward the create limit (${attempts})`,
  );
  const last = await callForm(yk, ids.createTicket, [], {
    id: crypto.randomUUID(),
    title: "E2E otuzuncu",
    urgency: "medium",
  });
  check(
    !last.includes("Çok fazla deneme") && (await tickets()) === before + 1,
    "AC10 the 30th create in an hour still goes through",
  );
  const over = await callForm(yk, ids.createTicket, [], {
    id: crypto.randomUUID(),
    title: "E2E otuz birinci",
    urgency: "medium",
  });
  check(
    over.includes("Çok fazla deneme. Biraz sonra yeniden dene.") &&
      (await tickets()) === before + 1,
    "AC10 the 31st create in an hour is refused with Çok fazla deneme and saves nothing",
  );

  await fill(`board-comment:${ykId}`, 60);
  const comments = async () =>
    Number(await scalar("select count(*) from board_ticket_events where kind = 'comment'"));
  const c0 = await comments();
  const bad = await callForm(yk, ids.addComment, [1], {
    clientKey: crypto.randomUUID(),
    body: " ",
  });
  check(
    !bad.includes("Çok fazla deneme") && (await comments()) === c0,
    "AC19 an empty comment gets its validation message, not the limit",
  );
  const blocked = await callForm(yk, ids.addComment, [1], {
    clientKey: crypto.randomUUID(),
    body: "E2E altmış birinci",
  });
  check(
    blocked.includes("Çok fazla deneme. Biraz sonra yeniden dene.") && (await comments()) === c0,
    "AC19 the 61st comment in 10 minutes is refused with Çok fazla deneme",
  );
  await yk.context().close();
  await reset();
}

async function tabThenBar(browser) {
  await reset();
  const yk = await as(browser, "yk@arkhe.local", { phone: true });
  await goto(yk, "/yonetim?sutun=yapilacak");
  const nav = yk.locator("nav[aria-label=Sütunlar]");
  await nav.locator("a[data-status=blocked]").click();
  await yk.waitForURL(/sutun=takildi/);
  await yk.locator("nav.fixed a[href='/yonetim']").click();
  await yk.waitForURL(`${BASE}/yonetim`);
  await yk.waitForTimeout(500);
  check(
    (await nav.locator("a[aria-current]").getAttribute("data-status")) === "todo" &&
      JSON.stringify(await visibleCards(yk)) === "[1,4]",
    "UI P3-2 a tab switch, then the bottom-bar Yönetim tap, shows the default column again",
  );
  await yk.context().close();
}

export default async function run(browser) {
  await reset();
  const page = await as(browser, "yk@arkhe.local");
  for (const p of ["/yonetim", "/yonetim/yeni", "/yonetim/1", "/yonetim/1/duzenle"])
    await goto(page, p);
  await page.context().close();
  const ids = await actionIds(BOARD_ACTIONS);
  check(
    [
      "createTicket",
      "updateTicket",
      "moveTicket",
      "deleteTicket",
      "addComment",
      "deleteComment",
      "markTicketSeen",
    ].every((n) => ids[n]),
    `Phase 8 setup: all board actions are registered (${Object.keys(ids)})`,
  );

  await access(browser, ids);
  await navigation(browser);
  await home(browser);
  await mobileBoard(browser);
  await tabThenBar(browser);
  await wideBoard(browser);
  await cards(browser);
  await order(browser);
  await filters(browser);
  await emptyStates(browser);
  await createAndValidate(browser, ids);
  await rateLimits(browser, ids);
  await formerManager(browser);
  await detail(browser);
  await edit(browser, ids);
  await remove(browser, ids);
  await moves(browser);
  await concurrent(browser);
  await comments(browser, ids);
  await fresh(browser, ids);
  await archive(browser);
  await constraints();
  await quality(browser);
  await perf(browser);
  await reset();
  void login;
  void newPage;
}
