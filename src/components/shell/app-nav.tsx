"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      data-nav-badge={count}
      className={cn(
        "grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

const badgeLabel = (count: number) => (count > 0 ? `, ${count} bekleyen ödev` : "");

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SidebarNav({ canManage, homework }: { canManage: boolean; homework: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Ana menü" className="flex flex-col gap-1">
      {NAV_ITEMS.filter((item) => canManage || !item.managersOnly).map(
        ({ href, label, icon: Icon, homeworkBadge }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isActive(pathname, href) && "bg-sidebar-accent text-sidebar-foreground",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.8} />
            {label}
            {homeworkBadge && (
              <>
                <span className="sr-only">{badgeLabel(homework)}</span>
                <Badge count={homework} className="ml-auto" />
              </>
            )}
          </Link>
        ),
      )}
    </nav>
  );
}

export function BottomNav({ canManage, homework }: { canManage: boolean; homework: number }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => (canManage || !item.managersOnly) && !item.sidebarOnly);
  return (
    <nav
      aria-label="Ana menü"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map(({ href, label, icon: Icon, homeworkBadge }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors",
                active && "text-primary",
              )}
            >
              <span
                className={cn(
                  "relative grid h-7 w-12 place-items-center rounded-full transition-colors",
                  active && "bg-primary/10",
                )}
              >
                <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                {homeworkBadge && (
                  <Badge count={homework} className="absolute -top-1 left-[calc(50%+6px)]" />
                )}
              </span>
              <span className="whitespace-nowrap max-[359px]:text-[10px]">
                {label}
                {homeworkBadge && <span className="sr-only">{badgeLabel(homework)}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
