// Demo finance data, re-anchored to the month of `T` (seed time, or "now" when e2e cleans up).
// Shared by scripts/seed.ts and e2e/lib.mjs; raw SQL on a libSQL client. Finance data in the
// local DB is demo-only: every run wipes all finance tables first.
//
// Months: M = month of T, M-1, M-2. All entries are created by yk@.
//   Openings M-2-01: Kasa ₺2.500,00 · Banka ₺18.000,00
//   Periods ₺300 / ₺150: P1 = M-2 (due M-2-15), P2 = M-1 (due M-1-15), P3 = M (due today + 10)
//   Ece Demir İndirimli "Öğrenci"; Barış Güneş Muaf; Deniz Aslan waived for P3 "Bir ay yurt dışında"
//   P1 (Kasa, M-2-08): everyone except Onur Çetin → 5.850
//   P2 (Kasa, M-1-12): ten singers ×300, Ece 150, korist 100 → 3.250 (korist "Gecikti · ₺200,00 kaldı")
//   P3 (Kasa, M-01): Ece 150, yk 300, Elif 300 → 750 (korist "Ödenmedi")
//   Kış Konseri (event, linked to a concert rehearsal at T+42d): sponsor 5.000 (Mülkiye Kitabevi),
//     venue 3.500 + doc, costume 1.200 no doc, tickets 6.000, korrepetitör 2.100 + doc → Kâr ₺4.200,00
//   Bank fee 12,75; Virman Kasa→Banka 1.500; catering 450 voided ("Yanlış girildi, fiş yok")
//   Balances: Kasa ₺9.650,00 · Banka ₺24.887,25 · Toplam ₺34.537,25

import { assertFixtureTarget } from "./fixture-guard.mjs";

const id = (group, n) => `00000000-0000-4000-9${group}00-${n.toString(16).padStart(12, "0")}`;
export const FINANCE_IDS = {
  rehearsal: id(9, 1),
  event: id(2, 1),
  sponsor: id(3, 1),
  periods: [id(1, 1), id(1, 2), id(1, 3)],
  venue: id(0, 0x101),
  costume: id(0, 0x102),
  voided: id(0, 0x103),
  tickets: id(0, 0x104),
};
export const PAYMENT_INFO =
  "IBAN TR00 0000 0000 0000 0000 0000 00 · Alıcı: Arkhe Korosu · Açıklamaya adını ve ayı yaz.";

