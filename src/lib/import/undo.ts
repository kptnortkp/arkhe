import "server-only";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  assistantNotes,
  attendance,
  boardTickets,
  duesOverrides,
  duesPeriods,
  financeEntries,
  importBatches,
  importItems,
  invites,
  listeningAssistants,
  memberDues,
  recordings,
  rehearsals,
  sessions,
  sponsors,
  submissions,
  terms,
  users,
} from "@/db/schema";
import { lapsedFreezeDelete } from "@/lib/finance/ledger";
import { canEditMember } from "@/lib/permissions";
import { formatAuditDate, istanbulTimeOf } from "@/lib/time";
import { periodSnapshot } from "./rules/aidat-donemleri";
import type { Actor } from "./rules/common";
import { sponsorSnapshot } from "./rules/hareketler";
import { CONDUCTOR_ONLY, createdSnapshot, overrideSnapshot } from "./rules/uyeler";
import { rehearsalSnapshot } from "./rules/yoklama";
import { chunked, importTx, readAll, type BatchDb, type Stmt } from "./tx";

export const UNDONE = "İçe aktarma geri alındı.";
const NOT_FOUND = "Bu içe aktarma bulunamadı.";
const ALREADY = "Bu içe aktarma zaten geri alındı.";
const NOT_LATEST = "Önce daha sonraki içe aktarmayı geri al.";
const NOT_OWNER = "Bu içe aktarmayı yalnızca yapan kişi ya da koro şefi geri alabilir.";

class Refused extends Error {}
const refuse = (message: string): never => {
  throw new Refused(message);
};

const memberChanged = (name: string) =>
  `${name} bu aktarımdan sonra değişti ya da kullanıldı; geri alınamaz.`;
const entryChanged = (no: string) => `Kayıt ${no} bu aktarımdan sonra değişti; geri alınamaz.`;
const when = (secs: number) => {
  const at = new Date(secs * 1000);
  return `${formatAuditDate(at)} ${istanbulTimeOf(at)}`;
};
const USED_ELSEWHERE = "Bu aktarımdaki bir kayıt portalda kullanıldı; geri alınamaz.";

