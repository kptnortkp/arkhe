import { listRehearsals, rehearsalTitle } from "@/lib/attendance/rehearsals";
import { isExpected } from "@/lib/attendance/roster";
import { buildCalendar, type FeedEvent } from "@/lib/calendar-feed/ics";
import { feedOwner } from "@/lib/calendar-feed/tokens";
import { festivalDates } from "@/lib/festivals/labels";
import { festivalsBetween } from "@/lib/festivals/queries";
import { isManager } from "@/lib/permissions";
import { addDays, istanbulDateOf, now } from "@/lib/time";

const DAY_MS = 86_400_000;

/** The member's rehearsals as an iCalendar subscription; the secret in the URL is the only key. */
export async function GET(request: Request, { params }: RouteContext<"/api/takvim/[token]">) {
  const { token } = await params;
  const owner = await feedOwner(token.replace(/\.ics$/, ""));
  if (!owner) return new Response("Bulunamadı.", { status: 404 });

  const at = now();
  const list = await listRehearsals({
    from: new Date(at.getTime() - 60 * DAY_MS),
    to: new Date(at.getTime() + 400 * DAY_MS),
    limit: 500,
  });
  const mine = owner.role === "conductor" ? list : list.filter((r) => isExpected(owner, r));
  const today = istanbulDateOf(at);
  // Festivals are board-only: they reach the feed of a conductor or board member alone.
  const board = isManager(owner.role)
    ? await festivalsBetween(addDays(today, -60), addDays(today, 400))
    : [];
  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  const festivalEvents: FeedEvent[] = board.flatMap((f) => {
    const path = `/yonetim/festivaller/${f.id}`;
    const out: FeedEvent[] = [];
    if (f.startsOn) {
      out.push({
        id: `festival-${f.id}`,
        title: `Festival · ${f.name}`,
        location: f.place,
        description: [festivalDates(f), f.fee, f.url].filter(Boolean).join("\n"),
        cancelled: false,
        path,
        allDay: { first: f.startsOn, last: f.endsOn ?? f.startsOn },
      });
    }
    if (f.deadlineOn) {
      out.push({
        id: `festival-deadline-${f.id}`,
        title: `Son başvuru · ${f.name}`,
        location: null,
        description: [f.deadlineNote, f.url].filter(Boolean).join("\n"),
        cancelled: false,
        path,
        allDay: { first: f.deadlineOn, last: f.deadlineOn },
      });
    }
    return out;
  });
  const body = buildCalendar(
    [
      ...mine.map((r): FeedEvent => ({
        id: r.id,
        title: `Arkhe · ${rehearsalTitle(r)}`,
        location: r.location,
        description: r.note,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        cancelled: r.cancelledAt !== null,
      })),
      ...festivalEvents,
    ],
    { name: "Koro Arkhe", url: origin.replace(/\/$/, ""), stamp: at },
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="koro-arkhe.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
