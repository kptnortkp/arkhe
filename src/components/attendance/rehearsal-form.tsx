"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/forms/field";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { REHEARSAL_TYPES, VOICE_PARTS, type RehearsalType, type VoicePart } from "@/db/schema";
import { REHEARSAL_TYPE_LABELS, VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

export type RehearsalDefaults = {
  type: RehearsalType;
  date: string;
  start: string;
  end: string;
  title: string;
  location: string;
  note: string;
  parts: VoicePart[];
};

function weeksBetween(from: string, to: string) {
  if (!from || !to || to < from) return 0;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return Math.floor(days / 7) + 1;
}

export function RehearsalForm({
  action,
  defaults,
  allowRepeat,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: RehearsalDefaults;
  allowRepeat: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  const [type, setType] = useState<string>(v?.type ?? defaults.type);
  const [date, setDate] = useState(v?.date ?? defaults.date);
  const [repeat, setRepeat] = useState(v?.repeat === "on");
  const [until, setUntil] = useState(v?.repeatUntil ?? "");
  const count = repeat ? weeksBetween(date, until) : 1;

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      <FormMessage error={state.error} />
      <fieldset
        className="space-y-2"
        onChange={(e) => setType((e.target as unknown as HTMLInputElement).value)}
      >
        <legend className="mb-2 text-sm font-medium">Tür</legend>
        <div className="flex flex-wrap gap-2">
          {REHEARSAL_TYPES.map((t) => (
            <label
              key={t}
              className="flex min-h-11 cursor-pointer items-center rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="type"
                value={t}
                defaultChecked={type === t}
                className="sr-only"
              />
              {REHEARSAL_TYPE_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>

      {type === "sectional" && (
        <fieldset
          className="space-y-2"
          aria-invalid={errors.parts ? true : undefined}
          aria-describedby={errors.parts ? "parts-error" : undefined}
        >
          <legend className="mb-2 text-sm font-medium">Partisyonlar</legend>
          <div className="flex flex-wrap gap-2">
            {VOICE_PARTS.map((p) => (
              <label
                key={p}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="checkbox"
                  name="parts"
                  value={p}
                  defaultChecked={defaults.parts.includes(p)}
                  className="sr-only"
                />
                <span className={cn("size-2 rounded-full", VOICE_PART_STYLES[p].dot)} />
                {VOICE_PART_LABELS[p]}
              </label>
            ))}
          </div>
          {errors.parts && (
            <p id="parts-error" className="text-sm text-destructive">
              {errors.parts[0]}
            </p>
          )}
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Tarih"
          name="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          errors={errors.date}
          required
        />
        <Field
          label="Başlangıç"
          name="start"
          type="time"
          defaultValue={v?.start ?? defaults.start}
          errors={errors.start}
          required
        />
        <Field
          label="Bitiş"
          name="end"
          type="time"
          defaultValue={v?.end ?? defaults.end}
          errors={errors.end}
          required
        />
      </div>
      <Field
        label="Yer"
        name="location"
        defaultValue={v?.location ?? defaults.location}
        placeholder="Örn. Mülkiye Konferans Salonu"
        errors={errors.location}
      />
      <Field
        label="Başlık (isteğe bağlı)"
        name="title"
        defaultValue={v?.title ?? defaults.title}
        hint="Boş bırakırsan türünden üretilir, örn. “Koro çalışması”."
        errors={errors.title}
      />
      <div className="space-y-2">
        <Label htmlFor="note">Not (koroya görünür)</Label>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={500}
          defaultValue={v?.note ?? defaults.note}
          placeholder="Örn. Requiem notalarını getirin."
          className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>

      {allowRepeat && (
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              name="repeat"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
              className="size-5 accent-primary"
            />
            Her hafta tekrarla
          </label>
          {repeat && (
            <>
              <Field
                label="Son tarih"
                name="repeatUntil"
                type="date"
                min={date}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                errors={errors.repeatUntil}
                required
              />
              <p
                className="text-sm text-muted-foreground"
                aria-live="polite"
                data-testid="series-preview"
              >
                {count > 0 ? `${count} çalışma` : "Son tarihi seç"}
              </p>
            </>
          )}
        </div>
      )}

      <Button type="submit" disabled={pending} className="h-11 rounded-xl px-6">
        {pending ? "Kaydediliyor…" : repeat && count > 1 ? `${count} çalışmayı ekle` : submitLabel}
      </Button>
    </form>
  );
}
