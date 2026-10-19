"use client";

import {
  AlertDialog,
  AlertDialogCancel,
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

/** Destructive confirms; Cancel comes first so it gets focus. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actions,
  pending,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actions: ConfirmAction[];
  pending?: boolean;
  /** Extra content between the description and the buttons, e.g. a reason field. */
  children?: React.ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 px-4">Vazgeç</AlertDialogCancel>
          {actions.map((a) => (
            <Button
              key={a.label}
              variant={a.variant ?? "destructive"}
              className="h-11 px-4"
              disabled={pending}
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
