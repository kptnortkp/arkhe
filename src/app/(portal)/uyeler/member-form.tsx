"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFocusError } from "@/components/forms/use-focus-error";
import { ChoiceGroup } from "@/components/forms/choice-group";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { ROLES, VOICE_PARTS, type Role, type VoicePart } from "@/db/schema";
import { ROLE_LABELS, VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import type { MemberFormState } from "./actions";
import { InviteLinkPanel } from "./invite-link-panel";

type Member = {
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  voicePart: VoicePart | null;
  joinedOn: string;
};

export function MemberForm({
  action,
  member,
  actorRole,
  isSelf = false,
  defaultJoinedOn,
}: {
  action: (state: MemberFormState, formData: FormData) => Promise<MemberFormState>;
  member?: Member;
  actorRole: Role;
  isSelf?: boolean;
  defaultJoinedOn: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const errors = state.fieldErrors ?? {};
  const v = state.values;

  if (state.link && !member) {
    return (
      <div className="space-y-6">
        <InviteLinkPanel {...state.link} />
        <div className="flex flex-wrap gap-3">
          <Link href="/uyeler/yeni" className="text-sm font-medium text-primary hover:underline">
            Bir üye daha ekle
          </Link>
          <Link href="/uyeler" className="text-sm font-medium text-primary hover:underline">
            Üye listesine dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      <FormMessage error={state.error} success={state.success} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Ad soyad"
          name="name"
          defaultValue={v?.name ?? member?.name}
          autoComplete="off"
          errors={errors.name}
          required
        />
        <Field
          label="E-posta"
          name="email"
          type="email"
          inputMode="email"
          defaultValue={v?.email ?? member?.email}
          autoComplete="off"
          errors={errors.email}
          required
        />
        <Field
          label="Telefon"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={v?.phone ?? member?.phone ?? ""}
          placeholder="05xx xxx xx xx"
          errors={errors.phone}
        />
        <Field
          label="Koroya katılış tarihi"
          name="joinedOn"
          type="date"
          defaultValue={v?.joinedOn ?? member?.joinedOn ?? defaultJoinedOn}
          hint="Bu tarihten önceki çalışmalarda beklenmez."
          errors={errors.joinedOn}
          required
        />
      </div>
      <ChoiceGroup
        legend="Partisyon"
        name="voicePart"
        defaultValue={v?.voicePart ?? member?.voicePart ?? (member ? "" : undefined)}
        errors={errors.voicePart}
        options={[
          ...VOICE_PARTS.map((part) => ({
            value: part,
            label: VOICE_PART_LABELS[part],
            dotClass: VOICE_PART_STYLES[part].dot,
          })),
          { value: "", label: "Yok (sadece şef)" },
        ]}
      />
      <ChoiceGroup
        legend="Rol"
        name="role"
        defaultValue={v?.role ?? member?.role ?? "member"}
        errors={errors.role}
        options={ROLES.map((role) => ({
          value: role,
          label: ROLE_LABELS[role],
          // Mirrors canEditMember; the server enforces it regardless.
          disabled:
            (isSelf && role !== member?.role) || (actorRole !== "conductor" && role !== "member"),
        }))}
      />
      <Button type="submit" disabled={pending} className="h-11 rounded-xl px-6">
        {pending ? "Kaydediliyor…" : member ? "Kaydet" : "Üyeyi ekle ve davet linki oluştur"}
      </Button>
    </form>
  );
}
