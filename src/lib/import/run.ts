import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { importBatches, users } from "@/db/schema";
import { cleanLine } from "@/lib/text";
import { formatAuditDate, istanbulDateOf } from "@/lib/time";
import { decode, parseCsv } from "./csv";
import { headerLine, type ImportDef } from "./def";
import { defOf } from "./defs";
import { mapRecords, type ImportRow } from "./engine";
import { IMPORT_MAX_BYTES, IMPORT_MAX_EFFECTS, IMPORT_MAX_ERRORS, NO_ROWS, TOO_BIG, type Slug } from "./limits";
import { aidatDonemleriRules } from "./rules/aidat-donemleri";
import { aidatOdemeleriRules } from "./rules/aidat-odemeleri";
import type { Actor, Ctx, Plan, Rules } from "./rules/common";
import { donemlerRules } from "./rules/donemler";
import { hareketlerRules } from "./rules/hareketler";
import { uyelerRules } from "./rules/uyeler";
import { yoklamaRules } from "./rules/yoklama";
import { importTx, readAll, type BatchDb, type Stmt } from "./tx";
import type { CheckResult, CommitResult, FileMeta, Warning } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RULES: Record<Slug, Rules<any>> = {
  uyeler: uyelerRules,
  donemler: donemlerRules,
  yoklama: yoklamaRules,
  hareketler: hareketlerRules,
  "aidat-donemleri": aidatDonemleriRules,
  "aidat-odemeleri": aidatOdemeleriRules,
};

export const HASH_MISMATCH = "Dosya kontrol edildikten sonra değişti. Yeniden kontrol et.";
export const CHECK_FIRST = "Önce dosyayı kontrol et.";
export const NOTHING_TO_CHANGE = "Değişecek bir şey yok; bu dosyadaki her şey zaten portalda.";

export type Upload = { name: string; size: number; bytes: Uint8Array };

export class ImportFault extends Error {}

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Basename, no control or bidi characters, ≤ 120: what the log may show. */
export function cleanFileName(raw: string) {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const clean = cleanLine(base).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120).trim();
  return clean || "dosya.csv";
}

function meta(file: Upload): FileMeta {
  return { name: cleanFileName(file.name), size: file.size, sha256: sha256(file.bytes) };
}

function fileError(file: FileMeta | null, messages: string[]) {
  return { kind: "fileError" as const, file, message: messages.join("\n"), messages };
}

type Prepared = { ok: true; rows: ImportRow[] } | { ok: false; messages: string[] };

/** Size → bytes → text → records → typed rows. Pure; every failure is a whole-file error. */
export function prepare(def: ImportDef, file: Upload): Prepared {
  if (file.size === 0 || file.bytes.length === 0) return { ok: false, messages: [NO_ROWS] };
  if (file.size > IMPORT_MAX_BYTES || file.bytes.length > IMPORT_MAX_BYTES) {
    return { ok: false, messages: [TOO_BIG] };
  }
  const text = decode(file.bytes);
  if (!text.ok) return { ok: false, messages: [text.message] };
  const records = parseCsv(text.text);
  if (!records.ok) return { ok: false, messages: [records.message] };
  return mapRecords(def, records.records);
}

const sameFileRead = (q: BatchDb, hash: string) =>
  q
    .select({ createdAt: importBatches.createdAt, name: users.name })
    .from(importBatches)
    .innerJoin(users, eq(users.id, importBatches.createdBy))
    .where(and(eq(importBatches.fileSha256, hash), eq(importBatches.status, "imported")))
    .orderBy(desc(importBatches.id))
    .limit(1);

const nextIdRead = (q: BatchDb) =>
  q
    .select({
      next: sql<number>`max(coalesce((select max(id) from import_batches), 0), coalesce((select seq from sqlite_sequence where name = 'import_batches'), 0)) + 1`,
    })
    .from(sql`(select 1)`);

function sameFileWarning(rows: { createdAt: Date; name: string }[]): Warning[] {
  const hit = rows[0];
  return hit
    ? [{ kind: "sameFile", text: `Bu dosya ${formatAuditDate(hit.createdAt)} tarihinde ${hit.name} tarafından aktarılmıştı.` }]
    : [];
}

function ctxOf(actor: Actor): Ctx {
  const now = new Date();
  return { actor, now, today: istanbulDateOf(now) };
}