function isForeignKeyError(error: unknown) {
  let e: unknown = error;
  for (let depth = 0; e && depth < 4; depth++) {
    const x = e as { code?: unknown; extendedCode?: unknown; message?: unknown; cause?: unknown };
    const text = `${String(x.code ?? "")} ${String(x.extendedCode ?? "")} ${String(x.message ?? "")}`;
    if (/FOREIGNKEY|FOREIGN KEY constraint/i.test(text)) return true;
    e = x.cause;
  }
  return false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const parse = <T>(s: string | null) => (s ? (JSON.parse(s) as T) : null);

/** Undo the latest live batch: one write transaction; refused (nothing changed) on any conflict. */
export async function undoBatch(
  actor: Actor,
  batchId: number,
): Promise<{ success: string } | { error: string }> {
  const started = Date.now();
  try {
    await importTx(async (t) => {
      const head = await readAll(t, {
        batch: t.select().from(importBatches).where(eq(importBatches.id, batchId)),
        latest: t
          .select({ id: importBatches.id })
          .from(importBatches)
          .where(eq(importBatches.status, "imported"))
          .orderBy(desc(importBatches.id))
          .limit(1),
        items: t.select().from(importItems).where(eq(importItems.batchId, batchId)),
      });
      const batch = head.batch[0];
      if (!batch) refuse(NOT_FOUND);
      if (batch.status === "undone") refuse(ALREADY);
      if (head.latest[0]?.id !== batch.id) refuse(NOT_LATEST);
      if (actor.role !== "conductor" && batch.createdBy !== actor.id) refuse(NOT_OWNER);
      const writes = await KINDS[batch.kind](t, actor, batch, head.items);
      writes.push(
        t.delete(importItems).where(eq(importItems.batchId, batch.id)),
        t
          .update(importBatches)
          .set({ status: "undone", undoneAt: new Date(), undoneBy: actor.id })
          .where(eq(importBatches.id, batch.id)),
      );
      // Items reference users, entries and sponsors with restrict: they must go first.
      const ordered = [writes.at(-2)!, ...writes.slice(0, -2), writes.at(-1)!];
      try {
        await t.batch(ordered as [Stmt, ...Stmt[]]);
      } catch (error) {
        // A reference the checks above don't know about: a refusal, not "try again".
        if (isForeignKeyError(error)) refuse(USED_ELSEWHERE);
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof Refused) {
      console.info("import", { op: "undo", kind: "refused", ms: Date.now() - started });
      return { error: error.message };
    }
    throw error;
  }
  console.info("import", { op: "undo", kind: "done", ms: Date.now() - started });
  return { success: UNDONE };
}

type Batch = typeof importBatches.$inferSelect;
type Item = typeof importItems.$inferSelect;
type Undo = (t: BatchDb, actor: Actor, batch: Batch, items: Item[]) => Promise<Stmt[]>;

const inBatch = (
  batchId: number,
  column: typeof importItems.userId | typeof importItems.rehearsalId,
) =>
  sql`(select ${column} from ${importItems} where ${importItems.batchId} = ${batchId} and ${column} is not null)`;

const members: Undo = async (t, actor, batch, items) => {
  const userIds = inBatch(batch.id, importItems.userId);
  const at = batch.createdAt;
  const snap = await readAll(t, {
    users: t
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        voicePart: users.voicePart,
        joinedAt: users.joinedAt,
        leftAt: users.leftAt,
        isActive: users.isActive,
        hasPassword: sql<number>`${users.passwordHash} is not null`,
        rate: memberDues.rate,
        rateNote: memberDues.note,
      })
      .from(users)
      .leftJoin(memberDues, eq(memberDues.userId, users.id))
      .where(inArray(users.id, userIds)),
    overrides: t.select().from(duesOverrides).where(inArray(duesOverrides.userId, userIds)),
    entries: t
      .select({ userId: financeEntries.memberId, createdAt: financeEntries.createdAt })
      .from(financeEntries)
      .where(inArray(financeEntries.memberId, userIds)),
    marks: t
      .select({ userId: attendance.userId })
      .from(attendance)
      .innerJoin(rehearsals, eq(rehearsals.id, attendance.rehearsalId))
      .where(
        and(
          inArray(attendance.userId, userIds),
          gte(attendance.recordedAt, at),
          lt(rehearsals.startsAt, at),
        ),
      ),
    allMarks: t
      .select({ userId: attendance.userId })
      .from(attendance)
      .where(inArray(attendance.userId, userIds))
      .groupBy(attendance.userId),
    submissions: t
      .select({ userId: submissions.userId })
      .from(submissions)
      .where(inArray(submissions.userId, userIds)),
    tickets: t
      .select({ userId: boardTickets.assigneeId })
      .from(boardTickets)
      .where(inArray(boardTickets.assigneeId, userIds)),
    sessions: t
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(inArray(sessions.userId, userIds)),
    invites: t
      .select({ userId: invites.userId })
      .from(invites)
      .where(inArray(invites.userId, userIds)),
    recordings: t
      .select({ userId: recordings.userId })
      .from(recordings)
      .where(inArray(recordings.userId, userIds)),
    listening: t
      .select({ userId: listeningAssistants.userId })
      .from(listeningAssistants)
      .where(inArray(listeningAssistants.userId, userIds)),
    notes: t
      .select({ singerId: assistantNotes.singerId, assistantId: assistantNotes.assistantId })
      .from(assistantNotes)
      .where(
        sql`${assistantNotes.singerId} in ${userIds} or ${assistantNotes.assistantId} in ${userIds}`,
      ),
    // The remaining restrict references to users; none is reachable for an inactive former member today.
    referenced: t
      .select({ userId: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, userIds),
          sql`(exists (select 1 from finance_entries e where "users"."id" in (e.created_by, e.updated_by, e.voided_by))
            or exists (select 1 from board_tickets bt where "users"."id" in (bt.created_by, bt.updated_by))
            or exists (select 1 from board_ticket_events be where "users"."id" in (be.actor_id, be.from_user_id, be.to_user_id))
            or exists (select 1 from budgets b where "users"."id" in (b.approved_by, b.created_by, b.updated_by))
            or exists (select 1 from budget_revisions br where br.actor_id = "users"."id")
            or exists (select 1 from listening_assistants la where la.created_by = "users"."id")
            or exists (select 1 from midi_files mf where mf.created_by = "users"."id")
            or exists (select 1 from import_batches ib where "users"."id" in (ib.created_by, ib.undone_by)))`,
        ),
      ),
  });
  const byId = new Map(snap.users.map((u) => [u.id, u]));
  const freezeKeys = new Set(
    items
      .filter((i) => i.target === "dues_override")
      .map((i) => `${i.overrideUserId}|${i.overridePeriodId}`),
  );
  const writes: Stmt[] = [];
  const has = (rows: { userId: string | null }[], id: string) => rows.some((r) => r.userId === id);
  for (const item of items) {
    if (item.target === "dues_override") {
      // The freeze was already removed by hand (e.g. its payment was voided): nothing to undo.
      if (!item.overridePeriodId || !item.overrideUserId) continue;
      const live = snap.overrides.find(
        (o) => o.userId === item.overrideUserId && o.duesPeriodId === item.overridePeriodId,
      );
      if (!live) continue;
      if (!same(overrideSnapshot(live), parse(item.afterJson)))
        refuse(memberChanged(byId.get(item.overrideUserId)?.name ?? "Bir üye"));
      writes.push(
        t
          .delete(duesOverrides)
          .where(
            and(
              eq(duesOverrides.userId, item.overrideUserId!),
              eq(duesOverrides.duesPeriodId, item.overridePeriodId!),
            ),
          ),
      );
      continue;
    }
    if (item.target !== "user") continue;
    const u = byId.get(item.userId!)!;
    if (actor.role !== "conductor" && !canEditMember(actor, u, u.role)) refuse(CONDUCTOR_ONLY);
    const secs = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);
    if (item.action === "update") {
      const now = {
        joinedAt: secs(u.joinedAt),
        leftAt: secs(u.leftAt),
        isActive: u.isActive ? 1 : 0,
        voicePart: u.voicePart,
        rate: u.rate,
        rateNote: u.rateNote,
        role: u.role,
      };
      const built =
        snap.entries.some((e) => e.userId === u.id && e.createdAt >= at) ||
        snap.overrides.some(
          (o) =>
            o.userId === u.id && o.createdAt >= at && !freezeKeys.has(`${u.id}|${o.duesPeriodId}`),
        ) ||
        has(snap.marks, u.id);
      if (!same(now, parse(item.afterJson)) || built) refuse(memberChanged(u.name));
      const before = parse<{
        joinedAt: number;
        leftAt: number | null;
        isActive: 0 | 1;
        voicePart: (typeof u)["voicePart"];
        rate: (typeof u)["rate"];
        rateNote: string | null;
      }>(item.beforeJson)!;
      writes.push(
        t
          .update(users)
          .set({
            joinedAt: new Date(before.joinedAt * 1000),
            leftAt: before.leftAt === null ? null : new Date(before.leftAt * 1000),
            isActive: before.isActive === 1,
            voicePart: before.voicePart,
          })
          .where(eq(users.id, u.id)),
      );
      if (before.rate === null) {
        if (u.rate !== null) writes.push(t.delete(memberDues).where(eq(memberDues.userId, u.id)));
      } else if (before.rate !== u.rate || before.rateNote !== u.rateNote) {
        writes.push(
          t
            .insert(memberDues)
            .values({
              userId: u.id,
              rate: before.rate,
              note: before.rateNote,
              updatedBy: actor.id,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: memberDues.userId,
              set: {
                rate: before.rate,
                note: before.rateNote,
                updatedBy: actor.id,
                updatedAt: new Date(),
              },
            }),
        );
      }
    } else {
      const now = createdSnapshot(u, u.rate, Boolean(u.hasPassword));
      const used =
        has(snap.allMarks, u.id) ||
        snap.entries.some((e) => e.userId === u.id) ||
        snap.overrides.some((o) => o.userId === u.id) ||
        has(snap.submissions, u.id) ||
        has(snap.tickets, u.id) ||
        has(snap.sessions, u.id) ||
        has(snap.invites, u.id) ||
        has(snap.recordings, u.id) ||
        has(snap.listening, u.id) ||
        has(snap.referenced, u.id) ||
        snap.notes.some((n) => n.singerId === u.id || n.assistantId === u.id);
      if (!same(now, parse(item.afterJson)) || used) refuse(memberChanged(u.name));
      writes.push(
        t.delete(memberDues).where(eq(memberDues.userId, u.id)),
        t.delete(users).where(eq(users.id, u.id)),
      );
    }
  }
  // Restores and freeze deletes before the user deletes; the items are removed ahead of all of them.
  return writes;
};

