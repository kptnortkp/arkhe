"use client";

import { ArrowUpDown, ChevronDown, ChevronUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { clearProgram, removeFromProgram, reorderProgram } from "@/app/(portal)/repertuvar/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { moveTargets, useFocusAfter } from "./use-focus-after";

type Item = { id: string; title: string };

export function ProgramEditor({ pieces, children }: { pieces: Item[]; children: React.ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useOptimistic(pieces);
  const focusAfter = useFocusAfter();

  function run(fn: () => Promise<{ error?: string; success?: string }>, next?: Item[]) {
    startTransition(async () => {
      if (next) setItems(next);
      const result = await fn();
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      router.refresh();
    });
  }

  function move(index: number, delta: number) {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setAnnounce(`${item.title} programda ${index + delta + 1}. sırada.`);
    run(() => reorderProgram(next.map((i) => i.id)), next);
    focusAfter(...moveTargets(item.id, delta));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button data-done className="h-11 rounded-full px-4" onClick={() => setEditing(false)}>
              Bitti
            </Button>
            <Button
              variant="ghost"
              className="h-11 rounded-full px-4 text-destructive"
              onClick={() => setConfirmClear(true)}
            >
              Programı temizle
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="h-11 rounded-full px-4"
            onClick={() => setEditing(true)}
          >
            <ArrowUpDown />
            Sırayı düzenle
          </Button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {editing ? (
        <ol
          className="divide-y overflow-hidden rounded-2xl border bg-card"
          data-testid="program-edit"
        >
          {items.map((item, i) => (
            <li
              key={item.id}
              data-row={item.id}
              className="flex min-h-16 items-center gap-2 pr-1 pl-4"
            >
              <span
                aria-hidden
                className="w-7 shrink-0 font-heading text-2xl text-muted-foreground tabular-nums"
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
              <Button
                variant="ghost"
                className="size-11"
                data-move="up"
                disabled={i === 0}
                aria-label={`Yukarı taşı: ${item.title}`}
                onClick={() => move(i, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                className="size-11"
                data-move="down"
                disabled={i === items.length - 1}
                aria-label={`Aşağı taşı: ${item.title}`}
                onClick={() => move(i, 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                variant="ghost"
                className="size-11"
                data-remove
                aria-label={`Programdan çıkar: ${item.title}`}
                onClick={() => {
                  const neighbour = items[i + 1] ?? items[i - 1];
                  focusAfter(
                    neighbour ? `[data-row="${neighbour.id}"] [data-remove]` : "[data-done]",
                  );
                  setAnnounce(`${item.title} programdan çıkarıldı.`);
                  run(
                    () => removeFromProgram(item.id),
                    items.filter((x) => x.id !== item.id),
                  );
                }}
              >
                <X />
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="divide-y overflow-hidden rounded-2xl border bg-card">{children}</ol>
      )}
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Program temizlensin mi?"
        description={`${items.length} eser programdan çıkar. Eserler ve bağlantıları silinmez.`}
        pending={pending}
        actions={[
          {
            label: "Programı temizle",
            run: () => {
              setConfirmClear(false);
              setEditing(false);
              run(clearProgram, []);
            },
          },
        ]}
      />
    </div>
  );
}
