"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addMonths, defaultName, monthName } from "@/lib/finance/budget";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];
const selectClass =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-60 md:text-sm";

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  return errors?.length ? (
    <p id={id} className="text-sm text-destructive">
      {errors[0]}
    </p>
  ) : null;
}

/** Create (Oluştur) or edit a budget's name, start month and note; approved ones keep name and start. */
export function BudgetMetaForm({
  action,
  defaults,
  year,
  clientId,
  locked = false,
  submitLabel,
  cancelHref,
  doneHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: { start: string; name: string; note: string };
  // Today's Istanbul year: the year choices are around it.
  year: number;
  clientId?: string;
  locked?: boolean;
  submitLabel: string;
  cancelHref: string;
  // Where to go after an edit that returns instead of redirecting.
  doneHref?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const errors = state.fieldErrors ?? {};
  const [start, setStart] = useState(state.values?.start ?? defaults.start);
  const [name, setName] = useState(state.values?.name ?? defaults.name);
  const [nameTyped, setNameTyped] = useState(!clientId);
  const [note, setNote] = useState(state.values?.note ?? defaults.note);
  const [y, m] = start.split("-").map(Number);
  const years = Array.from({ length: 9 }, (_, i) => year - 2 + i);
  if (!years.includes(y)) years.unshift(y);

  useEffect(() => {
    if (!state.success || !doneHref) return;
    toast.success(state.success);
    router.push(doneHref);
  }, [state, doneHref, router]);

  function pick(next: string) {
    setStart(next);
    if (!nameTyped) setName(defaultName(next));
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, formAction)}
      className="space-y-6"
      noValidate
    >
      {clientId && <input type="hidden" name="id" value={clientId} />}
      <input type="hidden" name="start" value={start} />
      <FormMessage
        error={
          state.error ?? (state.fieldErrors ? "Bazı alanları düzeltmen gerekiyor." : undefined)
        }
      />

      <fieldset
        className="space-y-2"
        aria-invalid={errors.start?.length ? true : undefined}
        aria-describedby={errors.start?.length ? "start-error" : "start-end"}
      >
        <legend className="mb-2 text-sm font-medium">Başlangıç ayı</legend>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <div>
            <Label htmlFor="startMonth" className="sr-only">
              Ay
            </Label>
            <select
              id="startMonth"
              value={m}
              disabled={locked}
              aria-invalid={errors.start?.length ? true : undefined}
              onChange={(e) => pick(`${y}-${String(e.target.value).padStart(2, "0")}`)}
              className={selectClass}
            >
              {MONTHS.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="startYear" className="sr-only">
              Yıl
            </Label>
            <select
              id="startYear"
              value={y}
              disabled={locked}
              aria-invalid={errors.start?.length ? true : undefined}
              onChange={(e) => pick(`${e.target.value}-${String(m).padStart(2, "0")}`)}
              className={selectClass}
            >
              {years.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <output
          id="start-end"
          data-testid="budget-end"
          aria-live="polite"
          className="block text-sm text-muted-foreground"
        >
          Bitiş: {monthName(addMonths(start, 11))} · 12 ay
        </output>
        <FieldError id="start-error" errors={errors.start} />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="name">Ad</Label>
        <Input
          id="name"
          name="name"
          value={name}
          readOnly={locked}
          onChange={(e) => {
            setNameTyped(true);
            setName(e.target.value);
          }}
          aria-invalid={errors.name?.length ? true : undefined}
          aria-describedby={errors.name?.length ? "name-error" : "name-hint"}
          className="h-11 rounded-xl text-base read-only:bg-muted/50"
        />
        {errors.name?.length ? (
          <FieldError id="name-error" errors={errors.name} />
        ) : (
          <p id="name-hint" className="text-xs text-muted-foreground">
            {locked ? "Onaylanmış bütçenin adı ve tarihleri değişmez." : "Örn. 2026–27 sezonu"}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">
          Not <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
        </Label>
        <Textarea
          id="note"
          name="note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={errors.note?.length ? true : undefined}
          aria-describedby={errors.note?.length ? "note-error" : "note-hint"}
          className="rounded-xl"
        />
        {errors.note?.length ? (
          <FieldError id="note-error" errors={errors.note} />
        ) : (
          <p id="note-hint" className="text-xs text-muted-foreground">
            {note.length >= 450
              ? `${note.length}/500`
              : "Varsayımlar: “2 konser, 40 korist × aylık 300 ₺”."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending} className="h-11 rounded-full px-6">
          {pending ? "Kaydediliyor…" : submitLabel}
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
