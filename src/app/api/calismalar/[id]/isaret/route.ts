import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { ATTENDANCE_STATUSES, attendance } from "@/db/schema";
import { json, managerOrError, sameOrigin } from "@/lib/api";
import { liveSnapshot } from "@/lib/attendance/live";
import { getRehearsal } from "@/lib/attendance/rehearsals";
import { isExpected, loadRosterUsers } from "@/lib/attendance/roster";

const bodySchema = z.object({
  marks: z
    .array(
      z.object({
        userId: z.uuid(),
        status: z.enum(ATTENDANCE_STATUSES).nullable(),
        ageMs: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100),
});

/** Batch of manual marks; offline retries replay the same batch, stale ones lose to newer writes. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/calismalar/[id]/isaret">,
) {
  if (!sameOrigin(request)) return json({ error: "Geçersiz istek." }, 403);
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success)
    return json({ error: "Geçersiz istek." }, 400);

  const r = await getRehearsal(id);
  if (!r || r.cancelledAt) return json({ error: "Bulunamadı." }, 404);
  if (r.startsAt > new Date() && !r.openedAt) {
    return json({ error: "Yoklama henüz başlamadı." }, 409);
  }
  const people = new Map((await loadRosterUsers()).map((u) => [u.id, u]));
  const userIds = [...new Set(parsed.data.marks.map((m) => m.userId))];
  const existing = new Set(
    (
      await db
        .select({ userId: attendance.userId })
        .from(attendance)
        .where(and(eq(attendance.rehearsalId, id), inArray(attendance.userId, userIds)))
    ).map((row) => row.userId),
  );
  const now = Date.now();
  const correctedAt = r.closedAt ? new Date() : null;

  // One round trip for the whole batch; replays after an offline spell can be dozens of marks.
  const writes = parsed.data.marks.flatMap((mark): BatchItem<"sqlite">[] => {
    const person = people.get(mark.userId);
    if (!person || person.role === "conductor") return [];
    // Server time minus the mark's age; capped so a stale replay can't pretend to be ancient.
    const markedAt = new Date(now - Math.min(mark.ageMs, 3 * 3600_000));
    if (mark.status === null) {
      if (r.closedAt) return []; // reports stay complete after close
      return [
        db
          .delete(attendance)
          .where(
            and(
              eq(attendance.rehearsalId, id),
              eq(attendance.userId, mark.userId),
              lte(attendance.recordedAt, markedAt),
            ),
          ),
      ];
    }
    if (!existing.has(mark.userId) && !isExpected(person, r)) return [];
    return [
      db
        .insert(attendance)
        .values({
          rehearsalId: id,
          userId: mark.userId,
          status: mark.status,
          method: "manual",
          recordedBy: auth.user.id,
          recordedAt: markedAt,
          correctedAt,
        })
        .onConflictDoUpdate({
          target: [attendance.rehearsalId, attendance.userId],
          set: {
            status: mark.status,
            method: "manual",
            recordedBy: auth.user.id,
            recordedAt: markedAt,
            // Excuse reasons stay only while the status stays excused.
            note: mark.status === "excused" ? sql`note` : null,
            correctedAt: correctedAt ?? sql`corrected_at`,
          },
          setWhere: lte(attendance.recordedAt, markedAt),
        }),
    ];
  });
  if (writes.length) await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  revalidatePath(`/calismalar/${id}`);
  return json(await liveSnapshot(id, false));
}
