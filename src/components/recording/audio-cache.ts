"use client";

/** Thrown for a non-2xx answer, carrying the response so callers can read its message. */
export class AudioFetchError extends Error {
  constructor(readonly response: Response) {
    super(`audio ${response.status}`);
  }
}

// Rehearsal audio never changes under its id, so a file is kept on the phone and fetched once, even
// across app restarts: the browser's HTTP cache can't be relied on for large files (iOS home-screen
// apps), and every fetch counts toward the choir's 30-day listening quota. IndexedDB rather than
// Cache Storage, because the service worker drops caches that aren't its own on every update.
// Bytes rather than Blobs: WebKit can hand back stored Blobs that no longer read after a restart.
const DB_NAME = "arkhe-audio";
// 2: entries hold an ArrayBuffer; version 1 Blob entries are dropped on upgrade.
const DB_VERSION = 2;
const STORE = "files";
/** Least recently played files go first beyond this; one file is at most 4 MB. */
const MAX_BYTES = 200_000_000;
const MAX_IDLE_MS = 60 * 24 * 3_600_000;

type Entry = { src: string; data: ArrayBuffer; type: string; size: number; usedAt: number };

const memory = new Map<string, Promise<Blob>>();

function open(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: "src" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const pending = open();
  if (!pending) return undefined;
  const db = await pending;
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function readStored(src: string): Promise<Blob | null> {
  try {
    const entry = (await withStore<Entry>("readonly", (s) => s.get(src))) as Entry | undefined;
    if (!(entry?.data instanceof ArrayBuffer) || entry.data.byteLength !== entry.size) return null;
    void withStore("readwrite", (s) => {
      s.put({ ...entry, usedAt: Date.now() });
    }).catch(() => {});
    return new Blob([entry.data], { type: entry.type });
  } catch {
    return null;
  }
}

async function store(src: string, blob: Blob) {
  try {
    const data = await blob.arrayBuffer();
    await withStore("readwrite", (s) => {
      s.put({
        src,
        data,
        type: blob.type,
        size: data.byteLength,
        usedAt: Date.now(),
      } satisfies Entry);
    });
    await prune();
  } catch {
    // Full or blocked storage only means the next session fetches again.
  }
}

/** Drops files idle for two months, then the least recently played beyond the size cap. */
async function prune() {
  const all = ((await withStore<Entry[]>("readonly", (s) => s.getAll())) ?? []) as Entry[];
  const now = Date.now();
  all.sort((a, b) => b.usedAt - a.usedAt);
  let total = 0;
  const drop: string[] = [];
  for (const e of all) {
    total += e.size;
    if (total > MAX_BYTES || now - e.usedAt > MAX_IDLE_MS) drop.push(e.src);
  }
  if (drop.length === 0) return;
  await withStore("readwrite", (s) => {
    for (const src of drop) s.delete(src);
  });
}

async function load(src: string, fresh: boolean): Promise<Blob> {
  const stored = fresh ? null : await readStored(src);
  if (stored) return stored;
  const res = await fetch(src);
  if (!res.ok) throw new AudioFetchError(res);
  const blob = await res.blob();
  void store(src, blob);
  return blob;
}

/** `fresh` skips the stored copy: the caller found it unplayable and wants it from the server. */
export function fetchAudio(src: string, { fresh = false } = {}): Promise<Blob> {
  let pending = fresh ? undefined : memory.get(src);
  if (!pending) {
    pending = load(src, fresh);
    // A failure is not kept: the next tap asks again.
    pending.catch(() => memory.delete(src));
    memory.set(src, pending);
  }
  return pending;
}

/** Logout: the next person on a shared phone starts with nothing stored. */
export function clearAudioCache() {
  memory.clear();
  if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DB_NAME);
}
