"use client";

import { logout } from "@/app/actions/auth";
import { dropBrowserSubscription } from "@/components/notifications/push-client";
import { clearTakes } from "@/components/recording/take-store";

/**
 * Logout also drops unsent takes held in memory and this browser's push subscription, so the next
 * person on a shared phone sees and receives none of it.
 */
export function LogoutForm({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <form
      action={logout}
      onSubmit={() => {
        clearTakes();
        // The action redirects client-side, so the page lives on until this settles.
        void dropBrowserSubscription().catch(() => undefined);
      }}
      className={className}
    >
      {children}
    </form>
  );
}
