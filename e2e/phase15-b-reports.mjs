// Phase 15 B: in-app issue reports ("Sorun bildir"): filing with screenshots, privacy of reports
// and images, the handler's list/detail/save, push both ways, refusals, rate limit, quota stop,
// and the 90-day image retention in the daily sweep.
import { BASE, check, db, loginAs, userId } from "./lib.mjs";
import { cron } from "./mail.mjs";
import { ago, createUser, go, one } from "./media.mjs";
import { addDevice, resetPush, until } from "./push.mjs";
import { uploadsRootFor } from "../src/lib/storage/root.mjs";
import { access } from "node:fs/promises";
import path from "node:path";

const REPORTER = "korist@arkhe.local";
const HANDLER = "yk@arkhe.local";
const CONDUCTOR = "sef@arkhe.local";
const OTHER_BOARD = "yk2.sorun@e2e.test";
const OTHER_MEMBER = "uye.sorun@e2e.test";
const KINDS = "('report_new', 'report_updated', 'release')";
const TITLE = "E2E Kayıt butonu çalışmıyor";

const root = uploadsRootFor(`file:${new URL("../data/arkhe.db", import.meta.url).pathname}`);
const fileExists = (key) =>
  access(path.join(root, key)).then(
    () => true,
    () => false,
  );

async function reset() {
  await db.batch(
    [
      "delete from issue_reports where title like 'E2E%'",
      "delete from report_image_deletions",
      `delete from notifications where kind in ${KINDS}`,
      "delete from login_attempts where key like 'report%'",
      "delete from notification_state where key = 'surum'",
      "delete from storage_events where kind = 'put' and bytes = 1",
    ],
    "write",
  );
}

/** A PNG made in the page: a gradient, `w`×`h`, as a Playwright file payload. */
async function pngFile(page, name, w, h) {
  const b64 = await page.evaluate(
    ({ w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#335");
      g.addColorStop(1, "#fc6");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = "64px sans-serif";
      ctx.fillText("Arkhe e2e", 40, 120);
      return c.toDataURL("image/png").split(",")[1];
    },
    { w, h },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
}

/** Raw POST of one screenshot as the page's user (outside the page: no console noise). */
async function postImage(page, reportId, bytes) {
  const res = await page.request.post(`${BASE}/api/dosya/sorun?bildirim=${reportId}`, {
    headers: { Origin: BASE, "Content-Type": "application/octet-stream" },
    data: Buffer.from(bytes),
    failOnStatusCode: false,
  });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

async function getImage(page, id) {
  const res = await page.request.get(`${BASE}/api/dosya/sorun/${id}`, { failOnStatusCode: false });
  const body = await res.body();
  return {
    status: res.status(),
    size: body.byteLength,
    cache: res.headers()["cache-control"],
    type: res.headers()["content-type"],
  };
}

/** Natural width of a delivered image, decoded by the browser. */
const imageWidth = (page, id) =>
  page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth);
        img.onerror = () => resolve(-1);
        img.src = `/api/dosya/sorun/${id}`;
      }),
    id,
  );

async function fileReport(page, { title, body, files = [], from = "/odevler" }) {
  await go(page, `${BASE}/sorun-bildir${from ? `?from=${encodeURIComponent(from)}` : ""}`);
  await page.fill("input[name=title]", title);
  await page.fill("textarea[name=body]", body);
  if (files.length) {
    await page.setInputFiles("[data-testid=report-files]", files);
    await page.locator("[data-testid=report-shots] li").nth(files.length - 1).waitFor();
  }
  await page.click("[data-testid=report-form] button[type=submit]");
  await page.locator("[data-testid=report-form] [role=status], [data-testid=report-form] [role=alert]").first().waitFor();
}

async function status404(page, url) {
  const res = await page.request.get(url, { failOnStatusCode: false, maxRedirects: 0 });
  const body = await res.text();
  // Same marker as phase9-b: the page renders the app's not-found screen.
  return { status: res.status(), h1: body.includes("Sayfa bulunamadı") ? "Sayfa bulunamadı" : "" };
}

