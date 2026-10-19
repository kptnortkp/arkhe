"use client";

import { Check, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { submitAssignment, undoSubmission } from "@/app/(portal)/odevler/actions";
import { Button } from "@/components/ui/button";
import type { DeadlineBadge } from "@/lib/homework/deadline";
import { cn } from "@/lib/utils";
import { DeadlineChip } from "./deadline-chip";

/** Row variant: one tap, toast with "Geri al" (the row leaves view when it moves groups). */
export function SubmitRowButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function undo() {
    startTransition(async () => {
      const result = await undoSubmission(id);
      if (result.error) toast.error(result.error);
      else toast.success("Teslim geri alındı.");
      router.refresh();
    });
  }

  return (
    <Button
      variant="outline"
      className="h-11 w-[124px] shrink-0 gap-1.5 rounded-full px-3"
      disabled={pending}
      data-testid="submit-row"
      onClick={() =>
        startTransition(async () => {
          const result = await submitAssignment(id);
          if (result.error) toast.error(result.error);
          else toast.success("Teslim edildi.", { action: { label: "Geri al", onClick: undo } });
          router.refresh();
        })
      }
    >
      <Check />
      Teslim ettim
      <span className="sr-only">: {title}</span>
    </Button>
  );
}

/** Detail variant: the state flips in place; one stable element keeps focus. */
export function SubmitToggle({
  id,
  submitted,
  canUndo,
  pendingBadge,
  doneBadge,
  manualBy,
}: {
  id: string;
  submitted: boolean;
  canUndo: boolean;
  pendingBadge: DeadlineBadge;
  doneBadge: DeadlineBadge;
  manualBy: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useOptimistic(submitted);
  const [announce, setAnnounce] = useState("");

  function toggle() {
    setAnnounce(submitted ? "Teslim geri alındı" : "Teslim edildi");
    startTransition(async () => {
      setDone(!submitted);
      const result = submitted ? await undoSubmission(id) : await submitAssignment(id);
      if (result.error) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3" data-testid="submit-toggle" data-state={done ? "done" : "pending"}>
      <DeadlineChip badge={done ? doneBadge : pendingBadge} />
      {done && manualBy && (
        <p className="text-xs text-muted-foreground">Teslimini {manualBy} işaretledi.</p>
      )}
      {(!done || canUndo) && (
        <Button
          variant={done ? "ghost" : "outline"}
          className={cn("h-12 w-full rounded-2xl text-base", done && "h-11 w-auto px-4 text-sm")}
          disabled={pending}
          onClick={toggle}
        >
          {done ? <Undo2 /> : <Check />}
          {done ? "Geri al" : "Teslim ettim"}
        </Button>
      )}
      <span role="status" className="sr-only">
        {announce}
      </span>
    </div>
  );
}
