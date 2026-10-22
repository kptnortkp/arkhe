// Phase 10 B: who gets what for every trigger, morning lines, system alerts, privacy (AC 7, 8, 24–46).
import { mkdirSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { BASE, check, db, insertRehearsal, istanbulDate, userId } from "./lib.mjs";
import { as, actionIds, BOARD_ACTIONS, BUDGET_ACTIONS, callAction, callForm, goto, scalar } from "./board.mjs";
import { cron, resetBackup, setRecipients } from "./mail.mjs";
import { addDevice, at, dispatch, outboxSince, removeOutbox, resetPush, ROOT, rowsOf, setPref, until } from "./push.mjs";

const REH_ACTIONS = "src/app/(portal)/calismalar/actions.ts";
const HW_ACTIONS = "src/app/(portal)/odevler/actions.ts";
const MARK = "E2EGIZLI";

let byId = new Map();
const emailsOf = (entries) => new Set(entries.map((e) => byId.get(e.userId)).filter(Boolean));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const kindSince = (since, kind) => outboxSince(since).filter((e) => e.kind === kind);

async function people() {
  const rows = (await db.execute("select id, email, role, voice_part as part from users where is_active = 1")).rows;
  byId = new Map(rows.map((r) => [r.id, r.email]));
  return rows;
}

async function waitKind(since, kind, n = 1) {
  return until(() => kindSince(since, kind).length >= n);
}

async function attendance(browser, all) {
  // AC 24: a soprano+tenor sectional opened by yk@ (soprano, board); one tenor already excused.
  const id = await insertRehearsal({ title: "E2E Push Sectional", startOffsetMin: 30, type: "sectional", parts: ["soprano", "tenor"] });
  const can = await userId("can.erdogan@arkhe.local");
  await db.execute({
    sql: "insert into attendance (rehearsal_id, user_id, status, method, note, recorded_by) values (?, ?, 'excused', 'self', ?, ?)",
    args: [id, can, `${MARK} hasta`, can],
  });
  const yk = await as(browser, "yk@arkhe.local");
  const ids = await actionIds(REH_ACTIONS, id);
  const since = Date.now();
  await callAction(yk, ids.openAttendance, [id]);
  await waitKind(since, "attendance_open", 5);
  await new Promise((r) => setTimeout(r, 500));
  const got = emailsOf(kindSince(since, "attendance_open"));
  const want = new Set(
    all.filter((u) => ["soprano", "tenor"].includes(u.part) && u.role !== "conductor" && u.email !== "yk@arkhe.local" && u.id !== can).map((u) => u.email),
  );
  check(sameSet(got, want), `AC24 Yoklama açıldı reaches expected sopranos+tenors minus opener and excused (${got.size}/${want.size})`);
  const one = kindSince(since, "attendance_open")[0];
  check(
    one?.payload.title === "Yoklama açıldı" && one.payload.url === "/yoklama" && one.payload.tag === `yoklama-${id}` &&
      one.payload.body.endsWith("Yoklamaya katılmak için dokun."),
    "AC24 title, url and tag",
  );
  const again = Date.now();
  await callAction(yk, ids.openAttendance, [id]);
  await new Promise((r) => setTimeout(r, 800));
  check(kindSince(again, "attendance_open").length === 0, "AC24 a second open sends nothing");
  await yk.context().close();
  return id;
}

async function rehearsals(browser, all) {
  const sef = await as(browser, "sef@arkhe.local");
  const sample = await insertRehearsal({ title: "E2E Push Sample", startOffsetMin: 3 * 24 * 60 });
  const ids = await actionIds(REH_ACTIONS, sample);
  const members = new Set(all.filter((u) => u.role !== "conductor").map((u) => u.email));

  // AC 27: single and weekly series.
  let since = Date.now();
  const day = istanbulDate(10);
  await callForm(sef, ids.createRehearsal, [], { type: "tutti", title: "E2E Push Tek", location: "E2E Salon", date: day, start: "19:30", end: "22:00" });
  await waitKind(since, "rehearsal_new", members.size);
  check(sameSet(emailsOf(kindSince(since, "rehearsal_new")), members), "AC27 a single future rehearsal notifies each expected person once");
  since = Date.now();
  await callForm(sef, ids.createRehearsal, [], {
    type: "tutti",
    title: "E2E Push Seri",
    date: istanbulDate(14),
    start: "19:30",
    end: "22:00",
    repeat: "on",
    repeatUntil: istanbulDate(14 + 7 * 7),
  });
  await waitKind(since, "rehearsal_new", members.size);
  const series = kindSince(since, "rehearsal_new");
  check(
    series.length === members.size && series.every((e) => e.payload.url === "/calismalar" && e.payload.body.includes(" · her ")),
    `AC27 a series of 8 sends one notification per person (${series.length})`,
  );
  since = Date.now();
  const yesterday = istanbulDate(0);
  await callForm(sef, ids.createRehearsal, [], { type: "tutti", title: "E2E Push Geçmiş", date: yesterday, start: "00:05", end: "00:30" });
  await new Promise((r) => setTimeout(r, 800));
  check(kindSince(since, "rehearsal_new").length === 0, "AC27 a rehearsal starting in the past sends nothing");

  // AC 28: changed.
  const sect = await insertRehearsal({ title: "E2E Push Değişen", startOffsetMin: 5 * 24 * 60, type: "sectional", parts: ["soprano"] });
  await db.execute({ sql: "update rehearsals set starts_at = starts_at - starts_at % 60, ends_at = ends_at - ends_at % 60 where id = ?", args: [sect] });
  const r = (await db.execute({ sql: "select starts_at, ends_at from rehearsals where id = ?", args: [sect] })).rows[0];
  const fmt = (s) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(s) * 1000));
  const dateOf = (s) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(Number(s) * 1000));
  const sectIds = await actionIds(REH_ACTIONS, sect);
  since = Date.now();
  await callForm(sef, sectIds.updateRehearsal, [sect], { type: "sectional", title: "E2E Push Değişen 2", location: "E2E Salon", date: dateOf(r.starts_at), start: fmt(r.starts_at), end: fmt(r.ends_at), parts: "soprano" });
  await new Promise((r) => setTimeout(r, 800));
  check(kindSince(since, "rehearsal_changed").length === 0, "AC28 a title-only edit sends nothing");
  since = Date.now();
  await sef.evaluate(() => {});
  const fd = { type: "sectional", title: "E2E Push Değişen 2", location: "E2E Salon", date: dateOf(r.starts_at), start: "18:00", end: "21:00" };
  await sef.evaluate(
    async ({ id, path, fields }) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.append(`_1_${k}`, v);
      f.append("_1_parts", "soprano");
      f.append("_1_parts", "alto");
      f.append("0", JSON.stringify([fields.rid, {}, "$K1"]));
      await fetch(path, { method: "POST", headers: { "Next-Action": id, Accept: "text/x-component" }, body: f });
    },
    { ...sectIds.updateRehearsal, fields: { ...fd, rid: sect } },
  );
  const sa = new Set(all.filter((u) => ["soprano", "alto"].includes(u.part) && u.role !== "conductor").map((u) => u.email));
  await waitKind(since, "rehearsal_changed", sa.size);
  const changed = kindSince(since, "rehearsal_changed");
  check(
    sameSet(emailsOf(changed), sa) && changed.every((e) => e.payload.tag === `calisma-${sect}` && e.payload.body.includes("artık")),
    `AC28 time + Soprano→Soprano+Alto reaches the union (${changed.length}/${sa.size})`,
  );

  // AC 29: cancel, undo, past, end series.
  since = Date.now();
  await callAction(sef, sectIds.setCancelled, [sect, true]);
  await waitKind(since, "rehearsal_cancelled", sa.size);
  check(kindSince(since, "rehearsal_cancelled")[0]?.payload.title === "Çalışma iptal", "AC29 İptal et sends Çalışma iptal");
  since = Date.now();
  await callAction(sef, sectIds.setCancelled, [sect, false]);
  await waitKind(since, "rehearsal_restored", sa.size);
  check(kindSince(since, "rehearsal_restored")[0]?.payload.title === "Çalışma yeniden programda", "AC29 İptali geri al sends Çalışma yeniden programda");
  const past = await insertRehearsal({ title: "E2E Push Geçti", startOffsetMin: -600 });
  since = Date.now();
  await callAction(sef, (await actionIds(REH_ACTIONS, past)).setCancelled, [past, true]);
  await new Promise((r) => setTimeout(r, 800));
  check(kindSince(since, "rehearsal_cancelled").length === 0, "AC29 cancelling a past rehearsal sends nothing");
  const seriesRows = (await db.execute("select id from rehearsals where title = 'E2E Push Seri' order by starts_at")).rows;
  const fourthFromEnd = seriesRows[seriesRows.length - 4].id;
  since = Date.now();
  await callAction(sef, (await actionIds(REH_ACTIONS, fourthFromEnd)).endSeries, [fourthFromEnd]);
  await waitKind(since, "series_ended", members.size);
  const ended = kindSince(since, "series_ended");
  check(
    ended.length === members.size && ended.every((e) => e.payload.title === "Haftalık çalışmalar bitti" && e.payload.body.includes(" 3 çalışma")),
    `AC29 Seriyi bitir (3 future) sends one notification per person with 3 (${ended.length})`,
  );
  await sef.context().close();
}

