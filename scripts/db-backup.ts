// Writes a restorable plain-SQL dump to data/backups/<timestamp>.sql. Run before every migration.
// The file holds password hashes and member PII: keep it on the laptop, never commit or upload it.
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

function literal(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof ArrayBuffer) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL ?? "file:data/arkhe.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  // One read transaction: every table comes from the same snapshot, even with the app live.
  const tx = await client.transaction("read");
  const lines = [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN;",
    // Checked at COMMIT, so the restore also works where foreign_keys=OFF is ignored.
    "PRAGMA defer_foreign_keys=ON;",
  ];
  const counts: string[] = [];
  let tableCount = 0;
  let extraCount = 0;
  try {
    // Only engine and tool tables are skipped; __drizzle_migrations must survive a restore.
    const tables = await tx.execute(
      "select name, sql from sqlite_master where type = 'table'" +
        " and name not like 'sqlite\\_%' escape '\\'" +
        " and name not like 'libsql\\_%' escape '\\'" +
        " and name not like '\\_litestream%' escape '\\'" +
        " order by name",
    );
    tableCount = tables.rows.length;
    // Every table first, so no INSERT refers to a table that doesn't exist yet.
    for (const t of tables.rows) lines.push(`${t.sql};`);
    for (const t of tables.rows) {
      const rows = await tx.execute(`select * from "${t.name}"`);
      for (const row of rows.rows) {
        lines.push(
          `INSERT INTO "${t.name}" (${rows.columns.map((c) => `"${c}"`).join(", ")}) VALUES (${rows.columns
            .map((c) => literal(row[c]))
            .join(", ")});`,
        );
      }
      counts.push(`  ${t.name}: ${rows.rows.length}`);
    }
    // After the data, so a restore also proves every unique and partial index still holds.
    const extras = await tx.execute(
      "select sql from sqlite_master where type in ('index', 'trigger', 'view') and sql is not null" +
        " and tbl_name not like 'sqlite\\_%' escape '\\'" +
        " and tbl_name not like 'libsql\\_%' escape '\\'" +
        " and tbl_name not like '\\_litestream%' escape '\\'" +
        " order by case type when 'index' then 0 when 'view' then 1 else 2 end, name",
    );
    extraCount = extras.rows.length;
    for (const e of extras.rows) lines.push(`${e.sql};`);
  } finally {
    tx.close();
  }
  lines.push("COMMIT;");
  mkdirSync("data/backups", { recursive: true });
  const file = `data/backups/${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(
    `Backup written: ${file} (${tableCount} tables, ${extraCount} indexes/triggers/views)`,
  );
  console.log(counts.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
