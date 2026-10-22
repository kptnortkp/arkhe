import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import {
  backupRuns,
  duesPeriods,
  events,
  financeEntries,
  importBatches,
  importItems,
  memberDues,
  users,
} from "@/db/schema";
import { isDuesPayer } from "@/lib/finance/dues";
import { requireManager } from "@/lib/auth/dal";
import { collator } from "@/lib/format";
import { istanbulDateOf } from "@/lib/time";
import { DUES_RATE_CODES, VOICE_PART_CODES } from "./codes";
import type { ImportDef, LiveData } from "./def";
import { DEFS, defOfKind } from "./defs";
import { markdown, promptText } from "./docs";
import type { Slug } from "./limits";

export type StepCard = {
  slug: Slug;
  step: number;
  title: string;
  summary: string;
  last: { at: Date; by: string; rows: number } | null;
  /** The "Sıradaki" chip (D31): first type with no live import above every imported type. */
  next: boolean;
};

/** Everything the index page shows (AC 3). */
export async function importIndex() {
  await requireManager();
  // The newest live batch per type; a plain IN keeps the outer column names unambiguous.
  const latest = sql`(select max(b.id) from import_batches b where b.status = 'imported' group by b.kind)`;
  const [cards, backup, openings] = await db.batch([
    db
      .select({
        kind: importBatches.kind,
        createdAt: importBatches.createdAt,
        rows: importBatches.rowCount,
        by: users.name,
      })
      .from(importBatches)
      .innerJoin(users, eq(users.id, importBatches.createdBy))
      .where(inArray(importBatches.id, latest)),
    db
      .select({ at: sql<number | null>`max(${backupRuns.finishedAt})` })
      .from(backupRuns)
      .where(eq(backupRuns.status, "sent")),
    db
      .select({ account: financeEntries.account, amountKurus: financeEntries.amountKurus, on: financeEntries.occurredOn })
      .from(financeEntries)
      .where(and(eq(financeEntries.kind, "opening"), isNull(financeEntries.voidedAt))),
  ]);
  const lastOf = new Map(cards.map((c) => [c.kind, c]));
  const highest = Math.max(0, ...DEFS.filter((d) => lastOf.has(d.kind)).map((d) => d.step));
  const nextStep = DEFS.find((d) => !lastOf.has(d.kind) && d.step > highest)?.step ?? null;
  const steps: StepCard[] = DEFS.map((d) => {
    const c = lastOf.get(d.kind);
    return {
      slug: d.slug,
      step: d.step,
      title: d.title,
      summary: d.summary,
      last: c ? { at: c.createdAt, by: c.by, rows: c.rows } : null,
      next: d.step === nextStep,
    };
  });
  const backupAt = backup[0]?.at;
  return {
    steps,
    /** False until a live Üye geçmişi batch exists: join dates are still invite days (steps 3 and 6 warn). */
    memberHistoryImported: lastOf.has("members"),
    lastBackupAt: backupAt ? new Date(Number(backupAt) * 1000) : null,
    opening: openings.length
      ? {
          date: openings[0].on,
          cash: openings.find((o) => o.account === "cash")?.amountKurus ?? 0,
          bank: openings.find((o) => o.account === "bank")?.amountKurus ?? 0,
        }
      : null,
  };
}

export const BATCHES_PER_PAGE = 50;

export type BatchRow = {
  id: number;
  slug: Slug;
  title: string;
  createdAt: Date;
  by: string;
  fileName: string;
  fileSize: number;
  sha12: string;
  counts: { added: number; updated: number; unchanged: number };
  undone: { at: Date; by: string } | null;
  /** The latest live batch: the only one that can be undone. */
  latest: boolean;
  /** latest and (the viewer imported it or is the conductor). */
  canUndo: boolean;
};

