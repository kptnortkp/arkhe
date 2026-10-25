// Phase 11 e2e helpers: score PDFs, the OMR outbox and HMAC-signed workflow requests (D98, D105).
// Not matched by the runner's ^phase pattern.
import { createHash, createHmac } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { midiBytes } from "../scripts/media-fixture.mjs";
import { BASE, db } from "./lib.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OMR_OUTBOX = path.join(ROOT, "data/omr-outbox");
export const OMR_SECRET = process.env.OMR_CALLBACK_SECRET ?? "dev-only-omr-callback-secret";

/** A minimal PDF of about `size` bytes (padding in a comment), `%PDF-` first and `%%EOF` last. */
export function pdfBytes(size = 2048) {
  const head = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%";
  const tail = "\n%%EOF\n";
  const pad = Math.max(0, size - head.length - tail.length);
  return Buffer.concat([Buffer.from(head), Buffer.alloc(pad, 0x41), Buffer.from(tail)]);
}

export async function newPiece(title) {
  const id = crypto.randomUUID();
  await db.execute({ sql: "insert into pieces (id, title, status) values (?, ?, 'learning')", args: [id, title] });
  return id;
}

/** POST the raw PDF as the page's user (route handler, D94). */
export async function uploadScore(page, pieceId, body, { origin = BASE } = {}) {
  const headers = { "Content-Type": "application/octet-stream" };
  if (origin) headers.Origin = origin;
  const res = await page.request.post(`${BASE}/api/dosya/nota?eser=${pieceId}`, { headers, data: body, failOnStatusCode: false });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json };
}

export function sign(secret, ts, method, pathname, body) {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${ts}.${method}.${pathname}.${digest}`).digest("hex");
}

/**
 * A workflow request: `kind` nota|durum|sonuc. `skew` shifts the timestamp (s), `secret` signs
 * with another key, `unsigned` drops the headers, `signBody` signs other bytes than are sent.
 */
export async function machine(jobId, kind, body = null, { skew = 0, secret = OMR_SECRET, unsigned = false, signBody, base = BASE } = {}) {
  const method = kind === "nota" ? "GET" : "POST";
  const pathname = `/api/omr/${jobId}/${kind}`;
  const bytes = body === null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const ts = String(Math.floor(Date.now() / 1000) + skew);
  const headers = {};
  if (!unsigned) {
    headers["X-Arkhe-Timestamp"] = ts;
    headers["X-Arkhe-Signature"] = sign(secret, ts, method, pathname, signBody ?? bytes);
  }
  if (method === "POST") headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${pathname}`, { method, headers, body: method === "POST" ? bytes : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: buf, headers: res.headers, setCookie: res.headers.get("set-cookie") };
}

export function outboxEntry(jobId) {
  try {
    return JSON.parse(readFileSync(path.join(OMR_OUTBOX, `${jobId}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function clearOutbox() {
  try {
    for (const f of readdirSync(OMR_OUTBOX)) rmSync(path.join(OMR_OUTBOX, f), { force: true });
  } catch {}
}

const q = 480;
const line = (pitches) => pitches.map((p, i) => [p, i * q, q - 20, 96]);

/** The converter's shape: tempo track plus voices and a piano track, UTF-8 names. */
export function autoMidi(names = ["Kadın", "Erkek", "Piyano"], { beats = 16 } = {}) {
  const pitch = { Kadın: 72, Erkek: 55, Piyano: 48, Soprano: 76, Alto: 69, Tenor: 60, Bas: 48 };
  return midiBytes({
    bpm: 100,
    tracks: names.map((name) => ({ name, notes: line(Array.from({ length: beats }, (_, i) => (pitch[name] ?? 60) + (i % 3))) })),
  });
}

export function resultBody(midi, summary = { measures: 93, tracks: [], durationSec: 161 }) {
  return { midi: Buffer.from(midi).toString("base64"), summary };
}

export async function jobRow(jobId) {
  return (await db.execute({ sql: "select * from omr_jobs where id = ?", args: [jobId] })).rows[0] ?? null;
}

export async function latestJobOf(pieceId) {
  return (await db.execute({ sql: "select * from omr_jobs where piece_id = ? order by created_at desc, rowid desc limit 1", args: [pieceId] })).rows[0] ?? null;
}

/** A job row arranged directly (limits, timeouts). */
export async function insertJob(pieceId, { state = "queued", createdBy = null, createdAgoSec = 0, errorKind = null, layout = "kadin_erkek" } = {}) {
  const id = crypto.randomUUID();
  const t = Math.floor(Date.now() / 1000) - createdAgoSec;
  const final = state === "succeeded" || state === "failed";
  await db.execute({
    sql: `insert into omr_jobs (id, piece_id, state, error_kind, layout, piano, created_by, created_at, started_at, finished_at)
          values (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    args: [id, pieceId, state, errorKind, layout, createdBy, t, state === "running" ? t + 30 : null, final ? t + 60 : null],
  });
  return id;
}
