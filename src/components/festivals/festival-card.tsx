import { CalendarDays, ExternalLink, MapPin, Pencil, Ticket, Wallet } from "lucide-react";
import Link from "next/link";
import { LinkifiedText } from "@/components/announcements/linkified-text";
import {
  ATTENDING_FILL,
  daysLeftText,
  deadlineState,
  FESTIVAL_STATUS_LABELS,
  festivalDates,
  isNew,
  isPast,
  NEW_FILL,
  REGION_FILL,
  REGION_LABELS,
} from "@/lib/festivals/labels";
import type { Festival } from "@/lib/festivals/queries";
import { cn } from "@/lib/utils";

/** One festival in the spreadsheet's colours: yellow Türkiye, blue abroad, green when we go. */
export function FestivalCard({ festival: f, today }: { festival: Festival; today: string }) {
  const past = isPast(f, today);
  const attending = f.status === "attending";
  const fresh = isNew(f.createdAt, today);
  const deadline = deadlineState(f, today);
  const soon = deadline.kind === "open" && deadline.days <= 7;
  return (
    <li
      data-testid="festival"
      data-id={f.id}
      data-region={f.region}
      data-status={f.status}
      className={cn(
        "relative space-y-2 rounded-2xl border border-foreground/10 p-4 text-foreground",
        attending ? ATTENDING_FILL : REGION_FILL[f.region],
        (past || f.status === "declined") && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <span className="rounded-full bg-background/70 px-2 py-0.5">
              {REGION_LABELS[f.region]}
            </span>
            {f.status !== "watching" && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5",
                  attending ? "bg-present text-present-foreground" : "bg-background/70",
                )}
              >
                {FESTIVAL_STATUS_LABELS[f.status]}
              </span>
            )}
            {fresh && !past && (
              <span className={cn("rounded-full px-2 py-0.5 text-black", NEW_FILL)}>Yeni</span>
            )}
            {past && <span className="rounded-full bg-background/70 px-2 py-0.5">Geçti</span>}
          </div>
          <h3 className="font-sans text-base font-semibold [overflow-wrap:anywhere]">{f.name}</h3>
        </div>
        <Link
          href={`/yonetim/festivaller/${f.id}`}
          aria-label={`Düzenle: ${f.name}`}
          className="-m-2 grid size-11 shrink-0 place-items-center rounded-full outline-none hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Pencil aria-hidden className="size-4" />
        </Link>
      </div>
      <dl className="grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="sr-only">Tarih</dt>
          <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
          <dd>{festivalDates(f)}</dd>
        </div>
        {f.place && (
          <div className="flex gap-2">
            <dt className="sr-only">Yer</dt>
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
            <dd>{f.place}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="sr-only">Başvuru</dt>
          <Ticket aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Başvuru: {deadline.text}</span>
            {deadline.kind === "open" && !past && (
              <span
                data-testid="deadline-chip"
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  soon ? "bg-absent text-absent-foreground" : "bg-background/70",
                )}
              >
                {daysLeftText(deadline.days)}
              </span>
            )}
            {deadline.kind === "closed" && !past && (
              <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs">
                Başvuru kapandı
              </span>
            )}
          </dd>
        </div>
        {f.fee && (
          <div className="flex gap-2">
            <dt className="sr-only">Katılım ücreti</dt>
            <Wallet aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
            <dd>{f.fee}</dd>
          </div>
        )}
      </dl>
      {f.note && (
        <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-line">
          <LinkifiedText text={f.note} />
        </p>
      )}
      {f.url && (
        <a
          href={f.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium [overflow-wrap:anywhere] underline underline-offset-2"
        >
          <ExternalLink aria-hidden className="size-4 shrink-0" />
          {f.linkLabel ?? f.url.replace(/^https?:\/\//, "")}
        </a>
      )}
    </li>
  );
}
