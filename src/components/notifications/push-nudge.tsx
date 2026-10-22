"use client";

import { BellRing } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { enablePush, detectState, ENABLE_ERROR } from "./push-client";

const HIDE_KEY = "arkhe-push-nudge-hidden";
const HIDE_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function hiddenRecently() {
  try {
    const at = Number(localStorage.getItem(HIDE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < HIDE_FOR_MS;
  } catch {
    return false;
  }
}

/** Home card asking once per 30 days to turn notifications on in this browser. */
export function PushNudge({ publicKey, userId }: { publicKey: string; userId: string }) {
  const [mode, setMode] = useState<"hidden" | "ask" | "ios">("hidden");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hiddenRecently()) return;
    void detectState().then((s) => {
      // AC 19: only a browser never asked; "granted" without a subscription was turned off on purpose.
      if (s === "default" && Notification.permission === "default") setMode("ask");
      else if (s === "ios-install") setMode("ios");
    });
  }, []);

  if (mode === "hidden") return null;

  function hide() {
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now()));
    } catch {}
    setMode("hidden");
  }

  async function onEnable() {
    if (busy) return;
    setBusy(true);
    const result = await enablePush(publicKey, userId).catch(() => ({
      state: "default" as const,
      error: ENABLE_ERROR,
    }));
    setBusy(false);
    if ("error" in result && result.error) toast.error(result.error);
    else if ("success" in result && result.success) {
      toast.success(result.success);
      setMode("hidden");
    } else hide(); // The prompt was dismissed or blocked: counts as "Şimdi değil".
  }

  return (
    <section
      aria-labelledby="push-nudge-title"
      className="space-y-3 rounded-2xl border bg-card p-4"
      data-testid="push-nudge"
      data-mode={mode}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold-foreground dark:text-gold"
        >
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="push-nudge-title" className="text-base font-medium">
            Yoklama açılınca haber verelim mi?
          </h2>
          <p className="text-sm text-muted-foreground">
            {mode === "ios"
              ? "iPhone'da önce Arkhe'yi ana ekrana ekle."
              : "Çalışma değişikliği, yoklama ve ödevler için telefonuna bildirim gönderelim."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {mode === "ask" ? (
          <Button
            type="button"
            onClick={onEnable}
            disabled={busy}
            className="h-11 flex-1 rounded-full"
          >
            Bildirimleri aç
          </Button>
        ) : (
          <Link
            href="/profil#bildirimler"
            className={cn(buttonVariants(), "h-11 flex-1 rounded-full")}
          >
            Nasıl?
          </Link>
        )}
        <Button type="button" variant="outline" onClick={hide} className="h-11 flex-1 rounded-full">
          Şimdi değil
        </Button>
      </div>
    </section>
  );
}
