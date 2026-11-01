// Phase 7: the gzipped attachment, the restore drill and db:decrypt for deploy backups (AC 28–30).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { BASE, check, db, login, newPage } from "./lib.mjs";
import {
  ROOT,
  newEmails,
  outboxSnapshot,
  parseEml,
  removeEmails,
  resetBackup,
  setRecipients,
} from "./mail.mjs";

const SCRATCH = path.join(ROOT, "data/e2e-p7");
const BACKUPS = path.join(ROOT, "data/backups");
const COUNTED = ["users", "attendance", "submissions", "finance_entries"];
const PASSPHRASE = "e2e-deploy-backup-passphrase";

/** A deploy-style .sql.gz.enc of `sql`, made by the same encryptBackup the deploy uses. */
function encrypt(sql, out) {
  const plain = `${out}.plain`;
  writeFileSync(plain, sql);
  const code = `Promise.all([import("node:fs"), import("./src/lib/backup/crypto.ts")]).then(([fs, c]) =>
    fs.writeFileSync(process.argv[1], c.encryptBackup(fs.readFileSync(process.argv[2]), process.env.P)))`;
  const r = spawnSync("npx", ["tsx", "-e", code, out, plain], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, P: PASSPHRASE },
  });
  rmSync(plain, { force: true });
  if (r.status !== 0) throw new Error(`encrypt failed: ${r.stderr}`);
}

