import type { LucideIcon } from "lucide-react";

export function ComingSoon({
  icon: Icon,
  title,
  description,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-medium">{title}</h1>
      <div className="staff-lines flex flex-col items-center gap-4 rounded-3xl border border-dashed bg-card px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-6" strokeWidth={1.8} />
        </span>
        <p className="max-w-sm text-muted-foreground">{description}</p>
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
          {phase}
        </span>
      </div>
    </div>
  );
}
