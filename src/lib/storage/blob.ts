import "server-only";
import { StorageError, type StorageDriver, type StorageErrorKind } from "./driver";

type Env = Record<string, string | undefined>;

/** Vercel adds BLOB_STORE_ID (with OIDC) when a store is connected; elsewhere a read-write token. */
export function blobConfigured(env: Env) {
  return Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN);
}

const sdk = () => import("@vercel/blob");

type Sdk = Awaited<ReturnType<typeof sdk>>;

/** instanceof, not class names: names don't survive minification. */
function kindOf(m: Sdk, error: unknown): StorageErrorKind {
  if (error instanceof m.BlobStoreSuspendedError) return "suspended";
  if (error instanceof m.BlobServiceRateLimited) return "rate_limited";
  if (error instanceof m.BlobServiceNotAvailable || error instanceof m.BlobRequestAbortedError)
    return "unavailable";
  if (
    error instanceof m.BlobAccessError ||
    error instanceof m.BlobStoreNotFoundError ||
    error instanceof m.BlobClientTokenExpiredError
  )
    return "auth";
  const name = (error as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError" || error instanceof TypeError)
    return "unavailable";
  return "unknown";
}

/** A private Vercel Blob store (D15); pathnames are recordings/<uuid>.<ext> and midi/<uuid>.mid. */
export function createBlobDriver(): StorageDriver {
  return {
    name: "blob",
    async put(key, bytes, type, signal) {
      const m = await sdk();
      try {
        await m.put(key, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
          access: "private",
          contentType: type,
          addRandomSuffix: false,
          allowOverwrite: false,
          abortSignal: signal,
        });
      } catch (cause) {
        throw new StorageError("put", kindOf(m, cause), { cause });
      }
    },
    async get(key, signal) {
      const m = await sdk();
      try {
        const result = await m.get(key, { access: "private", abortSignal: signal });
        if (!result) return null;
        if (result.statusCode !== 200) throw new Error("unexpected blob status");
        // The SDK reports 0 when the response has no Content-Length.
        return { body: result.stream, size: result.blob.size || null };
      } catch (cause) {
        throw new StorageError("get", kindOf(m, cause), { cause });
      }
    },
    async delete(keys, signal) {
      if (keys.length === 0) return;
      const m = await sdk();
      try {
        await m.del([...keys], { abortSignal: signal });
      } catch (cause) {
        throw new StorageError("delete", kindOf(m, cause), { cause });
      }
    },
  };
}
