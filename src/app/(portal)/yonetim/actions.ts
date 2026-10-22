"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { writeTx, type Tx } from "@/db/write-tx";
import { ticketChanged, type TicketEvent } from "@/lib/push/triggers";
import { boardTicketEvents, boardTicketReads, boardTickets, users } from "@/db/schema";
import { consumeAttempt, forgetAttempt } from "@/lib/auth/rate-limit";
import { assertManager } from "@/lib/auth/dal";
import {
  BAD_ASSIGNEE,
  COMMENT_DELETE_WINDOW_S,
  COMMENT_LIMIT,
  COMMENT_NOT_OWN,
  COMMENT_TOO_OLD,
  commentSchema,
  CREATE_LIMIT,
  createTicketSchema,
  DELETE_TICKET_DENIED,
  movedMessage,
  moveSchema,
  RATE_LIMITED,
  TICKET_NOT_FOUND,
  TICKET_STALE,
  ticketNumber,
  updateTicketSchema,
} from "@/lib/board/rules";
import { FieldError, guarded } from "@/lib/finance/guard";
import { CHECK_FAILED, FORBIDDEN, NOT_FOUND } from "@/lib/finance/schemas";
import { setFlash } from "@/lib/flash";
import { fieldErrorsOf, formValues, type FormState } from "@/lib/validation";

const t = boardTickets;
const ev = boardTicketEvents;
const nowSql = sql`(unixepoch())`;
const EDIT_FIELDS = ["title", "description", "assigneeId", "urgency", "dueOn"];

// The sidebar badge and the home card live outside /yonetim.
function revalidateBoard() {
  revalidatePath("/", "layout");
}

async function checkAssignee(tx: Tx, id: string | null) {
  if (!id) return;
  const [ok] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.id, id), eq(users.isActive, true), inArray(users.role, ["conductor", "board"])),
    );
  if (!ok) throw new FieldError("assigneeId", BAD_ASSIGNEE);
}

/** Acting on a ticket counts as seeing it (D30): my marker moves to its latest entry and revision. */
async function markSeen(tx: Tx, ticketId: string, userId: string) {
  await tx.run(sql`
    insert into ${boardTicketReads} (user_id, ticket_id, seen_event_id, seen_revision, seen_at)
    select ${userId}, tk.id,
           coalesce((select max(e.id) from ${ev} e where e.ticket_id = tk.id), 0), tk.revision, unixepoch()
      from ${t} tk where tk.id = ${ticketId}
    on conflict (user_id, ticket_id) do update set
      seen_event_id = max(seen_event_id, excluded.seen_event_id),
      seen_revision = max(seen_revision, excluded.seen_revision),
      seen_at = excluded.seen_at`);
}

/** The form's per-mount uuid is the ticket id, so a double submit lands on the same ticket. */
export async function createTicket(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: TICKET_STALE };
  const parsed = createTicketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const d = parsed.data;
  // Validation failures never reach this, so typos don't count toward the limit.
  const limit = await consumeAttempt(
    `board-create:${actor.id}`,
    CREATE_LIMIT.max,
    CREATE_LIMIT.windowMs,
  );
  if (limit.blocked) return { error: RATE_LIMITED, values: formValues(formData) };

  let number = 0;
  let fresh = false;
  // A double submit or a refused assignee isn't a new attempt.
  let free = false;
  const state = await guarded(formData, async () => {
    const result = await writeTx(async (tx) => {
      const [replay] = await tx
        .select({ number: t.number, createdBy: t.createdBy })
        .from(t)
        .where(eq(t.id, id.data));
      if (replay) {
        free = replay.createdBy === actor.id;
        return free ? replay.number : null;
      }
      await checkAssignee(tx, d.assigneeId);
      const [seq] = await tx.all<{ n: number }>(sql`
        insert into board_ticket_seq (id, last_number)
        values (1, (select coalesce(max(number), 0) from ${t}) + 1)
        on conflict (id) do update set
          last_number = max(last_number, (select coalesce(max(number), 0) from ${t})) + 1
        returning last_number as n`);
      const n = Number(seq.n);
      await tx.insert(t).values({
        id: id.data,
        number: n,
        title: d.title,
        description: d.description,
        status: d.status,
        urgency: d.urgency,
        assigneeId: d.assigneeId,
        dueOn: d.dueOn,
        doneAt: d.status === "done" ? nowSql : null,
        createdBy: actor.id,
        createdAt: nowSql,
        updatedAt: nowSql,
      });
      await tx.insert(ev).values({ ticketId: id.data, kind: "created", actorId: actor.id });
      await markSeen(tx, id.data, actor.id);
      fresh = true;
      return n;
    });
    if (result === null) return { error: TICKET_STALE };
    number = result;
    return { success: "ok" };
  });
  if (free || state.fieldErrors) await forgetAttempt(limit.attemptId);
  if (!state.success) return state;
  if (fresh) {
    await ticketChanged({
      ticket: {
        id: id.data,
        number,
        title: d.title,
        createdBy: actor.id,
        assigneeId: d.assigneeId,
        dueOn: d.dueOn,
      },
      actor,
      created: true,
      urgent: d.urgency === "urgent",
      assignedTo: d.assigneeId,
    });
  }
  revalidateBoard();
  await setFlash("is-acildi", number);
  redirect(`/yonetim/${number}`);
}

