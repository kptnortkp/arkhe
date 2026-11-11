import { createFestival } from "@/app/(portal)/yonetim/festivaller/actions";
import { BackLink } from "@/components/board/back-link";
import { FestivalForm } from "@/components/festivals/festival-form";
import { requireManager } from "@/lib/auth/dal";

export const metadata = { title: "Yeni festival" };

export default async function NewFestivalPage() {
  await requireManager();
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href="/yonetim/festivaller">Festivallere dön</BackLink>
        <h1 className="text-3xl font-medium">Yeni festival</h1>
        <p className="text-sm text-muted-foreground">
          Yalnızca ad ve Türkiye / yurt dışı seçimi gerekli.
        </p>
      </div>
      <FestivalForm
        action={createFestival}
        clientId={crypto.randomUUID()}
        cancelHref="/yonetim/festivaller"
        defaults={{
          name: "",
          region: "",
          status: "watching",
          startsOn: "",
          endsOn: "",
          dateNote: "",
          deadlineOn: "",
          deadlineNote: "",
          fee: "",
          place: "",
          url: "",
          linkLabel: "",
          note: "",
        }}
      />
    </div>
  );
}
