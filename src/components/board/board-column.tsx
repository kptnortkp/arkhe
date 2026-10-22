import { Archive } from "lucide-react";
import Link from "next/link";
import type { TicketCardData } from "@/lib/board/queries";
import { SUTUN_SLUGS, TICKET_STATUS_LABELS, type TicketStatus } from "@/lib/board/labels";
import { cn } from "@/lib/utils";
import { TicketCard } from "./ticket-card";

// Static class names keyed by URL slug, so Tailwind sees each one: below xl only the selected column shows.
const SHOW: Record<TicketStatus, string> = {
  todo: "max-xl:group-data-[column=yapilacak]/board:block",
  in_progress: "max-xl:group-data-[column=devam]/board:block",
  blocked: "max-xl:group-data-[column=takildi]/board:block",
  done: "max-xl:group-data-[column=bitti]/board:block",
};

export function BoardColumn({
  status,
  tickets,
  count,
  filtered,
  today,
  query,
}: {
  status: TicketStatus;
  tickets: TicketCardData[];
  count: number;
  filtered: boolean;
  today: string;
  query: string;
}) {
  const id = `sutun-${SUTUN_SLUGS[status]}`;
  return (
    <section
      aria-labelledby={id}
      data-status={status}
      className={cn(
        "max-xl:hidden xl:space-y-2 xl:rounded-2xl xl:bg-muted/50 xl:p-2",
        SHOW[status],
      )}
    >
      <h2
        id={id}
        tabIndex={-1}
        className="flex justify-between px-1.5 py-1 font-sans text-sm font-semibold outline-none max-xl:sr-only"
      >
        {TICKET_STATUS_LABELS[status]}
        <span className="flex items-center gap-1.5">
          {status === "blocked" && count > 0 && (
            <span aria-hidden className="size-1.5 rounded-full bg-late" />
          )}
          <span data-count={count} className="text-muted-foreground tabular-nums">
            {count}
          </span>
        </span>
      </h2>
      {tickets.length > 0 ? (
        <ul className="flex flex-col gap-3 xl:gap-2">
          {tickets.map((t) => (
            <TicketCard key={t.number} ticket={t} today={today} query={query} />
          ))}
        </ul>
      ) : filtered ? (
        <div className="space-y-1 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          <p>Bu filtreye uyan iş yok.</p>
          <Link
            href={`/yonetim?sutun=${SUTUN_SLUGS[status]}`}
            className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
          >
            Filtreleri temizle
          </Link>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          Bu sütunda iş yok.
        </p>
      )}
      {status === "done" && (
        <Link
          href="/yonetim/arsiv"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 px-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Archive aria-hidden className="size-4" />
          Arşiv: 30 günden eski işler
        </Link>
      )}
    </section>
  );
}
