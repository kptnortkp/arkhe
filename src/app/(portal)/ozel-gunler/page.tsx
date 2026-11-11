import { CalendarHeart, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { SpecialDayList } from "@/components/festivals/special-day-list";
import { SpecialDayLegend, YearCalendar } from "@/components/festivals/year-calendar";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { listSpecialDays } from "@/lib/festivals/queries";
import { isManager } from "@/lib/permissions";
import { addDays, istanbulDateOf, now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Özel günler" };

export default async function SpecialDaysPage({ searchParams }: PageProps<"/ozel-gunler">) {
  const user = await requireUser();
  const canEdit = isManager(user.role);
  const today = istanbulDateOf(now());
  const thisYear = Number(today.slice(0, 4));
  const { yil } = await searchParams;
  const asked = typeof yil === "string" && /^\d{4}$/.test(yil) ? Number(yil) : thisYear;
  const year = Math.abs(asked - thisYear) <= 2 ? asked : thisYear;
  const [days, soon] = await Promise.all([
    listSpecialDays(`${year}-01-01`, `${year}-12-31`),
    listSpecialDays(today, addDays(today, 60)),
  ]);
  const pager = cn(buttonVariants({ variant: "outline" }), "size-11 rounded-full p-0");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-4xl font-medium">Özel günler</h1>
          {canEdit && (
            <Link
              href={`/ozel-gunler/yeni?tarih=${year === thisYear ? today : `${year}-01-01`}`}
              className={cn(buttonVariants(), "h-11 rounded-full px-4")}
            >
              <Plus />
              Özel gün
            </Link>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Resmi tatiller, arifeler ve koro için önemli günler.
        </p>
      </div>

      {soon.length > 0 && (
        <section aria-labelledby="yaklasan" className="space-y-3">
          <h2 id="yaklasan" className="text-xl font-medium">
            Önümüzdeki 60 gün
          </h2>
          <SpecialDayList days={soon} editable={canEdit} />
        </section>
      )}

      <section aria-labelledby="yil" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          {year > thisYear - 2 ? (
            <Link href={`/ozel-gunler?yil=${year - 1}`} aria-label="Önceki yıl" className={pager}>
              <ChevronLeft />
            </Link>
          ) : (
            <span className="size-11" />
          )}
          <h2 id="yil" className="text-2xl font-medium tabular-nums" data-testid="special-year">
            {year} takvimi
          </h2>
          {year < thisYear + 2 ? (
            <Link href={`/ozel-gunler?yil=${year + 1}`} aria-label="Sonraki yıl" className={pager}>
              <ChevronRight />
            </Link>
          ) : (
            <span className="size-11" />
          )}
        </div>
        <SpecialDayLegend />
        <YearCalendar year={year} days={days} today={today} />
        {days.length === 0 ? (
          <div className="space-y-2 rounded-2xl border border-dashed bg-card px-6 py-8 text-center">
            <CalendarHeart aria-hidden className="mx-auto size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{year} için henüz özel gün eklenmedi.</p>
          </div>
        ) : (
          <SpecialDayList days={days} editable={canEdit} />
        )}
      </section>
    </div>
  );
}
