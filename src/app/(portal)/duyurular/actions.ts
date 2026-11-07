"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ANNOUNCEMENT_AUDIENCES,
  announcementParts,
  announcementReads,
  announcements,
  VOICE_PARTS,
} from "@/db/schema";
import { db } from "@/db";
import { writeTx } from "@/db/write-tx";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_MSG,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TITLE_MIN,
  ANNOUNCEMENTS_PER_DAY,
  SHOW_DAYS_MAX,
} from "@/lib/announcements/labels";
import { visibleAnnouncement } from "@/lib/announcements/queries";
import { assertManager, assertUser } from "@/lib/auth/dal";
import { consumeAttempt, forgetAttempt } from "@/lib/auth/rate-limit";
import { announcementSent } from "@/lib/push/announcements";
import { MSG } from "@/lib/storage/messages";
import { cleanLine, cleanText } from "@/lib/text";
import { addDays, istanbulDateOf, now } from "@/lib/time";

export type AnnouncementFieldErrors = {
  title?: string[];
  body?: string[];
  parts?: string[];
  showUntil?: string[];
};
export type AnnouncementResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error?: string; fieldErrors?: AnnouncementFieldErrors };
export type SimpleResult = { ok: boolean; error?: string; message?: string };

const chars = (s: string) => [...s].length;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: string) => DAY.test(s) && addDays(s, 0) === s;
const uuid = z.uuid();

// Lengths are counted in characters, as the DB CHECKs do (zod counts UTF-16 units).
const title = z
  .string()
  .transform((s) => cleanLine(s).replace(/\s+/g, " ").trim())
  .refine((s) => chars(s) >= ANNOUNCEMENT_TITLE_MIN, ANNOUNCEMENT_MSG.titleShort)
  .refine((s) => chars(s) <= ANNOUNCEMENT_TITLE_MAX, ANNOUNCEMENT_MSG.titleLong);
const body = z
  .string()
  .transform((s) => cleanText(s.replace(/\r\n?/g, "\n")).trim())
  .refine((s) => chars(s) >= 1, ANNOUNCEMENT_MSG.bodyEmpty)
  .refine((s) => chars(s) <= ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_MSG.bodyLong);

const createSchema = z
  .object({
    title,
    body,
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    parts: z.array(z.enum(VOICE_PARTS)).max(VOICE_PARTS.length).default([]),
    important: z.boolean().default(false),
    showUntil: z.string(),
  })
  .transform((v) => ({
    ...v,
    parts: v.audience === "parts" ? [...new Set(v.parts)] : [],
  }));

const editSchema = z.object({
  id: uuid,
  title,
  body,
  important: z.boolean().default(false),
  showUntil: z.string(),
  resend: z.boolean().default(false),
});

/** Today … today + 60 (Istanbul); on an edit the stored day may also stay as it is. */
function showUntilError(value: string, keep?: string) {
  if (keep !== undefined && value === keep) return null;
  const today = istanbulDateOf(now());
  if (!isDay(value) || value < today || value > addDays(today, SHOW_DAYS_MAX)) {
    return [ANNOUNCEMENT_MSG.showUntil];
  }
  return null;
}

function fieldErrors(error: z.ZodError): AnnouncementFieldErrors {
  const f = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return { title: f.title, body: f.body, parts: f.parts, showUntil: f.showUntil };
}

const revalidate = () => {
  revalidatePath("/duyurular");
  revalidatePath("/");
};

/** Managers only; the push goes to the audience minus the sender. */
export async function createAnnouncement(input: unknown): Promise<AnnouncementResult> {
  const user = await assertManager();
  if (!user) return { ok: false, error: ANNOUNCEMENT_MSG.forbidden };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const a = parsed.data;
  const errors: AnnouncementFieldErrors = {};
  if (a.audience === "parts" && a.parts.length === 0) errors.parts = [ANNOUNCEMENT_MSG.parts];
  const dayError = showUntilError(a.showUntil);
  if (dayError) errors.showUntil = dayError;
  if (errors.parts || errors.showUntil) return { ok: false, fieldErrors: errors };

  const { blocked, attemptId } = await consumeAttempt(
    `announcement:${user.id}`,
    ANNOUNCEMENTS_PER_DAY,
    86_400_000,
  );
  if (blocked) return { ok: false, error: ANNOUNCEMENT_MSG.rate };

  const id = crypto.randomUUID();
  try {
    await writeTx(async (tx) => {
      await tx.insert(announcements).values({
        id,
        title: a.title,
        body: a.body,
        audience: a.audience,
        important: a.important,
        createdBy: user.id,
        showUntil: a.showUntil,
      });
      if (a.parts.length) {
        await tx
          .insert(announcementParts)
          .values(a.parts.map((voicePart) => ({ announcementId: id, voicePart })));
      }
      // The sender has read their own announcement: no home card for them.
      await tx.insert(announcementReads).values({ announcementId: id, userId: user.id });
    });
  } catch (error) {
    await forgetAttempt(attemptId).catch(() => {});
    console.error("announcement create failed", { name: (error as Error)?.name });
    return { ok: false, error: MSG.generic };
  }
  await announcementSent({ id, ...a }, user.id);
  revalidate();
  console.log("announcement sent", { id, audience: a.audience, important: a.important });
  return { ok: true, id, message: ANNOUNCEMENT_MSG.sent };
}

