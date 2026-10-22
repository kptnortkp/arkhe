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

  // drizzle-kit doesn't track triggers: a future table rebuild would drop these silently.
  const tables = new Set(
    (await client.execute("select name from sqlite_master where type = 'table'")).rows.map((r) =>
      String(r[0]),
    ),
  );
  if (tables.has("budgets")) {
    const triggers = await client.execute(
      "select count(*) from sqlite_master where type = 'trigger' and name in ('budgets_no_overlap_insert', 'budgets_no_overlap_update')",
    );
    if (Number(triggers.rows[0][0]) !== 2) problems.push("budget overlap triggers missing");
  }
  if (tables.has("board_tickets") && tables.has("board_ticket_seq")) {
    const behind = await client.execute(
      "select count(*) from board_tickets where number > coalesce((select last_number from board_ticket_seq where id = 1), number)",
    );
    if (Number(behind.rows[0][0]) > 0) problems.push("ticket number counter behind data");
  }

  if (tables.has("import_items") && tables.has("import_batches")) {
    const stale = await client.execute(
      "select count(*) from import_items i join import_batches b on b.id = i.batch_id where b.status = 'undone'",
    );
    if (Number(stale.rows[0][0]) > 0) problems.push("undone import batches still have items");
    const empty = await client.execute(
      "select count(*) from import_batches b where b.status = 'imported' and not exists (select 1 from import_items i where i.batch_id = b.id)",
    );
    if (Number(empty.rows[0][0]) > 0) problems.push("live import batches without items");
  }

  if (tables.has("recordings")) {
    const checks: [string, string, number][] = [
      [
        "select count(*) from sqlite_master where type = 'trigger' and name in ('recordings_queue_on_audio_delete', 'recordings_queue_on_delete', 'recordings_audio_final', 'midi_files_queue_on_delete')",
        "recording triggers missing",
        4,
      ],
      [
        "select count(*) from recordings r left join submissions s on s.assignment_id = r.assignment_id and s.user_id = r.user_id where r.replaced_at is null and s.submitted_at is null",
        "current recordings without a submission",
        0,
      ],
      [
        "select count(*) from recordings r left join submissions s on s.assignment_id = r.assignment_id and s.user_id = r.user_id where r.commented_at is not null and s.feedback is null",
        "commented recordings without a comment",
        0,
      ],
      [
        "select count(*) from storage_deletions d where d.state = 'pending' and (exists (select 1 from recordings r where r.storage_key = d.storage_key and r.audio_deleted_at is null) or exists (select 1 from midi_files m where m.storage_key = d.storage_key))",
        "live storage keys queued for deletion",
        0,
      ],
      [
        "select count(*) from storage_deletions d where d.state = 'done' and (exists (select 1 from recordings r where r.storage_key = d.storage_key and r.audio_deleted_at is null) or exists (select 1 from midi_files m where m.storage_key = d.storage_key))",
        "live storage keys already deleted",
        0,
      ],
    ];
    for (const [query, problem, want] of checks) {
      const n = Number((await client.execute(query)).rows[0][0]);
      if (n !== want) problems.push(problem);
    }
  }

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
