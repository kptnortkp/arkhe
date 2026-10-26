import { BASE, actionIds, callAction, check, db, loginAs, userId } from "./lib.mjs";
import { insertAssignment, uploadRaw, wavBytes } from "./media.mjs";
import { addDevice, resetPush } from "./push.mjs";

const HW_ACTIONS = "src/app/(portal)/odevler/actions.ts";
const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
const row = (page, id) => page.locator(`[data-testid=homework-row][data-id="${id}"]`);

async function notified(kind, assignmentId) {
  for (let i = 0; i < 20; i++) {
    const rows = (
      await db.execute({
        sql: "select title from notifications where kind = ? and tag = ?",
        args: [kind, `odev-${assignmentId}`],
      })
    ).rows;
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

export default async function phase4bCancel(browser) {
  const sef = await loginAs(browser, "sef@arkhe.local");
  const korist = await loginAs(browser, "korist@arkhe.local", { mobile: true });
  const { id } = await insertAssignment({ dueDays: 3, title: "E2E İptal Eseri" });
  await addDevice(await userId("korist@arkhe.local"));

  // The conductor cancels from the menu.
  await sef.goto(`${BASE}/odevler/${id}`);
  await sef.getByRole("button", { name: "Diğer işlemler" }).click();
  await sef.getByRole("menuitem", { name: "İptal et" }).click();
  await sef.getByRole("alertdialog").getByRole("button", { name: "İptal et" }).click();
  await sef.getByTestId("cancelled-note").waitFor();
  check(
    (await one("select cancelled_at, cancelled_by from assignments where id = ?", [id]))
      .cancelled_by === (await userId("sef@arkhe.local")),
    "cancel: İptal et records who cancelled",
  );
  check(
    (await notified("homework_cancelled", id)).some((n) => n.title === "Ödev iptal"),
    "cancel: singers who owe it get Ödev iptal",
  );
  await sef.goto(`${BASE}/odevler`);
  check(
    (await row(sef, id).getByTestId("deadline-badge").textContent()).includes("İptal edildi"),
    "cancel: the manager list shows İptal edildi",
  );

  // The singer sees it as cancelled, with nothing to do.
  await korist.goto(`${BASE}/odevler`);
  const cancelledRow = korist.locator(`[data-testid=cancelled-list] [data-id="${id}"]`);
  check(
    (await cancelledRow.getByTestId("deadline-badge").textContent()).includes("İptal edildi") &&
      (await cancelledRow.getByTestId("record-link").count()) === 0 &&
      (await korist.locator(`[data-testid=todo-list] [data-id="${id}"]`).count()) === 0,
    "cancel: the singer sees it under İptal edilenler with no Kaydını yap",
  );
  await korist.goto(`${BASE}/odevler/${id}`);
  check(
    (await korist.getByTestId("cancelled-note").textContent()).includes(
      "Kayıt göndermene gerek yok",
    ) && (await korist.getByTestId("singer-card").count()) === 0,
    "cancel: the homework page says it was cancelled and hides the recorder",
  );
  await korist.goto(`${BASE}/`);
  check(
    (await korist.locator(`[data-testid=home-homework] [data-id="${id}"]`).count()) === 0,
    "cancel: it leaves the home Ödevlerim card",
  );

  // The server refuses submissions too.
  const upload = await uploadRaw(korist, id, wavBytes({ seconds: 1 }), { durationMs: 1000 });
  check(upload.status === 409, "cancel: an upload is refused with 409");
  const ids = await actionIds(HW_ACTIONS, id);
  await callAction(korist, ids.submitAssignment, [id]);
  check(
    !(await one("select 1 from submissions where assignment_id = ? and submitted_at is not null", [
      id,
    ])),
    "cancel: Teslim ettim is refused",
  );
  await callAction(korist, ids.setAssignmentCancelled, [id, false]);
  check(
    (await one("select cancelled_at from assignments where id = ?", [id])).cancelled_at !== null,
    "cancel: a member cannot undo it",
  );

  // Undo brings it back.
  await sef.goto(`${BASE}/odevler/${id}`);
  await sef.getByRole("button", { name: "Diğer işlemler" }).click();
  await sef.getByRole("menuitem", { name: "İptali geri al" }).click();
  await sef.getByTestId("cancelled-note").waitFor({ state: "detached" });
  check(
    (await notified("homework_restored", id)).some((n) => n.title === "Ödev yeniden açıldı"),
    "cancel: undo sends Ödev yeniden açıldı",
  );
  await korist.goto(`${BASE}/odevler`);
  check(
    (await korist
      .locator(`[data-testid=todo-list] [data-id="${id}"] [data-testid=record-link]`)
      .count()) === 1,
    "cancel: after undo it is back under Yapılacak with Kaydını yap",
  );

  await resetPush();
  for (const page of [sef, korist]) await page.context().close();
}
