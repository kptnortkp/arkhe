"use client";

import { Ban, Paperclip, PenLine, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateEntryMeta, voidEntry } from "@/app/(portal)/finans/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormMessage } from "@/components/forms/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

const select =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type Meta = {
  revision: number;
  description: string;
  counterparty: string;
  eventId: string;
  documentUrl: string;
  withEvent: boolean;
  withDocument: boolean;
  counterpartyLabel: string;
};

function useDone(state: FormState, done: () => void) {
  const router = useRouter();
  const seen = useRef<FormState | null>(null);
  const doneRef = useRef(done);
  useEffect(() => {
    doneRef.current = done;
  });
  useEffect(() => {
    if (!state.success || seen.current === state) return;
    seen.current = state;
    toast.success(state.success);
    doneRef.current();
    router.refresh();
  }, [state, router]);
}

export function EditEntrySheet({
  id,
  meta,
  events,
  open,
  onOpenChange,
  focusDocument = false,
}: {
  id: string;
  meta: Meta;
  events: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusDocument?: boolean;
}) {
  const [state, action, pending] = useActionState(updateEntryMeta.bind(null, id), {});
  useDone(state, () => onOpenChange(false));
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-xl">Kaydı düzenle</SheetTitle>
          <SheetDescription>
            Tutar, tarih, hesap veya kategori yanlışsa &quot;Düzelt&quot;i kullan.
          </SheetDescription>
        </SheetHeader>
        <form action={action} className="space-y-4 px-4 pb-6" noValidate>
          <input type="hidden" name="revision" value={meta.revision} />
          <FormMessage error={state.error} />
          <Field
            label="Açıklama"
            name="description"
            defaultValue={v?.description ?? meta.description}
            maxLength={200}
            errors={errors.description}
          />
          <Field
            label={meta.counterpartyLabel}
            name="counterparty"
            defaultValue={v?.counterparty ?? meta.counterparty}
            maxLength={120}
            errors={errors.counterparty}
          />
          {meta.withEvent && (
            <div className="space-y-2">
              <Label htmlFor="edit-eventId">Etkinlik</Label>
              <select
                id="edit-eventId"
                name="eventId"
                defaultValue={v?.eventId ?? meta.eventId}
                className={select}
              >
                <option value="">Etkinlik yok</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {meta.withDocument && (
            <Field
              label="Belge"
              name="documentUrl"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              defaultValue={v?.documentUrl ?? meta.documentUrl}
              autoFocus={focusDocument}
              placeholder="https://drive.google.com/…"
              errors={errors.documentUrl}
              hint="Makbuz veya faturanın Drive bağlantısı."
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
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

function VoidDialog({
  id,
  summary,
  open,
  onOpenChange,
}: {
  id: string;
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // Called directly, not through useActionState: a successful void unmounts this dialog.
  function submit() {
    const fd = new FormData();
    fd.set("reason", reason);
    startTransition(async () => {
      const result = await voidEntry(id, {}, fd);
      if (result.fieldErrors?.reason) {
        setError(result.fieldErrors.reason[0]);
        requestAnimationFrame(() => reasonRef.current?.focus());
        return;
      }
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      onOpenChange(false);
      router.refresh();
    });
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          setError(null);
        }
        onOpenChange(o);
      }}
      title="Bu kayıt iptal edilsin mi?"
      description={`${summary} toplamlardan çıkar. İptal geri alınamaz; gerekirse yeniden girersin.`}
      pending={pending}
      actions={[{ label: "İptal et", run: submit }]}
    >
      <div className="space-y-2">
        <Label htmlFor="void-reason">İptal nedeni</Label>
        <Textarea
          id="void-reason"
          ref={reasonRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="ör. Aynı ödeme iki kez girilmiş"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "void-reason-error" : undefined}
          className="rounded-xl"
        />
        {error && (
          <p id="void-reason-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}

export function EntryActions({
  id,
  summary,
  meta,
  events,
  correctable,
}: {
  id: string;
  summary: string;
  meta: Meta;
  events: { id: string; name: string }[];
  correctable: boolean;
}) {
  const [editing, setEditing] = useState<false | "all" | "document">(false);
  const [voiding, setVoiding] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {meta.withDocument && !meta.documentUrl && (
        <Button className="h-11 rounded-full px-4" onClick={() => setEditing("document")}>
          <Paperclip />
          Belge ekle
        </Button>
      )}
      <Button
        variant="outline"
        className="h-11 rounded-full px-4"
        onClick={() => setEditing("all")}
      >
        <Pencil />
        Düzenle
      </Button>
      {correctable && (
        <Link
          href={`/finans/yeni?duzelt=${id}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
        >
          <PenLine />
          Düzelt
        </Link>
      )}
      <Button
        variant="ghost"
        className="h-11 rounded-full px-4 text-destructive hover:text-destructive"
        onClick={() => setVoiding(true)}
      >
        <Ban />
        İptal et
      </Button>
      <EditEntrySheet
        id={id}
        meta={meta}
        events={events}
        open={editing !== false}
        focusDocument={editing === "document"}
        onOpenChange={(o) => setEditing(o ? "all" : false)}
      />
      <VoidDialog id={id} summary={summary} open={voiding} onOpenChange={setVoiding} />
    </div>
  );
}
