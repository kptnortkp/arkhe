"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteCalendarEvent } from "@/app/(portal)/yonetim/takvim/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChoiceChips } from "@/components/finance/choice-chips";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/use-run-action";
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS, type CalendarKind } from "@/lib/board/labels";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

export type EventDefaults = {
  title: string;
  kind: CalendarKind;
  day: string;
  startTime: string;
  endTime: string;
  location: string;
  note: string;
};

const optional = <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>;

function Error({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={id} className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function EventForm({
  action,
  defaults,
  clientId,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: EventDefaults;
  clientId?: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const errors = state.fieldErrors ?? {};
  const [kind, setKind] = useState<CalendarKind>(defaults.kind);
  const field = (name: keyof EventDefaults) => ({
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
          placeholder="Bahar konseri"
          className="h-11 rounded-xl text-base"
        />
        <Error id="title-error" error={errors.title?.[0]} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="day">Tarih</Label>
        <Input {...field("day")} type="date" className="h-11 w-auto min-w-44 rounded-xl" />
        <Error id="day-error" error={errors.day?.[0]} />
      </div>

      <ChoiceChips
        legend="Tür"
        name="kind"
        value={kind}
        onChange={setKind}
        errors={errors.kind}
        options={CALENDAR_KINDS.map((k) => ({ value: k, label: CALENDAR_KIND_LABELS[k] }))}
      />

      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="space-y-2">
          <Label htmlFor="startTime">Başlangıç {optional}</Label>
          <Input {...field("startTime")} type="time" className="h-11 rounded-xl" />
          <Error id="startTime-error" error={errors.startTime?.[0]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endTime">Bitiş {optional}</Label>
          <Input {...field("endTime")} type="time" className="h-11 rounded-xl" />
          <Error id="endTime-error" error={errors.endTime?.[0]} />
        </div>
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">Saat girmezsen tüm gün görünür.</p>

      <div className="space-y-2">
        <Label htmlFor="location">Yer {optional}</Label>
        <Input {...field("location")} className="h-11 rounded-xl text-base" />
        <Error id="location-error" error={errors.location?.[0]} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">Not {optional}</Label>
        <Textarea {...field("note")} rows={3} className="min-h-24 rounded-xl" />
        <Error id="note-error" error={errors.note?.[0]} />
      </div>

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

export function EventDelete({ id, title }: { id: string; title: string }) {
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
        Etkinliği sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Etkinlik silinsin mi?"
        description={`“${title}” takvimden kalıcı olarak silinir.`}
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteCalendarEvent(id),
                (r) => r.error && setOpen(false),
              ),
          },
        ]}
      />
    </>
  );
}
