import { formatNet } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Profit or loss in words, sign and colour: "Kâr ₺4.200,00" / "Zarar −₺800,00". */
export function NetLabel({
  net,
  empty = false,
  className,
}: {
  net: number;
  empty?: boolean;
  className?: string;
}) {
  if (empty) return <span className={cn("text-muted-foreground", className)}>Hareket yok</span>;
  return (
    <span
      data-testid="pl-result"
      data-kurus={net}
      className={cn(
        "font-sans whitespace-nowrap tabular-nums",
        net < 0 ? "text-absent-ink" : "text-present-ink",
        className,
      )}
    >
      {net < 0 ? "Zarar" : "Kâr"} {formatNet(net)}
    </span>
  );
}
