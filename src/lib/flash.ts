import "server-only";
import { cookies } from "next/headers";
import { secureCookies } from "@/lib/auth/cookie-names";

export const FLASH_COOKIE = "arkhe_flash";

// The cookie carries only a key; any other value is ignored, so no text can be injected.
const FLASH_MESSAGES = {
  "kayit-duzeltildi": "Kayıt düzeltildi.",
} as const;

export type FlashKey = keyof typeof FLASH_MESSAGES;

/** A toast for the next page, for actions that redirect and so can't return one. */
export async function setFlash(key: FlashKey) {
  (await cookies()).set(FLASH_COOKIE, key, {
    sameSite: "lax",
    path: "/",
    maxAge: 30,
    secure: secureCookies,
  });
}

export async function readFlash() {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  return raw && Object.hasOwn(FLASH_MESSAGES, raw) ? FLASH_MESSAGES[raw as FlashKey] : null;
}
