import { ArrowLeft } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { correctEntry, createEntry } from "@/app/(portal)/finans/actions";
import {
  EntryForm,
  type EntryDefaults,
  type EntryKindChoice,
} from "@/components/finance/entry-form";
import { entryTitle } from "@/components/finance/entry-row";
import { requireManager } from "@/lib/auth/dal";
import { getEntry, eventOptions, sponsorOptions, todayIstanbul } from "@/lib/finance/queries";
import { ACCOUNT_COOKIE, safeReturn } from "@/lib/finance/schemas";
import { amountInput, formatKurus, formatSigned } from "@/lib/money";
import { addDays, dayInstant, formatShortDate } from "@/lib/time";

export const metadata = { title: "Hareket ekle" };

const KIND_PARAM: Record<string, EntryKindChoice> = {
  gelir: "income",
  gider: "expense",
  virman: "transfer",
};
const TITLES: Record<EntryKindChoice, string> = {
  income: "Gelir ekle",
  expense: "Gider ekle",
  transfer: "Virman",
};

export default async function NewEntryPage({ searchParams }: PageProps<"/finans/yeni">) {
  await requireManager();
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : "");
  const today = todayIstanbul();
  const [sponsorList, eventList] = await Promise.all([sponsorOptions(), eventOptions()]);
  const remembered = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  const geri = safeReturn(one(sp.geri));
  const backLabel = geri.startsWith("/finans/hareketler")
    ? "Hareketler"
    : geri === "/finans"
      ? "Finans"
      : "Geri";

  const correctId = one(sp.duzelt);
  if (correctId) {
    if (!z.uuid().safeParse(correctId).success) notFound();
    const old = await getEntry(correctId);
    if (!old || old.kind === "opening") notFound();
    const summary = `${old.kind === "income" ? formatSigned(old.amountKurus, "in") : old.kind === "expense" ? formatSigned(old.amountKurus, "out") : formatKurus(old.amountKurus)} · ${entryTitle(old)} · ${formatShortDate.format(dayInstant(old.occurredOn))}`;
    const kind = old.kind as EntryKindChoice;
    const defaults: EntryDefaults = {
      kind,
      amount: amountInput(old.amountKurus),
      category: old.category ?? "",
      occurredOn: old.occurredOn,
      account: old.account,
      toAccount: old.toAccount ?? (old.account === "cash" ? "bank" : "cash"),
      description: old.description ?? "",
      counterparty: old.counterparty ?? "",
      sponsorId: old.sponsorId ?? "",
      eventId: old.eventId ?? "",
      documentUrl: old.documentUrl ?? "",
    };
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <BackLink href={`/finans/${old.id}`} label="Kayda dön" />
        <h1 className="text-4xl font-medium">Kaydı düzelt</h1>
        {old.voidedAt ? (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
          >
            Bu kayıt zaten iptal edilmiş.
          </p>
        ) : (
          <>
            <p
              className="rounded-2xl border border-late/40 bg-late/10 p-4 text-sm"
              data-testid="correct-banner"
            >
              Bu kaydı düzeltiyorsun: <span className="tabular-nums">{summary}</span>. Kaydettiğinde
              eski kayıt &quot;Düzeltildi&quot; nedeniyle iptal edilir.
            </p>
            <EntryForm
              action={correctEntry.bind(null, old.id)}
              clientId={crypto.randomUUID()}
              defaults={defaults}
              initialEcho={formatKurus(old.amountKurus)}
              sponsors={sponsorList.filter((s) => s.isActive || s.id === old.sponsorId)}
              events={eventList}
              today={today}
              yesterday={addDays(today, -1)}
              maxDate={addDays(today, 31)}
              geri={`/finans/${old.id}`}
              submitLabel="Düzeltilmiş kaydı kaydet"
              duesLock={
                old.category === "dues"
                  ? { member: old.memberName ?? "", period: old.periodName ?? "" }
                  : undefined
              }
            />
          </>
        )}
      </div>
    );
  }

  const kind = KIND_PARAM[one(sp.tur)] ?? "expense";
  const eventId = eventList.some((e) => e.id === one(sp.etkinlik)) ? one(sp.etkinlik) : "";
  const sponsorId = sponsorList.some((s) => s.id === one(sp.sponsor)) ? one(sp.sponsor) : "";
  const account = remembered === "cash" || remembered === "bank" ? remembered : "bank";
  const defaults: EntryDefaults = {
    kind: sponsorId ? "income" : kind,
    amount: "",
    category: sponsorId ? "sponsorship" : "",
    occurredOn: today,
    account: kind === "transfer" ? "cash" : account,
    toAccount: "bank",
    description: "",
    counterparty: "",
    sponsorId,
    eventId,
    documentUrl: "",
  };
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <BackLink href={geri} label={backLabel} />
      <h1 className="text-4xl font-medium">{TITLES[defaults.kind]}</h1>
      <EntryForm
        action={createEntry}
        clientId={crypto.randomUUID()}
        defaults={defaults}
        initialEcho={null}
        sponsors={sponsorList.filter((s) => s.isActive)}
        events={eventList}
        today={today}
        yesterday={addDays(today, -1)}
        maxDate={addDays(today, 31)}
        geri={geri}
        submitLabel="Kaydet"
      />
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {label}
    </Link>
  );
}
