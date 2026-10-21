// Decrypts a monthly backup attachment (.sql.gz.enc) into data/backups/<name>.sql.
// Reads no env file on purpose: the passphrase comes from the shell or a prompt.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { BadBackup, decryptBackup } from "../src/lib/backup/crypto";

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

async function readHidden(prompt: string) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Piped input: the first line is the passphrase.
    let data = "";
    for await (const chunk of stdin) {
      data += chunk;
      if (data.includes("\n")) break;
    }
    return data.split(/\r?\n/)[0];
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise<string>((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const input = process.argv[2];
  if (!input || process.argv.length > 3) fail("Usage: npm run db:decrypt -- <file.sql.gz.enc>");
  let file: Buffer;
  try {
    file = readFileSync(input);
  } catch {
    fail(`Cannot read ${input}`);
  }
  const base = path.basename(input);
  const name = base.endsWith(".sql.gz.enc") ? base.slice(0, -".gz.enc".length) : `${base}.sql`;
  const out = path.join("data", "backups", name);
  const passphrase = process.env.BACKUP_PASSPHRASE ?? (await readHidden("Backup passphrase: "));
  let plain: Buffer;
  try {
    plain = decryptBackup(file, passphrase.trim());
  } catch (e) {
    fail(e instanceof BadBackup ? e.message : "Wrong passphrase or damaged file.");
  }
  mkdirSync(path.dirname(out), { recursive: true });
  try {
    // The dump holds password hashes and member data: owner-only, never overwrite.
    writeFileSync(out, plain, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") fail(`Output file exists: ${out}`);
    throw e;
  }
  console.log(`Decrypted: ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
