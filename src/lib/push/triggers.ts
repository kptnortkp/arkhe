import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assignmentParts,
  assignments,
  attendance,
  pieces,
  users,
  type RehearsalType,
  type TicketStatus,
  type VoicePart,
} from "@/db/schema";
import { openUntil, rehearsalTitle } from "@/lib/attendance/rehearsals";
import { isExpected, loadRosterUsers, type RosterUser } from "@/lib/attendance/roster";
import { isEligible } from "@/lib/homework/eligibility";
import { TICKET_STATUS_LABELS } from "@/lib/board/labels";
import { pushContext, type PushContext } from "./context";
import { DAY_MS, gun, haftaninGunu, kisaGun, saat, ticketTitle, yerDot, type Item } from "./copy";
import { notify } from "./dispatch";

type R = {
  id: string;
  type: RehearsalType;
  title: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  parts: VoicePart[];
  seriesId?: string | null;
};

/** Every trigger runs behind this: a notification problem is logged, never thrown (D68). */
async function guard(name: string, fn: (ctx: PushContext) => Promise<Item[]>) {
  try {
    const ctx = await pushContext();
    await notify(await fn(ctx), ctx);
  } catch (e) {
    console.error("push trigger failed", { trigger: name, name: (e as Error)?.name });
  }
}

const activeRoster = async () => (await loadRosterUsers()).filter((u) => u.leftAt === null);
const expectedAt = (people: RosterUser[], r: R) => people.filter((u) => isExpected(u, r));
const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------- rehearsals and attendance

/** 1: only the call that actually opened attendance. */
export function attendanceOpened(r: R, actorId: string) {
  return guard("attendance_open", async () => {
    const marked = await db
      .select({ userId: attendance.userId })
      .from(attendance)
      .where(eq(attendance.rehearsalId, r.id));
    const skip = new Set([actorId, ...marked.map((m) => m.userId)]);
    const name = rehearsalTitle(r);
    return expectedAt(await activeRoster(), r)
      .filter((u) => !skip.has(u.id))
      .map((u) => ({
        userId: u.id,
        kind: "attendance_open",
        group: "calisma",
        dedupeKey: `yoklama-${r.id}`,
        title: "Yoklama açıldı",
        body: `${name} · ${saat(r.startsAt)}${yerDot(r.location)}. Yoklamaya katılmak için dokun.`,
        line: `Yoklama açık: ${name}`,
        url: "/yoklama",
        tag: `yoklama-${r.id}`,
        expiresAt: openUntil(r),
      }));
  });
}

/** 4a: one notification per person, even for a weekly series. */
export function rehearsalsCreated(rows: R[], actorId: string) {
  return guard("rehearsal_new", async (ctx) => {
    const first = rows[0];
    if (!first || first.startsAt <= ctx.now) return [];
    const last = rows[rows.length - 1];
    const name = rehearsalTitle(first);
    const series = rows.length > 1;
    const key = series ? (first.seriesId ?? first.id) : first.id;
    return expectedAt(await activeRoster(), first)
      .filter((u) => u.id !== actorId)
      .map((u) => ({
        userId: u.id,
        kind: "rehearsal_new",
        group: "calisma",
        dedupeKey: `yeni-${key}`,
        title: "Yeni çalışma",
        body: series
          ? `${name} · her ${haftaninGunu(first.startsAt)} ${saat(first.startsAt)}, ${kisaGun(first.startsAt)}–${kisaGun(last.startsAt)}`
          : `${name} · ${gun(first.startsAt)} ${saat(first.startsAt)}${yerDot(first.location)}`,
        line: `Yeni çalışma: ${name}, ${gun(first.startsAt)} ${saat(first.startsAt)}`,
        url: series ? "/calismalar" : `/calismalar/${first.id}`,
        tag: `calisma-${key}`,
        expiresAt: first.startsAt,
      }));
  });
}

