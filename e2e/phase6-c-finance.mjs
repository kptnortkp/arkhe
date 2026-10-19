// Phase 6: finance carry-forward (AC 28, 30–32), polish (AC 36) at 375×812.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { FINANCE_IDS, financeExpected, seedFinance } from "../scripts/finance-fixture.mjs";
import { BASE, check, db, login, newPage, userId } from "./lib.mjs";

const NBSP = / /g;
const text = async (locator) => ((await locator.textContent()) ?? "").replace(NBSP, " ").trim();
const P3 = FINANCE_IDS.periods[2];

async function phone(browser, email, scheme = "light") {
  const page = await newPage(browser, { phone: true, context: { colorScheme: scheme } });
  await login(page, email);
  await page.waitForURL(`${BASE}/`);
  return page;
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.locator("main h1").first().waitFor();
}

async function toast(page, message) {
  try {
    await page.getByText(message, { exact: true }).first().waitFor({ timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

const auditDate = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Istanbul",
}).format(new Date());

async function setRate(page, memberId, label) {
  await goto(page, `/finans/aidat?donem=${P3}&uye=${memberId}`);
  const form = page.locator("[data-testid=member-sheet] [data-testid=rate-form]");
  await form.waitFor();
  await form.getByText(label, { exact: true }).click();
  await form.getByRole("button", { name: "Kaydet" }).click();
  return toast(page, "Aidat oranı güncellendi.");
}

/** Pays `amount` for P3 (or two periods when `multi`) from the member's payment sheet. */
async function pay(page, name, { amount, multi = false, clientId } = {}) {
  await goto(page, `/finans/aidat?donem=${P3}`);
  await page.getByRole("button", { name: `Ödeme al: ${name}` }).click();
  const form = page.locator("[data-testid=payment-form]");
  await form.waitFor();
  if (multi) {
    await form.getByText("Birden fazla dönem").click();
  } else {
    await form.getByText(financeExpected().names[2], { exact: true }).click();
    if (amount) await form.locator("input[name=amount]").fill(amount);
  }
  const used = await form.locator("input[name=clientId]").inputValue();
  if (clientId) {
    await form
      .locator("input[name=clientId]")
      .evaluate((input, value) => (input.value = value), clientId);
  }
  await form.getByRole("button", { name: / al$/ }).click();
  await page.locator("[data-testid=payment-done]").waitFor();
  await page.keyboard.press("Escape");
  return used;
}

async function voidEntry(page, id) {
  await goto(page, `/finans/${id}`);
  await page.getByRole("button", { name: "İptal et" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.locator("textarea").fill("E2E faz 6 iptal");
  await dialog.getByRole("button", { name: "İptal et" }).click();
  return toast(page, "Kayıt iptal edildi.");
}

async function liveDues(memberId, periodId = P3) {
  return (
    await db.execute({
      sql: "select id, amount_kurus, payment_group_id from finance_entries where member_id = ? and dues_period_id = ? and voided_at is null order by created_at, id",
      args: [memberId, periodId],
    })
  ).rows;
}

async function freezeOf(memberId, periodId = P3) {
  const r = await db.execute({
    sql: "select owed_kurus from dues_overrides where kind = 'freeze' and user_id = ? and dues_period_id = ?",
    args: [memberId, periodId],
  });
  return r.rows[0] ? Number(r.rows[0].owed_kurus) : null;
}

async function myRow(page, periodName) {
  await goto(page, "/profil");
  return text(page.locator(`[data-testid=my-dues-row][data-name="${periodName}"]`));
}

export default async function phase6Finance(browser) {
  const exp = financeExpected();
  const m0 = exp.names[2];
  const koristId = await userId("korist@arkhe.local");
  const ykId = await userId("yk@arkhe.local");
  const kaanId = await userId("kaan.ozdemir@arkhe.local");
  await seedFinance(db, new Date());
  const yk = await phone(browser, "yk@arkhe.local");
  const korist = await phone(browser, "korist@arkhe.local");

  // AC30 Son değişiklik
  check(await setRate(yk, ykId, "İndirimli"), "AC30 yk sets their own rate to İndirimli");
  const rateAudit = yk.locator("[data-testid=rate-audit]");
  await rateAudit.waitFor();
  check(
    (await text(rateAudit)) === `Son değişiklik: Demo Yönetim · ${auditDate}`,
    `AC30 the sheet shows Son değişiklik: Demo Yönetim · ${auditDate}`,
  );
  await goto(yk, `/finans/aidat?donem=${P3}&uye=${kaanId}`);
  const waiver = yk.locator("[data-testid=waiver-form]");
  await waiver.locator("input[name=reason]").fill("E2E ‮ters yazı‬ izin");
  await waiver.getByRole("button", { name: "Muaf tut" }).click();
  check(await toast(yk, "Muaf tutuldu."), "AC28 a waiver with bidi overrides is saved");
  const reason = (
    await db.execute({
      sql: "select reason from dues_overrides where kind = 'waiver' and user_id = ? and dues_period_id = ?",
      args: [kaanId, P3],
    })
  ).rows[0]?.reason;
  check(
    reason === "E2E ters yazı izin",
    `AC28 the stored reason has no U+202E/U+202C (${JSON.stringify(reason)})`,
  );
  const waiverAudit = yk.locator("[data-testid=waiver-audit]");
  await waiverAudit.waitFor();
  check(
    (await text(waiverAudit)) === `Son değişiklik: Demo Yönetim · ${auditDate}`,
    "AC30 the waiver shows its Son değişiklik line",
  );
  await korist.goto(`${BASE}/finans`);
  await korist.waitForLoadState("networkidle");
  const koristFinans = (await korist.content()) + korist.url();
  await goto(korist, "/profil");
  check(
    !korist.url().includes("/finans") &&
      !koristFinans.includes("Son değişiklik") &&
      !(await korist.content()).includes("Son değişiklik"),
    "AC30 korist sees no Son değişiklik on /finans (redirected) or /profil",
  );
  const csv = await (await yk.request.get(`${BASE}/finans/aidat/csv?donem=${P3}`)).text();
  // yk is also a member row in the CSV; the editor name must not appear a second time.
  check(
    !csv.includes("Son değişiklik") && csv.split("Demo Yönetim").length - 1 === 1,
    "AC30 the dues CSV has no Son değişiklik and no editor name",
  );

  // AC28 bounded opening date
  await goto(yk, "/finans/ayarlar");
  const opening = yk.locator("[data-testid=opening-form]");
  await opening.locator("input[name=openedOn]").fill("1999-12-31");
  await opening.getByRole("button", { name: "Kaydet" }).click();
  check(
    (await opening.locator("#openedOn-error").textContent({ timeout: 8000 })) ===
      "Tarih 2000 ile gelecek iki yıl arasında olmalı.",
    "AC28 an opening dated 1999-12-31 is refused",
  );

  // AC31 a rate change freezes a period being paid; voiding its only payment drops the freeze
  await seedFinance(db, new Date());
  await pay(yk, "Demo Korist", { amount: "100" });
  const [partial] = await liveDues(koristId);
  await setRate(yk, koristId, "İndirimli");
  check((await freezeOf(koristId)) === 30000, "AC31 changing the rate mid-payment freezes ₺300");
  check(await voidEntry(yk, partial.id), "AC31 the only payment is voided");
  check((await freezeOf(koristId)) === null, "AC31 voiding the only payment deletes the freeze");
  check(
    (await myRow(korist, m0)).includes("₺150,00"),
    `AC31 korist now owes the new rate ₺150,00 for ${m0}`,
  );
  await pay(yk, "Demo Korist", {});
  check(
    (await liveDues(koristId)).map((r) => Number(r.amount_kurus)).join() === "15000" &&
      (await myRow(korist, m0)).includes("Ödendi"),
    "AC31 re-paying at the new rate settles the period with ₺150",
  );

  // AC31 two partial payments, void one: the freeze stays
  await seedFinance(db, new Date());
  await pay(yk, "Demo Korist", { amount: "100" });
  await pay(yk, "Demo Korist", { amount: "100" });
  const partials = await liveDues(koristId);
  await setRate(yk, koristId, "İndirimli");
  await voidEntry(yk, partials[0].id);
  const row = await myRow(korist, m0);
  check(
    partials.length === 2 && (await freezeOf(koristId)) === 30000 && row.includes("₺300,00"),
    `AC31 with a payment left, voiding the other keeps the ₺300 freeze (${row})`,
  );
  // AC32 one client id for two members: each gets its own rows and group
  await seedFinance(db, new Date());
  const shared = await pay(yk, "Demo Korist", { multi: true });
  await pay(yk, "Kaan Özdemir", { multi: true, clientId: shared });
  const groups = (
    await db.execute({
      sql: "select member_id, count(*) n, count(distinct payment_group_id) g, min(payment_group_id) gid from finance_entries where member_id in (?, ?) and payment_group_id is not null and voided_at is null and created_at > unixepoch() - 300 group by member_id",
      args: [koristId, kaanId],
    })
  ).rows;
  check(
    groups.length === 2 &&
      groups.every((g) => Number(g.n) === 2 && Number(g.g) === 1) &&
      groups[0].gid !== groups[1].gid,
    "AC32 both members' two-period payments are stored, each in its own group",
  );
  for (const [memberId, name] of [
    [koristId, "Demo Korist"],
    [kaanId, "Kaan Özdemir"],
  ]) {
    const rows = (
      await db.execute({
        sql: "select fe.id, dp.name from finance_entries fe join dues_periods dp on dp.id = fe.dues_period_id where fe.member_id = ? and fe.payment_group_id is not null and fe.voided_at is null order by dp.starts_on",
        args: [memberId],
      })
    ).rows;
    await goto(yk, `/finans/${rows[0].id}`);
    check(
      (await text(yk.locator("[data-testid=payment-group]"))) ===
        rows.map((r) => r.name).join(", "),
      `AC32 ${name}'s Aynı ödemede lists only their own periods`,
    );
  }

  // AC36 polish
  await seedFinance(db, new Date());
  await goto(yk, "/finans/hareketler");
  const duesRow = yk
    .locator("[data-testid=entry-row]")
    .filter({ has: yk.getByText(/^Aidat · /) })
    .first();
  const duesTitle = await text(duesRow.locator("span.font-medium").first());
  const members = (await db.execute("select name from users")).rows.map((r) => r.name);
  check(members.includes(duesTitle), `AC36 dues rows are titled by the member (${duesTitle})`);

  const require = createRequire(import.meta.url);
  const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  const prohibited = [];
  for (const path of ["/finans/aidat", "/finans/hareketler"]) {
    await goto(yk, path);
    // Evaluated over CDP, so the page CSP doesn't apply to the injected source.
    await yk.evaluate(axeSource);
    const ids = await yk.evaluate(async () =>
      (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(
        (v) => v.id,
      ),
    );
    if (ids.includes("aria-prohibited-attr")) prohibited.push(path);
  }
  check(
    prohibited.length === 0,
    `AC36 axe finds no aria-prohibited-attr (${prohibited.join(", ")})`,
  );

  await goto(yk, "/finans/aidat/donemler");
  const lockedTrash = yk
    .locator(`[data-testid=period-row][data-name="${exp.names[0]}"]`)
    .getByRole("button", { name: /^Sil: / });
  check(
    (await lockedTrash.getAttribute("aria-disabled")) === "true" &&
      (await lockedTrash.getAttribute("title")) === "Ödemesi olan dönem silinemez" &&
      (await text(lockedTrash)).includes("Ödemesi olan dönem silinemez"),
    "AC36 a period with payments has a disabled trash with the reason",
  );
  await yk.getByRole("button", { name: "Toplu oluştur" }).click();
  const bulk = yk.getByRole("dialog");
  const [y, m] = exp.months[2].split("-").map(Number);
  const ahead = (n) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };
  await bulk.locator("input[name=fromMonth]").fill(ahead(1));
  await bulk.locator("input[name=toMonth]").fill(ahead(2));
  const preview = await bulk
    .locator("[data-testid=bulk-preview] li")
    .first()
    .textContent({ timeout: 8000 });
  const shortMonth = new Intl.DateTimeFormat("tr-TR", { month: "short", timeZone: "UTC" }).format(
    new Date(`${ahead(1)}-15T12:00:00Z`),
  );
  check(
    preview.includes(`son ödeme 15 ${shortMonth}`),
    `AC36 the bulk preview names the due month (${preview})`,
  );
  await yk.keyboard.press("Escape");

  await goto(yk, "/finans/yeni");
  await yk
    .locator("fieldset", { has: yk.locator("legend", { hasText: /^Hesap$/ }) })
    .getByText("Kasa", { exact: true })
    .click();
  const checked = yk.locator("label:has(input[name=account]:checked)");
  check(
    (await checked.count()) === 1 && (await checked.locator("svg.lucide-check").isVisible()),
    "AC36 the selected account chip shows a check mark",
  );
  const bar = yk.getByRole("button", { name: "Kaydet", exact: true }).locator("..");
  const barBox = await bar.boundingBox();
  const tabBox = await yk.locator('nav.fixed[aria-label="Ana menü"]').boundingBox();
  check(
    barBox.y + barBox.height >= tabBox.y && barBox.y + barBox.height - tabBox.y <= 2,
    `AC36 the sticky save bar meets the tab bar (gap ${(tabBox.y - barBox.y - barBox.height).toFixed(1)} px)`,
  );

  for (const scheme of ["light", "dark"]) {
    const page = await phone(browser, "korist@arkhe.local", scheme);
    await goto(page, "/profil");
    const chip = page.locator("[data-testid=my-dues-row] .bg-absent").first();
    // Real contrast from the computed colours (a canvas turns oklch into sRGB), not class names.
    const ratio =
      (await chip.count()) === 1
        ? await chip.evaluate((el) => {
            const ctx = document.createElement("canvas").getContext("2d", {
              willReadFrequently: true,
            });
            const rgb = (color) => {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = color;
              ctx.fillRect(0, 0, 1, 1);
              return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
            };
            const lum = (c) => {
              const [r, g, b] = c.map((v) => {
                const s = v / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              });
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const style = getComputedStyle(el);
            const [a, b] = [lum(rgb(style.color)), lum(rgb(style.backgroundColor))];
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          })
        : 0;
    check(
      ratio >= 4.5,
      `AC36 the overdue chip text has ${ratio.toFixed(2)}:1 contrast (≥ 4.5) (${scheme})`,
    );
    if (scheme === "light") {
      check(
        (await page.getByRole("heading", { name: "Nasıl ödenir?" }).count()) === 1,
        "AC36 a paying member still sees Nasıl ödenir?",
      );
    }
    await page.context().close();
  }
  const baris = await phone(browser, "baris.gunes@arkhe.local");
  await goto(baris, "/profil");
  check(
    (await baris.getByText("Aidattan muafsın.").count()) === 1 &&
      (await baris.getByRole("heading", { name: "Nasıl ödenir?" }).count()) === 0,
    "AC36 a fully exempt member doesn't see Nasıl ödenir?",
  );

  for (const page of [yk, korist, baris]) await page.context().close();
  await seedFinance(db, new Date());
  await correctionAfterRateChange(browser);
}

/** Düzelt on a dues payment honours the rate-change freeze, both when the rate went up and down. */
async function correctionAfterRateChange(browser) {
  const koristId = await userId("korist@arkhe.local");
  const yk = await phone(browser, "yk@arkhe.local");
  const correct = async (id, amount) => {
    await goto(yk, `/finans/yeni?duzelt=${id}`);
    await yk.fill("input[name=amount]", amount);
    await yk.getByRole("button", { name: "Düzeltilmiş kaydı kaydet" }).click();
    await Promise.race([
      yk.waitForURL(
        (u) => /^\/finans\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(id),
      ),
      yk.locator("#amount-error").waitFor(),
    ]);
    return (await yk.locator("#amount-error").count()) ? text(yk.locator("#amount-error")) : "";
  };

  // Rate up: reduced ₺150, ₺100 paid, then Tam freezes ₺150; correcting to ₺250 would overpay.
  await seedFinance(db, new Date());
  await setRate(yk, koristId, "İndirimli");
  await pay(yk, "Demo Korist", { amount: "100" });
  await setRate(yk, koristId, "Tam");
  const [up] = await liveDues(koristId);
  const refused = await correct(up.id, "250");
  check(
    (await freezeOf(koristId)) === 15000 &&
      refused === "Kalan borç ₺150,00; daha fazlası girilemez." &&
      (await liveDues(koristId))[0]?.id === up.id,
    `Review: after a rate rise, Düzelt to more than the frozen ₺150 is refused (${refused})`,
  );
  const accepted = await correct(up.id, "150");
  const afterUp = await liveDues(koristId);
  check(
    accepted === "" && afterUp.length === 1 && Number(afterUp[0].amount_kurus) === 15000,
    "Review: after a rate rise, Düzelt up to the frozen ₺150 is accepted",
  );

  // Rate down: Tam ₺300, ₺100 paid, then İndirimli freezes ₺300; correcting to ₺250 is allowed.
  await seedFinance(db, new Date());
  await pay(yk, "Demo Korist", { amount: "100" });
  await setRate(yk, koristId, "İndirimli");
  const [down] = await liveDues(koristId);
  const downError = await correct(down.id, "250");
  const afterDown = await liveDues(koristId);
  check(
    (await freezeOf(koristId)) === 30000 &&
      downError === "" &&
      afterDown.length === 1 &&
      Number(afterDown[0].amount_kurus) === 25000,
    `Review: after a rate cut, Düzelt up to the frozen ₺300 is accepted (${downError})`,
  );

  await yk.context().close();
  await seedFinance(db, new Date());
}
