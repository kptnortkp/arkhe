import { CircleAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { storageWarning } from "@/lib/storage/quota";
import { cn } from "@/lib/utils";

/** Managers only (the caller checks): 80% warns, 95% (uploads) or 100% (playback) is full. */
export async function StorageBanner({ conductor = false }: { conductor?: boolean }) {
  const w = await storageWarning();
  if (!w.warn) return null;
  const Icon = w.full ? CircleAlert : TriangleAlert;
  return (
    <div
      role="status"
      data-testid="storage-banner"
      data-level={w.full ? "full" : "warn"}
      className={cn(
        "flex gap-3 rounded-2xl border p-4",
        w.full ? "border-absent/40 bg-absent/10" : "border-late/40 bg-late/10",
      )}
    >
      <Icon className={cn("size-5 shrink-0", w.full ? "text-absent-ink" : "text-late-ink")} aria-hidden />
      <div className="space-y-1 text-sm">
        <p>
          {w.full
            ? "Kayıt alanı dolu; yeni kayıt alınmıyor."
            : `Kayıt alanı %${w.pct} dolu. Depolama sayfasına bak.`}
        </p>
        {conductor && (
          <p className="text-muted-foreground">
            Yorumlanmış eski kayıtları silerek yer açabilirsin.
          </p>
        )}
        <Link
          href={conductor ? "/odevler/depolama#yer-ac" : "/odevler/depolama"}
          className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
        >
          Depolama
        </Link>
      </div>
    </div>
  );
}
