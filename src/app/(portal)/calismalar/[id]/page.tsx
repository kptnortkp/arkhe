import { and, count, eq, gt } from "drizzle-orm";
import { CalendarClock, ChevronLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckInPanel } from "@/components/attendance/check-in-panel";
import { DetailRoster } from "@/components/attendance/detail-roster";
import { ManagerControls } from "@/components/attendance/manager-controls";
import { TypeChip } from "@/components/attendance/status-chip";
import { db } from "@/db";
import { rehearsals } from "@/db/schema";
import { autoCloseStale } from "@/lib/attendance/close";
import { liveSnapshot } from "@/lib/attendance/live";
import {
  expectedFor,
  getRehearsal,
  myMarks,
  phaseOf,
  rehearsalTitle,
} from "@/lib/attendance/rehearsals";
import { requireUser } from "@/lib/auth/dal";
import { isManager } from "@/lib/permissions";
import { formatLongDate, formatTime, now } from "@/lib/time";

export const metadata = { title: "Çalışma" };

export default async function RehearsalPage({ params }: PageProps<"/calismalar/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await autoCloseStale();
  const r = await getRehearsal(id);
  if (!r) notFound();
  const phase = phaseOf(r);
  const manager = isManager(user.role);
  const started = r.startsAt <= new Date();
  const [marks, expected] = await Promise.all([myMarks(user.id, [id]), expectedFor(user.id, [r])]);
  const mine = marks.get(id);

  const snapshot = manager && phase !== "cancelled" ? await liveSnapshot(id, false) : null;
  const unmarked = snapshot?.rows.filter((x) => x.onRoster && x.status === null).length ?? 0;
  const [{ later }] = r.seriesId
    ? await db
        .select({ later: count() })
        .from(rehearsals)
        .where(
          and(
            eq(rehearsals.seriesId, r.seriesId),
            gt(rehearsals.startsAt, new Date(Math.max(now().getTime(), r.startsAt.getTime()))),
          ),
        )
    : [{ later: 0 }];
  const showRoster =
    snapshot && (phase === "open" || phase === "closed" || phase === "untaken" || started);
  const excusesAhead = snapshot?.rows.filter((x) => x.status === "excused") ?? [];

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-3">
        <Link
          href="/calismalar"
          className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Çalışmalar
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <TypeChip type={r.type} parts={r.parts} />
          {phase === "cancelled" && (
            <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              İptal edildi
            </span>
          )}
          {phase === "closed" && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              Yoklama kapandı
            </span>
          )}
          {phase === "untaken" && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              Yoklama alınmadı
            </span>
          )}
        </div>
        <h1 className="text-4xl font-medium">{rehearsalTitle(r)}</h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 capitalize">
            <CalendarClock className="size-4" />
            {formatLongDate.format(r.startsAt)}, {formatTime.format(r.startsAt)}–
            {formatTime.format(r.endsAt)}
          </span>
          {r.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" />
              {r.location}
            </span>
          )}
        </div>
        {r.note && <p className="rounded-xl bg-muted px-4 py-3 text-sm">{r.note}</p>}
      </div>

      {user.role !== "conductor" && (
        <section aria-label="Senin durumun" className="rounded-2xl border bg-card p-5">
          <CheckInPanel
            rehearsalId={id}
            phase={phase}
            started={started}
            expected={expected.get(id) ?? false}
            status={mine?.status ?? null}
            method={mine?.method ?? null}
            note={mine?.note ?? null}
            recordedAt={mine?.recordedAt.toISOString() ?? null}
          />
        </section>
      )}

      {manager && (
        <section aria-label="Yönetim" className="space-y-5">
          <ManagerControls
            id={id}
            phase={phase}
            inSeries={Boolean(r.seriesId)}
            laterInSeries={later}
            unmarked={unmarked}
            started={started}
          />
          {phase === "open" && r.endsAt < new Date() && (
            <p className="rounded-xl bg-accent px-4 py-3 text-sm text-accent-foreground">
              Yoklama hâlâ açık. Gün bitince kendiliğinden kapanır.
            </p>
          )}
          {showRoster && snapshot ? (
            <DetailRoster rehearsalId={id} initial={snapshot} />
          ) : (
            excusesAhead.length > 0 && (
              <div className="space-y-2">
                <h2 className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
                  Mazeret bildirenler · {excusesAhead.length}
                </h2>
                <ul className="divide-y rounded-2xl border bg-card">
                  {excusesAhead.map((x) => (
                    <li key={x.userId} className="px-4 py-3">
                      <p className="font-medium">{x.name}</p>
                      {x.note && <p className="text-sm text-muted-foreground">“{x.note}”</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </section>
      )}
    </div>
  );
}
