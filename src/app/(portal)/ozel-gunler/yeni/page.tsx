import { createSpecialDay } from "@/app/(portal)/ozel-gunler/actions";
import { BackLink } from "@/components/board/back-link";
import { SpecialDayForm } from "@/components/festivals/special-day-form";
import { requireManager } from "@/lib/auth/dal";
import { istanbulDateOf, now } from "@/lib/time";

export const metadata = { title: "Yeni özel gün" };

export default async function NewSpecialDayPage({ searchParams }: PageProps<"/ozel-gunler/yeni">) {
  await requireManager();
  const { tarih } = await searchParams;
  const day =
    typeof tarih === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tarih) ? tarih : istanbulDateOf(now());
  const back = `/ozel-gunler?yil=${day.slice(0, 4)}`;
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <BackLink href={back}>Özel günlere dön</BackLink>
        <h1 className="text-3xl font-medium">Yeni özel gün</h1>
        <p className="text-sm text-muted-foreground">Tüm koristler görür.</p>
      </div>
      <SpecialDayForm
        action={createSpecialDay}
        clientId={crypto.randomUUID()}
        cancelHref={back}
        defaults={{ day, title: "", kind: "" }}
      />
    </div>
  );
}
