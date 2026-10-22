// Demo board tickets and budgets relative to `T` (seed time, or "now" when e2e cleans up).
// Shared by scripts/seed.ts and e2e/lib.mjs; raw SQL on a libSQL client. Board and budget rows in
// the local DB are demo-only: every run wipes them first.
//
// Board (seq = 6): Yapılacak 2 · Devam ediyor 1 · Takıldı 1 · Bitti 1 (+1 archived)
//   #1 urgent todo → yk, due T+10, opened by sef, never seen by yk ("Yeni")
//   #2 high in_progress → yk, due T−2 (overdue), two comments, seen by yk
//   #3 medium blocked → sef, one comment, seen by sef
//   #4 low todo, unassigned
//   #5 medium done → sef, done T−5
//   #6 high done → sef, done T−40 (archived)
//   yk: 2 open, 1 new, 1 urgent. sef: 1 open, 0 new.
// Budgets (S = this Istanbul season's year): "S–S+1 sezonu" from S-09 and "S−1–S sezonu" from
//   S−1-09, both approved by sef; the current one has one revision by yk (travel 15.000 → 20.000).

import { assertFixtureTarget } from "./fixture-guard.mjs";

const id = (group, n) => `00000000-0000-4000-9${group}00-${n.toString(16).padStart(12, "0")}`;
export const BOARD_IDS = { tickets: [1, 2, 3, 4, 5, 6].map((n) => id("a", n)) };
export const BUDGET_IDS = { current: id("b", 1), previous: id("b", 2) };

const D = 86_400;
const istanbulDay = (at) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(at);
const addDays = (date, n) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * D * 1000).toISOString().slice(0, 10);

async function people(client, who) {
  const rows = (await client.execute("select email, id from users")).rows;
  const map = new Map(rows.map((r) => [r[0], r[1]]));
  const sef = map.get("sef@arkhe.local");
  const yk = map.get("yk@arkhe.local");
  if (!sef || !yk) throw new Error(`${who} needs the seeded users.`);
  return { sef, yk };
}

/** Wipes every board table and reinserts the six demo tickets relative to `T` (a Date). */
export async function seedBoard(client, T = new Date()) {
  assertFixtureTarget(client);
  const { sef, yk } = await people(client, "seedBoard");
  const t = Math.floor(T.getTime() / 1000);
  const today = istanbulDay(T);
  const statements = [
    // Events and reads cascade.
    "delete from board_tickets",
    "insert into board_ticket_seq (id, last_number) values (1, 6) on conflict(id) do update set last_number = 6",
  ];
  const ticket = (n, f) =>
    statements.push({
      sql: `insert into board_tickets (id, number, title, description, status, urgency, assignee_id,
              due_on, done_at, revision, created_by, created_at, updated_at, updated_by)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        BOARD_IDS.tickets[n - 1],
        n,
        f.title,
        f.description ?? null,
        f.status,
        f.urgency,
        f.assignee ?? null,
        f.due ?? null,
        f.doneAt ?? null,
        f.revision ?? 0,
        f.by,
        f.at,
        f.updatedAt ?? f.at,
        f.updatedBy ?? null,
      ],
    });
  const event = (n, e) =>
    statements.push({
      sql: `insert into board_ticket_events (ticket_id, kind, actor_id, body, from_value, to_value, created_at)
            values (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        BOARD_IDS.tickets[n - 1],
        e.kind,
        e.by,
        e.body ?? null,
        e.from ?? null,
        e.to ?? null,
        e.at,
      ],
    });
  // Seen up to the ticket's latest entry and current revision.
  const seen = (n, user) =>
    statements.push({
      sql: `insert into board_ticket_reads (user_id, ticket_id, seen_event_id, seen_revision, seen_at)
            select ?, tk.id, (select max(e.id) from board_ticket_events e where e.ticket_id = tk.id),
                   tk.revision, ? from board_tickets tk where tk.id = ?`,
      args: [user, t, BOARD_IDS.tickets[n - 1]],
    });

  ticket(1, {
    title: "Bahar konseri için salon rezervasyonu",
    description: "Mülkiye Konferans Salonu ve CSO Ada için tarih sor.\nİki seçenekle kurula gel.",
    status: "todo",
    urgency: "urgent",
    assignee: yk,
    due: addDays(today, 10),
    by: sef,
    at: t - D,
  });
  event(1, { kind: "created", by: sef, at: t - D });
  seen(1, sef);

  ticket(2, {
    title: "Festival başvurusu: katılım ücretini sor",
    status: "in_progress",
    urgency: "high",
    assignee: yk,
    due: addDays(today, -2),
    revision: 1,
    by: yk,
    at: t - 9 * D,
    updatedAt: t - 8 * D,
    updatedBy: yk,
  });
  event(2, { kind: "created", by: yk, at: t - 9 * D });
  event(2, { kind: "status", by: yk, from: "todo", to: "in_progress", at: t - 8 * D });
  event(2, { kind: "comment", by: sef, body: "Salon için iki teklif aldım.", at: t - 7 * D });
  event(2, { kind: "comment", by: yk, body: "Cuma'ya kadar karar verelim.", at: t - 6 * D });
  seen(2, yk);

  ticket(3, {
    title: "Kostüm siparişi: kapora ödemesi",
    status: "blocked",
    urgency: "medium",
    assignee: sef,
    revision: 1,
    by: yk,
    at: t - 6 * D,
    updatedAt: t - 5 * D,
    updatedBy: sef,
  });
  event(3, { kind: "created", by: yk, at: t - 6 * D });
  event(3, { kind: "status", by: sef, from: "todo", to: "blocked", at: t - 5 * D });
  event(3, {
    kind: "comment",
    by: yk,
    body: "Kapora ödenmeden kostümcü siparişi başlatmıyor.",
    at: t - 4 * D,
  });
  seen(3, sef);

  ticket(4, {
    title: "Yeni sezon için korist alım duyurusu",
    status: "todo",
    urgency: "low",
    by: sef,
    at: t - 3 * D,
  });
  event(4, { kind: "created", by: sef, at: t - 3 * D });

  ticket(5, {
    title: "Kış konseri afiş baskısı",
    status: "done",
    urgency: "medium",
    assignee: sef,
    doneAt: t - 5 * D,
    revision: 1,
    by: yk,
    at: t - 15 * D,
    updatedAt: t - 5 * D,
    updatedBy: yk,
  });
  event(5, { kind: "created", by: yk, at: t - 15 * D });
  event(5, { kind: "status", by: yk, from: "todo", to: "done", at: t - 5 * D });

  ticket(6, {
    title: "Eylül genel kurul tutanağı",
    status: "done",
    urgency: "high",
    assignee: sef,
    doneAt: t - 40 * D,
    revision: 1,
    by: sef,
    at: t - 60 * D,
    updatedAt: t - 40 * D,
    updatedBy: sef,
  });
  event(6, { kind: "created", by: sef, at: t - 60 * D });
  event(6, { kind: "status", by: sef, from: "todo", to: "done", at: t - 40 * D });

  await client.batch(statements, "write");
}

