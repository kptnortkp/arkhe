import { ChartColumn, Plus } from "lucide-react";
import Link from "next/link";
import { AttendanceStrip } from "@/components/attendance/status-chip";
import { RehearsalRow } from "@/components/attendance/rehearsal-row";
import { Pager, pageParam } from "@/components/pager";
import { buttonVariants } from "@/components/ui/button";
import { autoCloseStale } from "@/lib/attendance/close";
import { resolvePeriod } from "@/lib/attendance/period";
import { expectedFor, listRehearsals, myMarks, type Rehearsal } from "@/lib/attendance/rehearsals";
import { attendanceStats } from "@/lib/attendance/stats";
import { requireUser } from "@/lib/auth/dal";
import { isManager } from "@/lib/permissions";
import { addDays, formatDayMonth, istanbulDateOf, istanbulToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Çalışmalar" };

const PAGE = 60;

function groupByWeek(list: Rehearsal[]) {
  const groups = new Map<string, Rehearsal[]>();
  for (const r of list) {
    // Monday of the Istanbul week; noon UTC keeps the weekday on the right calendar day.
    const day = istanbulDateOf(r.startsAt);
    const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDays(day, -weekday);
    groups.set(monday, [...(groups.get(monday) ?? []), r]);
  }
  return [...groups.entries()];
}

export default async function RehearsalsPage({ searchParams }: PageProps<"/calismalar">) {
  const user = await requireUser();
  await autoCloseStale();
  const canManage = isManager(user.role);
  const { sekme, sayfa } = await searchParams;
  const past = sekme === "gecmis";
  const page = past ? pageParam(sayfa) : 1;
  const todayStart = istanbulToUtc(istanbulDateOf(new Date()));

  // One extra row only says whether an older page exists.
  const fetched = past
    ? await listRehearsals({ to: todayStart, order: "desc", limit: PAGE + 1, offset: (page - 1) * PAGE })
    : await listRehearsals({ from: todayStart, limit: PAGE });
  const hasMore = past && fetched.length > PAGE;
  const list = fetched.slice(0, PAGE);
  const ids = list.map((r) => r.id);
  const [marks, expected] = await Promise.all([myMarks(user.id, ids), expectedFor(user.id, list)]);
  const showMine = user.role !== "conductor";

  const period = past && showMine && page === 1 ? await resolvePeriod() : null;
  const mine = period
    ? (await attendanceStats({ from: period.from, to: period.to, userId: user.id })).members[0]
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-4xl font-medium">Çalışmalar</h1>
        {canManage && (
          <div className="flex gap-2">
            <Link
              href="/raporlar"
              className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-full px-4")}
            >
              <ChartColumn />
              Raporlar
            </Link>
            <Link
              href="/calismalar/yeni"
              className={cn(buttonVariants(), "h-10 rounded-full px-4")}
            >
              <Plus />
              <span className="sr-only sm:not-sr-only">Yeni çalışma</span>
            </Link>
          </div>
        )}
      </div>

      <nav aria-label="Çalışma listesi" className="flex gap-2">
        {[
          { href: "/calismalar", label: "Yaklaşan", active: !past },
          { href: "/calismalar?sekme=gecmis", label: "Geçmiş", active: past },
        ].map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center rounded-full border px-4 text-sm transition-colors",
              tab.active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {mine && period && (
        <section className="space-y-3 rounded-2xl border bg-card p-5" aria-label="Devamın">
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            {period.label} · devamın
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-heading text-5xl font-medium" data-testid="my-percent">
              {mine.percent === null ? "—" : `%${mine.percent}`}
            </span>
            <span className="text-sm text-muted-foreground">
              {mine.attended}/{mine.expected} çalışma · {mine.late} geç · {mine.excused} mazeretli ·{" "}
              {mine.absent} gelmedi
            </span>
          </div>
          <AttendanceStrip statuses={mine.history.slice(0, 12).map((h) => h.status)} />
          {mine.warning && (
            <p className="rounded-xl bg-accent px-3.5 py-2.5 text-sm text-accent-foreground">
              Son çalışmaların bazılarına gelemedin. Bir sorun varsa şefinle konuşmaktan çekinme.
            </p>
          )}
        </section>
      )}

      {list.length === 0 ? (
        <div className="staff-lines rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          {past ? "Henüz geçmiş çalışma yok." : "Planlanmış çalışma yok."}
          {canManage && !past && (
            <>
              {" "}
              <Link href="/calismalar/yeni" className="font-medium text-primary hover:underline">
                İlk çalışmayı ekle
              </Link>
            </>
          )}
        </div>
      ) : (
        groupByWeek(list).map(([monday, items]) => (
          <section key={monday} className="space-y-2">
            <h2 className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
              {formatDayMonth.format(istanbulToUtc(monday, "12:00"))} haftası
            </h2>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {items.map((r) => (
                <li key={r.id}>
                  <RehearsalRow
                    rehearsal={r}
                    showMine={showMine}
                    expected={expected.get(r.id)}
                    myStatus={marks.get(r.id)?.status ?? null}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {past && (
        <Pager
          page={page}
          hasMore={hasMore}
          label="Geçmiş çalışmalar sayfaları"
          href={(n) => (n === 1 ? "/calismalar?sekme=gecmis" : `/calismalar?sekme=gecmis&sayfa=${n}`)}
        />
      )}
    </div>
  );
}
