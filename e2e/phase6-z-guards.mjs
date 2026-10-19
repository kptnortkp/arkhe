// Phase 6 AC25, run last: seed and fixtures refuse production. Every guarded call points at a
// throwaway file or an unreachable libsql:// URL, so even a broken guard can't touch data/arkhe.db.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { seedFinance } from "../scripts/finance-fixture.mjs";
import { seedHomework } from "../scripts/homework-fixture.mjs";
import { check, db } from "./lib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const REMOTE = "libsql://guard.invalid";
const TABLES = ["users", "finance_entries", "dues_overrides", "assignments", "submissions"];

/** Row counts plus a hash of every row: mtime proves nothing in WAL mode. */
async function snapshot() {
  const counts = [];
  const hash = createHash("sha256");
  for (const t of TABLES) {
    const { rows } = await db.execute(`select * from ${t}`);
    counts.push(rows.length);
    hash.update(
      rows
        .map((r) => JSON.stringify(r))
        .sort()
        .join("\n"),
    );
  }
  return { counts: counts.join("|"), hash: hash.digest("hex") };
}

function run(command, args, env) {
  const r = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return r.status;
}

/** True only when the fixture guard itself refused, not some later SQL error. */
async function rejects(fn) {
  try {
    await fn();
    return false;
  } catch (error) {
    return String(error?.message).includes("Fixtures only run against a local file database");
  }
}

export default async function phase6Guards() {
  const scratch = join(tmpdir(), `arkhe-guard-${Date.now()}.db`);
  const before = await snapshot();
  try {
    const prod = { NODE_ENV: "production", DATABASE_URL: `file:${scratch}` };
    check(
      run("npx", ["tsx", "scripts/seed.ts"], prod) !== 0,
      "AC25 seed.ts exits non-zero with NODE_ENV=production",
    );
    check(
      run("npx", ["tsx", "scripts/seed.ts"], { DATABASE_URL: REMOTE }) !== 0,
      "AC25 seed.ts exits non-zero for a non-file DB",
    );
    check(
      run("node", ["scripts/assert-local-db.mjs"], prod) !== 0 &&
        run("node", ["scripts/assert-local-db.mjs"], { DATABASE_URL: REMOTE }) !== 0 &&
        run("node", ["scripts/assert-local-db.mjs"], { DATABASE_URL: `file:${scratch}` }) !== 0,
      "AC25 db:reset's guard refuses production, a remote DB and any file but data/arkhe.db",
    );
    const reset = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts["db:reset"];
    check(
      reset.startsWith("node --env-file-if-exists=.env scripts/assert-local-db.mjs && "),
      "AC25 db:reset runs assert-local-db before anything else",
    );
    check(
      run("node", ["--input-type=module", "-e", "await import('./e2e/lib.mjs')"], {
        DATABASE_URL: REMOTE,
      }) !== 0,
      "AC25 e2e/lib.mjs refuses a non-file database",
    );

    const local = createClient({ url: `file:${scratch}` });
    const remote = createClient({ url: REMOTE });
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let underProduction;
    try {
      underProduction =
        (await rejects(() => seedFinance(local, new Date()))) &&
        (await rejects(() => seedHomework(local, new Date())));
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
    check(underProduction, "AC25 seedFinance and seedHomework reject under NODE_ENV=production");
    check(
      (await rejects(() => seedFinance(remote, new Date()))) &&
        (await rejects(() => seedHomework(remote, new Date()))),
      "AC25 seedFinance and seedHomework reject a non-file client",
    );
    const tables = existsSync(scratch)
      ? Number(
          (await local.execute("select count(*) n from sqlite_master where type = 'table'")).rows[0]
            .n,
        )
      : 0;
    local.close();
    remote.close();
    check(tables === 0, "AC25 nothing was written to the throwaway DB");
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(`${scratch}${suffix}`, { force: true });
  }
  const after = await snapshot();
  check(
    after.counts === before.counts && after.hash === before.hash,
    `AC25 data/arkhe.db is untouched (rows ${after.counts}, content hash unchanged)`,
  );
}
