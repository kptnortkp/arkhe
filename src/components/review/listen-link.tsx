import { Headphones } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** `Dinleme` with a count pill (D60), for the conductor and assistants. */
export function ListenLink({ count }: { count: number }) {
  return (
    <Link
      href="/odevler/dinle"
      className={cn(buttonVariants({ variant: "outline" }), "h-11 gap-2 rounded-full px-4")}
      data-testid="listen-link"
    >
      <Headphones />
      Dinleme
      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
        {count}
      </span>
    </Link>
  );
}
