// Phase 10 A: push storage, allowlist, authorization, devices, test button, dispatcher (AC 1, 3–6, 9, 13–15, 18, 47–51, 53).
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE, check, db, DEMO_PASSWORD, insertRehearsal, istanbulDate, newPage, userId } from "./lib.mjs";
import { as, actionIds, callAction, callForm, goto, scalar } from "./board.mjs";
import { cron } from "./mail.mjs";
import {
  addDevice,
  at,
  dispatch,
  fakeEndpoint,
  fakeKeys,
  outboxSince,
  removeOutbox,
  resetPush,
  ROOT,
  rowsOf,
  setPref,
  until,
} from "./push.mjs";

const PUSH_ACTIONS = "src/app/actions/push.ts";
const FORBIDDEN = "Bu işlem için yetkin yok.";
const REFUSED = "Bu bildirim adresi kabul edilmedi.";

function migrationIsAdditive() {
  const dir = path.join(ROOT, "drizzle");
  const sql = readFileSync(path.join(dir, "0012_phase10_push.sql"), "utf8");
  check(
    !/\bALTER\b|\bDROP\b|__new_/i.test(sql) && /CREATE TABLE `push_subscriptions`/.test(sql),
    "AC1 0012 only creates tables and indexes",
  );
}

async function subscribe(page, ids, sub) {
  return callAction(page, ids.subscribePush, [sub]);
}

async function allowlist(page, ids) {
  const keys = fakeKeys();
  const before = await scalar("select count(*) from push_subscriptions");
  const bad = [
    { endpoint: "http://fcm.googleapis.com/fcm/send/x", keys },
    { endpoint: "https://localhost/x", keys },
    { endpoint: "https://127.0.0.1/x", keys },
    { endpoint: "https://10.0.0.1/x", keys },
    { endpoint: "https://[::1]/x", keys },
    { endpoint: "https://evil.example.com/push/x", keys },
    { endpoint: fakeEndpoint(), keys: { p256dh: "AAAA", auth: keys.auth } },
    { endpoint: fakeEndpoint(), keys: { p256dh: keys.p256dh, auth: "AAAAAAAA" } },
    { endpoint: `https://fcm.googleapis.com/fcm/send/${"a".repeat(1030)}`, keys },
    { endpoint: "https://fcm.googleapis.com.evil.test/x", keys },
  ];
  let refused = 0;
  for (const sub of bad) if ((await subscribe(page, ids, sub)).includes(REFUSED)) refused++;
  check(refused === bad.length, `AC4 every bad endpoint/key refused (${refused}/${bad.length})`);
  check(
    (await scalar("select count(*) from push_subscriptions")) === before,
    "AC4 refused subscriptions write no row",
  );
  const good = { endpoint: fakeEndpoint("ok"), keys };
  check(
    (await subscribe(page, ids, good)).includes("Bu cihazda bildirimler açık."),
    "AC4 push.invalid is accepted where the hooks are enabled",
  );
  check(
    (await scalar("select label from push_subscriptions where endpoint = ?", [good.endpoint])) !==
      null,
    "AC11 the device row is saved with a server-side label",
  );
  return good;
}

