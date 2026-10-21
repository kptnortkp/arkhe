// Phase 7: the Yedekleme page, Şimdi gönder, the run log and the home banner (AC 14–21, 36, 40) at 375×812.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { actionIds, BASE, check, db, istanbulDate, login, newPage, userId } from "./lib.mjs";
import {
  cron,
  insertRun,
  monthLabel,
  newEmails,
  outboxSnapshot,
  parseEml,
  previousMonthKey,
  removeEmails,
  resetBackup,
  runRows,
  setRecipients,
} from "./mail.mjs";

const ACTIONS_FILE = "src/app/(portal)/yedek/actions.ts";
const LONG = `p7-${"x".repeat(35)}@e2e.test`; // 48 characters
const PREV = previousMonthKey(istanbulDate());
const PREV_LABEL = monthLabel(PREV);
const DAY = Number(istanbulDate().slice(8));
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

async function phone(browser, email, scheme = "light") {
  const page = await newPage(browser, { phone: true, context: { colorScheme: scheme } });
  await login(page, email);
  await page.waitForURL(`${BASE}/`);
  return page;
}

async function goto(page, path) {
  const res = await page.goto(`${BASE}${path}`);
  await page.locator("main h1").first().waitFor();
  return res;
}

async function toast(page, message) {
  try {
    await page.getByText(message, { exact: true }).first().waitFor({ timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const text = async (locator) => ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();
const savedValue = async () =>
  (await db.execute("select value from app_settings where key = 'backup_recipients'")).rows[0]
    ?.value ?? null;

/** A useActionState action called the way a crafted multipart request would. */
async function callFormAction(page, action, recipients) {
  return page.evaluate(
    async ({ id, path, recipients }) => {
      const fd = new FormData();
      for (const r of recipients) fd.append("_1_recipients", r);
      fd.append("0", JSON.stringify([{}, "$K1"]));
      const res = await fetch(path, {
        method: "POST",
        headers: { "Next-Action": id, Accept: "text/x-component" },
        body: fd,
      });
      return res.text();
    },
    { ...action, recipients },
  );
}

async function callPlainAction(page, action) {
  return page.evaluate(
    async ({ id, path }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Next-Action": id,
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        body: "[]",
      });
      return res.text();
    },
    action,
  );
}

async function inputValues(page) {
  return page
    .locator("[data-testid=backup-recipients-form] input[name=recipients]")
    .evaluateAll((els) => els.map((e) => e.value));
}

async function fillRows(page, values) {
  const form = page.locator("[data-testid=backup-recipients-form]");
  const inputs = form.locator("input[name=recipients]");
  while ((await inputs.count()) > 1) {
    await form.getByRole("button", { name: /^\d+\. alıcıyı kaldır$/ }).last().click();
  }
  for (let i = 0; i < values.length; i++) {
    if (i > 0) await form.getByRole("button", { name: "Adres ekle" }).click();
    await inputs.nth(i).fill(values[i]);
  }
}

async function save(page) {
  await page
    .locator("[data-testid=backup-recipients-form]")
    .getByRole("button", { name: "Kaydet" })
    .click();
}

/** Saves and waits for the server action's own response, not a toast that may still be up. */
async function saveAndWait(page) {
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
  );
  await save(page);
  return response;
}

async function banner(page) {
  await goto(page, "/");
  const b = page.locator("[data-testid=backup-banner]");
  if ((await b.count()) === 0) return null;
  return {
    kind: await b.getAttribute("data-kind"),
    role: await b.getAttribute("role"),
    tag: await b.evaluate((el) => el.tagName.toLowerCase()),
    text: await text(b),
    before: await b.evaluate(
      (el) =>
        el.previousElementSibling?.querySelector("h1") !== null &&
        el.nextElementSibling?.getAttribute("aria-label") === "Sıradaki çalışma",
    ),
  };
}

export default async function phase7Page(browser) {
  await resetBackup();
  const start = outboxSnapshot();
  const sefId = await userId("sef@arkhe.local");
  const sef = await phone(browser, "sef@arkhe.local");
  const yk = await phone(browser, "yk@arkhe.local");
  const korist = await phone(browser, "korist@arkhe.local");
  try {
    // AC15
    await korist.goto(`${BASE}/yedek`);
    await korist.waitForURL(`${BASE}/`);
    check(
      new URL(korist.url()).pathname === "/" &&
        (await korist.getByRole("heading", { name: "Yedekleme" }).count()) === 0,
      "AC15 korist@ opening /yedek ends on / with no Yedekleme heading",
    );
    await goto(korist, "/profil");
    check(
      (await korist.locator('a[href="/yedek"]').count()) === 0,
      "AC15 korist@ /profil has no /yedek link",
    );
    for (const [name, page] of [
      ["sef@", sef],
      ["yk@", yk],
    ]) {
      const res = await goto(page, "/yedek");
      check(
        res.status() === 200 && (await text(page.locator("main h1"))) === "Yedekleme",
        `AC15 ${name} gets /yedek with the Yedekleme heading`,
      );
      await goto(page, "/profil");
      const link = page.locator('[data-testid=profile-manager-links] a[href="/yedek"]');
      check(
        (await link.count()) === 1 &&
          (await text(link)).includes("Yedekleme") &&
          (await text(link)).includes("Aylık rapor ve yedek e-postası"),
        `AC15 ${name} /profil has the Yedekleme link with its hint`,
      );
    }

    // AC21 + empty states
    const setupBanner = await banner(sef);
    check(
      setupBanner?.kind === "unconfigured" &&
        setupBanner.tag === "aside" &&
        setupBanner.role === null &&
        setupBanner.text.includes("Aylık yedek henüz ayarlanmadı.") &&
        setupBanner.text.includes("Koronun kayıtları her ay yönetimin e-postasına yedeklensin.") &&
        (await sef.locator('[data-testid=backup-banner] a[href="/yedek"]').textContent()) ===
          "Ayarla",
      `AC21 sef@ sees the quiet not-configured aside with Ayarla (${JSON.stringify(setupBanner)})`,
    );
    check(setupBanner?.before, "AC20/21 the banner sits between the greeting and the stage hero");
    check(
      (await banner(yk)) === null && (await banner(korist)) === null,
      "AC21 yk@ and korist@ see no not-configured box",
    );
    await goto(sef, "/yedek");
    check(
      (await text(sef.locator("[data-testid=backup-status]"))).includes("Henüz ayarlanmadı."),
      "AC16 Durum reads Henüz ayarlanmadı. with no recipients",
    );
    const sendButton = sef.getByRole("button", { name: "Şimdi gönder" });
    check(
      (await sendButton.isDisabled()) &&
        (await text(sef.locator("#gonder-durum"))) === "Önce en az bir alıcı kaydet.",
      "AC17 without recipients Şimdi gönder is disabled with Önce en az bir alıcı kaydet.",
    );
    check(
      (await text(sef.locator("[data-testid=backup-log-empty]"))) ===
        "Henüz gönderim yok. Alıcılar kaydedilince her ay kendiliğinden gönderilir.",
      "AC19 empty log without recipients",
    );
    const setupRows = sef.locator("[data-testid=backup-setup] li");
    check(
      (await setupRows.count()) === 4 &&
        (await sef.locator("[data-testid=backup-setup-smtp]").getAttribute("data-ok")) === "true" &&
        (await text(sef.locator("[data-testid=backup-setup-smtp]"))).includes(
          "deneme ortamı, e-posta gönderilmez, dosyaya yazılır",
        ) &&
        (await sef.locator("[data-testid=backup-setup-recipients]").getAttribute("data-ok")) ===
          "false" &&
        (await text(sef.locator("[data-testid=backup-setup-recipients]"))).endsWith("Eksik"),
      "AC16 Kurulum: four rows; dev mail Tamam with the outbox note; Alıcılar Eksik",
    );
    const setupText = await text(sef.locator("[data-testid=backup-setup]"));
    check(
      !setupText.includes("dev-only") &&
        setupText.includes("Şifre kaybolursa hiçbir yedek açılamaz.") &&
        setupText.includes('Adımlar README\'de: "Aylık yedek e-postası".'),
      "AC16 Kurulum shows no secret value, plus the README line and the passphrase reminder",
    );

    // AC14: first save normalises, no notice
    let before = outboxSnapshot();
    await fillRows(sef, ["  P7A@E2E.test ", "p7b@e2e.test", "p7a@e2e.test", ""]);
    await save(sef);
    check(await toast(sef, "Alıcılar kaydedildi."), "AC14 sef@ save → toast Alıcılar kaydedildi.");
    await sef.locator("[data-testid=backup-audit]").waitFor();
    check(
      JSON.stringify(await inputValues(sef)) === '["p7a@e2e.test","p7b@e2e.test"]' &&
        (await savedValue()) === "p7a@e2e.test,p7b@e2e.test",
      `AC14 the inputs re-render the normalised list (${await inputValues(sef)})`,
    );
    check(
      (await text(sef.locator("[data-testid=backup-audit]"))).startsWith(
        "Son değişiklik: Demo Şef · ",
      ),
      "AC14 the audit line appears",
    );
    check(newEmails(before).length === 0, "AC14 the first save sends no notice");
    check(
      (await banner(sef)) === null,
      "AC21 after saving, the not-configured box is gone (created this month: no overdue banner)",
    );

    // AC14: change → one notice to the union
    await goto(sef, "/yedek");
    before = outboxSnapshot();
    await fillRows(sef, ["p7a@e2e.test", "p7c@e2e.test"]);
    await saveAndWait(sef);
    let mails = newEmails(before);
    const notice = mails.length === 1 ? parseEml(mails[0]) : null;
    const noticeTo = (notice?.headers.to ?? "").split(",").map((s) => s.trim()).sort();
    check(
      mails.length === 1 &&
        notice.headers.subject === "Arkhe yedek alıcıları değişti" &&
        JSON.stringify(noticeTo) === '["p7a@e2e.test","p7b@e2e.test","p7c@e2e.test"]',
      `AC14 a change writes one notice to old and new (${mails.length}, ${noticeTo})`,
    );
    check(
      notice?.text.includes("Değiştiren: Demo Şef · ") &&
        notice.text.includes("Listeden çıkarıldıysanız aylık e-posta artık size gelmeyecek.") &&
        notice.text.includes("Bu değişiklikten haberiniz yoksa koro şefine hemen haber verin.") &&
        notice.text.includes("Güncel alıcı listesi:\n- p7a@e2e.test\n- p7c@e2e.test\n") &&
        notice.text.includes(`Listeyi buradan görebilirsiniz:\n${BASE}/yedek\n`),
      "AC14 the notice body names who, the current list and the page with a lead-in",
    );
    check(
      (await runRows()).length === 0,
      "AC14 the notice is not logged as a backup run",
    );
    before = outboxSnapshot();
    const same = await saveAndWait(sef);
    check(
      same.ok() && newEmails(before).length === 0 && (await savedValue()) === "p7a@e2e.test,p7c@e2e.test",
      "AC14 saving the same list again sends nothing (checked after the action returned)",
    );

    // AC14: errors
    await goto(sef, "/yedek");
    await fillRows(sef, [""]);
    await save(sef);
    const alert = sef.locator("[data-testid=backup-recipients-form] [role=alert]");
    await alert.waitFor();
    check(
      (await text(alert)) === "En az bir adres gir." &&
        (await sef.evaluate(() => document.activeElement?.getAttribute("aria-label"))) ===
          "Alıcı 1",
      "AC14 empty → En az bir adres gir., focus on the first input",
    );
    check(
      ((await sef.getByLabel("Alıcı 1", { exact: true }).getAttribute("aria-describedby")) ?? "")
        .split(" ")
        .includes(await alert.getAttribute("id")),
      "AC14 row 1 is described by the list-level error",
    );
    await fillRows(sef, ["p7a@e2e.test", "x@"]);
    await save(sef);
    const invalid = sef.getByText("Geçerli bir e-posta adresi gir: x@", { exact: true });
    await invalid.waitFor();
    check(
      (await sef.getByLabel("Alıcı 2", { exact: true }).getAttribute("aria-invalid")) === "true" &&
        (await sef.getByLabel("Alıcı 1", { exact: true }).getAttribute("aria-invalid")) === null,
      "AC14 x@ → the message under row 2 with aria-invalid",
    );
    check(
      (await savedValue()) === "p7a@e2e.test,p7c@e2e.test",
      "AC14 invalid saves change nothing",
    );
    await fillRows(sef, ["a@e2e.test", "b@e2e.test", "c@e2e.test", "d@e2e.test", "e@e2e.test"]);
    const form = sef.locator("[data-testid=backup-recipients-form]");
    check(
      (await form.getByRole("button", { name: "Adres ekle" }).count()) === 0 &&
        (await form.getByText("En fazla beş adres.", { exact: true }).count()) === 1,
      "AC16 at five rows Adres ekle is replaced by En fazla beş adres.",
    );
    const sizes = await sef.evaluate(() =>
      [
        ...document.querySelectorAll(
          "[data-testid=backup-recipients-form] :is(input, button), [data-testid=backup-send] button",
        ),
      ].map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    check(sizes.every((h) => h >= 44), `AC16 every recipients/send control is ≥ 44 px (${sizes})`);
    check(
      (await form.locator("input[name=recipients]").first().getAttribute("autocomplete")) ===
        "off" &&
        (await form.locator("input[name=recipients]").first().getAttribute("type")) === "email",
      "AC16 inputs are type=email, autocomplete=off",
    );

    const actions = await actionIds(ACTIONS_FILE);
    const six = await callFormAction(sef, actions.saveBackupRecipients, [
      "a@e2e.test",
      "b@e2e.test",
      "c@e2e.test",
      "d@e2e.test",
      "e@e2e.test",
      "f@e2e.test",
    ]);
    check(
      six.includes("En fazla beş adres ekleyebilirsin.") &&
        (await savedValue()) === "p7a@e2e.test,p7c@e2e.test",
      "AC14 six addresses via a direct action call → refused, value unchanged",
    );
    await goto(yk, "/yedek");
    const ykSave = await callFormAction(yk, actions.saveBackupRecipients, ["yk@e2e.test"]);
    check(
      ykSave.includes("Bu ayarı yalnızca koro şefi değiştirebilir.") &&
        (await savedValue()) === "p7a@e2e.test,p7c@e2e.test",
      "AC14 yk@'s save via a direct action call → refused, value unchanged",
    );

    // AC40 recipient changes throttle
    for (let i = 0; i < 10; i++) {
      await db.execute({
        sql: "insert into login_attempts (key) values (?)",
        args: [`backup-recipients:${sefId}`],
      });
    }
    const throttled = await callFormAction(sef, actions.saveBackupRecipients, ["p7z@e2e.test"]);
    check(
      throttled.includes("Alıcılar bugün çok sık değişti. Yarın yeniden dene.") &&
        (await savedValue()) === "p7a@e2e.test,p7c@e2e.test",
      "AC40 the 11th change in a day → Alıcılar bugün çok sık değişti., nothing written",
    );
    await db.execute("delete from login_attempts where key like 'backup-%'");

    // AC17: send now
    await goto(sef, "/yedek");
    const firstInput = sef.getByLabel("Alıcı 1", { exact: true });
    await firstInput.fill("taslak@e2e.test");
    await sef.getByRole("button", { name: "Şimdi gönder" }).click();
    let dialog = sef.getByRole("alertdialog");
    await dialog.waitFor();
    check(
      (await dialog.getByText("Kaydedilmemiş değişiklikler gönderime dahil değil.").count()) === 1,
      "AC17 unsaved edits → the dialog warns they are not included",
    );
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await dialog.waitFor({ state: "hidden" });
    await firstInput.fill("p7a@e2e.test");
    await sef.getByRole("button", { name: "Şimdi gönder" }).click();
    dialog = sef.getByRole("alertdialog");
    await dialog.waitFor();
    const dialogText = await text(dialog);
    check(
      dialogText.includes("Rapor ve yedek gönderilsin mi?") &&
        dialogText.includes(`2 adrese ${PREV_LABEL} raporları ve şifreli yedek gönderilecek.`) &&
        JSON.stringify(
          await dialog.locator("[data-testid=send-recipients] li").allTextContents(),
        ) === '["p7a@e2e.test","p7c@e2e.test"]' &&
        !dialogText.includes("Kaydedilmemiş") &&
        (await dialog.getByRole("button", { name: "Vazgeç" }).count()) === 1,
      `AC17 the dialog names 2 addresses and ${PREV_LABEL}, lists them, no dirty warning`,
    );
    check(
      (await dialog.evaluate((el) => document.activeElement?.closest("[role=alertdialog]") === el)) &&
        (await sef.evaluate(() => document.activeElement?.textContent?.trim())) === "Vazgeç",
      "AC17 the dialog opens with focus on Vazgeç",
    );

    // Hold the action POST so the pending state can be observed.
    let release;
    const held = new Promise((resolve) => (release = resolve));
    const hold = async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    };
    await sef.route(`${BASE}/yedek`, hold);
    before = outboxSnapshot();
    await dialog.getByRole("button", { name: "Gönder", exact: true }).focus();
    await sef.keyboard.press("Enter");
    const pendingButton = dialog.getByRole("button", { name: "Gönderiliyor…" });
    await pendingButton.waitFor();
    await sef.keyboard.press("Escape");
    await sef.waitForTimeout(200);
    check(
      (await pendingButton.isDisabled()) &&
        (await dialog.getByRole("button", { name: "Vazgeç" }).isDisabled()) &&
        (await dialog.isVisible()) &&
        (await sef.evaluate(() => document.activeElement?.textContent?.trim())) ===
          "Gönderiliyor…",
      "AC17 while pending: both buttons disabled, Gönderiliyor…, Escape ignored, focus kept",
    );
    release();
    check(await toast(sef, "Gönderildi: 2 adres."), "AC17 Gönder → toast Gönderildi: 2 adres.");
    await dialog.waitFor({ state: "hidden" });
    await sef.unroute(`${BASE}/yedek`, hold);
    mails = newEmails(before);
    const manual = mails.length === 1 ? parseEml(mails[0]) : null;
    check(
      manual?.headers.subject ===
        `Arkhe aylık rapor ve yedek · ${PREV_LABEL} (elle gönderildi)` &&
        /Bu e-postayı Demo Şef portaldan elle gönderdi \(\d+ \S+ \d{4} \d{2}:\d{2}\)\./.test(
          manual.text,
        ),
      `AC17 one .eml with the (elle gönderildi) subject and the manual paragraph (${mails.length})`,
    );
    await sef.waitForTimeout(500);
    const firstRun = sef.locator("[data-testid=backup-run]").first();
    await firstRun.waitFor();
    check(
      (await firstRun.getAttribute("data-status")) === "sent" &&
        (await text(firstRun)).includes(`${PREV_LABEL}`) &&
        (await text(firstRun)).includes("· Elle · Demo Şef") &&
        /\d+ KB · 2 adres/.test(await text(firstRun)),
      `AC17/19 a Elle · Demo Şef row is first in Geçmiş (${await text(firstRun)})`,
    );
    const sendResult = sef.locator("[data-testid=backup-send-result]");
    check(
      /^Gönderildi: 2 adres\. \d+ dakika sonra yeniden gönderebilirsin\.$/.test(
        await text(sendResult),
      ) &&
        (await sendResult.getAttribute("aria-live")) === "polite" &&
        (await sef.locator("#gonder-durum").count()) === 0,
      `AC17 the polite live region keeps the result with the cooldown, no separate hint (${await text(sendResult)})`,
    );
    check(
      await sendResult.evaluate((el) => document.activeElement === el),
      "AC17 after the dialog closes, focus is on the result line, not <body>",
    );
    check(
      (await text(sef.locator("[data-testid=backup-status]"))).includes(
        `${PREV_LABEL} raporu gönderildi.`,
      ) &&
        (await text(sef.locator("[data-testid=backup-status]"))).includes(
          "Sonraki gönderim: 1 ",
        ) &&
        (await text(sef.locator("[data-testid=backup-status]"))).includes(
          "sabah 08:00–09:00 arası",
        ),
      "AC16 Durum updates to gönderildi with Sonraki gönderim: 1 …, sabah 08:00–09:00 arası",
    );
    await goto(sef, "/yedek");
    check(
      (await sef.getByRole("button", { name: "Şimdi gönder" }).isDisabled()) &&
        /^Az önce gönderildi\. \d+ dakika sonra yeniden gönderebilirsin\.$/.test(
          await text(sef.locator("#gonder-durum")),
        ),
      "AC17 right after, the button is disabled with the cooldown hint",
    );
    before = outboxSnapshot();
    const cooled = await callPlainAction(sef, actions.sendBackupNow);
    check(
      /Az önce gönderildi\. \d+ dakika sonra yeniden gönderebilirsin\./.test(cooled) &&
        newEmails(before).length === 0 &&
        (await runRows()).length === 1,
      "AC17 a direct send in the cooldown → the cooldown message, no .eml, no run",
    );
    const ykSend = await callPlainAction(yk, actions.sendBackupNow);
    check(
      ykSend.includes("Bu işlemi yalnızca koro şefi yapabilir.") &&
        newEmails(before).length === 0,
      "AC17 yk@'s direct send → Bu işlemi yalnızca koro şefi yapabilir., no .eml",
    );

    // AC18
    const covered = await cron(`?bugun=${istanbulDate().slice(0, 8)}01`);
    check(
      covered.json?.status === "skipped" && newEmails(before).length === 0,
      `AC18 after the manual send, the cron for ${PREV} is skipped (${covered.text})`,
    );

    // AC40 manual send throttle
    await db.execute("delete from backup_runs");
    for (let i = 0; i < 6; i++) {
      await db.execute({
        sql: "insert into login_attempts (key) values (?)",
        args: [`backup-send:${sefId}`],
      });
    }
    const tooMany = await callPlainAction(sef, actions.sendBackupNow);
    check(
      tooMany.includes("Çok fazla deneme. Bir saat sonra yeniden dene.") &&
        (await runRows()).length === 0 &&
        newEmails(before).length === 0,
      "AC40 the 7th manual send in an hour → Çok fazla deneme., no run row",
    );
    await db.execute("delete from login_attempts where key like 'backup-%'");

    // AC17 running refusal
    await insertRun({ month: PREV, status: "running", ageMin: 1 });
    await goto(sef, "/yedek");
    const running = await callPlainAction(sef, actions.sendBackupNow);
    check(
      (await sef.getByRole("button", { name: "Şimdi gönder" }).isDisabled()) &&
        (await text(sef.locator("#gonder-durum"))) === "Şu an bir gönderim sürüyor." &&
        (await text(sef.locator("[data-testid=backup-status]"))).includes(
          `${PREV_LABEL} raporu şu an gönderiliyor.`,
        ) &&
        running.includes("Şu anda bir gönderim sürüyor. Birkaç dakika sonra yeniden dene.") &&
        (await runRows()).length === 1,
      "AC17/16 a running send → Durum says so, button disabled, direct call refused, no new row",
    );

    // AC19
    await db.execute("delete from backup_runs");
    await goto(sef, "/yedek");
    const emptyLog = await text(sef.locator("[data-testid=backup-log-empty]"));
    check(
      /^Henüz gönderim yok\. İlk otomatik gönderim: \d+ \S+ \d{4}, sabah 08:00–09:00 arası\.$/.test(
        emptyLog,
      ),
      `AC19 empty log with recipients names the next try (${emptyLog})`,
    );
    const longError = `E2E-${"çokuzunbirkelime".repeat(13)}`.slice(0, 200);
    await insertRun({ month: "2026-03", status: "running", ageMin: 20 });
    await insertRun({ month: "2026-04", status: "sent", ageMin: 30, size: 188_416, count: 3 });
    await insertRun({ month: "2026-05", status: "failed", ageMin: 15, error: longError });
    await insertRun({ month: "2026-06", status: "running", ageMin: 1 });
    await goto(sef, "/yedek");
    const runs = sef.locator("[data-testid=backup-run]");
    const statuses = await runs.evaluateAll((els) => els.map((e) => e.dataset.status));
    const labels = await runs.evaluateAll((els) =>
      els.map((e) => e.querySelector("span.rounded-full")?.textContent),
    );
    check(
      JSON.stringify(statuses) === '["running","failed","stale","sent"]' &&
        JSON.stringify(labels) === '["Gönderiliyor","Gönderilemedi","Yarıda kaldı","Gönderildi"]',
      `AC19 one row per status, newest first, labelled (${labels})`,
    );
    const staleRow = runs.nth(2);
    check(
      (await text(staleRow)).includes(
        "Gönderim yarıda kaldı. Her sabah kendiliğinden yeniden deneniyor.",
      ),
      "AC19 an unreaped stale row explains itself",
    );
    check(
      (await text(runs.nth(3))).includes("184 KB · 3 adres") &&
        (await text(runs.nth(3))).includes("· Otomatik"),
      `AC19 a sent row reads … · Otomatik and 184 KB · 3 adres (${await text(runs.nth(3))})`,
    );
    const errorFit = await runs
      .nth(1)
      .getByText(longError, { exact: true })
      .evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.scrollWidth <= el.clientWidth && box.left >= 0 && box.right <= window.innerWidth;
      });
    check(errorFit, "AC19 a 200-character unbroken error wraps inside its row and the viewport");
    check(
      (await sef.locator("[data-testid=backup-status]").getAttribute("data-state")) === "pending",
      "AC16 Durum for an uncovered month without a run for it reads pending",
    );
    await db.execute("delete from backup_runs");
    for (let i = 0; i < 15; i++) {
      await insertRun({ month: "2025-0" + ((i % 9) + 1), status: "sent", ageMin: 60 + i });
    }
    await goto(sef, "/yedek");
    check(
      (await runs.count()) === 12 &&
        (await sef.getByText("Son 12 gönderim gösteriliyor.", { exact: true }).count()) === 1,
      `AC19 15 runs → 12 shown plus the footnote (${await runs.count()})`,
    );

    // AC20 banners. Rule (b) needs the 3rd or later (the banner reads the real clock); the rest runs every day.
    await db.execute("delete from backup_runs");
    if (DAY >= 3) {
      await setRecipients(["p7a@e2e.test", "p7c@e2e.test"], {
        createdAt: new Date(Date.now() - 40 * 86_400_000),
      });
      for (const [name, page] of [
        ["sef@", sef],
        ["yk@", yk],
      ]) {
        const b = await banner(page);
        check(
          b?.kind === "overdue" &&
            b.role === "alert" &&
            b.text.startsWith(`${PREV_LABEL} raporu ve yedeği henüz gönderilmedi.`) &&
            b.text.includes("Yedeklemeye git"),
          `AC20(b) ${name} sees the overdue banner for ${PREV_LABEL} (${b?.text})`,
        );
      }
      await insertRun({ month: "2024-05", status: "failed" });
      const olderOnly = await banner(yk);
      check(olderOnly?.kind === "overdue", "AC20 a failed row for an older month raises no (a) banner");
    } else {
      check(true, `AC20(b) SKIPPED: today is day ${DAY} of the month (needs the 3rd or later)`);
    }

    // Created this month, so (b) can't match and (a) is proven on its own.
    await db.execute("delete from backup_runs");
    await setRecipients(["p7a@e2e.test", "p7c@e2e.test"]);
    check((await banner(sef)) === null, "AC20 recipients from this month and no run → no banner");
    await insertRun({ month: PREV, status: "failed", trigger: "manual", actorId: sefId });
    check((await banner(sef)) === null, "AC20(a) a failed manual run for the month raises no banner");
    await db.execute("delete from backup_runs");
    await insertRun({ month: PREV, status: "running", ageMin: 20 });
    check(
      (await banner(sef))?.kind === "failed",
      "AC20(a) an unreaped stale cron run for the month raises the failure banner",
    );
    await db.execute("delete from backup_runs");
    await insertRun({ month: PREV, status: "failed", error: "E2E bağlantı yok" });
    for (const [name, page] of [
      ["sef@", sef],
      ["yk@", yk],
    ]) {
      const b = await banner(page);
      check(
        b?.kind === "failed" &&
          b.role === "alert" &&
          b.text.includes(`Aylık yedek gönderilemedi (${PREV_LABEL}).`) &&
          b.text.includes("Her sabah yeniden deneniyor. Nedenini Yedekleme sayfasında görebilirsin.") &&
          b.before,
        `AC20(a) ${name} sees the failure banner, above the hero (${b?.text})`,
      );
    }
    await goto(sef, "/");
    const link = sef.locator("[data-testid=backup-banner] a[href='/yedek']");
    check(
      (await link.textContent()) === "Yedeklemeye git" && (await link.boundingBox()).height >= 44,
      "AC20 the banner link Yedeklemeye git is 44 px",
    );
    check((await banner(korist)) === null, "AC20 korist@ never sees the banner");
    await goto(sef, "/yedek");
    const status = sef.locator("[data-testid=backup-status]");
    check(
      (await status.getAttribute("data-state")) === "failed" &&
        (await text(status)).includes(`${PREV_LABEL} raporu gönderilemedi.`) &&
        (await text(status)).includes("E2E bağlantı yok") &&
        (await text(status)).includes("Her sabah kendiliğinden yeniden deneniyor."),
      "AC16 Durum shows the failure headline, the error and the retry line",
    );
    await insertRun({ month: PREV, status: "sent", trigger: "manual", actorId: sefId });
    check(
      (await banner(sef)) === null && (await banner(yk)) === null,
      "AC20 after a covering sent row the banner is gone",
    );

    // AC16 + AC36: layout, both themes, both roles
    await db.execute("delete from backup_runs");
    await setRecipients(["p7a@e2e.test", LONG]);
    await insertRun({ month: PREV, status: "failed", error: longError });
    for (const scheme of ["light", "dark"]) {
      for (const email of ["sef@arkhe.local", "yk@arkhe.local"]) {
        const page = await phone(browser, email, scheme);
        const res = await goto(page, "/yedek");
        const csp = res.headers()["content-security-policy"] ?? "";
        const layout = await page.evaluate(() => ({
          fits: document.documentElement.scrollWidth <= window.innerWidth,
          inputs: document.querySelectorAll("main input").length,
        }));
        const conductor = email.startsWith("sef");
        const roleOk = conductor
          ? layout.inputs === 2 &&
            (await page.getByRole("button", { name: "Kaydet" }).count()) === 1 &&
            (await page.getByRole("button", { name: "Şimdi gönder" }).count()) === 1
          : layout.inputs === 0 &&
            (await page.getByRole("button", { name: "Kaydet" }).count()) === 0 &&
            (await page.getByRole("button", { name: "Şimdi gönder" }).count()) === 0 &&
            (await page.getByText("Alıcıları yalnızca koro şefi değiştirebilir.").count()) === 1 &&
            (await page.getByText(LONG, { exact: true }).count()) === 1;
        check(
          layout.fits && roleOk && (await page.locator("[data-testid=backup-setup] li").count()) === 4,
          `AC16 ${email} ${scheme}: no horizontal scroll with a 48-character address, four Kurulum rows, role controls`,
        );
        check(csp.includes("'nonce-"), `AC36 ${email} ${scheme}: /yedek carries the nonce CSP`);
        await page.evaluate(axeSource);
        const bad = await page.evaluate(async () =>
          (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3)}`),
        );
        check(bad.length === 0, `AC16 axe ${email} ${scheme}: no serious/critical (${bad})`);
        if (conductor) {
          await page.getByRole("button", { name: "Şimdi gönder" }).click();
          await page.getByRole("alertdialog").waitFor();
          // Let the open animation finish; axe would measure the fading-in colours.
          await page.evaluate(() =>
            Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))),
          );
          await page.evaluate(axeSource);
          const dialogBad = await page.evaluate(async () =>
            (await window.axe.run("[role=alertdialog]", { runOnly: ["wcag2a", "wcag2aa"] }))
              .violations.filter((v) => v.impact === "serious" || v.impact === "critical")
              .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3)}`),
          );
          check(dialogBad.length === 0, `AC17 axe on the open dialog ${scheme} (${dialogBad})`);
        }
        await goto(page, "/");
        await page.evaluate(axeSource);
        const homeBad = await page.evaluate(async () =>
          (await window.axe.run("[data-testid=backup-banner]", { runOnly: ["wcag2a", "wcag2aa"] }))
            .violations.filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => v.id),
        );
        check(homeBad.length === 0, `AC20 axe on the banner ${email} ${scheme} (${homeBad})`);
        await page.context().close();
      }
    }
  } finally {
    removeEmails(newEmails(start));
    await resetBackup();
    for (const page of [sef, yk, korist]) await page.context().close();
  }
}
