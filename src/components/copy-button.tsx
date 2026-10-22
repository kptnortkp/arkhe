"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Clipboard API, then the execCommand fallback for older in-app browsers. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    area.remove();
    return ok;
  }
}

/** Copies with a toast; when the browser refuses, shows the text selected in a dialog instead. */
export function useCopy(title = "Metni kopyala") {
  const [fallback, setFallback] = useState<string | null>(null);
  async function copy(text: string, toastText = "Kopyalandı.") {
    if (await copyText(text)) toast.success(toastText);
    else setFallback(text);
  }
  const dialog = (
    <Dialog open={fallback !== null} onOpenChange={(open) => !open && setFallback(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Metin seçili; kopyalamak için basılı tut ya da Ctrl/⌘+C.
          </DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          autoFocus
          rows={12}
          value={fallback ?? ""}
          aria-label={title}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-input bg-transparent p-2.5 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </DialogContent>
    </Dialog>
  );
  return [copy, dialog] as const;
}

export function CopyButton({
  text,
  label = "Kopyala",
  toastText,
  fallbackTitle,
  variant = "outline",
  className,
}: {
  text: string;
  label?: string;
  toastText?: string;
  fallbackTitle?: string;
  variant?: "outline" | "default";
  className?: string;
}) {
  const [copy, dialog] = useCopy(fallbackTitle);
  return (
    <>
      <Button
        variant={variant}
        className={cn("h-11 rounded-xl px-4", className)}
        onClick={() => copy(text, toastText)}
      >
        <Copy />
        {label}
      </Button>
      {dialog}
    </>
  );
}
