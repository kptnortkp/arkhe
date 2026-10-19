import { CircleCheck } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { getPaymentInfo, myDues } from "@/lib/finance/queries";
import { formatKurus } from "@/lib/money";
import { dayInstant, formatShortDate } from "@/lib/time";
import { DuesChip } from "./dues-chip";
import { eyebrow } from "./finance-nav";

/** The singer's own dues on /profil; the conductor has none. */
export async function MyDuesSection() {
  const mine = await myDues();
  if (!mine) return null;
  const info = await getPaymentInfo();
  return (
    <section id="aidat" className="scroll-mt-20 space-y-4" data-testid="my-dues">
      <h2 className="text-xl font-medium">Aidatım</h2>
      {mine.exempt ? (
        <p className="rounded-2xl border bg-card p-4 text-sm">Aidattan muafsın.</p>
      ) : mine.rows.length === 0 ? (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          Henüz aidat dönemi yok.
        </p>
      ) : (
        <>
          {mine.remaining > 0 ? (
            <p className="text-2xl font-semibold tabular-nums" data-testid="my-dues-remaining">
              Kalan borcun {formatKurus(mine.remaining)}
            </p>
          ) : (
            <p className="flex items-center gap-2 font-medium">
              <CircleCheck className="size-5 text-present-ink" aria-hidden />
              Borcun yok. Teşekkürler!
            </p>
          )}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {mine.rows.map((r) => (
              <li
                key={r.id}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-2"
                data-testid="my-dues-row"
                data-name={r.name}
              >
                <span>
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {r.waived
                      ? "Bu dönem muaf"
                      : `Son ödeme ${formatShortDate.format(dayInstant(r.dueOn))} · ${formatKurus(r.owed)}${r.reduced ? " (İndirimli)" : ""}`}
                  </span>
                </span>
                <DuesChip status={r.status} solid />
              </li>
            ))}
          </ul>
        </>
      )}
      {!mine.exempt && (
        <div className="space-y-2">
          <h3 className={eyebrow}>Ödemelerim</h3>
          {mine.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz ödeme kaydın yok.</p>
          ) : (
            <ul
              className="divide-y overflow-hidden rounded-2xl border bg-card text-sm"
              data-testid="my-payments"
            >
              {mine.payments.map((p) => (
                <li key={p.id} className="flex min-h-11 items-center justify-between gap-2 px-4">
                  <span>
                    {formatShortDate.format(dayInstant(p.occurredOn))} · {p.periodName}
                  </span>
                  <span className="tabular-nums">{formatKurus(p.amountKurus)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* A fully exempt member with nothing left to pay has no use for payment details. */}
      {!(mine.exempt && mine.remaining === 0) && (
        <div className="space-y-3 rounded-xl bg-muted p-4">
          <h3 className="font-medium">Nasıl ödenir?</h3>
          {info ? (
            <>
              <p
                className="font-mono text-sm break-words whitespace-pre-line select-all"
                data-testid="payment-info"
              >
                {info}
              </p>
              <CopyButton text={info} />
            </>
          ) : (
            <p className="text-sm">Ödeme bilgisi henüz eklenmedi. Saymanına sor.</p>
          )}
          <p className="text-xs text-muted-foreground">Ödemen yönetim kaydedince burada görünür.</p>
        </div>
      )}
    </section>
  );
}
