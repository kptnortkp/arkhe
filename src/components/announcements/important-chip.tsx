import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function ImportantChip({ className }: { className?: string }) {
  return (
    <span
      data-testid="announcement-important"
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-absent px-2 text-xs font-semibold text-absent-foreground",
        className,
      )}
    >
      <TriangleAlert aria-hidden className="size-3.5" />
      Önemli
    </span>
  );
}
