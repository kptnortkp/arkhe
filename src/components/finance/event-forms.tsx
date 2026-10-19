"use client";

import { Music, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createEvent, deleteEvent, updateEvent } from "@/app/(portal)/finans/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRunAction } from "@/components/use-run-action";
import type { FormState } from "@/lib/validation";

type Prefill = { name: string; startsOn: string; rehearsalId: string; label?: string };

function EventSheet({
  open,
  onOpenChange,
  prefill,
  eventId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefill: Prefill;
  eventId?: string;
}) {
  const router = useRouter();
  const [clientId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    eventId ? updateEvent.bind(null, eventId) : createEvent,
    {},
  );
  const seen = useRef<FormState | null>(null);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.success) {
      toast.success(state.success);
      onOpenChange(false);
      if (!eventId && state.values?.id) router.push(`/finans/etkinlikler/${state.values.id}`);
      else router.refresh();
    }
  }, [state, eventId, onOpenChange, router]);
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-xl">
            {eventId ? "Yeniden adlandır" : "Yeni etkinlik"}
          </SheetTitle>
          <SheetDescription>
            {prefill.label
              ? `Konser: ${prefill.label}`
              : "Konser, festival ya da gezi; gelir ve giderler buna bağlanır."}
          </SheetDescription>
        </SheetHeader>
        <form action={action} className="space-y-4 px-4 pb-6" noValidate>
          {!eventId && <input type="hidden" name="id" value={clientId} />}
          {!eventId && <input type="hidden" name="rehearsalId" value={prefill.rehearsalId} />}
          <FormMessage error={state.error ?? e.rehearsalId?.[0]} />
          <Field
            label="Ad"
            name="name"
            defaultValue={v?.name ?? prefill.name}
            maxLength={80}
            placeholder="ör. Kış Konseri 2026"
            errors={e.name}
          />
          <Field
            label="Tarih"
            name="startsOn"
            type="date"
            defaultValue={v?.startsOn ?? prefill.startsOn}
            errors={e.startsOn}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => onOpenChange(false)}
            >
              Vazgeç
            </Button>
            <Button type="submit" className="h-11 px-5" disabled={pending}>
              Kaydet
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function EventToolbar({
  today,
  concerts,
}: {
  today: string;
  concerts: { id: string; name: string; startsOn: string; label: string }[];
}) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        className="h-11 rounded-full px-4"
        onClick={() => setPrefill({ name: "", startsOn: today, rehearsalId: "" })}
      >
        <Plus />
        Yeni etkinlik
      </Button>
      <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => setPicking(true)}>
        <Music />
        Konserden oluştur
      </Button>
      <Sheet open={picking} onOpenChange={setPicking}>
        <SheetContent
          side="bottom"
          className="max-h-[80dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle className="text-xl">Konserden oluştur</SheetTitle>
            <SheetDescription>Etkinliği olmayan konserler.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {concerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Etkinliği olmayan konser yok.</p>
            ) : (
              <ul className="divide-y rounded-2xl border" data-testid="concert-list">
                {concerts.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center px-4 text-left text-sm hover:bg-muted/50"
                      onClick={() => {
                        setPicking(false);
                        setPrefill({
                          name: c.name,
                          startsOn: c.startsOn,
                          rehearsalId: c.id,
                          label: c.label,
                        });
                      }}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {prefill && (
        <EventSheet
          key={prefill.rehearsalId || "new"}
          open
          onOpenChange={(o) => !o && setPrefill(null)}
          prefill={prefill}
        />
      )}
    </div>
  );
}

export function EventMenu({ id, name, startsOn }: { id: string; name: string; startsOn: string }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, run] = useRunAction();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        className="h-11 rounded-full px-4"
        onClick={() => setRenaming(true)}
      >
        Yeniden adlandır
      </Button>
      <Button
        variant="ghost"
        className="h-11 rounded-full px-4 text-destructive hover:text-destructive"
        onClick={() => setDeleting(true)}
      >
        <Trash2 />
        Sil
      </Button>
      {renaming && (
        <EventSheet
          open
          onOpenChange={setRenaming}
          prefill={{ name, startsOn, rehearsalId: "" }}
          eventId={id}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`${name} silinsin mi?`}
        description="Hareket bağlı etkinlik silinemez."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteEvent(id),
                (r) => {
                  setDeleting(false);
                  if (r.success) router.push("/finans/etkinlikler");
                },
              ),
          },
        ]}
      />
    </div>
  );
}
