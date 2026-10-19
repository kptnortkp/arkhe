"use client";

import { Paperclip, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createSponsor } from "@/app/(portal)/finans/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type Account } from "@/lib/finance/categories";
import { CATEGORY_LABELS } from "@/lib/labels";
import type { FormState } from "@/lib/validation";
import { AmountInput } from "./amount-input";
import { ChoiceChips } from "./choice-chips";

export type EntryKindChoice = "income" | "expense" | "transfer";

export type EntryDefaults = {
  kind: EntryKindChoice;
  amount: string;
  category: string;
  occurredOn: string;
  account: Account;
  toAccount: Account;
  description: string;
  counterparty: string;
  sponsorId: string;
  eventId: string;
  documentUrl: string;
};

const select =
  "h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

const ACCOUNT_OPTIONS = [
  { value: "cash" as const, label: "Kasa" },
  { value: "bank" as const, label: "Banka" },
];

function newId() {
  return crypto.randomUUID();
}

export function EntryForm({
  action,
  clientId,
  defaults,
  initialEcho,
  sponsors: initialSponsors,
  events,
  today,
  yesterday,
  maxDate,
  geri,
  submitLabel,
  duesLock,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  clientId: string;
  defaults: EntryDefaults;
  initialEcho: string | null;
  sponsors: { id: string; name: string }[];
  events: { id: string; name: string }[];
  today: string;
  yesterday: string;
  maxDate: string;
  geri: string;
  submitLabel: string;
  /** Dues corrections keep their member and period; only amount, date and account change. */
  duesLock?: { member: string; period: string };
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const errors = state.fieldErrors ?? {};
  const [id, setId] = useState(clientId);
  const [kind, setKind] = useState<EntryKindChoice>(defaults.kind);
  const [amount, setAmount] = useState(defaults.amount);
  const [category, setCategory] = useState(defaults.category);
  const [date, setDate] = useState(defaults.occurredOn);
  const [account, setAccount] = useState<Account>(defaults.account);
  const [toAccount, setToAccount] = useState<Account>(defaults.toAccount);
  const [description, setDescription] = useState(defaults.description);
  const [counterparty, setCounterparty] = useState(defaults.counterparty);
  const [sponsorId, setSponsorId] = useState(defaults.sponsorId);
  const [eventId, setEventId] = useState(defaults.eventId);
  const [documentUrl, setDocumentUrl] = useState(defaults.documentUrl);
  const [sponsors, setSponsors] = useState(initialSponsors);
  const [newSponsor, setNewSponsor] = useState<string | null>(null);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const [addingSponsor, startSponsor] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);
  const handled = useRef<FormState | null>(null);

  useEffect(() => {
    if (!state.success || handled.current === state) return;
    handled.current = state;
    toast.success(state.success);
    if (state.values?.intent === "next") {
      // Keep kind, category, account and date for the next receipt of the evening.
      /* eslint-disable react-hooks/set-state-in-effect -- reset after a confirmed save */
      setId(newId());
      setAmount("");
      setDescription("");
      setCounterparty("");
      setDocumentUrl("");
      /* eslint-enable react-hooks/set-state-in-effect */
      amountRef.current?.focus();
    } else if (state.values?.redirect) {
      router.push(state.values.redirect);
    }
  }, [state, router]);

  const categories =
    kind === "income" ? INCOME_CATEGORIES.filter((c) => c !== "dues") : EXPENSE_CATEGORIES;

  function switchKind(next: EntryKindChoice) {
    setKind(next);
    setCategory("");
    if (next === "transfer") setToAccount(account === "cash" ? "bank" : "cash");
  }

  function addSponsor() {
    const name = (newSponsor ?? "").trim();
    if (!name) {
      setSponsorError("Ad gir.");
      return;
    }
    const fd = new FormData();
    const sid = newId();
    fd.set("id", sid);
    fd.set("name", name);
    startSponsor(async () => {
      const result = await createSponsor({}, fd);
      if (result.fieldErrors?.name || result.error) {
        setSponsorError(result.fieldErrors?.name?.[0] ?? result.error ?? null);
        return;
      }
      setSponsors((list) => [...list, { id: sid, name: result.values?.name ?? name }]);
      setSponsorId(sid);
      setNewSponsor(null);
      requestAnimationFrame(() => document.getElementById("sponsorId")?.focus());
      setSponsorError(null);
      toast.success("Sponsor kaydedildi.");
    });
  }

  const formError =
    state.error ?? (state.fieldErrors ? "Bazı alanları düzeltmen gerekiyor." : undefined);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, formAction)}
      className="space-y-6"
      noValidate
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="geri" value={geri} />
      {!duesLock && <input type="hidden" name="kind" value={kind} />}
      <FormMessage error={formError} />

      {duesLock ? (
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 rounded-2xl border bg-card p-4 text-sm">
          <dt className="text-muted-foreground">Tür</dt>
          <dd>Gelir · Aidat</dd>
          <dt className="text-muted-foreground">Üye</dt>
          <dd>{duesLock.member}</dd>
          <dt className="text-muted-foreground">Aidat dönemi</dt>
          <dd>{duesLock.period}</dd>
        </dl>
      ) : (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Tür</legend>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
            {(
              [
                ["income", "Gelir"],
                ["expense", "Gider"],
                ["transfer", "Virman"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg text-sm font-medium text-muted-foreground has-checked:bg-card has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="kindChoice"
                  value={value}
                  checked={kind === value}
                  onChange={() => switchKind(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <AmountInput
        value={amount}
        onChange={setAmount}
        initialEcho={initialEcho}
        errors={errors.amount}
        autoFocus
        inputRef={amountRef}
      />

      {kind !== "transfer" && !duesLock && (
        <ChoiceChips
          legend="Kategori"
          name="category"
          value={category}
          onChange={setCategory}
          errors={errors.category}
          options={categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          hint={
            kind === "income" ? (
              <p className="text-xs text-muted-foreground">
                Aidat ödemeleri{" "}
                <Link href="/finans/aidat" className="font-medium text-primary underline">
                  Aidat sayfasından
                </Link>{" "}
                alınır.
              </p>
            ) : null
          }
        />
      )}

      {kind === "income" && category === "sponsorship" && !duesLock && (
        <div className="space-y-2">
          <Label htmlFor="sponsorId">Sponsor</Label>
          <select
            id="sponsorId"
            name="sponsorId"
            value={sponsorId}
            onChange={(e) => setSponsorId(e.target.value)}
            className={select}
            aria-invalid={errors.sponsorId?.length ? true : undefined}
            aria-describedby={errors.sponsorId?.length ? "sponsorId-error" : undefined}
          >
            <option value="">Sponsor seç</option>
            {sponsors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {errors.sponsorId?.length ? (
            <p id="sponsorId-error" className="text-sm text-destructive">
              {errors.sponsorId[0]}
            </p>
          ) : null}
          {newSponsor === null ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 rounded-full px-3"
              onClick={() => setNewSponsor("")}
            >
              + Yeni sponsor
            </Button>
          ) : (
            <div className="space-y-2 rounded-xl border bg-card p-3">
              <Label htmlFor="newSponsor">Yeni sponsorun adı</Label>
              <div className="flex gap-2">
                <Input
                  id="newSponsor"
                  autoFocus
                  value={newSponsor}
                  onChange={(e) => setNewSponsor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSponsor();
                    }
                  }}
                  maxLength={120}
                  aria-invalid={sponsorError ? true : undefined}
                  aria-describedby={sponsorError ? "newSponsor-error" : undefined}
                  className="h-11 rounded-xl"
                />
                <Button
                  type="button"
                  className="h-11 px-4"
                  disabled={addingSponsor}
                  onClick={addSponsor}
                >
                  Ekle
                </Button>
              </div>
              {sponsorError && (
                <p id="newSponsor-error" className="text-sm text-destructive">
                  {sponsorError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="occurredOn">Tarih</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="occurredOn"
            name="occurredOn"
            type="date"
            max={maxDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={errors.occurredOn?.length ? true : undefined}
            aria-describedby={errors.occurredOn?.length ? "occurredOn-error" : undefined}
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
          <p id="occurredOn-error" className="text-sm text-destructive">
            {errors.occurredOn[0]}
          </p>
        ) : null}
      </div>

      <ChoiceChips
        legend={kind === "transfer" ? "Kaynak hesap" : "Hesap"}
        name="account"
        value={account}
        onChange={(a) => {
          setAccount(a);
          if (kind === "transfer" && a === toAccount) setToAccount(a === "cash" ? "bank" : "cash");
        }}
        errors={errors.account}
        options={ACCOUNT_OPTIONS}
      />
      {kind === "transfer" && (
        <ChoiceChips
          legend="Hedef hesap"
          name="toAccount"
          value={toAccount}
          onChange={setToAccount}
          errors={errors.toAccount}
          options={ACCOUNT_OPTIONS}
        />
      )}

      {kind !== "transfer" && !duesLock && (
        <div className="space-y-2">
          <Label htmlFor="eventId">Etkinlik</Label>
          <select
            id="eventId"
            name="eventId"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className={select}
          >
            <option value="">Etkinlik yok</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {kind !== "transfer" && (
        <Field
          label={kind === "income" ? "Kimden" : "Kime"}
          name="counterparty"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          maxLength={120}
          placeholder={kind === "income" ? "ör. Mülkiye Vakfı" : "ör. Ahmet Yılmaz (korrepetitör)"}
          errors={errors.counterparty}
        />
      )}
      <Field
        label="Açıklama"
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={200}
        placeholder="ör. Salon kirası, 12 Aralık genel prova"
        errors={errors.description}
        hint={description.length >= 160 ? `${description.length}/200` : undefined}
      />
      {kind !== "transfer" && (
        <div className="space-y-2">
          <Label htmlFor="documentUrl">Belge</Label>
          <div className="relative">
            <Paperclip
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="documentUrl"
              name="documentUrl"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              value={documentUrl}
              onChange={(e) => setDocumentUrl(e.target.value)}
              placeholder="https://drive.google.com/…"
              aria-invalid={errors.documentUrl?.length ? true : undefined}
              aria-describedby={
                errors.documentUrl?.length ? "documentUrl-error" : "documentUrl-hint"
              }
              className="h-11 rounded-xl pl-9"
            />
          </div>
          {errors.documentUrl?.length ? (
            <p id="documentUrl-error" className="text-sm text-destructive">
              {errors.documentUrl[0]}
            </p>
          ) : (
            <p id="documentUrl-hint" className="text-xs text-muted-foreground">
              Makbuz veya faturanın Drive bağlantısı. Sonra da ekleyebilirsin.
            </p>
          )}
        </div>
      )}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.3rem)] z-10 -mx-4 flex gap-2 bg-background/95 px-4 pt-3 pb-3 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <Button
          type="submit"
          disabled={pending}
          className="h-12 flex-1 rounded-xl px-6 md:flex-none"
        >
          {submitLabel}
        </Button>
        {!duesLock && kind !== "transfer" && submitLabel === "Kaydet" && (
          <Button
            type="submit"
            name="intent"
            value="next"
            variant="outline"
            disabled={pending}
            aria-label="Kaydet ve yenisini ekle"
            className="h-12 rounded-xl px-4"
          >
            <Plus />
            <span aria-hidden className="md:hidden">
              Yeni
            </span>
            <span aria-hidden className="hidden md:inline">
              Kaydet ve yenisini ekle
            </span>
          </Button>
        )}
      </div>
    </form>
  );
}
