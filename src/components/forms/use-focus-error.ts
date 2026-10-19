"use client";

import { useEffect, useRef } from "react";
import type { FormState } from "@/lib/validation";

/** After a failed submit, move focus to the first invalid field (or the form message) so it is announced. */
export function useFocusError(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.error && !state.fieldErrors) return;
    // A field first; the form-level alert only when no field is marked.
    const target =
      ref.current?.querySelector<HTMLElement>(
        ":is(input, select, textarea)[aria-invalid=true], fieldset[aria-invalid=true] :is(input, select, textarea)",
      ) ?? ref.current?.querySelector<HTMLElement>("[role=alert]");
    if (target?.getAttribute("role") === "alert") target.tabIndex = -1;
    target?.focus();
  }, [state]);
  return ref;
}