async function absent(browser) {
  // AC 30: off by default; on for korist@ only.
  const kId = await userId("korist@arkhe.local");
  const id = await insertRehearsal({ title: "E2E Push Yoklama", startOffsetMin: -20 });
  await db.execute({ sql: "update rehearsals set opened_at = unixepoch() - 600 where id = ?", args: [id] });
  await db.execute({
    sql: "insert into attendance (rehearsal_id, user_id, status, method, recorded_by) select ?, id, 'present', 'manual', id from users where email = 'nazli.koc@arkhe.local'",
    args: [id],
  });
  await setPref(kId, "devamsizlik", true);
  const sef = await as(browser, "sef@arkhe.local");
  const since = Date.now();
  await callAction(sef, (await actionIds(REH_ACTIONS, id)).closeAttendance, [id]);
  await waitKind(since, "absent");
  await new Promise((r) => setTimeout(r, 500));
  const got = kindSince(since, "absent");
  check(
    got.length === 1 && byId.get(got[0].userId) === "korist@arkhe.local" && got[0].payload.body.endsWith("Mazeretin varsa yoklamayı alana ilet."),
    `AC30 only korist@ (switch on, auto-absent) gets Gelmedi olarak kaydedildin (${got.length})`,
  );
  await sef.context().close();
}

