import { createTicket } from "@/app/(portal)/yonetim/actions";
import { BackLink } from "@/components/board/back-link";
import { TicketForm } from "@/components/board/ticket-form";
import { requireManager } from "@/lib/auth/dal";
import { statusFromSlug, SUTUN_SLUGS } from "@/lib/board/labels";
import { assigneeOptions } from "@/lib/board/queries";

export const metadata = { title: "Yeni iş" };

export default async function NewTicketPage({ searchParams }: PageProps<"/yonetim/yeni">) {
  const viewer = await requireManager();
  const sp = await searchParams;
  const status = statusFromSlug(sp.sutun) ?? "todo";
  // From the calendar: ?tarih=YYYY-MM-DD&takvim=1 pre-fills the day and the switch.
  const fromCalendar = sp.takvim === "1";
  const day = typeof sp.tarih === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih) ? sp.tarih : "";
  const back = fromCalendar
    ? `/yonetim/takvim${day ? `?ay=${day.slice(0, 7)}&gun=${day}` : ""}`
    : `/yonetim?sutun=${SUTUN_SLUGS[status]}`;
  const assignees = await assigneeOptions();
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={back}>{fromCalendar ? "Takvime dön" : "Panoya dön"}</BackLink>
        <h1 className="text-3xl font-medium">Yeni iş</h1>
      </div>
      <TicketForm
        mode="create"
        action={createTicket}
        clientId={crypto.randomUUID()}
        me={viewer.id}
        assignees={assignees}
        cancelHref={back}
        defaults={{
          title: "",
          description: "",
          assigneeId: "",
          urgency: "medium",
          dueOn: day,
          onCalendar: fromCalendar,
          status,
        }}
      />
    </div>
  );
}
