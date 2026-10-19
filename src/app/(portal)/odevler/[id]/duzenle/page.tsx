import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { updateAssignment } from "@/app/(portal)/odevler/actions";
import { AssignmentForm } from "@/components/homework/assignment-form";
import { requireManager } from "@/lib/auth/dal";
import { barsLabel } from "@/lib/homework/mail";
import { getAssignment, pieceOptions, submissionCount } from "@/lib/homework/queries";
import { istanbulDateOf, istanbulTimeOf } from "@/lib/time";

export const metadata = { title: "Ödevi düzenle" };

export default async function EditAssignmentPage({ params }: PageProps<"/odevler/[id]/duzenle">) {
  await requireManager();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const a = await getAssignment(id);
  if (!a) notFound();
  const [pieces, submitted] = await Promise.all([pieceOptions(a.pieceId), submissionCount(a.id)]);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/odevler/${a.id}`}
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Ödeve dön
      </Link>
      <div className="space-y-1">
        <h1 className="text-4xl font-medium">Ödevi düzenle</h1>
        <p className="text-muted-foreground">
          {a.pieceTitle} · {barsLabel(a.barFrom, a.barTo)}
        </p>
      </div>
      <AssignmentForm
        action={updateAssignment.bind(null, a.id)}
        version={a.updatedAt.getTime()}
        submitLabel="Değişiklikleri kaydet"
        pieces={pieces}
        submittedCount={submitted}
        defaults={{
          pieceId: a.pieceId,
          barFrom: a.barFrom?.toString() ?? "",
          barTo: a.barTo?.toString() ?? "",
          parts: a.parts,
          dueDate: istanbulDateOf(a.dueAt),
          dueTime: istanbulTimeOf(a.dueAt),
          description: a.description ?? "",
        }}
      />
    </div>
  );
}
