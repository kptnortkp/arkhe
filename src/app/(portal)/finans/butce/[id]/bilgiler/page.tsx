import { notFound } from "next/navigation";
import { updateBudget } from "@/app/(portal)/finans/butce/actions";
import { BackLink } from "@/components/board/back-link";
import { BudgetMetaForm } from "@/components/budget/budget-meta-form";
import { planForEditor, todayIstanbul } from "@/lib/finance/queries";

export const metadata = { title: "Bütçe bilgileri" };

export default async function BudgetInfoPage({ params }: PageProps<"/finans/butce/[id]/bilgiler">) {
  const { id } = await params;
  const b = await planForEditor(id);
  if (!b) notFound();
  const approved = b.status === "approved";
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={`/finans/butce/${b.id}`}>{b.name}</BackLink>
        <h1 className="text-3xl font-medium">{approved ? "Notu düzenle" : "Bilgileri düzenle"}</h1>
      </div>
      <BudgetMetaForm
        action={updateBudget.bind(null, b.id)}
        year={Number(todayIstanbul().slice(0, 4))}
        locked={approved}
        defaults={{ start: b.startMonth, name: b.name, note: b.note ?? "" }}
        submitLabel="Kaydet"
        cancelHref={`/finans/butce/${b.id}`}
        doneHref={`/finans/butce/${b.id}`}
      />
    </div>
  );
}