/** Düzenle: title, description, assignee, urgency and due date; the status moves through moveTicket. */
export async function updateTicket(
  rawNumber: number,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const num = ticketNumber.safeParse(rawNumber);
  if (!num.success) return { error: TICKET_NOT_FOUND };
  // Every editable field must be posted: an omitted key would otherwise clear it.
  if (!EDIT_FIELDS.every((k) => formData.has(k))) return { error: CHECK_FAILED };
  const parsed = updateTicketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const missingRevision = parsed.error.issues.some((i) => i.path[0] === "revision");
    return missingRevision ? { error: TICKET_STALE } : fieldErrorsOf(parsed.error, formData);
  }
  const d = parsed.data;

  let push: TicketEvent | null = null;
  const state = await guarded(formData, async () => {
    const error = await writeTx(async (tx): Promise<string | null> => {
      const [cur] = await tx.select().from(t).where(eq(t.number, num.data));
      if (!cur) return TICKET_NOT_FOUND;
      if (cur.revision !== d.revision) return TICKET_STALE;
      // An unchanged assignee stays even if they left the board (AC 11, "kurulda değil").
      if (d.assigneeId !== cur.assigneeId) await checkAssignee(tx, d.assigneeId);
      const changed =
        d.title !== cur.title ||
        d.description !== cur.description ||
        d.assigneeId !== cur.assigneeId ||
        d.urgency !== cur.urgency ||
        d.dueOn !== cur.dueOn;
      if (!changed) return null;
      const hit = await tx
        .update(t)
        .set({
          title: d.title,
          description: d.description,
          assigneeId: d.assigneeId,
          urgency: d.urgency,
          dueOn: d.dueOn,
          revision: sql`${t.revision} + 1`,
          updatedAt: nowSql,
          updatedBy: actor.id,
        })
        .where(and(eq(t.id, cur.id), eq(t.revision, d.revision)))
        .returning({ id: t.id });
      if (!hit.length) return TICKET_STALE;
      const entries: (typeof ev.$inferInsert)[] = [];
      if (d.assigneeId !== cur.assigneeId) {
        entries.push({
          ticketId: cur.id,
          kind: "assignee",
          actorId: actor.id,
          fromUserId: cur.assigneeId,
          toUserId: d.assigneeId,
        });
      }
      if (d.urgency !== cur.urgency) {
        entries.push({
          ticketId: cur.id,
          kind: "urgency",
          actorId: actor.id,
          fromValue: cur.urgency,
          toValue: d.urgency,
        });
      }
      if (d.dueOn !== cur.dueOn) {
        entries.push({
          ticketId: cur.id,
          kind: "due",
          actorId: actor.id,
          fromValue: cur.dueOn,
          toValue: d.dueOn,
        });
      }
      if (entries.length) await tx.insert(ev).values(entries);
      await markSeen(tx, cur.id, actor.id);
      push = {
        ticket: { ...cur, title: d.title, assigneeId: d.assigneeId, dueOn: d.dueOn },
        actor,
        urgent: d.urgency === "urgent" && cur.urgency !== "urgent",
        assignedTo: d.assigneeId !== cur.assigneeId ? d.assigneeId : null,
      };
      return null;
    });
    return error ? { error, values: formValues(formData) } : { success: "ok" };
  });
  if (!state.success) return state;
  if (push) await ticketChanged(push);
  revalidateBoard();
  await setFlash("kaydedildi");
  redirect(`/yonetim/${num.data}`);
}

