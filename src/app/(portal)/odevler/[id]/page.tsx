import { ArrowLeft, Library } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FilterChip } from "@/components/filter-chip";
import { AssignmentMenu } from "@/components/homework/assignment-menu";
import { DeadlineChip, DueLine, PartList } from "@/components/homework/deadline-chip";
import { FeedbackSeen } from "@/components/homework/feedback-seen";
import { Roster, type RosterGroup } from "@/components/homework/roster";
import { SingerSteps } from "@/components/homework/singer-steps";
import { SubmitToggle } from "@/components/homework/submit-button";
import { PartButton } from "@/components/repertoire/part-button";
import { VOICE_PARTS, type VoicePart } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";
import { deadlineBadge, managerBadge } from "@/lib/homework/deadline";
import { isEligible, isExpected } from "@/lib/homework/eligibility";
import { barsLabel, homeworkBody, homeworkSubject, mailtoHref } from "@/lib/homework/mail";
import {
  getAssignment,
  getRecordingEmail,
  loadViewer,
  mySubmission,
  rosterFor,
  submissionCount,
} from "@/lib/homework/queries";
import { isManager } from "@/lib/permissions";
import { withMyPart } from "@/lib/repertoire";
import { formatShortDate, formatShortDateTime, now } from "@/lib/time";

const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";
const partParam = (p: VoicePart | null) => (p === "bass" ? "bas" : (p ?? "tumu"));

async function load(id: string) {
  await requireUser();
  if (!z.uuid().safeParse(id).success) notFound();
  const a = await getAssignment(id);
  if (!a) notFound();
  return a;
}

export async function generateMetadata({ params }: PageProps<"/odevler/[id]">) {
  const a = await load((await params).id);
  return { title: `${a.pieceTitle} · ${barsLabel(a.barFrom, a.barTo)}` };
}