/** Writes run after the items are deleted, so they name their rows explicitly, in chunks. */
const ids = (items: Item[], pick: (i: Item) => string | null) =>
  chunked(items.map(pick).filter((v): v is string => v !== null));

const termsUndo: Undo = async (t, _actor, _batch, items) =>
  ids(items, (i) => i.termId).map((part) => t.delete(terms).where(inArray(terms.id, part)));

const attendanceUndo: Undo = async (t, _actor, batch, items) => {
  const inThisBatch = inBatch(batch.id, importItems.rehearsalId);
  const snap = await readAll(t, {
    rehearsals: t
      .select({
        id: rehearsals.id,
        type: rehearsals.type,
        title: rehearsals.title,
        location: rehearsals.location,
        note: rehearsals.note,
        startsAt: rehearsals.startsAt,
        endsAt: rehearsals.endsAt,
        openedAt: rehearsals.openedAt,
        closedAt: rehearsals.closedAt,
        cancelledAt: rehearsals.cancelledAt,
        // Correlated subqueries are qualified by hand: drizzle drops table names in single-table selects.
        parts: sql<string>`coalesce((select group_concat(p, ',') from (select rp.voice_part as p from rehearsal_parts rp where rp.rehearsal_id = "rehearsals"."id" order by p)), '')`,
        rows: sql<number>`(select count(*) from attendance a where a.rehearsal_id = "rehearsals"."id")`,
        corrected: sql<number>`(select count(*) from attendance a where a.rehearsal_id = "rehearsals"."id" and a.corrected_at is not null)`,
        event: sql<number>`exists (select 1 from events ev where ev.rehearsal_id = "rehearsals"."id")`,
      })
      .from(rehearsals)
      .where(inArray(rehearsals.id, inThisBatch)),
  });
  const byId = new Map(snap.rehearsals.map((r) => [r.id, r]));
  for (const item of items) {
    const after = parse<ReturnType<typeof rehearsalSnapshot>>(item.afterJson)!;
    const label = when(after.startsAt!);
    const r = item.rehearsalId ? byId.get(item.rehearsalId) : undefined;
    if (!r) refuse(`${label} çalışması bu aktarımdan sonra düzeltildi; geri alınamaz.`);
    if (Number(r!.event)) refuse(`${label} çalışmasına bir etkinlik bağlanmış; geri alınamaz.`);
    const now = rehearsalSnapshot(r!, r!.parts ? r!.parts.split(",") : [], Number(r!.rows));
    if (Number(r!.corrected) || !same(now, after)) {
      refuse(`${label} çalışması bu aktarımdan sonra düzeltildi; geri alınamaz.`);
    }
  }
  return ids(items, (i) => i.rehearsalId).map((part) =>
    t.delete(rehearsals).where(inArray(rehearsals.id, part)),
  );
};

