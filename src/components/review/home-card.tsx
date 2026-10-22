import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { Role } from "@/db/schema";
import { effectiveScope } from "@/lib/review/access";
import {
  assistantQueue,
  conductorCounts,
  conductorQueue,
  firstToReview,
} from "@/lib/review/queries";
import { loadScope } from "@/lib/review/scope";
import { cn } from "@/lib/utils";
import { reviewHref } from "./queue";

/** Home `Dinleme`: the conductor always (weekly job), an assistant only with work waiting. */
export async function ReviewHomeCard({ user }: { user: { id: string; role: Role } }) {
  let line: string;
  let extra: string | null = null;
  let start: string | null = null;
  if (user.role === "conductor") {
    const [waiting, counts] = await Promise.all([
      conductorQueue("bekleyen").then((q) => q.rows),
      conductorCounts(),
    ]);
    const noted = waiting.filter((r) => r.noteCount > 0);
    line = counts.waiting
      ? `${counts.waiting} kayıt dinlenmeyi bekliyor · ${counts.noted} asistan notlu`
      : counts.noAudio
        ? "Dinlenmeyi bekleyen kayıt yok."
        : "Yorum bekleyen kayıt yok.";
    if (counts.noAudio) extra = `${counts.noAudio} teslimde portalda kayıt yok.`;
    const firstNoted = firstToReview(noted);
    const first = firstNoted ?? firstToReview(waiting);
    start = first ? reviewHref(first, firstNoted ? "asistan-notlu" : "bekleyen") : null;
  } else {
    const scope = effectiveScope(user, await loadScope(user.id));
    if (scope.length === 0) return null;
    const todo = await assistantQueue(user, scope, "dinlenecek");
    if (todo.length === 0) return null;
    line = `Dinleme kuyruğun: ${todo.length} kayıt`;
    start = reviewHref(todo[0], "dinlenecek");
  }
  return (
    <section className="space-y-4" data-testid="home-review">
      <div className="flex items-end justify-between">
        <h2 className="text-2xl font-medium">Dinleme</h2>
        <Link
          href="/odevler/dinle"
          className="-my-2 inline-flex min-h-11 items-center gap-0.5 px-1 text-sm font-medium text-primary hover:underline"
        >
          Kuyruk
          <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <p
          className={cn("text-sm tabular-nums", !start && "text-muted-foreground")}
          data-testid="home-review-line"
        >
          {line}
        </p>
        {extra && (
          <p className="-mt-2 text-xs text-muted-foreground" data-testid="home-review-extra">
            {extra}
          </p>
        )}
        {start && (
          <Link href={start} className={cn(buttonVariants(), "h-12 w-full rounded-2xl text-base md:w-auto md:px-6")}>
            <Play />
            Dinlemeye başla
          </Link>
        )}
      </div>
    </section>
  );
}