/** Title, text, last day and importance; the audience stays. Sends again only on request. */
export async function updateAnnouncement(input: unknown): Promise<AnnouncementResult> {
  const user = await assertManager();
  if (!user) return { ok: false, error: ANNOUNCEMENT_MSG.forbidden };
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    const f = fieldErrors(parsed.error);
    return f.title || f.body ? { ok: false, fieldErrors: f } : { ok: false, error: MSG.generic };
  }
  const e = parsed.data;
  const current = await visibleAnnouncement(user, e.id);
  if (!current) return { ok: false, error: ANNOUNCEMENT_MSG.notFound };
  const dayError = showUntilError(e.showUntil, current.showUntil);
  if (dayError) return { ok: false, fieldErrors: { showUntil: dayError } };

  const at = now();
  const [row] = await db
    .update(announcements)
    .set({
      title: e.title,
      body: e.body,
      important: e.important,
      showUntil: e.showUntil,
      updatedAt: at,
    })
    .where(and(eq(announcements.id, e.id), isNull(announcements.deletedAt)))
    .returning({ id: announcements.id });
  if (!row) return { ok: false, error: ANNOUNCEMENT_MSG.notFound };
  // A resend reaches the whole audience again: it shares the daily send budget.
  const resend =
    e.resend &&
    !(await consumeAttempt(`announcement:${user.id}`, ANNOUNCEMENTS_PER_DAY, 86_400_000)).blocked;
  if (resend) {
    await announcementSent(
      { ...current, title: e.title, body: e.body, important: e.important, showUntil: e.showUntil },
      user.id,
      String(at.getTime()),
    );
  }
  revalidate();
  const message = resend
    ? ANNOUNCEMENT_MSG.resent
    : e.resend
      ? ANNOUNCEMENT_MSG.resendBlocked
      : ANNOUNCEMENT_MSG.saved;
  return { ok: true, id: e.id, message };
}

/** Soft delete: hidden from the list and the home card. */
export async function deleteAnnouncement(id: unknown): Promise<SimpleResult> {
  const user = await assertManager();
  if (!user) return { ok: false, error: ANNOUNCEMENT_MSG.forbidden };
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { ok: false, error: ANNOUNCEMENT_MSG.notFound };
  const [row] = await db
    .update(announcements)
    .set({ deletedAt: now() })
    .where(and(eq(announcements.id, parsed.data), isNull(announcements.deletedAt)))
    .returning({ id: announcements.id });
  if (!row) return { ok: false, error: ANNOUNCEMENT_MSG.notFound };
  // Pushes still waiting (quiet hours, retries) must not announce a deleted announcement.
  try {
    await db.run(sql`
      update notifications set status = 'dropped'
      where kind = 'announcement' and dedupe_key glob ${`duyuru-${parsed.data}*`}
        and status in ('pending', 'held')`);
  } catch (error) {
    console.error("announcement push drop failed", { name: (error as Error)?.name });
  }
  revalidate();
  return { ok: true, message: ANNOUNCEMENT_MSG.deleted };
}

/** "Tamam": only for an announcement addressed to the caller. */
export async function markAnnouncementRead(id: unknown): Promise<SimpleResult> {
  const user = await assertUser();
  if (!user) return { ok: false, error: MSG.auth };
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { ok: false, error: ANNOUNCEMENT_MSG.notFound };
  if (!(await visibleAnnouncement(user, parsed.data))) {
    return { ok: false, error: ANNOUNCEMENT_MSG.notFound };
  }
  await db
    .insert(announcementReads)
    .values({ announcementId: parsed.data, userId: user.id })
    .onConflictDoNothing();
  revalidatePath("/");
  return { ok: true };
}
