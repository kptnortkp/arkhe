"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { prefillPlan } from "@/app/(portal)/finans/butce/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NO_CHANGE, NO_PRIOR, PLAN_STALE } from "@/lib/finance/budget";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type Category } from "@/lib/finance/categories";
import { CATEGORY_LABELS } from "@/lib/labels";
import { amountInput, formatKurus, formatNet, parsePlanAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

type Values = Record<Category, string>;

const toInput = (kurus: number) => (kurus > 0 ? amountInput(kurus) : "");
const kurusOf = (raw: string) => {
  const p = parsePlanAmount(raw);
  return p.ok ? p.kurus : 0;
};
const sum = (values: Values, cats: readonly Category[]) =>
  cats.reduce((s, c) => s + kurusOf(values[c]), 0);

function AmountRow({
  category,
  value,
  saved,
  approved,
  error,
  onChange,
}: {
  category: Category;
  value: string;
  saved: number;
  approved: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [blurError, setBlurError] = useState<string | null>(null);
  const id = `plan-${category}`;
  const shown = error ?? blurError;
  const changed = approved && kurusOf(value) !== saved;
  return (
    <li
      data-testid="plan-row"
      data-category={category}
      className={cn(
        "relative py-2",
        shown && "bg-destructive/5",
        changed && "before:absolute before:inset-y-1 before:-left-4 before:w-0.5 before:bg-gold",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] items-center gap-x-3">
        <Label htmlFor={id} className="text-sm leading-snug font-normal">
          {CATEGORY_LABELS[category]}
        </Label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          >
            ₺
          </span>
          <Input
            id={id}
            name={category}
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            spellCheck={false}
            placeholder="0"
            value={value}
            onChange={(e) => {
              setBlurError(null);
              onChange(e.target.value);
            }}
            onBlur={() => {
              const p = parsePlanAmount(value);
              if (!p.ok) setBlurError(p.error);
              else onChange(toInput(p.kurus));
            }}
            aria-invalid={shown ? true : undefined}
            aria-describedby={shown ? `${id}-error` : changed ? `${id}-was` : undefined}
            className="h-11 rounded-xl pl-7 text-right text-base tabular-nums md:text-base"
          />
        </div>
      </div>
      {changed && (
        <p id={`${id}-was`} className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
          önceki {formatKurus(saved)}
        </p>
      )}
      {shown && (
        <p id={`${id}-error`} className="mt-1 text-sm text-destructive">
          {shown}
        </p>
      )}
    </li>
  );
}

/** The 17-line plan editor; on an approved budget Kaydet asks for a reason first (D17). */
export function PlanEditor({
  budgetId,
  approved,
  revision,
  lines,
  priorLabel,
  priorFrom,
  priorThrough,
  action,
}: {
  budgetId: string;
  approved: boolean;
  revision: number;
  lines: Record<Category, number>;
  priorLabel: string;
  // The prior window's first month, "Eylül 2026"; used when that window hasn't ended yet.
  priorFrom: string;
  // "21 Ekim 2026" when the prior window ends after today, else null.
  priorThrough: string | null;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({});
  const [pending, startSave] = useTransition();
  const [values, setValues] = useState<Values>(
    () => Object.fromEntries(Object.entries(lines).map(([c, k]) => [c, toInput(k)])) as Values,
  );
  const [reason, setReason] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [prefillConfirm, setPrefillConfirm] = useState(false);
  const [prefilling, startPrefill] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const errors = state.fieldErrors ?? {};

  const income = sum(values, INCOME_CATEGORIES);
  const expense = sum(values, EXPENSE_CATEGORIES);
  const net = income - expense;
  const changes = (Object.keys(lines) as Category[]).filter((c) => kurusOf(values[c]) !== lines[c]);

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("input[aria-invalid=true]")?.focus(),
    );

  function post() {
    const fd = new FormData();
    for (const c of Object.keys(values) as Category[]) fd.set(c, values[c]);
    fd.set("revision", String(revision));
    if (approved) fd.set("reason", reason);
    startSave(async () => {
      let result: FormState;
      try {
        result = await action({}, fd);
      } catch {
        result = { error: "Bir şeyler ters gitti, tekrar dene." };
      }
      setState(result);
      if (result.error === PLAN_STALE) {
        toast.error(PLAN_STALE, { action: { label: "Yenile", onClick: () => router.refresh() } });
      }
      // Amount errors are fixed in the form, not in the dialog.
      if (Object.keys(result.fieldErrors ?? {}).some((k) => k !== "reason")) {
        setReviseOpen(false);
        focusFirstInvalid();
      }
    });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!approved) return post();
    const invalid: Record<string, string[]> = {};
    for (const c of Object.keys(values) as Category[]) {
      const p = parsePlanAmount(values[c]);
      if (!p.ok) invalid[c] = [p.error];
    }
    if (Object.keys(invalid).length) {
      setState({ fieldErrors: invalid });
      return void focusFirstInvalid();
    }
    if (!changes.length) return void toast.info(NO_CHANGE);
    setState({});
    setReviseOpen(true);
  }

  function prefill() {
    setPrefillConfirm(false);
    startPrefill(async () => {
      let r: Awaited<ReturnType<typeof prefillPlan>>;
      try {
        r = await prefillPlan(budgetId);
      } catch {
        return void toast.error("Bir şeyler ters gitti, tekrar dene.");
      }
      if (r.error) return void toast.error(r.error);
      if (r.empty) return void toast.info(r.info ?? NO_PRIOR);
      setValues(
        (cur) =>
          Object.fromEntries(
            (Object.keys(cur) as Category[]).map((c) => [c, toInput(r.lines?.[c] ?? 0)]),
          ) as Values,
      );
      if (r.partial) {
        toast.warning(
          `Önceki dönem henüz bitmedi: yazılan rakamlar yalnızca ${r.throughLabel} tarihine kadarki kayıtlar.`,
        );
      } else toast.success("Önceki 12 ayın rakamları yazıldı. Kaydetmeyi unutma.");
    });
  }

  const group = (legend: string, cats: readonly Category[], total: number, totalLabel: string) => (
    <fieldset className="space-y-2">
      <legend className="flex w-full items-baseline justify-between gap-3">
        <span className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          {legend}
        </span>
        <span className="text-sm font-medium tabular-nums">
          <span className="sr-only">{totalLabel}: </span>
          {formatKurus(total)}
        </span>
      </legend>
      <ul className="divide-y rounded-2xl border bg-card px-4">
        {cats.map((c) => (
          <AmountRow
            key={c}
            category={c}
            value={values[c]}
            saved={lines[c]}
            approved={approved}
            error={errors[c]?.[0]}
            onChange={(v) => setValues((cur) => ({ ...cur, [c]: v }))}
          />
        ))}
      </ul>
    </fieldset>
  );

  return (
    <form ref={formRef} onSubmit={save} className="space-y-6 pb-24 md:pb-0" noValidate>
      <FormMessage
        error={
          state.error && state.error !== PLAN_STALE
            ? state.error
            : Object.keys(errors).some((k) => k !== "reason")
              ? "Bazı tutarları düzeltmen gerekiyor."
              : undefined
        }
      />
      {state.error === PLAN_STALE && <FormMessage error={PLAN_STALE} />}

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          disabled={prefilling}
          className="h-11 w-full rounded-full px-4 sm:w-auto"
          onClick={() =>
            Object.values(values).some((v) => v.trim()) ? setPrefillConfirm(true) : prefill()
          }
        >
          <Sparkles />
          Önceki 12 aydan doldur
        </Button>
        <p data-testid="prefill-hint" className="text-xs text-muted-foreground">
          {priorThrough
            ? `${priorFrom} – ${priorThrough} arası yazılır; bu dönem henüz bitmedi, rakamlar eksik olabilir.`
            : `${priorLabel} gerçekleşenleri yazılır, liraya yukarı yuvarlanır. Kaydetmeden önce değiştirebilirsin.`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {group("Gelir", INCOME_CATEGORIES, income, "Planlanan gelir")}
        {group("Gider", EXPENSE_CATEGORIES, expense, "Planlanan gider")}
      </div>

      <dl data-testid="plan-totals" className="space-y-1.5 rounded-2xl bg-muted p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt>Planlanan gelir</dt>
          <dd className="tabular-nums" data-kurus={income}>
            {formatKurus(income)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Planlanan gider</dt>
          <dd className="tabular-nums" data-kurus={expense}>
            {formatKurus(expense)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 font-medium">
          <dt>Planlanan net</dt>
          <dd className={cn("tabular-nums", net < 0 && "text-absent-ink")} data-kurus={net}>
            {net > 0 ? "+" : ""}
            {formatNet(net)}
          </dd>
        </div>
      </dl>

      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-3 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4 lg:static lg:shadow-none">
        <span aria-hidden className="text-sm whitespace-nowrap tabular-nums">
          Net {net > 0 ? "+" : ""}
          {formatNet(net)}
        </span>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending} className="h-11 rounded-full px-6">
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={prefillConfirm}
        onOpenChange={setPrefillConfirm}
        title="Önceki 12 aydan doldur"
        description="Yazdığın tutarların yerine önceki 12 ayın rakamları yazılsın mı?"
        actions={[{ label: "Doldur", variant: "default", run: prefill }]}
      />

      <ConfirmDialog
        open={reviseOpen}
        onOpenChange={setReviseOpen}
        title="Planı değiştir"
        description="Değişiklik geçmişine şu satırlar yazılacak:"
        pending={pending}
        initialFocus={reasonRef}
        actions={[{ label: "Kaydet", variant: "default", run: post }]}
      >
        <div className="space-y-3">
          <ul data-testid="revise-diff" className="space-y-1 text-sm tabular-nums">
            {changes.map((c) => (
              <li key={c}>
                {CATEGORY_LABELS[c]}: {formatKurus(lines[c])} → {formatKurus(kurusOf(values[c]))}
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="reason">Değişiklik gerekçesi</Label>
            <Textarea
              ref={reasonRef}
              id="reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={errors.reason?.length ? true : undefined}
              aria-describedby={errors.reason?.length ? "reason-error" : "reason-hint"}
              className="rounded-xl"
            />
            {errors.reason?.length ? (
              <p id="reason-error" role="alert" className="text-sm text-destructive">
                {errors.reason[0]}
              </p>
            ) : (
              <p id="reason-hint" className="text-xs text-muted-foreground">
                Örn. “Festival daveti geldi, ulaşım arttı.” Geçmişe yazılır.
              </p>
            )}
            {state.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
          </div>
        </div>
      </ConfirmDialog>
    </form>
  );
}