async function authorization(browser, ids, sefSubId) {
  const anon = await newPage(browser);
  // A cookie that is no session: passes the proxy's optimistic check, so the action itself must refuse.
  await anon.context().addCookies([{ name: "arkhe_session", value: "e2e-not-a-session", url: BASE }]);
  await anon.goto(`${BASE}/giris`);
  const calls = [
    ["subscribePush", [{ endpoint: fakeEndpoint(), keys: fakeKeys() }]],
    ["unsubscribePush", [fakeEndpoint()]],
    ["sendTestPush", []],
  ];
  let ok = 0;
  for (const [name, args] of calls) if ((await callAction(anon, ids[name], args)).includes(FORBIDDEN)) ok++;
  for (const [name, fields] of [
    ["removePushDevice", { id: sefSubId }],
    ["savePushPref", { key: "calisma", on: "0" }],
    ["setDuesPush", { on: "1" }],
  ]) {
    if ((await callForm(anon, ids[name], [], fields)).includes(FORBIDDEN)) ok++;
  }
  check(ok === 6, `AC5 logged out, every push action refuses (${ok}/6)`);
  await anon.context().close();

  const korist = await as(browser, "korist@arkhe.local");
  check(
    (await callForm(korist, ids.removePushDevice, [], { id: sefSubId })).includes("Cihaz bulunamadı."),
    "AC5 korist can't remove sef's device",
  );
  check(
    (await scalar("select count(*) from push_subscriptions where id = ?", [sefSubId])) === 1,
    "AC5 sef's device row stays",
  );
  const refusedPrefs = [];
  refusedPrefs.push(await callForm(korist, ids.savePushPref, [], { key: "yonetim", on: "1" }));
  refusedPrefs.push(await callForm(korist, ids.savePushPref, [], { key: "dinleme", on: "1" }));
  refusedPrefs.push(await callForm(korist, ids.setDuesPush, [], { on: "1" }));
  const yk = await as(browser, "yk@arkhe.local");
  refusedPrefs.push(await callForm(yk, ids.savePushPref, [], { key: "sistem", on: "1" }));
  check(
    refusedPrefs.every((t) => t.includes("Bu ayar sana açık değil.") || t.includes(FORBIDDEN)),
    "AC5 groups the role doesn't show are refused (korist yonetim/dinleme, yk sistem); member can't flip dues",
  );
  check(
    (await scalar("select count(*) from notification_prefs")) === 0 &&
      (await scalar("select count(*) from notification_state where key = 'aidat-bildirimleri'")) === 0,
    "AC5 refused preference calls write nothing",
  );
  check(
    (await callForm(korist, ids.savePushPref, [], { key: "devamsizlik", on: "1" })).includes("Kaydedildi."),
    "AC16 a visible switch saves (Kaydedildi.)",
  );
  await db.execute("delete from notification_prefs");
  await yk.context().close();
  return korist;
}

async function devices(browser, ids) {
  const korist = await as(browser, "korist@arkhe.local");
  const yk = await as(browser, "yk@arkhe.local");
  const kId = await userId("korist@arkhe.local");
  const yId = await userId("yk@arkhe.local");
  const shared = { endpoint: fakeEndpoint("ok"), keys: fakeKeys() };
  await subscribe(korist, ids, shared);
  await subscribe(yk, ids, shared);
  check(
    (await scalar("select user_id from push_subscriptions where endpoint = ?", [shared.endpoint])) ===
      yId,
    "AC13 the same endpoint now belongs to the last subscriber (yk@)",
  );
  const html = await (await korist.request.get(`${BASE}/profil`)).text();
  check(!html.includes(shared.endpoint), "AC5 no page carries an endpoint");

  // AC 14: ten arranged, an 11th replaces the least recently successful.
  await db.execute({ sql: "delete from push_subscriptions where user_id = ?", args: [kId] });
  const old = [];
  for (let i = 0; i < 10; i++) {
    old.push(await addDevice(kId, "ok", { createdAt: 1_700_000_000 + i, lastSuccessAt: i === 3 ? 1_600_000_000 : null }));
  }
  await subscribe(korist, ids, { endpoint: fakeEndpoint("ok"), keys: fakeKeys() });
  const left = (await db.execute({ sql: "select id from push_subscriptions where user_id = ?", args: [kId] })).rows.map((r) => r.id);
  check(left.length === 10 && !left.includes(old[3]), "AC14 an 11th device removes the oldest-success one");

  // AC 15: logout deletes this browser's subscription only.
  const mine = { endpoint: fakeEndpoint("ok"), keys: fakeKeys() };
  await subscribe(korist, ids, mine);
  const session = await scalar("select session_id from push_subscriptions where endpoint = ?", [mine.endpoint]);
  const before = await scalar("select count(*) from push_subscriptions where user_id = ? and session_id <> ?", [kId, session]);
  const auth = await actionIds("src/app/actions/auth.ts");
  if (auth.logout) await callAction(korist, { ...auth.logout, path: "/profil" }, []);
  check(
    (await scalar("select count(*) from push_subscriptions where endpoint = ?", [mine.endpoint])) === 0 &&
      before > 0 &&
      (await scalar("select count(*) from push_subscriptions where user_id = ?", [kId])) === before,
    "AC15 logout removes this browser's subscription and no other",
  );
  await korist.context().close();
  await yk.context().close();
}

