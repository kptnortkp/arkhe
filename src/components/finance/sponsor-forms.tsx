"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createSponsor, updateSponsor } from "@/app/(portal)/finans/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/validation";

type SponsorValues = {
  id: string;
  name: string;
  contactName: string;
  contact: string;
  note: string;
  isActive: boolean;
};

function SponsorSheet({
  sponsor,
  onOpenChange,
}: {
  sponsor: SponsorValues | null;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [clientId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    sponsor ? updateSponsor.bind(null, sponsor.id) : createSponsor,
    {},
  );
  const seen = useRef<FormState | null>(null);
  useEffect(() => {
    if (!state.success || seen.current === state) return;
    seen.current = state;
    toast.success(state.success);
    onOpenChange(false);
    router.refresh();
  }, [state, onOpenChange, router]);
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-xl">
            {sponsor ? "Sponsoru düzenle" : "Yeni sponsor"}
          </SheetTitle>
          <SheetDescription>İletişim bilgileri yalnız yönetimde görünür.</SheetDescription>
        </SheetHeader>
        <form action={action} className="space-y-4 px-4 pb-6" noValidate>
          {!sponsor && <input type="hidden" name="id" value={clientId} />}
          <FormMessage error={state.error} />
          <Field
            label="Ad"
            name="name"
            defaultValue={v?.name ?? sponsor?.name}
            maxLength={120}
            errors={e.name}
          />
          <Field
            label="İlgili kişi"
            name="contactName"
            defaultValue={v?.contactName ?? sponsor?.contactName}
            maxLength={80}
            errors={e.contactName}
          />
          <Field
            label="Telefon veya e-posta"
            name="contact"
            defaultValue={v?.contact ?? sponsor?.contact}
            maxLength={120}
            errors={e.contact}
          />
          <div className="space-y-2">
            <Label htmlFor="sponsor-note">Not</Label>
            <Textarea
              id="sponsor-note"
              name="note"
              rows={3}
              maxLength={500}
              defaultValue={v?.note ?? sponsor?.note}
              className="rounded-xl"
            />
            {e.note?.length ? <p className="text-sm text-destructive">{e.note[0]}</p> : null}
          </div>
          {sponsor && (
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={sponsor.isActive}
                className="size-5 accent-primary"
              />
              Aktif
            </label>
          )}
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

export function NewSponsorButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="h-11 rounded-full px-4" onClick={() => setOpen(true)}>
        <Plus />
        Yeni sponsor
      </Button>
      {open && <SponsorSheet sponsor={null} onOpenChange={setOpen} />}
    </>
  );
}

export function EditSponsorButton({ sponsor }: { sponsor: SponsorValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => setOpen(true)}>
        Düzenle
      </Button>
      {open && <SponsorSheet sponsor={sponsor} onOpenChange={setOpen} />}
    </>
  );
}
