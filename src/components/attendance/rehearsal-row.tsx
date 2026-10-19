import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import type { AttendanceStatus } from "@/db/schema";
import { phaseOf, rehearsalTitle, type Rehearsal } from "@/lib/attendance/rehearsals";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DateBlock } from "./date-block";
import { StatusChip, TypeChip } from "./status-chip";

export function RehearsalRow({
  rehearsal: r,
  myStatus,
  expected,
  showMine,
}: {
  rehearsal: Rehearsal;
  myStatus?: AttendanceStatus | null;
  expected?: boolean;
  showMine: boolean;
}) {
  const phase = phaseOf(r);
  return (
    <Link
      href={`/calismalar/${r.id}`}
      className={cn(
        "flex min-h-20 items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/60",
        phase === "cancelled" && "opacity-60",
      )}
    >
      <DateBlock date={r.startsAt} concert={r.type === "concert"} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn("truncate font-medium", phase === "cancelled" && "line-through")}>
          {rehearsalTitle(r)}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {formatTime.format(r.startsAt)}–{formatTime.format(r.endsAt)}
          </span>
          {r.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{r.location}</span>
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeChip type={r.type} parts={r.parts} />
          {phase === "cancelled" && (
            <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              İptal edildi
            </span>
          )}
          {phase === "open" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-gold" />
              Yoklama açık
            </span>
          )}
          {phase === "untaken" && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              Yoklama alınmadı
            </span>
          )}
          {showMine && phase !== "cancelled" && expected === false && (
            <span className="text-xs text-muted-foreground">Senin partisyonun değil</span>
          )}
          {showMine && expected !== false && myStatus && <StatusChip status={myStatus} />}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
