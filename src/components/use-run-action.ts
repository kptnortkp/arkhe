"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { FormState } from "@/lib/validation";

/** Runs a server action in a transition, toasts its result and refreshes the page. */
export function useRunAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<FormState>, after?: (result: FormState) => void) {
    startTransition(async () => {
      let result: FormState;
      try {
        result = await fn();
      } catch {
        // A thrown action (e.g. a row deleted meanwhile) would otherwise reach the error page.
        result = { error: "Bir şeyler ters gitti, tekrar dene." };
      }
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      after?.(result);
      router.refresh();
    });
  }
  return [pending, run] as const;
}
