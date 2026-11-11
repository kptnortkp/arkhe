import { notFound } from "next/navigation";
import { updateFestival } from "@/app/(portal)/yonetim/festivaller/actions";
import { BackLink } from "@/components/board/back-link";
import { FestivalDelete, FestivalForm } from "@/components/festivals/festival-form";
import { getFestival } from "@/lib/festivals/queries";

export const metadata = { title: "Festival" };

export default async function FestivalPage({ params }: PageProps<"/yonetim/festivaller/[id]">) {
  const { id } = await params;
  const f = await getFestival(id);
  if (!f) notFound();
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href="/yonetim/festivaller">Festivallere dön</BackLink>
        <h1 className="text-3xl font-medium [overflow-wrap:anywhere]">{f.name}</h1>
      </div>
      <FestivalForm
        key={f.updatedAt.getTime()}
        action={updateFestival.bind(null, f.id)}
        cancelHref="/yonetim/festivaller"
        defaults={{
          name: f.name,
          region: f.region,
          status: f.status,
          startsOn: f.startsOn ?? "",
          endsOn: f.endsOn ?? "",
          dateNote: f.dateNote ?? "",
          deadlineOn: f.deadlineOn ?? "",
          deadlineNote: f.deadlineNote ?? "",
          fee: f.fee ?? "",
          place: f.place ?? "",
          url: f.url ?? "",
          linkLabel: f.linkLabel ?? "",
          note: f.note ?? "",
        }}
      />
      <div className="border-t pt-4">
        <FestivalDelete id={f.id} name={f.name} />
      </div>
    </div>
  );
}
