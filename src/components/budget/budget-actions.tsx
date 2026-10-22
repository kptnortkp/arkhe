"use client";

import { CircleCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { approveBudget, deleteBudget } from "@/app/(portal)/finans/butce/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/use-run-action";

export function ApproveButton({ id, revision }: { id: string; revision: number }) {
  const [pending, run] = useRunAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="h-11 rounded-full px-5" onClick={() => setOpen(true)}>
        <CircleCheck />
        Onayla
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Bütçe onaylansın mı?"
        description="Onaydan sonra adı ve başlangıç ayı değişmez. Tutar değişiklikleri gerekçesiyle geçmişe yazılır."
        pending={pending}
        actions={[
          {
            label: "Onayla",
            variant: "default",
            run: () =>
              run(
                () => approveBudget(id, revision),
                () => setOpen(false),
              ),
          },
        ]}
      />
    </>
  );
}

export function DeleteBudgetButton({ id, name }: { id: string; name: string }) {
  const [pending, run] = useRunAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className="h-11 rounded-full px-4 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        Sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`“${name}” silinsin mi?`}
        description="Plan tutarları da silinir. Kasa hareketleri etkilenmez."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteBudget(id),
                (r) => r.error && setOpen(false),
              ),
          },
        ]}
      />
    </>
  );
}
