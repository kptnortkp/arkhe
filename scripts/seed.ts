// Fills a fresh local database with demo data. Refuses to run against a remote database.
//
// Expected report numbers for the current term ("2026–27 Güz") once yesterday's forgotten rehearsal
// has auto-closed (six counted rehearsals):
//   Barış Güneş (tenor): absent at two Wednesdays → 4/6 = %67, flagged.
//   Ceren Polat (alto): excused at two Wednesdays → 4/4 = %100, not flagged.
//   Demo Korist (alto): late once → 6/6 = %100.
//   Kaan Özdemir, Selin Çelik: unmarked yesterday → absent → 5/6 = %83.
//   Everyone else: 6/6 = %100.
// Also: one rehearsal opened yesterday and never closed (auto-closes on next visit),
// one past rehearsal never opened ("Yoklama alınmadı"), a weekly series ahead and a Tenor+Bas sectional.
import { count } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { assertFixtureTarget } from "./fixture-guard.mjs";
import { seedFinance } from "./finance-fixture.mjs";
import { seedHomework } from "./homework-fixture.mjs";
import {
  attendance,
  pieceLinks,
  pieces,
  rehearsalParts,
  rehearsals,
  terms,
  users,
  type AttendanceStatus,
  type LinkKind,
  type PieceStatus,
  type Role,
  type VoicePart,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { addDays, istanbulDateOf, istanbulToUtc } from "../src/lib/time";

const DEMO_PASSWORD = "arkhe-demo-2026";
const JOINED = istanbulToUtc("2025-09-01");
const LOCATION = "Mülkiye Konferans Salonu";

const LOGIN_ACCOUNTS: { name: string; email: string; role: Role; voicePart: VoicePart | null }[] = [
  { name: "Demo Şef", email: "sef@arkhe.local", role: "conductor", voicePart: null },
  { name: "Demo Yönetim", email: "yk@arkhe.local", role: "board", voicePart: "soprano" },
  { name: "Demo Korist", email: "korist@arkhe.local", role: "member", voicePart: "alto" },
];

const MEMBERS: Record<VoicePart, string[]> = {
  soprano: ["Elif Yıldız", "Zeynep Kaya", "Defne Arslan", "Ece Demir", "Selin Çelik", "İrem Şahin"],
  alto: ["Ayşe Öztürk", "Melis Aydın", "Nazlı Koç", "Buse Kurt", "Ceren Polat"],
  tenor: ["Can Erdoğan", "Emre Aksoy", "Kaan Özdemir", "Barış Güneş"],
  bass: ["Ozan Yılmaz", "Mert Doğan", "Burak Kılıç", "Deniz Aslan", "Onur Çetin"],
};

function slug(name: string) {
  return name
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, ".");
}

/** The most recent Wednesday strictly before `date`. */
function previousWednesday(date: string) {
  let d = addDays(date, -1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 3) d = addDays(d, -1);
  return d;
}

