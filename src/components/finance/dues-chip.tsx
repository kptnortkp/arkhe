import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, Clock } from "lucide-react";
import type { DuesStatus } from "@/lib/finance/dues";
import { cn } from "@/lib/utils";

const LOOK = {
  exempt: { className: "bg-muted text-muted-foreground", icon: CircleMinus },
  paid: { className: "bg-muted text-foreground", icon: CircleCheck },
  partial: { className: "bg-late/18 text-late-ink", icon: CircleDashed },
  unpaid: { className: "bg-late/18 text-late-ink", icon: Clock },
  overdue: { className: "bg-absent/12 text-absent-ink", icon: CircleAlert },
};

/** `solid` is the singer's own late period: a fill tells it apart without relying on hue. */
export function DuesChip({ status, solid = false }: { status: DuesStatus; solid?: boolean }) {
  const look = LOOK[status.state];
  const Icon = look.icon;
  return (
    <span
      data-testid="dues-status"
      data-tone={status.tone}
      data-state={status.state}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums",
        solid && status.state === "overdue" ? "bg-absent text-absent-foreground" : look.className,
      )}
    >
      <Icon className={cn("size-3.5", status.state === "paid" && "text-present-ink")} aria-hidden />
      {status.label}
    </span>
  );
}
