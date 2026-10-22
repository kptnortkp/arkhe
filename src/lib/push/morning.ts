import "server-only";
import { and, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rehearsals, users } from "@/db/schema";
import { rehearsalTitle } from "@/lib/attendance/rehearsals";
import { isExpected, loadRosterUsers, partsByRehearsal } from "@/lib/attendance/roster";
import { loadDuesMatrix } from "@/lib/finance/queries-internal";
import { isEligible } from "@/lib/homework/eligibility";
import { assistantQueueCount, conductorCounts } from "@/lib/review/queries";
import { loadScope } from "@/lib/review/scope";
import { addDays, istanbulDayRange, istanbulToUtc } from "@/lib/time";
import type { PushContext } from "./context";
import { cut, gun, saat, type Item } from "./copy";
import { duesPushEnabled, getState, REPERTOIRE_SINCE, setState } from "./state";

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

async function rehearsalLines(day: string, now: Date): Promise<Item[]> {
  const [from] = istanbulDayRange(day);
  const [, to] = istanbulDayRange(addDays(day, 1));
  const list = await db
    .select({
      id: rehearsals.id,
      type: rehearsals.type,
      title: rehearsals.title,
      location: rehearsals.location,
      startsAt: rehearsals.startsAt,
      endsAt: rehearsals.endsAt,
    })
    .from(rehearsals)
    .where(and(gte(rehearsals.startsAt, from), lt(rehearsals.startsAt, to), isNull(rehearsals.cancelledAt)));
  if (list.length === 0) return [];
  const [people, parts] = await Promise.all([loadRosterUsers(), partsByRehearsal(list.map((r) => r.id))]);
  const active = people.filter((p) => p.leftAt === null);
  const [, todayEnd] = istanbulDayRange(day);
  const items: Item[] = [];
  for (const r of list) {
    if (r.startsAt <= now) continue;
    const full = { ...r, parts: parts.get(r.id) ?? [] };
    const isToday = r.startsAt < todayEnd;
    if (!isToday && r.type !== "concert") continue;
    const name = rehearsalTitle(full);
    const yer = r.location;
    const recipients = active.filter(
      (u) => u.role === "conductor" || isExpected(u, full),
    );
    const base = { group: "calisma" as const, url: `/calismalar/${r.id}`, expiresAt: r.startsAt, morning: true };
    let make: Omit<Item, "userId">;
    if (r.type === "concert") {
      make = isToday
        ? {
            ...base,
            kind: "concert_today",
            dedupeKey: `konser-bugun-${r.id}`,
            title: "Bugün konser",
            body: `${name} · ${saat(r.startsAt)}${yer ? ` · ${yer}` : ""}`,
            line: `Bugün konser: ${name}, ${saat(r.startsAt)}${yer ? `, ${yer}` : ""}`,
            tag: `konser-${r.id}`,
          }
        : {
            ...base,
            kind: "concert_tomorrow",
            dedupeKey: `konser-yarin-${r.id}`,
            title: "Yarın konser",
            body: `${name} · ${gun(r.startsAt)} ${saat(r.startsAt)}${yer ? ` · ${yer}` : ""}`,
            line: `Yarın konser: ${name}, ${saat(r.startsAt)}${yer ? `, ${yer}` : ""}`,
            tag: `konser-${r.id}`,
          };
    } else {
      make = {
        ...base,
        kind: "rehearsal_today",
        dedupeKey: `bugun-${r.id}`,
        title: "Bugün çalışma var",
        body: `${name} · ${saat(r.startsAt)}–${saat(r.endsAt)}${yer ? ` · ${yer}` : ""}`,
        line: `Bugün ${saat(r.startsAt)}: ${name}${yer ? ` (${yer})` : ""}`,
        tag: `bugun-${r.id}`,
      };
    }
    for (const u of recipients) items.push({ ...make, userId: u.id });
  }
  return items;
}

