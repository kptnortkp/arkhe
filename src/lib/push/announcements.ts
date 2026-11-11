import "server-only";
import type { AnnouncementAudience, VoicePart } from "@/db/schema";
import { audienceIds } from "@/lib/announcements/queries";
import { PUSH_BODY_MAX, PUSH_TITLE_MAX } from "@/lib/announcements/labels";
import { addDays, istanbulToUtc } from "@/lib/time";
import { pushContext } from "./context";
import { cut, DAY_MS, type Item } from "./copy";
import { notify } from "./dispatch";

type A = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  parts: VoicePart[];
  important: boolean;
  showUntil: string;
};

/**
 * New announcement, or an edit sent again (`update` = a per-edit suffix for the dedupe key).
 * The audience minus the actor unless `includeActor`; important ones skip the switches and quiet hours.
 * Logged, never thrown (D68).
 */
export async function announcementSent(
  a: A,
  actorId: string,
  update?: string,
  { includeActor = false }: { includeActor?: boolean } = {},
) {
  try {
    const ctx = await pushContext();
    const ids = (await audienceIds(a.audience, a.parts)).filter(
      (id) => includeActor || id !== actorId,
    );
    // Until its last day on the home card ends, but never less than a day: a late-evening send
    // held by quiet hours must survive until the morning.
    const expiresAt = new Date(
      Math.max(istanbulToUtc(addDays(a.showUntil, 1)).getTime(), Date.now() + DAY_MS),
    );
    const title = update ? "Duyuru güncellendi" : cut(a.title, PUSH_TITLE_MAX);
    const body = update ? cut(`${a.title}: ${a.body}`, PUSH_BODY_MAX) : cut(a.body, PUSH_BODY_MAX);
    const items: Item[] = ids.map((userId) => ({
      userId,
      kind: "announcement",
      group: a.important ? null : "calisma",
      urgent: a.important,
      dedupeKey: update ? `duyuru-${a.id}-${update}` : `duyuru-${a.id}`,
      title,
      body,
      line: `Duyuru: ${a.title}`,
      url: `/duyurular#${a.id}`,
      tag: `duyuru-${a.id}`,
      expiresAt,
    }));
    await notify(items, ctx);
  } catch (e) {
    console.error("push trigger failed", { trigger: "announcement", name: (e as Error)?.name });
  }
}
