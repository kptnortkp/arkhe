"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export function CopyButton({
  text,
  label = "Kopyala",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      className={cn("h-11 rounded-xl px-4", className)}
      onClick={async () => {
        if (await copyText(text)) toast.success("Kopyalandı.");
        else toast.error("Kopyalanamadı, metni elle seç.");
      }}
    >
      <Copy />
      {label}
    </Button>
  );
}
