"use client";

import { CalendarRange } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { createTerm } from "@/app/(portal)/calismalar/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function TermsDialog({
  terms,
}: {
  terms: { id: string; name: string; startsOn: string; endsOn: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createTerm, {});
  const router = useRouter();
  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      router.refresh();
    }
  }, [state, router]);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="h-10 rounded-full px-4">
        <CalendarRange />
        Dönemler
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dönemler</DialogTitle>
            <DialogDescription>
              Yüzdeler seçilen dönem içindeki çalışmalardan hesaplanır.
            </DialogDescription>
          </DialogHeader>
          {terms.length > 0 && (
            <ul className="divide-y rounded-xl border text-sm">
              {terms.map((t) => (
                <li key={t.id} className="flex justify-between gap-3 px-3 py-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {t.startsOn} → {t.endsOn}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form action={action} className="space-y-3">
            <FormMessage error={state.error} />
            <Field
              label="Ad"
              name="name"
              placeholder="2026–27 Güz"
              defaultValue={state.values?.name}
              errors={state.fieldErrors?.name}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Başlangıç"
                name="startsOn"
                type="date"
                defaultValue={state.values?.startsOn}
                errors={state.fieldErrors?.startsOn}
                required
              />
              <Field
                label="Bitiş"
                name="endsOn"
                type="date"
                defaultValue={state.values?.endsOn}
                errors={state.fieldErrors?.endsOn}
                required
              />
            </div>
            <Button type="submit" disabled={pending} className="h-11 w-full rounded-xl">
              Dönem ekle
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
