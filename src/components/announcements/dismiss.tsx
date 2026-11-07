"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { markAnnouncementRead } from "@/app/(portal)/duyurular/actions";
import { reloadIfStale, STALE_MESSAGE } from "@/components/stale-deploy";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One home-card announcement; "Tamam" hides it at once and marks it read on the server. */
export function DismissibleAnnouncement({
  id,
  title,
  important,
  children,
}: {
  id: string;
  title: string;
  important: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    startTransition(async () => {
      try {
        const result = await markAnnouncementRead(id);
        if (!result.ok) {
          setHidden(false);
          if (result.error) toast.error(result.error);
        }
      } catch (e) {
        setHidden(false);
        toast.error(reloadIfStale(e) ? STALE_MESSAGE : "Bir şeyler ters gitti, tekrar dene.");
      }
      router.refresh();
    });
  }

  return (
    <li
      data-testid="home-announcement"
      data-id={id}
      data-important={important ? "true" : undefined}
      className={cn(
        "space-y-3 rounded-2xl border p-4",
        important ? "border-absent/45 bg-absent/8" : "bg-card",
      )}
    >
      {children}
      <div className="flex justify-end">
        <Button
          type="button"
          variant={important ? "default" : "outline"}
          className={cn(
            "h-11 rounded-full px-5",
            important && "bg-absent text-absent-foreground hover:bg-absent/90",
          )}
          disabled={pending}
          onClick={dismiss}
          aria-label={`Tamam, okudum: ${title}`}
        >
          Tamam
        </Button>
      </div>
    </li>
  );
}
