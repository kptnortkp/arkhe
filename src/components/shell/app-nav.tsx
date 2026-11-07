"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type NavItem } from "./nav-items";

/** `reports` is null for everyone but the issue-report handler. */
export type NavBadges = { homework: number; board: number; review: number; reports: number | null };
type BadgeKind = NonNullable<NavItem["badge"]> | "review";

/** The Ödevler entry shows the homework count, else the conductor's review count (never both). */
function kindOf(badge: NonNullable<NavItem["badge"]>, badges: NavBadges): BadgeKind {
  return badge === "homework" && badges.homework <= 0 && badges.review > 0 ? "review" : badge;
}

function Badge({
  kind,
  count,
  className,
}: {
  kind: BadgeKind;
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  // Separate attributes: older tests read the first [data-nav-badge] as the homework count.
  const data =
    kind === "homework"
      ? { "data-nav-badge": count }
      : kind === "review"
        ? { "data-review-badge": count }
        : kind === "reports"
          ? { "data-reports-badge": count }
          : { "data-board-badge": count };
  return (
    <span
      aria-hidden
      {...data}
      className={cn(
        "grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function badgeLabel(kind: BadgeKind, count: number) {
  if (count <= 0) return "";
  if (kind === "review") return `, ${count} kayıt asistan notuyla bekliyor`;
  if (kind === "reports") return `, ${count} açık sorun bildirimi`;
  return kind === "homework" ? `, ${count} bekleyen ödev` : `, ${count} yeni iş`;
}

const visible = (item: NavItem, canManage: boolean, badges: NavBadges) =>
  (canManage || !item.managersOnly) && (!item.handlerOnly || badges.reports !== null);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SidebarNav({ canManage, badges }: { canManage: boolean; badges: NavBadges }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Ana menü" className="flex flex-col gap-1">
      {NAV_ITEMS.filter((item) => visible(item, canManage, badges)).map(
        ({ href, label, icon: Icon, badge }) => (
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
            {badge && (
              <>
                <span className="sr-only">
                  {badgeLabel(kindOf(badge, badges), badges[kindOf(badge, badges)] ?? 0)}
                </span>
                <Badge
                  kind={kindOf(badge, badges)}
                  count={badges[kindOf(badge, badges)] ?? 0}
                  className="ml-auto"
                />
              </>
            )}
          </Link>
        ),
      )}
    </nav>
  );
}

export function BottomNav({ canManage, badges }: { canManage: boolean; badges: NavBadges }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => visible(item, canManage, badges) && !item.sidebarOnly);
  return (
    <nav
      aria-label="Ana menü"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map(({ href, label, shortLabel, icon: Icon, badge }) => {
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
                {badge && (
                  <Badge
                    kind={kindOf(badge, badges)}
                    count={badges[kindOf(badge, badges)] ?? 0}
                    className="absolute -top-1 left-[calc(50%+6px)]"
                  />
                )}
              </span>
              <span className="whitespace-nowrap max-[359px]:text-[10px]">
                {shortLabel ?? label}
                {badge && (
                  <span className="sr-only">
                    {badgeLabel(kindOf(badge, badges), badges[kindOf(badge, badges)] ?? 0)}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
