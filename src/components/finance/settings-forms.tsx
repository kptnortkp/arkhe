"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { setOpeningBalances, setPaymentInfo } from "@/app/(portal)/finans/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/validation";

function useToast(state: FormState) {
  const seen = useRef<FormState | null>(null);
  useEffect(() => {
    if (!state.success || seen.current === state) return;
    seen.current = state;
    toast.success(state.success);
  }, [state]);
}

export function OpeningForm({ date, cash, bank }: { date: string; cash: string; bank: string }) {
  const [state, action, pending] = useActionState(setOpeningBalances, {});
  useToast(state);
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate data-testid="opening-form">
      <FormMessage error={state.error} />
      <Field
        label="Tarih"
        name="openedOn"
        type="date"
        defaultValue={v?.openedOn ?? date}
        errors={e.openedOn}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Kasa"
          name="cash"
          inputMode="decimal"
          defaultValue={v?.cash ?? cash}
          placeholder="0,00"
          errors={e.cash}
        />
        <Field
          label="Banka"
          name="bank"
          inputMode="decimal"
          defaultValue={v?.bank ?? bank}
          placeholder="0,00"
          errors={e.bank}
        />
      </div>
      <Button type="submit" className="h-11 rounded-full px-5" disabled={pending}>
        Kaydet
      </Button>
    </form>
  );
}

export function PaymentInfoForm({ info }: { info: string }) {
  const [state, action, pending] = useActionState(setPaymentInfo, {});
  const [text, setText] = useState(info);
  useToast(state);
  const error = state.fieldErrors?.info?.[0];
  return (
    <form action={action} className="space-y-3" noValidate data-testid="payment-info-form">
      <FormMessage error={state.error} />
      <div className="space-y-2">
        <Label htmlFor="info">Ödeme bilgisi</Label>
        <Textarea
          id="info"
          name="info"
          rows={4}
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          placeholder="IBAN TR00 0000 … · Alıcı: Arkhe Korosu · Açıklamaya adını ve ayı yaz."
          aria-invalid={error ? true : undefined}
          aria-describedby="info-hint"
          className="rounded-xl"
        />
        <p
          id="info-hint"
          className={error ? "text-sm text-destructive" : "text-xs text-muted-foreground"}
        >
          {error ??
            (text.length >= 400 ? `${text.length}/500` : "Koristler Aidatım bölümünde bunu görür.")}
        </p>
      </div>
      {text.trim() && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Koristler böyle görür:</p>
          <p className="rounded-xl bg-muted p-3 font-mono text-sm break-words whitespace-pre-line">
            {text.trim()}
          </p>
        </div>
      )}
      <Button type="submit" className="h-11 rounded-full px-5" disabled={pending}>
        Kaydet
      </Button>
    </form>
  );
}
