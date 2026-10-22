import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The 1-based ?sayfa= value; anything else is page 1. */
export function pageParam(value: string | string[] | undefined) {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
}

/** Daha yeni / Daha eski links; the one that doesn't apply isn't rendered. */
export function Pager({
  page,
  hasMore,
  href,
  label,
  status,
}: {
  page: number;
  hasMore: boolean;
  href: (page: number) => string;
  label: string;
  status?: string;
}) {
  if (page === 1 && !hasMore) return null;
  const link = cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-4");
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={link}>
          <ChevronLeft aria-hidden />
          Daha yeni
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground tabular-nums">{status ?? `Sayfa ${page}`}</span>
      {hasMore ? (
        <Link href={href(page + 1)} rel="next" className={link}>
          Daha eski
          <ChevronRight aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
