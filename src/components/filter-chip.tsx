import Link from "next/link";
import { cn } from "@/lib/utils";

export function FilterChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "tabular-nums",
            active ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