/** 4b: start, end or place changed on a future rehearsal; the union of before and after. */
export function rehearsalChanged(before: R, after: R, actorId: string) {
  return guard("rehearsal_changed", async (ctx) => {
    const moved =
      +before.startsAt !== +after.startsAt ||
      +before.endsAt !== +after.endsAt ||
      (before.location ?? "") !== (after.location ?? "");
    if (!moved || after.startsAt <= ctx.now) return [];
    const people = await activeRoster();
    const ids = new Set([...expectedAt(people, before), ...expectedAt(people, after)].map((u) => u.id));
    ids.delete(actorId);
    const name = rehearsalTitle(after);
    const event = uuid();
    return [...ids].map((userId) => ({
      userId,
      kind: "rehearsal_changed",
      group: "calisma",
      dedupeKey: `degisti-${after.id}-${event}`,
      title: "Çalışma değişti",
      body: `${name}: artık ${gun(after.startsAt)} ${saat(after.startsAt)}${yerDot(after.location)}`,
      line: `Değişti: ${name}, artık ${gun(after.startsAt)} ${saat(after.startsAt)}`,
      url: `/calismalar/${after.id}`,
      tag: `calisma-${after.id}`,
      expiresAt: after.startsAt,
    }));
  });
}

/** 5a / 5b: cancel and undo, future rehearsals only. */
export function rehearsalCancelled(r: R, cancelled: boolean, actorId: string) {
  return guard("rehearsal_cancelled", async (ctx) => {
    if (r.startsAt <= ctx.now) return [];
    const name = rehearsalTitle(r);
    const when = `${gun(r.startsAt)} ${saat(r.startsAt)}`;
    const event = uuid();
    return expectedAt(await activeRoster(), r)
      .filter((u) => u.id !== actorId)
      .map((u) => ({
        userId: u.id,
        kind: cancelled ? "rehearsal_cancelled" : "rehearsal_restored",
        group: "calisma",
        dedupeKey: `iptal-${r.id}-${event}`,
        title: cancelled ? "Çalışma iptal" : "Çalışma yeniden programda",
        body: cancelled
          ? `${when} ${name} yapılmayacak.`
          : `İptal geri alındı: ${when} ${name} yapılacak.`,
        line: cancelled ? `İptal: ${when} ${name}` : `İptal geri alındı: ${when} ${name}`,
        url: `/calismalar/${r.id}`,
        tag: `calisma-${r.id}`,
        expiresAt: r.startsAt,
      }));
  });
}

/** 5c: `Seriyi bitir` deleted these future occurrences; `from` is the rehearsal it was called on. */
export function seriesEnded(from: R, deleted: R[], actorId: string) {
  return guard("series_ended", async (ctx) => {
    const future = deleted.filter((r) => r.startsAt > ctx.now);
    if (future.length === 0) return [];
    const people = await activeRoster();
    const ids = new Set(future.flatMap((r) => expectedAt(people, r).map((u) => u.id)));
    ids.delete(actorId);
    const name = rehearsalTitle(from);
    const n = future.length;
    const key = from.seriesId ?? from.id;
    const expiresAt = new Date(Math.max(...future.map((r) => +r.startsAt)));
    return [...ids].map((userId) => ({
      userId,
      kind: "series_ended",
      group: "calisma",
      dedupeKey: `seri-${key}-${uuid()}`,
      title: "Haftalık çalışmalar bitti",
      body: `${name}: ${gun(from.startsAt)} sonrasındaki ${n} çalışma yapılmayacak.`,
      line: `Seri bitti: ${name} (${n} çalışma)`,
      url: "/calismalar",
      tag: `seri-${key}`,
      expiresAt: new Date(Math.min(+expiresAt, ctx.now.getTime() + 7 * DAY_MS)),
    }));
  });
}

