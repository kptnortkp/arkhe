"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { PartDot } from "@/components/part-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VOICE_PARTS, type PieceStatus, type VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import type { FormState } from "@/lib/validation";

export type AssignmentDefaults = {
  pieceId: string;
  barFrom: string;
  barTo: string;
  parts: VoicePart[];
  dueDate: string;
  dueTime: string;
  description: string;
};

const chip =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";
const selectClass =
  "h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  return errors?.length ? (
    <p id={id} className="text-sm text-destructive">
      {errors[0]}
    </p>
  ) : null;
}

export function AssignmentForm({
  action,
  defaults,
  pieces,
  submitLabel,
  clientId,
  version,
  minDate,
  submittedCount = 0,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: AssignmentDefaults;
  pieces: { id: string; title: string; status: PieceStatus }[];
  submitLabel: string;
  clientId?: string;
  version?: number;
  minDate?: string;
  submittedCount?: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  // Controlled, so a failed submit keeps the ticked parts.
  const [parts, setParts] = useState<VoicePart[]>(defaults.parts);
  const [description, setDescription] = useState(v?.description ?? defaults.description);
  const tuttiRef = useRef<HTMLInputElement>(null);
  const all = parts.length === VOICE_PARTS.length;

  useEffect(() => {
    if (tuttiRef.current) tuttiRef.current.indeterminate = parts.length > 0 && !all;
  }, [parts, all]);

  useEffect(() => {
    if (!state.success) return;
    toast.success(state.success);
    if (state.values?.id) router.push(`/odevler/${state.values.id}`);
  }, [state, router]);

  const barErrors = errors.bars ?? errors.barFrom ?? errors.barTo;
  const groups: [string, PieceStatus][] = [
    ["Çalışılıyor", "learning"],
    ["Hazır", "concert"],
    ["Arşiv", "archive"],
  ];

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, formAction)}
      className="space-y-6"
      noValidate
    >
      {clientId && <input type="hidden" name="id" value={clientId} />}
      {version !== undefined && <input type="hidden" name="version" value={version} />}
      <FormMessage
        error={
          state.error ?? (state.fieldErrors ? "Bazı alanları düzeltmen gerekiyor." : undefined)
        }
      />

      <div className="space-y-2">
        <Label htmlFor="pieceId">Eser</Label>
        <select
          id="pieceId"
          name="pieceId"
          defaultValue={v?.pieceId ?? defaults.pieceId}
          className={selectClass}
          aria-invalid={errors.pieceId?.length ? true : undefined}
          aria-describedby={errors.pieceId?.length ? "pieceId-error" : undefined}
        >
          <option value="">Eser seç</option>
          {groups.map(([label, status]) => {
            const items = pieces.filter((p) => p.status === status);
            return items.length ? (
              <optgroup key={status} label={label}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {status === "archive" ? `${p.title} (Arşiv)` : p.title}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
        <FieldError id="pieceId-error" errors={errors.pieceId} />
      </div>

      <fieldset
        className="space-y-2"
        aria-invalid={barErrors?.length ? true : undefined}
        aria-describedby={barErrors?.length ? "bars-error" : "bars-hint"}
      >
        <legend className="mb-2 text-sm font-medium">Ölçüler</legend>
        <div className="flex items-center gap-3">
          <Label htmlFor="barFrom" className="sr-only">
            Başlangıç
          </Label>
          <Input
            id="barFrom"
            name="barFrom"
            aria-invalid={barErrors?.length ? true : undefined}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="Başlangıç"
            defaultValue={v?.barFrom ?? defaults.barFrom}
            className="h-11 w-28 rounded-xl"
          />
          <span aria-hidden>–</span>
          <Label htmlFor="barTo" className="sr-only">
            Bitiş
          </Label>
          <Input
            id="barTo"
            name="barTo"
            aria-invalid={barErrors?.length ? true : undefined}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="Bitiş"
            defaultValue={v?.barTo ?? defaults.barTo}
            className="h-11 w-28 rounded-xl"
          />
        </div>
        {barErrors?.length ? (
          <FieldError id="bars-error" errors={barErrors} />
        ) : (
          <p id="bars-hint" className="text-xs text-muted-foreground">
            Boş bırakırsan tüm eser.
          </p>
        )}
      </fieldset>

      <fieldset
        className="space-y-2"
        aria-invalid={errors.parts?.length ? true : undefined}
        aria-describedby={errors.parts?.length ? "parts-error" : undefined}
      >
        <legend className="mb-2 text-sm font-medium">Partisyonlar</legend>
        <div className="flex flex-wrap gap-2">
          <label className={chip}>
            <input
              ref={tuttiRef}
              type="checkbox"
              checked={all}
              onChange={() => setParts(all ? [] : [...VOICE_PARTS])}
              className="sr-only"
            />
            <PartDot part={null} />
            Tutti
          </label>
          {VOICE_PARTS.map((p) => (
            <label key={p} className={chip}>
              <input
                type="checkbox"
                name="parts"
                value={p}
                checked={parts.includes(p)}
                onChange={() =>
                  setParts((cur) =>
                    cur.includes(p)
                      ? cur.filter((x) => x !== p)
                      : VOICE_PARTS.filter((x) => x === p || cur.includes(x)),
                  )
                }
                className="sr-only"
              />
              <PartDot part={p} />
              {VOICE_PART_LABELS[p]}
            </label>
          ))}
        </div>
        <FieldError id="parts-error" errors={errors.parts} />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Son tarih</legend>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <div>
            <Label htmlFor="dueDate" className="sr-only">
              Tarih
            </Label>
            <Input
              id="dueDate"
              name="dueDate"
              type="date"
              min={minDate}
              defaultValue={v?.dueDate ?? defaults.dueDate}
              aria-invalid={errors.dueDate?.length ? true : undefined}
              aria-describedby={errors.dueDate?.length ? "dueDate-error" : "due-hint"}
              className="h-11 rounded-xl"
            />
          </div>
          <div>
            <Label htmlFor="dueTime" className="sr-only">
              Saat
            </Label>
            <Input
              id="dueTime"
              name="dueTime"
              type="time"
              defaultValue={v?.dueTime ?? defaults.dueTime}
              aria-invalid={errors.dueTime?.length ? true : undefined}
              className="h-11 rounded-xl"
            />
          </div>
        </div>
        {errors.dueDate?.length || errors.dueTime?.length ? (
          <FieldError id="dueDate-error" errors={errors.dueDate ?? errors.dueTime} />
        ) : (
          <p id="due-hint" className="text-xs text-muted-foreground">
            Türkiye saati
          </p>
        )}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="description">Açıklama</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={'Herkes görür. ör. "Metronom 60, 20. ölçüde nefes yok."'}
          aria-describedby="description-hint"
          className="min-h-24 rounded-xl"
        />
        <p id="description-hint" className="text-xs text-muted-foreground">
          {errors.description?.[0] ??
            (description.length >= 800 ? `${description.length}/1000` : "Herkes görür.")}
        </p>
      </div>

      {submittedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {submittedCount} kişi teslim etti. Partisyonları değiştirirsen teslimleri silinmez.
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl px-6 md:w-auto">
        {submitLabel}
      </Button>
    </form>
  );
}
