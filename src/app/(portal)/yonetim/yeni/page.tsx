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
  const assignees = await assigneeOptions();
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={`/yonetim?sutun=${SUTUN_SLUGS[status]}`}>Panoya dön</BackLink>
        <h1 className="text-3xl font-medium">Yeni iş</h1>
      </div>
      <TicketForm
        mode="create"
        action={createTicket}
        clientId={crypto.randomUUID()}
        me={viewer.id}
        assignees={assignees}
        cancelHref={`/yonetim?sutun=${SUTUN_SLUGS[status]}`}
        defaults={{
          title: "",
          description: "",
          assigneeId: "",
          urgency: "medium",
          dueOn: "",
          status,
        }}
      />
    </div>
  );
}
