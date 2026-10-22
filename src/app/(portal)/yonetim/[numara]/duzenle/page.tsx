import { notFound } from "next/navigation";
import { updateTicket } from "@/app/(portal)/yonetim/actions";
import { BackLink } from "@/components/board/back-link";
import { TicketForm } from "@/components/board/ticket-form";
import { requireManager } from "@/lib/auth/dal";
import { assigneeOptions, getTicket } from "@/lib/board/queries";

export const metadata = { title: "İşi düzenle" };

export default async function EditTicketPage({ params }: PageProps<"/yonetim/[numara]/duzenle">) {
  const viewer = await requireManager();
  const { numara } = await params;
  const [ticket, assignees] = await Promise.all([getTicket(numara), assigneeOptions()]);
  if (!ticket) notFound();
  const former =
    ticket.assignee && !assignees.some((a) => a.id === ticket.assignee!.id)
      ? { id: ticket.assignee.id, name: ticket.assignee.name }
      : null;
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={`/yonetim/${ticket.number}`}>İşe dön</BackLink>
        <h1 className="text-3xl font-medium">#{ticket.number} düzenle</h1>
      </div>
      <TicketForm
        key={ticket.revision}
        mode="edit"
        action={updateTicket.bind(null, ticket.number)}
        revision={ticket.revision}
        me={viewer.id}
        assignees={assignees}
        former={former}
        cancelHref={`/yonetim/${ticket.number}`}
        defaults={{
          title: ticket.title,
          description: ticket.description ?? "",
          assigneeId: ticket.assignee?.id ?? "",
          urgency: ticket.urgency,
          dueOn: ticket.dueOn ?? "",
          status: ticket.status,
        }}
      />
    </div>
  );
}
