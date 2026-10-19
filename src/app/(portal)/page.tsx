import { CalendarClock, ChevronRight, MapPin, Radio } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import stageChoir from "../../../public/brand/stage-choir.webp";
import { CheckInPanel } from "@/components/attendance/check-in-panel";
import { AttendanceStrip, TypeChip } from "@/components/attendance/status-chip";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KasaCard, MyDuesCard } from "@/components/finance/home-cards";
import { ManagerHomeworkCard, MyHomeworkCard } from "@/components/homework/home-cards";
import { PieceRow } from "@/components/repertoire/piece-row";
import { VOICE_PARTS } from "@/db/schema";
import { autoCloseStale } from "@/lib/attendance/close";
import { resolvePeriod } from "@/lib/attendance/period";
import {
  expectedFor,
  listRehearsals,
  myMarks,
  phaseOf,
  rehearsalTitle,
} from "@/lib/attendance/rehearsals";
import { rosterOf } from "@/lib/attendance/roster";
import { attendanceStats } from "@/lib/attendance/stats";
import { requireUser } from "@/lib/auth/dal";
import { firstName } from "@/lib/format";
import { VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import { isManager } from "@/lib/permissions";
import { loadViewer } from "@/lib/homework/queries";
import { learningPieces, withMyPart } from "@/lib/repertoire";
import { formatLongDate, formatTime, istanbulDateOf, istanbulToUtc, now } from "@/lib/time";
import { cn } from "@/lib/utils";

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("tr-TR", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Europe/Istanbul",
    }).format(now()),
  );
  if (hour < 6) return "İyi geceler,";
  if (hour < 12) return "Günaydın,";
  if (hour < 18) return "İyi günler,";
  return "İyi akşamlar,";
}

