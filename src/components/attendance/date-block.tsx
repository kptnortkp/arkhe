import { formatDay, formatMonthShort, formatWeekdayShort } from "@/lib/time";
import { cn } from "@/lib/utils";

export function DateBlock({ date, concert }: { date: Date; concert?: boolean }) {
  return (
    <div
      className={cn(
        "flex w-14 shrink-0 flex-col items-center rounded-2xl py-2",
        concert ? "bg-plum text-stage-foreground" : "bg-muted",
      )}
    >
      <span className="text-[11px] tracking-[0.2em] uppercase opacity-70">
        {formatWeekdayShort.format(date).replace(".", "")}
      </span>
      <span className="font-heading text-2xl leading-tight font-medium">
        {formatDay.format(date)}
      </span>
      <span className="text-xs opacity-70">{formatMonthShort.format(date).replace(".", "")}</span>
    </div>
  );
}
