import { redirect } from "next/navigation";
import { Back } from "@/components/review/back";
import { EarlyClean } from "@/components/storage/early-clean";
import { formatStorage, StorageMeter } from "@/components/storage/meter";
import { StorageBanner } from "@/components/storage/storage-banner";
import { requireUser } from "@/lib/auth/dal";
import { isManager } from "@/lib/permissions";
import { storageGauge } from "@/lib/storage/gauge";
import { MSG } from "@/lib/storage/messages";
import { formatShortDateTime } from "@/lib/time";

export const metadata = { title: "Depolama" };

export default async function StoragePage() {
  const user = await requireUser();
  if (!isManager(user.role)) redirect("/odevler");
  const gauge = await storageGauge(user);
  const conductor = user.role === "conductor";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Back href="/odevler" label="Ödevler" />
        <h1 className="text-4xl font-medium">Depolama</h1>
        <p className="text-sm text-muted-foreground">
          Ücretsiz dosya alanının ne kadarını kullanıyoruz.
        </p>
      </div>
      <StorageBanner conductor={conductor && gauge.earlyClean !== null} />
      {gauge.configured ? (
        <div className="grid gap-3 md:grid-cols-2">
          {gauge.meters.map((m) => (
            <StorageMeter key={m.key} meter={m} />
          ))}
        </div>
      ) : (
        <div className="space-y-1 rounded-2xl border bg-muted/40 p-4" data-testid="storage-off">
          <p className="font-medium">{MSG.storageNotConfigured}</p>
          <p className="text-sm text-muted-foreground">
            Kayıt yükleme ve MIDI kapalı. Teknik sorumluya haber ver.
          </p>
        </div>
      )}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          Kayıtlar şef yorumundan 90 gün sonra, yorumsuz kayıtlar yüklendikten 120 gün sonra
          kendiliğinden silinir.
        </p>
        <p data-testid="last-sweep">
          {gauge.lastSweep
            ? `Son temizlik: ${formatShortDateTime.format(gauge.lastSweep.at)} · ${gauge.lastSweep.deleted} dosya silindi`
            : "Henüz temizlik yapılmadı."}
        </p>
        <p className="text-xs">
          Sayılar portalın kendi kayıtlarından hesaplanır; Vercel panelindeki değerlerle küçük
          farklar olabilir.
        </p>
      </div>
      {conductor && gauge.earlyClean && (
        <EarlyClean count={gauge.earlyClean.count} size={formatStorage(gauge.earlyClean.bytes)} />
      )}
    </div>
  );
}
