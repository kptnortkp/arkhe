// CI deploy gate: applies pending migrations to DATABASE_URL only after they ran on a copy of it
// with every existing row unchanged. Writes an encrypted backup first. Exits non-zero to stop the
// deploy; production is never touched when the copy fails.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { encryptBackup } from "../src/lib/backup/crypto";
import { dumpDatabase } from "../src/lib/backup/dump";

const FOLDER = "drizzle";
const BACKUP_DIR = "deploy-backup";
// Statements that can lose or rewrite existing rows; a migration using them needs the marker.
const DESTRUCTIVE =
  /\b(drop\s+(table|column)|rename\s+(to|column)|delete\s+from|update\s+[`"\w]+\s+set|insert\s+into\s+[`"]?__new_)/i;
const REVIEWED = /^--\s*deploy:\s*reviewed\b/m;

type Entry = { idx: number; when: number; tag: string };
type Table = { columns: string[]; count: number; hash: string };

function fail(message: string): never {
  console.error(`deploy-db: ${message}`);
  process.exit(1);
}

function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function journal(): Entry[] {
  return JSON.parse(readFileSync(path.join(FOLDER, "meta/_journal.json"), "utf8")).entries;
}

async function lastApplied(client: Client) {
  const has = await client.execute(
    "select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
  );
  if (!has.rows.length) return 0;
  const row = await client.execute("select max(created_at) from __drizzle_migrations");
  return Number(row.rows[0][0] ?? 0);
}

async function tableNames(client: Client) {
  const rows = await client.execute(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\' and name <> '__drizzle_migrations' order by name",
  );
  return rows.rows.map((r) => String(r[0]));
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Row count and a hash of every row, over `only` columns when given (columns added later are ignored). */
async function fingerprint(client: Client, only?: Map<string, string[]>) {
  const out = new Map<string, Table>();
  for (const name of await tableNames(client)) {
    const info = await client.execute(`pragma table_info(${quote(name)})`);
    const present = info.rows.map((r) => String(r.name));
    const columns = only?.get(name) ?? present;
    if (columns.some((c) => !present.includes(c))) {
      out.set(name, { columns: present, count: -1, hash: "missing columns" });
      continue;
    }
    const list = columns.map(quote).join(", ");
    const order = columns.map((_, i) => i + 1).join(", ");
    const rows = await client.execute(`select ${list} from ${quote(name)} order by ${order}`);
    const hash = createHash("sha256");
    for (const row of rows.rows) hash.update(JSON.stringify(columns.map((_, i) => row[i])) + "\n");
    out.set(name, { columns, count: rows.rows.length, hash: hash.digest("hex") });
  }
  return out;
}

async function counts(client: Client) {
  const out = new Map<string, number>();
  for (const name of await tableNames(client)) {
    const row = await client.execute(`select count(*) from ${quote(name)}`);
    out.set(name, Number(row.rows[0][0]));
  }
  return out;
}

async function integrityProblems(client: Client, local: boolean) {
  const problems: string[] = [];
  if (local) {
    const quick = await client.execute("pragma quick_check");
    const result = String(quick.rows[0]?.[0] ?? "");
    if (result !== "ok") problems.push(`quick_check: ${result}`);
  }
  const orphans = await client.execute("pragma foreign_key_check");
  if (orphans.rows.length) problems.push(`${orphans.rows.length} rows break a foreign key`);
  return problems;
}

function dbCheck(url: string, token: string | undefined) {
  const run = spawnSync("npx", ["tsx", "scripts/db-check.ts"], {
    env: { ...process.env, DATABASE_URL: url, DATABASE_AUTH_TOKEN: token ?? "" },
    stdio: "inherit",
  });
  if (run.status !== 0)
    fail(`db:check failed on ${url.startsWith("file:") ? "the copy" : "production"}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  const token = process.env.DATABASE_AUTH_TOKEN;
  if (!url) fail("DATABASE_URL is not set");
  const prod = createClient({ url, authToken: token });

  const entries = journal();
  const last = await lastApplied(prod);
  const pending = entries.filter((e) => e.when > last);
  console.log(
    `Applied up to ${last}; ${pending.length} pending: ${pending.map((e) => e.tag).join(", ") || "none"}`,
  );
  output("migrated", pending.length ? "true" : "false");
  if (!pending.length) return;

  for (const e of pending) {
    const sql = readFileSync(path.join(FOLDER, `${e.tag}.sql`), "utf8");
    if (DESTRUCTIVE.test(sql) && !REVIEWED.test(sql)) {
      fail(
        `${e.tag} drops, renames or rewrites rows; review it and add "-- deploy: reviewed" at the top`,
      );
    }
  }

  // 1. Encrypted backup of production as it is now.
  const dump = await dumpDatabase(prod);
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (passphrase) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(
      BACKUP_DIR,
      `${new Date().toISOString().replace(/[:.]/g, "-")}.sql.gz.enc`,
    );
    writeFileSync(file, encryptBackup(Buffer.from(dump.sql, "utf8"), passphrase), { mode: 0o600 });
    console.log(`Backup written: ${file}`);
  } else if (process.env.CI) {
    fail("BACKUP_PASSPHRASE is not set; refusing to migrate without a backup");
  }

  // 2. The same migrations on a throwaway copy; every existing row must come through unchanged.
  const dir = mkdtempSync(path.join(tmpdir(), "arkhe-deploy-"));
  const copyUrl = `file:${path.join(dir, "copy.db")}`;
  try {
    const copy = createClient({ url: copyUrl });
    await copy.executeMultiple(dump.sql);
    const before = await fingerprint(copy);
    await migrate(drizzle(copy), { migrationsFolder: FOLDER });
    const after = await fingerprint(
      copy,
      new Map([...before].map(([name, t]) => [name, t.columns])),
    );
    const changed: string[] = [];
    for (const [name, t] of before) {
      const a = after.get(name);
      if (!a) changed.push(`${name}: table is gone`);
      else if (a.count !== t.count) changed.push(`${name}: ${t.count} → ${a.count} rows`);
      else if (a.hash !== t.hash) changed.push(`${name}: row data changed`);
    }
    if (changed.length) fail(`existing data changed on the copy:\n  ${changed.join("\n  ")}`);
    const problems = await integrityProblems(copy, true);
    if (problems.length) fail(`the copy failed checks: ${problems.join("; ")}`);
    if ((await lastApplied(copy)) !== entries.at(-1)!.when)
      fail("the copy did not reach the last migration");
    copy.close();
    dbCheck(copyUrl, undefined);
    console.log(`Copy OK: ${before.size} tables, every existing row unchanged`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 3. Production: one atomic batch, then nothing may have gone missing.
  const prodBefore = await counts(prod);
  await migrate(drizzle(prod), { migrationsFolder: FOLDER });
  const prodAfter = await counts(prod);
  const lost = [...prodBefore]
    .filter(([name, n]) => (prodAfter.get(name) ?? -1) < n)
    .map(([name, n]) => `${name}: ${n} → ${prodAfter.get(name) ?? "gone"}`);
  if (lost.length) fail(`rows went missing in production:\n  ${lost.join("\n  ")}`);
  const problems = await integrityProblems(prod, url.startsWith("file:"));
  if (problems.length) fail(`production failed checks: ${problems.join("; ")}`);
  dbCheck(url, token);
  console.log(`Production migrated: ${pending.map((e) => e.tag).join(", ")}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
