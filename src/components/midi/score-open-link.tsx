"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { needsShareSheet } from "@/components/download-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * `Aç`: the browser's own PDF viewer in a new tab, except in the home-screen iPhone app, where
 * that viewer has no way back; there the score opens in the portal's viewer page.
 */
export function ScoreOpenLink({ scoreId, pieceId }: { scoreId: string; pieceId: string }) {
  const router = useRouter();
  return (
    <a
      href={`/api/dosya/nota/${scoreId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline" }), "h-11 shrink-0 rounded-full px-3.5")}
      aria-label="Aç: Nota (PDF)"
      onClick={(event) => {
        if (!needsShareSheet()) return;
        event.preventDefault();
        router.push(`/repertuvar/${pieceId}/nota`);
      }}
    >
      <ExternalLink aria-hidden />
      Aç
    </a>
  );
}