async function homeworkLines(day: string, now: Date): Promise<Item[]> {
  const [todayFrom, todayTo] = istanbulDayRange(day);
  const [due2From, due2To] = istanbulDayRange(addDays(day, 2));
  const list = await db.all<{ id: string; due: number; piece: string; parts: string }>(sql`
    select a.id as id, a.due_at as due, p.title as piece,
      (select group_concat(ap.voice_part) from assignment_parts ap where ap.assignment_id = a.id) as parts
    from assignments a join pieces p on p.id = a.piece_id
    where (a.due_at >= ${secs(todayFrom)} and a.due_at < ${secs(todayTo)})
       or (a.due_at >= ${secs(due2From)} and a.due_at < ${secs(due2To)})`);
  if (list.length === 0) return [];
  const singers = await db
    .select({
      id: users.id,
      role: users.role,
      voicePart: users.voicePart,
      joinedAt: users.joinedAt,
      leftAt: users.leftAt,
    })
    .from(users)
    .where(isNull(users.leftAt));
  const submitted = await db.all<{ a: string; u: string }>(sql`
    select assignment_id as a, user_id as u from submissions
    where submitted_at is not null and assignment_id in (${sql.join(
      list.map((a) => sql`${a.id}`),
      sql`, `,
    )})`);
  const done = new Set(submitted.map((s) => `${s.a}:${s.u}`));
  const items: Item[] = [];
  for (const a of list) {
    const dueAt = new Date(Number(a.due) * 1000);
    if (dueAt <= now) continue;
    const today = dueAt < todayTo;
    const parts = (a.parts ?? "").split(",").filter(Boolean) as never[];
    for (const u of singers) {
      if (!isEligible(u, parts) || done.has(`${a.id}:${u.id}`)) continue;
      items.push({
        userId: u.id,
        kind: today ? "homework_due0" : "homework_due2",
        group: "odev",
        dedupeKey: `odev-son-${today ? 0 : 2}-${a.id}`,
        title: today ? "Ödevin bugün bitiyor" : "Ödevin 2 gün sonra bitiyor",
        body: today
          ? `${a.piece} · son saat ${saat(dueAt)}. Kaydını yap.`
          : `${a.piece} · son gün ${gun(dueAt)} ${saat(dueAt)}. Kaydını yap.`,
        line: today ? `Bugün son gün: ${a.piece} (${saat(dueAt)})` : `2 gün kaldı: ${a.piece}`,
        url: `/odevler/${a.id}#kayit`,
        tag: `odev-son-${a.id}`,
        expiresAt: dueAt,
        morning: true,
      });
    }
  }
  return items;
}

async function reviewLines(day: string, endOfDay: Date): Promise<Item[]> {
  const people = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(isNull(users.leftAt), inArray(users.role, ["conductor", "member", "board"])));
  const items: Item[] = [];
  const base = { group: "dinleme" as const, url: "/odevler/dinle", tag: "dinleme", expiresAt: endOfDay, morning: true };
  for (const p of people) {
    if (p.role === "conductor") {
      const c = await conductorCounts();
      if (c.waiting === 0) continue;
      items.push({
        ...base,
        userId: p.id,
        kind: "conductor_queue",
        dedupeKey: `sef-kuyruk-${day}`,
        title: "Yorum bekleyen kayıtlar",
        body: `${c.waiting} kayıt yorum bekliyor${c.noted ? `; ${c.noted} tanesinde asistan notu var` : ""}.`,
        line: `Yorum bekleyen: ${c.waiting} kayıt${c.noted ? ` (${c.noted} asistan notlu)` : ""}`,
      });
      continue;
    }
    const scope = await loadScope(p.id);
    if (scope.length === 0) continue;
    const n = await assistantQueueCount(p, scope);
    if (n === 0) continue;
    items.push({
      ...base,
      userId: p.id,
      kind: "assistant_queue",
      dedupeKey: `dinleme-${day}`,
      title: "Dinleme kuyruğun",
      body: `${n} kayıt dinlenmeyi bekliyor.`,
      line: `Dinleme kuyruğun: ${n} kayıt`,
    });
  }
  return items;
}

async function repertoireLines(
  day: string,
  now: Date,
  endOfDay: Date,
  commits: Commit[],
): Promise<Item[]> {
  const prev = await getState(REPERTOIRE_SINCE);
  const since = prev ? new Date(prev) : new Date(now.getTime() - 24 * 3600_000);
  commits.push(() => setState(REPERTOIRE_SINCE, now.toISOString()));
  const rows = await db.all<{ id: string; title: string; created: number; files: number }>(sql`
    select p.id as id, p.title as title,
      (p.created_at > ${secs(since)} and p.created_at <= ${secs(now)}) as created,
      (select count(*) from piece_links l where l.piece_id = p.id
         and l.created_at > ${secs(since)} and l.created_at <= ${secs(now)})
      + (select count(*) from midi_files m where m.piece_id = p.id
         and m.created_at > ${secs(since)} and m.created_at <= ${secs(now)}) as files
    from pieces p`);
  const changed = rows.filter((r) => Number(r.created) || Number(r.files));
  if (changed.length === 0) return [];
  const one = changed.length === 1 ? changed[0] : null;
  const body = one
    ? `${one.title}: ${Number(one.created) ? "yeni eser" : `${one.files} yeni dosya`}`
    : `${changed.length} eserde yenilik: ${changed
        .slice(0, 3)
        .map((r) => r.title)
        .join(", ")}${changed.length > 3 ? "…" : ""}`;
  const people = await db.select({ id: users.id }).from(users).where(isNull(users.leftAt));
  return people.map((p) => ({
    userId: p.id,
    kind: "repertoire" as const,
    group: "repertuvar" as const,
    dedupeKey: `repertuvar-${day}`,
    title: "Repertuvarda yenilik",
    body: cut(body, 140),
    line: `Repertuvar: ${changed.length} eserde yenilik`,
    url: one ? `/repertuvar/${one.id}` : "/repertuvar",
    tag: "repertuvar",
    expiresAt: endOfDay,
    morning: true,
  }));
}

