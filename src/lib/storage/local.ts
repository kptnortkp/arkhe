import "server-only";
import { createReadStream } from "node:fs";
import { link, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { StorageError, type StorageDriver } from "./driver";
import { keyPath } from "./root.mjs";

const code = (e: unknown) => (e as { code?: string })?.code;

/** Files under data/uploads (one folder per database); never served by Next. */
export function createLocalDriver(root: string): StorageDriver {
  return {
    name: "local",
    async put(key, bytes) {
      const target = keyPath(root, key);
      const tmp = `${target}.tmp-${crypto.randomUUID()}`;
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(tmp, bytes, { flag: "wx" });
        // link() refuses an existing target: a key is never overwritten.
        await link(tmp, target);
      } catch (cause) {
        throw new StorageError("put", "unavailable", { cause });
      } finally {
        await unlink(tmp).catch(() => {});
      }
    },
    async get(key) {
      const target = keyPath(root, key);
      try {
        const info = await stat(target);
        const body = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
        return { body, size: info.size };
      } catch (cause) {
        if (code(cause) === "ENOENT") return null;
        throw new StorageError("get", "unavailable", { cause });
      }
    },
    async delete(keys) {
      for (const key of keys) {
        try {
          await unlink(keyPath(root, key));
        } catch (cause) {
          if (code(cause) !== "ENOENT") throw new StorageError("delete", "unavailable", { cause });
        }
      }
    },
  };
}
