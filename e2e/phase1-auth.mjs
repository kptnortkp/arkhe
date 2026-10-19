import { BASE, check, db, login, loginAs, newPage } from "./lib.mjs";

export default async function phase1(browser, shotsDir) {
  let page = await newPage(browser);
  await login(page, "korist@arkhe.local", "yanlis-sifre");
  await page.waitForSelector("main [role=alert]");
  check(
    (await page.textContent("main [role=alert]")).includes("hatalı"),
    "wrong password shows a generic error",
  );
  check(
    (await page.inputValue("input[name=email]")) === "korist@arkhe.local",
    "email is kept after a failed login",
  );

  await login(page, "korist@arkhe.local");
  await page.waitForURL(`${BASE}/`);
  check((await page.textContent("h1")).includes("Demo"), "member lands on home after login");
  check(
    (await page.locator("nav >> text=Üyeler").count()) === 0,
    "member doesn't see Üyeler in nav",
  );
  await page.goto(`${BASE}/uyeler`);
  check(page.url() === `${BASE}/`, "member is redirected away from /uyeler");
  await page.context().close();

  page = await loginAs(browser, "yk@arkhe.local", { mobile: true });
  await page.goto(`${BASE}/uyeler`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/members-mobile.png`, fullPage: true });
  await page.goto(`${BASE}/uyeler/yeni`);
  check(
    await page.locator("input[name=role][value=conductor]").isDisabled(),
    "board can't pick conductor in the UI",
  );

  await page.fill("input[name=name]", "E2E Korist");
  await page.fill("input[name=email]", "bozuk-mail");
  await page.evaluate(() => (document.querySelector("main form").noValidate = true));
  await page.click("main button[type=submit]");
  await page.waitForSelector("text=Geçerli bir e-posta");
  check(
    (await page.inputValue("input[name=name]")) === "E2E Korist",
    "form keeps values after a validation error",
  );

  await page.fill("input[name=email]", "korist@e2e.test");
  await page.evaluate(() => {
    const radio = document.querySelector("input[name=role][value=conductor]");
    radio.disabled = false;
    radio.checked = true;
  });
  await page.click("main button[type=submit]");
  await page.waitForSelector("text=yetkin yok");
  check(true, "server rejects a board member creating a conductor");

  await page.evaluate(
    () => (document.querySelector("input[name=role][value=member]").checked = true),
  );
  await page.locator("label:has-text('Tenor')").click();
  await page.click("main button[type=submit]");
  await page.waitForSelector("text=Davet linki hazır");
  const url = (await page.textContent("p.font-mono")).trim();
  check(url.startsWith(`${BASE}/davet/`), "invite link is created");
  await page.context().close();

  page = await newPage(browser, { mobile: true });
  await page.goto(url);
  await page.fill("input[name=password]", "guclu-sifre-123");
  await page.fill("input[name=confirm]", "farkli-sifre-123");
  await page.click("main button[type=submit]");
  await page.waitForSelector("text=Şifreler eşleşmiyor");
  check(true, "password mismatch is rejected");
  await page.fill("input[name=password]", "guclu-sifre-123");
  await page.fill("input[name=confirm]", "guclu-sifre-123");
  await page.click("main button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  check((await page.textContent("h1")).includes("E2E"), "invitee sets a password and is logged in");
  await page.goto(url);
  check((await page.textContent("h1")).includes("geçersiz"), "invite link is single-use");

  await page.goto(`${BASE}/profil`);
  await page.locator("main button:has-text('Çıkış yap')").click();
  await page.waitForURL(/giris/);
  await page.goto(`${BASE}/`);
  check(page.url().includes("/giris"), "logout ends the session");

  await page.goto(`${BASE}/giris?next=//evil.example`);
  await page.fill("input[name=email]", "korist@e2e.test");
  await page.fill("input[name=password]", "guclu-sifre-123");
  await page.click("main button[type=submit]");
  await page.waitForLoadState("networkidle");
  check(page.url().startsWith(BASE), "next=//evil.example is not followed");
  await page.context().close();

  // Regression: the member page used to ship password hashes to the browser.
  page = await loginAs(browser, "sef@arkhe.local");
  await page.goto(`${BASE}/uyeler`);
  await page.locator("main ul a").first().click();
  await page.waitForURL(/\/uyeler\/[0-9a-f-]+$/);
  check(!(await page.content()).includes("scrypt$"), "member page HTML contains no password hash");
  await page.context().close();

  // Regression: a tab inside "next" turned into a protocol-relative redirect.
  page = await newPage(browser);
  await page.goto(`${BASE}/giris?next=%2F%09%2Fexample.com`);
  await page.fill("input[name=email]", "korist@arkhe.local");
  await page.fill("input[name=password]", "arkhe-demo-2026");
  await page.click("main button[type=submit]");
  await page.waitForLoadState("networkidle");
  check(page.url().startsWith(BASE), "next with an embedded tab stays on our origin");
  await page.context().close();

  // Regression: parallel guesses used to slip past the limit. Without a trusted IP only the
  // per-email bucket (30 per 15 min) applies, so prefill it to 28.
  await prefillAttempts("email:parallel@e2e.test", 28);
  page = await newPage(browser);
  await page.goto(`${BASE}/giris`);
  const results = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const p = await page.context().newPage();
      await p.goto(`${BASE}/giris`);
      await p.fill("input[name=email]", "parallel@e2e.test");
      await p.fill("input[name=password]", `wrong-${i}`);
      await p.click("main button[type=submit]");
      await p.waitForSelector("main [role=alert]");
      return p.textContent("main [role=alert]");
    }),
  );
  check(
    results.filter((t) => t.includes("Çok fazla")).length >= 7,
    "parallel guesses are still rate limited",
  );
  await page.context().close();
  await db.execute("delete from login_attempts");

  await prefillAttempts("email:nobody@e2e.test", 29);
  page = await newPage(browser);
  const alerts = [];
  for (let i = 0; i < 2; i++) {
    await login(page, "nobody@e2e.test", `x${i}`);
    await page.waitForSelector("main [role=alert]");
    alerts.push(await page.textContent("main [role=alert]"));
  }
  check(
    !alerts[0].includes("Çok fazla") && alerts[1].includes("Çok fazla"),
    "login is rate limited after 30 failures for one email",
  );
  await page.context().close();
  await db.execute("delete from login_attempts");
}

async function prefillAttempts(key, n) {
  for (let i = 0; i < n; i++) {
    await db.execute({ sql: "insert into login_attempts (key) values (?)", args: [key] });
  }
}
