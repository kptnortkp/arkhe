import { notFound } from "next/navigation";
import { updateSpecialDay } from "@/app/(portal)/ozel-gunler/actions";
import { BackLink } from "@/components/board/back-link";
import { SpecialDayDelete, SpecialDayForm } from "@/components/festivals/special-day-form";
import { getSpecialDay } from "@/lib/festivals/queries";

export const metadata = { title: "Özel gün" };

export default async function SpecialDayPage({ params }: PageProps<"/ozel-gunler/[id]">) {
  const { id } = await params;
  const d = await getSpecialDay(id);
  if (!d) notFound();
  const back = `/ozel-gunler?yil=${d.day.slice(0, 4)}`;
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={back}>Özel günlere dön</BackLink>
        <h1 className="text-3xl font-medium [overflow-wrap:anywhere]">{d.title}</h1>
      </div>
      <SpecialDayForm
        key={d.updatedAt.getTime()}
        action={updateSpecialDay.bind(null, d.id)}
        cancelHref={back}
        defaults={{ day: d.day, title: d.title, kind: d.kind }}
      />
      <div className="border-t pt-4">
        <SpecialDayDelete id={d.id} title={d.title} />
      </div>
    </div>
  );
}
