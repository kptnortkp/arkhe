import { createBudget } from "@/app/(portal)/finans/butce/actions";
import { BackLink } from "@/components/board/back-link";
import { BudgetMetaForm } from "@/components/budget/budget-meta-form";
import { budgetFormDefaults } from "@/lib/finance/queries";

export const metadata = { title: "Yeni bütçe" };

export default async function NewBudgetPage() {
  const d = await budgetFormDefaults();
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href="/finans/butce">Bütçeler</BackLink>
        <h1 className="text-3xl font-medium">Yeni bütçe</h1>
      </div>
      <BudgetMetaForm
        action={createBudget}
        clientId={crypto.randomUUID()}
        year={d.year}
        defaults={{ start: d.start, name: d.name, note: "" }}
        submitLabel="Oluştur"
        cancelHref="/finans/butce"
      />
    </div>
  );
}
