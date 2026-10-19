"use client";

import { useEffect } from "react";
import {
  setDeferredPrompt,
  setInstallStatus,
  type BeforeInstallPromptEvent,
} from "@/lib/pwa-store";

/** Mounted once in the root layout: keeps the install prompt and registers the service worker in production. */
export function PwaBoot() {
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallStatus("installed");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((error) => console.error("Service worker registration failed", error));
    } else if ("serviceWorker" in navigator) {
      // A worker left behind by `npm start` on this origin must never serve dev chunks.
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())));
      if ("caches" in window) {
        void caches
          .keys()
          .then((keys) =>
            Promise.all(keys.filter((k) => k.startsWith("arkhe-")).map((k) => caches.delete(k))),
          );
      }
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
