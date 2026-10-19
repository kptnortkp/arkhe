// Usage: npm run e2e [-- <phase-file-substring>] ; screenshots go to $E2E_SHOTS if set.
import { readdir } from "node:fs/promises";
import { cleanup, launch, summary } from "./lib.mjs";

const filter = process.argv[2];
const shots = process.env.E2E_SHOTS;
const files = (await readdir(new URL(".", import.meta.url)))
  .filter((f) => /^phase\d+-.*\.mjs$/.test(f) && (!filter || f.includes(filter)))
  .sort();

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
