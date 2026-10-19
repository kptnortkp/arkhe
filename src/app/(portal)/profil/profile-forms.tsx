"use client";

import { useActionState } from "react";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import { changePassword, updateProfile } from "./actions";

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const [state, action, pending] = useActionState(updateProfile, {});
  const formRef = useFocusError(state);
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage error={state.error} success={state.success} />
      <Field
        label="Ad soyad"
        name="name"
        defaultValue={state.values?.name ?? name}
        autoComplete="name"
        errors={state.fieldErrors?.name}
        required
      />
      <Field
        label="Telefon"
        name="phone"
        type="tel"
        inputMode="tel"
        defaultValue={state.values?.phone ?? phone ?? ""}
        autoComplete="tel"
        errors={state.fieldErrors?.phone}
      />
      <Button type="submit" disabled={pending} className="h-11 rounded-xl px-6">
        {pending ? "Kaydediliyor…" : "Kaydet"}
      </Button>
    </form>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePassword, {});
  const formRef = useFocusError(state);
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage error={state.error} success={state.success} />
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Field
        label="Mevcut şifre"
        name="current"
        type="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.current}
        required
      />
      <Field
        label="Yeni şifre"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        hint={`En az ${PASSWORD_MIN_LENGTH} karakter.`}
        errors={state.fieldErrors?.password}
        required
      />
      <Field
        label="Yeni şifre tekrar"
        name="confirm"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.confirm}
        required
      />
      <Button type="submit" variant="outline" disabled={pending} className="h-11 rounded-xl px-6">
        {pending ? "Değiştiriliyor…" : "Şifreyi değiştir"}
      </Button>
    </form>
  );
}
