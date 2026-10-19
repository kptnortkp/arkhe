import { ArrowLeft, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EntryDayGroups } from "@/components/finance/entry-row";
import { EventMenu } from "@/components/finance/event-forms";
import { eyebrow } from "@/components/finance/finance-nav";
import { MoneyAmount } from "@/components/finance/money-amount";
import { NetLabel } from "@/components/finance/net-label";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import { getEvent, listEntries } from "@/lib/finance/queries";
import { CATEGORY_LABELS } from "@/lib/labels";
import { dayInstant, formatLongDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Etkinlik" };

export default async function EventPage({ params }: PageProps<"/finans/etkinlikler/[id]">) {
  await requireManager();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [event, { rows }] = await Promise.all([getEvent(id), listEntries({ eventId: id })]);
  if (!event) notFound();
  const back = `/finans/etkinlikler/${id}`;
  const lines = (
    label: string,
    items: { category: string; total: number }[],
    kind: "income" | "expense",
  ) => (
    <div className="space-y-1.5">
      <p className={eyebrow}>{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Yok</p>
      ) : (
        items.map((l) => (
          <div
            key={l.category}
            className="flex justify-between gap-3 text-sm"
            data-testid="pl-line"
          >
            <span>{CATEGORY_LABELS[l.category as keyof typeof CATEGORY_LABELS]}</span>
            <MoneyAmount kurus={l.total} kind={kind} />
          </div>
        ))
      )}
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/finans/etkinlikler"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Etkinlikler
      </Link>
      <div className="space-y-1">
        <h1 className="text-4xl font-medium">{event.name}</h1>
        <p className="text-sm text-muted-foreground capitalize">
          {formatLongDate.format(dayInstant(event.startsOn))}
          {event.rehearsalId && (
            <>
              {" · "}
              <Link
                href={`/calismalar/${event.rehearsalId}`}
                className="text-primary normal-case underline"
              >
                Konser kaydı
              </Link>
            </>
          )}
        </p>
      </div>
      <section className="space-y-4 rounded-2xl border bg-card p-4" aria-label="Kâr / zarar">
        {lines("Gelir", event.income, "income")}
        {lines("Gider", event.expense, "expense")}
        <div className="border-t pt-3">
          <NetLabel net={event.net} className="text-2xl font-semibold" />
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/finans/yeni?tur=gelir&etkinlik=${id}&geri=${back}`}
          className={cn(buttonVariants(), "h-11 rounded-full px-4")}
        >
          <Plus />
          Gelir ekle
        </Link>
        <Link
          href={`/finans/yeni?tur=gider&etkinlik=${id}&geri=${back}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
        >
          <Minus />
          Gider ekle
        </Link>
      </div>
      {rows.length > 0 && <EntryDayGroups entries={rows} />}
      <div className="border-t pt-4">
        <EventMenu id={id} name={event.name} startsOn={event.startsOn} />
      </div>
    </div>
  );
}