async function homework(browser, all) {
  const yk = await as(browser, "yk@arkhe.local");
  const hw = await actionIds(HW_ACTIONS, "x");
  const piece = await scalar("select id from pieces where status <> 'archive' order by created_at limit 1");
  const id = crypto.randomUUID();
  let since = Date.now();
  await yk.evaluate(
    async ({ id: actionId, path, aid, piece, due }) => {
      const f = new FormData();
      const fields = { id: aid, pieceId: piece, dueDate: due, dueTime: "20:00", description: "E2E push ödev" };
      for (const [k, v] of Object.entries(fields)) f.append(`_1_${k}`, v);
      f.append("_1_parts", "alto");
      f.append("_1_parts", "tenor");
      f.append("0", JSON.stringify([{}, "$K1"]));
      await fetch(path, { method: "POST", headers: { "Next-Action": actionId, Accept: "text/x-component" }, body: f });
    },
    { ...hw.createAssignment, aid: id, piece, due: istanbulDate(6) },
  );
  const want = new Set(all.filter((u) => ["alto", "tenor"].includes(u.part) && u.role !== "conductor" && u.email !== "yk@arkhe.local").map((u) => u.email));
  await waitKind(since, "homework_new", want.size);
  check(sameSet(emailsOf(kindSince(since, "homework_new")), want), `AC31 Yeni ödev reaches active altos and tenors only (${kindSince(since, "homework_new").length}/${want.size})`);
  await yk.context().close();

  // AC 33: first comment, edit, delete + resend.
  const sef = await as(browser, "sef@arkhe.local");
  const kId = await userId("korist@arkhe.local");
  const ids = await actionIds(HW_ACTIONS, id);
  since = Date.now();
  await callForm(sef, ids.saveFeedback, [id, kId], { feedback: `${MARK} yorum`, recordingId: "" });
  await waitKind(since, "feedback");
  const first = kindSince(since, "feedback");
  check(first.length === 1 && byId.get(first[0].userId) === "korist@arkhe.local" && first[0].payload.title === "Şeften yorum var", "AC33 the first comment notifies the singer only");
  since = Date.now();
  await callForm(sef, ids.saveFeedback, [id, kId], { feedback: `${MARK} yorum düzeltildi`, recordingId: "" });
  await new Promise((r) => setTimeout(r, 800));
  check(kindSince(since, "feedback").length === 0, "AC33 editing the comment sends nothing");
  await callForm(sef, ids.saveFeedback, [id, kId], { feedback: "", recordingId: "" });
  since = Date.now();
  await callForm(sef, ids.saveFeedback, [id, kId], { feedback: `${MARK} yeni yorum`, recordingId: "" });
  await waitKind(since, "feedback");
  check(kindSince(since, "feedback").length === 1, "AC33 delete then resend notifies again");
  await sef.context().close();
  return id;
}

