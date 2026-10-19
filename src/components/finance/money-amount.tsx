import { formatKurus, formatNet, formatSigned } from "@/lib/money";
import { cn } from "@/lib/utils";

export type MoneyKind = "income" | "expense" | "transfer" | "opening" | "balance";

const SR: Partial<Record<MoneyKind, string>> = {
  income: "Gelir ",
  expense: "Gider ",
  transfer: "Virman ",
  opening: "Açılış bakiyesi ",
};

/** Signs are text (+ / −), colour is extra; expenses are not red, negative balances are. */
export function MoneyAmount({
  kurus,
  kind,
  className,
}: {
  kurus: number;
  kind: MoneyKind;
  className?: string;
}) {
  const text =
    kurus === 0
      ? formatKurus(0)
      : kind === "income"
        ? formatSigned(kurus, "in")
        : kind === "expense"
          ? formatSigned(kurus, "out")
          : kind === "balance"
            ? formatNet(kurus)
            : formatKurus(kurus);
  return (
    <span
      data-testid="money"
      data-kind={kind}
      data-kurus={kind === "expense" ? -kurus : kurus}
      className={cn(
        "font-sans whitespace-nowrap tabular-nums",
        kind === "income" && "text-present-ink",
        (kind === "transfer" || kind === "opening") && "text-muted-foreground",
        kind === "balance" && kurus < 0 && "text-absent-ink",
        className,
      )}
    >
      {SR[kind] && <span className="sr-only">{SR[kind]}</span>}
      {text}
    </span>
  );
}
