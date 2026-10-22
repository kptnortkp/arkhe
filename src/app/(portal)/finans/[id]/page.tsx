import { ArrowLeft, Ban } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentLink } from "@/components/finance/document-link";
import { EntryActions } from "@/components/finance/entry-actions";
import { AccountLabel, entryTitle } from "@/components/finance/entry-row";
import { MoneyAmount } from "@/components/finance/money-amount";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import { entryRecordNo } from "@/lib/import/queries";
import { eventOptions, getEntry } from "@/lib/finance/queries";
import { CATEGORY_LABELS, ENTRY_KIND_LABELS } from "@/lib/labels";
import { parseLink } from "@/lib/links";
import { formatKurus, formatSigned } from "@/lib/money";
import { dayInstant, formatShortDate, formatShortDateTime, formatter } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Hareket" };

const fullDate = formatter({ weekday: "long", day: "numeric", month: "long", year: "numeric" });

function signedText(e: { kind: string; amountKurus: number }) {
  return e.kind === "income"
    ? formatSigned(e.amountKurus, "in")
    : e.kind === "expense"
      ? formatSigned(e.amountKurus, "out")
      : formatKurus(e.amountKurus);
}

export default async function EntryPage({ params }: PageProps<"/finans/[id]">) {
  await requireManager();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [e, eventList, recordNo] = await Promise.all([getEntry(id), eventOptions(), entryRecordNo(id)]);
  if (!e) notFound();
  const voided = Boolean(e.voidedAt);
  const link = e.documentUrl ? parseLink(e.documentUrl) : null;
  const summary = `${signedText(e)} · ${entryTitle(e)} · ${formatShortDate.format(dayInstant(e.occurredOn))}`;
  const eyebrowText = [ENTRY_KIND_LABELS[e.kind], e.category ? CATEGORY_LABELS[e.category] : null]
    .filter(Boolean)
    .join(" · ");
  const counterpartyLabel = e.kind === "income" ? "Kimden" : "Kime";

  const rows: [string, React.ReactNode][] = [
    [
      "Tarih",
      <span key="d" className="capitalize">
        {fullDate.format(dayInstant(e.occurredOn))}
      </span>,
    ],
    ["Hesap", <AccountLabel key="a" account={e.account} to={e.toAccount} />],
  ];
  if (e.counterparty) rows.push([counterpartyLabel, e.counterparty]);
  if (e.description) rows.push(["Açıklama", e.description]);
  if (e.sponsorName)
    rows.push([
      "Sponsor",
      <Link key="s" href={`/finans/sponsorlar/${e.sponsorId}`} className="text-primary underline">
        {e.sponsorName}
      </Link>,
    ]);
  if (e.eventName)
    rows.push([
      "Etkinlik",
      <Link key="e" href={`/finans/etkinlikler/${e.eventId}`} className="text-primary underline">
        {e.eventName}
      </Link>,
    ]);
  if (e.memberName) {
    rows.push(["Üye", e.memberName]);
    rows.push(["Aidat dönemi", e.periodName]);
  }
  if (e.siblings.length > 1) {
    rows.push([
      "Aynı ödemede",
      <span key="g" data-testid="payment-group">
        {e.siblings.map((s) => s.periodName).join(", ")}
      </span>,
    ]);
  }
  if (e.kind !== "transfer" && e.kind !== "opening") {
    rows.push([
      "Belge",
      link ? (
        <DocumentLink key="doc" url={link.url} previewSrc={link.previewSrc} />
      ) : (
        <span key="doc" className="text-muted-foreground">
          Belge eklenmedi
        </span>
      ),
    ]);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/finans/hareketler"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Hareketler
      </Link>
      <div className="space-y-2">
        <p className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          {eyebrowText}
        </p>
        <h1 className="flex flex-wrap items-center gap-3 font-sans text-4xl font-semibold">
          <MoneyAmount
            kurus={e.amountKurus}
            kind={e.kind}
            className={cn(voided && "line-through")}
          />
          {voided && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
              <Ban className="size-3.5" aria-hidden />
              İptal
            </span>
          )}
        </h1>
        <p className="text-lg">{entryTitle(e)}</p>
      </div>

      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3 rounded-2xl border bg-card p-4 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-1 text-xs text-muted-foreground" data-testid="audit">
        <p>
          Kaydeden: {e.creatorName} · {formatShortDateTime.format(e.createdAt)}
        </p>
        {recordNo && <p data-testid="imported-line">İçe aktarıldı · Kayıt no {recordNo}</p>}
        {e.updatedAt && (
          <p data-testid="updated-line">
            Son düzenleme: {e.updaterName} · {formatShortDateTime.format(e.updatedAt)}
          </p>
        )}
        {e.voidedAt && (
          <p data-testid="void-line">
            İptal: {e.voiderName} · {formatShortDate.format(e.voidedAt)} · {e.voidReason}
          </p>
        )}
        {e.replaces && (
          <p>
            <Link
              href={`/finans/${e.replaces.id}`}
              className="text-primary underline"
              data-testid="replaces-link"
            >
              Bu kaydın yerine: {signedText(e.replaces)} ·{" "}
              {formatShortDate.format(dayInstant(e.replaces.occurredOn))}
            </Link>
          </p>
        )}
        {e.replacedBy && (
          <p>
            <Link
              href={`/finans/${e.replacedBy.id}`}
              className="text-primary underline"
              data-testid="replaced-by-link"
            >
              Düzeltilmiş kayıt: {signedText(e.replacedBy)} ·{" "}
              {formatShortDate.format(dayInstant(e.replacedBy.occurredOn))}
            </Link>
          </p>
        )}
      </div>

      {e.kind === "opening"
        ? !voided && (
            <Link
              href="/finans/ayarlar"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
            >
              Ayarlar&apos;dan değiştir
            </Link>
          )
        : !voided && (
            <EntryActions
              id={e.id}
              summary={summary}
              correctable={!e.replacedBy}
              events={eventList}
              meta={{
                revision: e.revision,
                description: e.description ?? "",
                counterparty: e.counterparty ?? "",
                eventId: e.eventId ?? "",
                documentUrl: e.documentUrl ?? "",
                withEvent: e.kind === "income" || e.kind === "expense",
                withDocument: e.kind === "income" || e.kind === "expense",
                counterpartyLabel,
              }}
            />
          )}
    </div>
  );
}