async function testButton(browser, ids) {
  const page = await as(browser, "korist@arkhe.local");
  const kId = await userId("korist@arkhe.local");
  await db.execute({ sql: "delete from push_subscriptions where user_id = ?", args: [kId] });
  check(
    (await callAction(page, ids.sendTestPush, [])).includes("Önce bu cihazda bildirimleri aç."),
    "AC18 no device: the test asks to turn notifications on",
  );
  const since = Date.now();
  const ok = await addDevice(kId, "ok");
  const gone = await addDevice(kId, "gone");
  const fail = await addDevice(kId, "fail");
  const res = await callAction(page, ids.sendTestPush, []);
  check(
    res.includes("Deneme bildirimi gönderildi (1 cihaz).") &&
      res.includes("1 cihaz artık bildirim almıyor; listeden kaldırıldı."),
    "AC18 the test reports the device count and the removed device",
  );
  const sent = outboxSince(since).filter((e) => e.kind === "test");
  check(sent.length === 3, `AC3 one outbox file per attempted device (${sent.length})`);
  check(
    sent.every((e) => e.payload.title === "Deneme bildirimi" && e.userId === kId),
    "AC18 the test goes to every device of the user",
  );
  check(
    (await scalar("select count(*) from push_subscriptions where id = ?", [gone])) === 0 &&
      (await scalar("select fail_count from push_subscriptions where id = ?", [fail])) === 1 &&
      (await scalar("select last_success_at from push_subscriptions where id = ?", [ok])) !== null,
    "AC9 gone is deleted, fail counts up, ok records last_success_at",
  );
  for (let i = 0; i < 4; i++) await callAction(page, ids.sendTestPush, []);
  check(
    (await callAction(page, ids.sendTestPush, [])).includes("Çok sık denedin. Biraz sonra tekrar dene."),
    "AC18 the 6th test within 10 minutes is refused",
  );
  await db.execute({ sql: "delete from login_attempts where key like 'push-test:%'" });
  await page.context().close();
}

