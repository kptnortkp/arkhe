import type { Meter } from "@/lib/storage/quota";
import { cn } from "@/lib/utils";

const NAMES = {
  storage: ["Depolama", "Saklanan kayıtlar ve MIDI dosyaları"],
  uploads: ["Yükleme", "Son 30 gün"],
  transfer: ["Aktarım", "Son 30 gün, tahmini"],
  reads: ["Okuma", "Son 30 gün"],
} as const;

const number = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** Decimal units, as Vercel counts: "820 MB", "1,2 GB". */
export function formatStorage(bytes: number) {
  if (bytes >= 1e9) return `${number.format(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${number.format(bytes / 1e6)} MB`;
  return `${number.format(Math.max(0, Math.round(bytes / 1e3)))} KB`;
}

function amount(m: Meter) {
  if (m.key === "storage" || m.key === "transfer") {
    return `${formatStorage(m.used)} / ${formatStorage(m.limit)}`;
  }
  return `${number.format(m.used)} / ${number.format(m.limit)} işlem`;
}

export function StorageMeter({ meter, extra }: { meter: Meter; extra?: React.ReactNode }) {
  const [name, help] = NAMES[meter.key];
  const id = `meter-${meter.key}`;
  const text = amount(meter);
  const word =
    meter.state === "full"
      ? meter.key === "storage" || meter.key === "uploads"
        ? "Dolu: yükleme kapalı"
        : "Dolu: dinleme kapalı"
      : meter.state === "warn"
        ? "Dolmak üzere"
        : "Sorun yok";
  return (
    <div className="space-y-2.5 rounded-2xl border bg-card p-4" data-testid="storage-meter" data-key={meter.key} data-state={meter.state}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id={id} className="font-medium">
            {name}
          </p>
          <p className="text-xs text-muted-foreground">{help}</p>
        </div>
        <p className="font-heading text-xl tabular-nums">%{meter.pct}</p>
      </div>
      <div
        role="meter"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, meter.pct)}
        aria-valuetext={`${text}, yüzde ${meter.pct}`}
        className="h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full",
            meter.state === "full" ? "bg-absent" : meter.state === "warn" ? "bg-late" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, Math.max(meter.used > 0 ? 1 : 0, meter.pct))}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-sm tabular-nums">
        <span data-testid="meter-value">{text}</span>
        <span
          className={cn(
            meter.state === "ok"
              ? "text-muted-foreground"
              : meter.state === "warn"
                ? "font-medium text-late-ink"
                : "font-medium text-absent-ink",
          )}
        >
          {word}
        </span>
      </div>
      {extra}
    </div>
  );
}
