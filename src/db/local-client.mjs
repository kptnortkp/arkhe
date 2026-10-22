// Plain JS so the e2e suite can share it with the app and the tsx scripts.
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { ConnectionPool, Sqlite3Client } from "@libsql/client/sqlite3";

const MAX_CONNECTIONS = 20;
const wrapped = new WeakSet();
const tainted = new WeakSet();
const EXPLAIN = /^\s*explain\b/i;

/**
 * libsql's native driver never resets a statement whose step failed (SQLITE_BUSY above all), nor an
 * EXPLAIN it ran to the end: either stays active until garbage collection. Then later autocommit
 * writes on that pooled connection never commit and hold the write lock, and its reads keep an old
 * snapshot. Such a connection is closed when it comes back, never reused.
 */
class DiscardingPool extends ConnectionPool {
  acquireSync(forTransaction) {
    const conn = super.acquireSync(forTransaction);
    if (!wrapped.has(conn)) {
      wrapped.add(conn);
      const prepare = conn.prepare.bind(conn);
      conn.prepare = (sql) => {
        const stmt = prepare(sql);
        if (EXPLAIN.test(sql)) tainted.add(conn);
        for (const method of ["run", "all", "get", "iterate"]) {
          const original = stmt[method];
          stmt[method] = function (...args) {
            try {
              return original.apply(this, args);
            } catch (error) {
              tainted.add(conn);
              throw error;
            }
          };
        }
        return stmt;
      };
    }
    return conn;
  }

  release(conn) {
    if (tainted.has(conn) && conn.open) {
      try {
        conn.close();
      } catch {
        // Never pooled again; the native handle goes with garbage collection.
        conn.open = false;
      }
    }
    super.release(conn);
  }
}

function filePath(url) {
  const bare = url.split("?")[0];
  return bare.startsWith("file://") ? fileURLToPath(bare) : bare.slice("file:".length);
}

/**
 * A libSQL client; `file:` URLs get a pool that discards poisoned connections.
 * @param {import("@libsql/client").Config} config
 * @returns {import("@libsql/client").Client}
 */
export function createLibsqlClient(config) {
  if (!config.url.startsWith("file:")) return createClient(config);
  const pool = new DiscardingPool(
    filePath(config.url),
    { authToken: config.authToken, timeout: config.timeout },
    MAX_CONNECTIONS,
  );
  // Fail fast if the file cannot be opened at all.
  pool.release(pool.acquireSync());
  return new Sqlite3Client(pool, config.intMode ?? "number");
}
