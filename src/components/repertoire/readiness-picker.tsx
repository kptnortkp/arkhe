"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setReadiness } from "@/app/(portal)/repertuvar/readiness-actions";
import type { ReadinessLevel } from "@/db/schema";
import { READINESS_LABELS, READINESS_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ORDER: ReadinessLevel[] = ["not_ready", "partial", "ready"];

/** "Bu eserde ne durumdasın?": three choices; tapping the chosen one again clears it. */
export function ReadinessPicker({
  pieceId,
  level,
}: {
  pieceId: string;
  level: ReadinessLevel | null;
}) {
  const [shown, setShown] = useOptimistic(level);
  const [, startTransition] = useTransition();

  const choose = (next: ReadinessLevel) => {
    const value = shown === next ? null : next;
    startTransition(async () => {
      setShown(value);
      const result = await setReadiness(pieceId, value);
      if (result.error) toast.error(result.error);
    });
  };

  return (
    <section
      aria-labelledby="hazirlik"
      className="space-y-2 rounded-2xl border bg-card p-4"
      data-testid="readiness-picker"
    >
      <div>
        <h2 id="hazirlik" className="font-medium">
          Bu eserde ne durumdasın?
        </h2>
        <p className="text-sm text-muted-foreground">
          Şef partisyonların durumunu görür, çalışmaları buna göre planlar. Seçime tekrar dokunursan kalkar.
        </p>
      </div>
      <div role="group" aria-labelledby="hazirlik" className="grid grid-cols-3 gap-2">
        {ORDER.map((l) => {
          const active = shown === l;
          return (
            <button
              key={l}
              type="button"
              aria-pressed={active}
              onClick={() => choose(l)}
              className={cn(
                "min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? cn(READINESS_STYLES[l].chip, "border-transparent") : "hover:bg-muted/60",
              )}
            >
              {READINESS_LABELS[l]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
