"use client";

import { Archive, Check, ChevronDown, Plus, Users, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FilterChip } from "@/components/filter-chip";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SUTUN_SLUGS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_URGENCIES,
  URGENCY_LABELS,
  URGENCY_RANK,
  statusFromSlug,
  type TicketStatus,
} from "@/lib/board/labels";
import { cn } from "@/lib/utils";
import { boardHref, type Filters } from "./hrefs";

export function BoardHeader({ column }: { column: TicketStatus }) {
  const link =
    "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline";
  return (
    <div className="space-y-1">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-4xl font-medium">Yönetim Kurulu</h1>
        <Link
          href={`/yonetim/yeni?sutun=${SUTUN_SLUGS[column]}`}
          className={cn(buttonVariants(), "h-11 shrink-0 rounded-full px-4")}
        >
          <Plus />
          Yeni iş
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/yonetim/arsiv" className={link}>
          <Archive aria-hidden className="size-4" />
          Arşiv
        </Link>
        <span aria-hidden className="text-muted-foreground md:hidden">
          ·
        </span>
        <Link href="/uyeler" className={cn(link, "md:hidden")}>
          <Users aria-hidden className="size-4" />
          Üyeler
        </Link>
      </div>
    </div>
  );
}

/**
 * Column tabs (below xl) and filters. All four columns arrive server-rendered as children;
 * a tab switch only flips `data-column` and replaces the URL, so it is instant and survives a reload.
 */
export function BoardControls({
  column,
  counts,
  filters,
  mine,
  children,
}: {
  column: TicketStatus;
  counts: Record<TicketStatus, number>;
  filters: Filters;
  // My open tickets under the current urgency filter.
  mine: number;
  children: React.ReactNode;
}) {
  // The URL is the truth: a tab's replaceState and any navigation (Göster, the bottom bar) update it.
  const selected = statusFromSlug(useSearchParams().get("sutun")) ?? column;
  const href = (patch: Partial<Filters>) => boardHref(selected, { ...filters, ...patch });
  const urgencies = [...TICKET_URGENCIES].sort((a, b) => URGENCY_RANK[a] - URGENCY_RANK[b]);

  return (
    <>
      <BoardHeader column={selected} />

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Kişi" className="flex gap-2">
          <FilterChip
            href={href({ kim: "herkes" })}
            active={filters.kim === "herkes"}
            label="Herkes"
          />
          <FilterChip
            href={href({ kim: "ben" })}
            active={filters.kim === "ben"}
            label="Bana atananlar"
            count={mine}
          />
        </nav>
        <span aria-hidden className="mx-1 hidden h-6 w-px bg-border lg:block" />
        <nav aria-label="Aciliyet" className="hidden gap-2 lg:flex">
          <FilterChip href={href({ urgency: null })} active={!filters.urgency} label="Tümü" />
          {urgencies.map((u) => (
            <FilterChip
              key={u}
              href={href({ urgency: u })}
              active={filters.urgency === u}
              label={URGENCY_LABELS[u]}
            />
          ))}
        </nav>
        <div className="flex items-center gap-1 lg:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filters.urgency
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted",
              )}
            >
              Aciliyet: {filters.urgency ? URGENCY_LABELS[filters.urgency] : "Tümü"}
              <ChevronDown aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              {[null, ...urgencies].map((u) => {
                const active = filters.urgency === u;
                return (
                  <DropdownMenuItem
                    key={u ?? "all"}
                    className="min-h-11"
                    render={
                      <Link
                        href={href({ urgency: u })}
                        aria-current={active ? "page" : undefined}
                      />
                    }
                  >
                    <Check aria-hidden className={cn(!active && "invisible")} />
                    {u ? URGENCY_LABELS[u] : "Tümü"}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {filters.urgency && (
            <Link
              href={href({ urgency: null })}
              aria-label="Aciliyet filtresini kaldır"
              className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      </div>

      <nav
        aria-label="Sütunlar"
        className="grid grid-cols-4 gap-1 rounded-2xl bg-muted p-1 xl:hidden"
      >
        {TICKET_STATUSES.map((s) => {
          const active = s === selected;
          return (
            <a
              key={s}
              href={boardHref(s, filters)}
              aria-current={active ? "true" : undefined}
              data-status={s}
              data-count={counts[s]}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                window.history.replaceState(null, "", boardHref(s, filters));
              }}
              className={cn(
                "flex min-h-13 flex-col items-center justify-center rounded-xl px-1 py-1.5 text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active && "bg-card font-semibold text-foreground shadow-sm dark:bg-background",
              )}
            >
              <span
                aria-hidden
                className="flex items-center gap-1 text-lg leading-tight tabular-nums"
              >
                {s === "blocked" && counts[s] > 0 && (
                  <span className="size-1.5 rounded-full bg-late" />
                )}
                {counts[s]}
              </span>
              <span aria-hidden className="text-xs whitespace-nowrap">
                {TICKET_STATUS_LABELS[s]}
              </span>
              <span className="sr-only">
                {TICKET_STATUS_LABELS[s]}, {counts[s]} iş
              </span>
            </a>
          );
        })}
      </nav>

      <div
        className="group/board xl:grid xl:grid-cols-4 xl:items-start xl:gap-3"
        data-column={SUTUN_SLUGS[selected]}
      >
        {children}
      </div>
    </>
  );
}
