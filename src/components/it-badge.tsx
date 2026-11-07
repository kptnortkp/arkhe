import { cn } from "@/lib/utils";

/** Marks the choir's IT people (users.handles_reports). */
export function ItBadge({ className }: { className?: string }) {
  return (
    <span
      title="IT sorumlusu"
      data-testid="it-badge"
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-primary/10 px-1.5 py-px align-middle font-sans text-[11px] font-semibold tracking-wide text-primary",
        className,
      )}
    >
      <span aria-hidden>IT</span>
      <span className="sr-only">IT sorumlusu</span>
    </span>
  );
}