// Repertoire with fake Drive/YouTube ids, stored in normalised form (e2e compares hrefs).
// Learning: Aman Gülüm (Tutti part only), Ave Verum Corpus (alto file, 3:40), Hallelujah (no part files).
// Ready: Sicut Cervus, Bogoroditse Devo (Soprano 1/2). Archive: Abendlied. Programme: Sicut, Bogoroditse, Gülüm.
const D = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const F = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const Y = (id: string) => `https://www.youtube.com/watch?v=${id}`;
type SeedLink = [LinkKind, VoicePart | null, string | null, string];
const REPERTOIRE: {
  title: string;
  composer: string | null;
  arranger: string | null;
  language: string;
  voicing: string;
  durationSec: number;
  status: PieceStatus;
  programPosition: number | null;
  notes?: string;
  driveFolderUrl?: string;
  links: SeedLink[];
}[] = [
  {
    title: "Sicut Cervus",
    composer: "G. P. da Palestrina",
    arranger: null,
    language: "Latince",
    voicing: "SATB",
    durationSec: 170,
    status: "concert",
    programPosition: 1,
    links: [
      ["score", null, null, D("seedSicutNota")],
      ["part", "soprano", null, D("seedSicutSop")],
      ["part", "alto", null, D("seedSicutAlto")],
      ["part", "tenor", null, D("seedSicutTen")],
      ["part", "bass", null, D("seedSicutBas")],
      ["video", null, "Referans video (0:45'ten)", `${Y("arkheSicut1")}&t=45`],
    ],
  },
  {
    title: "Bogoroditse Devo",
    composer: "S. Rachmaninoff",
    arranger: null,
    language: "Rusça",
    voicing: "SSAATTBB",
    durationSec: 190,
    status: "concert",
    programPosition: 2,
    links: [
      ["score", null, null, D("seedBogoNota")],
      ["part", "soprano", "Soprano 1", D("seedBogoS1")],
      ["part", "soprano", "Soprano 2", D("seedBogoS2")],
      ["part", "alto", null, D("seedBogoAlto")],
      ["part", "tenor", null, D("seedBogoTen")],
      ["part", "bass", null, D("seedBogoBas")],
      ["recording", null, null, D("seedBogoKayit")],
    ],
  },
  {
    title: "Aman Gülüm",
    composer: "Halk türküsü",
    arranger: "Koro Arkhe",
    language: "Türkçe",
    voicing: "SATB",
    durationSec: 160,
    status: "learning",
    programPosition: 3,
    driveFolderUrl: F("seedGulumKlasor"),
    links: [
      ["part", null, "Tutti MP3", D("seedGulumTutti")],
      ["score", null, null, D("seedGulumNota")],
    ],
  },
  {
    title: "Ave Verum Corpus",
    composer: "W. A. Mozart",
    arranger: null,
    language: "Latince",
    voicing: "SATB",
    durationSec: 220,
    status: "learning",
    programPosition: null,
    notes: "2. kıtada tekrar yok, coda'ya atla.",
    links: [
      ["score", null, null, `${D("seedAveNota")}?resourcekey=0-seedKey123`],
      ["part", "soprano", null, D("seedAveSop")],
      ["part", "alto", null, D("seedAveAlto")],
      ["part", "tenor", null, D("seedAveTen")],
      ["part", "bass", null, D("seedAveBas")],
      ["video", null, null, Y("arkheAveV01")],
      ["other", null, "Sözler ve çeviri", "https://docs.google.com/document/d/seedAveSozler/edit"],
    ],
  },
  {
    title: "Hallelujah",
    composer: "L. Cohen",
    arranger: "K. Lavender",
    language: "İngilizce",
    voicing: "SSA",
    durationSec: 270,
    status: "learning",
    programPosition: null,
    links: [
      ["score", null, null, D("seedHallNota")],
      ["video", null, null, Y("arkheHall01")],
    ],
  },
  {
    title: "Abendlied",
    composer: "J. Rheinberger",
    arranger: null,
    language: "Almanca",
    voicing: "SSATTB",
    durationSec: 200,
    status: "archive",
    programPosition: null,
    driveFolderUrl: F("seedAbendKlasor"),
    links: [
      ["score", null, null, D("seedAbendNota")],
      ["recording", null, null, D("seedAbendKayit")],
    ],
  },
];

