"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms/field";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PIECE_STATUSES } from "@/db/schema";
import { PIECE_STATUS_HINTS, PIECE_STATUS_LABELS } from "@/lib/labels";
import type { FormState } from "@/lib/validation";

const LANGUAGES = [
  "Türkçe",
  "Latince",
  "İngilizce",
  "Almanca",
  "İtalyanca",
  "Fransızca",
  "İspanyolca",
  "Rusça",
  "Ermenice",
  "Kürtçe",
  "Yunanca",
  "Diğer",
];
const VOICINGS = ["SATB", "SSAA", "TTBB", "SSA", "SAB", "SATB divisi", "SSAATTBB"];

export type PieceDefaults = {
  title: string;
  composer: string;
  arranger: string;
  language: string;
  voicing: string;
  duration: string;
  status: string;
  driveFolderUrl: string;
  notes: string;
};

export function PieceForm({
  action,
  defaults,
  submitLabel,
  isNew,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: PieceDefaults;
  submitLabel: string;
  isNew: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const v = { ...defaults, ...state.values };
  const errors = state.fieldErrors ?? {};
  const [notes, setNotes] = useState(v.notes);

  useEffect(() => {
    if (!state.success) return;
    toast.success(state.success);
    if (isNew && state.values?.id)
      router.push(`/repertuvar/${state.values.id}/duzenle#baglantilar`);
  }, [state, isNew, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate>
      <FormMessage
        error={
          state.error ?? (state.fieldErrors ? "Bazı alanları düzeltmen gerekiyor." : undefined)
        }
      />
      <Field
        label="Eser adı"
        name="title"
        defaultValue={v.title}
        errors={errors.title}
        maxLength={120}
        required
        autoFocus={isNew}
      />
      <Field
        label="Besteci"
        name="composer"
        defaultValue={v.composer}
        errors={errors.composer}
        maxLength={120}
        placeholder="ör. W. A. Mozart, Anonim"
      />
      <Field
        label="Düzenleyen"
        name="arranger"
        defaultValue={v.arranger}
        errors={errors.arranger}
        maxLength={120}
        placeholder="Boş bırakabilirsin"
      />
      <div className="grid gap-5 md:grid-cols-3">
        <Field
          label="Dil"
          name="language"
          list="piece-languages"
          defaultValue={v.language}
          errors={errors.language}
          maxLength={40}
          placeholder="ör. Latince"
        />
        <div className="grid grid-cols-[1fr_7rem] gap-3 md:col-span-2 md:grid-cols-2 md:gap-5">
          <Field
            label="Ses dağılımı"
            name="voicing"
            list="piece-voicings"
            defaultValue={v.voicing}
            errors={errors.voicing}
            maxLength={20}
            autoCapitalize="characters"
            placeholder="ör. SATB"
          />
          <Field
            label="Süre"
            name="duration"
            inputMode="decimal"
            defaultValue={v.duration}
            errors={errors.duration}
            placeholder="3:40"
            maxLength={5}
          />
        </div>
      </div>
      <datalist id="piece-languages">
        {LANGUAGES.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <datalist id="piece-voicings">
        {VOICINGS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Durum</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PIECE_STATUSES.map((s) => (
            <label
              key={s}
              className="flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border bg-card px-4 py-2 transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="status"
                value={s}
                defaultChecked={v.status === s}
                className="sr-only"
              />
              <span className="text-sm font-medium">{PIECE_STATUS_LABELS[s]}</span>
              <span className="text-xs text-muted-foreground">{PIECE_STATUS_HINTS[s]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        label="Drive bağlantısı"
        name="driveFolderUrl"
        type="url"
        inputMode="url"
        autoComplete="off"
        defaultValue={v.driveFolderUrl}
        errors={errors.driveFolderUrl}
        placeholder="https://drive.google.com/…"
        hint="Eserin Drive klasörü ya da tek bir Drive dosyası."
      />

      <div className="space-y-2">
        <Label htmlFor="notes">Notlar</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={'Herkes görür. ör. "2. kıtada tekrar yok, coda\'ya atla."'}
          aria-invalid={errors.notes?.length ? true : undefined}
          aria-describedby="notes-hint"
          className="min-h-24 rounded-xl"
        />
        <p id="notes-hint" className="text-xs text-muted-foreground">
          {errors.notes?.[0] ?? (notes.length >= 800 ? `${notes.length}/1000` : "Herkes görür.")}
        </p>
      </div>

      <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl px-6 md:w-auto">
        {submitLabel}
      </Button>
    </form>
  );
}
