import { CircleAlert, Settings2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { BackupBanner as BannerState } from "@/lib/backup/queries";
import { cn } from "@/lib/utils";

const LINK = cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4");

/** Home warning for managers: failed or overdue monthly backup, or (conductor) not set up. */
export function BackupBanner({ state }: { state: BannerState | null }) {
  if (!state) return null;

  if (state.kind === "setup") {
    return (
      <aside
        aria-label="Aylık yedek"
        className="flex gap-3 rounded-2xl border bg-card p-4"
        data-testid="backup-banner"
        data-kind="unconfigured"
      >
        <Settings2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-2">
          <p className="text-sm font-medium">Aylık yedek henüz ayarlanmadı.</p>
          <p className="text-sm text-muted-foreground">
            Koronun kayıtları her ay yönetimin e-postasına yedeklensin.
          </p>
          <Link href="/yedek" className={LINK}>
            Ayarla
          </Link>
        </div>
      </aside>
    );
  }

  const failed = state.kind === "failed";
  const Icon = failed ? CircleAlert : TriangleAlert;
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-2xl border p-4",
        failed ? "border-absent/40 bg-absent/8" : "border-late/40 bg-late/10",
      )}
      data-testid="backup-banner"
      data-kind={state.kind}
    >
      <Icon
        className={cn("size-5 shrink-0", failed ? "text-absent-ink" : "text-late-ink")}
        aria-hidden
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {failed
            ? `Aylık yedek gönderilemedi (${state.monthLabel}).`
            : `${state.monthLabel} raporu ve yedeği henüz gönderilmedi.`}
        </p>
        {failed && (
          <p className="text-sm text-muted-foreground">
            Her sabah yeniden deneniyor. Nedenini Yedekleme sayfasında görebilirsin.
          </p>
        )}
        <Link href="/yedek" className={LINK}>
          Yedeklemeye git
        </Link>
      </div>
    </div>
  );
}
