import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Radio chips: easier to hit on a phone than a select. */
export function ChoiceGroup({
  legend,
  name,
  options,
  defaultValue,
  errors,
}: {
  legend: string;
  name: string;
  options: {
    value: string;
    label: string;
    dotClass?: string;
    disabled?: boolean;
  }[];
  defaultValue?: string;
  errors?: string[];
}) {
  return (
    <fieldset
      className="space-y-2"
      aria-invalid={errors?.length ? true : undefined}
      aria-describedby={errors?.length ? `${name}-error` : undefined}
    >
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "group flex min-h-10 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              option.disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
              disabled={option.disabled}
              className="sr-only"
            />
            <Check aria-hidden className="hidden size-4 group-has-checked:inline" />
            {option.dotClass && <span className={cn("size-2 rounded-full", option.dotClass)} />}
            {option.label}
          </label>
        ))}
      </div>
      {errors?.length ? (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </fieldset>
  );
}