/** The season of `T`: September of this Istanbul year from September on, else of last year. */
export function budgetSeason(T = new Date()) {
  const [y, m] = istanbulDay(T).split("-").map(Number);
  const S = m >= 9 ? y : y - 1;
  const name = (s) => `${s}–${String((s + 1) % 100).padStart(2, "0")} sezonu`;
  return {
    current: { name: name(S), start: `${S}-09`, end: `${S + 1}-09` },
    previous: { name: name(S - 1), start: `${S - 1}-09`, end: `${S}-09` },
  };
}

/** Wipes every budget table and reinserts the two demo budgets relative to `T` (a Date). */
export async function seedBudgets(client, T = new Date()) {
  assertFixtureTarget(client);
  const { sef, yk } = await people(client, "seedBudgets");
  const t = Math.floor(T.getTime() / 1000);
  const { current, previous } = budgetSeason(T);
  const statements = [
    // Lines and revisions cascade.
    "delete from budgets",
  ];
  const budget = (bid, b, approvedAt, revision) =>
    statements.push({
      sql: `insert into budgets (id, name, start_month, end_month, approved_at, approved_by, revision,
              created_by, created_at, updated_at, updated_by)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        bid,
        b.name,
        b.start,
        b.end,
        approvedAt,
        sef,
        revision,
        sef,
        approvedAt - D,
        approvedAt,
        sef,
      ],
    });
  const lines = (bid, plan) => {
    for (const [category, kurus] of Object.entries(plan)) {
      statements.push({
        sql: "insert into budget_lines (budget_id, category, amount_kurus) values (?, ?, ?)",
        args: [bid, category, kurus],
      });
    }
  };

  budget(BUDGET_IDS.current, current, t - 20 * D, 2);
  lines(BUDGET_IDS.current, {
    dues: 9_000_000,
    tickets: 3_000_000,
    sponsorship: 1_000_000,
    venue: 1_200_000,
    musician_fee: 900_000,
    costume: 600_000,
    travel: 2_000_000,
    scores_royalties: 150_000,
    bank_fee: 5_000,
  });
  statements.push(
    {
      sql: "insert into budget_revisions (budget_id, reason, actor_id, created_at) values (?, ?, ?, ?)",
      args: [BUDGET_IDS.current, "Festival daveti geldi, seyahat bütçesi arttı.", yk, t - 10 * D],
    },
    {
      sql: `insert into budget_revision_lines (revision_id, category, from_kurus, to_kurus)
            values ((select max(id) from budget_revisions), 'travel', 1500000, 2000000)`,
      args: [],
    },
    {
      sql: "update budgets set updated_at = ?, updated_by = ? where id = ?",
      args: [t - 10 * D, yk, BUDGET_IDS.current],
    },
  );

  budget(BUDGET_IDS.previous, previous, t - 380 * D, 1);
  lines(BUDGET_IDS.previous, {
    dues: 8_000_000,
    tickets: 2_500_000,
    venue: 1_000_000,
    musician_fee: 800_000,
    travel: 1_500_000,
  });

  await client.batch(statements, "write");
}
