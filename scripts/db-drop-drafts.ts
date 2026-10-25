// Deletes every undecided automatic MIDI draft (Phase 11). Run before promoting a deployment older
// than Phase 11: that code has no draft filter and would show drafts to members. The 0010 trigger
// queues each file; the daily sweep removes it. Same env pattern as db:check (local file or Turso).
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:data/arkhe.db";
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  const has = await client.execute(
    "select 1 from pragma_table_info('midi_files') where name = 'status'",
  );
  if (has.rows.length === 0) {
    console.log("no status column: nothing to do (database is older than Phase 11)");
    return;
  }
  const res = await client.execute("delete from midi_files where status = 'draft'");
  console.log(`drafts deleted: ${res.rowsAffected}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
