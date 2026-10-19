"use client";

import { Mail } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { setRecordingEmail } from "@/app/(portal)/odevler/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RecordingEmailDialog({
  current,
  label = "Kayıt e-postası",
  variant = "ghost",
}: {
  current: string | null;
  label?: string;
  variant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setRecordingEmail, {});

  useEffect(() => {
    if (!state.success) return;
    toast.success(state.success);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close after a confirmed save
    setOpen(false);
  }, [state]);

  return (
    <>
      <Button variant={variant} className="h-11 rounded-full px-4" onClick={() => setOpen(true)}>
        <Mail />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form action={action} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>Kayıt e-postası</DialogTitle>
              <DialogDescription>
                Koristlerin &quot;Kaydı e-postayla gönder&quot; düğmesi bu adrese e-posta hazırlar.
              </DialogDescription>
            </DialogHeader>
            <FormMessage error={state.error} />
            <Field
              label="E-posta adresi"
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoComplete="off"
              defaultValue={state.values?.email ?? current ?? ""}
              placeholder="kayit@ornek.org"
              errors={state.fieldErrors?.email}
              hint="Boş bırakırsan e-posta düğmesi gizlenir."
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                onClick={() => setOpen(false)}
              >
                Vazgeç
              </Button>
              <Button type="submit" className="h-11 px-4" disabled={pending}>
                Kaydet
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