export default async function AssignmentPage({ params, searchParams }: PageProps<"/odevler/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const a = await load(id);
  const sp = await searchParams;
  const viewer = (await loadViewer(user.id))!;
  const manager = isManager(user.role);
  const at = now();
  const title = `${a.pieceTitle} · ${barsLabel(a.barFrom, a.barTo)}`;
  const eligible = isEligible(viewer, a.parts);
  const expected = isExpected(viewer, a);
  const mine = await mySubmission(a.id, viewer.id);
  // My own state when I sing it; the deadline itself for managers; nothing when it isn't my part.
  const headerBadge =
    eligible || mine?.submittedAt
      ? deadlineBadge({
          dueAt: a.dueAt,
          now: at,
          submittedAt: mine?.submittedAt ?? null,
          expected,
        })
      : manager
        ? managerBadge(a.dueAt, at)
        : null;

  let singer: React.ReactNode = null;
  if (eligible || mine?.submittedAt) {
    const [email, [withPart]] = await Promise.all([
      getRecordingEmail(),
      withMyPart([{ id: a.pieceId }], viewer.voicePart),
    ]);
    const subject = viewer.voicePart ? homeworkSubject(a, viewer.voicePart, viewer.name) : "";
    const mailto = email ? mailtoHref(email, subject, homeworkBody(a, a.dueAt, viewer.name)) : null;
    const submitted = Boolean(mine?.submittedAt);
    const toggle = (
      <SubmitToggle
        id={a.id}
        submitted={submitted}
        canUndo={!mine?.feedback}
        pendingBadge={deadlineBadge({ dueAt: a.dueAt, now: at, submittedAt: null, expected })}
        doneBadge={deadlineBadge({
          dueAt: a.dueAt,
          now: at,
          submittedAt: mine?.submittedAt ?? at,
          expected,
        })}
        manualBy={mine?.method === "manual" ? mine.markedByName : null}
      />
    );
    singer = (
      <section className="space-y-4 rounded-2xl border bg-card p-4" aria-labelledby="teslim">
        <h2 id="teslim" className="text-xl font-medium">
          Ödevini teslim et
        </h2>
        {!expected && !submitted && (
          <p className="text-sm text-muted-foreground">
            Sen katılmadan önce verildi; istersen teslim edebilirsin.
          </p>
        )}
        <SingerSteps
          submitted={submitted}
          partButton={
            <PartButton
              myPart={withPart.myPart}
              voicePart={viewer.voicePart}
              pieceId={a.pieceId}
              title={a.pieceTitle}
              hero
            />
          }
          mailto={mailto}
          subject={subject}
          email={email}
          toggle={toggle}
        />
      </section>
    );
  }

  const note = mine?.feedback ? (
    <section
      className="space-y-2 rounded-2xl border-l-4 border-gold bg-gold/10 p-4"
      aria-labelledby="not"
      data-testid="feedback"
    >
      <h2 id="not" className={eyebrow}>
        {mine.feedbackByRole === "conductor" ? "Şefin notu" : "Geri bildirim"}
      </h2>
      <p className="text-sm whitespace-pre-line">{mine.feedback}</p>
      <p className="text-xs text-muted-foreground">
        {mine.feedbackByName ?? "Yönetim"} · {formatShortDateTime.format(mine.feedbackAt!)}
      </p>
      {(!mine.feedbackSeenAt || mine.feedbackSeenAt < mine.feedbackAt!) && (
        <FeedbackSeen id={a.id} />
      )}
    </section>
  ) : null;

  let rosterBlock: React.ReactNode = null;
  let submittedTotal = 0;
  if (manager) {
    const entries = await rosterFor(a, at);
    submittedTotal = await submissionCount(a.id);
    const onlyMissing = sp.filtre === "eksik";
    const counted = entries.filter((e) => !e.left);
    const done = counted.filter((e) => e.state === "done" || e.state === "late").length;
    const missingCount = entries.filter(
      (e) => e.state === "missing" || e.state === "pending",
    ).length;
    const groupParts: (VoicePart | null)[] = [
      ...VOICE_PARTS.filter((p) => a.parts.includes(p) || entries.some((e) => e.part === p)),
      ...(entries.some((e) => e.part === null) ? [null] : []),
    ];
    const groups: RosterGroup[] = groupParts.map((part) => {
      const inPart = entries.filter((e) => e.part === part);
      const countedInPart = inPart.filter((e) => !e.left);
      return {
        part,
        done: countedInPart.filter((e) => e.state === "done" || e.state === "late").length,
        total: countedInPart.length,
        rows: inPart
          .filter((e) => !onlyMissing || e.state === "missing" || e.state === "pending")
          .map((e) => ({
            userId: e.userId,
            name: e.name,
            part: e.part,
            state: e.state,
            stateLabel:
              e.state === "done"
                ? `Teslim edildi ${formatShortDate.format(e.submittedAt!)}`
                : e.state === "late"
                  ? `Geç teslim ${formatShortDate.format(e.submittedAt!)}`
                  : e.state === "missing"
                    ? "Gecikti"
                    : "Bekleniyor",
            manual: e.method === "manual",
            joinedLater: !e.expected,
            left: e.left,
            feedback: e.feedback,
          })),
      };
    });
    rosterBlock = (
      <section id="teslimler" aria-labelledby="teslimler-baslik" className="scroll-mt-20 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="teslimler-baslik" className="text-2xl font-medium">
            Teslimler
          </h2>
          <span className="text-sm tabular-nums" data-testid="roster-total">
            {done}/{counted.length} teslim
          </span>
        </div>
        <nav aria-label="Teslim filtresi" className="flex gap-2">
          <FilterChip href={`/odevler/${a.id}#teslimler`} active={!onlyMissing} label="Tümü" />
          <FilterChip
            href={`/odevler/${a.id}?filtre=eksik#teslimler`}
            active={onlyMissing}
            label="Teslim etmeyenler"
            count={missingCount}
          />
        </nav>
        <Roster assignmentId={a.id} groups={groups} />
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/odevler"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Ödevler
      </Link>
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className={`${eyebrow} pt-2`}>Ödev · {barsLabel(a.barFrom, a.barTo)}</p>
          {manager && <AssignmentMenu id={a.id} title={title} submitted={submittedTotal} />}
        </div>
        <h1 className="text-3xl leading-tight font-medium">{a.pieceTitle}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <PartList parts={a.parts} />
          {headerBadge && <DeadlineChip badge={headerBadge} />}
        </div>
        <DueLine dueAt={a.dueAt} className="block text-sm" />
        <Link
          href={`/repertuvar/${a.pieceId}?partisyon=${partParam(viewer.voicePart)}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          data-testid="piece-link"
        >
          <Library className="size-4" />
          Esere git
        </Link>
      </header>

      {a.description && (
        <section className="rounded-2xl bg-accent/60 p-4">
          <h2 className={eyebrow}>Ne üzerine çalışmalı</h2>
          <p className="mt-1 text-sm whitespace-pre-line">{a.description}</p>
        </section>
      )}

      {mine?.submittedAt ? (
        <>
          {note}
          {singer}
        </>
      ) : (
        <>
          {singer}
          {note}
        </>
      )}

      {!eligible && !mine?.submittedAt && viewer.voicePart && viewer.role !== "conductor" && (
        <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          Bu ödev senin partisyonun için değil.
        </p>
      )}

      {rosterBlock}
    </div>
  );
}
