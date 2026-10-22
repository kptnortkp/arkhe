import { SquareKanban } from "lucide-react";
import Link from "next/link";
import { BoardColumn } from "@/components/board/board-column";
import { BoardControls, BoardHeader } from "@/components/board/board-controls";
import { filterQuery } from "@/components/board/hrefs";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import { parseBoardFilters, TICKET_STATUSES } from "@/lib/board/labels";
import { getBoard } from "@/lib/board/queries";
import { istanbulDateOf, now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Yönetim Kurulu" };

export default async function BoardPage({ searchParams }: PageProps<"/yonetim">) {
  const viewer = await requireManager();
  const filters = parseBoardFilters(await searchParams);
  const board = await getBoard(filters);
  const today = istanbulDateOf(now());

  if (!board.anyTickets) {
    return (
      <div className="space-y-4 lg:space-y-5">
        <BoardHeader column={filters.column} />
        <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <SquareKanban aria-hidden className="mx-auto size-8 text-muted-foreground" />
          <p className="font-medium">Panoda henüz iş yok.</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Kurulun yapacağı işleri buraya yaz. Her işin bir numarası olur; WhatsApp&apos;ta “12
            numaralı iş” diye paylaşabilirsin.
          </p>
          <Link href="/yonetim/yeni" className={cn(buttonVariants(), "h-11 rounded-full px-5")}>
            Yeni iş
          </Link>
        </div>
      </div>
    );
  }

  const shown = TICKET_STATUSES.flatMap((s) => board.columns[s]);
  const mine = shown.filter((t) => t.assignee?.id === viewer.id && t.status !== "done").length;
  const filtered = filters.kim === "ben" || filters.urgency !== null;
  const query = filterQuery(filters);

  return (
    <div className="space-y-4 lg:space-y-5">
      <BoardControls
        column={filters.column}
        counts={board.counts}
        filters={{ kim: filters.kim, urgency: filters.urgency }}
        mine={mine}
      >
        {TICKET_STATUSES.map((s) => (
          <BoardColumn
            key={s}
            status={s}
            tickets={board.columns[s]}
            count={board.counts[s]}
            filtered={filtered}
            today={today}
            query={query}
          />
        ))}
      </BoardControls>
    </div>
  );
}