async function dispatcher() {
  check((await dispatch("", { secret: null })).status === 401, "AC51 bildirimler: 401 without the bearer");
  const runsBefore = await scalar("select count(*) from backup_runs");
  const sweepsBefore = await scalar("select count(*) from storage_sweeps");
  const r = await dispatch();
  check(r.status === 200 && r.text === "{}" && /no-store/.test(r.cache ?? ""), "AC51 bildirimler replies {} with no-store");
  check(
    (await scalar("select count(*) from backup_runs")) === runsBefore &&
      (await scalar("select count(*) from storage_sweeps")) === sweepsBefore,
    "AC51 bildirimler runs only the dispatcher",
  );
  const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  check(vercel.crons?.length === 1, "AC51 vercel.json still has one cron");

  // AC 50: a failing device is retried by later runs, 3 attempts in all; expired rows are dropped.
  const kId = await userId("korist@arkhe.local");
  await db.execute({ sql: "delete from push_subscriptions where user_id = ?", args: [kId] });
  await addDevice(kId, "fail");
  const day = istanbulDate(1);
  const mk = async (id, expires) =>
    db.execute({
      sql: `insert into notifications (id, user_id, kind, group_key, dedupe_key, title, body, url, tag, status, created_at, expires_at)
            values (?, ?, 'feedback', 'odev', ?, 'Şeften yorum var', 'E2E body', '/odevler', 'yorum-x', 'pending', unixepoch(), ?)`,
      args: [id, kId, `e2e-${id}`, expires],
    });
  const retry = crypto.randomUUID();
  const old = crypto.randomUUID();
  await mk(retry, Math.floor(Date.now() / 1000) + 7 * 86400);
  await mk(old, Math.floor(Date.now() / 1000) - 60);
  const noon = `?simdi=${encodeURIComponent(at(day, "12:00"))}`;
  for (let i = 0; i < 3; i++) await dispatch(noon);
  const [row] = await rowsOf("id = ?", [retry]);
  check(row?.status === "failed" && Number(row.attempts) === 3, `AC50 a failing row is tried 3 times then failed (${row?.status}/${row?.attempts})`);
  const [gone] = await rowsOf("id = ?", [old]);
  check(gone?.status === "dropped", "AC50 an expired row is dropped, never sent");

  // AC 9: 10 consecutive failures over ≥ 14 days delete the device.
  const dead = await addDevice(kId, "fail");
  await db.execute({
    sql: "update push_subscriptions set fail_count = 10, first_fail_at = unixepoch() - 15 * 86400 where id = ?",
    args: [dead],
  });
  await dispatch(noon);
  check((await scalar("select count(*) from push_subscriptions where id = ?", [dead])) === 0, "AC9 a long-dead device is pruned");

  // AC 53: rows older than 30 days are deleted.
  const ancient = crypto.randomUUID();
  await db.execute({
    sql: `insert into notifications (id, user_id, kind, dedupe_key, title, body, url, tag, status, created_at, expires_at)
          values (?, ?, 'test', ?, 'Deneme bildirimi', 'x', '/', 'deneme', 'sent', unixepoch() - 31 * 86400, unixepoch() - 31 * 86400)`,
    args: [ancient, kId, `e2e-${ancient}`],
  });
  await dispatch(noon);
  check((await rowsOf("id = ?", [ancient])).length === 0, "AC53 notification rows older than 30 days are pruned");

  // AC 47: the dispatcher throwing changes neither the reply nor the sweep.
  const sweeps = await scalar("select count(*) from storage_sweeps");
  const c = await cron(`?hata=dispatcher&bugun=${istanbulDate()}`);
  check(
    c.json && Object.keys(c.json).join(",") === "status" && (await scalar("select count(*) from storage_sweeps")) === sweeps + 1,
    "AC47 with the dispatcher throwing, the reply is { status } and the sweep still runs",
  );
}

