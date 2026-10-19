import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { LiveScreen } from "@/components/attendance/live-screen";
import { autoCloseStale } from "@/lib/attendance/close";
import { liveSnapshot } from "@/lib/attendance/live";
import { getRehearsal, rehearsalTitle } from "@/lib/attendance/rehearsals";
import { LATE_AFTER_MINUTES } from "@/lib/attendance/rules";
import { requireManager } from "@/lib/auth/dal";
import { appUrl } from "@/lib/auth/set-password-links";
import { formatDayMonth, formatTime } from "@/lib/time";

export const metadata = { title: "Canlı yoklama" };

export default async function LivePage({
  params,
  searchParams,
}: PageProps<"/calismalar/[id]/canli">) {
  await requireManager();
  const { id } = await params;
  const { gorunum } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  await autoCloseStale();
  const r = await getRehearsal(id);
  if (!r) notFound();
  if (!r.openedAt || r.closedAt) redirect(`/calismalar/${id}`);
  const snapshot = await liveSnapshot(id, true);
  if (!snapshot) notFound();

  return (
    <LiveScreen
      rehearsalId={id}
      title={`${rehearsalTitle(r)} · ${formatDayMonth.format(r.startsAt)}`}
      lateFrom={formatTime.format(new Date(r.startsAt.getTime() + LATE_AFTER_MINUTES * 60_000))}
      initial={snapshot}
      codeOnly={gorunum === "kod"}
      qrBase={appUrl("/yoklama/kod/")}
    />
  );
}
