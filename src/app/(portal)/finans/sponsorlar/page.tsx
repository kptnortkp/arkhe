import Link from "next/link";
import { FinanceNav } from "@/components/finance/finance-nav";
import { NewSponsorButton } from "@/components/finance/sponsor-forms";
import { FilterChip } from "@/components/filter-chip";
import { requireManager } from "@/lib/auth/dal";
import { listSponsors, todayIstanbul } from "@/lib/finance/queries";
import { formatKurus } from "@/lib/money";

export const metadata = { title: "Sponsorlar" };

export default async function SponsorsPage({ searchParams }: PageProps<"/finans/sponsorlar">) {
  await requireManager();
  const all = (await searchParams).liste === "tumu";
  const year = todayIstanbul().slice(0, 4);
  const rows = (await listSponsors(year)).filter((s) => all || s.isActive);
  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-medium">Sponsorlar</h1>
      <FinanceNav active="sponsorlar" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Sponsor listesi" className="flex gap-2">
          <FilterChip href="/finans/sponsorlar" active={!all} label="Aktif" />
          <FilterChip href="/finans/sponsorlar?liste=tumu" active={all} label="Tümü" />
        </nav>
        <NewSponsorButton />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Henüz sponsor yok.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((s) => (
            <li key={s.id} data-testid="sponsor-row">
              <Link
                href={`/finans/sponsorlar/${s.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {s.name}
                    {!s.isActive && (
                      <span className="ml-2 text-xs text-muted-foreground">Pasif</span>
                    )}
                  </span>
                  {s.contactName && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.contactName}
                    </span>
                  )}
                </span>
                <span className="text-sm tabular-nums">
                  {year}: {formatKurus(s.total)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
