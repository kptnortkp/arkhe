"use client";

import { AudioLines, Check, ChevronRight, Clock, MessageSquareText, Minus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveFeedback, setSubmissionFor } from "@/app/(portal)/odevler/actions";
import { PartDot } from "@/components/part-dot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/use-run-action";
import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type RosterRow = {
  userId: string;
  name: string;
  part: VoicePart | null;
  state: "done" | "late" | "missing" | "pending";
  stateLabel: string;
  manual: boolean;
  joinedLater: boolean;
  left: boolean;
  feedback: string | null;
  /** The current portal take, metadata only. */
  take: { id: string; durationMs: number | null; audioDeleted: boolean } | null;
};

export type RosterGroup = {
  part: VoicePart | null;
  done: number;
  total: number;
  rows: RosterRow[];
};

const STATE_LOOK = {
  done: { className: "bg-present/14 text-present-ink", icon: Check },
  late: { className: "bg-late/18 text-late-ink", icon: Clock },
  pending: { className: "border border-dashed text-muted-foreground", icon: Minus },
  missing: { className: "bg-absent/12 text-absent-ink", icon: X },
};

function NoteForm({
  assignmentId,
  row,
  onDone,
}: {
  assignmentId: string;
  row: RosterRow;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    saveFeedback.bind(null, assignmentId, row.userId),
    {},
  );
  const [text, setText] = useState(row.feedback ?? "");
  const first = row.name.split(/\s+/)[0];

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (!state.success) return;
    toast.success(state.success);
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per action result
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="recordingId" value={row.take?.id ?? ""} />
      <div className="space-y-2">
        <Label htmlFor="feedback">Not</Label>
        <Textarea
          id="feedback"
          name="feedback"
          rows={4}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ör. Girişler çok iyi, 20. ölçüde nefesi erken alıyorsun."
          aria-describedby="feedback-hint"
          className="min-h-24 rounded-xl"
        />
        <p id="feedback-hint" className="text-xs text-muted-foreground">
          {state.fieldErrors?.feedback?.[0] ??
            (text.length >= 800 ? `${text.length}/1000` : `Yalnızca ${first} ve yönetim görür.`)}
        </p>
        {row.feedback && (
          <p className="text-xs text-muted-foreground">
            Not yazıldığı için {first} teslimini geri alamaz.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-12 flex-1 rounded-xl" disabled={pending}>
          Notu kaydet
        </Button>
        {row.feedback && (
          <Button
            type="submit"
            variant="ghost"
            className="h-12 px-4 text-destructive"
            disabled={pending}
            onClick={(e) => {
              // The form reads the DOM value on submit, before React re-renders.
              const field = e.currentTarget.form?.elements.namedItem("feedback");
              if (field instanceof HTMLTextAreaElement) field.value = "";
              setText("");
            }}
          >
            Notu sil
          </Button>
        )}
      </div>
    </form>
  );
}

const clock = (ms: number) => {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
const takeText = (t: NonNullable<RosterRow["take"]>) =>
  t.audioDeleted ? "Kayıt silindi" : `Kayıt · ${t.durationMs === null ? "—" : clock(t.durationMs)}`;

export function Roster({
  assignmentId,
  groups,
  canComment,
}: {
  assignmentId: string;
  groups: RosterGroup[];
  /** Only the conductor writes the comment (D3); the board's sheet has the manual mark only. */
  canComment: boolean;
}) {
  const [selected, setSelected] = useState<RosterRow | null>(null);
  const [pending, run] = useRunAction();
  const submitted = selected && (selected.state === "done" || selected.state === "late");
  const locked = Boolean(submitted && selected?.take && !selected.take.audioDeleted);

  return (
    <>
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.part ?? "none"} className="space-y-2" data-testid="roster-group">
            <h3 className="flex items-center gap-2 font-sans text-sm font-medium">
              <PartDot part={g.part} />
              <span data-testid="roster-group-title">
                {g.part ? VOICE_PART_LABELS[g.part] : "Partisyonsuz"} · {g.done}/{g.total}
              </span>
            </h3>
            {g.rows.length === 0 ? (
              <p className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                Herkes teslim etti.
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {g.rows.map((r) => {
                  const { className, icon: Icon } = STATE_LOOK[r.state];
                  const submittedRow = r.state === "done" || r.state === "late";
                  const review = `/odevler/${assignmentId}/dinle/${r.userId}`;
                  // A row with a take moves the chip under the name so the name keeps the full width.
                  const chip = (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
                        className,
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {r.stateLabel}
                    </span>
                  );
                  return (
                    <li key={r.userId} className="flex items-stretch">
                      <button
                        type="button"
                        data-testid="roster-row"
                        data-state={r.state}
                        onClick={() => setSelected(r)}
                        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" data-testid="roster-name">
                            {r.name}
                          </span>
                          {r.take && (
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              {chip}
                              <span
                                data-testid="roster-recording"
                                className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
                              >
                                <AudioLines className="size-3.5 shrink-0" aria-hidden />
                                {takeText(r.take)}
                              </span>
                            </span>
                          )}
                          {(r.manual || r.joinedLater || r.left) && (
                            <span className="block text-xs text-muted-foreground">
                              {[
                                r.manual && "şef işaretledi",
                                r.joinedLater && "Sonradan katıldı",
                                r.left && "Ayrıldı",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </span>
                        {!r.take && chip}
                        <span className="sr-only">
                          {canComment ? ", yorum yaz" : ", teslimi işaretle"}
                        </span>
                        <MessageSquareText
                          className={cn(
                            "size-4 shrink-0",
                            r.feedback ? "text-primary" : "text-muted-foreground/50",
                          )}
                          aria-hidden
                        />
                      </button>
                      {r.take && canComment && submittedRow && (
                        <Link
                          href={review}
                          prefetch={false}
                          aria-label={`${r.name}: kaydı dinle`}
                          data-testid="roster-listen"
                          className="flex min-h-14 w-11 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                        >
                          <ChevronRight className="size-5" aria-hidden />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          {selected && (
            <>
              <SheetHeader className="p-0">
                <SheetTitle className="font-heading text-xl">{selected.name}</SheetTitle>
                <SheetDescription>
                  {selected.part ? VOICE_PART_LABELS[selected.part] : "Partisyonsuz"} ·{" "}
                  {selected.stateLabel}
                </SheetDescription>
              </SheetHeader>
              <Button
                variant="outline"
                className="h-11 w-full rounded-xl"
                disabled={pending || locked}
                aria-describedby={locked ? "unmark-locked" : undefined}
                onClick={() =>
                  run(
                    () => setSubmissionFor(assignmentId, selected.userId, !submitted),
                    () => setSelected(null),
                  )
                }
              >
                {submitted ? "Teslimi kaldır" : "Teslim edildi olarak işaretle"}
              </Button>
              {locked && (
                <p id="unmark-locked" className="-mt-2 text-xs text-muted-foreground">
                  {canComment
                    ? "Portalda kaydı olduğu için teslim kaldırılamaz; önce kaydı sil."
                    : "Portalda kaydı olduğu için teslim kaldırılamaz. Gerekirse şefe haber ver."}
                </p>
              )}
              {canComment ? (
                <>
                  {submitted && (
                    <Link
                      href={`/odevler/${assignmentId}/dinle/${selected.userId}`}
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      {locked ? "Kayda git" : "Dinle ve yorum yaz"}
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  )}
                  <NoteForm
                    key={selected.userId}
                    assignmentId={assignmentId}
                    row={selected}
                    onDone={() => setSelected(null)}
                  />
                </>
              ) : (
                selected.feedback && (
                  <div className="space-y-1.5 rounded-xl bg-muted p-3 text-sm" data-testid="feedback-readonly">
                    <p className="text-xs font-medium text-muted-foreground">Geri bildirim</p>
                    <p className="whitespace-pre-line">{selected.feedback}</p>
                    <p className="text-xs text-muted-foreground">Bu notu yalnızca şef değiştirebilir.</p>
                  </div>
                )
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