async function seedRepertoire(db: ReturnType<typeof createDb>, createdBy: string) {
  const [{ n }] = await db.select({ n: count() }).from(pieces);
  if (n > 0) return;
  for (const { links, ...piece } of REPERTOIRE) {
    const id = crypto.randomUUID();
    await db.insert(pieces).values({ id, ...piece, createdBy });
    await db.insert(pieceLinks).values(
      links.map(([kind, voicePart, label, url], i) => ({
        pieceId: id,
        kind,
        voicePart,
        label,
        url,
        position: i + 1,
      })),
    );
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "file:data/arkhe.db";
  if (!url.startsWith("file:") || process.env.NODE_ENV === "production") {
    console.error("Seed only runs against a local file database.");
    process.exit(1);
  }
  const db = createDb();
  assertFixtureTarget(db.$client);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const people = [
    ...LOGIN_ACCOUNTS.map((a) => ({ ...a, passwordHash, joinedAt: JOINED })),
    ...Object.entries(MEMBERS).flatMap(([part, names]) =>
      names.map((name, i) => ({
        name,
        email: `${slug(name)}@arkhe.local`,
        role: "member" as const,
        voicePart: part as VoicePart,
        joinedAt: JOINED,
        // Leave one per part without a password so "Davet bekliyor" shows up.
        passwordHash:
          i === names.length - 1 && name !== "Ceren Polat" && name !== "Barış Güneş"
            ? null
            : passwordHash,
      })),
    ),
  ];
  await db.insert(users).values(people).onConflictDoNothing({ target: users.email });

  const conductorRow = (await db.select().from(users)).find((u) => u.role === "conductor")!;
  await seedRepertoire(db, conductorRow.id);
  await seedHomework(db.$client, new Date());

  const [{ n }] = await db.select({ n: count() }).from(rehearsals);
  if (n === 0) await seedCalendar(db);
  else console.log("Rehearsals already exist; skipped calendar seed.");
  // After the calendar: the fixture's concert rehearsal would otherwise make a fresh DB skip it.
  await seedFinance(db.$client, new Date());

  console.log(
    `Seeded ${people.length} members, the demo calendar, ${REPERTOIRE.length} pieces and the demo ledger. Demo logins (password "${DEMO_PASSWORD}"):`,
  );
  for (const a of LOGIN_ACCOUNTS) console.log(`  ${a.email}  (${a.role})`);
}

async function seedCalendar(db: ReturnType<typeof createDb>) {
  const all = await db.select().from(users);
  // yeni@ (from the homework fixture) joined after these rehearsals.
  const choir = all.filter((u) => u.role !== "conductor" && u.email !== "yeni@arkhe.local");
  const conductor = all.find((u) => u.role === "conductor")!;
  const today = istanbulDateOf(new Date());

  await db.insert(terms).values([
    { name: "2025–26 Bahar", startsOn: "2026-02-01", endsOn: "2026-06-30" },
    { name: "2026–27 Güz", startsOn: "2026-09-15", endsOn: "2027-01-31" },
  ]);

  async function addRehearsal(
    date: string,
    opts: {
      type?: "tutti" | "sectional" | "dress" | "concert";
      parts?: VoicePart[];
      seriesId?: string | null;
      opened?: boolean;
      closed?: boolean;
      title?: string;
    } = {},
  ) {
    const id = crypto.randomUUID();
    const startsAt = istanbulToUtc(date, "19:00");
    await db.insert(rehearsals).values({
      id,
      type: opts.type ?? "tutti",
      title: opts.title ?? null,
      location: LOCATION,
      startsAt,
      endsAt: istanbulToUtc(date, "21:30"),
      seriesId: opts.seriesId ?? null,
      openedAt: opts.opened ? new Date(startsAt.getTime() - 10 * 60_000) : null,
      closedAt: opts.closed ? istanbulToUtc(date, "21:30") : null,
      createdBy: conductor.id,
    });
    if (opts.parts?.length) {
      await db
        .insert(rehearsalParts)
        .values(opts.parts.map((voicePart) => ({ rehearsalId: id, voicePart })));
    }
    return { id, startsAt };
  }

  // Five closed Wednesdays in the current term, newest last.
  const wednesdays: string[] = [];
  let cursor = today;
  while (wednesdays.length < 5) {
    cursor = previousWednesday(cursor);
    if (cursor <= addDays(today, -2)) wednesdays.unshift(cursor);
  }
  const pastSeries = crypto.randomUUID();
  for (const [index, date] of wednesdays.entries()) {
    const { id, startsAt } = await addRehearsal(date, {
      seriesId: pastSeries,
      opened: true,
      closed: true,
    });
    const recent = index >= 3;
    await db.insert(attendance).values(
      choir.map((u) => {
        let status: AttendanceStatus = "present";
        if (u.name === "Barış Güneş" && recent) status = "absent";
        if (u.name === "Ceren Polat" && recent) status = "excused";
        if (u.name === "Demo Korist" && index === 1) status = "late";
        return {
          rehearsalId: id,
          userId: u.id,
          status,
          method: status === "absent" ? ("auto" as const) : ("manual" as const),
          note: status === "excused" ? "Hastayım" : null,
          recordedAt: new Date(startsAt.getTime() + 5 * 60_000),
          recordedBy: conductor.id,
        };
      }),
    );
  }

  // Previous term, for switching periods in reports.
  for (const date of ["2026-05-06", "2026-05-13"]) {
    const { id, startsAt } = await addRehearsal(date, { opened: true, closed: true });
    await db.insert(attendance).values(
      choir.map((u) => ({
        rehearsalId: id,
        userId: u.id,
        status: (u.name === "Demo Korist" && date === "2026-05-13"
          ? "absent"
          : "present") as AttendanceStatus,
        method: "manual" as const,
        recordedAt: startsAt,
        recordedBy: conductor.id,
      })),
    );
  }

  // Opened yesterday, forgotten: closes itself on the next visit.
  const yesterday = await addRehearsal(addDays(today, -1), { opened: true, title: "Ek çalışma" });
  const forgotten = new Set(["Kaan Özdemir", "Selin Çelik"]);
  await db.insert(attendance).values(
    choir
      .filter((u) => !forgotten.has(u.name))
      .map((u) => ({
        rehearsalId: yesterday.id,
        userId: u.id,
        status: "present" as const,
        method: "code" as const,
        recordedAt: yesterday.startsAt,
        recordedBy: u.id,
      })),
  );

  // Past, never opened.
  await addRehearsal(addDays(today, -2), { type: "sectional", parts: ["soprano", "alto"] });

  // Ahead: a weekly series and a Tenor+Bas sectional.
  const series = crypto.randomUUID();
  let next = addDays(today, 1);
  while (new Date(`${next}T12:00:00Z`).getUTCDay() !== 3) next = addDays(next, 1);
  for (let i = 0; i < 4; i++) await addRehearsal(addDays(next, i * 7), { seriesId: series });
  await addRehearsal(addDays(next, 2), { type: "sectional", parts: ["tenor", "bass"] });
  await addRehearsal(addDays(next, 24), { type: "concert", title: "Güz konseri" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
