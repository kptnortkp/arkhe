"use client";

import { Check, Clock, MessageSquareText, Minus, X } from "lucide-react";
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

export function Roster({ assignmentId, groups }: { assignmentId: string; groups: RosterGroup[] }) {
  const [selected, setSelected] = useState<RosterRow | null>(null);
  const [pending, run] = useRunAction();
  const submitted = selected && (selected.state === "done" || selected.state === "late");

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
                  return (
                    <li key={r.userId}>
                      <button
                        type="button"
                        data-testid="roster-row"
                        data-state={r.state}
                        aria-label={`${r.name}: ${r.stateLabel}. Not yaz`}
                        onClick={() => setSelected(r)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{r.name}</span>
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
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
                            className,
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden />
                          {r.stateLabel}
                        </span>
                        <MessageSquareText
                          className={cn(
                            "size-4 shrink-0",
                            r.feedback ? "text-primary" : "text-muted-foreground/50",
                          )}
                          aria-hidden
                        />
                      </button>
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
                disabled={pending}
                onClick={() =>
                  run(
                    () => setSubmissionFor(assignmentId, selected.userId, !submitted),
                    () => setSelected(null),
                  )
                }
              >
                {submitted ? "Teslimi kaldır" : "Teslim edildi olarak işaretle"}
              </Button>
              <NoteForm
                key={selected.userId}
                assignmentId={assignmentId}
                row={selected}
                onDone={() => setSelected(null)}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
