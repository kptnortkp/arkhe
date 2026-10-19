"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/** Shows the flash message once and clears its cookie. */
export function FlashToast({ message }: { message: string }) {
  useEffect(() => {
    toast.success(message, { id: "flash" });
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `arkhe_flash=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  }, [message]);
  return null;
}