/** Taşı and the detail page's Durum menu. `from` is the status the user saw (D11). */
export async function moveTicket(input: {
  number: number;
  from: string;
  to: string;
}): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: TICKET_STALE };
  const { number, from, to } = parsed.data;
  let moved: TicketEvent["ticket"] | null = null;
  const error = await writeTx(async (tx): Promise<string | null> => {
    const hit = await tx
      .update(t)
      .set({
        status: to,
        doneAt: to === "done" ? nowSql : null,
        revision: sql`${t.revision} + 1`,
        updatedAt: nowSql,
        updatedBy: actor.id,
      })
      .where(and(eq(t.number, number), eq(t.status, from)))
      .returning({
        id: t.id,
        number: t.number,
        title: t.title,
        createdBy: t.createdBy,
        assigneeId: t.assigneeId,
        dueOn: t.dueOn,
      });
    if (!hit.length) {
      const [exists] = await tx.select({ id: t.id }).from(t).where(eq(t.number, number));
      return exists ? TICKET_STALE : TICKET_NOT_FOUND;
    }
    await tx.insert(ev).values({
      ticketId: hit[0].id,
      kind: "status",
      actorId: actor.id,
      fromValue: from,
      toValue: to,
    });
    await markSeen(tx, hit[0].id, actor.id);
    moved = hit[0];
    return null;
  });
  if (error) return { error };
  if (moved) await ticketChanged({ ticket: moved, actor, movedTo: to });
  revalidateBoard();
  return { success: movedMessage(number, to) };
}

export async function deleteTicket(rawNumber: number): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const num = ticketNumber.safeParse(rawNumber);
  if (!num.success) return { error: TICKET_NOT_FOUND };
  // The rule lives in the statement, so a check-then-delete race can't slip through.
  const deleted = await db
    .delete(t)
    .where(
      and(
        eq(t.number, num.data),
        actor.role === "conductor" ? undefined : eq(t.createdBy, actor.id),
      ),
    )
    .returning({ number: t.number });
  if (!deleted.length) {
    const [exists] = await db.select({ id: t.id }).from(t).where(eq(t.number, num.data));
    return { error: exists ? DELETE_TICKET_DENIED : TICKET_NOT_FOUND };
  }
  revalidateBoard();
  await setFlash("is-silindi", num.data);
  redirect("/yonetim");
}

/** The form's per-mount clientKey makes a replayed submit a no-op; remount the form after success. */
export async function addComment(
  rawNumber: number,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const num = ticketNumber.safeParse(rawNumber);
  if (!num.success) return { error: TICKET_NOT_FOUND };
  const key = z.uuid().safeParse(formData.get("clientKey"));
  if (!key.success) return { error: TICKET_STALE };
  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const limit = await consumeAttempt(
    `board-comment:${actor.id}`,
    COMMENT_LIMIT.max,
    COMMENT_LIMIT.windowMs,
  );
  if (limit.blocked) return { error: RATE_LIMITED, values: formValues(formData) };

  // A comment on a just-deleted ticket or a double submit isn't a new attempt.
  let free = false;
  let commented: TicketEvent["ticket"] | null = null;
  const state = await guarded(formData, async () => {
    const error = await writeTx(async (tx): Promise<string | null> => {
      const [ticket] = await tx
        .select({
          id: t.id,
          number: t.number,
          title: t.title,
          createdBy: t.createdBy,
          assigneeId: t.assigneeId,
          dueOn: t.dueOn,
        })
        .from(t)
        .where(eq(t.number, num.data));
      if (!ticket) {
        free = true;
        return TICKET_NOT_FOUND;
      }
      const rows = await tx
        .insert(ev)
        .values({
          ticketId: ticket.id,
          kind: "comment",
          actorId: actor.id,
          body: parsed.data.body,
          clientKey: key.data,
        })
        .onConflictDoNothing()
        .returning({ id: ev.id });
      if (!rows.length) {
        const [replay] = await tx
          .select({ actorId: ev.actorId, ticketId: ev.ticketId })
          .from(ev)
          .where(eq(ev.clientKey, key.data));
        if (replay?.actorId !== actor.id || replay.ticketId !== ticket.id) return TICKET_STALE;
        free = true;
      } else {
        commented = ticket;
      }
      await markSeen(tx, ticket.id, actor.id);
      return null;
    });
    return error ? { error, values: formValues(formData) } : { success: "Yorum eklendi." };
  });
  if (free || state.fieldErrors) await forgetAttempt(limit.attemptId);
  if (state.success && commented) await ticketChanged({ ticket: commented, actor, comment: true });
  if (state.success) revalidateBoard();
  return state;
}

