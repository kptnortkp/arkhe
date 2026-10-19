import { Banknote, CircleAlert, Landmark } from "lucide-react";
import { MoneyAmount } from "./money-amount";

function NegativeChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-absent/12 px-2 py-0.5 text-xs font-medium text-absent-ink">
      <CircleAlert className="size-3.5" aria-hidden />
      Eksi bakiye
    </span>
  );
}

export function BalanceTiles({ cash, bank, total }: { cash: number; bank: number; total: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="on-stage col-span-2 space-y-1 rounded-3xl bg-stage p-5 text-stage-foreground">
        <p className="text-xs font-medium tracking-[0.2em] text-stage-foreground/70 uppercase">
          Toplam bakiye
        </p>
        <p data-testid="balance-total" data-kurus={total} className="text-4xl font-semibold">
          <MoneyAmount kurus={total} kind="balance" />
        </p>
        {total < 0 && <NegativeChip />}
      </div>
      {(
        [
          ["cash", "Kasa", Banknote, cash],
          ["bank", "Banka", Landmark, bank],
        ] as const
      ).map(([key, label, Icon, value]) => (
        <div key={key} className="min-w-0 space-y-1 rounded-2xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Icon className="size-4" aria-hidden />
            {label}
          </p>
          <p
            data-testid={`balance-${key}`}
            data-kurus={value}
            className="text-2xl font-semibold [overflow-wrap:anywhere]"
          >
            <MoneyAmount kurus={value} kind="balance" className="whitespace-normal" />
          </p>
          {value < 0 && <NegativeChip />}
        </div>
      ))}
    </div>
  );
}
