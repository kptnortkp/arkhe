"use client";

import { useEffect } from "react";
import { markFeedbackSeen } from "@/app/(portal)/odevler/actions";

/** Marks the note read once it is actually on screen (never during a prefetch). */
export function FeedbackSeen({ id }: { id: string }) {
  useEffect(() => {
    void markFeedbackSeen(id);
  }, [id]);
  return null;
}
