"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteFestival } from "@/app/(portal)/yonetim/festivaller/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChoiceChips } from "@/components/finance/choice-chips";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/use-run-action";
import {
  FESTIVAL_REGIONS,
  FESTIVAL_STATUSES,
  type FestivalRegion,
  type FestivalStatus,
} from "@/db/schema";
import { FESTIVAL_STATUS_LABELS, REGION_LABELS } from "@/lib/festivals/labels";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

export type FestivalDefaults = {
  name: string;
  region: FestivalRegion | "";
  status: FestivalStatus;
  startsOn: string;
  endsOn: string;
  dateNote: string;
  deadlineOn: string;
  deadlineNote: string;
  fee: string;
  place: string;
  url: string;
  linkLabel: string;
  note: string;
};

const optional = <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>;

function Error({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={id} className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function FestivalForm({
  action,
  defaults,
  clientId,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: FestivalDefaults;
  clientId?: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const errors = state.fieldErrors ?? {};
  const [region, setRegion] = useState<FestivalRegion | "">(defaults.region);
  const [status, setStatus] = useState<FestivalStatus>(defaults.status);
  const field = (name: keyof FestivalDefaults) => ({
    id: name,
    name,
    defaultValue: (state.values?.[name] as string | undefined) ?? defaults[name],
    "aria-invalid": errors[name]?.length ? true : undefined,
    "aria-describedby": errors[name]?.length ? `${name}-error` : undefined,
  });
  const text = (name: keyof FestivalDefaults, label: string, hint?: string) => (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label} {optional}
      </Label>
      <Input {...field(name)} className="h-11 rounded-xl text-base" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Error id={`${name}-error`} error={errors[name]?.[0]} />
    </div>
  );
  const date = (name: keyof FestivalDefaults, label: string) => (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label} {optional}
      </Label>
      <Input {...field(name)} type="date" className="h-11 rounded-xl" />
      <Error id={`${name}-error`} error={errors[name]?.[0]} />
    </div>
  );

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, formAction)}
      className="space-y-6"
      noValidate
    >
      {clientId && <input type="hidden" name="id" value={clientId} />}
      <FormMessage
        error={
          state.error ?? (state.fieldErrors ? "Bazı alanları düzeltmen gerekiyor." : undefined)
        }
      />

      <div className="space-y-2">
        <Label htmlFor="name">Ad</Label>
        <Input
          {...field("name")}
          autoFocus={Boolean(clientId)}
          placeholder="İzmir Uluslararası Korolar Festivali"
          className="h-11 rounded-xl text-base"
        />
        <Error id="name-error" error={errors.name?.[0]} />
      </div>

      <ChoiceChips
        legend="Nerede"
        name="region"
        value={region}
        onChange={setRegion}
        errors={errors.region}
        options={FESTIVAL_REGIONS.map((r) => ({ value: r, label: REGION_LABELS[r] }))}
      />

      <ChoiceChips
        legend="Durum"
        name="status"
        value={status}
        onChange={setStatus}
        errors={errors.status}
        options={FESTIVAL_STATUSES.map((s) => ({ value: s, label: FESTIVAL_STATUS_LABELS[s] }))}
      />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Festival tarihi</legend>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          {date("startsOn", "Başlangıç")}
          {date("endsOn", "Bitiş")}
        </div>
        {text(
          "dateNote",
          "Tarih notu",
          "Kesin tarih yoksa, örneğin “Kasım 2027”. Doluysa tarihlerin yerine bu görünür.",
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Başvuru</legend>
        <div className="sm:max-w-56">{date("deadlineOn", "Son başvuru günü")}</div>
        {text(
          "deadlineNote",
          "Başvuru notu",
          "Örneğin “Erken kayıt 31 Aralık; son 15 Nisan” ya da “Henüz açıklanmadı”.",
        )}
        <p className="text-xs text-muted-foreground">
          Durum “Takipte” iken (henüz başvurmadıysak) şef ve YK&apos;ya son günden 14, 7, 3 ve 1 gün
          önce ve son gün bildirim gider. Başvurduk ya da Katılıyoruz seçilince bunlar durur; bunun
          yerine festivalden 30, 7 ve 1 gün önce “Festival yaklaşıyor” bildirimi gelir.
        </p>
      </fieldset>

      {text("fee", "Katılım ücreti")}
      {text("place", "Yer", "Şehir ya da ülke.")}
      {text("url", "Bağlantı", "Festivalin sitesi ya da şartnamesi.")}
      {text("linkLabel", "Bağlantı adı", "Boş bırakırsan bağlantının kendisi görünür.")}

      <div className="space-y-2">
        <Label htmlFor="note">Not {optional}</Label>
        <Textarea {...field("note")} rows={3} className="min-h-24 rounded-xl" />
        <Error id="note-error" error={errors.note?.[0]} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending} className="h-11 rounded-full px-6">
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        <Link
          href={cancelHref}
          className={cn(buttonVariants({ variant: "ghost" }), "h-11 rounded-full px-5")}
        >
          Vazgeç
        </Link>
      </div>
    </form>
  );
}

export function FestivalDelete({ id, name }: { id: string; name: string }) {
  const [pending, run] = useRunAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className="h-11 px-3 text-sm text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        Festivali sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Festival silinsin mi?"
        description={`“${name}” listeden kalıcı olarak silinir.`}
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteFestival(id),
                (r) => r.error && setOpen(false),
              ),
          },
        ]}
      />
    </>
  );
}