export default async function run(browser) {
  await reset();
  const reporterId = await userId(REPORTER);
  const handlerId = await userId(HANDLER);
  await createUser(OTHER_BOARD, "E2E İkinci Yönetim", { role: "board", part: "tenor" });
  await createUser(OTHER_MEMBER, "E2E Diğer Korist", { role: "member", part: "bass" });
  // Devices, so push rows are written for both directions.
  await addDevice(reporterId);
  await addDevice(handlerId);

  // --- filing: two screenshots, one larger than 1600 px
  const korist = await loginAs(browser, REPORTER, { phone: true });
  await go(korist, `${BASE}/sorun-bildir`);
  const big = await pngFile(korist, "buyuk.png", 2400, 1800);
  const small = await pngFile(korist, "kucuk.png", 600, 900);
  await fileReport(korist, {
    title: `  ${TITLE}  `,
    body: "Ödev sayfasında Kayda başla'ya bastım, hiçbir şey olmadı.",
    files: [big, small],
  });
  const report = await one("select * from issue_reports where title = ?", [TITLE]);
  const success = await korist.locator("[data-testid=report-form] [role=status]").textContent();
  check(
    report && success === `Teşekkürler, bildirimin iletildi (Sorun #${report.number}).`,
    `the reporter sees the confirmation with the number (${success})`,
  );
  check(report?.status === "new" && report.page === "/odevler", "the report is stored trimmed, status new, page from ?from=");
  check(
    typeof report?.device === "string" && report.device.includes("ana ekran: hayır") && report.device.includes("sürüm"),
    `device summary sent (${report?.device})`,
  );
  const images = (await db.execute({ sql: "select * from issue_report_images where report_id = ? order by created_at, id", args: [report.id] })).rows;
  check(
    images.length === 2 && images.every((i) => i.content_type === "image/jpeg" && /^reports\/[0-9a-f-]{36}\.jpg$/.test(i.storage_key)),
    `two screenshots stored as JPEG under reports/ (${images.map((i) => i.content_type).join(", ")})`,
  );
  check((await Promise.all(images.map((i) => fileExists(i.storage_key)))).every(Boolean), "both files exist in the store");
  const widths = await Promise.all(images.map((i) => imageWidth(korist, i.id)));
  check(widths.includes(1600) && widths.every((w) => w > 0 && w <= 1600), `the large image was downscaled to 1600 px (${widths})`);
  const puts = Number((await one("select count(*) as n from storage_events where kind = 'put' and area is null")).n);
  check(puts >= 2, "each put is counted with area null");
  check(Number((await one("select count(*) as n from report_image_deletions where state = 'pending'")).n) === 0, "the upload holds were released");

  await korist.reload();
  const mine = korist.locator(`[data-testid=my-reports] li[data-number="${report.number}"]`);
  check((await mine.textContent())?.includes("Yeni"), "Bildirimlerim lists the report with status Yeni");

  // --- refusals at the upload route
  const text = await postImage(korist, report.id, Buffer.from("hello, this is not an image at all"));
  check(text.status === 415 && text.json?.code === "type", `a non-image is refused (${text.status})`);
  const fake = await postImage(korist, report.id, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
  check(fake.status === 415, "a PNG signature without a header is refused");
  const third = await postImage(korist, report.id, small.buffer);
  check(third.status === 201, `a third screenshot is accepted (${third.status})`);
  const fourth = await postImage(korist, report.id, small.buffer);
  check(fourth.status === 409 && fourth.json?.code === "limit", `a fourth screenshot is refused (${fourth.status} ${fourth.json?.code})`);
  check(
    Number((await one("select count(*) as n from issue_report_images where report_id = ?", [report.id])).n) === 3,
    "still exactly 3 images",
  );
  // In the form: more than 3 picked, or a non-image.
  await go(korist, `${BASE}/sorun-bildir`);
  await korist.setInputFiles("[data-testid=report-files]", [small, small, small, small]);
  await korist.locator("[data-testid=report-shots] li").nth(2).waitFor();
  await korist.locator("[data-testid=report-pick-error]").waitFor();
  check(
    (await korist.locator("[data-testid=report-shots] li").count()) === 3 &&
      (await korist.locator("[data-testid=report-pick-error]").textContent()) === "En fazla 3 ekran görüntüsü ekleyebilirsin.",
    "the form keeps 3 of 4 picked images and says why",
  );
  await go(korist, `${BASE}/sorun-bildir`);
  await korist.setInputFiles("[data-testid=report-files]", [{ name: "not.png", mimeType: "image/png", buffer: Buffer.from("not an image") }]);
  await korist.locator("[data-testid=report-pick-error]").waitFor();
  check(
    (await korist.locator("[data-testid=report-shots] li").count()) === 0 &&
      (await korist.locator("[data-testid=report-pick-error]").textContent()).startsWith("Bu dosya bir resim değil"),
    "the form refuses a file that doesn't decode as an image",
  );

  // --- privacy: another member
  const other = await loginAs(browser, OTHER_MEMBER, { phone: true });
  const otherUp = await postImage(other, report.id, small.buffer);
  check(otherUp.status === 404, "another member can't add images to the report");
  const otherGet = await getImage(other, images[0].id);
  check(otherGet.status === 404 && otherGet.size === 0, "another member gets an empty 404 for the image");
  const unknownGet = await getImage(other, crypto.randomUUID());
  check(unknownGet.status === 404 && unknownGet.size === 0, "an unknown image id is the same empty 404");
  await go(other, `${BASE}/sorun-bildir`);
  check(
    !(await other.locator("main").textContent()).includes(TITLE) &&
      (await other.locator("[data-testid=my-reports-empty]").count()) === 1,
    "another member doesn't see the report in Bildirimlerim",
  );
  const unknownPage = await status404(other, `${BASE}/boyle-bir-sayfa-yok`);
  const otherList = await status404(other, `${BASE}/sorunlar`);
  check(otherList.status === 404 && unknownPage.status === 404 && otherList.h1 === unknownPage.h1 && otherList.h1 !== "", `a member gets the unknown-page 404 on /sorunlar (${otherList.h1})`);

  // --- non-handler managers
  for (const email of [CONDUCTOR, OTHER_BOARD]) {
    const p = await loginAs(browser, email);
    const list = await status404(p, `${BASE}/sorunlar`);
    const detail = await status404(p, `${BASE}/sorunlar/${report.number}`);
    const img = await getImage(p, images[0].id);
    await go(p, `${BASE}/`);
    const navLink = await p.locator("aside a[href='/sorunlar']").count();
    const footer = await p.locator("aside a[href='/sorun-bildir']").count();
    check(
      list.status === 404 && detail.status === 404 && list.h1 === unknownPage.h1 && img.status === 404 && navLink === 0 && footer === 1,
      `${email}: 404 on /sorunlar and the detail, no image, no nav entry; sidebar footer has Sorun bildir`,
    );
    await p.context().close();
  }

  // --- the handler
  const yk = await loginAs(browser, HANDLER);
  const badge = await yk.locator("aside a[href='/sorunlar'] [data-reports-badge]").getAttribute("data-reports-badge");
  check(Number(badge) >= 1, `the handler's nav entry shows the open count (${badge})`);
  await go(yk, `${BASE}/sorunlar`);
  check(
    (await yk.locator(`[data-testid=report-list] li[data-number="${report.number}"]`).textContent()).includes("Demo Korist"),
    "the handler's list shows the report with the reporter",
  );
  await go(yk, `${BASE}/sorunlar?durum=kapali`);
  check((await yk.locator(`[data-testid=report-list] li[data-number="${report.number}"]`).count()) === 0, "Kapalı doesn't list an open report");
  await go(yk, `${BASE}/sorunlar/${report.number}`);
  const facts = await yk.locator("[data-testid=report-facts]").textContent();
  check(facts.includes("Demo Korist") && facts.includes("Alto") && facts.includes("/odevler"), `detail shows reporter, part and page (${facts.slice(0, 80)})`);
  await yk.waitForFunction(
    () => [...document.querySelectorAll("[data-testid=report-images] img")].every((i) => i.complete && i.naturalWidth > 0),
    null,
    { timeout: 10000 },
  );
  check((await yk.locator("[data-testid=report-images] img").count()) === 3, "detail shows the 3 screenshots");
  const handlerGet = await getImage(yk, images[0].id);
  check(
    handlerGet.status === 200 && handlerGet.type === "image/jpeg" && handlerGet.cache === "private, no-store",
    `the image route answers the handler with private, no-store (${handlerGet.cache})`,
  );
  const reporterGet = await getImage(korist, images[0].id);
  check(reporterGet.status === 200, "the reporter can fetch their own image");
  const gets = Number((await one("select count(*) as n from storage_events where kind = 'get' and area = 'score'")).n);
  check(gets >= 1, "deliveries are counted as non-recording (score) gets");

  const newPush = await one(`select * from notifications where kind = 'report_new' and user_id = ?`, [handlerId]);
  check(
    newPush?.title === "Yeni sorun bildirimi" &&
      newPush.body === `#${report.number} · ${TITLE} — Demo Korist` &&
      newPush.url === `/sorunlar/${report.number}` &&
      newPush.group_key === "sistem",
    `the handler got the new-report push (${newPush?.body})`,
  );
  check(!(await one(`select 1 from notifications where kind = 'report_new' and user_id = ?`, [reporterId])), "the reporter gets no new-report push");

  const reply = "Teşekkürler, bakıyorum. Mikrofon izni kapalı olabilir; Ayarlar > Safari > Mikrofon'u kontrol eder misin?";
  await yk.locator("[data-testid=report-status-form] label", { hasText: "İnceleniyor" }).click();
  await yk.fill("textarea[name=reply]", reply);
  await yk.click("[data-testid=report-status-form] button[type=submit]");
  await yk.locator("[data-testid=report-status-form] [role=status]").waitFor();
  const saved = await one("select status, reply, closed_at from issue_reports where id = ?", [report.id]);
  check(saved.status === "in_progress" && saved.reply === reply && saved.closed_at === null, "the handler saved İnceleniyor and the reply");
  const upd = await one(`select * from notifications where kind = 'report_updated' and user_id = ?`, [reporterId]);
  check(
    upd?.title === `Sorun #${report.number} güncellendi` && upd.group_key === null && upd.body.startsWith("İnceleniyor · Teşekkürler, bakıyorum.") && upd.url === "/sorun-bildir",
    `the reporter got the update push (${upd?.body})`,
  );
  await go(korist, `${BASE}/sorun-bildir`);
  const mineNow = await korist.locator(`[data-testid=my-reports] li[data-number="${report.number}"]`).textContent();
  check(mineNow.includes("İnceleniyor") && mineNow.includes("Mikrofon izni kapalı"), "the reporter sees İnceleniyor and the reply");

  // Closing sets closed_at; the reply-only save to a closed report keeps it.
  await go(yk, `${BASE}/sorunlar/${report.number}`);
  await yk.locator("[data-testid=report-status-form] label", { hasText: "Çözüldü" }).click();
  await yk.click("[data-testid=report-status-form] button[type=submit]");
  await yk.locator("[data-testid=report-status-form] [role=status]").waitFor();
  const closed = await one("select status, closed_at from issue_reports where id = ?", [report.id]);
  check(closed.status === "done" && closed.closed_at !== null, "closing sets closed_at");

  // --- rate limit: 10 reports a day
  for (let i = 0; i < 9; i++) {
    await db.execute({ sql: "insert into login_attempts (key) values (?)", args: [`report:${reporterId}`] });
  }
  const before = Number((await one("select count(*) as n from issue_reports where reporter_id = ?", [reporterId])).n);
  await fileReport(korist, { title: "E2E Onbirinci bildirim", body: "Sınırı deniyoruz." });
  const limited = await korist.locator("[data-testid=report-form] [role=alert]").textContent();
  const after = Number((await one("select count(*) as n from issue_reports where reporter_id = ?", [reporterId])).n);
  check(limited === "Bugün çok fazla bildirim gönderdin. Yarın tekrar dene." && after === before, `the 11th report of the day is refused (${limited})`);
  await db.execute("delete from login_attempts where key like 'report%'");

  // --- a second report: no images at first; uploads stop at 95% with the usual message
  await fileReport(korist, { title: "E2E İkinci bildirim", body: "Kotayı deniyoruz.", from: null });
  const second = await one("select * from issue_reports where title = 'E2E İkinci bildirim'");
  check(second && second.page === null, "without ?from= and a referrer on the same page, page stays null");
  const rows = [];
  for (let i = 0; i < 1900; i++) rows.push({ sql: "insert into storage_events (kind, bytes) values ('put', 1)", args: [] });
  for (let i = 0; i < rows.length; i += 500) await db.batch(rows.slice(i, i + 500), "write");
  const paused = await postImage(korist, second.id, small.buffer);
  check(paused.status === 503 && paused.json?.code === "quota" && paused.json.error === "Dosya alanı dolu; yeni dosya yüklenemiyor.", `at 95% the upload is refused (${paused.json?.error})`);
  await db.execute("delete from storage_events where kind = 'put' and bytes = 1");
  const ok2 = await postImage(korist, second.id, small.buffer);
  check(ok2.status === 201, "below the stop the upload works again");
  const quota = await one(`select (select coalesce(sum(size_bytes), 0) from issue_report_images) as s`);
  check(Number(quota.s) > 0, "report images have bytes counted by the storage total");
  // Origin check on the upload route.
  const cross = await fetch(`${BASE}/api/dosya/sorun?bildirim=${second.id}`, { method: "POST", body: small.buffer, headers: { Origin: "https://evil.example" } });
  check(cross.status === 403 || cross.status === 401, `a cross-site upload is refused (${cross.status})`);

  // --- retention: closed 91 days ago loses its images in the cron sweep; 10 days ago keeps them
  await db.execute({ sql: "update issue_reports set closed_at = ? where id = ?", args: [ago(91), report.id] });
  await db.execute({ sql: "update issue_reports set status = 'wontfix', closed_at = ? where id = ?", args: [ago(10), second.id] });
  const oldKeys = (await db.execute({ sql: "select storage_key from issue_report_images where report_id = ?", args: [report.id] })).rows.map((r) => r.storage_key);
  const keepKey = (await one("select storage_key from issue_report_images where report_id = ?", [second.id])).storage_key;
  const sweep = await cron("");
  check(sweep.status === 200, `the daily cron ran (${sweep.status})`);
  const left = Number((await one("select count(*) as n from issue_report_images where report_id = ?", [report.id])).n);
  const queued = (
    await db.execute({
      sql: `select state from report_image_deletions where storage_key in (${oldKeys.map(() => "?").join(",")})`,
      args: oldKeys,
    })
  ).rows;
  check(left === 0 && queued.length === 3 && queued.every((q) => q.state === "done"), `the sweep deleted the images of a report closed 91 days ago (${queued.map((q) => q.state)})`);
  check((await Promise.all(oldKeys.map(fileExists))).every((x) => !x), "their files are gone");
  check(Boolean(await one("select 1 from issue_reports where id = ? and body like 'Ödev sayfasında%'", [report.id])), "the report text stays");
  check(
    Boolean(await one("select 1 from issue_report_images where storage_key = ?", [keepKey])) && (await fileExists(keepKey)),
    "a report closed 10 days ago keeps its image",
  );
  check(
    (await yk.goto(`${BASE}/sorunlar/${report.number}`)) && (await yk.locator("main").textContent()).includes("90 gün sonra silinir"),
    "the detail of a swept report explains the missing images",
  );

  // --- IT badge: the handler only, on the member list, their detail and their own Profil
  await go(yk, `${BASE}/uyeler`);
  const itRows = await yk.locator("main li:has([data-testid=it-badge])").allTextContents();
  check(itRows.length === 1 && itRows[0].includes("Demo Yönetim"), `the member list marks only the IT user (${itRows.length})`);
  await go(yk, `${BASE}/uyeler/${handlerId}`);
  check((await yk.locator("h1 [data-testid=it-badge]").textContent()) === "ITIT sorumlusu", "the member detail shows IT with its spoken label");
  await go(yk, `${BASE}/profil`);
  check((await yk.locator("main [data-testid=it-badge]").count()) === 1, "the IT user's Profil shows the badge");
  await go(korist, `${BASE}/profil`);
  check((await korist.locator("main [data-testid=it-badge]").count()) === 0, "a member's Profil has no IT badge");

  // --- release push: only IT, once per commit, never without a commit
  const health = (cookie) =>
    fetch(`${BASE}/api/saglik`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.status);
  const releases = async () => (await db.execute("select * from notifications where kind = 'release'")).rows;
  check((await health(null)) === 200, "the health probe answers without a commit");
  await new Promise((r) => setTimeout(r, 800));
  check((await releases()).length === 0 && !(await one("select 1 from notification_state where key = 'surum'")), "no commit (dev): no release push, nothing recorded");
  const sha = "abcdef0123456789abcdef0123456789abcdef01";
  const cookie = `arkhe_e2e_commit=${sha}; arkhe_e2e_commit_message=${encodeURIComponent("Sorun bildirimi eklendi\n\nAyrıntılar")}`;
  const statuses = await Promise.all([health(cookie), health(cookie)]);
  await until(async () => (await releases()).length >= 1);
  await new Promise((r) => setTimeout(r, 800));
  await health(cookie);
  await new Promise((r) => setTimeout(r, 800));
  const rel = await releases();
  check(
    statuses.every((x) => x === 200) && rel.length === 1 && rel[0].user_id === handlerId && rel[0].group_key === "sistem" &&
      rel[0].title === "Canlıya çıktı" && rel[0].url === "/" && rel[0].dedupe_key === "surum-abcdef0",
    `three probes of one build: one release push, to the IT user only (${rel.length})`,
  );
  check(rel[0]?.body === "Yeni sürüm canlıda · abcdef0 · Sorun bildirimi eklendi", `release body names the commit (${rel[0]?.body})`);
  await health(`arkhe_e2e_commit=1234567fedcba`);
  await until(async () => (await releases()).length >= 2);
  const rel2 = await releases();
  check(rel2.length === 2 && rel2.every((r) => r.user_id === handlerId), "a new build announces again; non-IT users never get it");

  for (const p of [korist, other, yk]) await p.context().close();
  // Leave nothing for the storage suites that sum the store by hand.
  await db.execute("delete from issue_reports where title like 'E2E%'");
  await cron("");
  await reset();
  await resetPush();
}
