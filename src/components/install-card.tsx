"use client";

import { CircleCheck, Share, SquarePlus } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { ArkheMonogram } from "@/components/arkhe-logo";
import { Button } from "@/components/ui/button";
import {
  getDeferredPrompt,
  getInstallStatus,
  setInstallStatus,
  subscribeInstall,
} from "@/lib/pwa-store";

type CardState = "hidden" | "prompt" | "ios" | "other" | "installed";

const STANDALONE = "(display-mode: standalone)";

function isStandalone() {
  return (
    window.matchMedia(STANDALONE).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function getState(): CardState {
  if (isStandalone()) return "hidden";
  const status = getInstallStatus();
  if (status === "installed") return "installed";
  if (getDeferredPrompt()) return "prompt";
  if (isIos()) return "ios";
  return "other";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(STANDALONE);
  media.addEventListener("change", onChange);
  const unsubscribe = subscribeInstall(onChange);
  return () => {
    media.removeEventListener("change", onChange);
    unsubscribe();
  };
}

async function install() {
  const prompt = getDeferredPrompt();
  if (!prompt) return;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setInstallStatus(outcome === "accepted" ? "installed" : "dismissed");
  } catch {
    // A used or stale prompt event: fall back to the browser-menu text.
    setInstallStatus("dismissed");
  }
}

/** "Add to home screen" hint on Profil; renders nothing on the server and in the installed app. */
export function InstallCard() {
  const state = useSyncExternalStore(subscribe, getState, () => "hidden" as const);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  if (state === "hidden") return null;

  async function onInstall() {
    // A ref, not state: a second tap in the same frame must already see the first one.
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    await install();
    busy.current = false;
    setPending(false);
    // The button unmounts; keep focus in the card so the new text is read next.
    title.current?.focus();
  }

  return (
    <section
      aria-labelledby="install-card-title"
      className="space-y-3 rounded-2xl border bg-card p-4"
      data-testid="install-card"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-stage text-stage-foreground dark:ring-1 dark:ring-border"
        >
          <ArkheMonogram density="small" className="h-6" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2
            id="install-card-title"
            ref={title}
            tabIndex={-1}
            className="text-base font-medium outline-none"
          >
            Telefonuna ekle
          </h2>
          {state === "prompt" && (
            <p className="text-sm text-muted-foreground">
              Arkhe&apos;yi ana ekranına ekle; yoklamaya ve ödevlerine tek dokunuşla ulaş.
            </p>
          )}
          {state === "ios" && (
            <p className="text-sm text-muted-foreground">
              {/* The icon carries its own trailing gap so the text reads with single spaces. */}
              Safari&apos;de Paylaş{" "}
              <Share aria-hidden className="mr-1 inline size-4 align-[-2px]" />
              simgesine, sonra “Ana Ekrana Ekle”ye dokun.
            </p>
          )}
          {state === "other" && (
            <p className="text-sm text-muted-foreground">
              Tarayıcı menüsünden “Ana ekrana ekle” ya da “Uygulamayı yükle”yi seç.
            </p>
          )}
          {state === "installed" && (
            <p role="status" className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-present" />
              Eklendi. Arkhe&apos;yi artık ana ekranından açabilirsin.
            </p>
          )}
        </div>
      </div>
      {state === "prompt" && (
        <Button
          type="button"
          onClick={onInstall}
          disabled={pending}
          className="h-11 w-full rounded-full"
        >
          <SquarePlus aria-hidden />
          Ana ekrana ekle
        </Button>
      )}
    </section>
  );
}
