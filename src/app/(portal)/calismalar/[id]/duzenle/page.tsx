import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RehearsalForm } from "@/components/attendance/rehearsal-form";
import { getRehearsal } from "@/lib/attendance/rehearsals";
import { requireManager } from "@/lib/auth/dal";
import { istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import { updateRehearsal } from "../../actions";

export const metadata = { title: "Çalışmayı düzenle" };

export default async function EditRehearsalPage({ params }: PageProps<"/calismalar/[id]/duzenle">) {
  await requireManager();
  const { id } = await params;
  const r = z.uuid().safeParse(id).success ? await getRehearsal(id) : null;
  if (!r || r.cancelledAt) notFound();

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-2">
        <Link
          href={`/calismalar/${id}`}
          className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Çalışma
        </Link>
        <h1 className="text-4xl font-medium">Çalışmayı düzenle</h1>
        {r.seriesId && (
          <p className="text-sm text-muted-foreground">
            Değişiklik sadece bu tarihteki çalışmaya uygulanır.
          </p>
        )}
      </div>
      <RehearsalForm
        action={updateRehearsal.bind(null, id)}
        allowRepeat={false}
        submitLabel="Kaydet"
        defaults={{
          type: r.type,
          date: istanbulDateOf(r.startsAt),
          start: istanbulTimeOf(r.startsAt),
          end: istanbulTimeOf(r.endsAt),
          title: r.title ?? "",
          location: r.location ?? "",
          note: r.note ?? "",
          parts: r.parts,
        }}
      />
    </div>
  );
}