async function board(browser) {
  const yk = await as(browser, "yk@arkhe.local");
  const sef = await as(browser, "sef@arkhe.local");
  const sefId = await userId("sef@arkhe.local");
  const ids = await actionIds(BOARD_ACTIONS);
  const create = (page, fields) =>
    callForm(page, ids.createTicket, [], { id: crypto.randomUUID(), title: "E2E Push iş", description: `${MARK} açıklama`, assigneeId: "", dueOn: "", status: "todo", urgency: "medium", ...fields });
  const numberOf = async (title) => Number(await scalar("select number from board_tickets where title = ? order by number desc limit 1", [title]));

  let since = Date.now();
  await create(yk, { title: "E2E Push yüksek", urgency: "high" });
  await waitKind(since, "ticket_new");
  await new Promise((r) => setTimeout(r, 500));
  const nw = kindSince(since, "ticket_new");
  check(nw.length === 1 && byId.get(nw[0].userId) === "sef@arkhe.local" && nw[0].payload.title.startsWith("Yeni iş #"), "AC37 a new ticket reaches the other managers, not the author or members");

  // AC 38: urgent at 23:30 with quiet hours on bypasses them, Urgency high.
  await setPref(sefId, "gece", true);
  await yk.context().addCookies([{ name: "arkhe_e2e_clock", value: at(istanbulDate(0), "23:30"), url: BASE }]);
  since = Date.now();
  await create(yk, { title: "E2E Push acil", urgency: "urgent", assigneeId: sefId });
  await waitKind(since, "ticket_urgent");
  await new Promise((r) => setTimeout(r, 500));
  const urgent = outboxSince(since).filter((e) => e.userId === sefId);
  check(
    urgent.length === 1 && urgent[0].kind === "ticket_urgent" && urgent[0].urgency === "high" && urgent[0].payload.title.startsWith("Acil iş #"),
    "AC38/39 an urgent ticket assigned to sef at 23:30 gives only Acil iş, urgency high, at once",
  );
  await yk.context().clearCookies({ name: "arkhe_e2e_clock" });

  // AC 39: assignment by edit; AC 40 comment; AC 41 move.
  const n = await numberOf("E2E Push yüksek");
  const row = (await db.execute({ sql: "select * from board_tickets where number = ?", args: [n] })).rows[0];
  since = Date.now();
  await callForm(yk, ids.updateTicket, [n], { title: row.title, description: row.description ?? "", assigneeId: sefId, urgency: "high", dueOn: "", revision: String(row.revision) });
  await waitKind(since, "ticket_assigned");
  check(byId.get(kindSince(since, "ticket_assigned")[0]?.userId) === "sef@arkhe.local", "AC39 changing the assignee notifies the new assignee");
  since = Date.now();
  await callForm(sef, ids.addComment, [n], { clientKey: crypto.randomUUID(), body: `${MARK} yorum` });
  await waitKind(since, "ticket_comment");
  await new Promise((r) => setTimeout(r, 400));
  const com = kindSince(since, "ticket_comment");
  check(com.length === 1 && byId.get(com[0].userId) === "yk@arkhe.local", "AC40 a comment reaches the author and assignee, never the commenter");
  since = Date.now();
  await callAction(sef, ids.moveTicket, [{ number: n, from: "todo", to: "in_progress" }]);
  await callAction(sef, ids.moveTicket, [{ number: n, from: "in_progress", to: "blocked" }]);
  await waitKind(since, "ticket_moved");
  await new Promise((r) => setTimeout(r, 400));
  const mv = kindSince(since, "ticket_moved");
  check(mv.length === 1 && mv[0].payload.title === `#${n} Takıldı` && byId.get(mv[0].userId) === "yk@arkhe.local", "AC41 only the move to Takıldı notifies the author");

  // AC 38: raising to Acil by yk; sef with Yönetim işleri off gets nothing.
  await setPref(sefId, "yonetim", false);
  const r2 = (await db.execute({ sql: "select * from board_tickets where number = ?", args: [n] })).rows[0];
  since = Date.now();
  await callForm(yk, ids.updateTicket, [n], { title: r2.title, description: r2.description ?? "", assigneeId: sefId, urgency: "urgent", dueOn: "", revision: String(r2.revision) });
  await new Promise((r) => setTimeout(r, 1000));
  check(kindSince(since, "ticket_urgent").length === 0, "AC38 Yönetim işleri off wins over urgency");
  await setPref(sefId, "yonetim", true);
  await yk.context().close();
  await sef.context().close();
}

