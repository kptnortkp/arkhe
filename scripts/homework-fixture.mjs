// Demo homework, re-anchored to `T` (seed time, or "now" when e2e cleans up) so badge texts
// like "5 gün kaldı" never drift. Shared by scripts/seed.ts and e2e/lib.mjs; raw SQL on a libSQL client.
//
// Seeded homework (korist@ is alto; Güncel badge = A, B, C, D = 4; yk@ = B, C = 2):
//   A Ave Verum Corpus · Ölçü 12–34, SATB, due T+4d12h → green "5 gün kaldı"
//   B Aman Gülüm · Tüm eser, S+A,   due T+1d12h → amber "2 gün kaldı"
//   C Bogoroditse Devo · Ölçü 1–16, SATB, due T+4h30m → red "5 saat kaldı"
//   D Sicut Cervus · Tüm eser, SATB, due T−2d12h → red "Gecikti · 2 gün"; S 4/7 · A 3/6 · T 3/4 · B 3/5 = 13/22
//   E Hallelujah · Ölçü 1–24, S+A, due T−10d → Geçmiş; korist submitted, unread note by the conductor
//   F Sicut Cervus · Ölçü 25–40, T+B, due T+3d12h → not korist's part
// yeni@arkhe.local (Arda Tan, tenor) joins at T−1h: after every seeded homework, so expected nowhere.

import { assertFixtureTarget } from "./fixture-guard.mjs";

const H = 3600;
const D = 24 * H;
export const HOMEWORK_IDS = Object.fromEntries(
  ["a", "b", "c", "d", "e", "f"].map((k) => [k, `00000000-0000-4000-8000-00000000000${k}`]),
);
const ID_PATTERN = "00000000-0000-4000-8000-0000000000%";
export const RECORDING_EMAIL = "kayit@arkhe.local";

const HOMEWORK = [
  {
    key: "a",
    piece: "Ave Verum Corpus",
    bars: [12, 34],
    parts: "SATB",
    created: -2 * D,
    due: 4 * D + 12 * H,
    description: "Girişlere dikkat. Metronom 60 ile, MIDI'yi kulaklıkla dinleyerek söyle.",
  },
  {
    key: "b",
    piece: "Aman Gülüm",
    bars: null,
    parts: "SA",
    created: -D,
    due: D + 12 * H,
    description: "Türkü ritmini otur; 2. kıtada nefes yerleri işaretli.",
  },
  {
    key: "c",
    piece: "Bogoroditse Devo",
    bars: [1, 16],
    parts: "SATB",
    created: -D,
    due: 4 * H + 30 * 60,
    description: "Rusça telaffuz: önce sadece sözleri oku, sonra söyle.",
  },
  {
    key: "d",
    piece: "Sicut Cervus",
    bars: null,
    parts: "SATB",
    created: -9 * D,
    due: -(2 * D + 12 * H),
    description: "Tüm eser, tempo 72.",
  },
  {
    key: "e",
    piece: "Hallelujah",
    bars: [1, 24],
    parts: "SA",
    created: -17 * D,
    due: -10 * D,
    description: "Pianoda yumuşak girişler.",
  },
  {
    key: "f",
    piece: "Sicut Cervus",
    bars: [25, 40],
    parts: "TB",
    created: -D,
    due: 3 * D + 12 * H,
    description: "Erkekler: 30. ölçüdeki geçişi temiz al.",
  },
];
const PART_CODES = { S: "soprano", A: "alto", T: "tenor", B: "bass" };

