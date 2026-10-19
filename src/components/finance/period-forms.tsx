"use client";

import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  bulkCreateDuesPeriods,
  createDuesPeriod,
  deleteDuesPeriod,
  updateDuesPeriod,
} from "@/app/(portal)/finans/aidat/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRunAction } from "@/components/use-run-action";
import { periodNameOf } from "@/lib/finance/dues";
import { formatKurus, parseAmount } from "@/lib/money";
import { dayInstant, formatShortDate } from "@/lib/time";
import type { FormState } from "@/lib/validation";

export type PeriodValues = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  dueOn: string;
  amount: string;
  reducedAmount: string;
  locked: boolean;
};

function useClosingAction(
  action: (s: FormState, fd: FormData) => Promise<FormState>,
  onDone: () => void,
) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const seen = useRef<FormState | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (!state.success || seen.current === state) return;
    seen.current = state;
    toast.success(state.success);
    doneRef.current();
    router.refresh();
  }, [state, router]);
  return [state, formAction, pending] as const;
}

function PeriodSheet({
  open,
  onOpenChange,
  period,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  period: PeriodValues | null;
}) {
  const [state, action, pending] = useClosingAction(
    period ? updateDuesPeriod.bind(null, period.id) : createDuesPeriod,
    () => onOpenChange(false),
  );
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const locked = period?.locked ?? false;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-xl">{period ? period.name : "Yeni dönem"}</SheetTitle>
          <SheetDescription>
            {locked
              ? "Bu döneme ödeme girilmiş; değiştirilemez."
              : "Ay ya da dönem için aidat tutarı."}
          </SheetDescription>
        </SheetHeader>
        <form action={action} className="space-y-4 px-4 pb-6" noValidate>
          <FormMessage error={state.error} />
          <fieldset disabled={locked} className="space-y-4">
            <Field
              label="Ad"
              name="name"
              defaultValue={v?.name ?? period?.name}
              placeholder="ör. Ekim 2026"
              maxLength={40}
              errors={e.name}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Başlangıç"
                name="startsOn"
                type="date"
                defaultValue={v?.startsOn ?? period?.startsOn}
                errors={e.startsOn}
              />
              <Field
                label="Bitiş"
                name="endsOn"
                type="date"
                defaultValue={v?.endsOn ?? period?.endsOn}
                errors={e.endsOn}
              />
            </div>
            <Field
              label="Son ödeme"
              name="dueOn"
              type="date"
              defaultValue={v?.dueOn ?? period?.dueOn}
              errors={e.dueOn}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Tam aidat"
                name="amount"
                inputMode="decimal"
                defaultValue={v?.amount ?? period?.amount}
                placeholder="300"
                errors={e.amount}
              />
              <Field
                label="İndirimli aidat"
                name="reducedAmount"
                inputMode="decimal"
                defaultValue={v?.reducedAmount ?? period?.reducedAmount}
                placeholder="150"
                errors={e.reducedAmount}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Boş bırakırsan indirimli üyeler de tam öder.
            </p>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => onOpenChange(false)}
            >
              Vazgeç
            </Button>
            {!locked && (
              <Button type="submit" className="h-11 px-5" disabled={pending}>
                Kaydet
              </Button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function BulkSheet({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: string[];
}) {
  const [state, action, pending] = useClosingAction(bulkCreateDuesPeriods, () =>
    onOpenChange(false),
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [reduced, setReduced] = useState("");
  const [day, setDay] = useState("15");
  const e = state.fieldErrors ?? {};
  const months: string[] = [];
  if (/^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from <= to) {
    for (let m = from; m <= to && months.length < 13;) {
      months.push(m);
      const [y, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
    }
  }
  const a = parseAmount(amount);
  const r = reduced.trim() ? parseAmount(reduced) : null;
  const fresh = months.filter((m) => !existing.includes(periodNameOf(m)));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-xl">Toplu oluştur</SheetTitle>
          <SheetDescription>Her ay için bir dönem; ayın 1&apos;inden son gününe.</SheetDescription>
        </SheetHeader>
        <form action={action} className="space-y-4 px-4 pb-6" noValidate>
          <FormMessage error={state.error} />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="İlk ay"
              name="fromMonth"
              type="month"
              value={from}
              onChange={(ev) => setFrom(ev.target.value)}
              errors={e.fromMonth}
            />
            <Field
              label="Son ay"
              name="toMonth"
              type="month"
              value={to}
              onChange={(ev) => setTo(ev.target.value)}
              errors={e.toMonth}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Tam aidat"
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              placeholder="350"
              errors={e.amount}
            />
            <Field
              label="İndirimli aidat"
              name="reducedAmount"
              inputMode="decimal"
              value={reduced}
              onChange={(ev) => setReduced(ev.target.value)}
              placeholder="175"
              errors={e.reducedAmount}
            />
          </div>
          <Field
            label="Son ödeme günü"
            name="dueDay"
            inputMode="numeric"
            value={day}
            onChange={(ev) => setDay(ev.target.value)}
            errors={e.dueDay}
            hint="1 ile 28 arası"
          />
          {months.length > 0 && (
            <ul className="divide-y rounded-xl border text-sm" data-testid="bulk-preview">
              {months.map((m) => (
                <li key={m} className="flex min-h-10 items-center justify-between gap-2 px-3">
                  <span>
                    {periodNameOf(m)} · son ödeme {dueLabel(m, day)}
                  </span>
                  {existing.includes(periodNameOf(m)) ? (
                    <span className="text-xs text-muted-foreground">zaten var, atlanacak</span>
                  ) : (
                    <span className="text-muted-foreground tabular-nums">
                      {a.ok ? formatKurus(a.kurus) : "—"}
                      {r?.ok ? ` / ${formatKurus(r.kurus)}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button type="submit" className="h-12 w-full rounded-xl" disabled={pending}>
            {fresh.length ? `${fresh.length} dönem oluştur` : "Dönemleri oluştur"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function PeriodToolbar({ existing }: { existing: string[] }) {
  const [creating, setCreating] = useState(false);
  const [bulk, setBulk] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button className="h-11 rounded-full px-4" onClick={() => setCreating(true)}>
        <Plus />
        Yeni dönem
      </Button>
      <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => setBulk(true)}>
        <CalendarPlus />
        Toplu oluştur
      </Button>
      {creating && <PeriodSheet open={creating} onOpenChange={setCreating} period={null} />}
      {bulk && <BulkSheet open={bulk} onOpenChange={setBulk} existing={existing} />}
    </div>
  );
}

/** "15 Kas" for the bulk preview; an out-of-range day is shown as typed and refused on save. */
function dueLabel(month: string, day: string) {
  const d = Number(day) || 15;
  if (!Number.isInteger(d) || d < 1 || d > 28) return String(d);
  return formatShortDate.format(dayInstant(`${month}-${String(d).padStart(2, "0")}`));
}

const LOCKED_DELETE = "Ödemesi olan dönem silinemez";

export function PeriodRowActions({ period }: { period: PeriodValues }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, run] = useRunAction();
  return (
    <div className="flex gap-1">
      <Button variant="ghost" className="h-11 px-3" onClick={() => setEditing(true)}>
        Düzenle<span className="sr-only">: {period.name}</span>
      </Button>
      {period.locked ? (
        <Button
          variant="ghost"
          className="size-11 cursor-not-allowed text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground/50"
          aria-disabled="true"
          title={LOCKED_DELETE}
        >
          <Trash2 aria-hidden />
          <span className="sr-only">
            Sil: {period.name}. {LOCKED_DELETE}
          </span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          className="size-11"
          aria-label={`Sil: ${period.name}`}
          onClick={() => setDeleting(true)}
        >
          <Trash2 />
        </Button>
      )}
      {editing && <PeriodSheet open={editing} onOpenChange={setEditing} period={period} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`${period.name} silinsin mi?`}
        description="Dönem ve muafiyetleri silinir. Ödeme girilmiş dönem silinemez."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteDuesPeriod(period.id),
                () => setDeleting(false),
              ),
          },
        ]}
      />
    </div>
  );
}
