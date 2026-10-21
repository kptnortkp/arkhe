// Restores a plain-SQL dump (db:backup or db:decrypt output) into a NEW local SQLite file.
// Reads no env file and never touches DATABASE_URL.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { isEncryptedBackup } from "../src/lib/backup/crypto";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const SIDE_FILES = ["", "-wal", "-shm", "-journal"];

async function main() {
  const [input, target] = process.argv.slice(2);
  if (!input || !target || process.argv.length > 4) {
    fail("Usage: npm run db:restore -- <file.sql> <target.db>");
  }
  let dump: Buffer;
  try {
    dump = readFileSync(input);
  } catch {
    fail(`Cannot read ${input}`);
  }
  if (isEncryptedBackup(dump)) fail("This file is encrypted; run npm run db:decrypt first.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target === ":memory:") {
    fail("Restore target must be a local file path.");
  }
  const abs = path.resolve(target);
  if (SIDE_FILES.some((s) => existsSync(abs + s))) {
    fail("Refusing to restore over an existing file.");
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  try {
    // O_EXCL closes the gap between the check above and the create.
    closeSync(openSync(abs, "wx", 0o600));
  } catch {
    fail("Refusing to restore over an existing file.");
  }
  const sql = dump.toString("utf8");
  const client = createClient({ url: `file:${abs}` });
  try {
    // A dump cut at a line boundary runs BEGIN and the inserts, then rolls back silently.
    const lastLine = sql.trimEnd().split("\n").pop()?.trim();
    if (lastLine !== "COMMIT;") throw new Error("the dump does not end with COMMIT; (truncated?)");
    // Never split the dump ourselves: text values contain ";" and newlines.
    await client.executeMultiple(sql);
    const tables = await client.execute(
      "select count(*) from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\'",
    );
    const count = Number(tables.rows[0][0]);
    if (count === 0) throw new Error("no tables were restored");
    // The dump turns foreign_keys off, so nothing checked them during the load.
    const orphans = await client.execute("pragma foreign_key_check");
    if (orphans.rows.length > 0) {
      const names = [...new Set(orphans.rows.map((r) => String(r[0])))].join(", ");
      throw new Error(`${orphans.rows.length} rows break a foreign key (${names})`);
    }
    client.close();
    console.log(`Restored: ${abs} (${count} tables)`);
    console.log(`Next: DATABASE_URL=file:${abs} npm run db:check`);
  } catch (e) {
    client.close();
    for (const s of SIDE_FILES) rmSync(abs + s, { force: true });
    fail(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
