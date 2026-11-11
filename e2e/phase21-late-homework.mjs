// Phase 21: reminders for homework past its deadline: the singers who owe a take 1, 3 and 7 days
// after the last day, the conductor a count the day after.
import { check, db, istanbulDate, userId } from "./lib.mjs";
import { addDevice, at, dispatch, resetPush, rowsOf } from "./push.mjs";

const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] ?? null;
const ts = (day, time) => Math.floor(Date.parse(at(day, time)) / 1000);

async function cleanup() {
  await db.execute("delete from assignments where description like 'E2E gecikme%'");
}

export default async function run() {
  await cleanup();
  await resetPush();
  try {
    await late();
  } finally {
    await resetPush();
    await cleanup();
  }
}

async function late() {
  const run = istanbulDate(1);
  const piece = await one(
    "select id, title from pieces where status <> 'archive' order by created_at limit 1",
  );
  const make = async (
    dueDay,
    label,
    { created = ts(istanbulDate(-30), "12:00"), cancelled = false } = {},
  ) => {
    const id = crypto.randomUUID();
    await db.execute({
      sql: "insert into assignments (id, piece_id, due_at, description, created_at, updated_at, cancelled_at) values (?, ?, ?, ?, ?, unixepoch(), ?)",
      args: [
        id,
        piece.id,
        ts(dueDay, "21:00"),
        `E2E gecikme ${label}`,
        created,
        cancelled ? ts(istanbulDate(-1), "12:00") : null,
      ],
    });
    await db.execute({
      sql: "insert into assignment_parts (assignment_id, voice_part) values (?, 'alto')",
      args: [id],
    });
    return id;
  };
  const day1 = await make(istanbulDate(0), "1");
  const day2 = await make(istanbulDate(-1), "2");
  const day3 = await make(istanbulDate(-2), "3");
  const day7 = await make(istanbulDate(-6), "7");
  const day8 = await make(istanbulDate(-7), "8");
  const off = await make(istanbulDate(0), "iptal", { cancelled: true });

  const [korist, nazli, ayse, sef, elif] = await Promise.all(
    [
      "korist@arkhe.local",
      "nazli.koc@arkhe.local",
      "ayse.ozturk@arkhe.local",
      "sef@arkhe.local",
      "elif.yildiz@arkhe.local",
    ].map(userId),
  );
  for (const u of [korist, nazli, ayse, sef, elif]) await addDevice(u);
  // nazli sent day1 late; ayse joined after the homework was given.
  await db.execute({
    sql: "insert into submissions (assignment_id, user_id, submitted_at, method) values (?, ?, unixepoch(), 'self')",
    args: [day1, nazli],
  });
  const ayseJoined = (await one("select joined_at from users where id = ?", [ayse])).joined_at;
  await db.execute({
    sql: "update users set joined_at = ? where id = ?",
    args: [ts(istanbulDate(-3), "12:00"), ayse],
  });

  let expected = 0;
  try {
    const altos = await one(
      "select count(*) n from users where left_at is null and is_active = 1 and voice_part = 'alto' and role in ('member', 'board') and joined_at <= ?",
      [ts(istanbulDate(-30), "12:00")],
    );
    expected = Number(altos.n) - 1;
    await db.execute("delete from notification_state where key like 'sabah-%'");
    await dispatch(`?simdi=${encodeURIComponent(at(run, "08:20"))}`);
  } finally {
    await db.execute({
      sql: "update users set joined_at = ? where id = ?",
      args: [ayseJoined, ayse],
    });
  }
  const rows = await rowsOf("created_at >= ?", [ts(run, "08:00")]);
  const lateFor = (user, a) =>
    rows.find(
      (r) => r.user_id === user && r.kind === "homework_late" && r.url === `/odevler/${a}#kayit`,
    );
  const mine = lateFor(korist, day1);
  check(
    Boolean(mine) &&
      mine.title === "Ödevin gecikti" &&
      mine.body.includes(piece.title) &&
      mine.body.includes("Geç de olsa"),
    `the day after the deadline a singer without a take hears it (${mine?.body})`,
  );
  check(!lateFor(nazli, day1), "a singer who sent it (even late) does not");
  check(!lateFor(elif, day1), "a singer of another part does not");
  check(
    Boolean(lateFor(korist, day3)) && Boolean(lateFor(korist, day7)),
    "again 3 and 7 days after",
  );
  check(
    !lateFor(korist, day2) && !lateFor(korist, day8),
    "but not 2 or 8 days after: the reminders stop",
  );
  check(
    !lateFor(ayse, day1) && !lateFor(ayse, day7),
    "someone who joined after the homework was given is not chased for it",
  );
  check(!lateFor(korist, off), "a cancelled homework sends nothing");
  check(
    !rows.some((r) => r.user_id === sef && r.kind === "homework_late"),
    "the conductor gets no singer reminder",
  );

  const sum = rows.find(
    (r) => r.user_id === sef && r.kind === "homework_missing" && r.url === `/odevler/${day1}`,
  );
  check(
    Boolean(sum) && sum.body.includes(`${expected} korist`),
    `the conductor gets the count the day after (${sum?.body}; want ${expected})`,
  );
  check(
    !rows.some((r) => r.kind === "homework_missing" && r.url === `/odevler/${day3}`),
    "only once, the day after",
  );
  check(
    !rows.some((r) => r.kind === "homework_missing" && r.user_id !== sef),
    "the count goes to the conductor alone",
  );

  const before = rows.length;
  await dispatch(`?simdi=${encodeURIComponent(at(run, "09:30"))}`);
  const again = await rowsOf("created_at >= ?", [ts(run, "08:00")]);
  check(
    again.filter((r) => r.kind === "homework_late").length ===
      rows.filter((r) => r.kind === "homework_late").length && again.length >= before,
    "a second run the same day sends nothing new",
  );
}
