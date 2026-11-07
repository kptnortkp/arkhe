import { ChevronRight, Megaphone } from "lucide-react";
import Link from "next/link";
import { homeAnnouncements, type Viewer } from "@/lib/announcements/queries";
import { cn } from "@/lib/utils";
import { DismissibleAnnouncement } from "./dismiss";
import { ImportantChip } from "./important-chip";
import { LinkifiedText } from "./linkified-text";

/** A clamp of 4 lines hides the rest: offer "Devamı" when the text is likely longer. */
const isLong = (body: string) => body.split("\n").length > 4 || [...body].length > 180;

export async function AnnouncementsHomeCard({ viewer }: { viewer: Viewer }) {
  const { items, total } = await homeAnnouncements(viewer);
  if (items.length === 0) return null;
  const more = total - items.length;
  return (
    <section aria-labelledby="home-announcements" className="space-y-3" data-testid="home-announcements">
      <div className="flex items-end justify-between gap-3">
        <h2 id="home-announcements" className="flex items-center gap-2 text-xl font-medium">
          <Megaphone aria-hidden className="size-5 text-muted-foreground" />
          Duyurular
        </h2>
        <Link
          href="/duyurular"
          className="-my-2 inline-flex min-h-11 items-center gap-0.5 px-1 text-sm font-medium text-primary hover:underline"
        >
          Tüm duyurular
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </div>
      <ul className="space-y-3">
        {items.map((a) => (
          <DismissibleAnnouncement key={a.id} id={a.id} title={a.title} important={a.important}>
            <div className="flex items-start gap-2">
              <h3
                className={cn(
                  "min-w-0 flex-1 font-sans text-base font-semibold [overflow-wrap:anywhere]",
                  a.important && "text-absent-ink",
                )}
              >
                {a.title}
              </h3>
              {a.important && <ImportantChip />}
            </div>
            <p className="line-clamp-4 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              <LinkifiedText text={a.body} />
            </p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>{a.senderName}</span>
              {isLong(a.body) && (
                <Link
                  href={`/duyurular#${a.id}`}
                  className="-my-2 inline-flex min-h-11 items-center px-1 text-sm font-medium text-primary hover:underline"
                >
                  Devamı
                </Link>
              )}
            </p>
          </DismissibleAnnouncement>
        ))}
      </ul>
      {more > 0 && (
        <Link
          href="/duyurular"
          data-testid="home-announcements-more"
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        >
          {more} duyuru daha
        </Link>
      )}
    </section>
  );
}
