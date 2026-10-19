"use client";

import { ArrowUpRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Receipt link; Drive files get the same lazy preview as repertoire files. */
export function DocumentLink({ url, previewSrc }: { url: string; previewSrc: string | null }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const panelId = useId();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="document-link"
          className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
        >
          Belgeyi aç
          <span className="sr-only"> (yeni sekmede açılır)</span>
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
        {previewSrc && (
          <Button
            variant="ghost"
            className="h-11 px-3"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              setLoaded(false);
              setOpen(!open);
            }}
          >
            {open ? <EyeOff /> : <Eye />}
            {open ? "Kapat" : "Önizle"}
          </Button>
        )}
      </div>
      {open && previewSrc && (
        <div
          id={panelId}
          role="region"
          aria-label="Belge önizlemesi"
          className="relative aspect-[3/4] max-h-[75dvh] w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border"
        >
          {!loaded && (
            <Loader2 className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-muted-foreground motion-safe:animate-spin" />
          )}
          <iframe
            src={previewSrc}
            title="Belge önizlemesi"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 size-full"
          />
        </div>
      )}
    </div>
  );
}
