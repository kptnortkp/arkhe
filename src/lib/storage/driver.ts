import "server-only";
import { STORAGE_ERROR_KINDS } from "@/db/schema";
import { storageFault } from "./hooks";
import { blobConfigured, createBlobDriver } from "./blob";
import { createLocalDriver } from "./local";
import { dbUrlOf, uploadsRootFor } from "./root.mjs";

export type StorageErrorKind = (typeof STORAGE_ERROR_KINDS)[number];
export type StoredType = string;

/** size null = the store didn't say (no Content-Length); the routes fall back to the DB size. */
export type StoredObject = { body: ReadableStream<Uint8Array>; size: number | null };

export interface StorageDriver {
  readonly name: "local" | "blob";
  /** Never overwrites: keys are fresh UUIDs. Throws StorageError. */
  put(key: string, bytes: Uint8Array, type: StoredType, signal: AbortSignal): Promise<void>;
  /** null = the object is missing. Throws StorageError for anything else. */
  get(key: string, signal: AbortSignal): Promise<StoredObject | null>;
  /** A missing key isn't an error. */
  delete(keys: readonly string[], signal: AbortSignal): Promise<void>;
}

/** The message is built from op and kind only: a Blob error message can contain the URL. */
export class StorageError extends Error {
  constructor(
    readonly op: "put" | "get" | "delete",
    readonly kind: StorageErrorKind,
    options?: { cause?: unknown },
  ) {
    super(`storage ${op} failed: ${kind}`, options);
    this.name = "StorageError";
  }
}

export function storageErrorKind(error: unknown): StorageErrorKind {
  return error instanceof StorageError ? error.kind : "unknown";
}

let cached: StorageDriver | null | undefined;

function baseDriver(): StorageDriver | null {
  if (cached !== undefined) return cached;
  const root = uploadsRootFor(dbUrlOf(process.env));
  cached = root ? createLocalDriver(root) : blobConfigured(process.env) ? createBlobDriver() : null;
  return cached;
}

/** Whether uploads and playback can work at all (D15: never fail-fast at boot). */
export function storageConfigured() {
  return baseDriver() !== null;
}

/** The driver for this request, with the e2e fault hook in front; null when not configured. */
export async function storage(): Promise<StorageDriver | null> {
  const driver = baseDriver();
  if (!driver) return null;
  const fault = await storageFault();
  if (!fault) return driver;
  const fail = (op: "put" | "get" | "delete") => {
    if (fault === op) throw new StorageError(op, "fault");
  };
  return {
    name: driver.name,
    async put(key, bytes, type, signal) {
      fail("put");
      return driver.put(key, bytes, type, signal);
    },
    async get(key, signal) {
      fail("get");
      return driver.get(key, signal);
    },
    async delete(keys, signal) {
      fail("delete");
      return driver.delete(keys, signal);
    },
  };
}
