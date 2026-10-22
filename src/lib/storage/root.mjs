// Pure and dependency-free (no "@/" imports): the local driver, scripts and e2e share this rule.
// One uploads root per database, so a cleanup that removes unreferenced files can never touch the
// files of another database: data/arkhe.db -> data/uploads, data/e2e-prod.db -> data/uploads-e2e-prod.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The database URL the app uses; the same default as src/db/client.ts. */
export function dbUrlOf(env) {
  return env.DATABASE_URL ?? "file:data/arkhe.db";
}

export function isLocalDb(env) {
  return dbUrlOf(env).startsWith("file:");
}

/** Absolute uploads folder for a file: database URL, or null for a remote database. */
export function uploadsRootFor(url, cwd = process.cwd()) {
  if (!url.startsWith("file:")) return null;
  const file = url.startsWith("file://")
    ? fileURLToPath(url.split("?")[0])
    : path.resolve(cwd, url.slice("file:".length).split("?")[0]);
  const base = path.basename(file).replace(/\.[^.]*$/, "");
  return path.join(path.dirname(file), base === "arkhe" ? "uploads" : `uploads-${base}`);
}

export const KEY_PATTERN =
  /^(recordings\/[0-9a-f-]{36}\.(m4a|mp3|aac|webm|ogg|wav)|midi\/[0-9a-f-]{36}\.mid)$/;

/** Resolves a storage key inside `root`; throws for anything that isn't one of our keys. */
export function keyPath(root, key) {
  if (!KEY_PATTERN.test(key)) throw new Error("invalid storage key");
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid storage key");
  return full;
}