/** Entries and waivers of the two finance types; untouched imported entries are deleted (D17). */
const ledgerUndo: Undo = async (t, _actor, batch, items) => {
  const entryIds = sql`(select ${importItems.financeEntryId} from ${importItems} where ${importItems.batchId} = ${batch.id} and ${importItems.financeEntryId} is not null)`;
  const sponsorIds = sql`(select ${importItems.sponsorId} from ${importItems} where ${importItems.batchId} = ${batch.id} and ${importItems.sponsorId} is not null)`;
  const snap = await readAll(t, {
    entries: t
      .select({
        id: financeEntries.id,
        memberId: financeEntries.memberId,
        periodId: financeEntries.duesPeriodId,
        voidedAt: financeEntries.voidedAt,
        revision: financeEntries.revision,
        updatedAt: financeEntries.updatedAt,
        replaced: sql<number>`exists (select 1 from finance_entries r where r.replaces_id = "finance_entries"."id")`,
      })
      .from(financeEntries)
      .where(inArray(financeEntries.id, entryIds)),
    overrides: t
      .select()
      .from(duesOverrides)
      .innerJoin(
        importItems,
        and(
          eq(importItems.overridePeriodId, duesOverrides.duesPeriodId),
          eq(importItems.overrideUserId, duesOverrides.userId),
        ),
      )
      .where(eq(importItems.batchId, batch.id)),
    sponsors: t
      .select({
        id: sponsors.id,
        name: sponsors.name,
        nameKey: sponsors.nameKey,
        contactName: sponsors.contactName,
        contact: sponsors.contact,
        note: sponsors.note,
        isActive: sponsors.isActive,
        others: sql<number>`(select count(*) from finance_entries e where e.sponsor_id = "sponsors"."id" and e.id not in ${entryIds})`,
      })
      .from(sponsors)
      .where(inArray(sponsors.id, sponsorIds)),
  });
  const entryOf = new Map(snap.entries.map((e) => [e.id, e]));
  const writes: Stmt[] = [];
  const pairs = new Map<string, { memberId: string; periodId: string }>();
  for (const item of items) {
    if (item.target === "finance_entry") {
      const e = entryOf.get(item.financeEntryId!);
      if (!e || e.voidedAt || e.revision !== 0 || e.updatedAt || Number(e.replaced))
        refuse(entryChanged(item.kayitNo!));
      if (e!.memberId && e!.periodId)
        pairs.set(`${e!.memberId}|${e!.periodId}`, {
          memberId: e!.memberId,
          periodId: e!.periodId,
        });
    }
    if (item.target === "dues_override") {
      // A waiver removed by hand (Muaf kaldır) is already undone.
      if (!item.overridePeriodId || !item.overrideUserId) continue;
      const live = snap.overrides.find(
        (o) =>
          o.dues_overrides.duesPeriodId === item.overridePeriodId &&
          o.dues_overrides.userId === item.overrideUserId,
      );
      if (!live || !same(overrideSnapshot(live.dues_overrides), parse(item.afterJson))) {
        refuse(entryChanged(item.kayitNo!));
      }
    }
  }
  for (const part of ids(items, (i) => i.financeEntryId)) {
    writes.push(t.delete(financeEntries).where(inArray(financeEntries.id, part)));
  }
  for (const item of items.filter(
    (i) => i.target === "dues_override" && i.overridePeriodId && i.overrideUserId,
  )) {
    writes.push(
      t
        .delete(duesOverrides)
        .where(
          and(
            eq(duesOverrides.duesPeriodId, item.overridePeriodId!),
            eq(duesOverrides.userId, item.overrideUserId!),
            eq(duesOverrides.kind, "waiver"),
          ),
        ),
    );
  }
  for (const p of pairs.values()) writes.push(lapsedFreezeDelete(t, p.memberId, p.periodId));
  for (const item of items.filter((i) => i.target === "sponsor")) {
    const s = snap.sponsors.find((x) => x.id === item.sponsorId);
    // Kept (active) when a hand entry uses it or someone edited it: master data with value.
    if (s && !Number(s.others) && same(sponsorSnapshot(s), parse(item.afterJson))) {
      writes.push(t.delete(sponsors).where(eq(sponsors.id, s.id)));
    }
  }
  return writes;
};

