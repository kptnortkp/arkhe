import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = React.ComponentProps<typeof Input> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
};

export function Field({ label, name, errors, hint, className, ...props }: FieldProps) {
  const id = props.id ?? name;
  const describedBy = errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        className={cn("h-11 rounded-xl", className)}
        {...props}
      />
      {errors?.length ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {errors[0]}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={cn(
        "rounded-xl px-3.5 py-2.5 text-sm",
        error ? "bg-destructive/10 text-destructive" : "bg-success/12 text-success",
      )}
    >
      {error ?? success}
    </p>
  );
}