async function quietAndMorning(browser) {
  // AC 49 + 48: held at 23:30 for quiet-hours people, combined into one morning notification.
  const kId = await userId("korist@arkhe.local");
  const nId = await userId("nazli.koc@arkhe.local");
  await db.execute({ sql: "delete from push_subscriptions where user_id in (?, ?)", args: [kId, nId] });
  await addDevice(kId, "ok");
  await addDevice(nId, "ok");
  await setPref(nId, "gece", false);
  const day = istanbulDate(1);
  const night = at(istanbulDate(0), "23:30");
  const sef = await as(browser, "sef@arkhe.local");
  await sef.context().addCookies([{ name: "arkhe_e2e_clock", value: night, url: BASE }]);
  const hw = await actionIds("src/app/(portal)/odevler/actions.ts", "x");
  const piece = await scalar("select id from pieces where status <> 'archive' order by created_at limit 1");
  const since = Date.now();
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    await callForm(sef, hw.createAssignment, [], {
      id,
      pieceId: piece,
      parts: "alto",
      dueDate: istanbulDate(5),
      dueTime: "20:00",
      description: `E2E push ${i}`,
    });
  }
  await until(() => outboxSince(since).filter((e) => e.userId === nId).length >= 6);
  check(
    outboxSince(since).filter((e) => e.userId === nId && e.kind === "homework_new").length === 6,
    "AC49 quiet hours off: the homework goes at once",
  );
  check(
    outboxSince(since).filter((e) => e.userId === kId).length === 0 &&
      (await rowsOf("user_id = ? and status = 'held'", [kId])).length === 6,
    "AC49 quiet hours on: held, no outbox file",
  );
  const r3 = await dispatch(`?simdi=${encodeURIComponent(at(day, "03:00"))}`);
  check(r3.status === 200 && outboxSince(since).filter((e) => e.userId === kId).length === 0, "AC51 at 03:00 nothing held is sent");
  const morningSince = Date.now();
  await dispatch(`?simdi=${encodeURIComponent(at(day, "08:05"))}`);
  const mine = outboxSince(morningSince).filter((e) => e.userId === kId);
  const combined = mine.find((e) => e.kind === "morning");
  check(
    combined &&
      mine.filter((e) => e.kind !== "morning").length === 0 &&
      combined.payload.title === "Bugün Arkhe'de" &&
      combined.payload.url === "/" &&
      combined.payload.tag === "sabah",
    "AC48 one combined morning notification (Bugün Arkhe'de, /, sabah)",
  );
  const lines = combined?.payload.body.split("\n") ?? [];
  check(
    lines.length <= 5 && /^\+\d+ bildirim daha$/.test(lines[lines.length - 1] ?? ""),
    `AC48 at most 4 lines then "+n bildirim daha" (${JSON.stringify(combined?.payload.body)})`,
  );
  const again = Date.now();
  await dispatch(`?simdi=${encodeURIComponent(at(day, "08:20"))}`);
  check(
    outboxSince(again).filter((e) => e.userId === kId).length === 0,
    "AC51 a second run the same morning sends nothing again",
  );
  await sef.context().close();
  await db.execute({
    sql: `delete from assignment_parts where assignment_id in (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  await db.execute({ sql: `delete from assignments where id in (${ids.map(() => "?").join(",")})`, args: ids });
}

async function reviewFixes(browser, ids) {
  // AC 12 + review P2-3: Kaldır sticks; the daily re-sync can't bring the device back, a tap can.
  const korist = await as(browser, "korist@arkhe.local");
  const kId = await userId("korist@arkhe.local");
  const tablet = { endpoint: fakeEndpoint("ok"), keys: fakeKeys() };
  await subscribe(korist, ids, tablet);
  const rowId = await scalar("select id from push_subscriptions where endpoint = ?", [tablet.endpoint]);
  check(
    (await callForm(korist, ids.removePushDevice, [], { id: rowId })).includes("Cihaz kaldırıldı."),
    "AC12 Kaldır removes the device",
  );
  const resync = await callAction(korist, ids.subscribePush, [tablet, { resync: true }]);
  check(
    resync.includes("Bu cihaz listeden kaldırıldı.") &&
      (await scalar("select count(*) from push_subscriptions where endpoint = ?", [tablet.endpoint])) === 0,
    "AC12 the removed device's daily re-sync is refused and writes no row",
  );
  await subscribe(korist, ids, tablet);
  check(
    (await scalar("select count(*) from push_subscriptions where endpoint = ?", [tablet.endpoint])) === 1,
    "AC12 Bildirimleri aç on that device turns it back on",
  );

  // Review P2-4: a password change keeps this browser's device, other sessions' devices go.
  const other = await addDevice(kId, "ok");
  await goto(korist, "/profil");
  const prof = await actionIds("src/app/(portal)/profil/actions.ts");
  const change = (from, to) =>
    callForm(korist, { ...prof.changePassword, path: "/profil" }, [], { current: from, password: to, confirm: to });
  const changed = await change(DEMO_PASSWORD, "e2e-push-gecici-2026");
  await change("e2e-push-gecici-2026", DEMO_PASSWORD);
  check(
    changed.includes("Şifren değişti.") &&
      (await scalar("select count(*) from push_subscriptions where endpoint = ?", [tablet.endpoint])) === 1 &&
      (await scalar("select count(*) from push_subscriptions where id = ?", [other])) === 0,
    "P2-4 a password change keeps this browser's device and drops the other sessions' devices",
  );
  await korist.context().close();

  // AC 15: deactivating a member removes all their devices.
  const gone = crypto.randomUUID();
  await db.execute({
    sql: "insert into users (id, name, email, role, voice_part, joined_at) values (?, 'E2E Push Ayrılan', 'p10-gone@e2e.test', 'member', 'alto', unixepoch() - 86400)",
    args: [gone],
  });
  await addDevice(gone, "ok");
  await addDevice(gone, "ok");
  const sef = await as(browser, "sef@arkhe.local");
  await goto(sef, `/uyeler/${gone}`);
  const members = await actionIds("src/app/(portal)/uyeler/actions.ts", gone);
  await callAction(sef, members.setMemberActive, [gone, false]);
  check(
    (await scalar("select is_active from users where id = ?", [gone])) === 0 &&
      (await scalar("select count(*) from push_subscriptions where user_id = ?", [gone])) === 0,
    "AC15 deactivating a member removes all their devices",
  );
  await sef.context().close();
  await db.execute({ sql: "delete from users where id = ?", args: [gone] });
}

async function neverBlocks(browser) {
  // AC 8: slow push services never slow the action; the sends happen after the response.
  const users = (await db.execute("select id from users where is_active = 1 and role <> 'conductor' limit 12")).rows;
  for (const u of users) await addDevice(u.id, "slow");
  const id = await insertRehearsal({ title: "E2E Push Yavaş", startOffsetMin: 30 });
  const sef = await as(browser, "sef@arkhe.local");
  await goto(sef, `/calismalar/${id}`);
  const ids = await actionIds("src/app/(portal)/calismalar/actions.ts", id);
  const since = Date.now();
  const t0 = Date.now();
  await callAction(sef, ids.openAttendance, [id]);
  const ms = Date.now() - t0;
  check(ms < 3000 && (await scalar("select opened_at is not null from rehearsals where id = ?", [id])) === 1, `AC8 Yoklamayı başlat answers in ${ms} ms with 12 slow devices`);
  // Wait for the background sends (10 s timeout each, 10 at a time) so nothing writes after cleanup.
  await until(() => outboxSince(since).filter((e) => e.result === "slow").length >= 12, 30_000);
  const slow = outboxSince(since).filter((e) => e.result === "slow");
  check(slow.length === 12, `AC50 /slow sends give up after the timeout and the run carries on (${slow.length})`);
  await sef.context().close();
  await db.execute({ sql: "delete from rehearsals where id = ?", args: [id] });
}

function payloadShape(entries) {
  const bad = entries.filter((e) => {
    const p = e.payload ?? {};
    const keys = Object.keys(p).sort().join(",");
    return (
      keys !== "body,tag,title,url" ||
      Buffer.byteLength(JSON.stringify(p)) > 1024 ||
      !/^\/(?!\/)/.test(p.url) ||
      [...p.title].length > 40 ||
      [...p.body].length > 140
    );
  });
  check(entries.length > 0 && bad.length === 0, `AC6 every outbox payload has the right shape (${bad.length} bad of ${entries.length})`);
}

export default async function run(browser) {
  const started = Date.now();
  await resetPush();
  migrationIsAdditive();
  const sef = await as(browser, "sef@arkhe.local");
  await goto(sef, "/profil");
  await goto(sef, "/finans/ayarlar");
  const ids = await actionIds(PUSH_ACTIONS);
  // Every push action is served by the page the UI uses it on.
  for (const [name, action] of Object.entries(ids)) action.path = name === "setDuesPush" ? "/finans/ayarlar" : "/profil";
  const names = ["subscribePush", "unsubscribePush", "removePushDevice", "savePushPref", "sendTestPush", "setDuesPush"];
  check(names.every((n) => ids[n]), "push actions are reachable from a page");
  if (!names.every((n) => ids[n])) return;
  const sefSub = await allowlist(sef, ids);
  const sefSubId = await scalar("select id from push_subscriptions where endpoint = ?", [sefSub.endpoint]);
  await sef.context().close();
  const korist = await authorization(browser, ids, sefSubId);
  await korist.context().close();
  await devices(browser, ids);
  await testButton(browser, ids);
  await dispatcher();
  await quietAndMorning(browser);
  await reviewFixes(browser, ids);
  await neverBlocks(browser);
  const all = outboxSince(started);
  payloadShape(all);
  removeOutbox(all);
  await resetPush();
}
