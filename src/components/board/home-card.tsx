import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { boardSummary } from "@/lib/board/queries";
import { UrgencyChip } from "./urgency-chip";

const more =
  "-my-2 inline-flex min-h-11 items-center gap-0.5 px-1 text-sm font-medium text-primary hover:underline";

/** Managers only: my open board tickets, right under the hero (D22). */
export async function BoardHomeCard() {
  const s = await boardSummary();
  if (!s) return null;
  return (
    <section
      className="space-y-4"
      data-testid="home-board"
      data-open={s.open}
      data-new={s.fresh}
      data-urgent={s.urgent}
    >
      <div className="flex items-end justify-between">
        <h2 className="text-2xl font-medium">Yönetim Kurulu</h2>
        <Link href="/yonetim" className={more}>
          Pano
          <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="space-y-1 rounded-2xl border bg-card p-4">
        {s.open > 0 ? (
          <>
            <Link
              href="/yonetim?kim=ben"
              data-testid="home-board-summary"
              className="block py-2.5 text-lg font-medium hover:underline"
            >
              Sana atanan <span className="tabular-nums">{s.open}</span> açık iş
              {s.fresh > 0 && (
                <span className="text-primary">
                  {" "}
                  ·{" "}
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full bg-gold align-middle"
                  />{" "}
                  {s.fresh} yeni
                </span>
              )}
              {s.urgent > 0 && <span className="text-absent-ink"> · {s.urgent} acil</span>}
            </Link>
            {s.top && (
              <Link
                href={`/yonetim/${s.top.number}`}
                prefetch={false}
                data-testid="home-board-top"
                className="flex min-h-11 items-center gap-2 border-t pt-2 text-sm hover:underline"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground tabular-nums">#{s.top.number}</span>{" "}
                  {s.top.title}
                </span>
                <UrgencyChip urgency={s.top.urgency} />
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Sana atanmış açık iş yok.</p>
            <Link href="/yonetim" className={more}>
              Panoya git
              <ChevronRight className="size-4" />
            </Link>
          </>
        )}
        <div className="border-t pt-1 md:hidden">
          <Link href="/uyeler" className={more}>
            Üyeler
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