const periodsUndo: Undo = async (t, _actor, batch, items) => {
  const inThisBatch = sql`(select ${importItems.duesPeriodId} from ${importItems} where ${importItems.batchId} = ${batch.id} and ${importItems.duesPeriodId} is not null)`;
  const snap = await readAll(t, {
    periods: t
      .select({
        id: duesPeriods.id,
        name: duesPeriods.name,
        startsOn: duesPeriods.startsOn,
        endsOn: duesPeriods.endsOn,
        dueOn: duesPeriods.dueOn,
        amountKurus: duesPeriods.amountKurus,
        reducedAmountKurus: duesPeriods.reducedAmountKurus,
        used: sql<number>`exists (select 1 from finance_entries e where e.dues_period_id = "dues_periods"."id") or exists (select 1 from dues_overrides o where o.dues_period_id = "dues_periods"."id")`,
      })
      .from(duesPeriods)
      .where(inArray(duesPeriods.id, inThisBatch)),
  });
  for (const item of items) {
    // A period deleted by hand (Dönemi sil) is already undone.
    if (!item.duesPeriodId) continue;
    const after = parse<ReturnType<typeof periodSnapshot>>(item.afterJson)!;
    const p = snap.periods.find((x) => x.id === item.duesPeriodId);
    if (!p || !same(periodSnapshot(p), after))
      refuse(`${after.name} dönemi bu aktarımdan sonra değişti; geri alınamaz.`);
    if (Number(p!.used)) refuse(`${p!.name} dönemine ödeme girilmiş; geri alınamaz.`);
  }
  return ids(items, (i) => i.duesPeriodId).map((part) =>
    t.delete(duesPeriods).where(inArray(duesPeriods.id, part)),
  );
};

const KINDS: Record<Batch["kind"], Undo> = {
  members,
  terms: termsUndo,
  attendance: attendanceUndo,
  entries: ledgerUndo,
  dues_periods: periodsUndo,
  dues_payments: ledgerUndo,
};
