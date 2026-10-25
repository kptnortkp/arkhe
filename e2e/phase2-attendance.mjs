import {
  BASE,
  check,
  db,
  insertRehearsal,
  istanbulDate,
  loginAs,
  markOf,
  newPage,
  login,
} from "./lib.mjs";

const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
const idByTitle = async (title) =>
  (await one("select id from rehearsals where title = ? order by starts_at", [title])).id;

async function liveCode(page) {
  return (await page.getByTestId("live-code").textContent()).trim();
}

async function enterCode(page, code) {
  await page.fill("#checkin-code", code);
}

async function segment(page, name, label) {
  await page
    .getByRole("radiogroup", { name: `${name} yoklama durumu` })
    .getByRole("radio", { name: label })
    .click();
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

export default async function phase2(browser, shots) {
  const sef = await loginAs(browser, "sef@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });

  // AC26 first, before this suite closes rehearsals of its own in the current term.
  await sef.goto(`${BASE}/raporlar`);
  const seededRow = async (name) =>
    (await sef.getByTestId("report-row").filter({ hasText: name }).first().textContent()) ?? "";
  check(
    (await seededRow("Barış Güneş")).includes("Uyarı"),
    "AC26 the seeded flagged member has the Uyarı badge",
  );
  check(
    !(await seededRow("Ceren Polat")).includes("Uyarı"),
    "AC26 a member with only excused misses is not flagged",
  );

  // AC1: single rehearsal
  await sef.goto(`${BASE}/calismalar/yeni`);
  await sef.fill("input[name=title]", "E2E Tekil");
  await sef.fill("input[name=date]", istanbulDate(3));
  await sef.fill("input[name=start]", "19:00");
  await sef.fill("input[name=end]", "21:30");
  await sef.fill("input[name=location]", "E2E Salon");
  await sef.click("main button[type=submit]");
  await sef.waitForURL(/\/calismalar\/[0-9a-f-]{36}$/);
  const single = await idByTitle("E2E Tekil");
  await korist.goto(`${BASE}/calismalar`);
  check(
    await korist.getByText("E2E Tekil").isVisible(),
    "AC1 member sees a new rehearsal in the calendar",
  );

  // AC2: weekly series of 5
  await sef.goto(`${BASE}/calismalar/yeni`);
  await sef.fill("input[name=title]", "E2E Seri");
  await sef.fill("input[name=date]", istanbulDate(7));
  await sef.check("input[name=repeat]");
  await sef.fill("input[name=repeatUntil]", istanbulDate(35));
  check(
    (await sef.getByTestId("series-preview").textContent()).includes("5 çalışma"),
    "AC2 series preview reads 5 çalışma",
  );
  check(
    await sef.getByRole("button", { name: "5 çalışmayı ekle" }).isVisible(),
    "AC2 submit button reads 5 çalışmayı ekle",
  );
  await sef.getByRole("button", { name: "5 çalışmayı ekle" }).click();
  await sef.waitForURL(`${BASE}/calismalar`);
  check(
    (await one("select count(*) n from rehearsals where title = 'E2E Seri'")).n === 5,
    "AC2 exactly 5 occurrences are created",
  );

  // AC4: end series from occurrence 2, occurrence 3 has an excuse
  const series = (
    await db.execute("select id from rehearsals where title = 'E2E Seri' order by starts_at")
  ).rows.map((r) => r.id);
  await korist.goto(`${BASE}/calismalar/${series[2]}`);
  await korist.getByRole("button", { name: "Gelemeyeceğim" }).click();
  await korist.getByRole("button", { name: "Mazeret bildir" }).click();
  await korist.getByText("Mazeretin iletildi").first().waitFor();
  await sef.goto(`${BASE}/calismalar/${series[1]}`);
  await sef.getByRole("button", { name: "Seriyi bitir" }).click();
  await sef.getByRole("dialog").getByRole("button", { name: "Seriyi bitir" }).click();
  await sef.waitForTimeout(800);
  check(
    (await one("select count(*) n from rehearsals where title = 'E2E Seri'")).n === 2,
    "AC4 Seriyi bitir deletes later occurrences, including excused ones",
  );

  // AC15 + AC3: excuse with a reason, then cancel and restore
  await korist.goto(`${BASE}/calismalar/${single}`);
  await korist.getByRole("button", { name: "Gelemeyeceğim" }).click();
  await korist.fill("#excuse-reason", "Sınavım var");
  await korist.getByRole("button", { name: "Mazeret bildir" }).click();
  await korist.getByText("Mazeretin iletildi").first().waitFor();
  check(
    await korist.getByText("Mazereti geri al").isVisible(),
    "AC15 member sees MAZERETİN İLETİLDİ with a withdraw button",
  );
  await sef.goto(`${BASE}/calismalar/${single}`);
  check(
    await sef.getByText("“Sınavım var”").isVisible(),
    "AC15 manager sees the excuse reason before the rehearsal",
  );
  await sef.getByRole("button", { name: "İptal et" }).click();
  await sef.getByRole("dialog").getByRole("button", { name: "İptal et" }).click();
  await sef.getByRole("button", { name: "İptali geri al" }).waitFor();
  await korist.goto(`${BASE}/calismalar/${single}`);
  check(
    (await korist.getByText("Bu çalışma iptal edildi.").isVisible()) &&
      (await korist.getByRole("button", { name: "Gelemeyeceğim" }).count()) === 0,
    "AC3 cancelled rehearsal shows İptal edildi with no actions",
  );
  await sef.getByRole("button", { name: "İptali geri al" }).click();
  await sef.waitForTimeout(800);
  check(
    (await markOf(single, "korist@arkhe.local"))?.status === "excused",
    "AC3 un-cancelling restores the earlier excuse",
  );

  // AC16: withdraw
  await korist.goto(`${BASE}/calismalar/${single}`);
  await korist.getByRole("button", { name: "Mazereti geri al" }).click();
  await korist.getByRole("button", { name: "Gelemeyeceğim" }).waitFor();
  check(
    (await markOf(single, "korist@arkhe.local")) === null,
    "AC16 withdrawing returns the member to unmarked",
  );

  // AC5: sectional for Tenor + Bas
  const sectional = await insertRehearsal({
    title: "E2E Partisyon",
    startOffsetMin: 2 * 1440,
    type: "sectional",
    parts: ["tenor", "bass"],
  });
  await korist.goto(`${BASE}/calismalar/${sectional}`);
  check(
    (await korist.getByText("Senin partisyonun değil.").isVisible()) &&
      (await korist.getByRole("button", { name: "Gelemeyeceğim" }).count()) === 0,
    "AC5 sectional is not the alto member's",
  );
  const bass = await loginAs(browser, "ozan.yilmaz@arkhe.local", { mobile: true });
  await bass.goto(`${BASE}/calismalar/${sectional}`);
  check(
    await bass.getByRole("button", { name: "Gelemeyeceğim" }).isVisible(),
    "AC5 a bass member sees the sectional as theirs",
  );

  // AC6: member can't reach manager pages or APIs
  for (const path of ["/calismalar/yeni", "/raporlar", `/calismalar/${single}/canli`]) {
    await korist.goto(`${BASE}${path}`);
    check(!korist.url().includes(path), `AC6 member is redirected away from ${path}`);
  }
  const status = async (page, path, init) =>
    page.evaluate(async ([p, i]) => (await fetch(p, i)).status, [path, init]);
  check(
    (await status(korist, `/api/calismalar/${single}/durum`)) === 403,
    "AC6 poll route returns 403 for members",
  );
  check((await status(korist, "/raporlar/csv")) === 403, "AC6 CSV route returns 403 for members");
  check(
    (await status(korist, `/api/calismalar/${single}/isaret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marks: [{ userId: crypto.randomUUID(), status: "present", markedAt: Date.now() }],
      }),
    })) === 403,
    "AC6 mark route returns 403 for members",
  );

  // AC7 + AC8: live screen and code check-in
  const live = await insertRehearsal({ title: "E2E Canlı", startOffsetMin: -5 });
  await sef.goto(`${BASE}/calismalar/${live}`);
  await sef.getByRole("button", { name: "Yoklamayı başlat" }).click();
  await sef.waitForURL(`${BASE}/calismalar/${live}/canli`);
  const code1 = await liveCode(sef);
  check(/^\d{4}$/.test(code1), "AC7 live screen shows a 4-digit code");
  check(
    await sef.getByText("sonra geç sayılır").isVisible(),
    "AC7 live screen shows the late cut-off",
  );
  check(
    await sef.getByRole("img", { name: "Yoklama QR kodu" }).isVisible(),
    "AC7 live screen shows a QR code",
  );
  if (shots) await sef.screenshot({ path: `${shots}/live.png` });

  await korist.goto(`${BASE}/`);
  check(
    await korist.getByText("Yoklama açık").first().isVisible(),
    "AC8 member home shows YOKLAMA AÇIK",
  );
  await korist.getByRole("button", { name: "Geldim" }).click();
  await enterCode(korist, await liveCode(sef));
  await korist.getByText("Yoklamaya katıldın").first().waitFor();
  check(true, "AC8 member checks in with the code and sees YOKLAMAYA KATILDIN");
  await sef
    .getByRole("radiogroup", { name: "Demo Korist yoklama durumu" })
    .getByRole("radio", { name: "Geldi", checked: true })
    .waitFor({ timeout: 10_000 });
  check(true, "AC8 manager screen shows the member as Geldi within 10 s");

  const codeOnly = await newPage(browser);
  await codeOnly.context().addCookies(await sef.context().cookies());
  await codeOnly.goto(`${BASE}/calismalar/${live}/canli?gorunum=kod`);
  check(
    (await codeOnly.getByTestId("live-code").isVisible()) &&
      (await codeOnly.getByText("Demo Korist").count()) === 0,
    "AC7 Sadece kod view shows the code and no member names",
  );
  await codeOnly.context().close();

  // AC9: wrong code, then rate limit (board member on the same rehearsal)
  const yk = await loginAs(browser, "yk@arkhe.local", { mobile: true });
  await yk.goto(`${BASE}/calismalar/${live}`);
  await yk.getByRole("button", { name: "Geldim" }).click();
  const wrong = (await liveCode(sef)) === "0000" ? "0001" : "0000";
  await enterCode(yk, wrong);
  await yk.getByText("Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.").waitFor();
  check((await markOf(live, "yk@arkhe.local")) === null, "AC9 a wrong code writes nothing");
  for (let i = 0; i < 4; i++) {
    await enterCode(yk, wrong);
    await yk.waitForTimeout(400);
  }
  await enterCode(yk, await liveCode(sef));
  await yk.getByText("Çok fazla hatalı deneme", { exact: false }).waitFor();
  check(true, "AC9 after 5 wrong codes even the correct code is refused");
  await db.execute("delete from login_attempts");

  // AC11: logged out QR flow, no extra tap, ?c= removed; a plain GET writes nothing
  const qrUrl = async () => `${BASE}/yoklama/kod/${live}?c=${await liveCode(sef)}`;
  const melis = await newPage(browser, { mobile: true });
  await melis.goto(await qrUrl());
  await melis.waitForURL(/\/giris\?next=/);
  await melis.fill("input[name=email]", "melis.aydin@arkhe.local");
  await melis.fill("input[name=password]", "arkhe-demo-2026");
  await melis.click("main button[type=submit]");
  await melis.getByTestId("qr-state").waitFor();
  await melis.waitForURL((u) => !u.search.includes("c="));
  check(
    (await markOf(live, "melis.aydin@arkhe.local"))?.status === "present",
    "AC11 QR login flow checks in with no extra tap",
  );
  check(!melis.url().includes("c="), "AC11 the URL no longer contains ?c=");
  const plain = await bass.context().request.get(await qrUrl());
  check(
    plain.ok() && (await markOf(live, "ozan.yilmaz@arkhe.local")) === null,
    "AC11 a plain GET of the QR URL records nothing",
  );

  // AC12: late after 15 min, repeat is a no-op
  const late = await insertRehearsal({ title: "E2E Geç", startOffsetMin: -20 });
  await sef.goto(`${BASE}/calismalar/${late}`);
  await sef.getByRole("button", { name: "Yoklamayı başlat" }).click();
  await sef.waitForURL(`${BASE}/calismalar/${late}/canli`);
  await korist.goto(`${BASE}/yoklama/kod/${late}?c=${await liveCode(sef)}`);
  await korist.getByTestId("qr-state").waitFor();
  const firstMark = await markOf(late, "korist@arkhe.local");
  check(firstMark?.status === "late", "AC12 check-in 20 min after start is recorded as Geç geldi");
  await korist.goto(`${BASE}/yoklama/kod/${late}?c=${await liveCode(sef)}`);
  await korist.getByTestId("qr-state").waitFor();
  const again = await markOf(late, "korist@arkhe.local");
  check(
    again.status === "late" && again.recorded_at === firstMark.recorded_at,
    "AC12 a repeat check-in changes nothing",
  );

  // AC13: check-in replaces own excuse; never a manager's mark
  const excused = await insertRehearsal({ title: "E2E Mazeret", startOffsetMin: 30 });
  await korist.goto(`${BASE}/calismalar/${excused}`);
  await korist.getByRole("button", { name: "Gelemeyeceğim" }).click();
  await korist.fill("#excuse-reason", "Belki gelemem");
  await korist.getByRole("button", { name: "Mazeret bildir" }).click();
  await korist.getByText("Mazeretin iletildi").first().waitFor();
  await sef.goto(`${BASE}/calismalar/${excused}`);
  await sef.getByRole("button", { name: "Yoklamayı başlat" }).click();
  await sef.waitForURL(`${BASE}/calismalar/${excused}/canli`);
  await segment(sef, "Buse Kurt", "Gelmedi");
  await sef.waitForTimeout(1200);
  await korist.goto(`${BASE}/yoklama/kod/${excused}?c=${await liveCode(sef)}`);
  await korist
    .getByTestId("qr-state")
    .waitFor()
    .catch(async (error) => {
      console.log(await korist.locator("main").innerText());
      throw error;
    });
  const replaced = await markOf(excused, "korist@arkhe.local");
  check(
    replaced?.status === "present" && replaced.note === null,
    "AC13 check-in replaces the member's own excuse and clears the reason",
  );
  const buse = await loginAs(browser, "buse.kurt@arkhe.local", { mobile: true }).catch(() => null);
  if (buse) {
    await buse.goto(`${BASE}/yoklama/kod/${excused}?c=${await liveCode(sef)}`);
    await buse.getByText("Yoklamayı alan kişi seni zaten işaretledi.").waitFor();
    check(
      (await markOf(excused, "buse.kurt@arkhe.local"))?.status === "absent",
      "AC13 a manager's Gelmedi mark wins over self check-in",
    );
    await buse.context().close();
  } else {
    check(false, "AC13 could not log in as buse.kurt (no password in seed)");
  }

  // AC18: manual marks on the live screen persist; clearing while open
  await sef.goto(`${BASE}/calismalar/${live}/canli`);
  for (const [label, expected] of [
    ["Geldi", "present"],
    ["Geç", "late"],
    ["Mazeretli", "excused"],
    ["Gelmedi", "absent"],
  ]) {
    await segment(sef, "Nazlı Koç", label);
    await sef.waitForTimeout(1000);
    check(
      (await markOf(live, "nazli.koc@arkhe.local"))?.status === expected,
      `AC18 manual mark ${label} is saved`,
    );
  }
  await sef.reload();
  check(
    await sef
      .getByRole("radiogroup", { name: "Nazlı Koç yoklama durumu" })
      .getByRole("radio", { name: "Gelmedi", checked: true })
      .isVisible(),
    "AC18 the mark survives a reload",
  );
  await sef.getByRole("button", { name: "Nazlı Koç: işareti kaldır" }).click();
  await sef.waitForTimeout(1000);
  check(
    (await markOf(live, "nazli.koc@arkhe.local")) === null,
    "AC18 İşareti kaldır clears the mark while open",
  );

  // AC19: bulk Alto + undo
  const altoSection = sef.getByRole("region", { name: "Alto" });
  await altoSection.getByRole("button", { name: "Kalanları geldi işaretle" }).click();
  await sef.getByText("Alto:", { exact: false }).waitFor();
  const altos = await db.execute({
    sql: "select u.email, a.status, a.method from users u left join attendance a on a.user_id = u.id and a.rehearsal_id = ? where u.voice_part = 'alto' and u.role != 'conductor'",
    args: [live],
  });
  check(
    altos.rows.every((r) => r.status !== null),
    "AC19 bulk marks every unmarked alto",
  );
  check(
    altos.rows.find((r) => r.email === "korist@arkhe.local").method === "code",
    "AC19 already marked altos stay unchanged",
  );
  await sef.getByRole("button", { name: "Geri al" }).click();
  await sef.waitForTimeout(1200);
  const afterUndo = await db.execute({
    sql: "select count(*) n from attendance a join users u on u.id = a.user_id where a.rehearsal_id = ? and u.voice_part = 'alto'",
    args: [live],
  });
  check(afterUndo.rows[0].n === 2, "AC19 Geri al reverts exactly the bulk rows");

  // AC20: close with the exact unmarked count
  const unmarked = (
    await one(
      "select count(*) n from users u where u.role != 'conductor' and u.is_active = 1 and not exists (select 1 from attendance a where a.rehearsal_id = ? and a.user_id = u.id)",
      [live],
    )
  ).n;
  await sef.getByRole("button", { name: "Yoklamayı kapat" }).first().click();
  check(
    (await sef.getByTestId("close-summary").textContent()).includes(
      `${unmarked} kişi işaretlenmedi`,
    ),
    "AC20 close dialog shows the exact unmarked count",
  );
  await sef.getByRole("dialog").getByRole("button", { name: "Kapat" }).click();
  await sef.waitForURL(`${BASE}/calismalar/${live}`);
  const stillUnmarked = (
    await one(
      "select count(*) n from users u where u.role != 'conductor' and u.is_active = 1 and not exists (select 1 from attendance a where a.rehearsal_id = ? and a.user_id = u.id)",
      [live],
    )
  ).n;
  check(stillUnmarked === 0, "AC20 closing marks every unmarked expected member Gelmedi");

  // AC14: after close, QR says closed
  await yk.goto(`${BASE}/yoklama/kod/${live}?c=1234`);
  check(
    (await yk.getByTestId("qr-state").textContent()).includes("Yoklama kapandı"),
    "AC14 QR URL shows Yoklama kapandı after close",
  );
  await yk.goto(`${BASE}/calismalar/${live}`);
  check(
    (await yk.getByRole("button", { name: "Geldim" }).count()) === 0,
    "AC14 Geldim is gone after close",
  );

  // AC21: correction after close
  await sef.goto(`${BASE}/calismalar/${live}`);
  await segment(sef, "Nazlı Koç", "Geldi");
  await sef.waitForTimeout(1200);
  const corrected = await markOf(live, "nazli.koc@arkhe.local");
  check(
    corrected.status === "present" && corrected.corrected_at !== null,
    "AC21 a closed rehearsal can be corrected",
  );
  await sef.reload();
  check(
    await sef.getByText("Düzeltildi · Demo").first().isVisible(),
    "AC21 the row shows Düzeltildi · <first name>",
  );
  check(
    (await sef.getByRole("button", { name: "Nazlı Koç: işareti kaldır" }).count()) === 0,
    "AC21 no İşareti kaldır after close",
  );

  // AC22: never-opened past rehearsal
  const untaken = await insertRehearsal({ title: "E2E Alınmadı", startOffsetMin: -2 * 1440 });
  await sef.goto(`${BASE}/calismalar/${untaken}`);
  check(
    await sef.getByText("Yoklama alınmadı").first().isVisible(),
    "AC22 a past never-opened rehearsal shows Yoklama alınmadı",
  );
  await segment(sef, "Elif Yıldız", "Geldi");
  await sef.waitForTimeout(1200);
  await sef.getByRole("button", { name: "Yoklamayı kapat" }).click();
  await sef.getByRole("dialog").getByRole("button", { name: "Kapat" }).click();
  await sef.waitForTimeout(1200);
  const closedUntaken = await one("select closed_at from rehearsals where id = ?", [untaken]);
  check(
    closedUntaken.closed_at !== null &&
      (await markOf(untaken, "zeynep.kaya@arkhe.local"))?.status === "absent",
    "AC22 closing it counts the rest as Gelmedi",
  );

  // AC23: forgotten open rehearsal closes itself on the next visit
  const forgotten = await insertRehearsal({ title: "E2E Dün", startOffsetMin: -1500 });
  await db.execute({
    sql: "update rehearsals set opened_at = starts_at where id = ?",
    args: [forgotten],
  });
  await korist.goto(`${BASE}/calismalar`);
  check(
    (await one("select closed_at from rehearsals where id = ?", [forgotten])).closed_at !== null,
    "AC23 yesterday's open rehearsal auto-closes",
  );
  check(
    (await markOf(forgotten, "korist@arkhe.local"))?.status === "absent",
    "AC23 its unmarked members become Gelmedi",
  );

  // AC24 + AC7: offline marks; the code stays the same while attendance is open
  const offline = await insertRehearsal({ title: "E2E Offline", startOffsetMin: -5 });
  await sef.goto(`${BASE}/calismalar/${offline}`);
  await sef.getByRole("button", { name: "Yoklamayı başlat" }).click();
  await sef.waitForURL(`${BASE}/calismalar/${offline}/canli`);
  const before = await liveCode(sef);
  await sef.context().setOffline(true);
  await segment(sef, "Ece Demir", "Geldi");
  await sef.getByText("Kaydedilmedi").first().waitFor({ timeout: 15_000 });
  check(
    await sef.getByText("Bağlantı yok —", { exact: false }).isVisible(),
    "AC24 offline banner and Kaydedilmedi are shown",
  );
  await sef.waitForTimeout(31_000);
  check((await liveCode(sef)) === before, "AC7/AC24 the code stays the same for the whole session");
  await sef.context().setOffline(false);
  await sef.waitForTimeout(12_000);
  check(
    (await markOf(offline, "ece.demir@arkhe.local"))?.status === "present",
    "AC24 the offline mark saves after reconnecting",
  );

  // AC25–28: reports
  await sef.goto(`${BASE}/raporlar`);
  const rowText = async (name) =>
    (await sef.getByTestId("report-row").filter({ hasText: name }).first().textContent()) ?? "";
  for (const part of ["soprano", "alto", "tenor", "bass"]) {
    check(await sef.getByTestId(`part-${part}`).isVisible(), `AC25 part tile for ${part}`);
  }
  await sef.getByRole("link", { name: "Sadece uyarılılar" }).click();
  await sef.waitForURL(/uyari=1/);
  const flaggedRows = await sef.getByTestId("report-row").count();
  check(
    flaggedRows >= 1 &&
      (await sef.getByTestId("report-row").filter({ hasText: "Uyarı" }).count()) === flaggedRows,
    "AC26 Sadece uyarılılar shows only flagged people",
  );
  await sef.goto(`${BASE}/raporlar`);
  const currentFirst = await rowText("Demo Korist");
  await sef.getByRole("link", { name: "2025–26 Bahar" }).click();
  await sef.waitForURL(/donem=/);
  check(
    (await rowText("Demo Korist")) !== currentFirst,
    "AC27 switching the term recalculates the table",
  );
  await sef.getByRole("button", { name: "Dönemler" }).click();
  const dialog = sef.getByRole("dialog");
  await dialog.locator("input[name=name]").fill("E2E Çakışan");
  await dialog.locator("input[name=startsOn]").fill("2026-10-01");
  await dialog.locator("input[name=endsOn]").fill("2026-10-10");
  await dialog.getByRole("button", { name: "Dönem ekle" }).click();
  await dialog.getByText("Dönemler çakışamaz.").waitFor();
  check(true, "AC27 overlapping terms are rejected");
  await dialog.locator("input[name=name]").fill("E2E Dönem");
  await dialog.locator("input[name=startsOn]").fill("2027-02-01");
  await dialog.locator("input[name=endsOn]").fill("2027-06-30");
  await dialog.getByRole("button", { name: "Dönem ekle" }).click();
  await sef.keyboard.press("Escape");
  await sef.getByRole("link", { name: "E2E Dönem" }).waitFor();
  check(true, "AC27 a new term appears in the selector");

  // AC28: CSV with BOM, ; and formula-safe names
  const injected = crypto.randomUUID();
  await db.execute({
    sql: "insert into users (id, name, email, role, voice_part, joined_at) values (?, '=1+1', 'formula@e2e.test', 'member', 'tenor', 0)",
    args: [injected],
  });
  await sef.goto(`${BASE}/raporlar`);
  const csv = await sef.context().request.get(`${BASE}/raporlar/csv`);
  const body = await csv.text();
  check(body.charCodeAt(0) === 0xfeff, "AC28 CSV starts with a UTF-8 BOM");
  check(
    body.includes(
      '"Ad soyad";"Partisyon";"Geldi";"Beklenen";"Yüzde";"Geç";"Mazeretli";"Gelmedi";"Uyarı"',
    ),
    "AC28 CSV has the agreed header with ;",
  );
  check(body.includes(`"'=1+1"`), "AC28 a name like =1+1 is exported as '=1+1");
  check(
    !body.includes("Hastayım") && !body.includes("Sınavım"),
    "AC17 excuse reasons never reach the CSV",
  );

  // AC29: member's own numbers match the report
  await korist.goto(`${BASE}/calismalar?sekme=gecmis`);
  const mine = (await korist.getByTestId("my-percent").textContent()).trim();
  const reportMine = (
    await sef
      .getByTestId("report-row")
      .filter({ hasText: "Demo Korist" })
      .getByTestId("report-percent")
      .textContent()
  ).trim();
  check(
    mine === reportMine,
    `AC29 member's own percentage matches the report (${mine} vs ${reportMine})`,
  );

  // AC30: joining date and required voice part
  await sef.goto(`${BASE}/uyeler/yeni`);
  await sef.fill("input[name=name]", "E2E Yeni Katılan");
  await sef.fill("input[name=email]", "yeni@e2e.test");
  await sef.click("main button[type=submit]");
  await sef.getByText("partisyon seçmek gerekli", { exact: false }).waitFor();
  check(true, "AC30 Partisyon is required for a Korist");
  await sef.locator("label:has-text('Bas')").click();
  await sef.click("main button[type=submit]");
  await sef.getByText("Davet linki hazır").waitFor();
  await sef.goto(`${BASE}/raporlar`);
  const newcomer = await sef
    .getByTestId("report-row")
    .filter({ hasText: "E2E Yeni Katılan" })
    .first()
    .textContent()
    .catch(() => "");
  check(
    newcomer.includes("0/0"),
    "AC30 someone who joined today is not expected at past rehearsals",
  );

  // AC31: board can't touch board accounts or give the board role
  const ykId = (await one("select id from users where email = 'yk@arkhe.local'")).id;
  await yk.goto(`${BASE}/uyeler/${ykId}`);
  check(
    (await yk.getByRole("button", { name: /linki/ }).count()) === 0,
    "AC31 board can't issue a link for itself or edit a board account",
  );
  await yk.goto(`${BASE}/uyeler/yeni`);
  check(
    (await yk.locator("input[name=role][value=board]").isDisabled()) &&
      (await yk.locator("input[name=role][value=conductor]").isDisabled()),
    "AC31 board can't give anyone the board or conductor role",
  );

  // AC32: no horizontal scroll at 375 px
  const narrow = await newPage(browser, { mobile: true });
  await narrow.setViewportSize({ width: 375, height: 800 });
  await login(narrow, "sef@arkhe.local");
  await narrow.waitForURL(`${BASE}/`);
  for (const path of [
    "/",
    "/calismalar",
    "/raporlar",
    `/calismalar/${live}`,
    `/calismalar/${offline}/canli`,
  ]) {
    for (const scheme of ["light", "dark"]) {
      await narrow.emulateMedia({ colorScheme: scheme });
      await narrow.goto(`${BASE}${path}`);
      check(await noHorizontalScroll(narrow), `AC32 no horizontal scroll on ${path} (${scheme})`);
    }
  }

  // Review regressions: tablet layout, code-only fit, readable rows on phones.
  const tablet = await newPage(browser);
  await tablet.setViewportSize({ width: 1024, height: 768 });
  await tablet.context().addCookies(await sef.context().cookies());
  await tablet.goto(`${BASE}/calismalar/${offline}/canli`);
  const codeBox = await tablet.getByTestId("live-code").boundingBox();
  const counterBox = await tablet.getByTestId("came-count").boundingBox();
  check(
    codeBox.x + codeBox.width <= counterBox.x,
    "review: at 1024×768 the code panel doesn't overlap the roster",
  );
  const codeSize = await tablet
    .getByTestId("live-code")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(codeSize >= 96, `review: at 1024×768 the live code is at least 96px (${codeSize}px)`);
  await tablet.goto(`${BASE}/calismalar/${offline}/canli?gorunum=kod`);
  const qrBox = await tablet.getByRole("img", { name: "Yoklama QR kodu" }).boundingBox();
  check(qrBox.y + qrBox.height <= 768, "review: code-only view fits the tablet screen");
  await tablet.context().close();
  await narrow.goto(`${BASE}/calismalar/${live}`);
  const nameWidth = await narrow
    .getByTestId("roster-row")
    .first()
    .locator("p.font-medium")
    .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  check(nameWidth, "review: roster names aren't truncated on a 375 px phone");

  // Review regression: anonymous failed logins must not lock out other people (no shared IP bucket).
  await db.execute("delete from login_attempts");
  const attacker = await newPage(browser);
  for (let i = 0; i < 32; i++) {
    await attacker.goto(`${BASE}/giris`);
    await attacker.fill("input[name=email]", `random${i}@e2e.test`);
    await attacker.fill("input[name=password]", "wrong-password");
    await attacker.click("main button[type=submit]");
    await attacker.waitForSelector("main [role=alert]");
  }
  await attacker.context().close();
  const victim = await newPage(browser);
  await login(victim, "sef@arkhe.local");
  await victim.waitForURL(`${BASE}/`, { timeout: 10_000 }).catch(() => {});
  check(
    victim.url() === `${BASE}/`,
    "review: 32 failed logins on other emails don't block the conductor",
  );
  await victim.context().close();
  await db.execute("delete from login_attempts");

  for (const page of [sef, korist, yk, bass, melis, narrow]) await page.context().close();
}
