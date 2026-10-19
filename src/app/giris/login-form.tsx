"use client";

import { useActionState } from "react";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { login } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, {});
  const formRef = useFocusError(state);
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage error={state.error} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field
        label="E-posta"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="ornek@mail.com"
        defaultValue={state.values?.email}
        required
      />
      <Field
        label="Şifre"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={pending} className="h-11 w-full rounded-xl text-sm">
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Şifreni unuttuysan şefinden ya da yönetimden yeni link iste.
      </p>
    </form>
  );
}
