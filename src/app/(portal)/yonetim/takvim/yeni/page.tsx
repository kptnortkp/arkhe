import { createCalendarEvent } from "@/app/(portal)/yonetim/takvim/actions";
import { BackLink } from "@/components/board/back-link";
import { EventForm } from "@/components/board/event-form";
import { requireManager } from "@/lib/auth/dal";
import { istanbulDateOf, now } from "@/lib/time";

export const metadata = { title: "Yeni etkinlik" };

export default async function NewEventPage({ searchParams }: PageProps<"/yonetim/takvim/yeni">) {
  await requireManager();
  const { tarih } = await searchParams;
  const day =
    typeof tarih === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tarih) ? tarih : istanbulDateOf(now());
  const back = `/yonetim/takvim?ay=${day.slice(0, 7)}&gun=${day}`;
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={back}>Takvime dön</BackLink>
        <h1 className="text-3xl font-medium">Yeni etkinlik</h1>
        <p className="text-sm text-muted-foreground">Yalnızca ad ve tarih gerekli.</p>
      </div>
      <EventForm
        action={createCalendarEvent}
        clientId={crypto.randomUUID()}
        cancelHref={back}
        defaults={{
          title: "",
          kind: "other",
          day,
          startTime: "",
          endTime: "",
          location: "",
          note: "",
        }}
      />
    </div>
  );
}
