// Pure: the plain-SQL dump shared by `npm run db:backup` and the monthly email. Takes a client,
// never creates one, and has no "@/" imports so tsx can load it from scripts/.
import type { Client } from "@libsql/client";

function literal(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof ArrayBuffer) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function dumpDatabase(client: Client) {
  // One read transaction: every table comes from the same snapshot, even with the app live.
  const tx = await client.transaction("read");
  const lines = [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN;",
    // Only enforced where foreign_keys=OFF is ignored; db:restore runs foreign_key_check itself.
    "PRAGMA defer_foreign_keys=ON;",
  ];
  const counts: [string, number][] = [];
  let tables = 0;
  let extras = 0;
  try {
    // Only engine and tool tables are skipped; __drizzle_migrations must survive a restore.
    const list = await tx.execute(
      "select name, sql from sqlite_master where type = 'table'" +
        " and name not like 'sqlite\\_%' escape '\\'" +
        " and name not like 'libsql\\_%' escape '\\'" +
        " and name not like '\\_litestream%' escape '\\'" +
        " order by name",
    );
    tables = list.rows.length;
    // Every table first, so no INSERT refers to a table that doesn't exist yet.
    for (const t of list.rows) lines.push(`${t.sql};`);
    for (const t of list.rows) {
      const rows = await tx.execute(`select * from "${t.name}"`);
      for (const row of rows.rows) {
        lines.push(
          `INSERT INTO "${t.name}" (${rows.columns.map((c) => `"${c}"`).join(", ")}) VALUES (${rows.columns
            .map((c) => literal(row[c]))
            .join(", ")});`,
        );
      }
      counts.push([String(t.name), rows.rows.length]);
    }
    // After the data, so a restore also proves every unique and partial index still holds.
    const rest = await tx.execute(
      "select sql from sqlite_master where type in ('index', 'trigger', 'view') and sql is not null" +
        " and tbl_name not like 'sqlite\\_%' escape '\\'" +
        " and tbl_name not like 'libsql\\_%' escape '\\'" +
        " and tbl_name not like '\\_litestream%' escape '\\'" +
        " order by case type when 'index' then 0 when 'view' then 1 else 2 end, name",
    );
    extras = rest.rows.length;
    for (const e of rest.rows) lines.push(`${e.sql};`);
  } finally {
    tx.close();
  }
  lines.push("COMMIT;");
  return { sql: lines.join("\n") + "\n", tables, extras, counts };
}
