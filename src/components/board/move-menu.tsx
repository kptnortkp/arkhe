"use client";

import {
  ArrowLeftRight,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { moveTicket } from "@/app/(portal)/yonetim/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SUTUN_SLUGS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketStatus,
} from "@/lib/board/labels";
import { TICKET_STALE } from "@/lib/board/rules";
import { cn } from "@/lib/utils";

export const STATUS_ICONS: Record<TicketStatus, { icon: LucideIcon; className?: string }> = {
  todo: { icon: Circle },
  in_progress: { icon: CircleDot },
  blocked: { icon: CircleAlert, className: "text-late-ink" },
  done: { icon: CircleCheck, className: "text-present-ink" },
};

/** Toast for a failed board write; the stale refusal offers Yenile (D28). */
export function boardError(message: string, refresh: () => void) {
  toast.error(
    message,
    message === TICKET_STALE ? { action: { label: "Yenile", onClick: refresh } } : undefined,
  );
}

/** Taşı on a card, or the detail page's "Durum: <değer>" button: the same menu and action (D27). */
export function MoveMenu({
  number,
  status,
  variant = "card",
  query = "",
}: {
  number: number;
  status: TicketStatus;
  variant?: "card" | "detail";
  // The board's kim/aciliyet query, kept by the toast's Göster link.
  query?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const Current = STATUS_ICONS[status];

  function move(to: TicketStatus) {
    // On a card the trigger leaves with the card: focus the neighbour, else the column's visible label.
    const li = triggerRef.current?.closest("li");
    const tab = document.querySelector<HTMLElement>('nav[aria-label="Sütunlar"] a[aria-current]');
    const next =
      li?.nextElementSibling?.querySelector<HTMLElement>("a") ??
      li?.previousElementSibling?.querySelector<HTMLElement>("a") ??
      (tab?.offsetParent ? tab : li?.closest("section")?.querySelector<HTMLElement>("h2"));
    startTransition(async () => {
      let result;
      try {
        result = await moveTicket({ number, from: status, to });
      } catch {
        result = { error: "Bir şeyler ters gitti, tekrar dene." };
      }
      if (result.error) {
        boardError(result.error, () => router.refresh());
        return;
      }
      const params = new URLSearchParams(query);
      params.set("sutun", SUTUN_SLUGS[to]);
      toast.success(result.success, {
        action: { label: "Göster", onClick: () => router.push(`/yonetim?${params}`) },
      });
      if (variant === "card") next?.focus();
      else triggerRef.current?.focus();
      router.refresh();
    });
  }

  return (
    // Not `disabled` while pending: a disabled trigger would drop the focus to <body>.
    <DropdownMenu open={open} onOpenChange={(o) => setOpen(o && !pending)}>
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-disabled={pending || undefined}
        render={
          <Button
            variant="outline"
            aria-label={variant === "card" ? `#${number} taşı` : undefined}
            className={cn(
              "relative z-10 h-11 gap-1.5 rounded-full",
              variant === "card"
                ? "px-3 xl:w-11 xl:gap-0 xl:px-0"
                : "px-4 lg:col-span-2 lg:w-full lg:justify-start",
            )}
          />
        }
      >
        {pending ? (
          <Loader2 aria-hidden className="animate-spin" />
        ) : (
          variant === "detail" && (
            <Current.icon aria-hidden className={cn("size-4", Current.className)} />
          )
        )}
        {variant === "card" ? (
          // Narrow columns at xl: icon only, the aria-label still names it.
          <span className="xl:hidden">Taşı</span>
        ) : (
          `Durum: ${TICKET_STATUS_LABELS[status]}`
        )}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 text-muted-foreground",
            variant === "card" ? "xl:hidden" : "lg:ml-auto",
          )}
        />
        {variant === "card" && !pending && (
          <ArrowLeftRight aria-hidden className="hidden size-4 xl:block" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Şuraya taşı</DropdownMenuLabel>
          {TICKET_STATUSES.filter((s) => s !== status).map((s) => {
            const { icon: Icon, className } = STATUS_ICONS[s];
            return (
              <DropdownMenuItem key={s} className="min-h-11" onClick={() => move(s)}>
                <Icon aria-hidden className={className} />
                {TICKET_STATUS_LABELS[s]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
