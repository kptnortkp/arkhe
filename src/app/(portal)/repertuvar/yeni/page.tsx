import { createPiece } from "@/app/(portal)/repertuvar/actions";
import { BackLink } from "@/components/repertoire/back-link";
import { PieceForm } from "@/components/repertoire/piece-form";
import { requireManager } from "@/lib/auth/dal";

export const metadata = { title: "Yeni eser" };

export default async function NewPiecePage() {
  await requireManager();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink />
      <h1 className="text-4xl font-medium">Yeni eser</h1>
      <PieceForm
        action={createPiece}
        isNew
        submitLabel="Eseri kaydet"
        defaults={{
          title: "",
          composer: "",
          arranger: "",
          language: "",
          voicing: "",
          duration: "",
          status: "learning",
          driveFolderUrl: "",
          notes: "",
        }}
      />
    </div>
  );
}
