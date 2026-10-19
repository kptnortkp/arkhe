"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { recordDuesPayment } from "@/app/(portal)/finans/aidat/actions";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { amountInput, formatKurus, parseAmount } from "@/lib/money";
import type { FormState } from "@/lib/validation";
import { AmountInput } from "./amount-input";
import { ChoiceChips, chipClass } from "./choice-chips";

export type OpenPeriod = { id: string; name: string; remaining: number };

/** Ödeme al: one amount for one period, or every ticked period paid in full. */
export function PaymentForm({
  memberId,
  open,
  today,
  yesterday,
  onSuccess,
}: {
  memberId: string;
  open: OpenPeriod[];
  today: string;
  yesterday: string;
  onSuccess: (state: FormState) => void;
}) {
  const [state, action, pending] = useActionState(recordDuesPayment, {});
  const formRef = useFocusError(state);
  const [clientId] = useState(() => crypto.randomUUID());
  const [multi, setMulti] = useState(false);
  const [single, setSingle] = useState(open[0]?.id ?? "");
  const [ticked, setTicked] = useState<string[]>(open.slice(0, 1).map((p) => p.id));
  const [amount, setAmount] = useState(open[0] ? amountInput(open[0].remaining) : "");
  const [date, setDate] = useState(today);
  const [account, setAccount] = useState<"cash" | "bank">("cash");
  const seen = useRef<FormState | null>(null);

  useEffect(() => {
    if (!state.success || seen.current === state) return;
    seen.current = state;
    onSuccess(state);
  }, [state, onSuccess]);

  const total = open.filter((p) => ticked.includes(p.id)).reduce((s, p) => s + p.remaining, 0);
  const parsed = parseAmount(amount);
  const label = multi
    ? total > 0
      ? `${formatKurus(total)} al`
      : "Ödeme al"
    : parsed.ok
      ? `${formatKurus(parsed.kurus)} al`
      : "Ödeme al";
  const errors = state.fieldErrors ?? {};

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, action)}
      className="space-y-5"
      noValidate
      data-testid="payment-form"
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="memberId" value={memberId} />
      {multi && <input type="hidden" name="multi" value="1" />}
      {multi && <input type="hidden" name="expected" value={total} />}
      <FormMessage error={state.error} />

      <fieldset
        className="space-y-2"
        aria-invalid={errors.periodIds?.length ? true : undefined}
        aria-describedby={errors.periodIds?.length ? "periodIds-error" : undefined}
      >
        <legend className="mb-2 text-sm font-medium">Dönem</legend>
        <div className="space-y-2">
          {open.map((p) => (
            <label key={p.id} className={`${chipClass} justify-between rounded-xl`}>
              <span className="flex items-center gap-2">
                <input
                  type={multi ? "checkbox" : "radio"}
                  name="periodIds"
                  value={p.id}
                  checked={multi ? ticked.includes(p.id) : single === p.id}
                  onChange={() => {
                    if (multi) {
                      setTicked((t) =>
                        t.includes(p.id) ? t.filter((x) => x !== p.id) : [...t, p.id],
                      );
                    } else {
                      setSingle(p.id);
                      setAmount(amountInput(p.remaining));
                    }
                  }}
                  className="size-4 accent-primary"
                />
                {p.name}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatKurus(p.remaining)} kaldı
              </span>
            </label>
          ))}
        </div>
        {errors.periodIds?.length ? (
          <p id="periodIds-error" className="text-sm text-destructive">
            {errors.periodIds[0]}
          </p>
        ) : null}
      </fieldset>

      {open.length > 1 && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={multi}
            onChange={(e) => {
              setMulti(e.target.checked);
              setTicked(e.target.checked ? open.slice(0, 2).map((p) => p.id) : [single]);
            }}
            className="size-5 accent-primary"
          />
          Birden fazla dönem
        </label>
      )}

      {multi ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Tutar</p>
          <p
            className="text-2xl font-semibold tabular-nums"
            aria-live="polite"
            data-testid="payment-total"
          >
            Toplam {formatKurus(total)} ({ticked.length} dönem)
          </p>
          {errors.amount?.length ? (
            <p role="alert" id="amount-error" className="text-sm text-destructive">
              {errors.amount[0]}
            </p>
          ) : null}
        </div>
      ) : (
        <AmountInput
          value={amount}
          onChange={setAmount}
          initialEcho={open[0] ? formatKurus(open[0].remaining) : null}
          errors={errors.amount}
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="pay-date">Tarih</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="pay-date"
            name="occurredOn"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={errors.occurredOn?.length ? true : undefined}
            aria-describedby={errors.occurredOn?.length ? "pay-date-error" : undefined}
            className="h-11 w-44 rounded-xl"
          />
          <Button
            type="button"
            variant={date === today ? "secondary" : "outline"}
            className="h-11 rounded-full px-4"
            onClick={() => setDate(today)}
          >
            Bugün
          </Button>
          <Button
            type="button"
            variant={date === yesterday ? "secondary" : "outline"}
            className="h-11 rounded-full px-4"
            onClick={() => setDate(yesterday)}
          >
            Dün
          </Button>
        </div>
        {errors.occurredOn?.length ? (
          <p id="pay-date-error" className="text-sm text-destructive">
            {errors.occurredOn[0]}
          </p>
        ) : null}
      </div>

      <ChoiceChips
        legend="Hesap"
        name="account"
        value={account}
        onChange={setAccount}
        options={[
          { value: "cash", label: "Kasa" },
          { value: "bank", label: "Banka" },
        ]}
      />

      <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl text-base">
        {label}
      </Button>
    </form>
  );
}