async function budget(browser) {
  const yk = await as(browser, "yk@arkhe.local");
  const sef = await as(browser, "sef@arkhe.local");
  const ids = await actionIds(BUDGET_ACTIONS);
  const id = crypto.randomUUID();
  let since = Date.now();
  await callForm(yk, ids.createBudget, [], { id, name: "E2E Push Bütçe", start: "2034-01", note: `${MARK} not` });
  await waitKind(since, "budget_new");
  const nw = kindSince(since, "budget_new");
  check(nw.length === 1 && byId.get(nw[0].userId) === "sef@arkhe.local" && nw[0].payload.body.includes("Onay bekliyor."), "AC44 a new draft reaches the other managers");
  await db.execute({ sql: "insert into budget_lines (budget_id, category, amount_kurus) values (?, 'dues', 123456)", args: [id] });
  const rev = await scalar("select revision from budgets where id = ?", [id]);
  since = Date.now();
  await callAction(sef, (await actionIds(BUDGET_ACTIONS, id)).approveBudget, [id, Number(rev)]);
  await waitKind(since, "budget_approved");
  const ap = kindSince(since, "budget_approved");
  check(ap.length === 1 && byId.get(ap[0].userId) === "yk@arkhe.local", "AC44 an approval reaches the others, not the approver");
  // 20c: a revision of the approved plan, with a reason; no amount and no reason in the payload.
  const CATS = ["dues", "sponsorship", "tickets", "donation", "grant", "other_income", "costume", "venue", "musician_fee", "scores_royalties", "travel", "festival_fee", "organisation", "catering", "refund", "bank_fee", "other_expense"];
  const plan = Object.fromEntries(CATS.map((c) => [c, c === "dues" ? "2.345,67" : ""]));
  const rev2 = await scalar("select revision from budgets where id = ?", [id]);
  since = Date.now();
  await callForm(sef, (await actionIds(BUDGET_ACTIONS, id)).savePlan, [id], { ...plan, revision: String(rev2), reason: `${MARK} gerekçe` });
  await waitKind(since, "budget_revised");
  const rv = kindSince(since, "budget_revised");
  check(
    rv.length === 1 && byId.get(rv[0].userId) === "yk@arkhe.local" && rv[0].payload.title === "Bütçe değişti" && rv[0].payload.body.endsWith("planı değiştirdi."),
    "AC44 a revised approved plan reaches the others as Bütçe değişti",
  );
  await yk.context().close();
  await sef.context().close();
  return id;
}

async function faults(browser) {
  // AC 8: with the sender throwing, the action still succeeds; rows stay for a retry.
  const id = await insertRehearsal({ title: "E2E Push Fault", startOffsetMin: 4 * 24 * 60 });
  const sef = await as(browser, "sef@arkhe.local");
  await sef.context().addCookies([{ name: "arkhe_e2e_push_fault", value: "throw", url: BASE }]);
  const res = await callAction(sef, (await actionIds(REH_ACTIONS, id)).setCancelled, [id, true]);
  check(res.includes("Çalışma iptal edildi.") && (await scalar("select cancelled_at is not null from rehearsals where id = ?", [id])) === 1, "AC8 setCancelled succeeds while every send throws");
  await new Promise((r) => setTimeout(r, 1500));
  const rows = await rowsOf("kind = 'rehearsal_cancelled' and dedupe_key like ?", [`iptal-${id}-%`]);
  check(rows.length > 0 && rows.every((r) => r.status === "pending" && Number(r.attempts) === 1), "AC8 the rows stay pending for a retry");
  await sef.context().close();
}

