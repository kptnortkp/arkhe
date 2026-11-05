"use client";

import { logout } from "@/app/actions/auth";
import { dropBrowserSubscription } from "@/components/notifications/push-client";
import { clearAudioCache } from "@/components/recording/audio-cache";
import { clearTakes } from "@/components/recording/take-store";

/**
 * Logout also drops unsent takes held in memory, rehearsal audio stored on the phone and this
 * browser's push subscription, so the next person on a shared phone sees and receives none of it.
 */
export function LogoutForm({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <form
      action={logout}
      onSubmit={() => {
        clearTakes();
        clearAudioCache();
        // The action redirects client-side, so the page lives on until this settles.
        void dropBrowserSubscription().catch(() => undefined);
      }}
      className={className}
    >
      {children}
    </form>
  );
}
