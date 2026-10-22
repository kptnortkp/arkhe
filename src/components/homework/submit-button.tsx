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
