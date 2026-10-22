"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { setDuesPush } from "@/app/actions/push";
import { Switch } from "@/components/ui/switch";
import { SWITCH_CLASS } from "./push-client";
import type { FormState } from "@/lib/validation";

/** Finans › Ayarlar: the choir-wide switch for dues notifications. */
export function DuesPushSwitch({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();
  const helpId = useId();
  const labelId = useId();

  function change(next: boolean) {
    setOn(next);
    startTransition(async () => {
      const form = new FormData();
      form.set("on", next ? "1" : "0");
      const result = await setDuesPush({}, form).catch((): FormState => ({
        error: "Bir şeyler ters gitti, tekrar dene.",
      }));
      if (result.error) {
        setOn(!next);
        toast.error(result.error);
      } else toast.success(result.success ?? "Kaydedildi.");
    });
  }

  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-4" data-testid="dues-push">
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block font-medium">
          Aidat bildirimleri
        </span>
        <span id={helpId} className="mt-0.5 block text-sm text-muted-foreground">
          Yönetim kurulu açarsa koristlere aidat dönemi başlangıcında ve ödenmemiş aidat için ayda
          en fazla bir hatırlatma gider. Tutar yazılmaz.
        </span>
      </span>
      <Switch
        checked={on}
        onCheckedChange={change}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        className={SWITCH_CLASS}
      />
    </label>
  );
}