/** Own comment, within 15 minutes, on the DB clock; never a system entry (D6, AC 17, AC 20). */
export async function deleteComment(rawId: number): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.coerce.number().int().min(1).safeParse(rawId);
  if (!id.success) return { error: NOT_FOUND };
  const deleted = await db
    .delete(ev)
    .where(
      and(
        eq(ev.id, id.data),
        eq(ev.kind, "comment"),
        eq(ev.actorId, actor.id),
        sql`${ev.createdAt} > unixepoch() - ${COMMENT_DELETE_WINDOW_S}`,
      ),
    )
    .returning({ id: ev.id });
  if (!deleted.length) {
    const [row] = await db
      .select({ kind: ev.kind, actorId: ev.actorId })
      .from(ev)
      .where(eq(ev.id, id.data));
    if (!row || row.kind !== "comment") return { error: NOT_FOUND };
    return { error: row.actorId === actor.id ? COMMENT_TOO_OLD : COMMENT_NOT_OWN };
  }
  // No activity bump: a deleted comment never lights up "Yeni".
  revalidateBoard();
  return { success: "Yorum silindi." };
}

/**
 * Called once from the mounted detail page (never during render, so a prefetch can't clear "Yeni").
 * The marker is capped at what exists, so a forged value can't pre-mark future activity as seen.
 */
export async function markTicketSeen(
  rawNumber: number,
  rawEventId: number,
  rawRevision: number,
): Promise<{ changed: boolean }> {
  const actor = await assertManager();
  if (!actor) return { changed: false };
  const input = z
    .object({
      number: ticketNumber,
      eventId: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      revision: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .safeParse({ number: rawNumber, eventId: rawEventId, revision: rawRevision });
  if (!input.success) return { changed: false };
  const { number, eventId, revision } = input.data;
  // Most views change nothing: check outside a write transaction first (one read, no lock).
  const [marker] = await db.all<{ covered: number }>(sql`
    select (r.seen_event_id >= min(${eventId}, coalesce((select max(e.id) from ${ev} e where e.ticket_id = tk.id), 0))
            and r.seen_revision >= min(${revision}, tk.revision)) as covered
      from ${t} tk
      join ${boardTicketReads} r on r.ticket_id = tk.id and r.user_id = ${actor.id}
     where tk.number = ${number}`);
  if (marker && Number(marker.covered)) return { changed: false };
  const changed = await writeTx(async (tx) => {
    const [before] = await tx.all<{ fresh: number }>(sql`
      select (tk.assignee_id = ${actor.id} and tk.status <> 'done' and (
               exists (select 1 from ${ev} e where e.ticket_id = tk.id
                       and e.id > coalesce(r.seen_event_id, 0) and e.actor_id <> ${actor.id})
               or (tk.updated_by is not null and tk.updated_by <> ${actor.id}
                   and tk.revision > coalesce(r.seen_revision, -1)))) as fresh
        from ${t} tk
        left join ${boardTicketReads} r on r.ticket_id = tk.id and r.user_id = ${actor.id}
       where tk.number = ${number}`);
    if (!before) return false;
    await tx.run(sql`
      insert into ${boardTicketReads} (user_id, ticket_id, seen_event_id, seen_revision, seen_at)
      select ${actor.id}, tk.id,
             min(${eventId}, coalesce((select max(e.id) from ${ev} e where e.ticket_id = tk.id), 0)),
             min(${revision}, tk.revision), unixepoch()
        from ${t} tk where tk.number = ${number}
      on conflict (user_id, ticket_id) do update set
        seen_event_id = max(seen_event_id, excluded.seen_event_id),
        seen_revision = max(seen_revision, excluded.seen_revision),
        seen_at = excluded.seen_at
      where excluded.seen_event_id > seen_event_id or excluded.seen_revision > seen_revision`);
    return Boolean(Number(before.fresh));
  });
  if (changed) revalidateBoard();
  return { changed };
}
