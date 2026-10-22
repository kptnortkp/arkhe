import { notFound } from "next/navigation";
import { savePlan } from "@/app/(portal)/finans/butce/actions";
import { BackLink } from "@/components/board/back-link";
import { PlanEditor } from "@/components/budget/plan-editor";
import { planForEditor } from "@/lib/finance/queries";

export const metadata = { title: "Bütçe planı" };

export default async function PlanEditorPage({ params }: PageProps<"/finans/butce/[id]/duzenle">) {
  const { id } = await params;
  const b = await planForEditor(id);
  if (!b) notFound();
  const approved = b.status === "approved";
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={`/finans/butce/${b.id}`}>{b.name}</BackLink>
        <h1 className="text-3xl font-medium">{approved ? "Planı değiştir" : "Planı yaz"}</h1>
        <p className="text-sm text-muted-foreground">{b.rangeLabel}</p>
      </div>
      <PlanEditor
        key={b.revision}
        budgetId={b.id}
        approved={approved}
        revision={b.revision}
        lines={b.lines}
        priorLabel={b.priorLabel}
        priorFrom={b.priorFrom}
        priorThrough={b.priorThrough}
        action={savePlan.bind(null, b.id)}
      />
    </div>
  );
}
