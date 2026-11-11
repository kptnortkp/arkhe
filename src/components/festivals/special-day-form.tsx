"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteSpecialDay } from "@/app/(portal)/ozel-gunler/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChoiceChips } from "@/components/finance/choice-chips";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRunAction } from "@/components/use-run-action";
import { SPECIAL_DAY_KINDS, type SpecialDayKind } from "@/db/schema";
import { SPECIAL_DAY_FILL, SPECIAL_DAY_LABELS } from "@/lib/festivals/labels";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

export type SpecialDayDefaults = { day: string; title: string; kind: SpecialDayKind | "" };

export function SpecialDayForm({
  action,
  defaults,
  clientId,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: SpecialDayDefaults;
  clientId?: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const errors = state.fieldErrors ?? {};
  const [kind, setKind] = useState<SpecialDayKind | "">(defaults.kind);
  const field = (name: "day" | "title") => ({
    id: name,
    name,
    defaultValue: (state.values?.[name] as string | undefined) ?? defaults[name],
    "aria-invalid": errors[name]?.length ? true : undefined,
    "aria-describedby": errors[name]?.length ? `${name}-error` : undefined,
  });

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, formAction)}
      className="space-y-6"
      noValidate
    >
      {clientId && <input type="hidden" name="id" value={clientId} />}
      <FormMessage
        error={
          state.error ?? (state.fieldErrors ? "Bazı alanları düzeltmen gerekiyor." : undefined)
        }
      />
      <div className="space-y-2">
        <Label htmlFor="title">Ad</Label>
        <Input
          {...field("title")}
          autoFocus={Boolean(clientId)}
          placeholder="Ramazan Bayramı 1. gün"
          className="h-11 rounded-xl text-base"
        />
        {errors.title?.[0] && (
          <p id="title-error" className="text-sm text-destructive">
            {errors.title[0]}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="day">Tarih</Label>
        <Input {...field("day")} type="date" className="h-11 w-auto min-w-44 rounded-xl" />
        {errors.day?.[0] && (
          <p id="day-error" className="text-sm text-destructive">
            {errors.day[0]}
          </p>
        )}
      </div>
      <ChoiceChips
        legend="Tür"
        name="kind"
        value={kind}
        onChange={setKind}
        errors={errors.kind}
        options={SPECIAL_DAY_KINDS.map((k) => ({
          value: k,
          label: SPECIAL_DAY_LABELS[k],
          icon: (
            <span
              aria-hidden
              className={cn(
                "size-3.5 rounded border border-foreground/15",
                SPECIAL_DAY_FILL[k] || "bg-card",
              )}
            />
          ),
        }))}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending} className="h-11 rounded-full px-6">
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        <Link
          href={cancelHref}
          className={cn(buttonVariants({ variant: "ghost" }), "h-11 rounded-full px-5")}
        >
          Vazgeç
        </Link>
      </div>
    </form>
  );
}

export function SpecialDayDelete({ id, title }: { id: string; title: string }) {
  const [pending, run] = useRunAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className="h-11 px-3 text-sm text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        Özel günü sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Özel gün silinsin mi?"
        description={`“${title}” takvimden kalıcı olarak silinir.`}
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteSpecialDay(id),
                (r) => r.error && setOpen(false),
              ),
          },
        ]}
      />
    </>
  );
}
