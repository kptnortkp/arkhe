"use client";

import { logout } from "@/app/actions/auth";
import { clearTakes } from "@/components/recording/take-store";

/** Logout also drops unsent takes held in memory: the next person on a shared phone sees none. */
export function LogoutForm({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <form action={logout} onSubmit={() => clearTakes()} className={className}>
      {children}
    </form>
  );
}
