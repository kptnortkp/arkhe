"use client";

import { CalendarPlus, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { renewCalendarFeed } from "@/app/(portal)/profil/calendar-actions";
import { CopyButton } from "@/components/copy-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Profile: subscribe the phone's calendar to my rehearsals (iPhone, Google, or a copied link). */
export function CalendarFeedSection({ url: initial }: { url: string | null }) {
  const [url, setUrl] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const renew = () =>
    startTransition(async () => {
      const result = await renewCalendarFeed();
      if (result.error || !result.url) {
        toast.error(result.error ?? "Bağlantı oluşturulamadı.");
        return;
      }
      if (url) toast.success("Yeni bağlantı hazır. Eski bağlantı artık çalışmıyor.");
      setUrl(result.url);
      setConfirming(false);
    });

  const webcal = url?.replace(/^https?:/, "webcal:");
  const google = webcal
    ? `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`
    : null;

  return (
    <section id="takvim" className="space-y-4" aria-labelledby="takvim-baslik">
      <div>
        <h2 id="takvim-baslik" className="text-xl font-medium">
          Takvim aboneliği
        </h2>
        <p className="text-sm text-muted-foreground">
          Çalışma ve konserlerin telefonundaki takvime eklenir; saat, yer değişir ya da iptal olursa
          orada da güncellenir.
        </p>
      </div>
      {url && webcal && google ? (
        <div className="space-y-3" data-testid="calendar-feed">
          <div className="flex flex-wrap gap-2">
            <a
              href={webcal}
              className={cn(buttonVariants(), "h-11 rounded-xl px-4")}
              data-testid="calendar-webcal"
            >
              <CalendarPlus />
              iPhone / Mac takvimine ekle
            </a>
            <a
              href={google}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-4")}
            >
              Google Takvim&apos;e ekle
            </a>
            <CopyButton
              text={url}
              label="Bağlantıyı kopyala"
              toastText="Takvim bağlantısı kopyalandı."
              fallbackTitle="Takvim bağlantısı"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Bu bağlantı sana özel; başkasıyla paylaşma. Paylaştıysan yenile, eskisi çalışmaz.
          </p>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
              <span className="flex-1">
                Eski bağlantı çalışmayı bırakır; takvimi yeniden eklemen gerekir.
              </span>
              <Button
                variant="outline"
                className="h-11 rounded-full px-4"
                onClick={() => setConfirming(false)}
              >
                Vazgeç
              </Button>
              <Button className="h-11 rounded-full px-4" disabled={pending} onClick={renew}>
                Yenile
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="h-11 rounded-full px-3 text-muted-foreground"
              onClick={() => setConfirming(true)}
            >
              <RefreshCw />
              Bağlantıyı yenile
            </Button>
          )}
        </div>
      ) : (
        <Button className="h-11 rounded-xl px-4" disabled={pending} onClick={renew}>
          <CalendarPlus />
          Takvim bağlantımı oluştur
        </Button>
      )}
    </section>
  );
}
