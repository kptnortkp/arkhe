"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Focuses the first matching, enabled element once it is in the DOM after a re-render.
 * Moving a keyed row re-mounts its buttons, which would otherwise drop focus to <body>.
 */
export function useFocusAfter() {
  const pending = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    if (!pending.current) return;
    for (const selector of pending.current) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && !el.hasAttribute("disabled")) {
        el.focus();
        pending.current = null;
        return;
      }
    }
  });
  return (...selectors: string[]) => {
    pending.current = selectors;
  };
}

/** Selectors for the moved row's buttons: same direction first, then the other one. */
export function moveTargets(id: string, delta: number) {
  const same = delta < 0 ? "up" : "down";
  const other = delta < 0 ? "down" : "up";
  return [`[data-row="${id}"] [data-move="${same}"]`, `[data-row="${id}"] [data-move="${other}"]`];
}
