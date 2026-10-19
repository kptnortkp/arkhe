import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { ActiveChipIntoView } from "@/components/finance/active-chip-into-view";
import { EntryDayGroups } from "@/components/finance/entry-row";
import { FinanceNav } from "@/components/finance/finance-nav";
import { MoneyAmount } from "@/components/finance/money-amount";
import { FilterChip } from "@/components/filter-chip";
import { buttonVariants } from "@/components/ui/button";
import { requireManager } from "@/lib/auth/dal";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/finance/categories";
import { periodNameOf } from "@/lib/finance/dues";
import { ledgerFilters, withParams } from "@/lib/finance/params";
import {
  eventOptions,
  LEDGER_CAP,
  listEntries,
  nextMonth,
  previousMonth,
  todayIstanbul,
  undocumentedCount,
} from "@/lib/finance/queries";
import { ACCOUNT_LABELS, CATEGORY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata = { title: "Hareketler" };

const select =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export default async function LedgerPage({ searchParams }: PageProps<"/finans/hareketler">) {
  await requireManager();
  const sp = await searchParams;
  const f = ledgerFilters(sp);
  const thisMonth = todayIstanbul().slice(0, 7);
  const month = f.allMonths ? undefined : (f.month ?? thisMonth);
  const [{ rows, capped }, eventList, missingDocs] = await Promise.all([
    listEntries({ ...f, month }),
    eventOptions(),
    undocumentedCount(),
  ]);
  const href = (patch: Record<string, string | null>) =>
    `/finans/hareketler${withParams(sp, patch)}`;
  const base = { tur: null, belgesiz: null, iptal: null };
  const quick = f.voided ? "iptal" : f.undocumented ? "belgesiz" : (f.kind ?? "all");
  const live = rows.filter((r) => !r.voidedAt);
  const income = live.filter((r) => r.kind === "income").reduce((s, r) => s + r.amountKurus, 0);
  const expense = live.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amountKurus, 0);
  const sheetFilters = [
    f.category && { key: "kategori", label: CATEGORY_LABELS[f.category] },
    f.account && { key: "hesap", label: ACCOUNT_LABELS[f.account] },
    f.eventId && {
      key: "etkinlik",
      label: eventList.find((e) => e.id === f.eventId)?.name ?? "Etkinlik",
    },
    f.sponsorId && { key: "sponsor", label: "Sponsor" },
  ].filter(Boolean) as { key: string; label: string }[];
  const filtered = sheetFilters.length > 0 || quick !== "all";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-medium">Hareketler</h1>
        <div className="flex gap-2">
          <Link
            href="/finans/yeni?tur=gider&geri=/finans/hareketler"
            className={cn(buttonVariants(), "h-11 rounded-full px-4")}
          >
            <Plus />
            Ekle
          </Link>
          <Link
            href="/finans/rapor#csv"
            className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
          >
            <Download />
            CSV
          </Link>
        </div>
      </div>
      <FinanceNav active="hareketler" />

      {month ? (
        <div className="flex items-center gap-1" data-testid="month-stepper">
          <Link
            href={href({ ay: previousMonth(month) })}
            aria-label="Önceki ay"
            className={cn(buttonVariants({ variant: "ghost" }), "size-11 rounded-full")}
          >
            <ChevronLeft />
          </Link>
          <span className="min-w-28 text-center font-medium">{periodNameOf(month)}</span>
          {month < thisMonth ? (
            <Link
              href={href({ ay: nextMonth(month) })}
              aria-label="Sonraki ay"
              className={cn(buttonVariants({ variant: "ghost" }), "size-11 rounded-full")}
            >
              <ChevronRight />
            </Link>
          ) : (
            <span
              role="link"
              aria-disabled="true"
              aria-label="Sonraki ay"
              className="grid size-11 place-items-center text-muted-foreground/40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </span>
          )}
        </div>
      ) : (
        <p className="font-medium" data-testid="all-months">
          Tüm aylar
        </p>
      )}

      {quick !== "all" && (
        <p className="text-sm text-muted-foreground" data-testid="active-filter">
          Filtre:{" "}
          {
            {
              income: "Gelir",
              expense: "Gider",
              transfer: "Virman",
              belgesiz: "Belgesiz giderler",
              iptal: "İptal edilenler",
            }[quick]
          }
        </p>
      )}
      <ActiveChipIntoView label="Hareket filtreleri" />
      <nav
        aria-label="Hareket filtreleri"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
      >
        <FilterChip href={href(base)} active={quick === "all"} label="Tümü" />
        <FilterChip
          href={href({ ...base, tur: "gelir" })}
          active={quick === "income"}
          label="Gelir"
        />
        <FilterChip
          href={href({ ...base, tur: "gider" })}
          active={quick === "expense"}
          label="Gider"
        />
        <FilterChip
          href={href({ ...base, tur: "virman" })}
          active={quick === "transfer"}
          label="Virman"
        />
        <FilterChip
          href={href({ ...base, belgesiz: "1" })}
          active={quick === "belgesiz"}
          label="Belgesiz giderler"
          count={missingDocs}
        />
        <FilterChip
          href={href({ ...base, iptal: "1" })}
          active={quick === "iptal"}
          label="İptal edilenler"
        />
      </nav>

      <details className="group rounded-2xl border bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="size-4" aria-hidden />
          Filtre
        </summary>
        <form
          action="/finans/hareketler"
          method="get"
          className="grid gap-3 border-t p-4 md:grid-cols-3"
        >
          {Object.entries(sp).map(([k, v]) =>
            typeof v === "string" && !["kategori", "hesap", "etkinlik"].includes(k) ? (
              <input key={k} type="hidden" name={k} value={v} />
            ) : null,
          )}
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Kategori</span>
            <select name="kategori" defaultValue={f.category ?? ""} className={select}>
              <option value="">Tümü</option>
              <optgroup label="Gelir">
                {INCOME_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Gider">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Hesap</span>
            <select
              name="hesap"
              defaultValue={f.account === "cash" ? "kasa" : f.account === "bank" ? "banka" : ""}
              className={select}
            >
              <option value="">Tümü</option>
              <option value="kasa">Kasa</option>
              <option value="banka">Banka</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Etkinlik</span>
            <select name="etkinlik" defaultValue={f.eventId ?? ""} className={select}>
              <option value="">Tümü</option>
              {eventList.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 md:col-span-3">
            <button type="submit" className={cn(buttonVariants(), "h-11 rounded-full px-5")}>
              Uygula
            </button>
            <Link
              href={href({ kategori: null, hesap: null, etkinlik: null, sponsor: null })}
              className={cn(buttonVariants({ variant: "ghost" }), "h-11 rounded-full px-4")}
            >
              Temizle
            </Link>
          </div>
        </form>
      </details>

      {sheetFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sheetFilters.map((s) => (
            <Link
              key={s.key}
              href={href({ [s.key]: null })}
              aria-label={`Filtreyi kaldır: ${s.label}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm hover:bg-muted"
            >
              {s.label}
              <X className="size-4" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 pt-10 pb-12 text-center">
          {f.undocumented ? (
            <p className="flex items-center justify-center gap-2 font-medium">
              <CircleCheck className="size-5 text-present-ink" aria-hidden />
              Bütün giderlerin belgesi var.
            </p>
          ) : (
            <p className="font-medium">
              {f.voided
                ? "Bu ay iptal edilen kayıt yok."
                : filtered
                  ? "Bu filtreye uyan hareket yok."
                  : "Bu ay hareket yok."}
            </p>
          )}
          {filtered && (
            <Link
              href="/finans/hareketler"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-5")}
            >
              Filtreleri temizle
            </Link>
          )}
        </div>
      ) : (
        <>
          <EntryDayGroups entries={rows} />
          {capped && (
            <p className="text-sm text-muted-foreground">
              İlk {LEDGER_CAP} kayıt gösteriliyor. Ay seçerek daralt.
            </p>
          )}
          {!f.voided && (
            <dl
              className="flex flex-wrap gap-x-4 gap-y-1 rounded-2xl border bg-card p-4 text-sm tabular-nums"
              data-testid="ledger-totals"
            >
              <dt className="font-medium">
                {month ? `${periodNameOf(month).split(" ")[0]} toplamı:` : "Toplam:"}
              </dt>
              <dd>
                <MoneyAmount kurus={income} kind="income" /> gelir
              </dd>
              <dd>
                <MoneyAmount kurus={expense} kind="expense" /> gider
              </dd>
              <dd>
                Net <MoneyAmount kurus={income - expense} kind="balance" />
              </dd>
            </dl>
          )}
        </>
      )}
    </div>
  );
}
