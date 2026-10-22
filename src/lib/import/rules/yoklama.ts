import "server-only";
import { and, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  attendance,
  importItems,
  rehearsalParts,
  rehearsals,
  type AttendanceStatus,
  type RehearsalType,
  type VoicePart,
} from "@/db/schema";
import { absentRows } from "@/lib/attendance/close";
import { expectedIds, isExpected } from "@/lib/attendance/roster";
import { rehearsalSchema } from "@/lib/attendance/schemas";
import { REHEARSAL_TYPE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { addDays, istanbulToUtc } from "@/lib/time";
import type { ImportRow } from "../engine";
import { insertChunks, type BatchDb } from "../tx";
import type { ResultLink, Warning } from "../types";
import { day, Errors, json, Keys, NO_SUCH_MEMBER, secs, str, type Ctx, type Rules } from "./common";
import { usersRead } from "./dues-snapshot";

export const NOT_EXPECTED =
  "Bu kişi bu çalışmada beklenmiyor (katılım/ayrılış tarihi, rol ya da partisyon).";
const PORTAL_REHEARSAL =
  "Bu saatte portalda girilmiş bir çalışma var; yoklamasını o sayfadan düzelt.";
const IMPORTED_DIFFERENT =
  "Bu çalışma daha önce farklı yoklamayla aktarıldı; önce o aktarımı geri al.";
const NOT_FINISHED = "Bitmemiş bir çalışma içe aktarılamaz.";
const PARTS_ONLY_SECTIONAL = "Partiler yalnızca partisyon türünde yazılır.";
const NOTE_ONLY_EXCUSED = "Not yalnızca mazeretli satırda yazılır.";
const INHERITED = ["bitis", "tur", "partiler", "baslik", "yer"] as const;
const FIELD = { type: "tur", end: "bitis", start: "baslangic", parts: "partiler", title: "baslik", location: "yer", date: "tarih" } as const;

function range(rows: ImportRow[]) {
  const days = rows.map((r) => str(r.v.tarih)).filter((d): d is string => d !== null).sort();
  if (!days.length) return [new Date(0), new Date(0)] as const;
  return [istanbulToUtc(days[0]), istanbulToUtc(addDays(days[days.length - 1], 1))] as const;
}

/** Rows per page of /calismalar?sekme=gecmis. */
const PAST_PAGE = 60;

const reads = (q: BatchDb, rows: ImportRow[], ctx: Ctx) => {
  const [from, to] = range(rows);
  const inRange = and(gte(rehearsals.startsAt, from), lt(rehearsals.startsAt, to));
  const ids = q.select({ id: rehearsals.id }).from(rehearsals).where(inRange);
  return {
    users: usersRead(q),
    // Past rehearsals after the file's last day: they sit above the imported ones in the past list.
    later: q
      .select({ n: sql<number>`count(*)` })
      .from(rehearsals)
      .where(and(gte(rehearsals.startsAt, to), lt(rehearsals.startsAt, istanbulToUtc(ctx.today)))),
    rehearsals: q
      .select({
        id: rehearsals.id,
        type: rehearsals.type,
        title: rehearsals.title,
        location: rehearsals.location,
        startsAt: rehearsals.startsAt,
        endsAt: rehearsals.endsAt,
        // Qualified by hand: drizzle drops table names in single-table selects.
        imported: sql<number>`exists (select 1 from import_items i where i.rehearsal_id = "rehearsals"."id")`,
      })
      .from(rehearsals)
      .where(inRange),
    parts: q.select().from(rehearsalParts).where(inArray(rehearsalParts.rehearsalId, ids)),
    marks: q
      .select({
        rehearsalId: attendance.rehearsalId,
        userId: attendance.userId,
        status: attendance.status,
        note: attendance.note,
      })
      .from(attendance)
      .where(
        and(
          inArray(attendance.rehearsalId, ids),
          sql`${attendance.method} = 'manual'`,
          inArray(
            attendance.rehearsalId,
            q.select({ id: importItems.rehearsalId }).from(importItems).where(isNotNull(importItems.rehearsalId)),
          ),
        ),
      ),
  };
};

type Group = {
  key: string;
  first: ImportRow;
  date: string;
  start: string;
  end: string;
  type: RehearsalType;
  parts: VoicePart[];
  title: string | null;
  location: string | null;
  rows: { row: ImportRow; userId: string; status: AttendanceStatus; note: string | null }[];
  bad: boolean;
};

const sameParts = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export const yoklamaRules: Rules<ReturnType<typeof reads>> = {
  reads,
  plan(rows, snap, ctx) {
    const errors = new Errors();
    const keys = new Keys();
    const byEmail = new Map(snap.users.map((u) => [u.email, u]));
    const byId = new Map(snap.users.map((u) => [u.id, u]));
    const groups = new Map<string, Group>();
    const lastStartOf = new Map<string, string>();

    for (const row of rows) {
      errors.absorb(row);
      const date = str(row.v.tarih);
      if (!date) continue;
      const start = str(row.v.baslangic) ?? lastStartOf.get(date) ?? "19:00";
      if (row.v.baslangic !== undefined) lastStartOf.set(date, start);
      const key = `${date} ${start}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          first: row,
          date,
          start,
          end: str(row.v.bitis) ?? "22:00",
          type: (row.v.tur as RehearsalType | null) ?? "tutti",
          parts: (row.v.partiler as VoicePart[] | null) ?? [],
          title: str(row.v.baslik),
          location: str(row.v.yer),
          rows: [],
          bad: false,
        };
        groups.set(key, g);
      } else {
        const firstValue = { bitis: g.end, tur: g.type, partiler: g.parts, baslik: g.title, yer: g.location };
        for (const col of INHERITED) {
          const v = row.v[col];
          if (v === null || v === undefined) continue;
          const same = col === "partiler" ? sameParts(v as string[], g.parts) : v === firstValue[col];
          if (!same) errors.add(row, col, `Bu çalışmanın ilk satırıyla (satır ${g.first.line}) farklı.`);
        }
      }
      const email = str(row.v.eposta);
      if (email) keys.claim(errors, row, "eposta", `${key}|${email}`);
      const status = row.v.durum as AttendanceStatus | null;
      const note = str(row.v.not);
      if (note && status && status !== "excused") errors.add(row, "not", NOTE_ONLY_EXCUSED);
      if (!errors.ok(row)) {
        g.bad = true;
        continue;
      }
      const user = byEmail.get(email!);
      if (!user) {
        errors.add(row, "eposta", NO_SUCH_MEMBER);
        g.bad = true;
        continue;
      }
      g.rows.push({ row, userId: user.id, status: status!, note: status === "excused" ? note : null });
    }

    const byStart = new Map(snap.rehearsals.map((r) => [r.startsAt.getTime(), r]));
    const partsOf = new Map<string, VoicePart[]>();
    for (const p of snap.parts) partsOf.set(p.rehearsalId, [...(partsOf.get(p.rehearsalId) ?? []), p.voicePart]);
    const marksOf = new Map<string, Map<string, { status: string; note: string | null }>>();
    for (const m of snap.marks) {
      if (!marksOf.has(m.rehearsalId)) marksOf.set(m.rehearsalId, new Map());
      marksOf.get(m.rehearsalId)!.set(m.userId, m);
    }

    const created: {
      rehearsal: typeof rehearsals.$inferInsert & { id: string; type: RehearsalType; startsAt: Date; endsAt: Date };
      parts: VoicePart[];
      marks: typeof attendance.$inferInsert[];
      absent: string[];
    }[] = [];
    const effects: string[] = [];
    let unchanged = 0;
    let added = 0;
    let missing = 0;
    const tally = new Map<RehearsalType, number>();

    for (const g of groups.values()) {
      const parsed = rehearsalSchema.safeParse({
        type: g.type,
        date: g.date,
        start: g.start,
        end: g.end,
        title: g.title ?? undefined,
        location: g.location ?? undefined,
        parts: g.parts,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.add(g.first, FIELD[issue.path[0] as keyof typeof FIELD] ?? null, issue.message);
        }
        continue;
      }
      if (g.type !== "sectional" && g.parts.length) {
        errors.add(g.first, "partiler", PARTS_ONLY_SECTIONAL);
        continue;
      }
      const startsAt = istanbulToUtc(g.date, g.start);
      const endsAt = istanbulToUtc(g.date, g.end);
      if (endsAt > ctx.now) {
        errors.add(g.first, "tarih", NOT_FINISHED);
        continue;
      }
      const shape = { id: "", type: g.type, startsAt, parts: g.type === "sectional" ? g.parts : [] };
      for (const m of g.rows) {
        const user = byId.get(m.userId)!;
        if (!isExpected(user, shape)) errors.add(m.row, "eposta", NOT_EXPECTED);
      }
      if (g.bad || g.rows.some((m) => !errors.ok(m.row))) continue;

      const existing = byStart.get(startsAt.getTime());
      if (existing) {
        if (!existing.imported) {
          errors.add(g.first, "tarih", PORTAL_REHEARSAL);
          continue;
        }
        const marks = marksOf.get(existing.id) ?? new Map();
        const same =
          existing.type === g.type &&
          sameParts(partsOf.get(existing.id) ?? [], shape.parts) &&
          (existing.title ?? null) === (parsed.data.title ?? null) &&
          (existing.location ?? null) === (parsed.data.location ?? null) &&
          existing.endsAt.getTime() === endsAt.getTime() &&
          marks.size === g.rows.length &&
          g.rows.every((m) => {
            const mark = marks.get(m.userId);
            return mark && mark.status === m.status && (mark.note ?? null) === m.note;
          });
        if (same) unchanged += g.rows.length;
        else errors.add(g.first, "tarih", IMPORTED_DIFFERENT);
        continue;
      }

      const id = crypto.randomUUID();
      const listed = new Set(g.rows.map((m) => m.userId));
      const absent = expectedIds(snap.users, { ...shape, id }).filter((u) => !listed.has(u));
      created.push({
        rehearsal: {
          id,
          type: g.type,
          title: parsed.data.title,
          location: parsed.data.location,
          note: null,
          startsAt,
          endsAt,
          seriesId: null,
          openedAt: startsAt,
          closedAt: endsAt,
          createdBy: ctx.actor.id,
          createdAt: ctx.now,
        },
        parts: shape.parts,
        marks: g.rows.map((m) => ({
          rehearsalId: id,
          userId: m.userId,
          status: m.status,
          method: "manual" as const,
          note: m.note,
          recordedAt: startsAt,
          recordedBy: ctx.actor.id,
          correctedAt: null,
        })),
        absent,
      });
      added += g.rows.length;
      missing += absent.length;
      tally.set(g.type, (tally.get(g.type) ?? 0) + 1);
      const label =
        g.type === "sectional"
          ? `${REHEARSAL_TYPE_LABELS.sectional} (${shape.parts.map((p) => VOICE_PART_LABELS[p]).join(", ")})`
          : REHEARSAL_TYPE_LABELS[g.type];
      const extra = [parsed.data.title, parsed.data.location].filter(Boolean).map((s) => ` · ${s}`).join("");
      effects.push(
        `${day(g.date)} ${g.start} ${label}${extra}: ${g.rows.length + absent.length} kişi, ${absent.length} Gelmedi (listede yok)`,
      );
    }

    const warnings: Warning[] = [];
    const withMissing = created.filter((c) => c.absent.length).length;
    if (missing) {
      warnings.push({
        kind: "autoAbsent",
        text: `${withMissing} çalışmada toplam ${missing} beklenen kişi listede yok; Gelmedi sayılacak.`,
      });
    }
    const notes = created.length
      ? [
          `${created.length} çalışma · ${[...tally.entries()]
            .map(([t, n]) => `${n} ${REHEARSAL_TYPE_LABELS[t].toLocaleLowerCase("tr")}`)
            .join(", ")}`,
        ]
      : [];

    let links: ResultLink[] | undefined;
    if (created.length) {
      const newest = Math.max(...created.map((c) => c.rehearsal.startsAt.getTime()));
      const above =
        Number(snap.later[0]?.n ?? 0) + snap.rehearsals.filter((r) => r.startsAt.getTime() > newest).length;
      const page = Math.floor(above / PAST_PAGE) + 1;
      links = [
        created.length === 1
          ? { label: "Çalışma", href: `/calismalar/${created[0].rehearsal.id}` }
          : { label: "Çalışmalar", href: page === 1 ? "/calismalar?sekme=gecmis" : `/calismalar?sekme=gecmis&sayfa=${page}` },
        { label: "Raporlar", href: "/raporlar" },
      ];
    }

    return {
      errors: errors.sorted(),
      warnings,
      effects,
      notes,
      counts: { added, updated: 0, unchanged },
      deactivations: 0,
      links,
      writes: (q, batchId) => [
        ...insertChunks(q, rehearsals, created.map((c) => c.rehearsal)),
        ...insertChunks(
          q,
          rehearsalParts,
          created.flatMap((c) => c.parts.map((voicePart) => ({ rehearsalId: c.rehearsal.id, voicePart }))),
        ),
        ...insertChunks(
          q,
          attendance,
          created.flatMap((c) => [...c.marks, ...absentRows(c.rehearsal.id, c.absent, c.rehearsal.endsAt)]),
        ),
        ...insertChunks(
          q,
          importItems,
          created.map((c) => ({
            batchId,
            target: "rehearsal" as const,
            action: "create" as const,
            rehearsalId: c.rehearsal.id,
            afterJson: json(rehearsalSnapshot(c.rehearsal, c.parts, c.marks.length + c.absent.length)),
          })),
        ),
      ],
    };
  },
};

export function rehearsalSnapshot(
  r: {
    type: string;
    title?: string | null;
    location?: string | null;
    note?: string | null;
    startsAt: Date;
    endsAt: Date;
    openedAt?: Date | null;
    closedAt?: Date | null;
    cancelledAt?: Date | null;
  },
  parts: readonly string[],
  rows: number,
) {
  return {
    type: r.type,
    title: r.title ?? null,
    location: r.location ?? null,
    note: r.note ?? null,
    startsAt: secs(r.startsAt),
    endsAt: secs(r.endsAt),
    openedAt: secs(r.openedAt ?? null),
    closedAt: secs(r.closedAt ?? null),
    cancelledAt: secs(r.cancelledAt ?? null),
    parts: [...parts].sort().join(","),
    rows,
  };
}
