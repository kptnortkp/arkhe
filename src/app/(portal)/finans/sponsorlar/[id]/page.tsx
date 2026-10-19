import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EntryDayGroups } from "@/components/finance/entry-row";
import { EditSponsorButton } from "@/components/finance/sponsor-forms";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import { getSponsor, listEntries } from "@/lib/finance/queries";
import { formatKurus } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata = { title: "Sponsor" };

function contactHref(contact: string) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  if (/^[0-9 +()-]{7,}$/.test(contact)) return `tel:${contact.replace(/[^0-9+]/g, "")}`;
  return null;
}

export default async function SponsorPage({ params }: PageProps<"/finans/sponsorlar/[id]">) {
  await requireManager();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [s, { rows }] = await Promise.all([getSponsor(id), listEntries({ sponsorId: id })]);
  if (!s) notFound();
  const href = s.contact ? contactHref(s.contact) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/finans/sponsorlar"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Sponsorlar
      </Link>
      <div className="space-y-1">
        <h1 className="text-4xl font-medium">{s.name}</h1>
        {!s.isActive && <p className="text-sm text-muted-foreground">Pasif</p>}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3 rounded-2xl border bg-card p-4 text-sm">
        {s.contactName && (
          <>
            <dt className="text-muted-foreground">İlgili kişi</dt>
            <dd>{s.contactName}</dd>
          </>
        )}
        {s.contact && (
          <>
            <dt className="text-muted-foreground">İletişim</dt>
            <dd>
              {href ? (
                <a href={href} className="inline-flex min-h-11 items-center text-primary underline">
                  {s.contact}
                </a>
              ) : (
                s.contact
              )}
            </dd>
          </>
        )}
        {s.note && (
          <>
            <dt className="text-muted-foreground">Not</dt>
            <dd className="whitespace-pre-line">{s.note}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Toplam</dt>
        <dd className="space-y-1 tabular-nums">
          {s.years.length === 0
            ? "Henüz gelir yok"
            : s.years.map((y) => (
                <p key={y.year}>
                  {y.year} · {formatKurus(y.total)}
                </p>
              ))}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/finans/yeni?tur=gelir&sponsor=${id}&geri=/finans/sponsorlar/${id}`}
          className={cn(buttonVariants(), "h-11 rounded-full px-4")}
        >
          <Plus />
          Sponsorluk geliri ekle
        </Link>
        <EditSponsorButton
          sponsor={{
            id: s.id,
            name: s.name,
            contactName: s.contactName ?? "",
            contact: s.contact ?? "",
            note: s.note ?? "",
            isActive: s.isActive,
          }}
        />
      </div>
      {rows.length > 0 && <EntryDayGroups entries={rows} />}
    </div>
  );
}
