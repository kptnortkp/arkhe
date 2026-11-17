// Fixes from singers' issue reports: "Tamam" on a feature-note announcement, the Android file
// picker for a saved recording, and the singer's optional note to the conductor.
import { createHash } from "node:crypto";
import { HOMEWORK_IDS, seedHomework } from "../scripts/homework-fixture.mjs";
import { reconcileLocalUploads } from "../scripts/media-fixture.mjs";
import { BASE, check, db, istanbulDate, loginAs, userId } from "./lib.mjs";
import { insertTake } from "./media.mjs";

const { a: A, c: C } = HOMEWORK_IDS;
const KORIST = "korist@arkhe.local";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

export default async function run(browser) {
  await seedHomework(db, new Date());
  await reconcileLocalUploads(db);
  try {
    await featureNoteDismiss(browser);
    await androidPicker(browser);
    await singerNote(browser);
  } finally {
    await db.execute("delete from announcements where title like 'E2E %'");
    await seedHomework(db, new Date());
  }
}

async function featureNoteDismiss(browser) {
  // Feature notes get hash-shaped ids without RFC version bits.
  const h = createHash("sha256").update(`e2e-${Date.now()}`).digest("hex");
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-3${h.slice(13, 16)}-3${h.slice(17, 20)}-${h.slice(20, 32)}`;
  await db.execute({
    sql: `insert into announcements (id, title, body, audience, created_by, show_until)
          values (?, 'E2E Yeni: özellik notu', 'Gövde', 'all', ?, ?)`,
    args: [id, await userId("sef@arkhe.local"), istanbulDate(3)],
  });
  const page = await loginAs(browser, KORIST, { phone: true });
  const card = page.locator(`[data-testid=home-announcement][data-id="${id}"]`);
  check((await card.count()) === 1, "a feature note shows on the singer's home");
  await card.getByRole("button", { name: /Tamam/ }).click();
  await page.waitForTimeout(1500);
  const read = await db.execute({
    sql: "select 1 from announcement_reads where announcement_id = ? and user_id = ?",
    args: [id, await userId(KORIST)],
  });
  await page.reload();
  check(
    read.rows.length === 1 && (await card.count()) === 0,
    "Tamam marks a feature note read and it stays gone after a reload",
  );
  await page.context().close();
}

async function androidPicker(browser) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const android = await loginAs(browser, KORIST, { phone: true, context: { userAgent: ANDROID_UA } });
  await android.goto(`${BASE}/odevler/${C}`);
  const [chooser] = await Promise.all([
    android.waitForEvent("filechooser"),
    android.getByRole("button", { name: "Dosya yükle", exact: true }).click(),
  ]);
  const accept = await android.locator("[data-testid=recording-file]").getAttribute("accept");
  check(accept === null, "on Android the picker has no audio-only filter, so saved files show");
  await chooser.setFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
  check(
    await android
      .getByRole("alert")
      .filter({ hasText: "ses kaydı değil" })
      .isVisible({ timeout: 5000 })
      .catch(() => false),
    "a picked photo is refused before upload",
  );
  await android.context().close();

  const desktop = await loginAs(browser, KORIST);
  await desktop.goto(`${BASE}/odevler/${C}`);
  const [chooser2] = await Promise.all([
    desktop.waitForEvent("filechooser"),
    desktop.getByRole("button", { name: "Dosya yükle", exact: true }).click(),
  ]);
  const accept2 = await desktop.locator("[data-testid=recording-file]").getAttribute("accept");
  check(Boolean(accept2?.startsWith("audio/*")), "elsewhere the picker still filters to audio");
  await chooser2.setFiles([]);
  await desktop.context().close();
}

async function singerNote(browser) {
  await insertTake({ assignmentId: A, email: KORIST });
  const korist = await userId(KORIST);
  const sef = await userId("sef@arkhe.local");
  const note = "E2E 12. ölçüdeki girişten emin değilim.";

  const page = await loginAs(browser, KORIST, { phone: true });
  await page.goto(`${BASE}/odevler/${A}`);
  await page.getByTestId("singer-note-open").click();
  await page.getByLabel("Şefe not (isteğe bağlı)").fill(note);
  await page.getByRole("button", { name: "Notu kaydet" }).click();
  await page.getByTestId("singer-note").waitFor({ timeout: 10000 }).catch(() => {});
  const saved = await db.execute({
    sql: "select singer_note from submissions where assignment_id = ? and user_id = ?",
    args: [A, korist],
  });
  check(saved.rows[0]?.singer_note === note, "the singer saves a note with their submission");
  check(
    (await page.getByTestId("singer-note").textContent())?.includes(note),
    "the singer sees their note on the homework",
  );

  const conductor = await loginAs(browser, "sef@arkhe.local");
  await conductor.goto(`${BASE}/odevler/${A}/dinle/${korist}`);
  check(
    (await conductor.getByTestId("review-singer-note").textContent())?.includes(note),
    "the conductor reads the note while listening",
  );
  await conductor.context().close();

  await db.execute({
    sql: `update submissions set feedback = 'E2E yorum', feedback_by = ?, feedback_at = unixepoch()
          where assignment_id = ? and user_id = ?`,
    args: [sef, A, korist],
  });
  await page.reload();
  check(
    (await page.getByTestId("singer-note").count()) === 1 &&
      (await page.getByRole("button", { name: "Notu düzenle" }).count()) === 0,
    "after the conductor's comment the note stays but can't be changed",
  );
  await page.context().close();
}
