// Demo recordings, the assistant appointment and MIDI files (Phase 9, D26/D57), re-anchored to the
// homework fixture on every call. Called at the end of seedHomework, so seed.ts, e2e cleanup() and
// phase4's mid-test reseed always leave a consistent fixture. Raw SQL on a libSQL client.
//
// asistan@arkhe.local (Demo Asistan, member, tenor, joined T−1h) assists Soprano + Alto.
// Recordings (3 s 8 kHz WAV, 48,044 B) on existing fixture submissions only:
//   1 D · Ayşe Öztürk (alto)   live, asistan@'s note, no comment
//   2 D · Melis Aydın (alto)   live
//   3 D · Nazlı Koç (alto)     live, late ("Geç")
//   4 D · Emre Aksoy (tenor)   live, outside asistan@'s scope
//   5 D · Defne Arslan (soprano) live
//   6 E · Ayşe Öztürk (alto)   live, commented (delete_on = comment day + 90, in the future)
//   7 E · korist@ (alto)       commented, audio deleted by the conductor (no file)
// MIDI on Ave Verum Corpus: Tutti (tracks Soprano, Alto, Tenor, Bas) and Alto.
//
// Expected counts on a fresh seed (the ACs compare against these):
//   asistan@  Dinlenecek 3 (Melis, Nazlı Geç, Defne) = home card and header pill; Not yazdıklarım 1
//   sef@      Yorum bekleyen 17 (5 live takes + 12 submissions without a take), Asistan notlu 1
//             = data-review-badge 1, Yorumlananlar 2 (E · Ayşe, E · korist@)
//   korist@   transparency names "Demo Asistan"; a tenor sees "Kaydını yalnızca şef dinler."

import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dbUrlOf, keyPath, KEY_PATTERN, uploadsRootFor } from "../src/lib/storage/root.mjs";
import { assertFixtureTarget } from "./fixture-guard.mjs";

const H = 3600;
const D = 24 * H;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HW = (k) => `00000000-0000-4000-8000-00000000000${k}`;
export const SEED_RECORDING_KEY_PATTERN = "recordings/00000000-0000-4000-9001-%";
export const SEED_MIDI_KEY_PATTERN = "midi/00000000-0000-4000-9101-%";
export const ASSISTANT_EMAIL = "asistan@arkhe.local";
export const ASSISTANT_NOTE = "Girişte tempo kaçıyor, 12. ölçüde nefes erken.";

/** The uploads folder of the fixture's database (one per database, see src/lib/storage/root.mjs). */
export function uploadsRoot() {
  return uploadsRootFor(dbUrlOf(process.env), REPO);
}

/** 16-bit PCM mono WAV with a sine tone. */
export function wavBytes({ seconds = 3, hz = 440, rate = 8000 } = {}) {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000), 44 + i * 2);
  }
  return buf;
}

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

/**
 * A Standard MIDI File, format 1, PPQ timing: a tempo track plus one track per entry.
 * tracks: [{ name, notes: [[pitch, startTick, durTicks, velocity]] }]
 */
