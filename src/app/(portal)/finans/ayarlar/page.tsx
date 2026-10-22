import Link from "next/link";
import { FinanceNav } from "@/components/finance/finance-nav";
import { OpeningForm, PaymentInfoForm } from "@/components/finance/settings-forms";
import { requireManager } from "@/lib/auth/dal";
import { getPaymentInfo, openingState, todayIstanbul } from "@/lib/finance/queries";
import { amountInput } from "@/lib/money";
import { dayInstant, formatDayMonth } from "@/lib/time";

export const metadata = { title: "Finans ayarları" };

export default async function FinanceSettingsPage() {
  await requireManager();
  const [opening, info] = await Promise.all([openingState(), getPaymentInfo()]);
  const date = opening.date ?? todayIstanbul();
  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-medium">Ayarlar</h1>
      <FinanceNav active="ayarlar" />
      <section
        className="max-w-xl space-y-3 rounded-2xl border bg-card p-4"
        aria-labelledby="acilis"
      >
        <h2 id="acilis" className="text-xl font-medium">
          Açılış bakiyesi
        </h2>
        <p className="text-sm text-muted-foreground">
          Kayda başladığın günün kasa ve banka bakiyesi.
          {opening.firstEntryOn &&
            ` Tarih ${formatDayMonth.format(dayInstant(opening.firstEntryOn))} ya da öncesi olmalı; sonrasına alınamaz çünkü o günden kayıt var.`}
        </p>
        <p className="text-sm text-muted-foreground">
          Geçmiş kayıtları aktarıyorsan açılış tarihi, kayıtlarının başladığı gün olmalı.{" "}
          <Link
            href="/ice-aktar"
            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
          >
            Veri içe aktar
          </Link>
        </p>
        <OpeningForm
          date={date}
          cash={opening.cash ? amountInput(opening.cash) : ""}
          bank={opening.bank ? amountInput(opening.bank) : ""}
        />
      </section>
      <section
        className="max-w-xl space-y-3 rounded-2xl border bg-card p-4"
        aria-labelledby="odeme"
      >
        <h2 id="odeme" className="text-xl font-medium">
          Ödeme bilgisi
        </h2>
        <PaymentInfoForm info={info ?? ""} />
      </section>
    </div>
  );
}
