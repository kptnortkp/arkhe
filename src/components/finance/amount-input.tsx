"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { amountInput, formatKurus, parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Turkish money input with a live "Kaydedilecek" echo, the safety net for the dot/comma rule.
 * The first echo comes from the server so hydration never formats differently.
 */
export function AmountInput({
  name = "amount",
  label = "Tutar",
  value,
  onChange,
  initialEcho,
  errors,
  autoFocus,
  inputRef,
  echoPrefix = "Kaydedilecek",
}: {
  name?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  initialEcho?: string | null;
  errors?: string[];
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  echoPrefix?: string;
}) {
  // The server's echo is only valid for the value it was rendered with.
  const [initialValue] = useState(value);
  const [blurError, setBlurError] = useState<string | null>(null);
  const parsed = value.trim() ? parseAmount(value) : null;
  const echo =
    value === initialValue && initialEcho !== undefined
      ? initialEcho
      : parsed?.ok
        ? formatKurus(parsed.kurus)
        : null;
  const error = errors?.[0] ?? blurError;
  const describedBy = [error ? `${name}-error` : null, `${name}-echo`].filter(Boolean).join(" ");

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <div className="relative rounded-xl has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-sans text-2xl text-muted-foreground"
        >
          ₺
        </span>
        <Input
          ref={inputRef}
          id={name}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="next"
          autoFocus={autoFocus}
          value={value}
          placeholder="0,00"
          onChange={(e) => {
            setBlurError(null);
            onChange(e.target.value);
          }}
          onBlur={() => {
            if (!value.trim()) return;
            const p = parseAmount(value);
            if (p.ok) onChange(amountInput(p.kurus));
            else setBlurError(p.error);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn("h-14 rounded-xl pl-9 font-sans text-2xl tabular-nums md:text-2xl")}
        />
      </div>
      {error && (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p
        id={`${name}-echo`}
        data-testid="amount-echo"
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground tabular-nums"
      >
        {echo ? `${echoPrefix}: ${echo}` : ""}
      </p>
    </div>
  );
}
