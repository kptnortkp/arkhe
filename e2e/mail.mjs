// Phase 7 helpers: the dev file outbox, a small MIME reader and the cron call. Not a phase file.
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, db } from "./lib.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUTBOX = path.join(ROOT, "data/outbox");
export const DEV_CRON_SECRET = process.env.CRON_SECRET ?? "dev-only-cron-secret";
export const DEV_PASSPHRASE = process.env.BACKUP_PASSPHRASE ?? "dev-only-backup-passphrase";

export function outboxSnapshot() {
  mkdirSync(OUTBOX, { recursive: true });
  return new Set(readdirSync(OUTBOX).filter((f) => f.endsWith(".eml")));
}

/** Files written since `before`, oldest first, as absolute paths. */
export function newEmails(before) {
  return [...outboxSnapshot()]
    .filter((f) => !before.has(f))
    .sort()
    .map((f) => path.join(OUTBOX, f));
}

export function removeEmails(files) {
  for (const f of files) rmSync(f, { force: true });
}

/** Every phase-7 section starts unconfigured, with no runs and no send throttles. */
export async function resetBackup() {
  await db.execute("delete from backup_runs");
  await db.execute("delete from app_settings where key = 'backup_recipients'");
  await db.execute("delete from login_attempts where key like 'backup-%'");
}

export async function setRecipients(list, { createdAt } = {}) {
  const at = createdAt ? Math.floor(createdAt.getTime() / 1000) : Math.floor(Date.now() / 1000);
  await db.execute({
    sql: `insert into app_settings (key, value, created_at, updated_at) values ('backup_recipients', ?, ?, ?)
          on conflict(key) do update set value = excluded.value, created_at = excluded.created_at`,
    args: [list.join(","), at, at],
  });
}

export async function runRows() {
  return (await db.execute("select * from backup_runs order by started_at, rowid")).rows;
}

/** Inserts a run row directly; `ageMin` backdates started_at. */
export async function insertRun({
  month,
  status,
  trigger = "cron",
  ageMin = 0,
  error = null,
  size = null,
  count = 2,
  actorId = null,
}) {
  const started = Math.floor(Date.now() / 1000) - ageMin * 60;
  const finished = status === "running" ? null : started + 2;
  await db.execute({
    sql: `insert into backup_runs (id, report_month, trigger, actor_id, status, started_at, finished_at, size_bytes, recipient_count, error)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      month,
      trigger,
      actorId,
      status,
      started,
      finished,
      size,
      count,
      status === "failed" ? (error ?? "E2E hata") : null,
    ],
  });
}

export async function cron(query = "", { secret = DEV_CRON_SECRET, header } = {}) {
  const headers = {};
  if (header !== undefined) headers.Authorization = header;
  else if (secret) headers.Authorization = `Bearer ${secret}`;
  const res = await fetch(`${BASE}/api/cron/aylik-yedek${query}`, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

function decodeWords(value) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(data, "base64")
          : Buffer.from(
              data
                .replace(/_/g, " ")
                .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
              "latin1",
            );
      return new TextDecoder(charset).decode(bytes);
    });
}

function parseHeaders(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    headers[line.slice(0, i).trim().toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  return headers;
}

function decodeBody(raw, encoding = "7bit") {
  const enc = encoding.toLowerCase();
  if (enc === "base64") return Buffer.from(raw.replace(/\s+/g, ""), "base64");
  if (enc === "quoted-printable") {
    const soft = raw.replace(/=\r?\n/g, "");
    return Buffer.from(
      soft.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
      "latin1",
    );
  }
  return Buffer.from(raw, "utf8");
}

function param(header, name) {
  const re = new RegExp(`${name}\\*?=(?:UTF-8'')?("([^"]*)"|[^;\\s]+)`, "i");
  const m = re.exec(header ?? "");
  if (!m) return null;
  const v = m[2] ?? m[1];
  return m[0].includes("*=") ? decodeURIComponent(v) : v;
}

/** `{ headers, text, attachments: [{ filename, contentType, data }] }` of an outbox .eml. */
export function parseEml(file) {
  const source = readFileSync(file, "latin1");
  const split = source.search(/\r?\n\r?\n/);
  const headers = parseHeaders(Buffer.from(source.slice(0, split), "latin1").toString("utf8"));
  const body = source.slice(split).replace(/^\r?\n\r?\n/, "");
  const boundary = param(headers["content-type"], "boundary");
  if (!boundary) {
    const data = decodeBody(body, headers["content-transfer-encoding"]);
    return { headers, text: data.toString("utf8").replace(/\r\n/g, "\n"), attachments: [] };
  }
  const parts = boundary
    ? body
        .split(`--${boundary}`)
        .slice(1)
        .filter((p) => !p.startsWith("--"))
    : [body];
  let text = "";
  const attachments = [];
  for (const part of parts) {
    const at = part.replace(/^\r?\n/, "").search(/\r?\n\r?\n/);
    const trimmed = part.replace(/^\r?\n/, "");
    const h = parseHeaders(trimmed.slice(0, at));
    const raw = trimmed.slice(at).replace(/^\r?\n\r?\n/, "");
    const data = decodeBody(raw, h["content-transfer-encoding"]);
    const filename = param(h["content-disposition"], "filename") ?? param(h["content-type"], "name");
    if (filename) attachments.push({ filename, contentType: h["content-type"], data });
    else text += data.toString("utf8");
  }
  return { headers, text: text.replace(/\r\n/g, "\n"), attachments };
}

/** CSV text (BOM stripped) as rows of unquoted cells. */
export function csvRows(buffer) {
  const text = buffer.toString("utf8").replace(/^﻿/, "");
  return text
    .split("\r\n")
    .filter(Boolean)
    .map((line) => line.split(";").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"')));
}

/** The previous Istanbul calendar month of the real date, as "YYYY-MM". */
export function previousMonthKey(today) {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthLabel(ym) {
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${ym}-15T12:00:00Z`));
}
