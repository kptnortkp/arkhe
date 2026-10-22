import { CircleCheck, MessageSquare } from "lucide-react";
import Link from "next/link";
import { UserAvatar } from "@/components/shell/user-menu";
import type { TicketCardData } from "@/lib/board/queries";
import { NOT_ON_BOARD, UNASSIGNED } from "@/lib/board/rules";
import { formatShortDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { MoveMenu } from "./move-menu";
import { DueLabel, UrgencyChip } from "./urgency-chip";

export function Assignee({
  assignee,
  size = "sm",
}: {
  assignee: TicketCardData["assignee"];
  size?: "sm" | "md";
}) {
  const avatar = size === "sm" ? "size-6 text-[10px]" : "size-8";
  if (!assignee) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span
          aria-hidden
          className={cn("shrink-0 rounded-full border border-dashed border-input", avatar)}
        />
        {UNASSIGNED}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar name={assignee.name} className={cn("shrink-0", avatar)} />
      <span className="truncate">
        {assignee.name}
        {!assignee.active && <span className="text-muted-foreground"> ({NOT_ON_BOARD})</span>}
      </span>
    </span>
  );
}

export function NewMarker() {
  return (
    <span
      aria-hidden
      data-testid="ticket-new"
      className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
    >
      <span aria-hidden className="size-2 rounded-full bg-gold" />
      Yeni
    </span>
  );
}

/** One card; the title link is stretched over the card, Taşı sits above it (no nested controls). */
export function TicketCard({
  ticket,
  today,
  query,
}: {
  ticket: TicketCardData;
  today: string;
  query: string;
}) {
  const done = ticket.status === "done";
  return (
    <li
      data-testid="ticket-card"
      data-number={ticket.number}
      data-status={ticket.status}
      data-urgency={ticket.urgency}
      data-new={ticket.isNew || undefined}
      className="relative space-y-2 rounded-2xl border bg-card p-3 pl-3.5 transition-colors hover:border-primary/30 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
        <span>#{ticket.number}</span>
        {ticket.isNew && <NewMarker />}
      </div>
      <h3 className="font-sans text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">
        <Link
          href={`/yonetim/${ticket.number}`}
          prefetch={false}
          className={cn(
            "line-clamp-2 outline-none after:absolute after:inset-0 after:rounded-2xl",
            done && "text-muted-foreground",
          )}
        >
          <span className="sr-only">#{ticket.number} </span>
          {ticket.title}
          {ticket.isNew && <span className="sr-only">, yeni</span>}
        </Link>
      </h3>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        {done ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <CircleCheck aria-hidden className="size-3.5 text-present-ink" />
            Bitti{ticket.doneAt && ` · ${formatShortDate.format(ticket.doneAt)}`}
          </span>
        ) : (
          <>
            <UrgencyChip urgency={ticket.urgency} />
            {ticket.dueOn && (
              <DueLabel dueOn={ticket.dueOn} overdue={ticket.overdue} today={today} />
            )}
          </>
        )}
        {ticket.commentCount > 0 && (
          <span data-testid="comment-count" className="inline-flex items-center gap-1 tabular-nums">
            <MessageSquare aria-hidden className="size-3.5" />
            {ticket.commentCount}
            <span className="sr-only"> yorum</span>
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <Assignee assignee={ticket.assignee} />
        <MoveMenu number={ticket.number} status={ticket.status} query={query} />
      </div>
    </li>
  );
}