// [homework, email, kind] with kind on | late | manual | note
const SUBMISSIONS = [
  ["a", "yk@arkhe.local", "on"],
  ["b", "elif.yildiz@arkhe.local", "on"],
  ["f", "can.erdogan@arkhe.local", "on"],
  ...[
    "yk@arkhe.local",
    "elif.yildiz@arkhe.local",
    "zeynep.kaya@arkhe.local",
    "defne.arslan@arkhe.local",
    "ayse.ozturk@arkhe.local",
    "melis.aydin@arkhe.local",
    "can.erdogan@arkhe.local",
    "emre.aksoy@arkhe.local",
    "ozan.yilmaz@arkhe.local",
    "mert.dogan@arkhe.local",
    "burak.kilic@arkhe.local",
  ].map((email) => ["d", email, "on"]),
  ["d", "nazli.koc@arkhe.local", "late"],
  ["d", "kaan.ozdemir@arkhe.local", "manual"],
  ["d", "ceren.polat@arkhe.local", "note", "Kaydın gelmedi, cumartesiye kadar gönderebilirsin."],
  ["e", "korist@arkhe.local", "on", "Girişler çok iyi, 20. ölçüde nefesi erken alıyorsun."],
  ["e", "yk@arkhe.local", "on"],
  ["e", "ayse.ozturk@arkhe.local", "on"],
];

/** Deletes and reinserts the demo homework relative to `T` (a Date). */
export async function seedHomework(client, T = new Date()) {
  assertFixtureTarget(client);
  const t = Math.floor(T.getTime() / 1000);
  const ids = async (sql) => new Map((await client.execute(sql)).rows.map((r) => [r[0], r[1]]));
  const users = await ids("select email, id from users");
  const pieces = await ids("select title, id from pieces");
  const sef = users.get("sef@arkhe.local");
  const korist = (
    await client.execute({
      sql: "select password_hash from users where email = ?",
      args: ["korist@arkhe.local"],
    })
  ).rows[0];
  if (!sef || !korist || HOMEWORK.some((h) => !pieces.has(h.piece))) {
    throw new Error("seedHomework needs the seeded users and repertoire.");
  }

  const statements = [
    `delete from submissions where assignment_id like '${ID_PATTERN}'`,
    `delete from assignment_parts where assignment_id like '${ID_PATTERN}'`,
    `delete from assignments where id like '${ID_PATTERN}'`,
    {
      sql: "insert into app_settings (key, value, updated_at) values ('recording_email', ?, ?) on conflict(key) do update set value = excluded.value",
      args: [RECORDING_EMAIL, t],
    },
    {
      sql: `insert into users (id, name, email, role, voice_part, password_hash, joined_at)
            values (?, 'Arda Tan', 'yeni@arkhe.local', 'member', 'tenor', ?, ?)
            on conflict(email) do update set joined_at = excluded.joined_at, is_active = 1, left_at = null,
              voice_part = 'tenor', role = 'member', password_hash = excluded.password_hash`,
      args: [crypto.randomUUID(), korist.password_hash, t - H],
    },
  ];
  const due = new Map();
  for (const h of HOMEWORK) {
    const id = HOMEWORK_IDS[h.key];
    due.set(h.key, t + h.due);
    statements.push({
      sql: "insert into assignments (id, piece_id, bar_from, bar_to, description, due_at, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        id,
        pieces.get(h.piece),
        h.bars?.[0] ?? null,
        h.bars?.[1] ?? null,
        h.description,
        t + h.due,
        sef,
        t + h.created,
        t + h.created,
      ],
    });
    for (const code of h.parts) {
      statements.push({
        sql: "insert into assignment_parts (assignment_id, voice_part) values (?, ?)",
        args: [id, PART_CODES[code]],
      });
    }
  }
  for (const [key, email, kind, note] of SUBMISSIONS) {
    const userId = users.get(email);
    if (!userId) throw new Error(`seedHomework: missing user ${email}`);
    const dueAt = due.get(key);
    const onTime = Math.min(dueAt - D, t - H);
    const submittedAt =
      kind === "note" ? null : kind === "late" ? t - D : kind === "manual" ? dueAt - 2 * H : onTime;
    const method = kind === "note" ? null : kind === "manual" ? "manual" : "self";
    statements.push({
      sql: "insert into submissions (assignment_id, user_id, submitted_at, method, marked_by, feedback, feedback_by, feedback_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        HOMEWORK_IDS[key],
        userId,
        submittedAt,
        method,
        kind === "manual" ? sef : null,
        note ?? null,
        note ? sef : null,
        note ? (kind === "note" ? t - 2 * D : dueAt + D) : null,
      ],
    });
  }
  await client.batch(statements, "write");
}