/** 6: people the close recorded as absent automatically. */
export function markedAbsent(r: R, userIds: string[]) {
  return guard("absent", async (ctx) => {
    const name = rehearsalTitle(r);
    return userIds.map((userId) => ({
      userId,
      kind: "absent",
      group: "devamsizlik",
      dedupeKey: `devamsiz-${r.id}`,
      title: "Gelmedi olarak kaydedildin",
      body: `${name}, ${gun(r.startsAt)}. Mazeretin varsa yoklamayı alana ilet.`,
      line: `Gelmedi: ${name}, ${gun(r.startsAt)}`,
      url: `/calismalar/${r.id}`,
      tag: `devamsiz-${r.id}`,
      expiresAt: new Date(ctx.now.getTime() + 2 * DAY_MS),
    }));
  });
}

// ---------------------------------------------------------------- homework

async function homeworkHead(assignmentId: string) {
  const [a] = await db
    .select({
      id: assignments.id,
      dueAt: assignments.dueAt,
      barFrom: assignments.barFrom,
      barTo: assignments.barTo,
      piece: pieces.title,
    })
    .from(assignments)
    .innerJoin(pieces, eq(pieces.id, assignments.pieceId))
    .where(eq(assignments.id, assignmentId));
  return a ?? null;
}

/** 7: eligible singers of the target parts, minus the creator. */
export function homeworkCreated(assignmentId: string, actorId: string) {
  return guard("homework_new", async (ctx) => {
    const a = await homeworkHead(assignmentId);
    if (!a || a.dueAt <= ctx.now) return [];
    const parts = (
      await db
        .select({ p: assignmentParts.voicePart })
        .from(assignmentParts)
        .where(eq(assignmentParts.assignmentId, assignmentId))
    ).map((r) => r.p);
    const singers = await db
      .select({
        id: users.id,
        role: users.role,
        voicePart: users.voicePart,
        joinedAt: users.joinedAt,
        leftAt: users.leftAt,
      })
      .from(users)
      .where(and(isNull(users.leftAt), inArray(users.role, ["member", "board"])));
    const bars = a.barFrom !== null ? ` · ölçü ${a.barFrom}–${a.barTo}` : "";
    return singers
      .filter((u) => u.id !== actorId && isEligible(u, parts))
      .map((u) => ({
        userId: u.id,
        kind: "homework_new",
        group: "odev",
        dedupeKey: `odev-${a.id}`,
        title: "Yeni ödev",
        body: `${a.piece}${bars} · son gün ${gun(a.dueAt)} ${saat(a.dueAt)}`,
        line: `Yeni ödev: ${a.piece}, son gün ${gun(a.dueAt)}`,
        url: `/odevler/${a.id}`,
        tag: `odev-${a.id}`,
        expiresAt: a.dueAt,
      }));
  });
}

/** 9: the conductor's first comment; never the text (D76, D82). */
export function feedbackSent(assignmentId: string, singerId: string) {
  return guard("feedback", async (ctx) => {
    const a = await homeworkHead(assignmentId);
    if (!a) return [];
    return [
      {
        userId: singerId,
        kind: "feedback",
        group: "odev",
        dedupeKey: `yorum-${a.id}-${uuid()}`,
        title: "Şeften yorum var",
        body: `${a.piece} ödevin için. Okumak için dokun.`,
        line: `Şeften yorum: ${a.piece}`,
        url: `/odevler/${a.id}`,
        tag: `yorum-${a.id}`,
        expiresAt: new Date(ctx.now.getTime() + 7 * DAY_MS),
      },
    ];
  });
}

// ---------------------------------------------------------------- board and budget

async function managerIds() {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNull(users.leftAt), inArray(users.role, ["conductor", "board"])));
  return rows.map((r) => r.id);
}

export type TicketEvent = {
  ticket: { id: string; number: number; title: string; createdBy: string; assigneeId: string | null; dueOn: string | null };
  actor: { id: string; name: string };
  created?: boolean;
  urgent?: boolean;
  assignedTo?: string | null;
  movedTo?: TicketStatus;
  comment?: boolean;
};