/** The log, newest first (AC 37). `page` is 1-based. */
export async function listBatches(requested: number) {
  const viewer = await requireManager();
  const page = Number.isInteger(requested) && requested >= 1 && requested <= 1000 ? requested : 1;
  const undoer = alias(users, "undoer");
  const rows = await db
    .select({
      id: importBatches.id,
      kind: importBatches.kind,
      status: importBatches.status,
      createdAt: importBatches.createdAt,
      createdBy: importBatches.createdBy,
      by: users.name,
      fileName: importBatches.fileName,
      fileSize: importBatches.fileSize,
      sha: importBatches.fileSha256,
      added: importBatches.addedCount,
      updated: importBatches.updatedCount,
      unchanged: importBatches.unchangedCount,
      undoneAt: importBatches.undoneAt,
      undoneBy: undoer.name,
      latestLive: sql<number>`${importBatches.id} = (select max(id) from import_batches where status = 'imported')`,
    })
    .from(importBatches)
    .innerJoin(users, eq(users.id, importBatches.createdBy))
    .leftJoin(undoer, eq(undoer.id, importBatches.undoneBy))
    .orderBy(desc(importBatches.id))
    .limit(BATCHES_PER_PAGE + 1)
    .offset((page - 1) * BATCHES_PER_PAGE);
  const batches: BatchRow[] = rows.slice(0, BATCHES_PER_PAGE).map((r) => {
    const def = defOfKind(r.kind);
    const latest = Boolean(Number(r.latestLive));
    return {
      id: r.id,
      slug: def.slug,
      title: def.title,
      createdAt: r.createdAt,
      by: r.by,
      fileName: r.fileName,
      fileSize: r.fileSize,
      sha12: r.sha.slice(0, 12),
      counts: { added: r.added, updated: r.updated, unchanged: r.unchanged },
      undone: r.undoneAt ? { at: r.undoneAt, by: r.undoneBy ?? "" } : null,
      latest,
      canUndo: latest && (viewer.role === "conductor" || r.createdBy === viewer.id),
    };
  });
  return { batches, hasMore: rows.length > BATCHES_PER_PAGE };
}

/** AC 35 marker on /calismalar/<id>; call only for managers. */
export async function rehearsalImported(id: string) {
  await requireManager();
  const [row] = await db
    .select({ id: importItems.id })
    .from(importItems)
    .where(eq(importItems.rehearsalId, id))
    .limit(1);
  return Boolean(row);
}

/** AC 35 marker on an entry's page: its kayit_no when it was imported. */
export async function entryRecordNo(id: string) {
  await requireManager();
  const [row] = await db
    .select({ no: importItems.kayitNo })
    .from(importItems)
    .where(eq(importItems.financeEntryId, id))
    .limit(1);
  return row?.no ?? null;
}

export const MEMBER_LIST_HEADER = [
  "eposta",
  "ad",
  "partisyon",
  "rol",
  "durum",
  "katilim_tarihi",
  "ayrilis_tarihi",
  "aidat_orani",
];
const ROLE_CODES = { conductor: "sef", board: "yonetim", member: "korist" } as const;

/** AC 4: every user in the import formats. */
export async function memberListRows() {
  await requireManager();
  const rows = await db
    .select({
      email: users.email,
      name: users.name,
      voicePart: users.voicePart,
      role: users.role,
      isActive: users.isActive,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
      rate: memberDues.rate,
    })
    .from(users)
    .leftJoin(memberDues, eq(memberDues.userId, users.id));
  return rows
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((u) => [
      u.email,
      u.name,
      u.voicePart ? VOICE_PART_CODES.codeOf(u.voicePart) : "",
      ROLE_CODES[u.role],
      u.isActive ? "aktif" : "ayrildi",
      istanbulDateOf(u.joinedAt),
      u.leftAt ? istanbulDateOf(u.leftAt) : "",
      // No row means the standard rate; the conductor pays no dues.
      isDuesPayer(u.role) ? DUES_RATE_CODES.codeOf(u.rate ?? "standard") : "",
    ]);
}

/** The portal lists a copied prompt names (steps 4 and 6). */
export async function liveData(): Promise<LiveData> {
  await requireManager();
  const [periods, eventRows, first] = await db.batch([
    db
      .select({
        name: duesPeriods.name,
        startsOn: duesPeriods.startsOn,
        endsOn: duesPeriods.endsOn,
        dueOn: duesPeriods.dueOn,
        amountKurus: duesPeriods.amountKurus,
        reducedAmountKurus: duesPeriods.reducedAmountKurus,
      })
      .from(duesPeriods)
      .orderBy(asc(duesPeriods.startsOn)),
    db.select({ name: events.name }).from(events),
    db
      .select({ on: sql<string | null>`min(${financeEntries.occurredOn})` })
      .from(financeEntries)
      .where(
        and(
          isNull(financeEntries.voidedAt),
          sql`${financeEntries.kind} <> 'opening'`,
          sql`coalesce(${financeEntries.category}, '') <> 'dues'`,
          sql`${financeEntries.id} not in (select ${importItems.financeEntryId} from ${importItems} where ${importItems.financeEntryId} is not null)`,
        ),
      ),
  ]);
  return { periods, events: eventRows.map((e) => e.name), firstHandEntry: first[0]?.on ?? null };
}

/** The prompt as the type page copies it: portal lists filled in where the type has them. */
export async function livePrompt(def: ImportDef) {
  return promptText(def, def.live?.length ? await liveData() : null);
}

/** The .md as Talimatı indir serves it. */
export async function liveMarkdown(def: ImportDef) {
  return markdown(def, def.live?.length ? await liveData() : null);
}

