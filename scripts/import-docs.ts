// Writes docs/ice-aktarma/ from the import definitions; the download routes serve the same bytes.
// Usage: npm run docs:import  (add --check to fail instead of writing when a file is out of date)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileBase, headerLine } from "../src/lib/import/def";
import { DEFS } from "../src/lib/import/defs";
import { markdown, promptText, readme, sampleCsv } from "../src/lib/import/docs";

const dir = path.join(process.cwd(), "docs/ice-aktarma");
const checkOnly = process.argv.includes("--check");

// The prompt must be self-contained: every column and every code of the type appears in it.
for (const def of DEFS) {
  const prompt = promptText(def);
  const md = markdown(def);
  if (!prompt.includes(headerLine(def))) throw new Error(`${def.slug}: header missing from prompt`);
  for (const c of def.columns) {
    if (!prompt.includes(c.name)) throw new Error(`${def.slug}: ${c.name} missing from prompt`);
    if (c.format.kind === "code" || c.format.kind === "codes") {
      for (const code of c.format.kind === "code" ? (c.format.codes ?? c.format.table.canonical) : c.format.table.canonical) {
        if (!prompt.includes(code)) throw new Error(`${def.slug}: code ${code} missing from prompt`);
        if (!md.includes(`\`${code}\``)) throw new Error(`${def.slug}: code ${code} missing from .md`);
      }
    }
  }
  // The filled-in prompt must not keep a placeholder of the repo copy.
  const live = promptText(def, { periods: [], events: [], firstHandEntry: null });
  if (def.live?.length && live.includes("<Portaldaki")) throw new Error(`${def.slug}: live prompt keeps a placeholder`);
  for (const row of def.sample) {
    if (row.length !== def.columns.length) throw new Error(`${def.slug}: sample row width`);
  }
}

const files: [string, string][] = [["README.md", readme()]];
for (const def of DEFS) {
  files.push([`${fileBase(def)}.csv`, sampleCsv(def)]);
  files.push([`${fileBase(def)}.md`, markdown(def)]);
}

mkdirSync(dir, { recursive: true });
let stale = 0;
for (const [name, body] of files) {
  const file = path.join(dir, name);
  let current: string | null = null;
  try {
    current = readFileSync(file, "utf8");
  } catch {}
  if (current === body) continue;
  stale++;
  if (checkOnly) console.error(`out of date: docs/ice-aktarma/${name}`);
  else writeFileSync(file, body);
}
// A file the generator no longer writes (e.g. after a rename) is stale too; only --check reports it.
const expected = new Set(files.map(([name]) => name));
const orphans = readdirSync(dir).filter((name) => !expected.has(name));
for (const name of orphans) console.error(`not generated: docs/ice-aktarma/${name} (delete it)`);
console.log(
  checkOnly
    ? `${stale} file(s) out of date, ${orphans.length} orphan file(s)`
    : `wrote ${stale} of ${files.length} file(s)`,
);
if (checkOnly && (stale || orphans.length)) process.exit(1);