/** 13–16, 18 with one notification per person per action: 18 > 14 > 16 > 15 > 13 (D78). */
export function ticketChanged(e: TicketEvent) {
  return guard("ticket", async (ctx) => {
    const { ticket: t, actor } = e;
    const title = ticketTitle(t.title);
    const no = t.number;
    const base = { group: "yonetim" as const, url: `/yonetim/${no}`, tag: `is-${no}` };
    const best = new Map<string, Item>();
    const event = uuid();
    const offer = (userId: string | null, item: Omit<Item, "userId">) => {
      if (!userId || userId === actor.id || best.has(userId)) return;
      best.set(userId, { ...item, userId });
    };
    const managers = await managerIds();
    const days = (n: number) => new Date(ctx.now.getTime() + n * DAY_MS);
    if (e.urgent) {
      for (const id of managers)
        offer(id, {
          ...base,
          kind: "ticket_urgent",
          dedupeKey: `acil-${no}-${event}`,
          title: `Acil iş #${no}`,
          body: `${title} · ${actor.name}`,
          line: null,
          urgent: true,
          expiresAt: days(1),
        });
    }
    if (e.assignedTo) {
      offer(e.assignedTo, {
        ...base,
        kind: "ticket_assigned",
        dedupeKey: `atandi-${no}-${event}`,
        title: `Sana iş atandı #${no}`,
        body: `${title}${t.dueOn ? ` · son gün ${gun(new Date(`${t.dueOn}T12:00:00Z`))}` : ""}`,
        line: `Sana atandı #${no}: ${title}`,
        expiresAt: days(3),
      });
    }
    if (e.movedTo === "blocked" || e.movedTo === "done") {
      const label = TICKET_STATUS_LABELS[e.movedTo];
      offer(t.createdBy, {
        ...base,
        kind: "ticket_moved",
        dedupeKey: `tasindi-${no}-${event}`,
        title: `#${no} ${label}`,
        body: `${title} · ${actor.name} taşıdı.`,
        line: `#${no} ${label}: ${title}`,
        expiresAt: days(3),
      });
    }
    if (e.comment) {
      for (const id of [t.createdBy, t.assigneeId])
        offer(id, {
          ...base,
          kind: "ticket_comment",
          dedupeKey: `yorum-is-${no}-${event}`,
          title: `#${no} işine yorum`,
          body: `${actor.name} yorum yazdı: ${title}`,
          line: `Yorum #${no}: ${title}`,
          expiresAt: days(3),
        });
    }
    if (e.created && !e.urgent) {
      for (const id of managers)
        offer(id, {
          ...base,
          kind: "ticket_new",
          dedupeKey: `yeni-is-${no}`,
          title: `Yeni iş #${no}`,
          body: `${title} · ${actor.name}`,
          line: `Yeni iş #${no}: ${title}`,
          expiresAt: days(3),
        });
    }
    // Comment and move recipients must still be managers; the switch check covers it.
    return [...best.values()];
  });
}

/** 20a–c: no amounts and no reason (D79, D82). */
export function budgetEvent(
  kind: "budget_new" | "budget_approved" | "budget_revised",
  budget: { id: string; name: string },
  actor: { id: string; name: string },
) {
  return guard(kind, async (ctx) => {
    const copy = {
      budget_new: { title: "Yeni bütçe taslağı", body: `${budget.name} · ${actor.name} oluşturdu. Onay bekliyor.`, line: `Bütçe taslağı: ${budget.name}` },
      budget_approved: { title: "Bütçe onaylandı", body: `${budget.name} · ${actor.name} onayladı.`, line: `Bütçe onaylandı: ${budget.name}` },
      budget_revised: { title: "Bütçe değişti", body: `${budget.name} · ${actor.name} planı değiştirdi.`, line: `Bütçe değişti: ${budget.name}` },
    }[kind];
    const event = uuid();
    return (await managerIds())
      .filter((id) => id !== actor.id)
      .map((userId) => ({
        userId,
        kind,
        group: "butce",
        dedupeKey: `${kind}-${budget.id}-${event}`,
        ...copy,
        url: `/finans/butce/${budget.id}`,
        tag: `butce-${budget.id}`,
        expiresAt: new Date(ctx.now.getTime() + 3 * DAY_MS),
      }));
  });
}
