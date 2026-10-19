"use client";

import { useEffect } from "react";

/** Scrolls the active chip of a horizontally scrolling chip row into view on phones. */
export function ActiveChipIntoView({ label }: { label: string }) {
  useEffect(() => {
    document
      .querySelector(`nav[aria-label="${label}"] [aria-current=page]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [label]);
  return null;
}
