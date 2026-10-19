"use client";

import { useActionState } from "react";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import { setPassword } from "./actions";

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(setPassword.bind(null, token), {});
  const formRef = useFocusError(state);
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage error={state.error} />
      {/* Lets password managers save the login. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
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
        label="Şifre tekrar"
        name="confirm"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.confirm}
        required
      />
      <Button type="submit" disabled={pending} className="h-11 w-full rounded-xl text-sm">
        {pending ? "Kaydediliyor…" : "Şifremi belirle ve giriş yap"}
      </Button>
    </form>
  );
}
