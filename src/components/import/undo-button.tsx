"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { undoImport } from "@/app/(portal)/ice-aktar/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/validation";

/** Geri al with its confirm; a refusal stays inline because it names the record to fix. */
export function UndoButton({
  batchId,
  added,
  updated,
  finance,
}: {
  batchId: number;
  added: number;
  updated: number;
  finance: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const description = `${[
    added > 0 && `${added} eklenen kayıt silinir`,
    updated > 0 && `${updated} güncellenen kayıt eski hâline döner`,
  ]
    .filter(Boolean)
    .join(", ")}.`;

  function run() {
    startTransition(async () => {
      let result: FormState;
      try {
        result = await undoImport(batchId);
      } catch {
        result = { error: "Bir şeyler ters gitti, tekrar dene." };
      }
      setOpen(false);
      if (result.error) setError(result.error);
      else {
        setError(null);
        toast.success(result.success ?? "İçe aktarma geri alındı.");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className="h-11 rounded-xl px-4"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        <Undo2 aria-hidden />
        Geri al
      </Button>
      <FormMessage error={error ?? undefined} />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Bu içe aktarma geri alınsın mı?"
        description={description}
        pending={pending}
        actions={[{ label: pending ? "Geri alınıyor…" : "Geri al", run }]}
      >
        {finance && (
          <p className="text-sm text-muted-foreground">
            İçe aktarılan hareketler tamamen silinir; bakiyeler aktarım öncesine döner.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