function npm(script, args, env = {}) {
  const r = spawnSync("npm", ["run", "--silent", script, "--", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 90_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

async function counts(client) {
  const out = {};
  for (const t of COUNTED) {
    out[t] = Number((await client.execute(`select count(*) as n from ${t}`)).rows[0].n);
  }
  return out;
}

async function sendFromUi(page) {
  await page.goto(`${BASE}/yedek`);
  await page.locator("main h1").waitFor();
  await page.getByRole("button", { name: "Şimdi gönder" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Gönder", exact: true }).click();
  await page.getByText("Gönderildi: 2 adres.", { exact: true }).first().waitFor({ timeout: 30_000 });
  await dialog.waitFor({ state: "hidden" });
}

export default async function phase7Restore(browser) {
  await resetBackup();
  await setRecipients(["p7a@e2e.test", "p7b@e2e.test"]);
  const start = outboxSnapshot();
  const cleanupFiles = [];
  const drillDb = path.join(SCRATCH, `drill-${Date.now()}.db`);
  mkdirSync(SCRATCH, { recursive: true });
  const sef = await newPage(browser, { phone: true });
  try {
    await login(sef, "sef@arkhe.local");
    await sef.waitForURL(`${BASE}/`);

    const live = await counts(db);
    await sendFromUi(sef);
    // Steps past the 10-minute cooldown in the DB; the cooldown itself stays unchanged.
    await db.execute(
      "update backup_runs set started_at = started_at - 720, finished_at = finished_at - 720",
    );
    await sendFromUi(sef);
    const mails = newEmails(start);
    const gzs = mails
      .map((f) => parseEml(f).attachments.find((a) => a.filename.endsWith(".sql.gz")))
      .filter(Boolean);
    check(mails.length === 2 && gzs.length === 2, `AC28 two manual sends → two .sql.gz (${mails.length})`);
    if (gzs.length !== 2) return;
    const [a, b] = gzs.map((e) => e.data);
    const sql = gunzipSync(a);
    check(
      [a, b].every((d) => d[0] === 0x1f && d[1] === 0x8b) &&
        sql.toString("utf8").trimEnd().endsWith("COMMIT;"),
      "AC28 both attachments are plain gzip and unzip to a complete dump",
    );

    // AC29: deploy backups stay encrypted; db:decrypt opens them.
    const enc = (name, data) => {
      const file = path.join(SCRATCH, name);
      if (data) writeFileSync(file, data);
      else encrypt(sql, file);
      cleanupFiles.push(file, path.join(BACKUPS, name.replace(/\.gz\.enc$/, "")));
      return path.relative(ROOT, file);
    };
    const wrongFile = enc(`p7-wrong-${Date.now()}.sql.gz.enc`);
    const encBytes = readFileSync(path.join(ROOT, wrongFile));
    const wrong = npm("db:decrypt", [wrongFile], { BACKUP_PASSPHRASE: "e2e-wrong-passphrase-1234" });
    check(
      wrong.status === 1 &&
        wrong.out.includes("Wrong passphrase or damaged file.") &&
        !existsSync(cleanupFiles.at(-1)),
      `AC29 wrong passphrase → exit 1, the message, no file (${wrong.status})`,
    );
    const flipped = Buffer.from(encBytes);
    flipped[flipped.length - 40] ^= 0xff;
    const flipFile = enc(`p7-flip-${Date.now()}.sql.gz.enc`, flipped);
    const flip = npm("db:decrypt", [flipFile], { BACKUP_PASSPHRASE: PASSPHRASE });
    check(
      flip.status === 1 &&
        flip.out.includes("Wrong passphrase or damaged file.") &&
        !existsSync(cleanupFiles.at(-1)),
      `AC29 one flipped byte → exit 1, the message, no file (${flip.status})`,
    );
    const drillFile = enc(`p7-drill-${Date.now()}.sql.gz.enc`, encBytes);
    const sqlPath = cleanupFiles.at(-1);
    const dec = npm("db:decrypt", [drillFile], { BACKUP_PASSPHRASE: PASSPHRASE });
    const decrypted = /Decrypted: (\S+)/.exec(dec.out)?.[1];
    check(
      dec.status === 0 &&
        decrypted === path.relative(ROOT, sqlPath) &&
        readFileSync(sqlPath).equals(sql),
      `AC30 db:decrypt → Decrypted: ${decrypted}, byte-identical to the dump`,
    );
    const again = npm("db:decrypt", [drillFile], { BACKUP_PASSPHRASE: PASSPHRASE });
    check(
      again.status === 1 && again.out.includes(`Output file exists: ${decrypted}`),
      "AC29 a second decrypt refuses to overwrite: Output file exists",
    );

    // AC30 drill: the attachment as saved from the email, straight into db:restore.
    const gzFile = path.join(SCRATCH, `p7-drill-${Date.now()}.sql.gz`);
    writeFileSync(gzFile, a);
    cleanupFiles.push(gzFile);
    const existing = path.join(SCRATCH, "exists.db");
    writeFileSync(existing, "");
    cleanupFiles.push(existing);
    const overExisting = npm("db:restore", [path.relative(ROOT, gzFile), path.relative(ROOT, existing)]);
    const remote = npm("db:restore", [path.relative(ROOT, gzFile), "libsql://x.invalid"]);
    const encrypted = npm("db:restore", [drillFile, path.relative(ROOT, drillDb)]);
    check(
      overExisting.status === 1 &&
        overExisting.out.includes("Refusing to restore over an existing file.") &&
        remote.status === 1 &&
        remote.out.includes("Restore target must be a local file path.") &&
        encrypted.status === 1 &&
        encrypted.out.includes("This file is encrypted; run npm run db:decrypt first.") &&
        !existsSync(drillDb),
      "AC29 db:restore refuses an existing target, a libsql:// target and an encrypted input",
    );
    const restore = npm("db:restore", [path.relative(ROOT, gzFile), path.relative(ROOT, drillDb)]);
    check(
      restore.status === 0 && restore.out.includes("Restored: "),
      "AC30 db:restore takes the .sql.gz attachment as is",
    );
    const journal = JSON.parse(readFileSync(path.join(ROOT, "drizzle/meta/_journal.json"), "utf8"));
    const n = journal.entries.length;
    const dbCheck = spawnSync("npm", ["run", "db:check"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `file:${drillDb}` },
    });
    check(
      dbCheck.status === 0 && dbCheck.stdout.includes(`migrations=${n}/${n}`),
      `AC30/35 db:check on the restored DB → migrations=${n}/${n}`,
    );
    const { createClient } = await import("@libsql/client");
    const restored = createClient({ url: `file:${drillDb}` });
    const got = await counts(restored);
    // Phase 9 AC 42: the dump carries assistant notes and recording metadata (never audio).
    const media = async (c) =>
      (await c.execute("select (select count(*) from assistant_notes) as n, (select count(*) from recordings) as r")).rows[0];
    const [mediaLive, mediaRestored] = [await media(db), await media(restored)];
    restored.close();
    check(
      Number(mediaRestored.n) > 0 &&
        Number(mediaRestored.n) === Number(mediaLive.n) &&
        Number(mediaRestored.r) === Number(mediaLive.r),
      `AC42 (Phase 9) the dump holds the assistant-note and recording rows (${mediaRestored.n}, ${mediaRestored.r})`,
    );
    check(
      JSON.stringify(got) === JSON.stringify(live),
      `AC30 row counts match the live DB at send time (${JSON.stringify(got)})`,
    );
  } finally {
    await sef.context().close();
    removeEmails(newEmails(start));
    for (const f of cleanupFiles) rmSync(f, { force: true });
    for (const s of ["", "-wal", "-shm", "-journal"]) rmSync(drillDb + s, { force: true });
    rmSync(SCRATCH, { recursive: true, force: true });
    await resetBackup();
  }
}