async function morning(all) {
  // AC 25, 26, 32, 34, 35, 42 on tomorrow's morning run.
  const d = istanbulDate(1);
  const tutti = crypto.randomUUID();
  const bass = crypto.randomUUID();
  const cancelled = crypto.randomUUID();
  const concert = crypto.randomUUID();
  const ts = (day, time) => Math.floor(Date.parse(at(day, time)) / 1000);
  for (const [id, type, title, day, time, cancel] of [
    [tutti, "tutti", "E2E Push Bugün", d, "19:00", false],
    [bass, "sectional", "E2E Push Bas", d, "17:00", false],
    [cancelled, "tutti", "E2E Push İptal", d, "20:00", true],
    [concert, "concert", "E2E Push Konser", istanbulDate(2), "20:00", false],
  ]) {
    await db.execute({
      sql: "insert into rehearsals (id, type, title, location, starts_at, ends_at, cancelled_at) values (?, ?, ?, 'E2E Salon', ?, ?, ?)",
      args: [id, type, title, ts(day, time), ts(day, time) + 7200, cancel ? ts(d, "00:00") - 86400 : null],
    });
  }
  await db.execute({ sql: "insert into rehearsal_parts values (?, 'bass')", args: [bass] });
  // Homework due 2 days after the run day, alto only; one alto already submitted.
  const piece = await scalar("select id from pieces where status <> 'archive' order by created_at limit 1");
  const due2 = crypto.randomUUID();
  await db.execute({ sql: "insert into assignments (id, piece_id, due_at, description, created_at, updated_at) values (?, ?, ?, 'E2E push due', unixepoch() - 86400, unixepoch())", args: [due2, piece, ts(istanbulDate(3), "21:00")] });
  await db.execute({ sql: "insert into assignment_parts values (?, 'alto')", args: [due2] });
  const nazli = await userId("nazli.koc@arkhe.local");
  await db.execute({ sql: "insert into submissions (assignment_id, user_id, submitted_at, method) values (?, ?, unixepoch(), 'self')", args: [due2, nazli] });
  // Tickets for yk@: 1 today, 1 tomorrow, 2 overdue, 1 overdue but done.
  const ykId = await userId("yk@arkhe.local");
  const maxN = Number(await scalar("select coalesce(max(number), 0) from board_tickets"));
  const tix = [[d, "todo"], [istanbulDate(2), "todo"], [istanbulDate(-3), "todo"], [istanbulDate(-1), "in_progress"], [istanbulDate(-2), "done"]];
  for (let i = 0; i < tix.length; i++) {
    const [due, status] = tix[i];
    await db.execute({
      sql: `insert into board_tickets (id, number, title, status, urgency, assignee_id, due_on, done_at, created_by)
            values (?, ?, 'E2E Push due', ?, 'medium', ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), maxN + 100 + i, status, ykId, due, status === "done" ? Math.floor(Date.now() / 1000) : null, ykId],
    });
  }
  await db.execute("delete from notification_state where key like 'sabah-%'");
  await dispatch(`?simdi=${encodeURIComponent(at(d, "08:20"))}`);
  const rows = await rowsOf("created_at >= ?", [ts(d, "08:00")]);
  const of = (kind) => rows.filter((r) => r.kind === kind);
  const emails = (list) => new Set(list.map((r) => byId.get(r.user_id)));
  const expectedTutti = new Set(all.map((u) => u.email));
  check(sameSet(emails(of("rehearsal_today").filter((r) => r.url === `/calismalar/${tutti}`)), expectedTutti), "AC25 today's tutti: every expected member plus the conductor");
  const bassWant = new Set(all.filter((u) => u.part === "bass" || u.role === "conductor").map((u) => u.email));
  check(sameSet(emails(of("rehearsal_today").filter((r) => r.url === `/calismalar/${bass}`)), bassWant), "AC25 a sectional reaches only its part (and the conductor)");
  check(!of("rehearsal_today").some((r) => r.url === `/calismalar/${cancelled}`), "AC25 a cancelled rehearsal reaches nobody");
  check(of("concert_tomorrow").some((r) => r.url === `/calismalar/${concert}` && r.title === "Yarın konser"), "AC26 Yarın konser on the day before a concert");
  const due = of("homework_due2").filter((r) => r.url === `/odevler/${due2}#kayit`);
  const altoWant = new Set(all.filter((u) => u.part === "alto" && u.id !== nazli && u.role !== "conductor").map((u) => u.email));
  check(sameSet(emails(due), altoWant), `AC32 2 days before: eligible altos without a submission (${due.length}/${altoWant.size})`);
  const asist = of("assistant_queue").find((r) => byId.get(r.user_id) === "asistan@arkhe.local");
  check(!!asist && /^Dinleme kuyruğun: \d+ kayıt$/.test(asist.line), `AC34 asistan@ gets the queue line (${asist?.line})`);
  check(of("assistant_queue").every((r) => byId.get(r.user_id) !== "korist@arkhe.local"), "AC34 non-assistants get no queue line");
  const sefQ = of("conductor_queue")[0];
  check(!sefQ || /^Yorum bekleyen: \d+ kayıt/.test(sefQ.line), `AC35 the conductor's line (${sefQ?.line ?? "none: nothing waiting"})`);
  const mine = of("tickets_due").find((r) => r.user_id === ykId);
  const c = (await db.execute({
    sql: `select sum(due_on = ?) as a, sum(due_on = ?) as b, sum(due_on < ?) as c from board_tickets
          where assignee_id = ? and status <> 'done' and due_on is not null`,
    args: [d, istanbulDate(2), d, ykId],
  })).rows[0];
  const want = [[c.a, "bugün"], [c.b, "yarın"], [c.c, "gecikti"]].filter(([n]) => Number(n)).map(([n, w]) => `${n} iş ${w}`).join(", ");
  check(mine?.line === `İşlerin: ${want}` && Number(c.a) >= 1 && Number(c.c) >= 2, `AC42 yk@'s line counts today, tomorrow and overdue, not done (${mine?.line})`);
  const sefId = await userId("sef@arkhe.local");
  const combined = rows.find((r) => r.user_id === sefId && r.kind === "morning");
  check(combined?.title === "Bugün Arkhe'de" && combined.url === "/", "AC48 sef@'s morning items are one combined notification");
  await db.execute({ sql: "delete from submissions where assignment_id = ?", args: [due2] });
  await db.execute({ sql: "delete from assignment_parts where assignment_id = ?", args: [due2] });
  await db.execute({ sql: "delete from assignments where id = ?", args: [due2] });
  await db.execute("delete from board_tickets where title = 'E2E Push due'");
  await db.execute({ sql: "delete from rehearsals where id in (?, ?, ?, ?)", args: [tutti, bass, cancelled, concert] });
}

async function dues(browser) {
  // AC 43: the board switch, period opened and overdue reminders.
  const yk = await as(browser, "yk@arkhe.local");
  const korist = await as(browser, "korist@arkhe.local");
  const push = await actionIds("src/app/actions/push.ts");
  if (!push.setDuesPush) {
    check(false, "AC43 setDuesPush is reachable");
    return;
  }
  check((await callForm(korist, push.setDuesPush, [], { on: "1" })).includes("Bu işlem için yetkin yok."), "AC43 a member can't turn dues notifications on");
  const d = istanbulDate(1);
  const period = crypto.randomUUID();
  await db.execute({
    sql: "insert into dues_periods (id, name, starts_on, ends_on, due_on, amount_kurus) values (?, 'E2E Push Dönem', ?, ?, ?, 98765)",
    args: [period, d, istanbulDate(60), istanbulDate(30)],
  });
  await db.execute("delete from notification_state where key like 'sabah-%'");
  await dispatch(`?simdi=${encodeURIComponent(at(d, "08:20"))}`);
  check((await rowsOf("kind in ('dues_open', 'dues_late')")).length === 0, "AC43 while the switch is off, no dues notification");
  check((await callForm(yk, push.setDuesPush, [], { on: "1" })).includes("Kaydedildi."), "AC43 a manager turns it on");
  await db.execute("delete from notification_state where key like 'sabah-%'");
  await dispatch(`?simdi=${encodeURIComponent(at(d, "08:25"))}`);
  const open = await rowsOf("kind = 'dues_open'");
  check(open.length > 0 && open.every((r) => byId.get(r.user_id) !== "sef@arkhe.local"), `AC43 Aidat dönemi başladı to non-waived members, not the conductor (${open.length})`);
  const late = await rowsOf("kind = 'dues_late'");
  await db.execute("delete from notification_state where key like 'sabah-%'");
  await dispatch(`?simdi=${encodeURIComponent(at(istanbulDate(2), "08:25"))}`);
  check((await rowsOf("kind = 'dues_late'")).length === late.length, "AC43 the overdue reminder doesn't repeat within 30 days");
  await callForm(yk, push.setDuesPush, [], { on: "0" });
  await db.execute({ sql: "delete from dues_periods where id = ?", args: [period] });
  await yk.context().close();
  await korist.context().close();
}

async function system() {
  // AC 45: a failing cron backup alerts sef@ only; AC 46: storage crossings.
  const sefId = await userId("sef@arkhe.local");
  await resetBackup();
  await setRecipients(["p10@e2e.test"]);
  const outbox = path.join(ROOT, "data/outbox");
  const parked = `${outbox}-p10`;
  const had = existsSync(outbox);
  if (had) renameSync(outbox, parked);
  writeFileSync(outbox, "not a directory");
  try {
    await cron(`?bugun=${istanbulDate(0)}`);
  } finally {
    rmSync(outbox, { force: true });
    if (had) renameSync(parked, outbox);
    else mkdirSync(outbox, { recursive: true });
  }
  const alerts = await rowsOf("kind = 'backup_failed'");
  check(alerts.length === 1 && alerts[0].user_id === sefId, `AC45 a failed cron backup alerts sef@ only (${alerts.length})`);
  await resetBackup();

  await db.execute("delete from storage_deletions");
  const fill = async (bytes) => {
    const rows = [];
    for (let left = bytes; left > 0; left -= 4_194_304) {
      rows.push({
        sql: "insert into storage_deletions (storage_key, area, size_bytes, not_before) values (?, 'recording', ?, unixepoch() + 3600)",
        args: [`recordings/${crypto.randomUUID()}.wav`, Math.min(left, 4_194_304)],
      });
    }
    await db.batch(rows, "write");
  };
  const stored = async () => Number(await scalar(`select (select coalesce(sum(size_bytes), 0) from recordings where audio_deleted_at is null)
      + (select coalesce(sum(size_bytes), 0) from midi_files) + (select coalesce(sum(size_bytes), 0) from storage_deletions where state = 'pending')`));
  const runs = [];
  const runAt = async (day) => {
    await cron(`?bugun=${day}`);
    runs.push(day);
  };
  await fill(812_000_000 - (await stored()));
  await runAt(istanbulDate(0));
  let s = await rowsOf("kind like 'storage_%'");
  check(s.length === 1 && s[0].title === "Kayıt alanı %81 dolu" && s[0].user_id === sefId, `AC46 81% alerts sef@ once (${s.map((r) => r.title)})`);
  await fill(10_000_000);
  await runAt(istanbulDate(1));
  check((await rowsOf("kind like 'storage_%'")).length === 1, "AC46 82% the next day sends nothing");
  await db.execute("delete from storage_deletions");
  await runAt(istanbulDate(2));
  await fill(812_000_000 - (await stored()));
  await runAt(istanbulDate(3));
  check((await rowsOf("kind = 'storage_80'")).length === 2, "AC46 after a run below 80%, 81% alerts again");
  await fill(960_000_000 - (await stored()));
  await runAt(istanbulDate(4));
  s = await rowsOf("kind = 'storage_95'");
  check(s.length === 1 && s[0].title === "Kayıt alanı dolu", "AC46 96% sends Kayıt alanı dolu once");
  await db.execute("delete from storage_deletions");
  await db.execute("delete from storage_sweeps");
}

function privacy(entries) {
  const amounts = ["98765", "987,65", "123456", "1.234,56", "234567", "2.345,67"];
  const leaks = entries.filter((e) => {
    const s = JSON.stringify(e.payload);
    return s.includes(MARK) || s.includes("@") || s.includes("₺") || /\bTL\b/.test(s) || amounts.some((a) => s.includes(a));
  });
  check(entries.length > 0 && leaks.length === 0, `AC7 no marker, email, currency or amount in ${entries.length} payloads (${leaks.length} leaks)`);
}

export default async function run(browser) {
  const started = Date.now();
  await resetPush();
  const all = await people();
  for (const u of all) {
    await addDevice(u.id, "ok");
    // At-once checks must not depend on the hour the suite runs; quiet hours have their own checks.
    await setPref(u.id, "gece", false);
  }
  // Dev compiles lazily: visit the pages whose actions the suite calls.
  const sample = await as(browser, "sef@arkhe.local");
  const rid = await scalar("select id from rehearsals order by starts_at desc limit 1");
  const aid = await scalar("select id from assignments order by due_at desc limit 1");
  const bid = await scalar("select id from budgets limit 1");
  for (const p of ["/profil", "/finans/ayarlar", "/calismalar/yeni", `/calismalar/${rid}`, `/calismalar/${rid}/duzenle`, "/odevler/yeni", `/odevler/${aid}`, "/yonetim/yeni", "/yonetim/1", "/finans/butce/yeni", `/finans/butce/${bid}`, `/finans/butce/${bid}/duzenle`, "/uyeler"]) {
    await goto(sample, p);
  }
  await sample.context().close();
  const att = await attendance(browser, all);
  await rehearsals(browser, all);
  await absent(browser);
  const hw = await homework(browser, all);
  await board(browser);
  const bud = await budget(browser);
  await faults(browser);
  await morning(all);
  await dues(browser);
  await system();
  const entries = outboxSince(started);
  privacy(entries);
  removeOutbox(entries);
  await db.execute({ sql: "delete from attendance where rehearsal_id = ?", args: [att] });
  await db.execute("delete from board_ticket_events where ticket_id in (select id from board_tickets where title like 'E2E Push%')");
  await db.execute("delete from board_ticket_reads where ticket_id in (select id from board_tickets where title like 'E2E Push%')");
  await db.execute("delete from board_tickets where title like 'E2E Push%'");
  await db.execute({ sql: "delete from budgets where id = ?", args: [bud] });
  await db.execute({ sql: "delete from submissions where assignment_id = ?", args: [hw] });
  await db.execute({ sql: "delete from assignment_parts where assignment_id = ?", args: [hw] });
  await db.execute({ sql: "delete from assignments where id = ?", args: [hw] });
  await db.execute("delete from attendance where rehearsal_id in (select id from rehearsals where title like 'E2E Push%')");
  await db.execute("delete from rehearsals where title like 'E2E Push%'");
  await resetPush();
}
