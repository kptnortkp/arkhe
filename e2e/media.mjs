// Phase 9 e2e helpers: a Chrome with a fake microphone, generated audio/MIDI fixtures, and small
// DB/file probes. Not matched by the runner's ^phase pattern.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { midiBytes, uploadsRoot, wavBytes } from "../scripts/media-fixture.mjs";
import { BASE, db } from "./lib.mjs";

export { midiBytes, wavBytes };
export const HW = (k) => `00000000-0000-4000-8000-00000000000${k}`;
export const SEED_REC = (n) => `00000000-0000-4000-9000-00000000000${n}`;
export const SEED_MIDI = (n) => `00000000-0000-4000-9100-00000000000${n}`;

/**
 * Chrome with the D27 media flags. Chrome 155 on macOS enumerates the fake devices but its
 * getUserMedia never settles, so the context also swaps getUserMedia for a stream that loops the
 * test's generated WAV through Web Audio: MediaRecorder, the route and the DB still run for real.
 */
export async function launchWithMic() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arkhe-mic-"));
  const wav = path.join(dir, "tone.wav");
  await writeFile(wav, wavBytes({ seconds: 4, hz: 440, rate: 48000 }));
  const browser = await chromium.launch({
    channel: "chrome",
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  return {
    browser,
    close: async () => {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Installs the WAV-backed microphone on a context (see launchWithMic). */
export async function fakeMic(context, { seconds = 4, hz = 440 } = {}) {
  const b64 = wavBytes({ seconds, hz, rate: 48000 }).toString("base64");
  await context.addInitScript((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      src.start();
      return dest.stream;
    };
  }, b64);
}

/** A phone context in the mic browser, logged in. */
export async function micPage(browser, email, { phone = true, extra = {} } = {}) {
  const { login, newPage } = await import("./lib.mjs");
  const page = await newPage(browser, { phone, context: { permissions: ["microphone"], ...extra } });
  await fakeMic(page.context());
  await login(page, email);
  await page.waitForURL(`${BASE}/`);
  return page;
}

/** A RIFF/WAVE file of exactly `n` bytes (silence), for the 4 MB boundary. */
export function wavOfSize(n) {
  const b = Buffer.alloc(n);
  const data = n - 44;
  b.write("RIFF", 0);
  b.writeUInt32LE(n - 8, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(data, 40);
  return b;
}

/** ID3 tag plus MPEG-1 Layer III frames (128 kbps, 44.1 kHz): passes the two-frame sniff. */
export function mp3Bytes(frames = 40) {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const frameLen = Math.floor((144 * 128000) / 44100);
  const frame = Buffer.alloc(frameLen);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;
  return Buffer.concat([id3, ...Array.from({ length: frames }, () => frame)]);
}

export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)]);

export const AVE_TUTTI_TRACKS = ["Soprano", "Alto", "Tenor", "Bas"];

/** A playable MIDI of `seconds` length on one or more named tracks. */
export function longMidi({ seconds = 20, names = ["Tenor"], bpm = 60 } = {}) {
  const q = 480;
  return midiBytes({
    bpm,
    tracks: names.map((name, i) => ({
      name,
      notes: Array.from({ length: Math.ceil((seconds * bpm) / 60) }, (_, k) => [55 + i * 4, k * q, q - 30, 80]),
    })),
  });
}

/** Uploads a body as the page's user; `origin: null` omits the header (AC 6). */
export async function uploadRaw(page, assignmentId, body, { origin = BASE, uploadId, durationMs, contentType } = {}) {
  const headers = { "X-Upload-Id": uploadId ?? crypto.randomUUID() };
  if (origin) headers.Origin = origin;
  if (durationMs !== undefined) headers["X-Recording-Duration-Ms"] = String(durationMs);
  if (contentType) headers["Content-Type"] = contentType;
  const res = await page.request.post(`${BASE}/api/dosya/kayit?odev=${assignmentId}`, {
    headers,
    data: body,
    failOnStatusCode: false,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json };
}

export async function recordingFiles() {
  try {
    return (await readdir(path.join(uploadsRoot(), "recordings"))).filter((n) => !n.includes(".tmp-"));
  } catch {
    return [];
  }
}

export async function midiFiles() {
  try {
    return await readdir(path.join(uploadsRoot(), "midi"));
  } catch {
    return [];
  }
}

export async function fileExists(key) {
  const dir = key.split("/")[0];
  const name = key.split("/")[1];
  return (dir === "midi" ? await midiFiles() : await recordingFiles()).includes(name);
}

export async function one(sql, args = []) {
  return (await db.execute({ sql, args })).rows[0] ?? null;
}

export async function all(sql, args = []) {
  return (await db.execute({ sql, args })).rows;
}

/** The current take of (assignment, user email). */
export async function currentTake(assignmentId, email) {
  return one(
    `select r.* from recordings r join users u on u.id = r.user_id
     where r.assignment_id = ? and u.email = ? and r.replaced_at is null`,
    [assignmentId, email],
  );
}

/** Seconds since epoch `days` from now. */
export const ago = (days, hours = 0) => Math.floor(Date.now() / 1000) - days * 86400 - hours * 3600;

/** Istanbul calendar day for an epoch second, "YYYY-MM-DD". */
export const istanbulDay = (sec) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(sec * 1000));

export const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "19 Oca 2027": the UI's audit date of a business day. */
export const auditDay = (day) =>
  new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${day}T12:00:00Z`),
  );

/** Cookie for the dev-only hooks (D21, D37). */
export async function setHook(page, name, value) {
  const ctx = page.context();
  if (value === null) {
    const cookies = (await ctx.cookies()).filter((c) => c.name !== name);
    await ctx.clearCookies();
    await ctx.addCookies(cookies);
    return;
  }
  await ctx.addCookies([{ name, value, url: BASE }]);
}

/** Every page request the test cares about (uploads, file deliveries, chunks). */
export function requestLog(page) {
  const log = [];
  page.on("request", (r) => log.push({ url: r.url(), method: r.method() }));
  return log;
}

/**
 * Arranges a take directly (DB row, optional file, the submission). `deleted` marks the audio
 * gone with that reason; `replaced` makes it a historical take (counts toward the 5 uploads).
 */
export async function insertTake({
  assignmentId,
  email,
  uploadedAt = ago(0, 1),
  commentedAt = null,
  deleteOn,
  size,
  withFile = true,
  replaced = false,
  deleted = null,
  submit = true,
  durationMs = 3000,
}) {
  const { keyPath } = await import("../src/lib/storage/root.mjs");
  const user = (await one("select id from users where email = ?", [email])).id;
  const id = crypto.randomUUID();
  const key = `recordings/${crypto.randomUUID()}.wav`;
  const wav = wavBytes({ seconds: 1 });
  const bytes = size ?? wav.length;
  const gone = replaced ? "replaced" : deleted;
  const day = istanbulDay(commentedAt ?? uploadedAt);
  await db.execute({
    sql: `insert into recordings (id, assignment_id, user_id, storage_key, content_type, size_bytes,
            duration_ms, uploaded_at, replaced_at, commented_at, delete_on, audio_deleted_at, deleted_reason)
          values (?, ?, ?, ?, 'audio/wav', ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      assignmentId,
      user,
      key,
      bytes,
      durationMs,
      uploadedAt,
      replaced ? uploadedAt : null,
      replaced ? null : commentedAt,
      deleteOn ?? addDays(day, commentedAt ? 90 : 120),
      gone ? uploadedAt : null,
      gone,
    ],
  });
  if (gone) await db.execute({ sql: "delete from storage_deletions where storage_key = ?", args: [key] });
  if (withFile && !gone) {
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    const file = keyPath(uploadsRoot(), key);
    await mkdir(path.dirname(file), { recursive: true });
    await wf(file, wav);
  }
  if (submit) {
    await db.execute({
      sql: `insert into submissions (assignment_id, user_id, submitted_at, method)
            values (?, ?, ?, 'self')
            on conflict(assignment_id, user_id) do update set submitted_at = coalesce(submissions.submitted_at, excluded.submitted_at),
              method = coalesce(submissions.method, 'self')`,
      args: [assignmentId, user, uploadedAt],
    });
  }
  return { id, key, user };
}

