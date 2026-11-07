import type { IssueStatus } from "@/db/schema";
import { ISSUE_STATUS_LABELS, ISSUE_STATUS_STYLES } from "@/lib/reports/labels";
import { cn } from "@/lib/utils";

export function IssueStatusChip({ status, className }: { status: IssueStatus; className?: string }) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        ISSUE_STATUS_STYLES[status],
        className,
      )}
    >
      {ISSUE_STATUS_LABELS[status]}
    </span>
  );
}