function evaluate(def: ImportDef, rows: ImportRow[], plan: Plan, file: FileMeta, extra: Warning[]): CheckResult {
  const rowCount = rows.length;
  if (plan.errors.length) {
    const errorCount = plan.errors.length;
    return {
      kind: "errors",
      file,
      rowCount,
      errorCount,
      capped: errorCount > IMPORT_MAX_ERRORS,
      errors: plan.errors.slice(0, IMPORT_MAX_ERRORS),
      summary: `${rowCount} satır okundu · ${errorCount} hata. Hiçbir şey yazılmadı. Dosyayı düzeltip yeniden yükle.`,
    };
  }
  const { added, updated, unchanged } = plan.counts;
  const warnings = [...plan.warnings, ...extra];
  if (added + updated === 0) {
    return { kind: "unchanged", file, rowCount, counts: plan.counts, warnings, message: NOTHING_TO_CHANGE };
  }
  return {
    kind: "clean",
    file,
    rowCount,
    counts: plan.counts,
    warnings,
    balances: plan.balances,
    notes: plan.notes,
    effects: plan.effects.slice(0, IMPORT_MAX_EFFECTS),
    effectsMore: Math.max(plan.effects.length - IMPORT_MAX_EFFECTS, 0),
    summary: `${rowCount} satır okundu · ${added} eklenecek · ${updated} güncellenecek · ${unchanged} değişmeyecek`,
    deactivations: plan.deactivations,
  };
}

function log(op: string, slug: Slug, started: number, result: { kind: string }, rows = 0, statements?: number) {
  console.info("import", { op, slug, kind: result.kind, rows, statements, ms: Date.now() - started });
}

/** Kontrol et: one batch of reads, the plan, and nothing written. */
export async function checkFile(actor: Actor, slug: Slug, upload: Upload): Promise<CheckResult> {
  const started = Date.now();
  const def = defOf(slug);
  const file = meta(upload);
  const prepared = prepare(def, upload);
  if (!prepared.ok) return fileError(file, prepared.messages);
  const rules = RULES[slug];
  const ctx = ctxOf(actor);
  const snap = await readAll(db, { ...rules.reads(db, prepared.rows, ctx), sameFile: sameFileRead(db, file.sha256) });
  const result = evaluate(def, prepared.rows, rules.plan(prepared.rows, snap, ctx), file, sameFileWarning(snap.sameFile));
  log("check", slug, started, result, prepared.rows.length);
  return result;
}

export type CommitOptions = { previewedSha: unknown; faultAt?: number | null };

/** İçe aktar: hash, then the same reads and plan inside one write transaction, then all writes. */
export async function commitFile(
  actor: Actor,
  slug: Slug,
  upload: Upload,
  { previewedSha, faultAt = null }: CommitOptions,
): Promise<CommitResult> {
  const started = Date.now();
  const def = defOf(slug);
  if (typeof previewedSha !== "string" || !/^[0-9a-f]{64}$/.test(previewedSha)) {
    return fileError(null, [CHECK_FIRST]);
  }
  const file = meta(upload);
  // Guards against an accidental file swap only; integrity comes from re-planning under the write lock.
  if (file.sha256 !== previewedSha) return fileError(file, [HASH_MISMATCH]);
  const prepared = prepare(def, upload);
  if (!prepared.ok) return fileError(file, prepared.messages);
  const rows = prepared.rows;
  const rules = RULES[slug];
  let statements = 0;
  const result = await importTx(async (t): Promise<CommitResult> => {
    const ctx = ctxOf(actor);
    const snap = await readAll(t, {
      ...rules.reads(t, rows, ctx),
      sameFile: sameFileRead(t, file.sha256),
      next: nextIdRead(t),
    });
    const plan = rules.plan(rows, snap, ctx);
    const checked = evaluate(def, rows, plan, file, sameFileWarning(snap.sameFile));
    if (checked.kind === "errors") return { ...checked, afterCheck: true };
    // A second tap re-plans against the first one's result: everything unchanged, no batch.
    if (checked.kind !== "clean") return checked;
    const batchId = Number(snap.next[0].next);
    const writes: Stmt[] = [
      t.insert(importBatches).values({
        id: batchId,
        kind: def.kind,
        fileName: file.name,
        fileSize: file.size,
        fileSha256: file.sha256,
        rowCount: rows.length,
        addedCount: plan.counts.added,
        updatedCount: plan.counts.updated,
        unchangedCount: plan.counts.unchanged,
        createdBy: actor.id,
        createdAt: ctx.now,
      }),
      ...plan.writes(t, batchId),
    ];
    if (faultAt !== null && faultAt > 0) {
      // Test hook: write the statements up to about row `faultAt`, then fail; everything rolls back.
      const cut = Math.min(writes.length, Math.max(1, Math.round((writes.length * faultAt) / rows.length)));
      await t.batch(writes.slice(0, cut) as [Stmt, ...Stmt[]]);
      throw new ImportFault(`e2e import fault after ${cut} of ${writes.length} statements`);
    }
    statements = writes.length;
    await t.batch(writes as [Stmt, ...Stmt[]]);
    const { added, updated, unchanged } = plan.counts;
    return {
      kind: "done",
      batchId,
      counts: plan.counts,
      message: `İçe aktarıldı: ${added} eklendi, ${updated} güncellendi, ${unchanged} değişmedi.`,
      links: plan.links ?? [...def.links],
      ...(slug === "uyeler"
        ? { hint: "Sıradaki adımlardan önce üye listesini yeniden indir; eski üyeler artık listede." }
        : {}),
    };
  });
  log("commit", slug, started, result, rows.length, statements);
  return result;
}

export { headerLine };
