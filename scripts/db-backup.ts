// Writes a restorable plain-SQL dump to data/backups/<timestamp>.sql. Run before every migration.
// The file holds password hashes and member PII: keep it on the laptop, never commit or upload it.
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { dumpDatabase } from "../src/lib/backup/dump";

async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL ?? "file:data/arkhe.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  const dump = await dumpDatabase(client);
  mkdirSync("data/backups", { recursive: true });
  const file = `data/backups/${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
  writeFileSync(file, dump.sql, { flag: "wx", mode: 0o600 });
  console.log(
    `Backup written: ${file} (${dump.tables} tables, ${dump.extras} indexes/triggers/views)`,
  );
  console.log(dump.counts.map(([name, n]) => `  ${name}: ${n}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
