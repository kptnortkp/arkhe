"use client";

import { useLayoutEffect, useRef } from "react";

type FocusPlan = { selectors: string[]; ready?: () => boolean };

/**
 * Focuses the first matching, enabled element once it is in the DOM after a re-render.
 * Moving a keyed row re-mounts its buttons, which would otherwise drop focus to <body>.
 */
export function useFocusAfter() {
  const pending = useRef<FocusPlan | null>(null);
  useLayoutEffect(() => {
    const plan = pending.current;
    // A render before the move commits (e.g. the announcement) must not take the focus early.
    if (!plan || (plan.ready && !plan.ready())) return;
    for (const selector of plan.selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && !el.hasAttribute("disabled")) {
        el.focus();
        pending.current = null;
        return;
      }
    }
  });
  return (first: string | FocusPlan, ...rest: string[]) => {
    pending.current = typeof first === "string" ? { selectors: [first, ...rest] } : first;
  };
}

/** The moved row's buttons (same direction first), once the row sits at index `to`. */
export function moveTargets(id: string, delta: number, to: number): FocusPlan {
  const same = delta < 0 ? "up" : "down";
  const other = delta < 0 ? "down" : "up";
  const row = `[data-row="${id}"]`;
  return {
    selectors: [`${row} [data-move="${same}"]`, `${row} [data-move="${other}"]`],
    ready: () => {
      const el = document.querySelector(row);
      return Boolean(el?.parentElement && Array.from(el.parentElement.children).indexOf(el) === to);
    },
  };
}
