import "server-only";
import type { Client } from "@libsql/client";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { isBusy } from "@/db/write-tx";

/** A query handle that can send many statements in one round trip: the db or a write transaction. */
export type BatchDb = LibSQLDatabase<typeof schema>;
export type Stmt = BatchItem<"sqlite">;

/** D29: no statement of the import binds more than this many parameters. */
export const MAX_PARAMS = 999;

/**
 * One interactive write transaction (BEGIN IMMEDIATE) whose handle batches statements, so a commit
 * is: begin, one batch of reads, one batch of writes, commit (D30). Retried on SQLITE_BUSY.
 */
export async function importTx<T>(fn: (t: BatchDb) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let tx: Awaited<ReturnType<Client["transaction"]>> | null = null;
    try {
      tx = await db.$client.transaction("write");
      // The transaction has execute() and batch(), which is all drizzle's session calls.
      const t = drizzle(tx as unknown as Client, { schema });
      const result = await fn(t);
      await tx.commit();
      return result;
    } catch (error) {
      if (tx && !tx.closed) await tx.rollback().catch(() => {});
      if (attempt >= 6 || !isBusy(error)) throw error;
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt + Math.random() * 40));
    } finally {
      tx?.close();
    }
  }
}

type Readers = Record<string, Stmt>;
export type Snapshot<R extends Readers> = { [K in keyof R]: Awaited<R[K]> };

/** All reads in one batch: one round trip and one consistent snapshot. */
export async function readAll<R extends Readers>(q: BatchDb, readers: R): Promise<Snapshot<R>> {
  const keys = Object.keys(readers);
  const results = await q.batch(keys.map((k) => readers[k]) as unknown as [Stmt, ...Stmt[]]);
  return Object.fromEntries(keys.map((k, i) => [k, results[i]])) as Snapshot<R>;
}

function paramCount(stmt: Stmt) {
  return (stmt as unknown as { toSQL(): { params: unknown[] } }).toSQL().params.length;
}

/** Multi-row inserts, split so every statement stays within MAX_PARAMS. */
export function insertChunks<T extends SQLiteTable>(
  q: BatchDb,
  table: T,
  rows: readonly T["$inferInsert"][],
): Stmt[] {
  const out: Stmt[] = [];
  const emit = (part: readonly T["$inferInsert"][]) => {
    const stmt = q.insert(table).values(part as T["$inferInsert"][]) as unknown as Stmt;
    if (paramCount(stmt) <= MAX_PARAMS) return out.push(stmt);
    if (part.length === 1) throw new Error("import: one row exceeds the parameter cap");
    const mid = Math.ceil(part.length / 2);
    emit(part.slice(0, mid));
    emit(part.slice(mid));
  };
  if (rows.length === 0) return out;
  const per = paramCount(q.insert(table).values(rows[0] as T["$inferInsert"]) as unknown as Stmt);
  const size = Math.max(1, Math.floor(MAX_PARAMS / Math.max(1, per)));
  for (let i = 0; i < rows.length; i += size) emit(rows.slice(i, i + size));
  return out;
}

/** Splits `values` into groups that fit an `in (…)` list next to `extra` other parameters. */
export function chunked<T>(values: readonly T[], extra = 0): T[][] {
  const size = MAX_PARAMS - extra;
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
