import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAssignment } from "@/app/(portal)/odevler/actions";
import { AssignmentForm } from "@/components/homework/assignment-form";
import { VOICE_PARTS } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { pieceOptions } from "@/lib/homework/queries";
import { addDays, istanbulDateOf, now } from "@/lib/time";

export const metadata = { title: "Ödev ver" };

export default async function NewAssignmentPage({ searchParams }: PageProps<"/odevler/yeni">) {
  await requireManager();
  const sp = await searchParams;
  const pieces = await pieceOptions();
  const preset = typeof sp.eser === "string" ? sp.eser : "";
  const fromPiece = pieces.some((p) => p.id === preset && p.status !== "archive") ? preset : "";
  const today = istanbulDateOf(now());
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={fromPiece ? `/repertuvar/${fromPiece}` : "/odevler"}
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {fromPiece ? "Esere dön" : "Ödevler"}
      </Link>
      <h1 className="text-4xl font-medium">Ödev ver</h1>
      <AssignmentForm
        action={createAssignment}
        clientId={crypto.randomUUID()}
        submitLabel="Ödevi ver"
        minDate={today}
        pieces={pieces.filter((p) => p.status !== "archive")}
        defaults={{
          pieceId: fromPiece,
          barFrom: "",
          barTo: "",
          parts: [...VOICE_PARTS],
          dueDate: addDays(today, 7),
          dueTime: "23:59",
          description: "",
        }}
      />
    </div>
  );
}
