"use client";

import type { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type ConfirmAction = {
  label: string;
  run: () => void;
  variant?: "destructive" | "outline" | "default";
};

/** Confirm before an action; Cancel comes first so it gets focus, and the dialog can't close while pending. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actions,
  pending,
  finalFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actions: ConfirmAction[];
  pending?: boolean;
  /** Where focus goes on close when the trigger can't take it (e.g. it is disabled afterwards). */
  finalFocus?: AlertDialogPrimitive.Popup.Props["finalFocus"];
  /** Extra content between the description and the buttons, e.g. a reason field. */
  children?: React.ReactNode;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="sm:max-w-md" finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          {/* A plain button, not Close: Close can't stay focusable while disabled. */}
          <Button
            variant="outline"
            className="h-11 px-4 aria-disabled:opacity-50"
            disabled={pending}
            focusableWhenDisabled
            onClick={() => onOpenChange(false)}
          >
            Vazgeç
          </Button>
          {actions.map((a, i) => (
            <Button
              // Index key: the pending label must not remount the focused button.
              key={i}
              variant={a.variant ?? "destructive"}
              className="h-11 px-4 aria-disabled:opacity-50"
              disabled={pending}
              focusableWhenDisabled
              onClick={a.run}
            >
              {a.label}
            </Button>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
