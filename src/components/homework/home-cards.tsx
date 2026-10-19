import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { managerBadge } from "@/lib/homework/deadline";
import { barsLabel } from "@/lib/homework/mail";
import { listForManager, listForSinger, type Viewer } from "@/lib/homework/queries";
import { cn } from "@/lib/utils";
import { DeadlineChip, DueLine } from "./deadline-chip";
import { PartCounts, SingerRow } from "./homework-rows";

function CardHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="text-2xl font-medium">{title}</h2>
      <Link
        href={href}
        className="-my-2 inline-flex min-h-11 items-center gap-0.5 px-1 text-sm font-medium text-primary hover:underline"
      >
        {linkLabel}
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}

/** The singer's most urgent unsubmitted homework (overdue first); hidden when none. */
export async function MyHomeworkCard({ viewer, at }: { viewer: Viewer; at: Date }) {
  const open = (await listForSinger(viewer, "guncel", at)).filter(
    (r) => r.eligible && !r.submittedAt && r.expected,
  );
  if (open.length === 0) return null;
  return (
    <section className="space-y-4" data-testid="home-homework">
      <CardHeader title="Ödevlerim" href="/odevler" linkLabel="Tümü" />
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        <SingerRow row={open[0]} at={at} />
        {open.length > 1 && (
          <li>
            <Link
              href="/odevler"
              className="flex min-h-11 items-center px-4 text-sm font-medium text-primary hover:underline"
            >
              +{open.length - 1} ödev daha
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

export async function ManagerHomeworkCard({ at }: { at: Date }) {
  const next = (await listForManager("guncel", at)).find((r) => r.dueAt > at);
  return (
    <section className="space-y-4" data-testid="home-manager-homework">
      <CardHeader title="Ödevler" href="/odevler" linkLabel="Tümü" />
      {next ? (
        <Link
          href={`/odevler/${next.id}#teslimler`}
          className="block space-y-1.5 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30"
        >
          <span className="block font-medium">
            {next.pieceTitle} · {barsLabel(next.barFrom, next.barTo)}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DeadlineChip badge={managerBadge(next.dueAt, at)} />
            <DueLine dueAt={next.dueAt} />
          </span>
          <span className="block text-sm tabular-nums" data-testid="home-homework-count">
            {next.counts.done}/{next.counts.total} teslim
          </span>
          <PartCounts counts={next.counts.perPart} />
        </Link>
      ) : (
        <div className="space-y-3 rounded-2xl border border-dashed bg-card px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">Açık ödev yok.</p>
          <Link href="/odevler/yeni" className={cn(buttonVariants(), "h-11 rounded-full px-5")}>
            Ödev ver
          </Link>
        </div>
      )}
    </section>
  );
}
