import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  Banknote,
  FileWarning,
  Flag,
  Landmark,
  Paperclip,
} from "lucide-react";
import Link from "next/link";
import type { Account } from "@/lib/finance/categories";
import type { EntryRow as Row } from "@/lib/finance/queries";
import { ACCOUNT_LABELS, CATEGORY_LABELS, ENTRY_KIND_LABELS } from "@/lib/labels";
import { dayInstant, formatLongDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { eyebrow } from "./finance-nav";
import { MoneyAmount } from "./money-amount";

const KIND_ICON = {
  income: { icon: ArrowDownLeft, className: "bg-present/14 text-present-ink" },
  expense: { icon: ArrowUpRight, className: "bg-muted text-foreground" },
  transfer: { icon: ArrowLeftRight, className: "bg-muted text-muted-foreground" },
  opening: { icon: Flag, className: "bg-muted text-muted-foreground" },
};

export function AccountLabel({ account, to }: { account: Account; to?: Account | null }) {
  const Icon = account === "cash" ? Banknote : Landmark;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5" aria-hidden />
      {to ? `${ACCOUNT_LABELS[account]} → ${ACCOUNT_LABELS[to]}` : ACCOUNT_LABELS[account]}
    </span>
  );
}

export function entryTitle(e: Pick<Row, "description" | "category" | "kind">) {
  return e.description ?? (e.category ? CATEGORY_LABELS[e.category] : ENTRY_KIND_LABELS[e.kind]);
}

// Dues rows are titled by the member, so a list of payments scans by name.
function rowTitle(e: Row) {
  return !e.description && e.memberName ? e.memberName : entryTitle(e);
}

function detailLine(e: Row) {
  const parts = [e.category ? CATEGORY_LABELS[e.category] : ENTRY_KIND_LABELS[e.kind]];
  if (e.memberName)
    parts.push(e.description ? `${e.memberName} · ${e.periodName}` : (e.periodName ?? ""));
  else if (e.sponsorName) parts.push(e.sponsorName);
  else if (e.counterparty) parts.push(e.counterparty);
  if (e.eventName) parts.push(e.eventName);
  return parts.join(" · ");
}

export function EntryRow({ entry: e }: { entry: Row }) {
  const look = KIND_ICON[e.kind];
  const Icon = look.icon;
  const voided = Boolean(e.voidedAt);
  return (
    <li data-testid="entry-row" data-id={e.id} data-voided={voided ? "1" : undefined}>
      <Link
        href={`/finans/${e.id}`}
        className={cn(
          "flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
          voided && "opacity-60",
        )}
      >
        <span
          className={cn("grid size-9 shrink-0 place-items-center rounded-full", look.className)}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate font-medium">{rowTitle(e)}</span>
          <span className="block truncate text-xs text-muted-foreground">{detailLine(e)}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <AccountLabel account={e.account} to={e.toAccount} />
            {e.documentUrl ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="size-3.5" aria-hidden />
                Belge var
              </span>
            ) : e.kind === "expense" ? (
              <span className="inline-flex items-center gap-1 text-late-ink">
                <FileWarning className="size-3.5" aria-hidden />
                Belge yok
              </span>
            ) : null}
            {voided && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 font-medium">
                <Ban className="size-3" aria-hidden />
                İptal
              </span>
            )}
          </span>
        </span>
        <MoneyAmount
          kurus={e.amountKurus}
          kind={e.kind}
          className={cn("text-right", voided && "line-through")}
        />
      </Link>
    </li>
  );
}

/** Entries grouped by day, newest first (the query's order). */
export function EntryDayGroups({ entries }: { entries: Row[] }) {
  const days: [string, Row[]][] = [];
  for (const e of entries) {
    const last = days.at(-1);
    if (last && last[0] === e.occurredOn) last[1].push(e);
    else days.push([e.occurredOn, [e]]);
  }
  return (
    <div className="space-y-5">
      {days.map(([day, rows]) => (
        <section key={day} aria-labelledby={`gun-${day}`} className="space-y-2">
          <h2 id={`gun-${day}`} className={eyebrow}>
            {formatLongDate.format(dayInstant(day))}
          </h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {rows.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
