// Fails unless foreign keys are enforced, no orphaned rows exist, every migration is applied and,
// on a remote DB, no demo accounts are left. Run after every migration and every restore.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:data/arkhe.db";
  const local = url.startsWith("file:");
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  const problems: string[] = [];
  // Local file only: WAL lets the dev server, scripts and e2e write without SQLITE_BUSY.
  if (local) await client.execute("pragma journal_mode = wal");

  const fk = await client.execute("pragma foreign_keys");
  const enabled = Number(Object.values(fk.rows[0] ?? {})[0]) === 1;
  const orphans = await client.execute("pragma foreign_key_check");
  if (!enabled) problems.push("foreign keys are not enforced");
  if (orphans.rows.length) problems.push(`orphaned rows: ${orphans.rows.length}`);

  const journal = JSON.parse(
    readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  const expected = journal.entries.length;
  const hasTable = await client.execute(
    "select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
  );
  const applied = hasTable.rows.length
    ? Number((await client.execute("select count(*) from __drizzle_migrations")).rows[0][0])
    : 0;
  if (applied < expected) problems.push(`migrations missing: ${applied} of ${expected} applied`);

  let integrity = "skipped";
  if (local) {
    const quick = await client.execute("pragma quick_check");
    integrity = String(quick.rows[0]?.[0] ?? "");
    if (integrity !== "ok") problems.push(`quick_check: ${integrity}`);
  } else {
    // Emails are stored lowercased by create-admin and the invite flow.
    const demo = await client.execute(
      "select count(*) from users where email like '%@arkhe.local'",
    );
    const n = Number(demo.rows[0][0]);
    if (n > 0) problems.push(`demo accounts present: ${n}`);
  }

  console.log(
    `foreign_keys=${enabled ? 1 : 0}, orphaned rows=${orphans.rows.length}, migrations=${applied}/${expected}, quick_check=${integrity}`,
  );
  if (problems.length) {
    for (const row of orphans.rows.slice(0, 20)) console.log(row);
    for (const p of problems) console.error(`db:check failed: ${p}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