export function midiBytes({ ppq = 480, bpm = 72, tracks }) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.write(type, 0);
    head.writeUInt32BE(data.length, 4);
    return Buffer.concat([head, Buffer.from(data)]);
  };
  const usPerBeat = Math.round(60_000_000 / bpm);
  const tempo = [
    0,
    0xff,
    0x51,
    3,
    (usPerBeat >> 16) & 0xff,
    (usPerBeat >> 8) & 0xff,
    usPerBeat & 0xff,
  ];
  const header = Buffer.alloc(14);
  header.write("MThd", 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(tracks.length + 1, 10);
  header.writeUInt16BE(ppq, 12);
  const parts = [header, chunk("MTrk", [...tempo, 0, 0xff, 0x2f, 0])];
  tracks.forEach((t, channel) => {
    const name = [...Buffer.from(t.name, "utf8")];
    const events = [];
    for (const [pitch, start, dur, vel] of t.notes) {
      events.push([start, 1, [0x90 | channel, pitch, vel]]);
      events.push([start + dur, 0, [0x80 | channel, pitch, 0]]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const data = [0, 0xff, 0x03, ...vlq(name.length), ...name];
    let tick = 0;
    for (const [at, , bytes] of events) {
      data.push(...vlq(at - tick), ...bytes);
      tick = at;
    }
    data.push(0, 0xff, 0x2f, 0);
    parts.push(chunk("MTrk", data));
  });
  return Buffer.concat(parts);
}

const q = 480;
const line = (pitches, from = 0) =>
  pitches.map((p, i) => [p, from + i * q, q - 20, 80]).filter((n) => n[0] !== null);
const AVE = {
  Soprano: line([74, 74, 79, 78, 76, 76, 74, 74]),
  Alto: line([69, 69, 71, 69, 69, 67, 66, 66]),
  Tenor: line([62, 62, 62, 62, 61, 61, 62, 62]),
  Bas: line([50, 50, 55, 50, 57, 57, 50, 50]),
};

const RECORDINGS = [
  [1, "d", "ayse.ozturk@arkhe.local", {}],
  [2, "d", "melis.aydin@arkhe.local", {}],
  [3, "d", "nazli.koc@arkhe.local", {}],
  [4, "d", "emre.aksoy@arkhe.local", {}],
  [5, "d", "defne.arslan@arkhe.local", {}],
  [6, "e", "ayse.ozturk@arkhe.local", { commented: true }],
  [7, "e", "korist@arkhe.local", { commented: true, deleted: true }],
];
const recId = (n) => `00000000-0000-4000-9000-00000000000${n}`;
const recKey = (n) => `recordings/00000000-0000-4000-9001-00000000000${n}.wav`;
const midiId = (n) => `00000000-0000-4000-9100-00000000000${n}`;
const midiKey = (n) => `midi/00000000-0000-4000-9101-00000000000${n}.mid`;

const istanbulDay = (s) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(s * 1000));
const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * D * 1000).toISOString().slice(0, 10);

/** Statements seedHomework runs before it deletes the fixture homework (the cascade queues keys). */
export const CLEAR_SEED_QUEUE = `delete from storage_deletions where storage_key like '${SEED_RECORDING_KEY_PATTERN}' or storage_key like '${SEED_MIDI_KEY_PATTERN}'`;

async function writeAtomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
}

