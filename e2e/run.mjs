// Usage: npm run e2e [-- <phase-file-substring>] ; screenshots go to $E2E_SHOTS if set.
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { cleanup, launch, summary } from "./lib.mjs";

const filter = process.argv[2];
const shots = process.env.E2E_SHOTS;
const files = (await readdir(new URL(".", import.meta.url)))
  .filter((f) => /^phase\d+[a-z]?-.*\.mjs$/.test(f) && (!filter || f.includes(filter)))
  .sort();

// Read-only: the import docs in the repo must match what the generator writes.
const docs = spawnSync("npx", ["tsx", "scripts/import-docs.ts", "--check"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
});
if (docs.status !== 0) {
  console.error("docs/ice-aktarma is out of date: run npm run docs:import");
  process.exit(1);
}

await cleanup();
const browser = await launch();
try {
  for (const file of files) {
    console.log(`\n# ${file}`);
    const { default: run } = await import(`./${file}`);
    await run(browser, shots);
  }
} finally {
  await browser.close();
  await cleanup();
}
process.exit(summary() ? 0 : 1);