async function ticketLines(day: string, endOfDay: Date): Promise<Item[]> {
  const tomorrow = addDays(day, 1);
  const rows = await db.all<{ u: string; today: number; tomorrow: number; late: number }>(sql`
    select assignee_id as u,
      sum(due_on = ${day}) as today, sum(due_on = ${tomorrow}) as tomorrow, sum(due_on < ${day}) as late
    from board_tickets
    where assignee_id is not null and status <> 'done' and due_on is not null and due_on <= ${tomorrow}
    group by assignee_id`);
  return rows.flatMap((r) => {
    const parts = [
      Number(r.today) ? `${r.today} iş bugün` : "",
      Number(r.tomorrow) ? `${r.tomorrow} iş yarın` : "",
      Number(r.late) ? `${r.late} iş gecikti` : "",
    ].filter(Boolean);
    if (parts.length === 0) return [];
    const text = parts.join(", ");
    return [
      {
        userId: r.u,
        kind: "tickets_due" as const,
        group: "yonetim" as const,
        dedupeKey: `islerim-${day}`,
        title: "İşlerin",
        body: text,
        line: `İşlerin: ${text}`,
        url: "/yonetim?kim=ben",
        tag: "islerim",
        expiresAt: endOfDay,
        morning: true,
      },
    ];
  });
}

async function duesLines(day: string, now: Date): Promise<Item[]> {
  if (!(await duesPushEnabled())) return [];
  const { periods, members } = await loadDuesMatrix(day);
  const expiresAt = new Date(now.getTime() + 3 * 24 * 3600_000);
  const recent = await db.all<{ u: string }>(sql`
    select distinct user_id as u from notifications
    where kind = 'dues_late' and created_at > ${secs(now) - 30 * 24 * 3600}`);
  const remindedRecently = new Set(recent.map((r) => r.u));
  const opening = periods.filter((p) => p.startsOn === day);
  const items: Item[] = [];
  for (const m of members) {
    if (m.left) continue;
    for (const p of opening) {
      const cell = m.cells.get(p.id);
      if (!cell || cell.status.state === "exempt") continue;
      items.push({
        userId: m.id,
        kind: "dues_open",
        group: "aidat",
        dedupeKey: `aidat-donem-${p.id}`,
        title: "Aidat dönemi başladı",
        body: `${p.name}. Ödeme bilgisi Profilim'de.`,
        line: `Aidat dönemi başladı: ${p.name}`,
        url: "/profil#aidat",
        tag: "aidat",
        expiresAt,
        morning: true,
      });
    }
    const late = [...m.cells.values()].some((c) => c.status.state === "overdue");
    if (late && !remindedRecently.has(m.id)) {
      items.push({
        userId: m.id,
        kind: "dues_late",
        group: "aidat",
        dedupeKey: `aidat-gec-${day}`,
        title: "Aidat hatırlatması",
        body: "Ödenmemiş aidatın görünüyor. Ayrıntılar Profilim'de.",
        line: "Aidat: ödenmemiş dönem var",
        url: "/profil#aidat",
        tag: "aidat",
        expiresAt,
        morning: true,
      });
    }
  }
  return items;
}

type Commit = () => Promise<void>;
const SECTIONS = ["rehearsals", "homework", "review", "repertoire", "tickets", "dues"] as const;

/**
 * The morning lines of one Istanbul day (D69): 2, 3, 8, 10, 11, 12, 17, 19. A failing section is
 * reported and skipped; `commits` advance markers and must run only after the rows are written.
 */
export async function morningItems(ctx: PushContext, day: string) {
  const endOfDay = istanbulToUtc(addDays(day, 1));
  const commits: Commit[] = [];
  const results = await Promise.allSettled([
    rehearsalLines(day, ctx.now),
    homeworkLines(day, ctx.now),
    reviewLines(day, endOfDay),
    repertoireLines(day, ctx.now, endOfDay, commits),
    ticketLines(day, endOfDay),
    duesLines(day, ctx.now),
  ]);
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = SECTIONS.filter((_, i) => results[i].status === "rejected");
  // A failed repertoire section must not advance its marker.
  return { items, commits: failed.includes("repertoire") ? [] : commits, failed };
}