/** Seeds the media rows on top of seedHomework's submissions, then the files. */
export async function seedMedia(client, T = new Date()) {
  assertFixtureTarget(client);
  const t = Math.floor(T.getTime() / 1000);
  const one = async (sql, args = []) => (await client.execute({ sql, args })).rows[0]?.[0] ?? null;
  const sef = await one("select id from users where email = 'sef@arkhe.local'");
  const hash = await one("select password_hash from users where email = 'korist@arkhe.local'");
  const ave = await one("select id from pieces where title = 'Ave Verum Corpus'");
  if (!sef || !hash || !ave) throw new Error("seedMedia needs the seeded users and repertoire.");

  await client.execute({
    sql: `insert into users (id, name, email, role, voice_part, password_hash, joined_at)
          values (?, 'Demo Asistan', '${ASSISTANT_EMAIL}', 'member', 'tenor', ?, ?)
          on conflict(email) do update set name = 'Demo Asistan', joined_at = excluded.joined_at,
            is_active = 1, left_at = null, voice_part = 'tenor', role = 'member',
            password_hash = excluded.password_hash`,
    args: [crypto.randomUUID(), hash, t - H],
  });
  const asistan = await one(`select id from users where email = '${ASSISTANT_EMAIL}'`);

  const wav = wavBytes();
  const statements = [
    "delete from listening_assistants",
    ...["soprano", "alto"].map((part) => ({
      sql: "insert into listening_assistants (user_id, voice_part, created_by, created_at) values (?, ?, ?, ?)",
      args: [asistan, part, sef, t - 3 * D],
    })),
    // Queued by the trigger; the reconcile below removes their files.
    { sql: "delete from midi_files where piece_id = ?", args: [ave] },
  ];
  for (const [n, key, email, o] of RECORDINGS) {
    const user = await one("select id from users where email = ?", [email]);
    const sub = (
      await client.execute({
        sql: "select submitted_at, feedback_at from submissions where assignment_id = ? and user_id = ?",
        args: [HW(key), user],
      })
    ).rows[0];
    if (!sub?.submitted_at) throw new Error(`seedMedia: no submission for ${n}`);
    const up = Number(sub.submitted_at);
    const commented = o.commented ? Number(sub.feedback_at) : null;
    statements.push({
      sql: `insert into recordings (id, assignment_id, user_id, storage_key, content_type, size_bytes,
              duration_ms, uploaded_at, commented_at, delete_on, audio_deleted_at, deleted_reason)
            values (?, ?, ?, ?, 'audio/wav', ?, 3000, ?, ?, ?, ?, ?)`,
      args: [
        recId(n),
        HW(key),
        user,
        recKey(n),
        wav.length,
        up,
        commented,
        commented ? addDays(istanbulDay(commented), 90) : addDays(istanbulDay(up), 120),
        o.deleted ? t - D : null,
        o.deleted ? "conductor" : null,
      ],
    });
  }
  statements.push({
    sql: "insert into assistant_notes (assignment_id, singer_id, assistant_id, recording_id, body, created_at, updated_at) values (?, (select id from users where email = 'ayse.ozturk@arkhe.local'), ?, ?, ?, ?, ?)",
    args: [HW("d"), asistan, recId(1), ASSISTANT_NOTE, t - 2 * H, t - 2 * H],
  });
  const tutti = midiBytes({
    tracks: Object.entries(AVE).map(([name, notes]) => ({ name, notes })),
  });
  const alto = midiBytes({ tracks: [{ name: "Alto", notes: AVE.Alto }] });
  for (const [n, part, bytes] of [
    [1, null, tutti],
    [2, "alto", alto],
  ]) {
    statements.push({
      sql: "insert into midi_files (id, piece_id, voice_part, label, storage_key, size_bytes, created_by, created_at) values (?, ?, ?, null, ?, ?, ?, ?)",
      args: [midiId(n), ave, part, midiKey(n), bytes.length, sef, t - 3 * D],
    });
  }
  // The seed's own keys must never sit in the queue while live.
  statements.push(CLEAR_SEED_QUEUE);
  await client.batch(statements, "write");

  const root = uploadsRoot();
  for (const [n, , , o] of RECORDINGS) {
    if (!o.deleted) await writeAtomic(keyPath(root, recKey(n)), wav);
  }
  await writeAtomic(keyPath(root, midiKey(1)), tutti);
  await writeAtomic(keyPath(root, midiKey(2)), alto);
  await reconcileLocalUploads(client);
}

/**
 * Deletes every file under the uploads root that no live row references (and no in-flight upload
 * holds). Never touches anything outside <root>/recordings and <root>/midi.
 */
export async function reconcileLocalUploads(client) {
  assertFixtureTarget(client);
  const root = uploadsRoot();
  const live = new Set(
    (
      await client.execute(
        `select storage_key from recordings where audio_deleted_at is null
         union all select storage_key from midi_files
         union all select storage_key from storage_deletions where state = 'pending' and not_before > unixepoch()`,
      )
    ).rows.map((r) => String(r[0])),
  );
  for (const dir of ["recordings", "midi"]) {
    let names = [];
    try {
      names = await readdir(path.join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      const key = `${dir}/${name}`;
      const stale = name.includes(".tmp-") || (KEY_PATTERN.test(key) && !live.has(key));
      if (stale) await unlink(path.join(root, dir, name)).catch(() => {});
    }
  }
}

/** e2e: media rows that point at @e2e.test users, before those users are deleted (db.md §12.1). */
export async function clearE2eMedia(client) {
  assertFixtureTarget(client);
  const e2e = "select id from users where email like '%@e2e.test'";
  await client.batch(
    [
      `delete from assistant_notes where assistant_id in (${e2e}) or singer_id in (${e2e})`,
      `delete from recordings where user_id in (${e2e})`,
      `delete from listening_assistants where user_id in (${e2e}) or created_by in (${e2e})`,
      `delete from midi_files where created_by in (${e2e})`,
    ],
    "write",
  );
}
