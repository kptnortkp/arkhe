"use client";

import { ExternalLink, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { omrState, retryOmr } from "@/app/(portal)/repertuvar/omr-actions";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/use-run-action";
import { OMR_POLL_MS, omrFailureText, type OmrErrorKind, type OmrJobState } from "@/lib/omr/constants";
import { formatTime } from "@/lib/time";

export type StatusJob = {
  id: string;
  state: OmrJobState;
  errorKind: OmrErrorKind | null;
  expected: number | null;
  found: number | null;
  creatorName: string | null;
  createdAt: Date;
  startedAt: Date | null;
  runUrl: string | null;
};

/** Every 10 s while visible and not final; a change refreshes the page (AC 13). */
function usePoll(pieceId: string, job: StatusJob) {
  const router = useRouter();
  const key = `${job.state}:${job.startedAt ? Math.floor(job.startedAt.getTime() / 1000) : ""}`;
  const last = useRef(key);
  useEffect(() => {
    last.current = key;
    if (job.state !== "queued" && job.state !== "running") return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const now = await omrState(pieceId).catch(() => null);
      if (now && now !== last.current) {
        last.current = now;
        router.refresh();
      }
    };
    const timer = setInterval(() => void tick(), OMR_POLL_MS);
    // Coming back to the tab shows the current state at once (AC 13).
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pieceId, job.state, key, router]);
}

function useMinutes(from: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!from) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [from]);
  return from ? Math.max(0, Math.floor((now - from.getTime()) / 60_000)) : 0;
}

export function OmrStatus({ pieceId, job }: { pieceId: string; job: StatusJob }) {
  usePoll(pieceId, job);
  const minutes = useMinutes(job.state === "running" ? job.startedAt : null);
  const [pending, run] = useRunAction();
  // The live region holds the state only, so a screen reader isn't told every new minute.
  const announced =
    job.state === "queued"
      ? "Sırada…"
      : job.state === "running"
        ? "Çevriliyor…"
        : job.state === "succeeded"
          ? "Taslak hazır"
          : `Çeviri başarısız: ${omrFailureText(job.errorKind, job.expected, job.found)}`;
  const text = job.state === "running" ? `Çevriliyor… (${minutes} dk)` : announced;
  return (
    <div className="space-y-2 rounded-2xl border bg-card p-4" data-testid="omr-status">
      <span className="sr-only" aria-live="polite" data-testid="omr-live">
        {announced}
      </span>
      <p
        aria-hidden
        className={job.state === "failed" ? "text-sm font-medium text-absent-ink" : "text-sm font-medium"}
        data-omr-state={job.state}
        data-omr-kind={job.errorKind ?? undefined}
      >
        {text}
      </p>
      {job.creatorName && (
        <p className="text-xs text-muted-foreground">
          {job.creatorName} başlattı · {formatTime.format(job.createdAt)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {job.runUrl && (
          <a
            href={job.runUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline"
          >
            <ExternalLink className="size-4" aria-hidden />
            GitHub&apos;da gör
          </a>
        )}
        {job.state === "failed" && (
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-full px-4"
            disabled={pending}
            onClick={() => run(() => retryOmr(job.id))}
          >
            <RotateCcw />
            Yeniden dene
          </Button>
        )}
      </div>
    </div>
  );
}