const DAY = 86_400_000;
const istanbulDay = (at) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(at);
const monthName = (ym) =>
  new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${ym}-01T00:00:00Z`),
  );
function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
const lastDay = (ym) =>
  new Date(Date.UTC(...ym.split("-").map(Number), 0)).toISOString().slice(0, 10);
const addDays = (date, n) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Month keys, names and the numbers the e2e suite expects for a fixture seeded at `T`. */
export function financeExpected(T = new Date()) {
  const today = istanbulDay(T);
  const m = today.slice(0, 7);
  const months = [shiftMonth(m, -2), shiftMonth(m, -1), m];
  return {
    today,
    months,
    names: months.map(monthName),
    balances: { cash: 965000, bank: 2488725, total: 3453725 },
    report: [
      { month: months[0], carry: 2050000, income: 585000, expense: 0, closing: 2635000 },
      { month: months[1], carry: 2635000, income: 825000, expense: 471275, closing: 2988725 },
      { month: months[2], carry: 2988725, income: 675000, expense: 210000, closing: 3453725 },
    ],
    eventNet: 420000,
    koristRemaining: 50000,
    // Current period: 21 owe, Ece, yk and Elif paid.
    currentDebtors: 18,
  };
}

const P2_PAID = [
  "yk@arkhe.local",
  "elif.yildiz@arkhe.local",
  "zeynep.kaya@arkhe.local",
  "defne.arslan@arkhe.local",
  "selin.celik@arkhe.local",
  "ayse.ozturk@arkhe.local",
  "melis.aydin@arkhe.local",
  "can.erdogan@arkhe.local",
  "emre.aksoy@arkhe.local",
  "ozan.yilmaz@arkhe.local",
];

/** Wipes every finance table and reinserts the demo ledger relative to `T` (a Date). */
export async function seedFinance(client, T = new Date()) {
  assertFixtureTarget(client);
  const t = Math.floor(T.getTime() / 1000);
  const { today, months } = financeExpected(T);
  const [m2, m1, m0] = months;
  const users = new Map(
    (await client.execute("select email, id, role from users")).rows.map((r) => [r[0], r]),
  );
  const yk = users.get("yk@arkhe.local")?.[1];
  const sef = users.get("sef@arkhe.local")?.[1];
  if (!yk || !sef) throw new Error("seedFinance needs the seeded users.");
  const uid = (email) => {
    const u = users.get(email);
    if (!u) throw new Error(`seedFinance: missing user ${email}`);
    return u[1];
  };

  const statements = [
    // Import items reference entries, sponsors and overrides (restrict); the batches cascade them.
    "delete from import_batches",
    // Corrections point at the rows they replaced (restrict), so unlink before deleting.
    "update finance_entries set replaces_id = null where replaces_id is not null",
    "delete from finance_entries",
    "delete from dues_overrides",
    "delete from member_dues",
    "delete from dues_periods",
    "delete from events",
    "delete from sponsors",
    "delete from app_settings where key = 'dues_payment_info'",
    {
      sql: "insert into app_settings (key, value, updated_at, updated_by) values ('dues_payment_info', ?, ?, ?)",
      args: [PAYMENT_INFO, t, yk],
    },
  ];

  const concertDay = istanbulDay(new Date(T.getTime() + 42 * DAY));
  const at = (date, hh) => Math.floor(Date.parse(`${date}T${hh}:00+03:00`) / 1000);
  statements.push({
    sql: `insert into rehearsals (id, type, title, location, starts_at, ends_at, created_by)
          values (?, 'concert', 'Kış Konseri', 'CSO Ada Ankara', ?, ?, ?)
          on conflict(id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
            cancelled_at = null, cancelled_by = null, opened_at = null, closed_at = null`,
    args: [FINANCE_IDS.rehearsal, at(concertDay, "19:00"), at(concertDay, "21:30"), sef],
  });
  statements.push({
    sql: "insert into events (id, name, starts_on, rehearsal_id, created_by, created_at) values (?, 'Kış Konseri', ?, ?, ?, ?)",
    args: [FINANCE_IDS.event, concertDay, FINANCE_IDS.rehearsal, yk, t],
  });
  statements.push({
    sql: "insert into sponsors (id, name, name_key, contact_name, contact, created_at) values (?, 'Mülkiye Kitabevi', 'mulkiye kitabevi', 'Ayten Hanım', '0312 000 00 00', ?)",
    args: [FINANCE_IDS.sponsor, t],
  });

  const periods = [
    [FINANCE_IDS.periods[0], m2, `${m2}-15`],
    [FINANCE_IDS.periods[1], m1, `${m1}-15`],
    [FINANCE_IDS.periods[2], m0, addDays(today, 10)],
  ];
  for (const [pid, ym, due] of periods) {
    statements.push({
      sql: "insert into dues_periods (id, name, starts_on, ends_on, due_on, amount_kurus, reduced_amount_kurus, created_by, created_at) values (?, ?, ?, ?, ?, 30000, 15000, ?, ?)",
      args: [pid, monthName(ym), `${ym}-01`, lastDay(ym), due, yk, t],
    });
  }
  statements.push(
    {
      sql: "insert into member_dues (user_id, rate, note, updated_by, updated_at) values (?, 'reduced', 'Öğrenci', ?, ?)",
      args: [uid("ece.demir@arkhe.local"), yk, t],
    },
    {
      sql: "insert into member_dues (user_id, rate, note, updated_by, updated_at) values (?, 'exempt', 'YK kararı 2/2026', ?, ?)",
      args: [uid("baris.gunes@arkhe.local"), yk, t],
    },
    {
      sql: "insert into dues_overrides (dues_period_id, user_id, kind, owed_kurus, reason, created_by, created_at) values (?, ?, 'waiver', 0, 'Bir ay yurt dışında', ?, ?)",
      args: [FINANCE_IDS.periods[2], uid("deniz.aslan@arkhe.local"), yk, t],
    },
  );
  // The Phase 9 demo assistant (media fixture) is a demo login, not a paying singer.
  if (users.has("asistan@arkhe.local")) {
    statements.push({
      sql: "insert into dues_overrides (dues_period_id, user_id, kind, owed_kurus, reason, created_by, created_at) values (?, ?, 'waiver', 0, 'Demo hesap', ?, ?)",
      args: [FINANCE_IDS.periods[2], uid("asistan@arkhe.local"), yk, t],
    });
  }

  let n = 0;
  const entry = (e) => {
    statements.push({
      sql: `insert into finance_entries (id, kind, category, amount_kurus, occurred_on, account, to_account,
              description, counterparty, document_url, sponsor_id, event_id, member_id, dues_period_id,
              created_by, created_at, voided_at, voided_by, void_reason)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        e.id ?? id(0, ++n),
        e.kind,
        e.category ?? null,
        e.kurus,
        e.on,
        e.account,
        e.to ?? null,
        e.description ?? null,
        e.counterparty ?? null,
        e.doc ?? null,
        e.sponsor ?? null,
        e.event ?? null,
        e.member ?? null,
        e.period ?? null,
        yk,
        t - 3600 + n,
        e.voided ? t - 1800 : null,
        e.voided ? yk : null,
        e.voided ?? null,
      ],
    });
  };
  const dues = (email, period, kurus, on) =>
    entry({
      kind: "income",
      category: "dues",
      kurus,
      on,
      account: "cash",
      member: uid(email),
      period,
    });

  entry({ kind: "opening", kurus: 250000, on: `${m2}-01`, account: "cash" });
  entry({ kind: "opening", kurus: 1800000, on: `${m2}-01`, account: "bank" });

  // Roster of P1/P2: yk, korist and the 20 seeded members; yeni@ and asistan@ joined this month.
  const roster = [...users.values()]
    .filter(
      (u) =>
        (u[2] === "member" || u[2] === "board") &&
        u[0] !== "yeni@arkhe.local" &&
        u[0] !== "asistan@arkhe.local",
    )
    .map((u) => u[0]);
  for (const email of roster) {
    if (email === "onur.cetin@arkhe.local" || email === "baris.gunes@arkhe.local") continue;
    if (!email.endsWith("@arkhe.local")) continue;
    dues(
      email,
      FINANCE_IDS.periods[0],
      email === "ece.demir@arkhe.local" ? 15000 : 30000,
      `${m2}-08`,
    );
  }
  for (const email of P2_PAID) dues(email, FINANCE_IDS.periods[1], 30000, `${m1}-12`);
  dues("ece.demir@arkhe.local", FINANCE_IDS.periods[1], 15000, `${m1}-12`);
  dues("korist@arkhe.local", FINANCE_IDS.periods[1], 10000, `${m1}-12`);
  dues("ece.demir@arkhe.local", FINANCE_IDS.periods[2], 15000, `${m0}-01`);
  dues("yk@arkhe.local", FINANCE_IDS.periods[2], 30000, `${m0}-01`);
  dues("elif.yildiz@arkhe.local", FINANCE_IDS.periods[2], 30000, `${m0}-01`);

  const ev = FINANCE_IDS.event;
  entry({
    kind: "income",
    category: "sponsorship",
    kurus: 500000,
    on: `${m1}-03`,
    account: "bank",
    sponsor: FINANCE_IDS.sponsor,
    event: ev,
    description: "Kış Konseri sponsorluğu",
  });
  entry({
    id: FINANCE_IDS.venue,
    kind: "expense",
    category: "venue",
    kurus: 350000,
    on: `${m1}-18`,
    account: "bank",
    event: ev,
    description: "Salon kirası, konser günü",
    counterparty: "CSO Ada Ankara",
    doc: "https://drive.google.com/file/d/seedFaturaSalon/view",
  });
  entry({
    id: FINANCE_IDS.costume,
    kind: "expense",
    category: "costume",
    kurus: 120000,
    on: `${m1}-22`,
    account: "cash",
    event: ev,
    description: "Konser fularları",
  });
  entry({
    id: FINANCE_IDS.tickets,
    kind: "income",
    category: "tickets",
    kurus: 600000,
    on: `${m0}-01`,
    account: "bank",
    event: ev,
    description: "Ön satış biletleri",
  });
  entry({
    kind: "expense",
    category: "musician_fee",
    kurus: 210000,
    on: `${m0}-01`,
    account: "bank",
    event: ev,
    description: "Korrepetitör, konser hazırlığı",
    counterparty: "Ahmet Yılmaz (korrepetitör)",
    doc: "https://drive.google.com/file/d/seedMakbuzKorrep/view",
  });
  entry({ kind: "expense", category: "bank_fee", kurus: 1275, on: `${m1}-28`, account: "bank" });
  entry({
    kind: "transfer",
    kurus: 150000,
    on: `${m1}-20`,
    account: "cash",
    to: "bank",
    description: "Prova zarfı bankaya yatırıldı",
  });
  entry({
    id: FINANCE_IDS.voided,
    kind: "expense",
    category: "catering",
    kurus: 45000,
    on: `${m1}-05`,
    account: "cash",
    description: "Prova arası ikram",
    voided: "Yanlış girildi, fiş yok",
  });

  await client.batch(statements, "write");
}
