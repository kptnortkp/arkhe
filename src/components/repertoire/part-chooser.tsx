"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowUpRight, AudioLines, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** One dialog that is a bottom sheet on phones and a centred dialog from md, switched by CSS only. */
export function PartChooser({
  pieceId,
  title,
  description,
  links,
  className,
  dot,
  text,
}: {
  pieceId: string;
  title: string;
  description: string;
  links: { id: string; url: string; label: string }[];
  className: string;
  dot: React.ReactNode;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger className={className} aria-haspopup="dialog">
        {dot}
        {text}
        <span className="sr-only">: {title}</span>
        <ChevronDown className="size-3.5" aria-hidden />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          data-testid="part-chooser"
          className="fixed inset-x-0 bottom-0 z-50 space-y-4 rounded-t-3xl bg-popover p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-popover-foreground ring-1 ring-foreground/10 outline-none md:inset-auto md:top-1/2 md:left-1/2 md:w-full md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <div className="space-y-1">
            <DialogPrimitive.Title className="font-heading text-xl font-medium">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          </div>
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.id}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex min-h-14 items-center gap-3 rounded-xl px-4 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <AudioLines className="size-5 text-muted-foreground" aria-hidden />
                  <span className="flex-1 font-medium">{link.label}</span>
                  <span className="sr-only">, yeni sekmede açılır</span>
                  <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/repertuvar/${pieceId}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
            >
              Eserin tüm bağlantıları
            </Link>
            <DialogPrimitive.Close render={<Button variant="ghost" className="h-11 px-4" />}>
              Kapat
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
