"use client";

import { History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { removeWaiver, setDuesRate, setWaiver } from "@/app/(portal)/finans/aidat/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { DuesRate } from "@/lib/finance/categories";
import type { FormState } from "@/lib/validation";
import { useRunAction } from "@/components/use-run-action";
import { ChoiceChips } from "./choice-chips";
import { PaymentForm, type OpenPeriod } from "./payment-form";

function useToastOnSuccess(state: FormState, toastErrors = true) {
  const router = useRouter();
  const seen = useRef<FormState | null>(null);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.success) {
      toast.success(state.success);
      router.refresh();
    } else if (state.error && toastErrors) toast.error(state.error);
  }, [state, router, toastErrors]);
}

/** Sheet opened by ?uye=; its content is rendered on the server for that one member. */
export function UrlSheet({
  title,
  description,
  closeHref,
  children,
}: {
  title: string;
  description: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        setOpen(false);
        router.replace(closeHref, { scroll: false });
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-lg"
        data-testid="member-sheet"
      >
        <SheetHeader>
          <SheetTitle className="text-xl">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-8">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

function AuditLine({ text, testId }: { text: string; testId: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid={testId}>
      <History className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

export function RateForm({
  userId,
  rate,
  note,
  audit,
}: {
  userId: string;
  rate: DuesRate;
  note: string;
  audit: string | null;
}) {
  const [state, action, pending] = useActionState(setDuesRate.bind(null, userId), {});
  const [value, setValue] = useState<DuesRate>(rate);
  useToastOnSuccess(state);
  return (
    <form
      onSubmit={(e) => submitWithoutReset(e, action)}
      className="space-y-4"
      noValidate
      data-testid="rate-form"
    >
      <ChoiceChips
        legend="Aidat oranı"
        name="rate"
        value={value}
        onChange={setValue}
        errors={state.fieldErrors?.rate}
        options={[
          { value: "standard", label: "Tam" },
          { value: "reduced", label: "İndirimli" },
          { value: "exempt", label: "Muaf" },
        ]}
        hint={
          <>
            <p className="text-xs text-muted-foreground">
              Ödenmemiş dönemlerin borcu yeni orana göre hesaplanır.
            </p>
            {audit && <AuditLine text={audit} testId="rate-audit" />}
          </>
        }
      />
      <Field
        label="Not (yalnız yönetim görür)"
        name="note"
        defaultValue={state.values?.note ?? note}
        maxLength={200}
        placeholder="ör. Öğrenci"
        errors={state.fieldErrors?.note}
      />
      <Button type="submit" variant="outline" className="h-11 rounded-full px-5" disabled={pending}>
        Kaydet
      </Button>
    </form>
  );
}

export function WaiverForm({
  periodId,
  periodName,
  userId,
  reason,
  audit,
}: {
  periodId: string;
  periodName: string;
  userId: string;
  reason: string | null;
  audit: string | null;
}) {
  const [state, action, pending] = useActionState(setWaiver.bind(null, periodId, userId), {});
  const [confirming, setConfirming] = useState(false);
  const [removing, run] = useRunAction();
  useToastOnSuccess(state, false);
  if (reason) {
    return (
      <div className="space-y-2">
        <p className="text-sm" data-testid="waiver-reason">
          {periodName}: Bu dönem muaf: {reason}
        </p>
        {audit && <AuditLine text={audit} testId="waiver-audit" />}
        <Button
          variant="outline"
          className="h-11 rounded-full px-4"
          onClick={() => setConfirming(true)}
        >
          Muafiyeti kaldır
        </Button>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Muafiyet kaldırılsın mı?"
          description={`${periodName} için normal aidat borcu yeniden hesaplanır.`}
          pending={removing}
          actions={[
            {
              label: "Muafiyeti kaldır",
              run: () =>
                run(
                  () => removeWaiver(periodId, userId),
                  () => setConfirming(false),
                ),
            },
          ]}
        />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3" noValidate data-testid="waiver-form">
      <p className="text-sm font-medium">{periodName} için muafiyet</p>
      <FormMessage error={state.error} />
      <Field
        label="Neden"
        name="reason"
        defaultValue={state.values?.reason}
        maxLength={200}
        placeholder="ör. Uzun hastalık"
        errors={state.fieldErrors?.reason}
      />
      <Button type="submit" variant="outline" className="h-11 rounded-full px-5" disabled={pending}>
        Muaf tut
      </Button>
    </form>
  );
}

/** Ödeme al inside the member sheet: the same form as the list's sheet, shown inline. */
export function MemberPayment({
  memberId,
  open,
  today,
  yesterday,
}: {
  memberId: string;
  open: OpenPeriod[];
  today: string;
  yesterday: string;
}) {
  const router = useRouter();
  const [showing, setShowing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const onSuccess = useCallback(
    (state: FormState) => {
      if (state.success) toast.success(state.success);
      setDone(state.success ?? null);
      setShowing(false);
      router.refresh();
    },
    [router],
  );
  if (open.length === 0) return null;
  return showing ? (
    <PaymentForm
      memberId={memberId}
      open={open}
      today={today}
      yesterday={yesterday}
      onSuccess={onSuccess}
    />
  ) : (
    <div className="space-y-2">
      {done && (
        <p role="status" className="rounded-xl bg-success/12 px-3.5 py-2.5 text-sm text-success">
          {done}
        </p>
      )}
      <Button className="h-12 w-full rounded-xl text-base" onClick={() => setShowing(true)}>
        Ödeme al
      </Button>
    </div>
  );
}
