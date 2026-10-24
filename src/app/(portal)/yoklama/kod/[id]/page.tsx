import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { QrCheckIn } from "@/components/attendance/qr-check-in";
import { checkInErrorMessage } from "@/lib/attendance/check-in-errors";
import { autoCloseStale } from "@/lib/attendance/close";
import { getRehearsal, myMarks, phaseOf, rehearsalTitle } from "@/lib/attendance/rehearsals";
import { requireUser } from "@/lib/auth/dal";
import { STATUS_LABELS } from "@/lib/labels";
import { formatDayMonth } from "@/lib/time";

export const metadata = { title: "Yoklama", referrer: "same-origin" };

/** Rendering never writes: link previews and prefetches hit this GET. The check-in runs client-side. */
export default async function QrLandingPage({
  params,
  searchParams,
}: PageProps<"/yoklama/kod/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { c, hata } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  await autoCloseStale();
  const r = await getRehearsal(id);
  if (!r) notFound();
  const phase = phaseOf(r);
  const mine = (await myMarks(user.id, [id])).get(id);
  const attended = mine && (mine.status === "present" || mine.status === "late");
  const code = typeof c === "string" && /^\d{4}$/.test(c) ? c : null;

  return (
    <div className="mx-auto max-w-md space-y-6 pt-4">
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Yoklama
        </p>
        <h1 className="text-3xl font-medium">{rehearsalTitle(r)}</h1>
        <p className="text-sm text-muted-foreground">{formatDayMonth.format(r.startsAt)}</p>
      </div>
      <div className="rounded-2xl border bg-card p-5">
        {attended ? (
          <p className="font-medium" data-testid="qr-state">
            Yoklamaya katıldın · {STATUS_LABELS[mine.status]}
          </p>
        ) : phase === "closed" ? (
          <p className="font-medium" data-testid="qr-state">
            Yoklama kapandı. Geldiysen yoklamayı alan kişiye söyle.
          </p>
        ) : phase !== "open" ? (
          <p className="font-medium" data-testid="qr-state">
            {phase === "cancelled" ? "Bu çalışma iptal edildi." : "Yoklama henüz açılmadı."}
          </p>
        ) : (
          <QrCheckIn rehearsalId={id} code={code} error={checkInErrorMessage(hata)} />
        )}
      </div>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        Ana sayfaya dön
      </Link>
    </div>
  );
}