const axeSource = (await import("node:fs")).readFileSync(
  (await import("node:module")).createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

/** Serious/critical axe violations (contrast on), as short strings. */
export async function axe(page, scope = null) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (sel) => {
    const r = await window.axe.run(sel ? document.querySelector(sel) : document, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: true } },
    });
    return r.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  }, scope);
}

/** AC 57 layout probes: page-level horizontal overflow and visible targets under 44 px in `scope`. */
export async function layoutIssues(page, scope = "main") {
  return page.evaluate((sel) => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) {
      issues.push(`overflow ${document.documentElement.scrollWidth}>${innerWidth}`);
    }
    const root = document.querySelector(sel) ?? document.body;
    for (const el of root.querySelectorAll("button, a[href], summary, input[type=range], [role=checkbox], [role=radio]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || el.closest(".sr-only")) continue;
      // Inline text links inside sentences are exempt (WCAG 2.5.8 inline exception).
      if (el.tagName === "A" && style.display === "inline") continue;
      if (r.height < 43.5) issues.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.height)}px`);
    }
    // A truncated label squeezed to a few letters (roster names at 375 px, review P1-1).
    for (const el of root.querySelectorAll(".truncate")) {
      if (el.clientWidth > 0 && el.clientWidth < 64 && el.scrollWidth > el.clientWidth + 1) {
        issues.push(`truncated "${el.textContent.trim().slice(0, 30)}" to ${el.clientWidth}px`);
      }
    }
    return issues;
  }, scope);
}

/** Hex colours in Phase 9 component sources (tokens only, AC 57). */
export async function rawHex() {
  const { readdir: rd, readFile } = await import("node:fs/promises");
  const found = [];
  const dirs = ["recording", "review", "storage", "midi"].map((d) => path.join(path.dirname(new URL(import.meta.url).pathname), "../src/components", d));
  for (const dir of dirs) {
    for (const f of await rd(dir)) {
      const text = await readFile(path.join(dir, f), "utf8");
      if (/#[0-9a-fA-F]{3,8}\b/.test(text.replace(/href=|#kayit|#yer-ac|#baska-yolla/g, ""))) found.push(f);
    }
  }
  return found;
}

/** An @e2e.test user with the demo password (copied hash). */
export async function createUser(email, name, { part = "alto", role = "member", joinedDaysAgo = 200 } = {}) {
  const hash = (await one("select password_hash from users where email = 'korist@arkhe.local'")).password_hash;
  const id = crypto.randomUUID();
  await db.execute({
    sql: "insert into users (id, name, email, role, voice_part, password_hash, joined_at) values (?, ?, ?, ?, ?, ?, ?)",
    args: [id, name, email, role, part, hash, ago(joinedDaysAgo)],
  });
  return id;
}

/** An E2E homework (its own E2E piece) due `dueDays` from now, for `parts`. */
export async function insertAssignment({ dueDays, parts = ["soprano", "alto", "tenor", "bass"], title = "E2E Kayıt Eseri" }) {
  const piece = crypto.randomUUID();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.batch(
    [
      { sql: "insert into pieces (id, title, status) values (?, ?, 'learning')", args: [piece, title] },
      {
        sql: "insert into assignments (id, piece_id, description, due_at, created_at, updated_at) values (?, ?, 'E2E kayıt', ?, ?, ?)",
        args: [id, piece, now + Math.round(dueDays * 86400), now - 60 * 86400, now - 60 * 86400],
      },
      ...parts.map((p) => ({ sql: "insert into assignment_parts values (?, ?)", args: [id, p] })),
    ],
    "write",
  );
  return { id, piece };
}

/** A note by `assistantId` on the current take of (assignment, singer). */
export async function insertNote(assignmentId, singerId, assistantId, body) {
  const rec = await one(
    "select id from recordings where assignment_id = ? and user_id = ? and replaced_at is null",
    [assignmentId, singerId],
  );
  const t = Math.floor(Date.now() / 1000) - 60;
  await db.execute({
    sql: `insert into assistant_notes (assignment_id, singer_id, assistant_id, recording_id, body, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?)
          on conflict(assignment_id, singer_id, assistant_id) do update set body = excluded.body, recording_id = excluded.recording_id`,
    args: [assignmentId, singerId, assistantId, rec.id, body, t, t],
  });
}

/** The conductor's comment arranged directly, with the take's retention moved as saveFeedback does. */
export async function arrangeComment(assignmentId, singerId, text, { byEmail = "sef@arkhe.local", at } = {}) {
  const by = (await one("select id from users where email = ?", [byEmail])).id;
  const t = at ?? Math.floor(Date.now() / 1000);
  await db.execute({
    sql: "update submissions set feedback = ?, feedback_by = ?, feedback_at = ?, feedback_seen_at = null where assignment_id = ? and user_id = ?",
    args: [text, by, t, assignmentId, singerId],
  });
  if (byEmail === "sef@arkhe.local") {
    await db.execute({
      sql: "update recordings set commented_at = ?, delete_on = ? where assignment_id = ? and user_id = ? and replaced_at is null and commented_at is null",
      args: [t, addDays(istanbulDay(t), 90), assignmentId, singerId],
    });
  }
}

/** goto, then wait until React has hydrated the page (forms submit through JS, not natively). */
export async function go(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => {
      if (document.querySelector("main [aria-busy=true]")) return false;
      const el = document.querySelector("main form, main button, main a");
      return !el || Object.keys(el).some((k) => k.startsWith("__react"));
    },
    null,
    { timeout: 20000 },
  );
}

/** A MIDI row plus its file, for a piece (arranged). */
export async function insertMidi(pieceId, { part = null, label = null, bytes }) {
  const { keyPath } = await import("../src/lib/storage/root.mjs");
  const { mkdir, writeFile: wf } = await import("node:fs/promises");
  const id = crypto.randomUUID();
  const key = `midi/${crypto.randomUUID()}.mid`;
  await db.execute({
    sql: "insert into midi_files (id, piece_id, voice_part, label, storage_key, size_bytes, created_by, created_at) values (?, ?, ?, ?, ?, ?, (select id from users where email = 'sef@arkhe.local'), unixepoch())",
    args: [id, pieceId, part, label, key, bytes.length],
  });
  const file = keyPath(uploadsRoot(), key);
  await mkdir(path.dirname(file), { recursive: true });
  await wf(file, bytes);
  return { id, key };
}
