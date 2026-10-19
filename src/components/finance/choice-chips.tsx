"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const chipClass =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50";

/** Controlled radio chips: the forms that use them submit without React's reset. */
export function ChoiceChips<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  errors,
  hint,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string; icon?: React.ReactNode; disabled?: boolean }[];
  value: T | "";
  onChange: (value: T) => void;
  errors?: string[];
  hint?: React.ReactNode;
}) {
  const invalid = Boolean(errors?.length);
  return (
    <fieldset
      className="space-y-2"
      aria-invalid={invalid ? true : undefined}
      aria-describedby={invalid ? `${name}-error` : undefined}
    >
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={cn("group", chipClass)}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {/* Selected state doesn't rely on the faint fill alone. */}
            <Check aria-hidden className="hidden size-4 group-has-checked:inline" />
            {o.icon}
            {o.label}
          </label>
        ))}
      </div>
      {invalid ? (
        <p id={`${name}-error`} className={cn("text-sm text-destructive")}>
          {errors![0]}
        </p>
      ) : (
        hint
      )}
    </fieldset>
  );
}
