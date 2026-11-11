import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { announcementParts, announcementReads, announcements, users } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { FEATURE_NOTE_MAX_AGE_DAYS, FEATURE_NOTES } from "@/lib/announcements/feature-notes";
import { SHOW_DAYS_DEFAULT } from "@/lib/announcements/labels";
import { addDays, istanbulDateOf } from "@/lib/time";
import { announcementSent } from "./announcements";

/** Same key, same id: the insert below is the "sent once" record. */
export function featureNoteId(key: string) {
  const h = createHash("sha256").update(`feature-note:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Publishes the notes not yet sent as announcements from the IT user, each pushed to its
 * whole audience, the sender included. Never throws: it runs after the health probe of a new build.
 */
export async function publishFeatureNotes({ anyAge = false }: { anyAge?: boolean } = {}) {
  try {
    const today = istanbulDateOf(new Date());
    const due = FEATURE_NOTES.filter(
      (n) => anyAge || n.date >= addDays(today, -FEATURE_NOTE_MAX_AGE_DAYS),
    );
    if (due.length === 0) return;
    const [sender] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handlesReports, true), eq(users.isActive, true), isNull(users.leftAt)))
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (!sender) return;
    const showUntil = addDays(today, SHOW_DAYS_DEFAULT);
    for (const note of due) {
      const id = featureNoteId(note.key);
      const parts = note.audience === "parts" ? (note.parts ?? []) : [];
      const created = await writeTx(async (tx) => {
        const rows = await tx
          .insert(announcements)
          .values({
            id,
            title: note.title,
            body: note.body,
            audience: note.audience,
            important: false,
            createdBy: sender.id,
            showUntil,
          })
          .onConflictDoNothing()
          .returning({ id: announcements.id });
        if (rows.length === 0) return false;
        if (parts.length) {
          await tx
            .insert(announcementParts)
            .values(parts.map((voicePart) => ({ announcementId: id, voicePart })));
        }
        await tx.insert(announcementReads).values({ announcementId: id, userId: sender.id });
        return true;
      });
      if (!created) continue;
      await announcementSent(
        {
          id,
          title: note.title,
          body: note.body,
          audience: note.audience,
          parts,
          important: false,
          showUntil,
        },
        sender.id,
        undefined,
        { includeActor: true },
      );
      console.log("feature note published", { key: note.key, audience: note.audience });
    }
  } catch (e) {
    console.error("feature notes failed", { name: (e as Error)?.name });
  }
}
