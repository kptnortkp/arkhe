import { notFound } from "next/navigation";
import { updateCalendarEvent } from "@/app/(portal)/yonetim/takvim/actions";
import { BackLink } from "@/components/board/back-link";
import { EventDelete, EventForm } from "@/components/board/event-form";
import { getCalendarEvent } from "@/lib/board/queries";

export const metadata = { title: "Etkinlik" };

export default async function EventPage({ params }: PageProps<"/yonetim/takvim/etkinlik/[id]">) {
  const { id } = await params;
  const ev = await getCalendarEvent(id);
  if (!ev) notFound();
  const back = `/yonetim/takvim?ay=${ev.day.slice(0, 7)}&gun=${ev.day}`;
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={back}>Takvime dön</BackLink>
        <h1 className="text-3xl font-medium [overflow-wrap:anywhere]">{ev.title}</h1>
      </div>
      <EventForm
        key={ev.updatedAt.getTime()}
        action={updateCalendarEvent.bind(null, ev.id)}
        cancelHref={back}
        defaults={{
          title: ev.title,
          kind: ev.kind,
          day: ev.day,
          startTime: ev.startTime ?? "",
          endTime: ev.endTime ?? "",
          location: ev.location ?? "",
          note: ev.note ?? "",
        }}
      />
      <div className="border-t pt-4">
        <EventDelete id={ev.id} title={ev.title} />
      </div>
    </div>
  );
}