export default async function HomePage() {
  const user = await requireUser();
  await autoCloseStale();
  const manager = isManager(user.role);
  const todayStart = istanbulToUtc(istanbulDateOf(now()));
  // Starts a day back so a rehearsal still open past midnight stays on the hero.
  const upcoming = (
    await listRehearsals({ from: new Date(todayStart.getTime() - 86_400_000), limit: 30 })
  ).filter((r) => !r.cancelledAt && !r.closedAt && (r.openedAt || r.startsAt >= todayStart));
  const expected = await expectedFor(user.id, upcoming);
  const mineOnly =
    user.role === "conductor" ? upcoming : upcoming.filter((r) => expected.get(r.id));
  // An open rehearsal wins; otherwise the next one that hasn't ended.
  const next =
    mineOnly.find((r) => phaseOf(r) === "open") ?? mineOnly.find((r) => r.endsAt > now());
  const mark = next ? (await myMarks(user.id, [next.id])).get(next.id) : undefined;
  const nextPhase = next ? phaseOf(next) : null;

  const period = await resolvePeriod();
  const mine =
    user.role !== "conductor"
      ? (await attendanceStats({ from: period.from, to: period.to, userId: user.id })).members[0]
      : undefined;

  const [lastClosed] = manager
    ? (await listRehearsals({ to: now(), order: "desc", limit: 10 })).filter((r) => r.closedAt)
    : [];
  const lastRoster = lastClosed ? await rosterOf(lastClosed.id, { includeNotes: false }) : null;
  const turnout = VOICE_PARTS.map((part) => {
    const rows = lastRoster?.rows.filter((r) => r.onRoster && r.voicePart === part) ?? [];
    return {
      part,
      total: rows.length,
      present: rows.filter((r) => r.status === "present" || r.status === "late").length,
    };
  }).filter((t) => t.total > 0);

  const viewer = (await loadViewer(user.id))!;
  const at = now();
  const learning = await learningPieces();
  const pieces = await withMyPart(learning.slice(0, 5), user.voicePart);
  const morePieces = learning.length - pieces.length;

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <p className="text-sm text-muted-foreground">{greeting()}</p>
        <h1 className="text-4xl font-medium md:text-5xl">{firstName(user.name)}</h1>
      </section>

      <section
        className="on-stage relative overflow-hidden rounded-3xl bg-stage p-6 text-stage-foreground ring-1 ring-white/5 md:p-8"
        aria-label="Sıradaki çalışma"
      >
        <Image
          src={stageChoir}
          alt=""
          fill
          sizes="(min-width: 768px) 944px, 100vw"
          className="object-cover object-[center_12%] opacity-60"
        />
        <div className="stage-scrim absolute inset-0" />
        {next ? (
          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-medium tracking-[0.2em] text-stage-foreground/70 uppercase">
                Sıradaki çalışma
              </p>
              <Link href={`/calismalar/${next.id}`} className="block hover:underline">
                <h2 className="text-3xl font-medium capitalize md:text-4xl">
                  {formatLongDate.format(next.startsAt)}
                </h2>
              </Link>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-stage-foreground/75">
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="size-4" />
                  {formatTime.format(next.startsAt)} · {rehearsalTitle(next)}
                </span>
                {next.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-4" />
                    {next.location}
                  </span>
                )}
              </div>
              {next.type !== "tutti" && <TypeChip type={next.type} parts={next.parts} />}
            </div>
            <div className="md:max-w-xs md:min-w-64">
              {manager && (nextPhase === "open" || nextPhase === "openable") ? (
                <Link
                  href={
                    nextPhase === "open" ? `/calismalar/${next.id}/canli` : `/calismalar/${next.id}`
                  }
                  className={cn(
                    buttonVariants(),
                    "h-12 rounded-2xl bg-gold px-6 text-base font-semibold text-gold-foreground hover:bg-gold/90",
                  )}
                >
                  <Radio />
                  {nextPhase === "open" ? "Canlı ekranı aç" : "Yoklamayı başlat"}
                </Link>
              ) : user.role !== "conductor" ? (
                <CheckInPanel
                  onStage
                  rehearsalId={next.id}
                  phase={nextPhase ?? "upcoming"}
                  started={next.startsAt <= now()}
                  expected
                  status={mark?.status ?? null}
                  method={mark?.method ?? null}
                  note={mark?.note ?? null}
                  recordedAt={mark?.recordedAt.toISOString() ?? null}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="relative space-y-2">
            <p className="text-xs font-medium tracking-[0.2em] text-stage-foreground/70 uppercase">
              Sıradaki çalışma
            </p>
            <p className="text-2xl font-medium">Planlanmış çalışma yok.</p>
            {manager && (
              <Link href="/calismalar/yeni" className="text-sm underline">
                Çalışma ekle
              </Link>
            )}
          </div>
        )}
      </section>

      <MyHomeworkCard viewer={viewer} at={at} />
      {manager && <ManagerHomeworkCard at={at} />}
      <MyDuesCard />
      {manager && <KasaCard />}

      <div className="grid gap-4 md:grid-cols-5">
        {mine && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
                {period.label} · devamın
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-5xl font-medium">
                  {mine.percent === null ? "—" : `%${mine.percent}`}
                </span>
                <span className="text-sm text-muted-foreground">
                  {mine.attended}/{mine.expected} çalışma
                </span>
              </div>
              {mine.history.length > 0 ? (
                <AttendanceStrip
                  className="flex"
                  statuses={mine.history.slice(0, 12).map((h) => h.status)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Bu dönem henüz sayılan çalışma yok.</p>
              )}
              <Link
                href="/calismalar?sekme=gecmis"
                className="-my-2 inline-flex items-center gap-0.5 py-2 text-sm font-medium text-primary hover:underline"
              >
                Geçmişim
                <ChevronRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        )}

        {manager && lastClosed && (
          <Card className={mine ? "md:col-span-3" : "md:col-span-5"}>
            <CardHeader>
              <CardTitle className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
                Son çalışmanın katılımı · {formatLongDate.format(lastClosed.startsAt)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3.5">
              {turnout.map(({ part, present, total }) => (
                <div key={part} className="flex items-center gap-3">
                  <span className="w-16 text-sm">{VOICE_PART_LABELS[part]}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", VOICE_PART_STYLES[part].dot)}
                      style={{ width: `${(present / total) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-sm text-muted-foreground tabular-nums">
                    {present}/{total}
                  </span>
                </div>
              ))}
              <Link
                href="/raporlar"
                className="-my-2 inline-flex items-center gap-0.5 py-2 text-sm font-medium text-primary hover:underline"
              >
                Raporlar
                <ChevronRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {(pieces.length > 0 || manager) && (
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="text-2xl font-medium">Çalışılan eserler</h2>
            <Link
              href="/repertuvar"
              className="-my-2 inline-flex min-h-11 items-center gap-0.5 px-1 text-sm font-medium text-primary hover:underline"
            >
              Tümü
              <ChevronRight className="size-4" />
            </Link>
          </div>
          {pieces.length > 0 ? (
            <ul
              className="divide-y overflow-hidden rounded-2xl border bg-card"
              data-testid="home-pieces"
            >
              {pieces.map((piece) => (
                <PieceRow
                  key={piece.id}
                  piece={piece}
                  myPart={piece.myPart}
                  voicePart={user.voicePart}
                  showMeta={false}
                />
              ))}
              {morePieces > 0 && (
                <li>
                  <Link
                    href="/repertuvar"
                    className="flex min-h-11 items-center px-4 text-sm font-medium text-primary hover:underline"
                  >
                    +{morePieces} eser daha
                  </Link>
                </li>
              )}
            </ul>
          ) : (
            <div className="space-y-3 rounded-2xl border border-dashed bg-card px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">Şu an çalışılan eser yok.</p>
              <Link
                href="/repertuvar/yeni"
                className={cn(buttonVariants(), "h-11 rounded-full px-5")}
              >
                Eser ekle
              </Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
